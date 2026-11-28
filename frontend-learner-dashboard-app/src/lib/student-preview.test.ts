/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PREVIEW_FRAME_NAME,
  isAllowedPreviewOrigin,
  isStudentPreviewMode,
  siteOf,
} from "./student-preview";

describe("siteOf", () => {
  it("keeps the registrable domain", () => {
    expect(siteOf("learner.myschool.com")).toBe("myschool.com");
    expect(siteOf("admin.myschool.com")).toBe("myschool.com");
    expect(siteOf("a.b.example.co.in")).toBe("example.co.in");
    expect(siteOf("localhost")).toBe("localhost");
  });
});

describe("isAllowedPreviewOrigin", () => {
  const custom = "learner.myschool.com";
  const shared = "my-school.vacademy.io";

  it("accepts the shared admin, white-label admins on vacademy.io and the institute's own admin", () => {
    expect(isAllowedPreviewOrigin("https://dash.vacademy.io", shared)).toBe(true);
    expect(isAllowedPreviewOrigin("https://acme-admin.vacademy.io", shared)).toBe(true);
    expect(isAllowedPreviewOrigin("https://admin-acme.vacademy.io", shared)).toBe(true);
    expect(isAllowedPreviewOrigin("https://admin.myschool.com", custom)).toBe(true);
    expect(
      isAllowedPreviewOrigin("https://portal.example.org", "learner.other.org", {
        adminHosts: ["portal.example.org"],
      })
    ).toBe(true);
  });

  it("never lets one institute's vacademy.io site drive another's", () => {
    expect(isAllowedPreviewOrigin("https://other-school.vacademy.io", shared)).toBe(false);
    expect(isAllowedPreviewOrigin("https://badminton.vacademy.io", shared)).toBe(false);
    expect(isAllowedPreviewOrigin("https://learner.vacademy.io", shared)).toBe(false);
  });

  it("localhost only in a dev build", () => {
    expect(isAllowedPreviewOrigin("http://localhost:5173", custom)).toBe(false);
    expect(isAllowedPreviewOrigin("http://localhost:5173", custom, { dev: true })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAllowedPreviewOrigin("https://evil.com", custom)).toBe(false);
    expect(isAllowedPreviewOrigin("https://myschool.com.evil.com", custom)).toBe(false);
    expect(isAllowedPreviewOrigin("https://notvacademy.io", shared)).toBe(false);
    expect(isAllowedPreviewOrigin("null", custom)).toBe(false);
    expect(isAllowedPreviewOrigin("https://other.co.in", "learner.mine.co.in")).toBe(false);
  });
});

describe("isStudentPreviewMode", () => {
  afterEach(() => {
    window.name = "";
  });
  it("is off in a top-level window, even with the frame name", () => {
    window.name = PREVIEW_FRAME_NAME;
    expect(isStudentPreviewMode()).toBe(false);
  });
});
