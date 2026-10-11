/**
 * QA audit runner.
 *
 *   node qa/audit.mjs [--base http://127.0.0.1:3000] [--json out.json]
 *
 * Every finding below was produced by executing this script against the real
 * production build served by `next start`. Nothing is inferred from reading
 * source alone.
 */
import { writeFileSync } from "node:fs";
import {
  INTERACTIVE,
  accessibleName,
  composite,
  contrastRatio,
  describe,
  effectiveBackground,
  isClippedByAncestor,
  loadCss,
  makeDom,
  parseColour,
  px,
  style,
} from "./lib/dom-audit.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const BASE = opt("--base", "http://127.0.0.1:3000");

const PAGES = [
  { path: "/", name: "Landing" },
  { path: "/sign-in", name: "Sign in" },
  { path: "/sign-up", name: "Sign up" },
  { path: "/forgot-password", name: "Forgot password" },
  { path: "/verify", name: "Verify account" },
  { path: "/verify-forgot-password", name: "Verify reset" },
  { path: "/u/alice", name: "Public inbox" },
  { path: "/no-such-page", name: "404 probe" },
];

const VIEWPORTS = [320, 375, 390, 425, 768, 820, 1024, 1280, 1366, 1440, 1920, 2560];

const findings = [];
const push = (f) => findings.push(f);
// Proof that the computed-style pass actually inspected nodes (a silent
// zero-findings result is worthless if nothing was examined).
const inspected = { textNodes: 0, controls: 0, boxes: 0 };
const norm = (f) => ({ severity: "Low", page: "-", viewport: "-", theme: "-", ...f });

/* ------------------------------------------------------------------ */
/* Structural + accessibility checks (theme independent)               */
/* ------------------------------------------------------------------ */

function auditStructure(doc, page) {
  const P = page.name;

  const html = doc.documentElement;
  if (!html.getAttribute("lang")) {
    push(norm({ page: P, severity: "High", category: "a11y", issue: "<html> has no lang attribute", element: "<html>" }));
  }

  const title = doc.querySelector("title");
  if (!title || !title.textContent.trim()) {
    push(norm({ page: P, severity: "High", category: "a11y", issue: "Page has no <title>", element: "<head>" }));
  }

  const vp = doc.querySelector('meta[name="viewport"]');
  if (!vp) {
    push(norm({ page: P, severity: "Critical", category: "responsive", issue: "Missing viewport meta", element: "<head>" }));
  } else {
    const c = vp.getAttribute("content") || "";
    if (/user-scalable\s*=\s*no/i.test(c) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(c)) {
      push(norm({ page: P, severity: "High", category: "a11y", issue: "Viewport blocks pinch-zoom (WCAG 1.4.4)", element: c }));
    }
  }

  // images
  for (const img of doc.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) {
      push(norm({ page: P, severity: "High", category: "a11y", issue: "<img> missing alt attribute", element: describe(img) }));
    }
    if (!img.getAttribute("src") && !img.getAttribute("srcset")) {
      push(norm({ page: P, severity: "Medium", category: "visual", issue: "<img> with no src", element: describe(img) }));
    }
  }

  // duplicate ids
  const ids = new Map();
  for (const el of doc.querySelectorAll("[id]")) {
    ids.set(el.id, (ids.get(el.id) || 0) + 1);
  }
  for (const [id, n] of ids) {
    if (n > 1) push(norm({ page: P, severity: "Medium", category: "a11y", issue: `Duplicate id "${id}" (${n}x) breaks label/aria wiring`, element: `#${id}` }));
  }

  // headings
  const heads = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  const h1s = heads.filter((h) => h.tagName === "H1");
  if (h1s.length === 0) push(norm({ page: P, severity: "Medium", category: "a11y", issue: "No <h1> on page", element: "<body>" }));
  if (h1s.length > 1) push(norm({ page: P, severity: "Medium", category: "a11y", issue: `${h1s.length} <h1> elements on one page`, element: h1s.map(describe).join(" | ") }));
  let prev = 0;
  for (const h of heads) {
    const lvl = Number(h.tagName[1]);
    if (prev && lvl > prev + 1) {
      push(norm({ page: P, severity: "Low", category: "a11y", issue: `Heading level skipped h${prev} -> h${lvl}`, element: describe(h) }));
    }
    prev = lvl;
  }

  // interactive elements: accessible name + href sanity
  for (const el of doc.querySelectorAll(INTERACTIVE)) {
    const name = accessibleName(el);
    if (!name) {
      push(norm({ page: P, severity: "High", category: "a11y", issue: "Interactive element has no accessible name", element: describe(el) }));
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href === "#" || href === "") {
        push(norm({ page: P, severity: "Medium", category: "functional", issue: "Link with empty/# href (not focusable-activatable, no destination)", element: describe(el) }));
      }
    }
    const ti = el.getAttribute("tabindex");
    if (ti && Number(ti) > 0) {
      push(norm({ page: P, severity: "Medium", category: "a11y", issue: `Positive tabindex="${ti}" breaks logical focus order`, element: describe(el) }));
    }
  }

  // form controls must be labelled
  for (const el of doc.querySelectorAll("input:not([type=hidden]), textarea, select")) {
    const id = el.getAttribute("id");
    const hasFor = id && doc.querySelector(`label[for="${CSS_escape(id)}"]`);
    const wrapped = el.closest("label");
    const named = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    if (!hasFor && !wrapped && !named) {
      push(norm({ page: P, severity: "High", category: "a11y", issue: "Form control has no associated label", element: describe(el) }));
    }
    if (el.getAttribute("type") === "number") {
      push(norm({ page: P, severity: "Low", category: "usability", issue: 'type="number" for a 6-digit code: spinners + scroll-wheel mutation + locale issues', element: describe(el) }));
    }
  }

  // aria references resolve
  for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-activedescendant"]) {
    for (const el of doc.querySelectorAll(`[${attr}]`)) {
      for (const ref of (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean)) {
        if (!doc.getElementById(ref)) {
          push(norm({ page: P, severity: "Medium", category: "a11y", issue: `${attr} references missing id "${ref}"`, element: describe(el) }));
        }
      }
    }
  }

  // landmarks
  if (!doc.querySelector("main")) push(norm({ page: P, severity: "Medium", category: "a11y", issue: "No <main> landmark", element: "<body>" }));

  // toast live region must be a named landmark or screen readers stay silent
  for (const ol of doc.querySelectorAll('ol[class*="z-[100]"]')) {
    if (ol.getAttribute("role") !== "region" || !accessibleName(ol)) {
      push(norm({ page: P, severity: "High", category: "a11y", issue: "Toast viewport is not a named live region (role=region + accessible name)", element: describe(ol) }));
    }
  }
  const navs = doc.querySelectorAll("nav");
  if (navs.length > 1) {
    const names = [...navs].map((n) => accessibleName(n) || "(unnamed)");
    if (new Set(names).size !== names.length) {
      push(norm({ page: P, severity: "Low", category: "a11y", issue: "Multiple <nav> landmarks share the same accessible name", element: names.join(", ") }));
    }
  }

  // buttons inside forms without type
  for (const b of doc.querySelectorAll("button")) {
    if (!b.getAttribute("type")) {
      push(norm({ page: P, severity: "Low", category: "functional", issue: "<button> with no type= inside a form defaults to submit", element: describe(b) }));
    }
  }
}

const CSS_escape = (s) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

/* ------------------------------------------------------------------ */
/* Computed-style checks (viewport + theme aware)                      */
/* ------------------------------------------------------------------ */

function auditComputed(doc, page, width, theme) {
  const win = doc.defaultView;
  const P = page.name;
  const seen = new Set();
  const once = (key, f) => {
    if (seen.has(key)) return;
    seen.add(key);
    push(norm(f));
  };

  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || el.closest("[aria-hidden='true']")) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;

    const s = style(win, el);
    // happy-dom reports an empty string for properties it did not resolve, and
    // Number("") === 0 — a naive `Number(s.opacity) === 0` guard silently skips
    // every node. Only treat an explicit "0" as hidden.
    const hidden =
      s.visibility === "hidden" ||
      s.display === "none" ||
      (s.opacity !== "" && Number(s.opacity) === 0);
    if (hidden) continue;

    const fg = parseColour(s.color);
    if (!fg) continue;
    inspected.textNodes++;
    const bg = effectiveBackground(el);
    const eff = composite(fg, bg);
    const ratio = contrastRatio(eff, bg);

    const fontSize = px(s.fontSize) ?? 16;
    const weight = Number(String(s.fontWeight).replace(/[^0-9.]/g, "")) || 400;
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;

    if (ratio < required) {
      once(`contrast:${text.slice(0, 30)}:${width}:${theme}`, {
        page: P,
        viewport: `${width}px`,
        theme,
        severity: ratio < 3 ? "High" : "Medium",
        category: "a11y-contrast",
        issue: `Contrast ${ratio.toFixed(2)}:1 < ${required}:1 required (fg ${rgb(fg)} on ${rgb(bg)})`,
        element: `${describe(el)} text="${text.slice(0, 40)}"`,
      });
    }
  }

  // touch targets
  if (width <= 820) {
    for (const el of doc.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea")) {
      const s = style(win, el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      inspected.controls++;
      const h = px(s.minHeight) ?? px(s.height);
      const w = px(s.minWidth) ?? px(s.width);
      if (h !== null && h > 0 && h < 24) {
        once(`touch-h:${describe(el)}`, { page: P, viewport: `${width}px`, theme, severity: "Medium", category: "a11y-touch", issue: `Touch target height ${h}px < 24px (WCAG 2.5.8) / 44px recommended`, element: describe(el) });
      }
      if (w !== null && w > 0 && w < 24) {
        once(`touch-w:${describe(el)}`, { page: P, viewport: `${width}px`, theme, severity: "Medium", category: "a11y-touch", issue: `Touch target width ${w}px < 24px (WCAG 2.5.8)`, element: describe(el) });
      }
    }
  }

  // fixed-size boxes that cannot fit a narrow viewport
  if (width <= 425) {
    for (const el of doc.querySelectorAll("*")) {
      const s = style(win, el);
      if (s.display === "none") continue;
      if (isClippedByAncestor(el)) continue; // cannot contribute to page-level scroll
      inspected.boxes++;
      for (const prop of ["minWidth", "width"]) {
        const v = s[prop];
        if (!v || !v.endsWith("px")) continue;
        const n = px(v);
        if (n === null || n <= width) continue;
        once(`overflow:${prop}:${describe(el)}`, {
          page: P,
          viewport: `${width}px`,
          theme,
          severity: n > width + 40 ? "High" : "Medium",
          category: "responsive-overflow",
          issue: `Computed ${prop} ${n}px exceeds ${width}px viewport and is not clipped (horizontal-scroll risk)`,
          element: describe(el),
        });
      }
    }
  }
}

const rgb = (c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const rawCss = await loadCss(BASE);
console.log(`Fetched compiled CSS from ${BASE}: ${rawCss.length} bytes\n`);

const results = {};

for (const page of PAGES) {
  const res = await fetch(BASE + page.path, { redirect: "manual" });
  const body = await res.text();
  results[page.path] = { status: res.status, location: res.headers.get("location"), bytes: body.length };

  if (res.status !== 200) {
    push(norm({ page: page.name, severity: res.status === 307 ? "Medium" : "High", category: "functional", issue: `GET ${page.path} returned ${res.status}${res.headers.get("location") ? " -> " + res.headers.get("location") : ""}`, element: page.path }));
    continue;
  }

  const doc = (await makeDom(body, rawCss, { width: 1366, theme: "light" })).document;
  auditStructure(doc, page);

  for (const width of [320, 375, 425, 768, 1440]) {
    for (const theme of ["light", "dark"]) {
      const d = (await makeDom(body, rawCss, { width, theme })).document;
      auditComputed(d, page, width, theme);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.page.localeCompare(b.page));

const bySev = {};
for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

console.log("=== HTTP results ===");
for (const [p, r] of Object.entries(results)) {
  console.log(`  ${String(r.status).padEnd(4)} ${p.padEnd(28)} ${String(r.bytes).padStart(7)} B ${r.location ? "-> " + r.location : ""}`);
}

console.log(`\n=== Computed-style coverage ===`);
console.log(`  text nodes contrast-checked : ${inspected.textNodes}`);
console.log(`  controls touch-target checked: ${inspected.controls}`);
console.log(`  boxes overflow-checked      : ${inspected.boxes}`);
if (inspected.textNodes === 0) throw new Error("contrast check inspected nothing - the audit is broken");

console.log(`\n=== Findings: ${findings.length} (${Object.entries(bySev).map(([k, v]) => `${k} ${v}`).join(", ")}) ===\n`);
for (const f of findings) {
  console.log(`[${f.severity.toUpperCase().padEnd(8)}] ${f.category.padEnd(20)} ${f.page.padEnd(18)} ${f.viewport !== "-" ? `@${f.viewport}` : ""}${f.theme !== "-" ? `/${f.theme}` : ""}`);
  console.log(`            ${f.issue}`);
  console.log(`            ${f.element}\n`);
}

if (opt("--json", null)) {
  writeFileSync(opt("--json", "qa/findings.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, http: results, findings }, null, 2));
  console.log(`Wrote ${opt("--json")}`);
}
