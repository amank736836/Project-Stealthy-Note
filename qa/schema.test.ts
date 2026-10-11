/**
 * Schema regression tests. Runs the REAL zod schemas from src/backend/schemas
 * through node --import tsx, so a type/shape drift between a form and its
 * schema fails the build.
 *
 *   npm run test:schema
 */
import { userVerifySchema } from "@/backend/schemas/userVerifySchema";
import { verifyForgotPasswordSchema } from "@/backend/schemas/verifyForgotPasswordSchema";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PASSWORD = "Password123$"; // satisfies passwordValidation's charset rule

describe("QA-009 verification code must accept what the forms actually store", () => {
  it("userVerifySchema accepts the coerced number the /verify form stores", () => {
    const r = userVerifySchema.safeParse({ identifier: "qauser", verifyCode: 123456 });
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  it("userVerifySchema rejects a non 6-digit code with the intended message", () => {
    for (const bad of [0, 12345, 1234567]) {
      const r = userVerifySchema.safeParse({ identifier: "qauser", verifyCode: bad });
      assert.equal(r.success, false, `${bad} should be rejected`);
      assert.match((r as { error: { issues: { message: string }[] } }).error.issues[0].message, /6 digits/);
    }
  });

  it("verifyForgotPasswordSchema accepts the coerced number (regression: string used to fail)", () => {
    const r = verifyForgotPasswordSchema.safeParse({
      identifier: "qauser",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      verifyCode: 123456,
    });
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
  });

  it("verifyForgotPasswordSchema still rejects an out-of-range code", () => {
    const r = verifyForgotPasswordSchema.safeParse({
      identifier: "qauser",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      verifyCode: 9999,
    });
    assert.equal(r.success, false);
  });
});
