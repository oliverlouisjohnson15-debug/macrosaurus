import { createClient } from 'jsr:@supabase/supabase-js@2';

// Stripe price ids. Default to the TEST-mode prices; override via env for the live switch.
const PRICE_MONTHLY = Deno.env.get('STRIPE_PRICE_MONTHLY') || 'price_1TuBFpDc0yeeNnCI1nkEEzAx';
const PRICE_ANNUAL  = Deno.env.get('STRIPE_PRICE_ANNUAL')  || 'price_1TuBIjDc0yeeNnCIVpvng7hO';
const TRIAL_DAYS = 7;
const DEFAULT_ORIGIN = 'https://macrosaurus.com';

// Black Friday 2026: £19.99 off the first year of annual, so year one is £20. Applied automatically
// to annual checkouts inside the window (no code to type). The coupon is created on first use with a
// fixed id, so there is nothing to set up in the Stripe dashboard. Keep SALE_END in sync with the app.
const SALE_COUPON = 'BLACKFRIDAY2026';
const SALE_END = Date.parse('2026-12-02T00:00:00Z'); // end of Cyber Monday, UK time (GMT)
const SALE_OFF_PENCE = 1999;

// FIRST-YEAR OFFER (PREMIUM_GROWTH_PLAN.md §5): £10 off the first year of annual, so £29.99, for 48
// hours straight after someone's free Premium week ends, and again for 48 hours once they open the
// win-back (30+ days later). Personal and genuinely timed, never a standing sale. Checked here
// against premium_trials, never trusted from the client. Keep OFFER_HOURS in sync with the app.
const OFFER_COUPON = 'FIRSTYEAR2999';
const OFFER_OFF_PENCE = 1000;
const OFFER_HOURS = 48;
function offerOpen(trial: { ends_at?: string | null; winback_at?: string | null } | null, now: number): boolean {
  if (!trial) return false;
  const inWindow = (iso?: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return now >= t && now < t + OFFER_HOURS * 3600e3;
  };
  return inWindow(trial.ends_at) || inWindow(trial.winback_at);
}

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

    // Sale: make sure the coupon exists (idempotent by id), then attach it. Stripe rejects
    // `discounts` together with `allow_promotion_codes`, so the sale session drops the code box.
    let discount: Record<string, unknown> = { allow_promotion_codes: true };
    const onSale = plan === 'annual' && Date.now() < SALE_END;
    let offerCoupon = '';
    if (!onSale && plan === 'annual') {
      try {
        const { data: trial } = await admin.from('premium_trials').select('ends_at, winback_at').eq('user_id', userId).maybeSingle();
        if (offerOpen(trial, Date.now())) offerCoupon = OFFER_COUPON;
      } catch { /* no offer, full price */ }
    }
    if (offerCoupon) {
      try {
        await stripe('coupons', key, { id: OFFER_COUPON, name: 'First year £29.99', amount_off: OFFER_OFF_PENCE, currency: 'gbp', duration: 'once' });
      } catch (e) {
        if (!/already exists/i.test((e as Error)?.message || '')) console.error('offer coupon', e);
      }
      discount = { 'discounts[0][coupon]': OFFER_COUPON };
    }
    if (onSale) {
      try {
        await stripe('coupons', key, {
          id: SALE_COUPON, name: 'Black Friday: first year £20', amount_off: SALE_OFF_PENCE, currency: 'gbp',
          duration: 'once', redeem_by: Math.floor(SALE_END / 1000),
        });
      } catch (e) {
        if (!/already exists/i.test((e as Error)?.message || '')) console.error('sale coupon', e);
      }
      discount = { 'discounts[0][coupon]': SALE_COUPON };
    }

    // The sale is a straight £20 today with no trial; the full-price path keeps the 7-day trial.
    const trialData = { trial_period_days: TRIAL_DAYS, metadata: { user_id: userId, plan } };
    const saleData = { metadata: { user_id: userId, plan, offer: SALE_COUPON } };
    const base = {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      'line_items[0][price]': price,
      'line_items[0][quantity]': 1,
      // The 7-day trial is applied here, not on the price, and the user id is stamped onto the
      // subscription so the webhook can attribute every future event without a lookup.
      // They have just had a free week, so a discounted first year charges today, no second trial.
      subscription_data: onSale ? saleData : offerCoupon ? { metadata: { user_id: userId, plan, offer: OFFER_COUPON } } : trialData,
      success_url: origin + '/?sub=success',
      cancel_url: origin + '/?sub=cancel',
    };
    let session;
    try {
      session = await stripe('checkout/sessions', key, { ...base, ...discount });
    } catch (e) {
      // Never let the sale break checkout: if the discount is refused, sell at full price.
      if (!('discounts[0][coupon]' in discount)) throw e;
      console.error('sale checkout fell back to full price', e);
      session = await stripe('checkout/sessions', key, { ...base, subscription_data: trialData, allow_promotion_codes: true });
    }
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error)?.message || 'Billing request failed.' }, 502);
  }
});
