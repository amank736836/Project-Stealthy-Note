/**
 * Regression suite for the issues confirmed during the QA audit.
 *
 *   node --test qa/
 *
 * Runs against a live server (default http://127.0.0.1:3000). These are
 * HTTP + server-rendered-markup assertions: they need no browser, so they run
 * anywhere, including CI without Playwright binaries.
 * Browser-only behaviour is covered separately by qa/e2e.spec.ts (Playwright).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
const PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/verify", "/verify-forgot-password", "/u/alice"];

let server;
before(async () => {
  const res = await fetch(BASE + "/", { redirect: "manual" });
  assert.ok(res.status === 200, `server not reachable at ${BASE} (got ${res.status})`);
  server = true;
});
after(() => assert.ok(server));

const html = async (path) => (await fetch(BASE + path)).text();

/* ------------------------------------------------------------------ */

describe("QA-001 unauthenticated API access must not redirect to an HTML page", () => {
  const PROTECTED = ["/api/get-messages", "/api/accept-messages", "/api/delete-message/abc123"];

  for (const path of PROTECTED) {
    it(`GET ${path} -> 401 JSON (was 307 -> /sign-in)`, async () => {
      const res = await fetch(BASE + path, { redirect: "manual" });
      assert.equal(res.status, 401, `expected 401, got ${res.status}`);
      assert.equal(res.headers.get("location"), null, "must not carry a redirect Location");
      assert.match(res.headers.get("content-type") || "", /application\/json/);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(typeof body.message, "string");
    });
  }

  it("the 401 is not followed into the sign-in document", async () => {
    const res = await fetch(BASE + "/api/get-messages"); // follow redirects
    assert.equal(res.status, 401);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    const text = await res.text();
    assert.doesNotMatch(text, /<!DOCTYPE html>/i, "axios must never receive HTML here");
  });

  it("public API routes stay reachable without a session", async () => {
    for (const path of ["/api/send-message", "/api/suggest-messages", "/api/sign-up", "/api/verifyCode"]) {
      const res = await fetch(BASE + path, { redirect: "manual" });
      assert.notEqual(res.status, 401, `${path} should not be gated`);
      assert.notEqual(res.status, 307, `${path} should not redirect`);
    }
  });
});

describe("QA-002 middleware must not log the session token", () => {
  it("no console.log of the decoded JWT in src/middleware.ts", () => {
    const src = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /console\.log\s*\(\s*token\s*\)/);
    assert.doesNotMatch(src, /console\.(log|info|debug)\s*\(/);
  });
});

describe("QA-003 pages render and expose correct document semantics", () => {
  for (const path of PAGES) {
    it(`GET ${path} -> 200`, async () => {
      const res = await fetch(BASE + path, { redirect: "manual" });
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    });

    it(`${path} has lang, title, viewport and a single <main>`, async () => {
      const doc = await html(path);
      assert.match(doc, /<html[^>]+lang="en"/, "missing lang");
      assert.match(doc, /<title>[^<]+<\/title>/, "missing title");
      assert.match(doc, /<meta name="viewport" content="width=device-width, initial-scale=1"/, "missing viewport");
      assert.doesNotMatch(doc, /user-scalable=no|maximum-scale=1[,;"]/i, "viewport blocks pinch zoom");
      assert.equal((doc.match(/<main[\s>]/g) || []).length, 1, `${path} must have exactly one <main>`);
      assert.equal((doc.match(/<h1[\s>]/g) || []).length, 1, `${path} must have exactly one <h1>`);
    });
  }
});

describe("QA-004 toast live region is named for screen readers", () => {
  for (const path of ["/", "/sign-in"]) {
    it(`${path} toast viewport has role="region" and aria-label`, async () => {
      const doc = await html(path);
      const ol = doc.match(/<ol[^>]*class="[^"]*fixed top-0 z-\[100\][^"]*"[^>]*>/);
      assert.ok(ol, "toast viewport <ol> not found");
      assert.match(ol[0], /role="region"/, "toast viewport needs role=region");
      assert.match(ol[0], /aria-label="[^"]+"/, "toast viewport needs an accessible name");
    });
  }
});

describe("QA-005 form controls are labelled", () => {
  const CASES = [
    ["/sign-in", 2],
    ["/sign-up", 4],
    ["/forgot-password", 1],
    ["/verify", 2],
    ["/verify-forgot-password", 4],
  ];
  for (const [path, count] of CASES) {
    it(`${path}: every input id is targeted by a <label for>`, async () => {
      const doc = await html(path);
      const ids = [...doc.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(ids.length, count, `expected ${count} inputs, found ${ids.length}`);
      const labels = new Set([...doc.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
      for (const id of ids) assert.ok(labels.has(id), `input #${id} has no <label for>`);
    });
  }

  it("/u/alice: the textarea is labelled by its own id", async () => {
    const doc = await html("/u/alice");
    assert.match(doc, /<label[^>]*for="anonymous-message"/);
    assert.match(doc, /<textarea[^>]*id="anonymous-message"/);
  });
});

describe("QA-006 unknown routes", () => {
  it("signed-out visitors are gated to /sign-in (intentional)", async () => {
    const res = await fetch(BASE + "/definitely-not-a-route", { redirect: "manual" });
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "/sign-in");
  });

  it("a branded not-found document is built and served for unmatched routes", async () => {
    // Reached by authenticated users; the prerendered document is what they get.
    const doc = readFileSync(new URL("../.next/server/app/_not-found.html", import.meta.url), "utf8");
    assert.match(doc, /This page isn.t here/);
    assert.match(doc, /Back to home/);
    assert.match(doc, /<main[\s>]/, "404 page needs a <main> landmark");
  });
});

describe("QA-007 static assets resolve", () => {
  it("every stylesheet/script referenced by the landing page returns 200", async () => {
    const doc = await html("/");
    const urls = [...doc.matchAll(/(?:href|src)="(\/_next\/[^"]+\.(?:css|js))"/g)].map((m) => m[1]);
    assert.ok(urls.length > 5, "expected several asset references");
    for (const u of [...new Set(urls)]) {
      const res = await fetch(BASE + u);
      assert.equal(res.status, 200, `${u} -> ${res.status}`);
    }
  });
});

describe("QA-008 HTTP method contract", () => {
  const POST_ONLY = ["/api/sign-up", "/api/send-message", "/api/suggest-messages", "/api/verifyCode", "/api/forgot-password", "/api/verify-forgot-password"];
  for (const path of POST_ONLY) {
    it(`GET ${path} -> 405 (not 500, not HTML)`, async () => {
      const res = await fetch(BASE + path, { redirect: "manual" });
      assert.equal(res.status, 405, `expected 405, got ${res.status}`);
    });
  }

  it("check-username-unique rejects a missing username with 400 JSON", async () => {
    const res = await fetch(BASE + "/api/check-username-unique");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });
});
