/**
 * DOM-level audit harness.
 *
 * Loads the REAL server-rendered HTML and the REAL compiled CSS from a running
 * Next.js server into happy-dom, then resolves the cascade (media queries are
 * viewport aware) and runs accessibility / visual-consistency / responsive-risk
 * checks.
 *
 * This is not a substitute for a real browser: happy-dom performs no layout, so
 * anything that depends on geometry (real horizontal overflow, actual element
 * boxes, CLS/LCP/INP) is NOT verified here. See qa/README.md.
 */
import { Window } from "happy-dom";

/* ------------------------------------------------------------------ */
/* CSS custom-property resolution                                      */
/* ------------------------------------------------------------------ */

/** Pull `--name: value;` pairs out of a CSS rule body. */
function parseTokens(css, selector) {
  const idx = css.indexOf(selector);
  if (idx === -1) return {};
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const tokens = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/**
 * happy-dom does not implement CSS cascade layers at all: it silently drops
 * every rule inside `@layer`. Tailwind v4 emits ALL of its utilities inside
 * `@layer utilities`, so without this the computed style of anything styled by
 * a Tailwind class is the browser default.
 *
 * Tailwind emits its layer blocks already in ascending precedence order
 * (theme -> base -> utilities) and unlayered author CSS beats every layer, so
 * re-emitting the blocks in document order followed by the unlayered rules
 * reproduces the real cascade for this codebase (all Tailwind utilities are
 * single-class specificity).
 */
export function flattenLayers(css) {
  const parts = [];
  let rest = "";
  let i = 0;
  while (i < css.length) {
    const m = /@layer\s+([a-zA-Z-]+)\s*\{/.exec(css.slice(i));
    if (!m) {
      rest += css.slice(i);
      break;
    }
    const start = i + m.index;
    rest += css.slice(i, start);
    let depth = 1;
    let j = start + m[0].length;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    parts.push(css.slice(start + m[0].length, j - 1));
    i = j;
  }
  return [...parts, rest].join("\n");
}

/**
 * happy-dom's selector engine cannot match a combinator nested inside
 * `:is()` / `:where()`. Tailwind v4 relies on exactly that for two things this
 * audit cares about:
 *   - the dark variant  -> `.dark\:text-white:is(.dark *)`
 *   - spacing utilities -> `:where(.space-y-6 > :not(:last-child))`
 * Without this pass every `dark:` colour and every `space-y-*` gap is silently
 * dropped and the computed styles are simply wrong.
 *
 * Trade-off: unwrapping `:where()` gives those selectors non-zero specificity,
 * which the real browser would not do. The affected rules here (`space-*`,
 * `peer-disabled:`) have no same-property competitors, so the cascade result is
 * unchanged; the alternative — dropping them — is far less accurate.
 */
export function adaptCssForHappyDom(css, theme) {
  let out = css.replace(/:where\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, "$1");

  if (theme === "dark") {
    // `SELECTOR:is(.dark *)` -> `:where(.dark) SELECTOR`.
    //
    // `:where()` contributes ZERO specificity. That matters: in a real browser
    // the dark utility sits in `@layer utilities` and therefore loses to the
    // app's unlayered `.auth-card`-style rules even though its specificity
    // (0,2,0) is higher. Keeping the rewrite at (0,1,0) makes those ties fall
    // back to source order, where the unlayered author CSS is emitted last and
    // wins — reproducing the real cascade. A plain `.dark SELECTOR` would
    // instead beat the author CSS and invert it.
    out = out.replace(/([^{}]+?):is\(\.dark \*\)(?=[,{])/g, (full, selector) =>
      selector
        .split(",")
        .map((s) => `:where(.dark) ${s.trim()}`)
        .join(",")
    );
  } else {
    // light theme: these must never apply
    out = out.replace(/[^{}]*:is\(\.dark \*\)[^{]*\{[^}]*\}/g, "");
  }
  return out;
}

/**
 * Merge every `:root` / `:host` block in document order. Tailwind's scale lives
 * in `@layer theme{:host,:root{...}}` and the app's design tokens in
 * `@layer base{:root{...}}`; document order reproduces the real precedence
 * because `theme` is declared before `base`.
 */
export function collectTokens(css, selectorRe) {
  const tokens = {};
  for (const m of css.matchAll(selectorRe)) {
    const open = css.indexOf("{", m.index + m[0].length - 1);
    let depth = 1;
    let i = open + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const body = css.slice(open + 1, i - 1);
    for (const t of body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      tokens[t[1]] = t[2].trim();
    }
  }
  return tokens;
}

/**
 * Collect EVERY `--x: y` declaration in the stylesheet, not just the design
 * tokens. Tailwind v4 stores its scale in `@layer theme { :root { --spacing: .25rem ... } }`
 * and emits utilities as `calc(var(--spacing) * 8)`, so without these the
 * cascade resolves to nothing.
 */
export function parseAllVars(css) {
  const tokens = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** Viewport used by evalCalc to resolve vw/vh. Set by makeDom(). */
export const VIEWPORT = { width: 1366, height: 900, rootPx: 16 };

/** `calc(calc(.25rem * 6) * 0)` -> `0px`; `clamp(25px, 6vw, 40px)` -> clamped px. */
export function evalCalc(expr) {
  const rootPx = VIEWPORT.rootPx;
  // 1. unit -> px number
  let e = String(expr).trim();
  e = e.replace(/(\d*\.?\d+)(rem|em)/g, (_, n) => String(parseFloat(n) * rootPx));
  e = e.replace(/(\d*\.?\d+)vw/g, (_, n) => String((parseFloat(n) * VIEWPORT.width) / 100));
  e = e.replace(/(\d*\.?\d+)vh/g, (_, n) => String((parseFloat(n) * VIEWPORT.height) / 100));
  e = e.replace(/(\d*\.?\d+)vmin/g, (_, n) => String((parseFloat(n) * Math.min(VIEWPORT.width, VIEWPORT.height)) / 100));
  e = e.replace(/(\d*\.?\d+)vmax/g, (_, n) => String((parseFloat(n) * Math.max(VIEWPORT.width, VIEWPORT.height)) / 100));
  e = e.replace(/(\d*\.?\d+)px/g, "$1");
  if (/%/.test(e)) return null; // percentage of an unknown containing block
  if (/[a-z]/i.test(e.replace(/\b(clamp|min|max|calc)\s*\(/gi, ""))) return null; // unresolved identifier

  const arith = (s) => {
    if (!/^[-+*/().\d\s]+$/.test(s)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict";return (${s})`)();
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };

  // 2. collapse innermost function calls with correct semantics
  for (let guard = 0; guard < 12; guard++) {
    const m = e.match(/(clamp|min|max|calc)\(([^()]*)\)/);
    if (!m) break;
    const args = m[2].split(",").map((a) => arith(a));
    if (args.some((a) => a === null)) return null;
    let v;
    if (m[1] === "calc") {
      if (args.length !== 1) return null;
      v = args[0];
    } else if (m[1] === "min") v = Math.min(...args);
    else if (m[1] === "max") v = Math.max(...args);
    else {
      if (args.length !== 3) return null;
      v = Math.min(Math.max(args[0], args[1]), args[2]);
    }
    e = e.slice(0, m.index) + String(Math.round(v * 1000) / 1000) + e.slice(m.index + m[0].length);
  }

  const final = arith(e);
  return final === null ? null : `${Math.round(final * 1000) / 1000}px`;
}

/**
 * Replace `var(--x)`, `var(--x / a)` and statically-solvable `calc()` with
 * literals, and split `background:` shorthands into longhands because happy-dom
 * silently drops the shorthand.
 */
export function resolveVars(css, tokens) {
  let out = css;
  for (let pass = 0; pass < 12; pass++) {
    let next = out.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\s*(?:\/\s*([^)]+?))?\s*\)/g,
      (full, name, fallback, alpha) => {
        const value = tokens[name];
        if (value === undefined) return fallback !== undefined ? fallback.trim() : full;
        if (alpha === undefined) return value;
        const colourFn = value.match(/^(hsl|rgb|hwb)\(([^)]*)\)$/);
        if (colourFn) return `${colourFn[1]}(${colourFn[2]} / ${alpha.trim()})`;
        return value;
      }
    );
    // innermost call first, so `calc(calc(a) * clamp(b, c, d))` fully collapses
    next = next.replace(/\b(calc|clamp|min|max)\(([^()]*)\)/g, (full, fn, inner) => {
      const v = evalCalc(`${fn}(${inner})`);
      return v ?? full;
    });
    if (next === out) break;
    out = next;
  }

  // happy-dom cannot parse oklch(), and Tailwind v4's whole palette is oklch:
  // the declaration is silently dropped, so the element falls back to an
  // inherited colour and every contrast number would be wrong.
  out = out.replace(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/gi, (full, l, c, h, a) => {
    let ln = parseFloat(l);
    if (l.endsWith("%")) ln /= 100;
    const [r, g, b] = oklchToRgb({ l: ln, c: parseFloat(c), h: parseFloat(h) });
    const alpha = a === undefined ? "" : `, ${a}`;
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}${alpha})`;
  });

  // happy-dom ignores `background:` shorthand -> project the colour onto background-color
  out = out.replace(/([{;])\s*background\s*:\s*([^;}]+)/g, (full, lead, value) => {
    if (/var\(|calc\(/.test(value)) return full;
    // The base colour is the LAST colour in the list (gradients come first).
    const colours = [...value.matchAll(/#[\da-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)/gi)];
    if (!colours.length) return full;
    return `${lead}background:${value};background-color:${colours[colours.length - 1][0]}`;
  });
  return out;
}

/** Tailwind v4 emits oklch(); convert to sRGB so contrast maths works. */
export function oklchToRgb({ l, c, h }) {
  const toLinear = (L, C, H) => {
    const hr = (H * Math.PI) / 180;
    const a = C * Math.cos(hr);
    const b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
    return [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ];
  };
  const inGamut = (v) => v.every((x) => x >= -0.0001 && x <= 1.0001);
  const f = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055);

  let rgb = toLinear(l, c, h);
  if (!inGamut(rgb)) {
    // CSS Color 4 gamut mapping: binary-search the chroma down until it fits.
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toLinear(l, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = toLinear(l, lo, h);
  }
  return rgb.map((x) => Math.max(0, Math.min(1, f(x))) * 255);
}

export function parseColour(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s === "transparent" || s === "" || s === "none") return null;
  let m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const [r, g, b, a = 1] = parts;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: a === undefined ? 1 : a };
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]) || 0;
    const sat = parseFloat(parts[1]);
    const li = parseFloat(parts[2]);
    if (Number.isNaN(sat) || Number.isNaN(li)) return null;
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    const sN = sat / 100, lN = li / 100;
    const k = (n) => (n + h / 30) % 12;
    const aa = sN * Math.min(lN, 1 - lN);
    const f = (n) => lN - aa * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: Number.isNaN(a) ? 1 : a };
  }
  m = s.match(/^oklch\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,\s]+/).filter(Boolean);
    let l = parseFloat(parts[0]);
    if (parts[0] && parts[0].endsWith("%")) l /= 100;
    const c = parseFloat(parts[1]) || 0;
    const h = parseFloat(parts[2]) || 0;
    const [r, g, b] = oklchToRgb({ l, c, h });
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    return { r, g, b, a };
  }
  m = s.match(/^#([\da-f]{3,8})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((x) => x + x).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

/** Composite `fg` over `bg` using alpha; both are {r,g,b,a}. */
export function composite(fg, bg) {
  if (!fg) return bg;
  const a = fg.a === undefined ? 1 : fg.a;
  if (a >= 1 || !bg) return { ...fg, a: 1 };
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

export function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ */
/* Document construction                                               */
/* ------------------------------------------------------------------ */

const TOKEN_CACHE = new Map();

export async function loadCss(baseUrl) {
  if (TOKEN_CACHE.has("css:" + baseUrl)) return TOKEN_CACHE.get("css:" + baseUrl);
  const home = await (await fetch(baseUrl + "/")).text();
  const hrefs = [...home.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const css = (await Promise.all(hrefs.map((h) => fetch(baseUrl + h).then((r) => r.text())))).join("\n");
  TOKEN_CACHE.set("css:" + baseUrl, css);
  return css;
}

/**
 * Build a happy-dom window for `html` at a given viewport + theme.
 * `theme` is "light" | "dark"; the matching token set is inlined so that
 * `var(--x)` resolves to a literal colour happy-dom can compute.
 */
export async function makeDom(html, rawCss, { width = 1366, height = 900, theme = "light" } = {}) {
  VIEWPORT.width = width;
  VIEWPORT.height = height;
  rawCss = flattenLayers(rawCss);
  const rootTokens = collectTokens(rawCss, /:root\s*\{/g);
  const darkTokens = collectTokens(rawCss, /\.dark\s*\{/g);
  const allVars = parseAllVars(rawCss);
  // Design tokens win over same-named Tailwind scale entries; then everything else.
  const baseTokens = { ...allVars, ...rootTokens };
  const tokens = theme === "dark" ? { ...baseTokens, ...darkTokens } : baseTokens;
  const css = adaptCssForHappyDom(resolveVars(rawCss, tokens), theme);

  // Scripts and remote stylesheets are removed through the DOM API below, not
  // with a regex over the markup. happy-dom never evaluates inline scripts
  // during document.write, and DOM removal cannot be defeated by <SCRIPT>,
  // <script > or a nested tag the way a filtering regexp can.
  let cleaned = html;

  // next-themes adds the class on the client; without it every `dark:` utility
  // (compiled to `:is(.dark *)`) silently fails to match.
  if (theme === "dark") {
    cleaned = cleaned.replace(/<html([^>]*)>/, (m, attrs) =>
      /\bclass=/.test(attrs)
        ? m.replace(/\bclass="/, 'class="dark ')
        : `<html${attrs} class="dark">`
    );
  }

  const window = new Window({
    url: "http://127.0.0.1:3000/",
    width,
    height,
    settings: {
      // Belt and braces: even if happy-dom's evaluation defaults change, nothing
      // in the fetched document runs or triggers a subresource load.
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  window.document.write(
    cleaned.replace("<head>", `<head><style>${css}</style>`)
  );

  // Drop the document's own scripts and stylesheet links so the resolved CSS
  // above is the only sheet in play.
  for (const el of window.document.querySelectorAll(
    "script, link[rel='stylesheet']"
  )) {
    el.remove();
  }

  return window;
}

/**
 * happy-dom keeps `background` shorthand separate from `backgroundColor`, and
 * Tailwind v4 `space-y-*` writes `margin-block-start`, so read the longhands we
 * actually care about across both spellings.
 */
export function style(win, el) {
  const cs = win.getComputedStyle(el);
  const first = (...names) => {
    for (const n of names) {
      const v = cs[n] || cs.getPropertyValue?.(kebab(n));
      if (v && v !== "initial") return v;
    }
    return "";
  };
  return {
    cs,
    get background() {
      const c = cs.backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)") return c;
      const bg = cs.background || "";
      const m = bg.match(/(#[\da-f]{3,8}|rgba?\([^)]+\)|oklch\([^)]+\)|hsla?\([^)]+\))/i);
      return m ? m[1] : "";
    },
    get color() { return cs.color; },
    get marginTop() { return first("marginTop", "marginBlockStart", "margin"); },
    get marginBottom() { return first("marginBottom", "marginBlockEnd"); },
    get minHeight() { return first("minHeight"); },
    get height() { return first("height"); },
    get minWidth() { return first("minWidth"); },
    get width() { return first("width"); },
    get fontSize() { return first("fontSize"); },
    get fontWeight() { return first("fontWeight"); },
    get borderRadius() { return first("borderTopLeftRadius", "borderRadius"); },
    get display() { return first("display"); },
    get visibility() { return first("visibility"); },
    get opacity() { return first("opacity"); },
    get overflowX() { return first("overflowX", "overflow"); },
  };
}

const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])";

export function describe(el) {
  const doc = el.ownerDocument;
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
  const id = el.id ? `#${el.id}` : "";
  const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  const where = path(el);
  return `<${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}>${text ? ` "${text}"` : ""} @ ${where}`;
}

export function path(el) {
  const parts = [];
  let node = el;
  let guard = 0;
  while (node && node.tagName && guard++ < 5) {
    let label = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (sibs.length > 1) label += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(label);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

export function accessibleName(el) {
  if (el.getAttribute("aria-label")?.trim()) return el.getAttribute("aria-label").trim();
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() || "")
      .join(" ")
      .trim();
    if (t) return t;
  }
  if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
  // form controls: <label for="id"> and wrapping <label> both name the control
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
    const id = el.getAttribute("id");
    if (id) {
      const lab = el.ownerDocument.querySelector(`label[for="${CSS_escape(id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent.trim();
    }
    const wrap = el.closest("label");
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    if (el.getAttribute("placeholder")?.trim()) return el.getAttribute("placeholder").trim();
  }
  const title = el.getAttribute("title");
  const own = (el.textContent || "").trim().replace(/\s+/g, " ");
  if (own) return own;
  if (title?.trim()) return title.trim();
  // icon-only via <svg aria-hidden> child: no accessible name
  return "";
}

const CSS_escape = (s) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&");

export function effectiveBackground(el) {
  const win = el.ownerDocument.defaultView;
  let node = el;
  const layers = [];
  while (node && node.nodeType === 1) {
    const c = parseColour(style(win, node).background);
    if (c) layers.push(c);
    node = node.parentElement;
  }
  layers.push({ r: 255, g: 255, b: 255, a: 1 }); // canvas fallback
  let acc = layers[layers.length - 1];
  for (let i = layers.length - 2; i >= 0; i--) acc = composite(layers[i], acc);
  return acc;
}

/** True when some ancestor clips overflow, so an oversized child cannot scroll the page. */
export function isClippedByAncestor(el) {
  const win = el.ownerDocument.defaultView;
  let node = el.parentElement;
  while (node && node.nodeType === 1 && node.tagName !== "HTML") {
    const ox = style(win, node).overflowX;
    if (ox && ox !== "visible") return true;
    node = node.parentElement;
  }
  return false;
}

export function px(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export { INTERACTIVE };
