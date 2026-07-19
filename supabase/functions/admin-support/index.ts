import { createClient } from 'jsr:@supabase/supabase-js@2';

// Admin-only support ticket triage. Admin status is verified server-side against public.admins
// (the client flag is only a UI convenience). Lets an admin list tickets, change status, and post
// a reply the user sees in-app. Every mutation is written to admin_audit.

const STATUSES = ['received', 'in_review', 'resolved'];
const MAX_REPLY = 4000;
const TICKET_COLS = 'id, user_id, email, kind, body, status, admin_reply, created_at, updated_at';

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
  const audit = (a: string, target?: string | null, meta: Record<string, unknown> = {}) =>
    admin.from('admin_audit').insert({ admin_id: callerId, action: a, target_user_id: target ?? null, meta }).then(() => {}, () => {});

  try {
    switch (action) {
      case 'list_tickets': {
        let q = admin.from('support_tickets').select(TICKET_COLS).order('created_at', { ascending: false }).limit(200);
        if (body?.status && STATUSES.includes(body.status)) q = q.eq('status', body.status);
        const { data, error } = await q;
        if (error) throw error;
        return json({ tickets: data || [] });
      }

      case 'open_count': {
        const { count, error } = await admin.from('support_tickets')
          .select('id', { count: 'exact', head: true }).neq('status', 'resolved');
        if (error) throw error;
        return json({ open: count || 0 });
      }

      case 'set_ticket_status': {
        const id = body?.ticketId;
        const status = body?.status;
        if (!id) return json({ error: { message: 'ticketId required.' } }, 400);
        if (!STATUSES.includes(status)) return json({ error: { message: 'Invalid status.' } }, 400);
        const { data, error } = await admin.from('support_tickets')
          .update({ status, updated_at: new Date().toISOString() }).eq('id', id).select(TICKET_COLS).single();
        if (error) throw error;
        await audit('ticket_status', data.user_id, { ticket_id: id, status });
        return json({ ok: true, ticket: data });
      }

      case 'reply_ticket': {
        const id = body?.ticketId;
        const reply = String(body?.reply ?? '').trim();
        if (!id) return json({ error: { message: 'ticketId required.' } }, 400);
        if (reply.length < 1) return json({ error: { message: 'Reply is empty.' } }, 400);
        if (reply.length > MAX_REPLY) return json({ error: { message: 'Reply is too long.' } }, 400);
        const patch: Record<string, unknown> = { admin_reply: reply, updated_at: new Date().toISOString() };
        // Replying resolves by default; pass resolve:false to leave the status as-is.
        if (body?.resolve !== false) patch.status = 'resolved';
        const { data, error } = await admin.from('support_tickets')
          .update(patch).eq('id', id).select(TICKET_COLS).single();
        if (error) throw error;
        await audit('ticket_reply', data.user_id, { ticket_id: id, status: data.status });
        return json({ ok: true, ticket: data });
      }

      default:
        return json({ error: { message: 'Unknown action.' } }, 400);
    }
  } catch (e) {
    return json({ error: { message: (e as Error).message || 'Admin action failed.' } }, 500);
  }
});
