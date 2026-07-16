// nutrition-analyze - turn a list of human-readable ingredient lines ("150 g cottage cheese",
// "1 tbsp olive oil") into per-ingredient + total macros, via Edamam's Nutrition Analysis API.
// Edamam parses the quantity/unit itself, so this is far more reliable than searching a database by
// name. The Edamam credentials live in this function's secrets (EDAMAM_APP_ID / EDAMAM_APP_KEY), never
// in the browser. verify_jwt is enabled so only signed-in users reach it. If the credentials are not
// configured, or Edamam errors, it returns ok:false and the client falls back to its AI estimate, so
// recipes always get numbers. Contract:
//   POST { title?, ingredients: string[] } ->
//     { ok, total:{kcal,protein,carbs,fat,fiber}, weight, per_ingredient:[{line, ok, macros}] , note? }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

// Map Edamam's nutrient block to our compact shape.
function macrosOf(nutrients: any) {
  const g = (k: string) => Math.round(((nutrients && nutrients[k] && nutrients[k].quantity) || 0) * 10) / 10;
  return {
    kcal: Math.round((nutrients && nutrients.ENERC_KCAL && nutrients.ENERC_KCAL.quantity) || 0),
    protein: g('PROCNT'), carbs: g('CHOCDF'), fat: g('FAT'), fiber: g('FIBTG'),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, note: 'Method not allowed' }, 405);

  const appId = Deno.env.get('EDAMAM_APP_ID');
  const appKey = Deno.env.get('EDAMAM_APP_KEY');
  if (!appId || !appKey) return json({ ok: false, note: 'Nutrition service not configured yet.' });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, note: 'Bad request body.' }, 400); }
  const lines = (Array.isArray(body?.ingredients) ? body.ingredients : []).map((s: unknown) => String(s || '').trim()).filter(Boolean).slice(0, 60);
  if (!lines.length) return json({ ok: false, note: 'No ingredients provided.' }, 400);
  const title = String(body?.title || 'Recipe').slice(0, 200);

  let data: any;
  try {
    const url = 'https://api.edamam.com/api/nutrition-details?app_id=' + encodeURIComponent(appId) + '&app_key=' + encodeURIComponent(appKey);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, ingr: lines }) });
    if (r.status === 401) return json({ ok: false, note: 'Nutrition service rejected the credentials.' });
    if (!r.ok) return json({ ok: false, note: 'Nutrition service error (' + r.status + ').' });
    data = await r.json();
  } catch (e) {
    return json({ ok: false, note: 'Could not reach the nutrition service: ' + (e as Error).message });
  }

  // Per-ingredient: Edamam echoes each line back with a parsed[] entry carrying that item's nutrients.
  const per_ingredient = lines.map((line: string, i: number) => {
    const ing = (data.ingredients || [])[i];
    const parsed = ing && Array.isArray(ing.parsed) && ing.parsed[0];
    if (parsed && parsed.nutrients) return { line, ok: true, weight: Math.round(parsed.weight || 0), macros: macrosOf(parsed.nutrients) };
    return { line, ok: false, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } };
  });

  return json({
    ok: true,
    total: macrosOf(data.totalNutrients),
    weight: Math.round(data.totalWeight || 0),
    per_ingredient,
  });
});
