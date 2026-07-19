import { createClient } from 'jsr:@supabase/supabase-js@2';

// ---- Referral / rewards endpoint -------------------------------------------
// Actions (POST { action }):
//   'mine'  -> ensure the caller has a code, return { code, link, referrals_count,
//              bonus_ai_remaining, pending: [{ rid, id, shiny }] }
//   'claim' -> { code }: the caller (a new user) claims a referrer's code. Awards both sides a
//              one-time +BONUS AI-call pool and a rare Macrodex creature. Abuse-guarded: no
//              self-referral, one claim per user, and the referee's account must be recently created.
//   'ack'   -> { ids }: drop pending rewards the client has merged into its Macrodex.
//
// All writes go through SECURITY DEFINER SQL functions run with the service role, so the client can
// never grant itself calls or creatures.

const BONUS_AI = 5;                 // one-time free AI calls granted to each side per referral
const MAX_REFEREE_AGE_DAYS = 45;    // only genuinely-new accounts can be referred (anti-farming)
const APP_ORIGIN = 'https://macrosaurus.com';
// Rare-or-better pool the referral creature is drawn from (mirrors the app's Macrodex ids).
const RARE_POOL = ['flexor', 'veloci', 'platealon', 'triceros', 'rexosaur'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

function decodeJwt(token: string): { sub?: string; email?: string } {
  try {
    const p = token.split('.')[1];
    const b = p.replace(/-/g, '+').replace(/_/g, '/').padEnd(p.length + (4 - (p.length % 4)) % 4, '=');
    return JSON.parse(atob(b));
  } catch { return {}; }
}
// Small deterministic string hash so a user's referral creature is stable across retries.
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function dinoFor(userId: string, salt: string, rid: string) {
  const h = hashStr(userId + '#' + salt);
  const pool = RARE_POOL.slice();
  if (h % 12 === 0) pool.push('aurora'); // a rare mythic flourish
  return { rid, id: pool[h % pool.length], shiny: hashStr(userId + '#shiny#' + salt) % 8 === 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in.' }, 401);
  const claims = decodeJwt(token);
  const userId = claims.sub;
  if (!userId) return json({ error: 'Invalid session.' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const action = body?.action;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  async function loadMine() {
    const { data: code } = await admin.rpc('ensure_referral_code', { p_user: userId });
    const { data: row } = await admin.from('user_rewards')
      .select('bonus_ai_remaining, pending_rewards, referrals_count').eq('user_id', userId).maybeSingle();
    return {
      code,
      link: APP_ORIGIN + '/?ref=' + code,
      referrals_count: Number(row?.referrals_count ?? 0),
      bonus_ai_remaining: Number(row?.bonus_ai_remaining ?? 0),
      pending: Array.isArray(row?.pending_rewards) ? row!.pending_rewards : [],
    };
  }

  if (action === 'mine') {
    return json(await loadMine());
  }

  if (action === 'ack') {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 50) : [];
    if (ids.length) { try { await admin.rpc('ack_pending_rewards', { p_user: userId, p_ids: ids }); } catch (_) { /* non-fatal */ } }
    return json({ ok: true });
  }

  if (action === 'claim') {
    const rawCode = String(body?.code || '').trim().toUpperCase().slice(0, 32);
    if (!rawCode) return json({ error: 'Missing code.' }, 400);

    // Already referred? Treat as success so the client stops retrying.
    const { data: existing } = await admin.from('referrals').select('referee_id').eq('referee_id', userId).maybeSingle();
    if (existing) return json({ ok: true, already: true });

    // Only genuinely-new accounts can be referred.
    try {
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const created = u?.user?.created_at ? new Date(u.user.created_at).getTime() : 0;
      if (created && (Date.now() - created) > MAX_REFEREE_AGE_DAYS * 86400000) {
        return json({ ok: false, reason: 'not_new' });
      }
    } catch (_) { /* if we cannot check, fall through and still guard on self/unique below */ }

    // Resolve the code to a referrer.
    const { data: ref } = await admin.from('user_rewards').select('user_id').eq('referral_code', rawCode).maybeSingle();
    const referrerId = ref?.user_id;
    if (!referrerId) return json({ ok: false, reason: 'invalid_code' });
    if (referrerId === userId) return json({ ok: false, reason: 'self' });

    const refereeDino = dinoFor(userId, 'referee', 'ref:in:' + userId);
    const referrerDino = dinoFor(referrerId, 'referrer:' + userId, 'ref:out:' + userId);
    try {
      await admin.rpc('award_referral', {
        p_referee: userId, p_referrer: referrerId, p_code: rawCode,
        p_referee_dino: refereeDino, p_referrer_dino: referrerDino, p_bonus: BONUS_AI,
      });
    } catch (e) {
      // Unique violation => referee already referred (race). Idempotent success.
      const msg = String((e as any)?.message || e || '');
      if (/duplicate|unique|already/i.test(msg)) return json({ ok: true, already: true });
      if (/self_referral/i.test(msg)) return json({ ok: false, reason: 'self' });
      return json({ error: 'Could not apply referral.' }, 500);
    }
    return json({ ok: true, awarded: true, bonus: BONUS_AI });
  }

  return json({ error: 'Unknown action.' }, 400);
});
