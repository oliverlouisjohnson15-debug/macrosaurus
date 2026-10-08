// Shared metric collector (runs in the page). Excludes app chrome: the sticky app bar, the bottom
// tab bar, and anything marked [data-chrome].
export const collect = (scopeSel) => {
  const scope = (scopeSel && [...document.querySelectorAll(scopeSel)].pop()) || document;
  const inScope = el => scope === document || scope.contains(el);
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const chrome = el => !inScope(el) || !!el.closest('[data-chrome], [aria-hidden="true"], .sticky.top-0, .fixed.bottom-0.inset-x-0');
  const opaque = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return false; const v = m[1].split(',').map(Number); return v.length < 4 || v[3] > 0.05; };
  const effBg = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (opaque(c)) return c; } return 'rgb(255,255,255)'; };
  // A BLOCK is a container that reads as a separate object: a >=2px frame on all four sides, or a
  // fill that differs from what is behind it. Buttons, inputs and anything under 120x36 don't count.
  const isBlock = el => {
    if (!vis(el) || chrome(el) || el.matches('button,a,input,select,textarea,label,[role=button],[role=tablist]')) return false;
    const r = el.getBoundingClientRect(); if (r.width < 120 || r.height < 36) return false;
    const cs = getComputedStyle(el);
    const framed = ['Top','Right','Bottom','Left'].every(s => parseFloat(cs['border'+s+'Width']) >= 2);
    const filled = opaque(cs.backgroundColor) && el.parentElement && cs.backgroundColor !== effBg(el.parentElement);
    return framed || filled;
  };
  const boxes = [...document.querySelectorAll('div,section,article,li,ul,ol,header,figure')].filter(isBlock);
  const outer = boxes.filter(b => !boxes.some(o => o !== b && o.contains(b)));
  const ctrls = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab]')].filter(el => vis(el) && !chrome(el) && !el.disabled);
  // `.hit` widens the tap area to 44x44 with a pseudo-element (styles.css), so its box can be smaller.
  const small = ctrls.filter(el => { if (el.classList.contains('hit')) return false; const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length;
  const prose = [...document.querySelectorAll('p,div,span,li')].filter(el => vis(el) && !chrome(el) && !el.closest('button,a,[role=button],[data-not-help]') && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().split(/\s+/).length >= 5));
  let sentences = 0;
  for (const el of prose) { const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim(); sentences += (t.match(/[^.!?]+[.!?]+(\s|$)/g) || []).filter(s => s.trim().split(/\s+/).length >= 4).length; }
  return { outerBlocks: outer.length, nestedBlocks: boxes.length - outer.length, controls: ctrls.length, under44: small, helpSentences: sentences, pageHeight: document.documentElement.scrollHeight };
};
