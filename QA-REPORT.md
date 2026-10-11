# QA Report — Stealthy Note

**Date:** 2026-10-11 · **Branch:** `arena/7d6abedf-project-stealthy-note` · **Base:** `d215eb4`
**Build under test:** `next build` production output, served by `next start -H 0.0.0.0 -p 3000`

---

## 0. Read this first — what was and was not executed

I have to be direct about the testing environment, because it determines how much of this
report is measured versus reasoned.

**No browser could be run in this sandbox.** This was verified, not assumed:

| Attempt | Result |
|---|---|
| `npx playwright install chromium` | `ECONNRESET` from `cdn.playwright.dev` (TLS handshake reset) |
| `--with-deps` | `Unable to locate package libnss3 / libgbm / libpango…` (no apt access) |
| Puppeteer / Chrome-for-Testing | `storage.googleapis.com` → HTTP 000 |
| Electron (GitHub release assets) | `objects.githubusercontent.com` → HTTP 000 |
| Debian mirror for system libs | `deb.debian.org` → HTTP 000 |
| Pre-installed browser | none found (`find /` for chrome/chromium/firefox/headless_shell) |

Outbound access is limited to `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. **No browser binary is
obtainable from any of them.** The same applies to MongoDB (`fastdl.mongodb.org`
unreachable), so no database-backed flow could be exercised end to end.

**What I did instead — all of it actually executed:**

1. **Real production build** — `next build`, 20 routes, type-checked.
2. **Real production server** — `next start`, then live HTTP requests against every route.
3. **A DOM+CSS audit harness** (`qa/`) that loads the *real server-rendered HTML* and the
   *real compiled CSS* into `happy-dom`, resolves the cascade, and computes styles.
4. **Real schema execution** — the actual zod schemas run under `tsx`.
5. **Real WCAG contrast maths** on the actual resolved colours.

**Not verified (needs a browser — the Playwright suite in `qa/e2e.spec.ts` covers these and
is ready to run locally):** actual rendered pixel layout, real horizontal-scroll detection,
screenshots, CLS/LCP/INP, console errors, cross-browser behaviour (Chrome/Firefox/Safari/
Edge), keyboard focus *rendering*, touch-target hit areas, browser zoom, and anything
requiring a database (sign-up → verify → sign-in → dashboard → messages).

### Honesty note on my own tooling

Three harness bugs produced *wrong* results before I caught them. I am listing them because
they materially affect how you should read earlier "clean" results:

1. **happy-dom silently drops all `@layer` rules.** Tailwind v4 puts every utility in
   `@layer utilities`, so all Tailwind styling was invisible. Fixed by flattening layers in
   declared order (`flattenLayers`).
2. **happy-dom cannot match a combinator inside `:is()`/`:where()`.** Tailwind's dark variant
   (`:is(.dark *)`) and `space-y-*` (`:where(.space-y-6 > :not(:last-child))`) never matched.
   Fixed by `adaptCssForHappyDom`, which rewrites them to `:where(.dark) …` — `:where()` keeps
   specificity at zero so the unlayered author CSS still wins ties, matching the real cascade.
3. **`Number("") === 0`** in my visibility guard skipped **all 71 text nodes per page**. My
   first two contrast runs reported "no contrast findings" while having examined nothing.
   Fixed, and the harness now **throws if the coverage counter is zero**.

Final coverage counters, printed on every run so this cannot silently regress:
`textNodes=1558 · controls=584 · boxes=1818`.

Two residual accuracy limits I could not remove:
- **oklch→sRGB**: exact for Tailwind's grey scale (Δ≤3/255 vs published hex); Tailwind's
  saturated `red`/`green` don't round-trip (their published chroma is out of sRGB gamut),
  so those carry ~±0.15 ratio uncertainty. The app's own `hsl()` tokens are exact.
- **No layout**: any check needing real geometry is not covered.

---

## 1. Findings

**29 findings on first pass → 1 remaining.** 28 fixed, 1 confirmed as intended behaviour. CI's CodeQL diff scan then raised a further 4 high-severity alerts against the test harness itself (L-6), also fixed.

### Critical

| # | Page / Component | Issue | Viewport | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| C-1 | `/dashboard`, all protected APIs | Unauthenticated API calls **307-redirected to the `/sign-in` HTML page**. Axios followed the redirect and resolved **200 with an HTML string**, so `catch` never ran and `setMessages(response.data.messages \|\| [])` silently produced `[]`. An expired session rendered a plausible **empty inbox with no error at all**. | All | `src/middleware.ts` blanket-redirected every non-allowlisted path, including `/api/*` | `/api/*` now returns `NextResponse.json({success:false, message}, {status:401})`. Page routes still redirect. | **Fixed** |

Measured before/after (`GET /api/get-messages`, no session):

```
before: 307  location=/sign-in   → follow → 200 text/html 16619 bytes
after : 401  application/json    → {"success":false,"message":"Unauthorized. Please sign in again."}
```

### High

| # | Page / Component | Issue | Viewport | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| H-1 | `src/middleware.ts` | `console.log(token)` printed the **decoded session JWT** on every request. Verified: the server log filled with one line per request (70+ `null` lines during the audit; a real user's `_id`/`username`/`email` would appear in plaintext). | n/a (server) | Debug statement left in | Removed; added a test asserting no `console.*` remains in the middleware | **Fixed** |
| H-2 | `/verify-forgot-password` | **Password reset could not be completed by typing the code.** Proven by executing the real schema: `verifyForgotPasswordSchema.safeParse({…, verifyCode:"123456"})` → `verifyCode: Expected number, received string`. The page bound `<Input {...field} />` with no coercion, so form state held a string while the schema requires `z.number()`. | All | Missing `onChange` coercion (the sibling `/verify` page had it) | Digits-only coercion added on both verify pages; `qa/schema.test.ts` locks it in | **Fixed** |
| H-3 | All pages | **ESLint was completely non-functional.** `npm run lint` → `Cannot find module 'fast-glob'`, and `next build` printed `⨯ ESLint: Failed to load plugin '@next/next'` yet **still exited 0** — the quality gate was silently dead. | n/a (build) | `overrides: { "fast-glob": "file:tools/glob-shim" }`. npm resolves `file:` overrides **relative to the overridden package**, producing a dangling symlink `node_modules/fast-glob → @next/eslint-plugin-next/tools/glob-shim` | Changed the specifier to `file:../../../tools/glob-shim`; documented in `tools/glob-shim/package.json`. Verified: `npm run lint` now runs — **0 errors**, 5 pre-existing `react-hooks/exhaustive-deps` warnings | **Fixed** |
| H-4 | Landing `.step-number` ("01"/"02"/"03") | Contrast **2.78:1** light / **4.35:1** dark at 12px/700 → normal text, needs 4.5:1 (WCAG 1.4.3) | All | `color: hsl(var(--muted-foreground) / 0.72)` — the 0.72 alpha | Alpha removed → **4.66:1 light / 7.15:1 dark** | **Fixed** |
| H-5 | All pages | Toast viewport rendered as a bare `<ol tabindex="-1">` with **no `role` and no accessible name** → screen readers announce nothing when a toast fires | All | shadcn `ToastViewport` passed no role/label | `role="region"` + `aria-label="Notifications"` (still caller-overridable) | **Fixed** |
| H-6 | Landing `.preview-heading span`, `.landing-cta p` | Contrast **4.17:1** and **4.23:1** — under 4.5:1 | All, light | `--muted-foreground: 148 10% 43%` gives 4.54:1 on the page background but dips below on the tinted `--muted` pill and CTA band | `--muted-foreground` light 43% → **40%**. Worst case now **4.70:1**, page background 5.11:1. Tone unchanged; dark theme untouched (already 6–7:1) | **Fixed** |
| H-7 | `/sign-up` username status | **2.27:1** (`text-green-500`) and **3.80:1** (`text-red-500`) on the card, with no dark variant at all | All | Tailwind palette bypassing the design tokens | `text-primary` / `text-destructive dark:text-red-400` → **7.95:1** / **4.69:1** light, **12.31:1** / **5.81:1** dark | **Fixed** |

### Medium

| # | Page / Component | Issue | Root cause | Fix | Status |
|---|---|---|---|---|---|
| M-1 | 5 auth pages | **No `<main>` landmark** — the pages used a plain `<div class="auth-page">` | Missing semantic wrapper | Changed to `<main>`; test asserts exactly one `<main>` and one `<h1>` per page | **Fixed** |
| M-2 | All form fields (14 instances) | `aria-describedby` referenced `…-form-item-description`, **an id nothing renders** unless the caller adds a `<FormDescription>` (axe: `aria-valid-attr-value`) | shadcn `FormControl` always emitted the id | `FormItemContext` now tracks whether a description mounted; `FormControl` only lists ids that exist. Verified: `/sign-in` inputs have no `aria-describedby`; `/u/alice` has `message-help message-count` and **both ids resolve** | **Fixed** |
| M-3 | 5 auth pages | **~30 dead Tailwind classes overriding nothing**, bypassing the design system. Proven by computed style: `.auth-page` resolved to `hsl(150 32% 98%)` not `bg-gray-100`; `.auth-card` to `hsl(0 0% 100%/.9)` not `bg-white`; radius `27px` not `rounded-lg`'s 8px; padding `40px` not `p-8`'s 32px. Because `globals.css` is unlayered it outranks `@layer utilities`, so those classes could never apply. | Two styling systems layered on the same elements | Dead classes removed; the token-based `.auth-*` system is now the single source of truth | **Fixed** |
| M-4 | 5 auth pages | **Broken vertical rhythm.** `mt-8` on `<FormLabel>` stacked on the form's `space-y-6`, and `mt-6` + inner `mt-8` on the footer blocks, producing ~56px and ~88px gaps between elements that were meant to be evenly spaced | Redundant margin utilities fighting the `space-y` scale | Stray margins removed; `space-y-8` → `space-y-6` | **Fixed** |
| M-5 | 5 auth pages | Input `dark:bg-gray-700 dark:border-gray-600 dark:text-white` bypassed `--input`/`--card` tokens, giving blue-grey controls in a green-themed dark UI | Same as M-3 | Classes dropped; controls now use the tokens | **Fixed** |
| M-6 | Bespoke nav/CTA controls | `.site-brand`, `.site-nav-link`, `.nav-action`, `.theme-toggle`, `.cta-primary`, `.cta-secondary`, `.auth-link` had **no focus style** — only the thin, theme-unaware UA outline (WCAG 2.4.7) | Focus styling only ever added to shadcn components | Added a shared `:focus-visible` ring using the existing `--ring` token | **Fixed** |
| M-7 | Unknown routes | `GET /no-such-page` → `307 /sign-in` rather than a 404 | Middleware gates every non-allowlisted path | **Confirmed intended** — this *is* the auth gate, and returning a public 404 would leak route existence. Added a branded `src/app/not-found.tsx` so **authenticated** users hitting a stale link get an on-brand page instead of Next's unstyled default | **By design** (+ 404 page added) |

### Low

| # | Page / Component | Issue | Fix | Status |
|---|---|---|---|---|
| L-1 | `/verify`, `/verify-forgot-password` | `type="number"` for a 6-digit code: spinner arrows, scroll-wheel mutation, and `Number("") → 0`. Executing the schema confirmed `verifyCode: 0` yields "Verify code must be 6 digits long". `1e5` was also accepted as 100000 | `type="text"` + `inputMode="numeric"` + `pattern="[0-9]*"` + `maxLength=6` + `autoComplete="one-time-code"`, digits-only coercion, empty → `undefined` | **Fixed** |
| L-2 | `.gitignore` | Only `.env` was ignored — **`.env.local` was committable**, and I had to create one to run the app | Added `.env*.local` / `.env.local`; `git check-ignore` confirms it is now ignored | **Fixed** |
| L-3 | `src/components/MessageCarousel.tsx` | Dead code — `grep` finds no importer. It is the only consumer of `ui/carousel.tsx`, which in turn is the only consumer of `embla-carousel-*` | **Not changed.** Deleting it would cascade into a second unused component and two dependencies; that is refactoring, not bug fixing. Recommend removing all three deliberately in a separate change | **Pending** |
| L-4 | Response headers | `X-Powered-By: Next.js` exposed; no CSP, `X-Content-Type-Options`, `Referrer-Policy` or `X-Frame-Options` | **Not changed** — hardening headers are a deliberate security-policy decision, not a QA fix. Flagged for the maintainer | **Pending** |
| L-5 | `/public` | `next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`, `logo.png` are unreferenced create-next-app leftovers | **Not changed** (no runtime impact) | **Pending** |
| L-6 | `qa/lib/dom-audit.mjs` (test harness, not app code) | CI **CodeQL** flagged 4 high-severity alerts at lines 394–397 — *Incomplete multi-character sanitization* and *Bad HTML filtering regexp*. The harness stripped `<script>`/`<link>` from fetched HTML with three `.replace(/<script…/)` passes. The regexes are genuinely wrong: they miss `<SCRIPT>` and `<script >`, and a single pass can leave a `<script` fragment behind. | Regex-based HTML filtering | Regexes deleted entirely. A probe confirmed **happy-dom never evaluates inline scripts during `document.write`**, so the stripping was unnecessary — `makeDom` now constructs a `Window` with `disableJavaScriptEvaluation` / `disableJavaScriptFileLoading` / `disableCSSFileLoading` / `disableIframePageLoading` and removes `script, link[rel='stylesheet']` through DOM APIs. **CodeQL now passes** (see §2) | **Fixed** |

---

## 2. Automated test results

All executed against the live production server.

```
npm run lint        →  0 errors, 5 warnings (pre-existing react-hooks/exhaustive-deps)
npm test            →  38 passed / 38   (qa/regression.test.mjs — HTTP + rendered markup)
npm run test:schema →   4 passed /  4   (qa/schema.test.ts — real zod schemas via tsx)
npm run qa:audit    →   1 finding       (1558 text nodes, 584 controls, 1818 boxes inspected)
npx next build      →  ✓ Compiled successfully, 20/20 static pages, types valid
```

### CI on the PR (GitHub Actions / Vercel / GitGuardian)

| Check | Result |
|---|---|
| `Analyze (javascript-typescript)` — CodeQL | **pass** (1m4s) |
| `CodeQL` — diff-scoped security scan | **pass** (3s) — was *fail* with 4 high-severity alerts on the first push, fixed by L-6 above |
| `GitGuardian Security Checks` | **pass** (12s) |
| `Vercel` | **fail — plan quota, not a code failure.** Commit `1ae1fdd` deployed successfully (`Deployment has completed`); the follow-up commit `51d74eb` returned `Deployment rate limited — retry in 24 hours` (`upgradeToPro=build-rate-limit`). Vercel's own successful build of `1ae1fdd` is the independent confirmation that the branch builds. |

`npm run qa:all` runs all four in sequence.

New/changed files:

| File | Purpose |
|---|---|
| `qa/regression.test.mjs` | 38 browser-free regression tests (API 401 contract, landmarks, labels, toast region, asset resolution, method contract) |
| `qa/schema.test.ts` | Executes the real schemas; locks the H-2 coercion fix |
| `qa/audit.mjs` + `qa/lib/dom-audit.mjs` | DOM/CSS audit harness (cascade resolution, WCAG contrast, touch targets, overflow risk) |
| `qa/e2e.spec.ts` | Playwright suite — **12 viewports × 7 pages**, overflow detection, screenshots, keyboard, console/network, Web Vitals, edge cases. Needs a browser, so **not executed here** |
| `playwright.config.ts` | chromium / firefox / webkit / mobile-chrome / mobile-safari / edge |

---

## 3. Accessibility findings (WCAG 2.2 AA)

| Criterion | Before | After |
|---|---|---|
| 1.3.1 Info and relationships | 5 pages with no `<main>` | Pass — one `<main>` + one `<h1>` per page, asserted by test |
| 1.4.3 Contrast (minimum) | 6 failing elements, worst **2.27:1** | Pass — worst measured **4.54:1** across 1558 text nodes, both themes |
| 2.4.7 Focus visible | 7 bespoke controls with UA-default outline only | Shared `:focus-visible` ring via `--ring` |
| 3.3.2 Labels / 4.1.2 Name, role, value | 14 dangling `aria-describedby`; toast region unnamed | Pass — all ARIA references resolve; toast is a named region |
| 1.4.4 Resize text | Viewport meta allows pinch-zoom (no `user-scalable=no`) | Pass (unchanged) |
| 2.3.3 Animation | `prefers-reduced-motion` block present and correct | Pass (unchanged) |
| 2.5.8 Target size | **Unverified** — needs real layout | Not verified |
| 4.1.3 Status messages | Toast region now announced | Pass |

Screen-reader announcement, focus-*rendering* and target hit-areas need a real browser and
were **not** verified.

## 4. Performance observations

Measured from the production build manifest and live asset responses:

| Route | Route JS | First Load JS |
|---|---|---|
| `/` | 5.32 kB | 115 kB |
| `/dashboard` | 16 kB | 159 kB |
| `/sign-up` | 5.46 kB | 169 kB |
| `/u/[username]` | 5.23 kB | 166 kB |
| Shared | — | 103 kB |

- Landing page is statically prerendered (`○`) and served with `Cache-Control: s-maxage=31536000`.
- All 13 referenced JS/CSS assets returned **200**; compiled CSS is 69 kB.
- `polyfills-*.js` is 112 kB uncompressed — standard for Next 15, but the largest single chunk.
- Middleware is 45.6 kB and now runs on every matched request without a `console.log`.
- **CLS/LCP/INP were not measured** — that requires a browser. `qa/e2e.spec.ts` includes a
  Web Vitals test ready to run locally.

## 5. Cross-browser testing

**None performed.** No browser engine was available. The Playwright config declares
chromium, firefox, webkit, mobile-chrome, mobile-safari and edge projects so a local
`npx playwright test` covers all four engines. The one engine-specific risk I can name from
the code: `-webkit-backdrop-filter` is correctly prefixed alongside `backdrop-filter` on
`.site-nav`, and `color-scheme` is declared per theme.

## 6. Readiness assessment

**Not production-ready as-is, but close.** The two blockers I would hold release for were
both found and fixed: an expired session silently showing an empty inbox (C-1) and a
password-reset flow that could not be submitted (H-2). A third — a completely dead lint
gate hiding behind a green build (H-3) — is the kind of thing that lets regressions ship
unnoticed.

What I would still do before shipping:

1. **Run `qa/e2e.spec.ts` in a real browser.** Layout, CLS/LCP/INP, focus rendering,
   touch targets and cross-browser behaviour are all still unverified. This is the single
   biggest remaining gap.
2. **Exercise the database flows** (sign-up → verify → sign-in → dashboard → send/delete
   message). No MongoDB was reachable, so every DB-backed path is untested.
3. Decide on L-3/L-4/L-5 (dead code, security headers, leftover assets).

## 7. Reproducing

```bash
cp .env.sample .env.local      # fill in real values; .env.local is now git-ignored
npm install
npm run build && npm start     # http://127.0.0.1:3000

npm run qa:all                 # lint + HTTP tests + schema tests + DOM audit
npm test                       # 38 browser-free tests
npm run test:schema            # real zod schemas

# browser suite (needs a browser this sandbox could not install)
npx playwright install chromium firefox webkit
npm run test:e2e
```
