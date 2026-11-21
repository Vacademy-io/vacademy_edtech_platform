import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  institute: "inst-1" as string | null,
  preferences: new Map<string, string>(),
  local: new Map<string, string>(),
}));
vi.mock("@/constants/helper", () => ({ getInstituteId: async () => session.institute }));
// Preferences first, then localStorage: the order the session itself reads them in.
vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenFromStorage: async (key: string) =>
    session.preferences.get(key) ?? session.local.get(key) ?? null,
}));

import {
  clearResumeForCourse,
  getLatestResume,
  getResumeForCourse,
  listResumes,
  recordSlideVisit,
  resolveResumeScope,
} from "./resume-thread";

const { preferences, local } = session;
const tokenFor = (user: string) => `h.${btoa(JSON.stringify({ user }))}.s`;
const signIn = (user: string) => preferences.set("accessToken", tokenFor(user));

const visit = (courseId: string, slideId = `${courseId}-slide`) =>
  recordSlideVisit({
    courseId,
    subjectId: "sub",
    moduleId: "mod",
    chapterId: "ch",
    slideId,
    sessionId: "ps",
    slideTitle: slideId,
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));


beforeEach(() => {
  preferences.clear();
  local.clear();
  session.institute = "inst-1";
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  });
  signIn("learner-a");
});
afterEach(() => vi.unstubAllGlobals());

describe("resume thread", () => {
  it("reads back the latest visit, one entry per course", async () => {
    visit("c1", "first");
    await settle();
    visit("c2");
    await settle();
    visit("c1", "second");
    await settle();
    const scope = await resolveResumeScope();
    expect(listResumes(scope).map((e) => e.slideId)).toEqual(["second", "c2-slide"]);
    expect(getLatestResume(scope)?.slideId).toBe("second");
    expect(getResumeForCourse(scope, "c2")?.slideId).toBe("c2-slide");
  });

  it("keeps each account's position apart on one device", async () => {
    visit("c1");
    await settle();
    signIn("learner-b");
    const b = await resolveResumeScope();
    expect(getLatestResume(b)).toBeNull();
    expect(getResumeForCourse(b, "c1")).toBeNull();
    signIn("learner-a");
    expect(getLatestResume(await resolveResumeScope())?.courseId).toBe("c1");
  });

  it("keeps each institute's position apart for one learner", async () => {
    visit("c1");
    await settle();
    session.institute = "inst-2";
    visit("c2");
    await settle();
    expect(getLatestResume(await resolveResumeScope())?.courseId).toBe("c2");
    session.institute = "inst-1";
    expect(getLatestResume(await resolveResumeScope())?.courseId).toBe("c1");
  });

  it("works for a session held only in Preferences", async () => {
    expect(local.has("accessToken")).toBe(false);
    visit("c1");
    await settle();
    expect(getLatestResume(await resolveResumeScope())?.courseId).toBe("c1");
  });

  it("works for a session held only in localStorage", async () => {
    preferences.clear();
    local.set("accessToken", tokenFor("learner-a"));
    visit("c1");
    await settle();
    expect(getLatestResume(await resolveResumeScope())?.courseId).toBe("c1");
  });

  it("follows the session when an older account's token is left in localStorage", async () => {
    visit("c1");
    await settle();
    local.set("accessToken", tokenFor("learner-a"));
    signIn("learner-b");
    const b = await resolveResumeScope();
    expect(b.owner).toBe("learner-b");
    expect(getLatestResume(b)).toBeNull();
    clearResumeForCourse(b, "c1");
    signIn("learner-a");
    expect(getLatestResume(await resolveResumeScope())?.courseId).toBe("c1");
  });

  it("has nothing without a readable sign-in", async () => {
    preferences.clear();
    expect((await resolveResumeScope()).owner).toBeNull();
    visit("c1");
    await settle();
    expect(local.size).toBe(0);
    preferences.set("accessToken", "not-a-token");
    const scope = await resolveResumeScope();
    expect(scope.owner).toBeNull();
    expect(getLatestResume(scope)).toBeNull();
    expect(getLatestResume(undefined)).toBeNull();
  });

  it("does not record without an institute", async () => {
    session.institute = null;
    visit("c1");
    await settle();
    session.institute = "inst-1";
    expect(listResumes(await resolveResumeScope())).toEqual([]);
  });

  it("ignores and retires entries with no owner", async () => {
    const legacyKey = "vacademy.resumeThread.v1";
    local.set(legacyKey, JSON.stringify([{ courseId: "old", slideId: "s", updatedAt: 1 }]));
    expect(getLatestResume(await resolveResumeScope())).toBeNull();
    visit("c1");
    await settle();
    expect(local.has(legacyKey)).toBe(false);
    expect(getResumeForCourse(await resolveResumeScope(), "old")).toBeNull();
  });

  it("survives corrupt storage", async () => {
    const scope = await resolveResumeScope();
    local.set("vacademy.resumeThread.v2.learner-a", "{not json");
    expect(getLatestResume(scope)).toBeNull();
    local.set("vacademy.resumeThread.v2.learner-a", JSON.stringify([null, { courseId: "x" }]));
    expect(getLatestResume(scope)).toBeNull();
  });

  it("forgets one course", async () => {
    visit("c1");
    await settle();
    visit("c2");
    await settle();
    const scope = await resolveResumeScope();
    clearResumeForCourse(scope, "c2");
    expect(listResumes(scope).map((e) => e.courseId)).toEqual(["c1"]);
  });
});
