import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/i18n", () => ({ default: { t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? "" } }));

import { existingAccountSignInHref, isExistingAccountWithoutSession } from "./existing-account-sign-in";

describe("register answer for an account that signs in itself", () => {
  it("is recognised only with account_exists and no tokens", () => {
    expect(isExistingAccountWithoutSession({ account_exists: true, accessToken: null, refreshToken: null })).toBe(true);
    expect(isExistingAccountWithoutSession({ accessToken: "a", refreshToken: "r" })).toBe(false);
    expect(isExistingAccountWithoutSession({ account_exists: true, accessToken: "a" })).toBe(false);
    expect(isExistingAccountWithoutSession({ accessToken: null })).toBe(false);
    expect(isExistingAccountWithoutSession(null)).toBe(false);
  });

  it("opens the prefilled OTP sign-in and comes back to the enrollment result", () => {
    expect(existingAccountSignInHref({ email: "a@x.com", redirect: "/study-library/courses" })).toBe(
      "/login?method=otp&email=a%40x.com&redirect=%2Fstudy-library%2Fcourses",
    );
  });

  it("falls back to the plain sign-in page when nothing can be prefilled", () => {
    expect(existingAccountSignInHref({ redirect: "/study-library/courses" })).toBe(
      "/login?redirect=%2Fstudy-library%2Fcourses",
    );
    expect(existingAccountSignInHref({})).toBe("/login");
  });
});
