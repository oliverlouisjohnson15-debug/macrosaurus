import { createClient } from 'jsr:@supabase/supabase-js@2';

// ---- Config ----------------------------------------------------------------
const OWNER_EMAIL = 'oliverlouisjohnson15@gmail.com'; // exempt from caps/tiers (NOT from usage tracking)
const FALLBACK_CAP_USD = 1.00;                        // legacy cap if app_config is unavailable
const FALLBACK_FREE_MONTHLY = 10;                     // free AI actions/month if config unavailable
const FALLBACK_PREMIUM_CAP_USD = 3.00;                // premium fair-use ceiling if config unavailable
const MAX_TOKENS_CEILING = 4096;                      // bound worst-case cost per call
const MAX_TOOLS = 16;                                 // the buddy's tool belt, with room to grow
const MAX_TOOLS_BYTES = 20000;                        // bound the definitions a client can send

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
        // Tool-loop turns carry the model's requests and the client's answers as their own block
        // types. Rendered compactly rather than skipped, because on a later hop they are most of
        // what happened, and an ai_logs row that shows only the system prompt tells a vetter
        // nothing about the turn it is meant to explain.
        else if (b?.type === 'tool_use' && typeof b.name === 'string') {
          promptParts.push('[tool_use ' + b.name + '] ' + JSON.stringify(b.input ?? {}).slice(0, 2000));
        } else if (b?.type === 'tool_result') {
          const rc = b.content;
          const flat = typeof rc === 'string' ? rc
            : Array.isArray(rc) ? rc.filter((x: any) => x?.type === 'text').map((x: any) => x.text).join(' ')
            : '';
          promptParts.push('[tool_result' + (b.is_error ? ' error' : '') + '] ' + String(flat).slice(0, 2000));
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
  // Matches the substring shared by the current AI_PROMPT and the older "BRUTALLY HONEST UK nutrition
  // estimator" wording, so clients still running a cached bundle keep billing as 'meal' rather than
  // silently falling through to 'other'. Signature must stay in step with AI_PROMPT in app/src/prompts.jsx.
  if (p.includes('UK nutrition estimator')) return 'meal';
  // Reading a menu and proposing three things to order. Deliberately NOT gated to Premium below: it
  // spends from the free monthly allowance like a meal estimate, because it is part of logging a
  // meal rather than a feature beside it. Classified so its spend is attributable in ai_logs, since
  // it carries menu photographs and is the most expensive food call we make.
  // Signature must stay in step with MENU_IDEAS_PROMPT in app/src/prompts.jsx.
  if (p.includes('helping someone choose what to order')) return 'ideas';
  // The buddy conversation. Classified so its spend is attributable per feature in ai_logs, and so
  // the tool-loop hops of one turn all land under the same label. It is NOT Premium-gated (see the
  // access-control block below) - it spends from the free monthly allowance like a meal estimate.
  // Signature must stay in step with buddyChatReply()'s system prompt in app/src/app.jsx.
  if (p.includes('You are Macrosaurus, speaking as')) return 'chat';
  // Free-text "what's coming up" parsing at check-in. Open-ended user text like the chat, so it is
  // gated to Premium rather than spendable from the free monthly allowance. Signature must stay in
  // step with aiParseWeekPlan() in app/src/app.jsx.
  if (p.includes('You turn a sentence about someone\'s week into JSON')) return 'weekplan';
  // Training. All three are Premium: reading someone else's plan out of a video or a PDF, judging a
  // volume audit, and writing up a finished block are the paid half of the training feature (logging
  // and building a block by hand are free and never come through here). Signatures must stay in step
  // with WORKOUT_PROMPT / COVERAGE_PROMPT / BLOCK_REVIEW_PROMPT in app/src/prompts.jsx.
  if (p.includes('You are a strength coach reading someone else')) return 'workout_import';
  // The tweak pass that corrects an import from the person's own notes. Same feature and same gate as
  // the read itself: it is the second half of importing a plan, not a thing of its own.
  if (p.includes('You are a strength coach correcting a training plan')) return 'workout_import';
  if (p.includes('You are a strength coach looking at a volume audit')) return 'coverage_advice';
  if (p.includes('You are a strength coach writing up a finished')) return 'block_review';
  if (p.includes('You are Macrosaurus')) return 'coach';
  // Food-quality nutrient estimates (single food and the day's batch). Classified for two reasons:
  // to gate them as Premium here rather than trusting the client flag, and so their spend is
  // attributable per feature in ai_logs instead of disappearing into 'other'.
  // Signatures must stay in step with aiEstimateNutrients/aiEstimateNutrientsBatch in app/src/app.jsx.
  if (p.includes('estimate the SATURATED FAT, TOTAL SUGARS and SALT')) return 'density';
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
  // Thinking mode. Sonnet 5 thinks by default and spends the thinking on the same max_tokens budget
  // as the answer, so the client sends an explicit config to keep the budget for the JSON. Only the
  // two shapes we use are passed on; anything else is dropped rather than forwarded to Anthropic.
  const t = payload?.thinking;
  const thinking = (t && (t.type === 'disabled' || t.type === 'adaptive')) ? t : undefined;
  // Tools. The buddy conversation is a client-executed tool loop: the model asks for a tool, the
  // CLIENT runs it against local state (the diary lives on the device, not here) and sends the
  // result back. So this only has to carry the definitions through and let tool_result blocks ride
  // in `messages`, which are already forwarded verbatim. Bounded on count and serialized size so a
  // modified client cannot inflate the prompt it is billed for; anything malformed is dropped
  // rather than forwarded, matching how `thinking` is handled above.
  const rawTools = payload?.tools;
  const tools = (Array.isArray(rawTools) && rawTools.length > 0 && rawTools.length <= MAX_TOOLS
    && JSON.stringify(rawTools).length <= MAX_TOOLS_BYTES) ? rawTools : undefined;
  const tc = payload?.tool_choice;
  const toolChoice = (tools && tc && typeof tc === 'object' && typeof tc.type === 'string') ? tc : undefined;
  // Which hop of a multi-step turn this is. One USER TURN is one AI action however many times the
  // model goes round the tool loop, so only hop 0 increments the monthly call count. Spend is
  // always recorded truthfully, on every hop (see the accounting below).
  const hop = Math.max(0, Math.floor(Number(payload?.hop) || 0));

  const { prompt, images } = extractPromptAndImages(messages, system);
  const feature = featureOf(prompt);

  // ---- Access control: free tier (count) vs premium (fair-use ceiling) -------
  // Owner is exempt. Until enforce_tiers is turned on, the legacy USD cap applies unchanged.
  // usedBonus: set when a free user spends one of their one-time referral bonus calls (drawn only
  // AFTER the monthly free allowance is exhausted), so we can decrement the pool after a good call.
  let usedBonus = false;
  if (!isOwner) {
    const [{ data: usage }, { data: limit }, { data: cfg }, { data: sub }, { data: rewards }] = await Promise.all([
      admin.from('ai_usage').select('spend_usd, calls').eq('user_id', userId).eq('period', period).maybeSingle(),
      admin.from('user_limits').select('monthly_cap_usd').eq('user_id', userId).maybeSingle(),
      admin.from('app_config').select('default_cap_usd, free_ai_monthly, premium_cap_usd, enforce_tiers').eq('id', 1).maybeSingle(),
      admin.from('subscriptions').select('status').eq('user_id', userId).maybeSingle(),
      admin.from('user_rewards').select('bonus_ai_remaining').eq('user_id', userId).maybeSingle(),
    ]);
    const bonusPool = Number(rewards?.bonus_ai_remaining ?? 0);
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
        // Chat is NOT Premium-only any more. It was, back when it was a curiosity buried in the Play
        // hub; it is now the way you talk to the buddy on Today, and a locked front door is a bad
        // first run for a free account. So it falls through to the free monthly allowance below and
        // spends from the same pool as every other AI action, one per user turn. Body-fat, quality,
        // week-planning and the training features stay Premium: those are the paid half.
        if (feature === 'weekplan') {
          return json({ error: {
            type: 'premium_required', feature: 'weekplan',
            message: 'Describing your week in your own words is a Premium feature.',
          } }, 402);
        }
        // Training. Logging sessions and building a block by hand never reach this proxy, so a free
        // account keeps a full workout tracker. What is gated is the thinking: reading a plan out of
        // a video or a PDF, judging a volume audit, and writing up a block. The client gates these
        // too, but only for a clean paywall hand-off; this is the real gate.
        if (feature === 'workout_import') {
          return json({ error: {
            type: 'premium_required', feature: 'workout_import',
            message: 'Importing a workout from a video, PDF or spreadsheet is a Premium feature.',
          } }, 402);
        }
        if (feature === 'coverage_advice') {
          return json({ error: {
            type: 'premium_required', feature: 'coverage_advice',
            message: 'Reading your volume gaps and saying what to change is a Premium feature.',
          } }, 402);
        }
        if (feature === 'block_review') {
          return json({ error: {
            type: 'premium_required', feature: 'block_review',
            message: 'The end-of-block write-up is a Premium feature.',
          } }, 402);
        }
        // Food quality is Premium, and the client flag that hides it (window.MISPREMIUM) is only a
        // display decision. Without this a free account could spend its free monthly allowance on
        // nutrient estimates for a score it is never shown, which costs money and helps nobody.
        if (feature === 'density') {
          return json({ error: {
            type: 'quality', feature: 'density',
            message: 'Food quality scoring is a Premium feature.',
          } }, 402);
        }
        const freeLimit = Number(cfg?.free_ai_monthly ?? FALLBACK_FREE_MONTHLY);
        if (calls >= freeLimit) {
          // Monthly free allowance spent: fall back to the one-time referral bonus pool if any.
          if (bonusPool > 0) {
            usedBonus = true;
          } else {
            return json({ error: {
              type: 'free_limit', limit: freeLimit,
              message: `You've used your ${freeLimit} free AI logs this month. Upgrade to Premium for unlimited AI.`,
            } }, 402);
          }
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
  if (tools) anthBody.tools = tools;
  if (toolChoice) anthBody.tool_choice = toolChoice;
  if (system) anthBody.system = system;
  if (thinking) anthBody.thinking = thinking;
  /* STREAMING. The app is output-bound - a menu read generates a couple of thousand tokens one at a
     time - so the wait is real and no amount of prompt trimming removes it entirely. What CAN be
     removed is the part where the person sits in front of a hopping dinosaur with no evidence that
     anything is happening, and then everything appears at once. Streamed, the first dish lands in a
     few seconds and the rest fill in behind it.

     Every gate above still runs first and unchanged: signed in, model allowed, tier and fair-use
     checked. Streaming only changes how the answer comes BACK. */
  const wantsStream = payload?.stream === true;
  if (wantsStream) anthBody.stream = true;

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

  /* A streamed reply is handed straight back to the browser as it arrives, while a tee watches it go
     past. The accounting is the reason for the tee: usage arrives INSIDE the stream (input tokens in
     message_start, output tokens in message_delta), so without reading it we would bill nothing and
     log nothing, and the fair-use ceiling would quietly stop meaning anything. Nothing is buffered -
     each chunk is forwarded first and inspected second - so the tee costs the person no latency,
     which was the entire point of streaming in the first place. */
  if (wantsStream && aRes.ok && aRes.body) {
    let acc = '', sseBuf = '', inTok = 0, outTok = 0;
    const dec = new TextDecoder();
    const settle = async () => {
      const price = PRICES[model];
      const c = inTok * price.in + outTok * price.out;
      try {
        if (hop === 0) await admin.rpc('add_ai_usage', { p_user: userId, p_period: period, p_cost: c });
        else await admin.rpc('add_ai_spend', { p_user: userId, p_period: period, p_cost: c });
        if (c > 0) await admin.rpc('add_ai_usage_model', { p_user: userId, p_period: period, p_model: model, p_cost: c });
        if (usedBonus) await admin.rpc('consume_referral_bonus', { p_user: userId });
      } catch (_) { /* non-fatal */ }
      try {
        if (feature !== 'bodyfat') {
          await admin.from('ai_logs').insert({
            user_id: userId, feature, model,
            prompt: String(prompt || '').slice(0, 20000),
            result: String(acc || '').slice(0, 20000),
            input_tokens: inTok || null, output_tokens: outTok || null, cost_usd: c || null,
            image_count: images.length, images: images.slice(0, 6),
            status: acc ? 'ok' : 'error',
          });
        }
      } catch (_) { /* logging must never affect the response */ }
    };
    const tee = new TransformStream({
      transform(chunk, ctl) {
        ctl.enqueue(chunk);                       // forward FIRST, always
        sseBuf += dec.decode(chunk, { stream: true });
        const lines = sseBuf.split('\n');
        sseBuf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === 'message_start') inTok = Number(ev.message?.usage?.input_tokens) || 0;
          else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') acc += ev.delta.text || '';
          else if (ev.type === 'message_delta') outTok = Number(ev.usage?.output_tokens) || outTok;
        }
      },
      flush() {
        // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(settle());
        else settle();
      },
    });
    return new Response(aRes.body.pipeThrough(tee), {
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' },
    });
  }

  const data = await aRes.json();

  // Record real cost + call count from token usage for EVERYONE, owner included.
  let cost = 0;
  if (aRes.ok && data?.usage) {
    const price = PRICES[model];
    cost = (Number(data.usage.input_tokens) || 0) * price.in
         + (Number(data.usage.output_tokens) || 0) * price.out;
    // add_ai_usage bumps both spend_usd and the monthly call count (used for the free-tier gate).
    // A tool-loop turn is several requests - the model asks for a tool, the client answers, the
    // model replies - and charging the free allowance per REQUEST would burn a 10-a-month budget
    // three times faster than the meter beside it says. So the call count moves once per user turn
    // (hop 0) and later hops record spend only, which keeps the Premium fair-use ceiling honest
    // without lying to a free user about what they have left.
    try {
      if (hop === 0) await admin.rpc('add_ai_usage', { p_user: userId, p_period: period, p_cost: cost });
      else await admin.rpc('add_ai_spend', { p_user: userId, p_period: period, p_cost: cost });
    } catch (_) { /* non-fatal */ }
    if (cost > 0) {
      try { await admin.rpc('add_ai_usage_model', { p_user: userId, p_period: period, p_model: model, p_cost: cost }); } catch (_) { /* non-fatal */ }
    }
    // This served call came out of the one-time referral bonus pool: consume one.
    if (usedBonus) { try { await admin.rpc('consume_referral_bonus', { p_user: userId }); } catch (_) { /* non-fatal */ } }
  }

  // Log the call for admin vetting/tuning. Best-effort, off the response path. Body-fat is NEVER
  // logged (photos of the user's body). Auto-purged after 30 days.
  try {
    if (feature !== 'bodyfat') {
      const textOut = (aRes.ok && Array.isArray(data?.content))
        ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
        : '';
      // A tool-loop hop legitimately answers with tool_use blocks and NO text: the model is asking
      // the client to go and do something, not talking. That is a successful turn, so it must not
      // be filed as an error the way a genuinely empty 200 is.
      const askedForTool = aRes.ok && Array.isArray(data?.content)
        && data.content.some((b: any) => b?.type === 'tool_use');
      // A 200 carrying no text is a failure for the client (it has nothing to parse) but used to be
      // logged as a blank 'ok' row, which hid the cause. Log the raw payload and flag it, so
      // stop_reason and the block types are there to read.
      const resultText = textOut || JSON.stringify(data ?? {}).slice(0, 20000);
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
        status: (aRes.ok && (textOut || askedForTool)) ? 'ok' : 'error',
      };
      const p = admin.from('ai_logs').insert(row).then(() => {}, () => {});
      // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    }
  } catch (_) { /* logging must never affect the response */ }

  return json(data, aRes.status);
});
