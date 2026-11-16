// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_INSTRUCTION_KEY,
  followNavigation,
  isCommerceLink,
  isSellingOnlyLink,
  navigationHref,
  toNavigation,
  type FollowDeps,
  type LinkContext,
} from "./link-target";
import type { ResolvedLink } from "@/types/learner-home";

const web: LinkContext = { readerMode: false, playSkin: false, primaryBatchId: "ps-1" };
const reader: LinkContext = { ...web, readerMode: true };

describe("toNavigation: every kind to its route", () => {
  it("COURSE owned goes to the learner's course, with its batch", () => {
    expect(
      toNavigation({ kind: "COURSE", package_id: "p1", owned: true, package_session_id: "ps-9", commerce: false }, web)
    ).toEqual({
      kind: "route",
      to: "/study-library/courses/course-details",
      search: { courseId: "p1", packageSessionId: "ps-9" },
    });
  });

  it("COURSE not owned goes to the public course page", () => {
    expect(toNavigation({ kind: "COURSE", package_id: "p1", owned: false, commerce: true }, web)).toEqual({
      kind: "route",
      to: "/courses/course-details",
      search: { courseId: "p1" },
    });
  });

  it("COURSE_LIST with and without a tag", () => {
    expect(toNavigation({ kind: "COURSE_LIST", tag: "JEE 2027" }, web)).toEqual({
      kind: "route",
      to: "/study-library/courses",
      search: { tag: "JEE 2027" },
    });
    expect(toNavigation({ kind: "COURSE_LIST", tag: null }, web)).toEqual({ kind: "route", to: "/study-library/courses" });
  });

  it("PRODUCT_PAGE", () => {
    expect(toNavigation({ kind: "PRODUCT_PAGE", code: "diwali", commerce: true }, web)).toEqual({
      kind: "route",
      to: "/product-pages/$productPageCode",
      params: { productPageCode: "diwali" },
    });
  });

  it("LIVE_CLASS carries whether the learner's batch has it (in-app join, Q14)", () => {
    expect(toNavigation({ kind: "LIVE_CLASS", session_id: "s1", in_my_batch: true }, web)).toEqual({
      kind: "live-class",
      sessionId: "s1",
      inMyBatch: true,
    });
    expect(toNavigation({ kind: "LIVE_CLASS", session_id: "s1" }, web)).toMatchObject({ inMyBatch: false });
  });

  it("ASSESSMENT clears the stale instructions key first", () => {
    expect(toNavigation({ kind: "ASSESSMENT", assessment_id: "a1" }, web)).toEqual({
      kind: "route",
      to: "/assessment/examination/$assessmentId",
      params: { assessmentId: "a1" },
      before: "CLEAR_ASSESSMENT_KEY",
    });
  });

  it("URL: web links open outside the app, mailto/tel are handed to the browser", () => {
    expect(toNavigation({ kind: "URL", url: "https://example.com/x" }, web)).toEqual({
      kind: "external",
      url: "https://example.com/x",
    });
    expect(toNavigation({ kind: "URL", url: "mailto:a@b.co" }, web)).toEqual({ kind: "assign", url: "mailto:a@b.co" });
    expect(toNavigation({ kind: "URL", url: "tel:+911234" }, web)).toEqual({ kind: "assign", url: "tel:+911234" });
  });

  it("URL: javascript:, data: and relative values are never followed", () => {
    expect(toNavigation({ kind: "URL", url: "javascript:alert(1)" }, web)).toBeNull();
    expect(toNavigation({ kind: "URL", url: "data:text/html,x" }, web)).toBeNull();
    expect(toNavigation({ kind: "URL", url: "/dashboard" }, web)).toBeNull();
  });

  it("APP_PATH: plain path, path with a query, and the dead '/'", () => {
    expect(toNavigation({ kind: "APP_PATH", path: "/notebook" }, web)).toEqual({ kind: "route", to: "/notebook" });
    expect(toNavigation({ kind: "APP_PATH", path: "/study-library/courses?x=1" }, web)).toEqual({
      kind: "href",
      href: "/study-library/courses?x=1",
    });
    expect(toNavigation({ kind: "APP_PATH", path: "/" }, web)).toBeNull();
  });

  it("drops a link the server marked unavailable, and a missing link", () => {
    expect(toNavigation({ kind: "COURSE_LIST", available: false }, web)).toBeNull();
    expect(toNavigation(null, web)).toBeNull();
  });
});

describe("FEATURE targets", () => {
  it("routes and actions", () => {
    expect(toNavigation({ kind: "FEATURE", feature: "NOTEBOOK" }, web)).toEqual({ kind: "route", to: "/notebook" });
    expect(toNavigation({ kind: "FEATURE", feature: "DOUBTS" }, web)).toEqual({ kind: "open-doubts" });
    expect(toNavigation({ kind: "FEATURE", feature: "LEADERBOARD" }, web)).toEqual({
      kind: "route",
      to: "/leaderboard/$packageSessionId",
      params: { packageSessionId: "ps-1" },
    });
    expect(toNavigation({ kind: "FEATURE", feature: "STORE_BOOKS" }, web)).toEqual({
      kind: "route",
      to: "/collections",
      before: "LEVEL_FILTER_BUY",
    });
  });

  it("hides a feature the learner does not have", () => {
    const ctx: LinkContext = { ...web, features: { HOMEWORK: false, AI_CHAT: true } };
    expect(toNavigation({ kind: "FEATURE", feature: "HOMEWORK" }, ctx)).toBeNull();
    expect(toNavigation({ kind: "FEATURE", feature: "AI_CHAT" }, ctx)).toEqual({ kind: "route", to: "/chat" });
    expect(toNavigation({ kind: "FEATURE", feature: "LEADERBOARD" }, { ...web, primaryBatchId: null })).toBeNull();
  });

  it("store shortcuts are hidden in the play skin and in reader mode", () => {
    expect(toNavigation({ kind: "FEATURE", feature: "STORE_MEMBERSHIPS" }, { ...web, playSkin: true })).toBeNull();
    expect(toNavigation({ kind: "FEATURE", feature: "STORE_MEMBERSHIPS" }, reader)).toBeNull();
  });
});

describe("reader mode (iOS / Mac App Store)", () => {
  const commerce: ResolvedLink[] = [
    { kind: "PRODUCT_PAGE", code: "x", commerce: true },
    { kind: "COURSE", package_id: "p", owned: false, commerce: true },
    { kind: "LIVE_CLASS", session_id: "s", is_paid: true, commerce: true },
    { kind: "URL", url: "https://pay.example.com", sells_something: true, commerce: true },
    { kind: "APP_PATH", path: "/pay/invoice?id=1", commerce: true },
    { kind: "FEATURE", feature: "STORE_BOOKS", commerce: true },
  ];

  it("removes every commerce target", () => {
    for (const link of commerce) expect(toNavigation(link, reader)).toBeNull();
  });

  it("re-derives commerce when the server flag is missing (safety net)", () => {
    for (const link of commerce) {
      const { commerce: _flag, ...bare } = link as ResolvedLink & { commerce?: boolean };
      void _flag;
      expect(isCommerceLink(bare as ResolvedLink)).toBe(true);
      expect(toNavigation(bare as ResolvedLink, reader)).toBeNull();
    }
  });

  it("keeps owned courses and plain links", () => {
    expect(toNavigation({ kind: "COURSE", package_id: "p", owned: true }, reader)).not.toBeNull();
    expect(toNavigation({ kind: "URL", url: "https://example.com" }, reader)).not.toBeNull();
    expect(toNavigation({ kind: "FEATURE", feature: "NOTEBOOK" }, reader)).not.toBeNull();
  });

  it("knows which slides exist only to sell", () => {
    expect(isSellingOnlyLink({ kind: "PRODUCT_PAGE", code: "x" })).toBe(true);
    expect(isSellingOnlyLink({ kind: "COURSE", package_id: "p", owned: false })).toBe(true);
    expect(isSellingOnlyLink({ kind: "COURSE", package_id: "p", owned: true })).toBe(false);
    expect(isSellingOnlyLink({ kind: "FEATURE", feature: "STORE_MEMBERSHIPS" })).toBe(true);
    expect(isSellingOnlyLink({ kind: "URL", url: "https://x.co", sells_something: true })).toBe(false);
    expect(isSellingOnlyLink(null)).toBe(false);
  });
});

describe("navigationHref", () => {
  it("fills params and search", () => {
    expect(navigationHref({ kind: "route", to: "/product-pages/$productPageCode", params: { productPageCode: "a b" } })).toBe(
      "/product-pages/a%20b"
    );
    expect(navigationHref({ kind: "route", to: "/study-library/courses", search: { tag: "JEE 2027" } })).toBe(
      "/study-library/courses?tag=JEE+2027"
    );
    expect(navigationHref({ kind: "live-class", sessionId: "s1", inMyBatch: false })).toBe("/register/live-class?sessionId=s1");
  });
});

describe("followNavigation", () => {
  const deps = (): FollowDeps & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      navigate: vi.fn((o: { to?: string; href?: string }) => void calls.push(`nav:${o.to ?? o.href}`)),
      openExternal: vi.fn((u: string) => void calls.push(`ext:${u}`)),
      assign: vi.fn((u: string) => void calls.push(`assign:${u}`)),
      openDoubts: vi.fn(() => void calls.push("doubts")),
      openLiveClass: vi.fn((s: string, mine: boolean) => void calls.push(`live:${s}:${mine}`)),
      removePreference: vi.fn((k: string) => void calls.push(`rm:${k}`)),
      setSessionItem: vi.fn((k: string, v: string) => void calls.push(`ss:${k}=${v}`)),
      beforeLeave: vi.fn(() => void calls.push("flush")),
    };
  };

  it("clears the assessment key before navigating", async () => {
    const d = deps();
    await followNavigation(toNavigation({ kind: "ASSESSMENT", assessment_id: "a1" }, web)!, d);
    expect(d.calls).toEqual([`rm:${ASSESSMENT_INSTRUCTION_KEY}`, "nav:/assessment/examination/$assessmentId"]);
  });

  it("flushes analytics before an external link leaves the app", async () => {
    const d = deps();
    await followNavigation({ kind: "external", url: "https://example.com" }, d);
    expect(d.calls).toEqual(["flush", "ext:https://example.com"]);
  });

  it("sets the store filter like the Explore buttons do", async () => {
    const d = deps();
    await followNavigation(toNavigation({ kind: "FEATURE", feature: "STORE_MEMBERSHIPS" }, web)!, d);
    expect(d.calls).toEqual(["ss:levelFilter=rent", "nav:/collections"]);
  });

  it("opens the doubts dialog and live classes through their actions", async () => {
    const d = deps();
    await followNavigation({ kind: "open-doubts" }, d);
    await followNavigation({ kind: "live-class", sessionId: "s1", inMyBatch: true }, d);
    expect(d.calls).toEqual(["doubts", "live:s1:true"]);
  });
});
