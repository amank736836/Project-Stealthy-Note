# QA harness

Everything here was written during the 2026-10-11 audit. See `../QA-REPORT.md` for findings.

## Running

```bash
npm run build && npm start          # production server on :3000

npm test                            # 38 browser-free regression tests
npm run test:schema                 # real zod schemas, via tsx
npm run qa:audit                    # DOM/CSS audit against the live server
npm run qa:all                      # lint + all three of the above

npx playwright install chromium firefox webkit
npm run test:e2e                    # browser suite (needs a real browser)
```

## What each file does

| File | Needs a browser? | What it actually checks |
|---|---|---|
| `regression.test.mjs` | No | Live HTTP: the 401-not-redirect API contract, route status codes, asset resolution, HTTP method contract, and assertions on the **real server-rendered HTML** (landmarks, headings, label/`for` wiring, toast region attributes) |
| `schema.test.ts` | No | Executes the actual `src/backend/schemas/*` with the exact values the forms store. This is what caught the `Expected number, received string` reset bug |
| `audit.mjs` + `lib/dom-audit.mjs` | No | Loads real HTML + real compiled CSS into `happy-dom`, resolves the cascade, and computes WCAG contrast, touch-target sizes and fixed-width overflow risk |
| `e2e.spec.ts` | **Yes** | 12 viewports × 7 pages of real layout/overflow checks, screenshots, keyboard navigation, console + network errors, Web Vitals, edge cases |

## Known limits of the browser-free harness

`happy-dom` is not a browser. It performs **no layout**, and it has four specific gaps this
harness had to work around — if you extend it, keep these in mind:

1. **It silently drops every rule inside `@layer`.** Tailwind v4 emits all utilities in
   `@layer utilities`, so without `flattenLayers()` nothing styled by a Tailwind class
   resolves at all. Layers are re-emitted in document order followed by unlayered rules,
   which reproduces the real precedence for this codebase.
2. **It cannot match a combinator inside `:is()` / `:where()`.** That breaks Tailwind's dark
   variant (`.dark\:text-white:is(.dark *)`) and all `space-y-*` / `space-x-*` utilities.
   `adaptCssForHappyDom()` rewrites the dark variant to `:where(.dark) SELECTOR` — `:where()`
   keeps specificity at zero so unlayered author CSS still wins ties, matching a real browser.
   Using a plain `.dark SELECTOR` instead would *invert* the cascade and produce false
   contrast failures.
3. **It drops the `background:` shorthand** (only `background-color` survives) and **cannot
   parse `oklch()`**, so `resolveVars()` splits the shorthand and converts oklch→sRGB.
4. **It returns `""` for unresolved properties.** `Number("") === 0`, so a guard like
   `if (Number(opacity) === 0) continue` silently skips every element. `audit.mjs` now
   prints coverage counters and **throws if zero text nodes were inspected** — a
   zero-findings result is worthless if nothing was examined.

Residual inaccuracy: oklch→sRGB is exact for Tailwind's grey scale (Δ≤3/255 vs the published
hex) but Tailwind's saturated `red`/`green` chroma values are outside sRGB, so those carry
roughly ±0.15 contrast-ratio uncertainty. The app's own `hsl()` design tokens are exact.

Anything needing real geometry — actual horizontal scrolling, element boxes, hit areas,
CLS/LCP/INP, rendered focus rings — is **only** covered by `e2e.spec.ts`.

## Do not run `next build` while `next start` is serving

`next build` rewrites `.next/` in place, and the running server keeps serving the old
manifest. The result is a server that answers 200 but whose HTML is missing chunks — the
audit silently reports `text nodes contrast-checked: 0` and the markup tests fail on
stale markup. It looks exactly like a regression in the app.

Always **stop the server, build, then start it again**. `qa:all` deliberately does not build.
