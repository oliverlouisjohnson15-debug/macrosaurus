import { createClient } from 'jsr:@supabase/supabase-js@2';

// Google Health API steps sync. The client never sees Google tokens: it sends us the one-time OAuth
// code (with its PKCE verifier), we exchange it server-side with the app secret, store only the
// refresh token, and hand back daily step counts. Later syncs refresh the access token and pull the
// last N days via the Health API dailyRollUp for the `steps` data type.
//   POST { action: 'exchange', code, code_verifier, redirect_uri, tz? } -> { ok, steps, last_sync }
//   POST { action: 'sync', days?, tz? }                                 -> { ok, steps, last_sync }
//   POST { action: 'status' }                                          -> { connected, last_sync }
//   POST { action: 'disconnect' }                                      -> { ok }
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const SYNC_DAYS_DEFAULT = 14;
const SYNC_DAYS_MAX = 90;
// Google Health data type for step counts. Per the data-types docs this is `steps`; if a live call
// 404s, the legacy fully-qualified name `com.google.step_count.delta` is the fallback to try.
const STEPS_DATA_TYPE = 'steps';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

function decodeJwt(token: string): { sub?: string } {
  try {
    const p = token.split('.')[1];
    const b = p.replace(/-/g, '+').replace(/_/g, '/').padEnd(p.length + (4 - (p.length % 4)) % 4, '=');
    return JSON.parse(atob(b));
  } catch { return {}; }
}

// Exchange or refresh at Google's OAuth token endpoint. Returns the parsed token payload or throws.
async function googleToken(form: Record<string, string>): Promise<any> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...form }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || data?.error || 'Google token request failed');
  return data;
}

function isoShift(days: number): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
// A CivilDateTime at midnight on an ISO date. Per the v4 discovery doc CivilDateTime nests a Date and
// a TimeOfDay and carries no timezone (times are civil / the user's own local wall clock).
function civilMidnight(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0 } };
}

// Pull daily step totals for [startISO, endISO] (inclusive) via dailyRollUp. Returns date->count map.
async function fetchSteps(accessToken: string, startISO: string, endISO: string): Promise<Record<string, number>> {
  const url = `https://health.googleapis.com/v4/users/me/dataTypes/${STEPS_DATA_TYPE}/dataPoints:dailyRollUp`;
  const body = {
    range: { start: civilMidnight(startISO), end: civilMidnight(isoShift0(endISO, 1)) }, // end is exclusive
    windowSizeDays: 1,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Google Health steps request failed');
  const out: Record<string, number> = {};
  for (const p of (data?.rollupDataPoints || [])) {
    const c = p?.civilStartTime?.date; // { year, month, day }
    if (!c || !c.year) continue;
    const date = c.year + '-' + String(c.month).padStart(2, '0') + '-' + String(c.day).padStart(2, '0');
    // StepsRollupValue.countSum is a string in the REST response.
    const n = Number(p?.steps?.countSum ?? p?.steps?.count_sum ?? p?.steps?.count);
    if (isFinite(n) && n > 0) out[date] = Math.round(n);
  }
  return out;
}
// Local ISO shift (avoids UTC drift from Date for a plain date string).
function isoShift0(iso: string, days: number): string {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

// Minutes between two RFC3339 timestamps, or 0 if either is missing/unparsable.
function minutesBetween(startTs?: string, endTs?: string): number {
  if (!startTs || !endTs) return 0;
  const a = Date.parse(startTs), b = Date.parse(endTs);
  if (!isFinite(a) || !isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 60000);
}
// First value among `keys` on `obj` that is a non-empty array, else []. Used to probe the several field
// names different Google Health sources use for the sleep-stage list.
function firstArray(obj: any, keys: string[]): any[] {
  if (obj == null || typeof obj !== 'object') return [];
  for (const k of keys) { const v = obj[k]; if (Array.isArray(v) && v.length) return v; }
  return [];
}
// Add `min` minutes of a sleep stage to a per-point stage tally. Stage type values vary by source and are
// not fully pinned down, so match tolerantly: the v4 REST enum (AWAKE, LIGHT, DEEP, REM, ASLEEP, RESTLESS),
// prefixed variants (SLEEP_STAGE_TYPE_DEEP, STAGE_DEEP, DEEP_SLEEP, CORE), and Health Connect numeric codes
// (1 AWAKE, 2 SLEEPING, 3 OUT_OF_BED, 4 LIGHT, 5 DEEP, 6 REM). Anything that is sleep but not deep/REM
// (undifferentiated ASLEEP/SLEEPING, RESTLESS, CORE, or plain LIGHT) rolls into the light bucket; unknowns
// are dropped rather than guessed. Ordered so DEEP/REM win before the generic "…SLEEP" catch-all.
function bucketStage(seg: { deep: number; rem: number; light: number; awake: number }, type: unknown, min: number): void {
  if (!min || min <= 0) return;
  const t = String(type == null ? '' : type).toUpperCase();
  if (t === '5' || t.includes('DEEP')) seg.deep += min;
  else if (t === '6' || t.includes('REM')) seg.rem += min;
  else if (t === '1' || t === '3' || t.includes('AWAKE') || t.includes('WAKE') || t.includes('OUT_OF_BED')) seg.awake += min;
  else if (t === '2' || t === '4' || t.includes('LIGHT') || t.includes('CORE') || t.includes('ASLEEP') || t.includes('RESTLESS') || t.includes('SLEEP')) seg.light += min;
}

// Roll one Google Health `sleep` data point up into `out` keyed by its wake date. Per the v4 schema a
// Sleep carries an `interval` (the in-bed period), a `stages` array of SleepStage { startTime, endTime,
// type }, and a `summary` with precomputed minutesAsleep / minutesAwake and a stagesSummary
// [{ type, minutes }]. We prefer the summary's figures, fall back to the stages array, and fall back
// again to the raw interval for a "classic" session that reports no stages at all. Crucially `min` is
// time ASLEEP (not time in bed), so the score reflects real sleep rather than pinning at 100.
function addSleepPoint(out: Record<string, any>, s: any): void {
  const iv = s?.interval || {};
  // Attribute the night to its WAKE date: prefer the civil end date, else the ISO end timestamp.
  const ce = iv?.civilEndTime?.date;
  const date = (ce && ce.year)
    ? ce.year + '-' + String(ce.month).padStart(2, '0') + '-' + String(ce.day).padStart(2, '0')
    : (iv?.endTime ? String(iv.endTime).slice(0, 10) : null);
  if (!date) return;

  const sum = s?.summary || {};
  const seg = { deep: 0, rem: 0, light: 0, awake: 0 };
  // Precomputed per-stage summary [{ type, minutes }] under any plausible key; else the raw stage segment
  // array [{ type, startTime, endTime }]. Sources disagree on field names, so probe several and read the
  // duration as explicit minutes when given, otherwise from the segment's start/end.
  let stageSummary = firstArray(sum, ['stagesSummary', 'sleepStageSummaries', 'stageSummaries']);
  if (!stageSummary.length) stageSummary = firstArray(s, ['stagesSummary', 'stageSummaries']);
  if (stageSummary.length) {
    for (const ss of stageSummary) {
      const m = findNum(ss, ['minutes', 'durationMinutes', 'minutesInStage', 'totalMinutes']);
      bucketStage(seg, ss?.type ?? ss?.stage ?? ss?.stageType ?? ss?.sleepStageType,
        m != null ? Math.round(m) : minutesBetween(ss?.startTime, ss?.endTime));
    }
  } else {
    const segs = firstArray(s, ['stages', 'sleepStages', 'stageSegments', 'segments']);
    for (const st of segs) bucketStage(seg, st?.type ?? st?.stage ?? st?.stageType ?? st?.sleepStageType, minutesBetween(st?.startTime, st?.endTime));
  }

  // Time asleep: the summary's own figure (already excludes awake), else the sleep-stage sum, else the
  // raw in-bed interval when a device reports neither a summary nor stages.
  let asleep = Math.round(findNum(sum, ['minutesAsleep', 'asleepMinutes', 'totalSleepMinutes', 'sleepMinutes', 'sleepDurationMinutes']) || 0);
  if (!asleep) asleep = seg.deep + seg.rem + seg.light;
  if (!asleep) asleep = minutesBetween(iv.startTime, iv.endTime);
  if (!seg.awake) seg.awake = Math.round(findNum(sum, ['minutesAwake', 'awakeMinutes', 'timeAwakeMinutes']) || 0);
  if (asleep <= 0) return;

  const rec: any = out[date] || { min: 0, deep: 0, rem: 0, light: 0, awake: 0 };
  rec.min += asleep;
  rec.deep += seg.deep; rec.rem += seg.rem; rec.light += seg.light; rec.awake += seg.awake;
  out[date] = rec;
}

// Pull sleep sessions whose wake time falls in [startISO, endISO] (inclusive) and roll each up to a
// per-wake-date record { min, deep, rem, light, awake } (stage minutes present only if the device
// reports them). Sleep is a session list-with-filter, NOT dailyRollUp, and pages at 25 per call.
async function fetchSleep(accessToken: string, startISO: string, endISO: string): Promise<Record<string, any>> {
  const filter = `sleep.interval.end_time >= "${startISO}T00:00:00Z" AND sleep.interval.end_time < "${isoShift0(endISO, 1)}T00:00:00Z"`;
  const base = `https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints`;
  const out: Record<string, any> = {};
  let pageToken = '';
  for (let guard = 0; guard < 40; guard++) { // guard: at 25/page this covers well over a year
    const url = `${base}?pageSize=25&filter=${encodeURIComponent(filter)}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + accessToken } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Google Health sleep request failed');
    for (const p of (data?.dataPoints || [])) {
      addSleepPoint(out, p?.sleep || p); // the sleep object may sit under `.sleep` or be the point itself
    }
    pageToken = data?.nextPageToken || '';
    if (!pageToken) break;
  }
  // Drop stage buckets that stayed empty so the client can tell "no stages reported" from "0 minutes".
  for (const d of Object.keys(out)) {
    const r = out[d];
    if (!(r.deep || r.rem || r.light || r.awake)) { delete r.deep; delete r.rem; delete r.light; delete r.awake; }
    if (!(r.min > 0)) delete out[d];
  }
  return out;
}

// Recursively find the first finite number stored under any of `names` anywhere in an object. Daily
// health rollups nest their value under a per-type key we can't be 100% sure of until a live call, so
// we search by the documented field names instead of hard-coding the path.
function findNum(obj: any, names: string[]): number | null {
  if (obj == null || typeof obj !== 'object') return null;
  for (const key of Object.keys(obj)) {
    if (names.includes(key)) { const n = Number(obj[key]); if (isFinite(n)) return n; }
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') { const r = findNum(v, names); if (r != null) return r; }
  }
  return null;
}
// A rollup point's civil date -> 'YYYY-MM-DD', matching fetchSteps.
function rollupDate(p: any): string | null {
  const c = p?.civilStartTime?.date || p?.startTime?.date;
  if (c && c.year) return c.year + '-' + String(c.month).padStart(2, '0') + '-' + String(c.day).padStart(2, '0');
  const ts = p?.civilStartTime?.time ? null : (p?.startTime && typeof p.startTime === 'string' ? p.startTime : null);
  return ts ? ts.slice(0, 10) : null;
}
async function dailyRollup(accessToken: string, dataType: string, startISO: string, endISO: string): Promise<any[]> {
  const url = `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`;
  const body = { range: { start: civilMidnight(startISO), end: civilMidnight(isoShift0(endISO, 1)) }, windowSizeDays: 1 };
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || dataType + ' request failed');
  return data?.rollupDataPoints || data?.dataPoints || [];
}
// A shallow structural sketch of a value: object -> { key: shape }, array -> [shape], leaf -> its TYPE
// (never the value). Used to log what a live Google Health point actually looks like without leaking any
// health data, so we can see the real field names our parser must read.
function shapeOf(obj: any, depth = 3): any {
  if (obj == null) return null;
  if (typeof obj !== 'object') return typeof obj;
  if (Array.isArray(obj)) return obj.length ? ['(' + obj.length + ')', shapeOf(obj[0], depth - 1)] : [];
  if (depth <= 0) return Object.keys(obj);
  const o: Record<string, any> = {};
  for (const k of Object.keys(obj)) o[k] = shapeOf(obj[k], depth - 1);
  return o;
}

// Daily recovery signals for readiness: HRV (RMSSD), resting heart rate, and SpO2, each keyed by date.
// These are "Daily" summary types (health_metrics scope). Every metric is isolated so a missing one or a
// not-yet-granted scope never fails the others, and each logs a diagnostic (HTTP status, point count,
// how many we parsed, and the shape of the first point) so we can see why a metric comes back empty.
async function fetchHealth(accessToken: string, startISO: string, endISO: string): Promise<{ data: Record<string, any>; diag: Record<string, any> }> {
  const out: Record<string, any> = {};
  const diag: Record<string, any> = {};
  const put = (dt: string, k: string, v: number) => { (out[dt] = out[dt] || {})[k] = v; };
  // Pull one daily metric without throwing; extract() reads the numeric value from a rollup point.
  const pull = async (metric: string, dataType: string, extract: (p: any) => number | null) => {
    const url = `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`;
    const body = { range: { start: civilMidnight(startISO), end: civilMidnight(isoShift0(endISO, 1)) }, windowSizeDays: 1 };
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { diag[metric] = { status: res.status, error: String(data?.error?.message || data?.error?.status || '').slice(0, 160) }; return; }
      const pts = data?.rollupDataPoints || data?.dataPoints || [];
      let parsed = 0;
      for (const p of pts) { const dt = rollupDate(p); const v = extract(p); if (dt && v != null && v > 0) { put(dt, metric, v); parsed++; } }
      diag[metric] = { status: 200, points: pts.length, parsed, shape: pts.length ? shapeOf(pts[0]) : null };
    } catch (e) { diag[metric] = { error: String((e as Error)?.message || e).slice(0, 160) }; }
  };
  await pull('hrv', 'daily-heart-rate-variability', (p) => {
    const v = findNum(p, ['rootMeanSquareOfSuccessiveDifferencesMilliseconds', 'rmssdMilliseconds', 'rmssd', 'heartRateVariabilityMillis', 'millis']);
    return v != null ? Math.round(v * 10) / 10 : null;
  });
  await pull('rhr', 'daily-resting-heart-rate', (p) => {
    const avg = findNum(p, ['beatsPerMinute', 'beatsPerMinuteAverage', 'averageBeatsPerMinute', 'bpm', 'restingHeartRateBpm']);
    const mn = findNum(p, ['beatsPerMinuteMin', 'minBeatsPerMinute']), mx = findNum(p, ['beatsPerMinuteMax', 'maxBeatsPerMinute']);
    const v = avg != null ? avg : (mn != null && mx != null ? (mn + mx) / 2 : (mn != null ? mn : mx));
    return v != null ? Math.round(v) : null;
  });
  await pull('spo2', 'daily-oxygen-saturation', (p) => {
    const v = findNum(p, ['averagePercentage', 'average', 'percentage', 'oxygenSaturationPercentage']);
    return v != null ? Math.round(v * 10) / 10 : null;
  });
  // Structure + counts only, never health values (shapeOf records types, not numbers). The caller
  // persists this to last_health_diag so we can see exactly why a metric is empty.
  console.log('[gh-health]', JSON.stringify(diag));
  return { data: out, diag };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ error: { message: 'Google Health is not configured yet. (Server credentials missing.)' } }, 500);
  }

  const auth = req.headers.get('Authorization') || '';
  const userId = decodeJwt(auth.replace(/^Bearer\s+/i, '')).sub;
  if (!userId) return json({ error: { message: 'Not signed in.' } }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: { message: 'Bad request body.' } }, 400); }
  const action = payload?.action;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const table = admin.from('google_health_connections');

  try {
    if (action === 'status') {
      const { data } = await table.select('last_sync').eq('user_id', userId).maybeSingle();
      return json({ connected: !!data, last_sync: data?.last_sync || null });
    }

    if (action === 'disconnect') {
      const { data } = await table.select('refresh_token').eq('user_id', userId).maybeSingle();
      if (data?.refresh_token) {
        try {
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: data.refresh_token }).toString(),
          });
        } catch (_) { /* revoke is best-effort */ }
      }
      await table.delete().eq('user_id', userId);
      return json({ ok: true });
    }

    if (action === 'exchange') {
      const { code, code_verifier, redirect_uri } = payload;
      if (!code || !code_verifier || !redirect_uri) return json({ error: { message: 'Missing OAuth parameters.' } }, 400);
      const tok = await googleToken({
        grant_type: 'authorization_code',
        code: String(code),
        code_verifier: String(code_verifier),
        redirect_uri: String(redirect_uri),
      });
      if (!tok.refresh_token) {
        // No refresh token means access_type=offline / prompt=consent was missing, or the user had
        // already granted before. Without it we can't sync later, so treat as a setup error.
        return json({ error: { message: 'Google did not return a refresh token. Please try connecting again.' } }, 400);
      }
      const nowISO = new Date().toISOString();
      await table.upsert({
        user_id: userId,
        refresh_token: tok.refresh_token,
        scope: tok.scope || null,
        connected_at: nowISO,
        last_sync: nowISO,
      });
      const [steps, sleep, healthRes] = await Promise.all([
        fetchSteps(tok.access_token, isoShift(-SYNC_DAYS_DEFAULT), isoShift(0)).catch(() => ({})), // never fail the connect on a steps hiccup: the token is saved, sync retries
        fetchSleep(tok.access_token, isoShift(-SYNC_DAYS_DEFAULT), isoShift(0)).catch(() => ({})),
        fetchHealth(tok.access_token, isoShift(-SYNC_DAYS_DEFAULT), isoShift(0)).catch((e) => ({ data: {}, diag: { fatal: String((e as Error)?.message || e).slice(0, 160) } })), // health_metrics scope may not be granted yet
      ]);
      await table.update({ last_health_diag: (healthRes as any).diag || null }).eq('user_id', userId);
      return json({ ok: true, steps, sleep, health: (healthRes as any).data || {}, last_sync: nowISO });
    }

    if (action === 'sync') {
      const { data: conn } = await table.select('refresh_token').eq('user_id', userId).maybeSingle();
      if (!conn?.refresh_token) return json({ error: { message: 'Google Health is not connected.' } }, 400);
      let tok: any;
      try {
        tok = await googleToken({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
      } catch (e) {
        // A dead refresh token (revoked, or expired: in Testing mode Google refresh tokens expire
        // after 7 days) means the link is broken. Drop it so the client can prompt a reconnect.
        await table.delete().eq('user_id', userId);
        return json({ error: { type: 'reauth_required', message: 'Google Health link expired, please reconnect.' } }, 401);
      }
      const days = Math.min(Math.max(Number(payload?.days) || SYNC_DAYS_DEFAULT, 1), SYNC_DAYS_MAX);
      const nowISO = new Date().toISOString();
      // Google usually keeps the same refresh token across refreshes; only persist a rotated one.
      const patch: Record<string, unknown> = { last_sync: nowISO };
      if (tok.refresh_token && tok.refresh_token !== conn.refresh_token) patch.refresh_token = tok.refresh_token;
      await table.update(patch).eq('user_id', userId);
      const [steps, sleep, healthRes] = await Promise.all([
        fetchSteps(tok.access_token, isoShift(-days), isoShift(0)).catch(() => ({})), // a steps hiccup must not fail the whole sync
        fetchSleep(tok.access_token, isoShift(-days), isoShift(0)).catch(() => ({})),
        fetchHealth(tok.access_token, isoShift(-days), isoShift(0)).catch((e) => ({ data: {}, diag: { fatal: String((e as Error)?.message || e).slice(0, 160) } })), // tolerate health_metrics scope not granted
      ]);
      await table.update({ last_health_diag: (healthRes as any).diag || null, last_sync: nowISO }).eq('user_id', userId);
      return json({ ok: true, steps, sleep, health: (healthRes as any).data || {}, last_sync: nowISO });
    }

    return json({ error: { message: 'Unknown action.' } }, 400);
  } catch (e) {
    return json({ error: { message: (e as Error).message || 'Google Health request failed.' } }, 502);
  }
});
