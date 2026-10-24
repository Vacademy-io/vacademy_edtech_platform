// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isSignupLinkVisible } from "./signup-link-visibility";

describe("isSignupLinkVisible", () => {
  afterEach(() => localStorage.clear());

  it("honours the domain-routing flag whenever the backend said something", () => {
    expect(isSignupLinkVisible(true)).toBe(true);
    expect(isSignupLinkVisible(false)).toBe(false);
  });

  it("is hidden on a store with no institute (every fresh native install)", () => {
    expect(isSignupLinkVisible(undefined)).toBe(false);
    expect(isSignupLinkVisible(null)).toBe(false);
  });

  it("falls back to the legacy LEARNER_<id> mirror when the flag is unknown", () => {
    localStorage.setItem("InstituteId", "inst-1");
    expect(isSignupLinkVisible(undefined)).toBe(true);

    localStorage.setItem("LEARNER_inst-1", JSON.stringify({ allowSignup: false }));
    expect(isSignupLinkVisible(undefined)).toBe(false);

    localStorage.setItem("LEARNER_inst-1", JSON.stringify({ allowSignup: null }));
    expect(isSignupLinkVisible(undefined)).toBe(true);
  });

  it("a positive flag beats a stale negative mirror", () => {
    localStorage.setItem("InstituteId", "inst-1");
    localStorage.setItem("LEARNER_inst-1", JSON.stringify({ allowSignup: false }));
    expect(isSignupLinkVisible(true)).toBe(true);
  });

  it("hides on a corrupt mirror — we cannot tell, so do not offer it", () => {
    localStorage.setItem("InstituteId", "inst-1");
    localStorage.setItem("LEARNER_inst-1", "{not json");
    expect(isSignupLinkVisible(undefined)).toBe(false);
  });
});
