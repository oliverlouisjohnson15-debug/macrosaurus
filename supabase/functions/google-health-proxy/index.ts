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
      const steps = await fetchSteps(tok.access_token, isoShift(-SYNC_DAYS_DEFAULT), isoShift(0));
      return json({ ok: true, steps, last_sync: nowISO });
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
      const steps = await fetchSteps(tok.access_token, isoShift(-days), isoShift(0));
      return json({ ok: true, steps, last_sync: nowISO });
    }

    return json({ error: { message: 'Unknown action.' } }, 400);
  } catch (e) {
    return json({ error: { message: (e as Error).message || 'Google Health request failed.' } }, 502);
  }
});
