import { describe, expect, it } from "vitest";
import type { CompanionSummary } from "@/services/kb-companion-api";
import { companionCta, companionFinished, homeCompanions } from "./companions";

const companion = (over: Partial<CompanionSummary> & { id: string }): CompanionSummary => ({
  knowledge_base_id: "kb",
  kb_name: "Notes",
  name: "Buddy",
  language: "en",
  modes: ["learn"],
  voice_enabled: false,
  show_on_dashboard: true,
  progress: { leaves_total: 10, started: 0, completed: 0, mastery: 0 },
  resume: null,
  topics_total: 10,
  ...over,
});

describe("homeCompanions", () => {
  it("keeps only the companions meant for the home, in their order", () => {
    const list = [companion({ id: "a" }), companion({ id: "b", show_on_dashboard: false }), companion({ id: "c" })];
    expect(homeCompanions(list).map((c) => c.id)).toEqual(["a", "c"]);
  });
  it("is empty while the list is out or failed", () => {
    expect(homeCompanions(undefined)).toEqual([]);
    expect(homeCompanions(null)).toEqual([]);
  });
});

describe("companionCta", () => {
  it("reviews once every topic is done", () => {
    const c = companion({ id: "a", progress: { leaves_total: 4, started: 4, completed: 4, mastery: 90 } });
    expect(companionFinished(c)).toBe(true);
    expect(companionCta(c)).toEqual({ key: "shelf.review" });
  });
  it("is not finished with no topics yet", () => {
    const c = companion({ id: "a", progress: { leaves_total: 0, started: 0, completed: 0, mastery: 0 } });
    expect(companionFinished(c)).toBe(false);
    expect(companionCta(c)).toEqual({ key: "shelf.start" });
  });
  it("continues, goes next or starts by the resume reason and progress", () => {
    const resume = { node_id: "n", card_index: 0, title: "Lenses" };
    expect(companionCta(companion({ id: "a", resume: { ...resume, reason: "continue" } }))).toEqual({ key: "shelf.continueTopic", title: "Lenses" });
    expect(
      companionCta(companion({ id: "a", resume: { ...resume, reason: "next" }, progress: { leaves_total: 5, started: 2, completed: 1, mastery: 20 } })),
    ).toEqual({ key: "shelf.nextTopic", title: "Lenses" });
    expect(companionCta(companion({ id: "a", resume: { ...resume, reason: "next" } }))).toEqual({ key: "shelf.startTopic", title: "Lenses" });
  });
  it("starts plainly when the resume has no title", () => {
    expect(companionCta(companion({ id: "a", resume: { node_id: "n", card_index: 0, reason: "continue", title: null } }))).toEqual({ key: "shelf.start" });
  });
});
