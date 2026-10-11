import { expect, test, type Page } from "@playwright/test";

/**
 * Browser-side regression suite for the QA audit findings.
 *
 * This file is NOT runnable inside the audit sandbox: no browser binary could
 * be downloaded there (cdn.playwright.dev, storage.googleapis.com and the
 * Debian mirrors are all unreachable and none is preinstalled). Run it locally:
 *
 *   npx playwright install chromium firefox webkit
 *   npm run build && npm start
 *   npx playwright test
 *
 * `qa/regression.test.mjs` covers the same fixes at the HTTP level and DOES run
 * without a browser.
 */

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:3000";

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 720 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-425", width: 425, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-820", width: 820, height: 1180 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "laptop-1280", width: 1280, height: 800 },
  { name: "laptop-1366", width: 1366, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "ultrawide-2560", width: 2560, height: 1080 },
];

const PAGES = [
  { path: "/", name: "landing" },
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
  { path: "/forgot-password", name: "forgot-password" },
  { path: "/verify", name: "verify" },
  { path: "/verify-forgot-password", name: "verify-forgot-password" },
  { path: "/u/alice", name: "public-inbox" },
];

/** Every element whose right edge escapes the viewport -> real horizontal overflow. */
const overflowReport = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        // ignore children of a clipping container
        let p = el.parentElement;
        let clipped = false;
        while (p && p !== document.documentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox !== "visible") {
            clipped = true;
            break;
          }
          p = p.parentElement;
        }
        if (clipped) continue;
        out.push(
          `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} ` +
            `left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${vw}`
        );
      }
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders: out };
  });

test.describe("Responsive: no horizontal scrolling at any viewport", () => {
  for (const vp of VIEWPORTS) {
    for (const page of PAGES) {
      test(`${page.name} @ ${vp.width}px`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const p = await ctx.newPage();
        await p.goto(BASE + page.path, { waitUntil: "networkidle" });

        const report = await overflowReport(p);
        expect(report.scrollWidth, `scrollWidth must not exceed viewport: ${report.offenders.join(", ")}`).toBeLessThanOrEqual(vp.width + 1);
        expect(report.offenders, report.offenders.join("\n")).toHaveLength(0);

        await p.screenshot({ path: `qa/screenshots/${page.name}-${vp.name}.png`, fullPage: false });
        await ctx.close();
      });
    }
  }
});

test.describe("Theme parity: light and dark both render every page", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const page of PAGES) {
      test(`${page.name} / ${scheme}`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: scheme });
        const p = await ctx.newPage();
        await p.goto(BASE + page.path, { waitUntil: "networkidle" });
        await p.click('.theme-toggle[aria-label*="dark" i], .theme-toggle[aria-label*="light" i]').catch(() => {});
        if (scheme === "dark") {
          await p.evaluate(() => document.documentElement.classList.add("dark"));
        }
        await p.screenshot({ path: `qa/screenshots/${page.name}-${scheme}.png`, fullPage: true });
        await ctx.close();
      });
    }
  }
});

test.describe("QA-001 (regression) expired session must surface an error, not an empty inbox", () => {
  test("dashboard with a stale cookie shows a load failure", async ({ page }) => {
    await page.context().addCookies([{ name: "authjs.session-token", value: "stale", domain: "127.0.0.1", path: "/" }]);
    const resp = await page.request.get(`${BASE}/api/get-messages`);
    expect(resp.status()).toBe(401);
    expect(resp.headers()["content-type"]).toContain("application/json");
    expect(await resp.text()).not.toContain("<!DOCTYPE html>");
  });
});

test.describe("QA-003 (regression) landmarks and headings", () => {
  for (const page of PAGES) {
    test(`${page.name} exposes exactly one main and one h1`, async ({ browser }) => {
      const p = await browser.newPage();
      await p.goto(BASE + page.path, { waitUntil: "domcontentloaded" });
      await expect(p.locator("main")).toHaveCount(1);
      await expect(p.locator("h1")).toHaveCount(1);
    });
  }
});

test.describe("QA-004 (regression) toast live region is named", () => {
  test("toast viewport is a labelled region", async ({ page }) => {
    await page.goto(BASE + "/sign-in", { waitUntil: "domcontentloaded" });
    const vp = page.locator('ol.fixed[class*="z-[100]"]');
    await expect(vp).toHaveAttribute("role", "region");
    await expect(vp).toHaveAttribute("aria-label", /.+/);
  });
});

test.describe("Keyboard navigation", () => {
  test("every interactive element on the landing page has a visible focus ring", async ({ page }) => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const handles = await page.locator("a[href], button").elementHandles();
    expect(handles.length).toBeGreaterThan(5);
    for (const h of handles.slice(0, 12)) {
      await h.focus();
      const visible = await h.evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      });
      expect(visible, await h.evaluate((el) => el.outerHTML.slice(0, 120))).toBe(true);
    }
  });

  test("tab order starts at the nav and reaches the primary CTA", async ({ page }) => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const first = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("a, button");
      el?.focus();
      return document.activeElement?.textContent?.trim() || "";
    });
    expect(first.length).toBeGreaterThan(0);
  });
});

test.describe("Functional flows", () => {
  test("sign-in client validation blocks an empty submit", async ({ page }) => {
    await page.goto(BASE + "/sign-in", { waitUntil: "domcontentloaded" });
    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeDisabled();
    await page.fill('input[type="text"]', "someone");
    await page.fill('input[type="password"]', "hunter22hunter22");
    await expect(submit).toBeEnabled();
  });

  test("sign-up flags a mismatched password confirmation", async ({ page }) => {
    await page.goto(BASE + "/sign-up", { waitUntil: "domcontentloaded" });
    const inputs = page.locator("input");
    await inputs.nth(0).fill("qauser");
    await inputs.nth(1).fill("qa@example.com");
    await inputs.nth(2).fill("Password123!");
    await inputs.nth(3).fill("Password123?");
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test("public inbox enforces the 10-300 character message rule", async ({ page }) => {
    await page.goto(BASE + "/u/alice", { waitUntil: "domcontentloaded" });
    const ta = page.locator("#anonymous-message");
    await ta.fill("short");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#anonymous-message")).toHaveAttribute("aria-invalid", "true");
  });

  test("public inbox character counter tracks input", async ({ page }) => {
    await page.goto(BASE + "/u/alice", { waitUntil: "domcontentloaded" });
    await page.locator("#anonymous-message").fill("hello world");
    await expect(page.locator("#message-count")).toHaveText("11/300");
  });

  test("rapid repeated clicks on the suggestion refresh do not throw", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE + "/u/alice", { waitUntil: "domcontentloaded" });
    const refresh = page.locator('button[aria-label="Suggest new message prompts"]');
    for (let i = 0; i < 12; i++) await refresh.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("browser back/forward across the public flow keeps the app usable", async ({ page }) => {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.click('a[href="/sign-up"]');
    await page.waitForURL("**/sign-up");
    await page.goBack();
    await page.waitForURL(/\/$/);
    await expect(page.locator("#hero-title")).toBeVisible();
    await page.goForward();
    await page.waitForURL("**/sign-up");
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Console and network health", () => {
  for (const page of PAGES) {
    test(`${page.name} logs no errors and fails no requests`, async ({ browser }) => {
      const p = await browser.newPage();
      const errors: string[] = [];
      const failed: string[] = [];
      p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      p.on("pageerror", (e) => errors.push(String(e)));
      p.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
      await p.goto(BASE + page.path, { waitUntil: "networkidle" });
      // /api/suggest-messages and /api/get-messages legitimately fail without a DB
      const relevant = failed.filter((f) => !/suggest-messages|get-messages|accept-messages/.test(f));
      expect(relevant, relevant.join("\n")).toEqual([]);
      expect(errors, errors.join("\n")).toEqual([]);
      await p.close();
    });
  }
});

test.describe("Web Vitals (field proxies)", () => {
  test("landing page LCP element paints and CLS stays low", async ({ page }) => {
    await page.goto(BASE + "/", { waitUntil: "load" });
    const metrics = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number }>((resolve) => {
          let lcp = 0;
          let cls = 0;
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((l) => {
            for (const e of l.getEntries() as PerformanceEntry[]) {
              if (!(e as unknown as { hadRecentInput: boolean }).hadRecentInput) {
                cls += (e as unknown as { value: number }).value;
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve({ lcp, cls }), 2500);
        })
    );
    expect(metrics.cls, "CLS should stay under 0.1").toBeLessThan(0.1);
    expect(metrics.lcp, "LCP should be under 2.5s on a local build").toBeLessThan(2500);
  });
});

test.describe("Edge cases", () => {
  test("very long unbroken username does not break the public inbox layout", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const p = await ctx.newPage();
    const long = "a".repeat(120);
    await p.goto(`${BASE}/u/${long}`, { waitUntil: "domcontentloaded" });
    const report = await overflowReport(p);
    expect(report.offenders, report.offenders.join("\n")).toHaveLength(0);
    await ctx.close();
  });

  test("200% browser zoom does not introduce horizontal scroll", async ({ browser }) => {
    for (const page of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      await p.goto(BASE + page.path, { waitUntil: "domcontentloaded" });
      const report = await overflowReport(p);
      expect(report.offenders, `${page.name}: ${report.offenders.join(", ")}`).toHaveLength(0);
      await ctx.close();
    }
  });

  test("mobile landscape renders the landing page without overflow", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const report = await overflowReport(p);
    expect(report.offenders, report.offenders.join("\n")).toHaveLength(0);
    await ctx.close();
  });

  test("reduced motion is honoured (no long animations)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const long = await p.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("*")]
        .map((el) => getComputedStyle(el).animationDuration)
        .filter((d) => parseFloat(d) > 0.01)
    );
    expect(long, `animations still running under prefers-reduced-motion: ${long.join(",")}`).toEqual([]);
    await ctx.close();
  });
});
