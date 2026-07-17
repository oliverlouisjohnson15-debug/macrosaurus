import { createClient } from 'jsr:@supabase/supabase-js@2';

// Public endpoint (deployed with verify_jwt=false): Stripe calls it with no user JWT, so we
// authenticate the request by verifying Stripe's signature over the raw body instead.

const enc = new TextEncoder();

async function verifySignature(rawBody: string, sigHeader: string, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = sigHeader.split(',').map((s) => s.split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const v1s = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || v1s.length === 0) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > toleranceSec) return false; // reject replayed/stale events

  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return v1s.some((v) => {
    if (v.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < v.length; i++) diff |= v.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0; // constant-time compare
  });
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('Not configured', { status: 500 });

  const raw = await req.text();
  const ok = await verifySignature(raw, req.headers.get('stripe-signature') || '', secret);
  if (!ok) return new Response('Invalid signature', { status: 400 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const obj = event?.data?.object || {};

  try {
    if (event.type === 'checkout.session.completed') {
      // Capture the user->customer mapping as soon as checkout finishes (before any sub events).
      const userId = obj.client_reference_id || obj.metadata?.user_id;
      if (userId && obj.customer) {
        await admin.from('subscriptions').upsert(
          { user_id: userId, stripe_customer_id: obj.customer },
          { onConflict: 'user_id' },
        );
      }
    } else if (typeof event.type === 'string' && event.type.startsWith('customer.subscription.')) {
      // Every status change (trialing -> active -> past_due -> canceled) arrives here. The user id
      // was stamped onto the subscription metadata at checkout, so no customer lookup is needed.
      const userId = obj.metadata?.user_id;
      if (userId) {
        const price = obj.items?.data?.[0]?.price;
        const row = {
          user_id: userId,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status,
          plan: price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
          price_id: price?.id || null,
          current_period_end: iso(obj.current_period_end),
          trial_end: iso(obj.trial_end),
          cancel_at_period_end: !!obj.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        };
        await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
      }
    }
  } catch (e) {
    // 500 so Stripe retries on a transient database error.
    return new Response('Handler error: ' + ((e as Error)?.message || 'unknown'), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } });
});
