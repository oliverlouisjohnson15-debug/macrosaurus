import { createClient } from 'jsr:@supabase/supabase-js@2';

// Stripe price ids. Default to the TEST-mode prices; override via env for the live switch.
const PRICE_MONTHLY = Deno.env.get('STRIPE_PRICE_MONTHLY') || 'price_1TuBFpDc0yeeNnCI1nkEEzAx';
const PRICE_ANNUAL  = Deno.env.get('STRIPE_PRICE_ANNUAL')  || 'price_1TuBIjDc0yeeNnCIVpvng7hO';
const TRIAL_DAYS = 7;
const DEFAULT_ORIGIN = 'https://macrosaurus.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js functions.invoke adds x-client-info / x-supabase-api-version, so they must be allowed
  // through the preflight or the browser blocks the request.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
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

// Minimal Stripe REST client: form-encodes params, expanding nested objects to bracket keys.
async function stripe(path: string, key: string, params: Record<string, unknown>) {
  const body = new URLSearchParams();
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'object') { for (const kk in (v as Record<string, unknown>)) add(`${k}[${kk}]`, (v as Record<string, unknown>)[kk]); }
    else body.append(k, String(v));
  };
  for (const k in params) add(k, params[k]);
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe request failed');
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const claims = decodeJwt(token);
  const userId = claims.sub;
  const email = claims.email || '';
  if (!userId) return json({ error: 'Not signed in.' }, 401);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Billing is not configured yet.' }, 500);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* body optional */ }
  const action = payload?.action === 'portal' ? 'portal' : 'checkout';
  const origin = (typeof payload?.origin === 'string' && /^https?:\/\//.test(payload.origin))
    ? payload.origin.replace(/\/$/, '') : DEFAULT_ORIGIN;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Find this user's existing Stripe customer, if any.
  let customerId: string | undefined;
  try {
    const { data } = await admin.from('subscriptions').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
    customerId = data?.stripe_customer_id || undefined;
  } catch { /* best-effort */ }

  try {
    if (action === 'portal') {
      if (!customerId) return json({ error: 'No billing account yet.' }, 400);
      const session = await stripe('billing_portal/sessions', key, {
        customer: customerId,
        return_url: origin + '/?sub=portal',
      });
      return json({ url: session.url });
    }

    // action === 'checkout': reuse or create a customer keyed to the user id.
    if (!customerId) {
      const cust = await stripe('customers', key, { email, metadata: { user_id: userId } });
      customerId = cust.id;
      await admin.from('subscriptions').upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id' });
    }

    const plan = payload?.plan === 'annual' ? 'annual' : 'monthly';
    const price = plan === 'annual' ? PRICE_ANNUAL : PRICE_MONTHLY;

    const session = await stripe('checkout/sessions', key, {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      allow_promotion_codes: true,
      'line_items[0][price]': price,
      'line_items[0][quantity]': 1,
      // The 7-day trial is applied here, not on the price, and the user id is stamped onto the
      // subscription so the webhook can attribute every future event without a lookup.
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { user_id: userId, plan } },
      success_url: origin + '/?sub=success',
      cancel_url: origin + '/?sub=cancel',
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error)?.message || 'Billing request failed.' }, 502);
  }
});
