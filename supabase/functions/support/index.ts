import { createClient } from 'jsr:@supabase/supabase-js@2';

// User-facing support endpoint. A signed-in user submits a bug report, feature request or
// question; we store it in public.support_tickets (service role, since the table has no client
// write policy) and email a notification to the developer. Email failures NEVER block the ticket
// from being saved - the in-app "Your requests" list is the source of truth.

const NOTIFY_TO = 'olly@macrosaurus.com';
const NOTIFY_FROM = 'Macrosaurus <noreply@macrosaurus.com>'; // reuses the verified Resend sender
const KINDS = ['bug', 'feature', 'question'];
const KIND_LABEL: Record<string, string> = { bug: 'Bug', feature: 'Feature request', question: 'Question' };
const MAX_BODY = 4000;

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

// Fire the notification email via the existing Resend account. Fail-open: log and move on.
async function notify(kind: string, body: string, email: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) { console.error('support: RESEND_API_KEY not set - skipping notification email'); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: NOTIFY_TO,
        reply_to: email || undefined, // reply straight to the user from your inbox
        subject: `[${KIND_LABEL[kind] || kind}] new ticket from ${email || 'a user'}`,
        text: `${KIND_LABEL[kind] || kind} from ${email || 'unknown user'}\n\n${body}\n\n- Macrosaurus support`,
      }),
    });
    if (!res.ok) console.error('support: resend failed', res.status, await res.text());
  } catch (e) {
    console.error('support: resend error', (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const claims = decodeJwt(token);
  const userId = claims.sub;
  if (!userId) return json({ error: { message: 'Please sign in to send feedback.' } }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: { message: 'Bad request.' } }, 400); }

  const kind = String(payload?.kind || '');
  const body = String(payload?.body ?? '').trim();
  if (!KINDS.includes(kind)) return json({ error: { message: 'Pick a valid type.' } }, 400);
  if (body.length < 1) return json({ error: { message: 'Please add a message.' } }, 400);
  if (body.length > MAX_BODY) return json({ error: { message: 'Message is too long (max 4000 characters).' } }, 400);

  const email = (claims.email || '').toLowerCase();
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin.from('support_tickets')
    .insert({ user_id: userId, email, kind, body })
    .select('id, kind, body, status, admin_reply, created_at, updated_at')
    .single();
  if (error) return json({ error: { message: error.message || 'Could not save your message.' } }, 500);

  await notify(kind, body, email);

  return json({ ok: true, ticket: data });
});
