import { createClient } from 'jsr:@supabase/supabase-js@2';

// Admin API. Every action is authorised SERVER-SIDE: the caller's JWT is decoded, then we confirm
// they are in public.admins using the service-role key. Non-admins always get 403. The service-role
// key never leaves this function. Sensitive actions are recorded in public.admin_audit.

const FALLBACK_CAP_USD = 1.00;
const MAX_CAP_USD = 100;
const APP_URL = 'https://macrosaurus.vercel.app';

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

const period = () => new Date().toISOString().slice(0, 7);
async function defaultCap(admin: any): Promise<number> {
  const { data } = await admin.from('app_config').select('default_cap_usd').eq('id', 1).maybeSingle();
  return data ? Number(data.default_cap_usd) : FALLBACK_CAP_USD;
}
function isBanned(u: any): boolean {
  const b = u?.banned_until; return !!(b && new Date(b) > new Date());
}
// Resolve a set of user ids to emails (best-effort), for attaching to admin views.
async function emailsFor(admin: any, ids: string[]): Promise<Record<string, string>> {
  const emap: Record<string, string> = {};
  for (const id of Array.from(new Set(ids.filter(Boolean)))) {
    try { const { data: uu } = await admin.auth.admin.getUserById(id); if (uu?.user?.email) emap[id] = uu.user.email; } catch (_) { /* ignore */ }
  }
  return emap;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const claims = decodeJwt(token);
  const callerId = claims.sub;
  if (!callerId) return json({ error: { message: 'Not signed in.' } }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // ---- Authorisation: caller must be an admin ----
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
      case 'list_users': {
        const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) throw error;
        const p = period();
        const [{ data: states }, { data: usages }, { data: limits }, { data: admins }, defCap] = await Promise.all([
          admin.from('user_state').select('user_id, data, updated_at'),
          admin.from('ai_usage').select('user_id, spend_usd, calls').eq('period', p),
          admin.from('user_limits').select('user_id, monthly_cap_usd'),
          admin.from('admins').select('user_id'),
          defaultCap(admin),
        ]);
        const sMap = new Map((states || []).map((r: any) => [r.user_id, r]));
        const uMap = new Map((usages || []).map((r: any) => [r.user_id, r]));
        const lMap = new Map((limits || []).map((r: any) => [r.user_id, r]));
        const aSet = new Set((admins || []).map((r: any) => r.user_id));
        const users = list.users.map((u: any) => {
          const st = sMap.get(u.id); const prof = st?.data?.profile || null;
          return {
            id: u.id, email: u.email,
            created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
            confirmed: !!u.email_confirmed_at, banned: isBanned(u),
            goal: prof?.goalType ?? null, hasProfile: !!prof,
            is_admin: aSet.has(u.id),
            spend_usd: Number(uMap.get(u.id)?.spend_usd ?? 0),
            calls: Number(uMap.get(u.id)?.calls ?? 0),
            cap_usd: lMap.has(u.id) ? Number(lMap.get(u.id).monthly_cap_usd) : defCap,
          };
        });
        return json({ users, period: p, defaultCap: defCap });
      }

      case 'get_user': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { data: u, error } = await admin.auth.admin.getUserById(targetId);
        if (error) throw error;
        const p = period();
        const [{ data: st }, { data: usage }, { data: limit }, { data: adminOf }, { data: notes }, defCap] = await Promise.all([
          admin.from('user_state').select('data, updated_at').eq('user_id', targetId).maybeSingle(),
          admin.from('ai_usage').select('spend_usd, calls').eq('user_id', targetId).eq('period', p).maybeSingle(),
          admin.from('user_limits').select('monthly_cap_usd').eq('user_id', targetId).maybeSingle(),
          admin.from('admins').select('user_id').eq('user_id', targetId).maybeSingle(),
          admin.from('support_notes').select('id, note, author_id, created_at').eq('user_id', targetId).order('created_at', { ascending: false }),
          defaultCap(admin),
        ]);
        await audit('view_user', targetId);
        return json({
          user: { id: u.user.id, email: u.user.email, created_at: u.user.created_at, last_sign_in_at: u.user.last_sign_in_at, confirmed: !!u.user.email_confirmed_at, banned: isBanned(u.user) },
          state: st?.data ?? null, updated_at: st?.updated_at ?? null,
          spend_usd: Number(usage?.spend_usd ?? 0), calls: Number(usage?.calls ?? 0),
          cap_usd: limit ? Number(limit.monthly_cap_usd) : defCap, period: p,
          is_admin: !!adminOf, notes: notes || [],
        });
      }

      case 'get_config': {
        return json({ default_cap_usd: await defaultCap(admin) });
      }
      case 'set_config': {
        const cap = Number(body?.defaultCap);
        if (!isFinite(cap) || cap < 0 || cap > MAX_CAP_USD) return json({ error: { message: 'Default cap must be between 0 and ' + MAX_CAP_USD + '.' } }, 400);
        const { error } = await admin.from('app_config').upsert({ id: 1, default_cap_usd: cap, updated_at: new Date().toISOString() });
        if (error) throw error;
        await audit('set_config', undefined, { default_cap_usd: cap });
        return json({ ok: true, default_cap_usd: cap });
      }

      case 'set_cap': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const cap = Number(body?.cap);
        if (!isFinite(cap) || cap < 0 || cap > MAX_CAP_USD) return json({ error: { message: 'Cap must be between 0 and ' + MAX_CAP_USD + '.' } }, 400);
        const { error } = await admin.from('user_limits').upsert({ user_id: targetId, monthly_cap_usd: cap, updated_at: new Date().toISOString() });
        if (error) throw error;
        await audit('set_cap', targetId, { cap });
        return json({ ok: true, cap_usd: cap });
      }

      case 'set_admin': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const make = !!body?.makeAdmin;
        if (!make && targetId === callerId) return json({ error: { message: "You can't remove your own admin access." } }, 400);
        if (make) { const { error } = await admin.from('admins').upsert({ user_id: targetId }); if (error) throw error; }
        else { const { error } = await admin.from('admins').delete().eq('user_id', targetId); if (error) throw error; }
        await audit(make ? 'grant_admin' : 'revoke_admin', targetId);
        return json({ ok: true, is_admin: make });
      }

      case 'set_ban': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const banned = !!body?.banned;
        if (banned && targetId === callerId) return json({ error: { message: "You can't suspend your own account." } }, 400);
        const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: banned ? '876000h' : 'none' });
        if (error) throw error;
        await audit(banned ? 'suspend_user' : 'unsuspend_user', targetId);
        return json({ ok: true, banned });
      }

      case 'send_recovery': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { data: u } = await admin.auth.admin.getUserById(targetId);
        const em = u?.user?.email;
        if (!em) return json({ error: { message: 'No email on file.' } }, 400);
        const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: em, options: { redirectTo: APP_URL } });
        if (error) throw error;
        await audit('send_recovery', targetId, { email: em });
        return json({ ok: true, action_link: link?.properties?.action_link || null, email: em, note: 'Recovery link generated. If email delivery is configured it was emailed; otherwise copy this link to the user.' });
      }

      case 'set_password': {
        // Directly set a user's password (support flow for people the reset email can't reach, e.g.
        // Hotmail/Outlook scanners consuming one-time links). Admin-only, like every action here.
        // The new password is NEVER written to the audit log.
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const pw = String(body?.password ?? '');
        if (pw.length < 6) return json({ error: { message: 'Password must be at least 6 characters.' } }, 400);
        if (pw.length > 72) return json({ error: { message: 'Password must be 72 characters or fewer.' } }, 400);
        const { error } = await admin.auth.admin.updateUserById(targetId, { password: pw });
        if (error) throw error;
        await audit('set_password', targetId);
        return json({ ok: true, note: 'Password updated.' });
      }

      case 'add_note': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const note = String(body?.note || '').trim();
        if (!note) return json({ error: { message: 'Note is empty.' } }, 400);
        if (note.length > 2000) return json({ error: { message: 'Note too long.' } }, 400);
        const { data, error } = await admin.from('support_notes').insert({ user_id: targetId, author_id: callerId, note }).select('id, note, author_id, created_at').single();
        if (error) throw error;
        await audit('add_note', targetId);
        return json({ ok: true, note: data });
      }
      case 'delete_note': {
        const noteId = body?.noteId;
        if (!noteId) return json({ error: { message: 'noteId required.' } }, 400);
        const { error } = await admin.from('support_notes').delete().eq('id', noteId);
        if (error) throw error;
        await audit('delete_note', targetId);
        return json({ ok: true });
      }

      case 'update_state': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const data = body?.data;
        if (data === null || typeof data !== 'object' || Array.isArray(data)) return json({ error: { message: 'data must be an object.' } }, 400);
        const { error } = await admin.from('user_state').update({ data, updated_at: new Date().toISOString() }).eq('user_id', targetId);
        if (error) throw error;
        await audit('update_state', targetId, { keys: Object.keys(data) });
        return json({ ok: true });
      }

      case 'reset_user': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { error } = await admin.from('user_state').update({ data: {}, updated_at: new Date().toISOString() }).eq('user_id', targetId);
        if (error) throw error;
        await audit('reset_user', targetId);
        return json({ ok: true });
      }

      case 'reset_usage': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { error } = await admin.from('ai_usage').update({ spend_usd: 0, calls: 0, updated_at: new Date().toISOString() }).eq('user_id', targetId).eq('period', period());
        if (error) throw error;
        await audit('reset_usage', targetId);
        return json({ ok: true });
      }

      case 'delete_user': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { data: u } = await admin.auth.admin.getUserById(targetId);
        const { error } = await admin.auth.admin.deleteUser(targetId);
        if (error) throw error;
        await audit('delete_user', targetId, { email: u?.user?.email ?? null });
        return json({ ok: true });
      }

      case 'resend_confirmation': {
        if (!targetId) return json({ error: { message: 'userId required.' } }, 400);
        const { data: u } = await admin.auth.admin.getUserById(targetId);
        const em = u?.user?.email;
        if (!em) return json({ error: { message: 'No email on file.' } }, 400);
        const { error } = await admin.auth.admin.generateLink({ type: 'signup', email: em });
        if (error) throw error;
        await audit('resend_confirmation', targetId, { email: em });
        return json({ ok: true, note: 'A fresh confirmation link was generated (delivery depends on your email/SMTP setup).' });
      }

      case 'list_audit': {
        const { data, error } = await admin.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        const ids = Array.from(new Set((data || []).flatMap((r: any) => [r.admin_id, r.target_user_id]).filter(Boolean)));
        const emap = await emailsFor(admin, ids as string[]);
        const rows = (data || []).map((r: any) => ({ ...r, admin_email: emap[r.admin_id] || null, target_email: r.target_user_id ? (emap[r.target_user_id] || null) : null }));
        return json({ audit: rows });
      }

      // ---- AI request logs (prompt/image/result vetting) ----
      // list_ai_logs returns lightweight metadata only (NO images) so the list stays fast; the
      // image data URIs are only fetched by get_ai_log for a single row.
      case 'list_ai_logs': {
        const feat = body?.feature;
        const lim = Math.min(Number(body?.limit) || 60, 200);
        let q = admin.from('ai_logs')
          .select('id, user_id, created_at, feature, model, image_count, input_tokens, output_tokens, cost_usd, status')
          .order('created_at', { ascending: false })
          .limit(lim);
        if (targetId) q = q.eq('user_id', targetId);
        if (feat && feat !== 'all') q = q.eq('feature', feat);
        const { data, error } = await q;
        if (error) throw error;
        const emap = await emailsFor(admin, (data || []).map((r: any) => r.user_id));
        const logs = (data || []).map((r: any) => ({ ...r, email: emap[r.user_id] || null }));
        await audit('view_ai_logs', targetId, { feature: feat ?? 'all', count: logs.length });
        return json({ logs });
      }

      case 'get_ai_log': {
        const logId = body?.logId;
        if (!logId) return json({ error: { message: 'logId required.' } }, 400);
        const { data, error } = await admin.from('ai_logs').select('*').eq('id', logId).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: { message: 'Log not found (it may have been purged).' } }, 404);
        const emap = await emailsFor(admin, [data.user_id]);
        await audit('view_ai_log', data.user_id, { logId });
        return json({ log: { ...data, email: emap[data.user_id] || null } });
      }

      case 'clear_ai_logs': {
        // Clear every log, or just one user's when userId is provided.
        let q = admin.from('ai_logs').delete();
        q = targetId ? q.eq('user_id', targetId) : q.gte('created_at', '1970-01-01');
        const { error } = await q;
        if (error) throw error;
        await audit('clear_ai_logs', targetId);
        return json({ ok: true });
      }

      default:
        return json({ error: { message: 'Unknown action.' } }, 400);
    }
  } catch (e) {
    return json({ error: { message: (e as Error).message || 'Admin action failed.' } }, 500);
  }
});
