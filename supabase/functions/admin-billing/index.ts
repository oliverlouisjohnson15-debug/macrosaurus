import { createClient } from 'jsr:@supabase/supabase-js@2';

// Admin billing/tiers control. Admin-only (verified server-side against public.admins). Lets an admin
// read + edit the global tier config (free AI/month, premium ceiling, enforcement toggle) and grant
// or revoke a complimentary Premium subscription for any user. Every change is audited.

const MAX_CAP_USD = 100;
const MAX_FREE_MONTHLY = 100000;
const FALLBACK = { default_cap_usd: 1.0, free_ai_monthly: 10, premium_cap_usd: 3.0, enforce_tiers: false };

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

async function tierConfig(admin: any) {
  const { data } = await admin.from('app_config').select('default_cap_usd, free_ai_monthly, premium_cap_usd, enforce_tiers').eq('id', 1).maybeSingle();
  return {
    default_cap_usd: data && data.default_cap_usd != null ? Number(data.default_cap_usd) : FALLBACK.default_cap_usd,
    free_ai_monthly: data && data.free_ai_monthly != null ? Number(data.free_ai_monthly) : FALLBACK.free_ai_monthly,
    premium_cap_usd: data && data.premium_cap_usd != null ? Number(data.premium_cap_usd) : FALLBACK.premium_cap_usd,
    enforce_tiers: data ? !!data.enforce_tiers : false,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const callerId = decodeJwt(token).sub;
  if (!callerId) return json({ error: { message: 'Not signed in.' } }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: adminRow } = await admin.from('admins').select('user_id').eq('user_id', callerId).maybeSingle();
  if (!adminRow) return json({ error: { message: 'Forbidden.' } }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: { message: 'Bad request.' } }, 400); }
  const action = body?.action;
  const targetId: string | undefined = body?.userId;
  const audit = (a: string, target?: string, meta: Record<string, unknown> = {}) =>
    admin.from('admin_audit').insert({ admin_id: callerId, action: a, target_user_id: target ?? null, meta }).then(() => {}, () => {});

  try {
    switch (action) {
      case 'get_config':
        return json(await tierConfig(admin));

      case 'set_config': {
        const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
        const meta: Record<string, unknown> = {};
        if (body?.defaultCap !== undefined) {
          const c = Number(body.defaultCap);
          if (!isFinite(c) || c < 0 || c > MAX_CAP_USD) return json({ error: { message: 'Default cap must be 0 to ' + MAX_CAP_USD + '.' } }, 400);
          patch.default_cap_usd = c; meta.default_cap_usd = c;
        }
        if (body?.freeAiMonthly !== undefined) {
          const n = Math.round(Number(body.freeAiMonthly));
          if (!isFinite(n) || n < 0 || n > MAX_FREE_MONTHLY) return json({ error: { message: 'Free AI/month must be 0 to ' + MAX_FREE_MONTHLY + '.' } }, 400);
          patch.free_ai_monthly = n; meta.free_ai_monthly = n;
        }
        if (body?.premiumCap !== undefined) {
          const c = Number(body.premiumCap);
          if (!isFinite(c) || c < 0 || c > MAX_CAP_USD) return json({ error: { message: 'Premium ceiling must be 0 to ' + MAX_CAP_USD + '.' } }, 400);
          patch.premium_cap_usd = c; meta.premium_cap_usd = c;
        }
        if (body?.enforceTiers !== undefined) { patch.enforce_tiers = !!body.enforceTiers; meta.enforce_tiers = !!body.enforceTiers; }
        const { error } = await admin.from('app_config').upsert(patch);
        if (error) throw error;
        await audit('set_tier_config', undefined, meta);
        return json(Object.assign({ ok: true }, await tierConfig(admin)));
      }

      // Current subscription status for one user (admins can't read another user's row via RLS).
      case 'get_premium': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { data } = await admin.from('subscriptions').select('status, plan, trial_end, current_period_end, cancel_at_period_end, stripe_subscription_id').eq('user_id', targetId).maybeSingle();
        const premium = data?.status === 'active' || data?.status === 'trialing';
        return json({ subscription: data || null, premium, comp: data?.plan === 'comp' });
      }

      // Grant or revoke a complimentary Premium (no Stripe). A real Stripe sub, if any, is left to the
      // webhook to re-sync; comp grants are marked plan='comp' so they're distinguishable.
      case 'set_premium': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const make = !!body?.premium;
        if (make) {
          const { error } = await admin.from('subscriptions').upsert({
            user_id: targetId, status: 'active', plan: 'comp',
            price_id: null, stripe_subscription_id: null, cancel_at_period_end: false,
            current_period_end: null, trial_end: null, updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
          if (error) throw error;
        } else {
          const { error } = await admin.from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('user_id', targetId);
          if (error) throw error;
        }
        await audit(make ? 'grant_premium' : 'revoke_premium', targetId);
        return json({ ok: true, premium: make });
      }

      default:
        return json({ error: { message: 'Unknown action.' } }, 400);
    }
  } catch (e) {
    return json({ error: { message: (e as Error).message || 'Admin action failed.' } }, 500);
  }
});
