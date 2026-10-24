import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web" },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn(), close: vi.fn() } }));
vi.mock("@/utils/platform-flavor", () => ({ getPlatformFlavorInfo: vi.fn() }));

import { nativeOAuthHandoff } from "./native-oauth-handoff";
import { withNativeOAuthCallback } from "./nativeOAuth";

const RETURN = "https://student.elevateeducation.in/login/oauth/learner";

describe("nativeOAuthHandoff", () => {
  it("hands tokens to a listed app id, dropping native_cb", () => {
    expect(nativeOAuthHandoff(`${RETURN}?native_cb=io.elevateeducation.app&accessToken=a.b.c&refreshToken=r%2Bt`)).toBe(
      "io.elevateeducation.app://login/oauth/learner?accessToken=a.b.c&refreshToken=r%2Bt",
    );
  });

  it("passes errors through too", () => {
    expect(nativeOAuthHandoff(`${RETURN}?native_cb=io.elevateeducation.app&session_limit_exceeded=true`)).toBe(
      "io.elevateeducation.app://login/oauth/learner?session_limit_exceeded=true",
    );
  });

  it("refuses app ids that are not ours, and plain web returns", () => {
    expect(nativeOAuthHandoff(`${RETURN}?native_cb=com.evil.app&accessToken=a`)).toBeNull();
    expect(nativeOAuthHandoff(`${RETURN}?native_cb=toString&accessToken=a`)).toBeNull();
    expect(nativeOAuthHandoff(`${RETURN}?accessToken=a&refreshToken=b`)).toBeNull();
  });
});

describe("withNativeOAuthCallback", () => {
  it("adds native_cb to the state's return URL and nothing else", () => {
    const state = { from: RETURN, account_type: "login", user_type: "learner", institute_id: "i-1" };
    const url = `https://backend.example/auth-service/oauth2/authorization/google?state=${encodeURIComponent(btoa(JSON.stringify(state)))}`;
    const out = new URL(withNativeOAuthCallback(url, "io.elevateeducation.app"));
    expect(out.pathname).toBe("/auth-service/oauth2/authorization/google");
    const decoded = JSON.parse(atob(out.searchParams.get("state")!));
    expect(decoded).toEqual({ ...state, from: `${RETURN}?native_cb=io.elevateeducation.app` });
  });

  it("leaves a URL without state untouched", () => {
    expect(withNativeOAuthCallback("https://backend.example/x", "io.elevateeducation.app")).toBe("https://backend.example/x");
  });
});
