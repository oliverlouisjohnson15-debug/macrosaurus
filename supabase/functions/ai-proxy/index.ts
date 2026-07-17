import { createClient } from 'jsr:@supabase/supabase-js@2';

// ---- Config ----------------------------------------------------------------
const OWNER_EMAIL = 'oliverlouisjohnson15@gmail.com'; // exempt from caps/tiers (NOT from usage tracking)
const FALLBACK_CAP_USD = 1.00;                        // legacy cap if app_config is unavailable
const FALLBACK_FREE_MONTHLY = 10;                     // free AI actions/month if config unavailable
const FALLBACK_PREMIUM_CAP_USD = 3.00;                // premium fair-use ceiling if config unavailable
const MAX_TOKENS_CEILING = 4096;                      // bound worst-case cost per call

// Price per token (USD). Update if Anthropic pricing changes.
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5':            { in: 3 / 1e6,  out: 15 / 1e6 },
  'claude-haiku-4-5-20251001': { in: 1 / 1e6,  out: 5  / 1e6 },
};
const ALLOWED_MODELS = Object.keys(PRICES);

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

// ---- AI request logging (admin vetting) ------------------------------------
function extractPromptAndImages(messages: any[], system?: unknown): { prompt: string; images: string[] } {
  const promptParts: string[] = [];
  const images: string[] = [];
  if (typeof system === 'string' && system) promptParts.push(system);
  for (const m of (messages || [])) {
    const c = m?.content;
    if (typeof c === 'string') { promptParts.push(c); continue; }
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b?.type === 'text' && typeof b.text === 'string') promptParts.push(b.text);
        else if (b?.type === 'image' && b?.source?.type === 'base64' && b.source.data) {
          images.push('data:' + (b.source.media_type || 'image/jpeg') + ';base64,' + b.source.data);
        }
      }
    }
  }
  return { prompt: promptParts.join('\n\n'), images };
}
// Classify the call from its prompt signature. 'bodyfat' is detected both to REFUSE to log it
// (it contains photos of the user's body) and to gate it as a Premium-only feature.
function featureOf(prompt: string): string {
  const p = prompt || '';
  if (p.includes('body-fat estimate') || p.includes('You are a physique coach')) return 'bodyfat';
  if (p.includes('Read this nutrition label')) return 'label';
  if (p.includes('BRUTALLY HONEST UK nutrition estimator')) return 'meal';
  if (p.includes('You are Macrosaurus')) return 'coach';
  return 'other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: { message: 'Not signed in.' } }, 401);
  const claims = decodeJwt(token);
  const userId = claims.sub;
  const email = (claims.email || '').toLowerCase();
  if (!userId) return json({ error: { message: 'Invalid session.' } }, 401);

  const anthKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthKey) return json({ error: { message: 'AI is not configured yet. (Server key missing.)' } }, 500);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const isOwner = email === OWNER_EMAIL;
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)

  // Parse + validate the request first (we need the feature to gate body-fat before spending).
  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: { message: 'Bad request body.' } }, 400); }
  const model = payload?.model;
  if (!ALLOWED_MODELS.includes(model)) return json({ error: { message: 'Unsupported model.' } }, 400);
  const maxTokens = Math.min(Number(payload?.max_tokens) || 1024, MAX_TOKENS_CEILING);
  const messages = payload?.messages;
  if (!Array.isArray(messages)) return json({ error: { message: 'Missing messages.' } }, 400);
  const system = (typeof payload?.system === 'string' && payload.system) ? payload.system : undefined;

  const { prompt, images } = extractPromptAndImages(messages, system);
  const feature = featureOf(prompt);

  // ---- Access control: free tier (count) vs premium (fair-use ceiling) -------
  // Owner is exempt. Until enforce_tiers is turned on, the legacy USD cap applies unchanged.
  if (!isOwner) {
    const [{ data: usage }, { data: limit }, { data: cfg }, { data: sub }] = await Promise.all([
      admin.from('ai_usage').select('spend_usd, calls').eq('user_id', userId).eq('period', period).maybeSingle(),
      admin.from('user_limits').select('monthly_cap_usd').eq('user_id', userId).maybeSingle(),
      admin.from('app_config').select('default_cap_usd, free_ai_monthly, premium_cap_usd, enforce_tiers').eq('id', 1).maybeSingle(),
      admin.from('subscriptions').select('status').eq('user_id', userId).maybeSingle(),
    ]);
    const spent = Number(usage?.spend_usd ?? 0);
    const calls = Number(usage?.calls ?? 0);
    const override = limit ? Number(limit.monthly_cap_usd) : null;
    const isPremium = !!sub && (sub.status === 'active' || sub.status === 'trialing');

    if (cfg?.enforce_tiers) {
      if (isPremium) {
        const cap = override ?? Number(cfg?.premium_cap_usd ?? FALLBACK_PREMIUM_CAP_USD);
        if (spent >= cap) {
          return json({ error: {
            type: 'budget_exceeded',
            message: "You've reached this month's fair-use ceiling for AI. It resets on the 1st.",
          } }, 429);
        }
      } else {
        if (feature === 'bodyfat') {
          return json({ error: {
            type: 'premium_required', feature: 'bodyfat',
            message: 'Body-fat photo scans are a Premium feature.',
          } }, 402);
        }
        const freeLimit = Number(cfg?.free_ai_monthly ?? FALLBACK_FREE_MONTHLY);
        if (calls >= freeLimit) {
          return json({ error: {
            type: 'free_limit', limit: freeLimit,
            message: `You've used your ${freeLimit} free AI logs this month. Upgrade to Premium for unlimited AI.`,
          } }, 402);
        }
      }
    } else {
      // Legacy behaviour (tiering not yet live): a single monthly USD cap.
      const globalDefault = cfg ? Number(cfg.default_cap_usd) : FALLBACK_CAP_USD;
      const cap = override ?? globalDefault;
      if (spent >= cap) {
        return json({ error: {
          type: 'budget_exceeded',
          message: "You've used up this month's AI allowance. It resets on the 1st of next month.",
        } }, 429);
      }
    }
  }

  const anthBody: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
  if (system) anthBody.system = system;

  // Forward to Anthropic with the SERVER key.
  let aRes: Response;
  try {
    aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(anthBody),
    });
  } catch (e) {
    return json({ error: { message: 'Upstream AI request failed: ' + (e as Error).message } }, 502);
  }

  const data = await aRes.json();

  // Record real cost + call count from token usage for EVERYONE, owner included.
  let cost = 0;
  if (aRes.ok && data?.usage) {
    const price = PRICES[model];
    cost = (Number(data.usage.input_tokens) || 0) * price.in
         + (Number(data.usage.output_tokens) || 0) * price.out;
    // add_ai_usage bumps both spend_usd and the monthly call count (used for the free-tier gate).
    try { await admin.rpc('add_ai_usage', { p_user: userId, p_period: period, p_cost: cost }); } catch (_) { /* non-fatal */ }
    if (cost > 0) {
      try { await admin.rpc('add_ai_usage_model', { p_user: userId, p_period: period, p_model: model, p_cost: cost }); } catch (_) { /* non-fatal */ }
    }
  }

  // Log the call for admin vetting/tuning. Best-effort, off the response path. Body-fat is NEVER
  // logged (photos of the user's body). Auto-purged after 30 days.
  try {
    if (feature !== 'bodyfat') {
      const resultText = (aRes.ok && Array.isArray(data?.content))
        ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
        : JSON.stringify(data ?? {}).slice(0, 20000);
      const row = {
        user_id: userId,
        feature,
        model,
        prompt: String(prompt || '').slice(0, 20000),
        result: String(resultText || '').slice(0, 20000),
        input_tokens: Number(data?.usage?.input_tokens) || null,
        output_tokens: Number(data?.usage?.output_tokens) || null,
        cost_usd: cost || null,
        image_count: images.length,
        images: images.slice(0, 6),
        status: aRes.ok ? 'ok' : 'error',
      };
      const p = admin.from('ai_logs').insert(row).then(() => {}, () => {});
      // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    }
  } catch (_) { /* logging must never affect the response */ }

  return json(data, aRes.status);
});
