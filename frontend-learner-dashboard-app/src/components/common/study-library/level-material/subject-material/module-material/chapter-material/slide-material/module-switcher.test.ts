// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type {
  Chapter,
  ModulesWithChapters,
} from "@/stores/study-library/use-modules-with-chapters-store";
import { moduleEntryChapterId, switchableModules } from "./module-switcher";

const chapter = (id: string, percentage_completed: number): Chapter =>
  ({ id, chapter_name: id, percentage_completed }) as Chapter;

const mod = (
  id: string,
  module_name: string,
  chapters: Chapter[]
): ModulesWithChapters =>
  ({
    module: { id, module_name },
    percentage_completed: 0,
    module_order: null,
    chapters,
  }) as ModulesWithChapters;

describe("switchableModules", () => {
  it("drops the DEFAULT placeholder and empty modules, keeps course order", () => {
    const modules = [
      mod("m1", "Start Here", [chapter("c1", 0)]),
      mod("m2", " default ", [chapter("c2", 0)]),
      mod("m3", "Downloads", []),
      mod("m4", "What would you like to practise today?", [chapter("c4", 0)]),
    ];
    expect(switchableModules(modules).map((m) => m.module.id)).toEqual([
      "m1",
      "m4",
    ]);
  });

  it("treats a missing outline as no modules", () => {
    expect(switchableModules(null)).toEqual([]);
    expect(switchableModules(undefined)).toEqual([]);
  });
});

describe("moduleEntryChapterId", () => {
  it("opens the first chapter not yet finished", () => {
    const m = mod("m", "Learn", [
      chapter("done", 100),
      chapter("half", 40),
      chapter("fresh", 0),
    ]);
    expect(moduleEntryChapterId(m, 80)).toBe("half");
  });

  it("counts a chapter at the threshold as finished", () => {
    const m = mod("m", "Learn", [chapter("a", 80), chapter("b", 79)]);
    expect(moduleEntryChapterId(m, 80)).toBe("b");
  });

  it("falls back to the first chapter when every chapter is finished", () => {
    const m = mod("m", "Learn", [chapter("a", 100), chapter("b", 100)]);
    expect(moduleEntryChapterId(m, 80)).toBe("a");
  });

  it("has nowhere to open in a module without chapters", () => {
    expect(moduleEntryChapterId(mod("m", "Empty", []), 80)).toBeNull();
  });
});
