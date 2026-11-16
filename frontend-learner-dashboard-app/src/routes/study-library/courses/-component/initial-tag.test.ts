import { describe, expect, it } from "vitest";
import { tabForInitialTag } from "./initial-tag";
import type { StudentAllCoursesCustomTab } from "@/types/student-display-settings";

const custom = (id: string, tags: string[], type?: string) =>
  ({ id, label: id, order: 1, tags, type }) as unknown as StudentAllCoursesCustomTab;

describe("tabForInitialTag (?tag= from a learner-home link)", () => {
  const tabs = { "custom:jee": custom("jee", ["JEE 2027"]), "custom:mix": custom("mix", ["JEE 2027", "NEET"]) };

  it("opens the admin's own tab whose tags are exactly that tag", () => {
    const visible = [{ value: "PROGRESS" }, { value: "ALL" }, { value: "custom:mix" }, { value: "custom:jee" }];
    expect(tabForInitialTag("jee 2027", visible, tabs)).toEqual({ tab: "custom:jee" });
  });

  it("else All, filtered to the tag", () => {
    expect(tabForInitialTag("NEET", [{ value: "ALL" }, { value: "custom:mix" }], tabs)).toEqual({
      tab: "ALL",
      tags: ["NEET"],
    });
  });

  it("a hidden own tab is not used", () => {
    expect(tabForInitialTag("JEE 2027", [{ value: "ALL" }], tabs)).toEqual({ tab: "ALL", tags: ["JEE 2027"] });
  });

  it("nothing special when All is hidden (reader mode) or the tag is blank", () => {
    expect(tabForInitialTag("JEE 2027", [{ value: "PROGRESS" }], tabs)).toBeNull();
    expect(tabForInitialTag("  ", [{ value: "ALL" }], tabs)).toBeNull();
  });

  it("ignores non-TAG custom tabs", () => {
    const lives = { "custom:live": custom("live", ["JEE 2027"], "LIVE_SESSIONS") };
    expect(tabForInitialTag("JEE 2027", [{ value: "custom:live" }, { value: "ALL" }], lives)).toEqual({
      tab: "ALL",
      tags: ["JEE 2027"],
    });
  });
});
