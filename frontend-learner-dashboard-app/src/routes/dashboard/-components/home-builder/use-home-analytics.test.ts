// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MAX_QUEUE, createHomeAnalytics, deviceClassFor } from "./use-home-analytics";
import type { HomeEvent } from "@/services/learner-home";

const make = (disabled = false) => {
  const sent: HomeEvent[][] = [];
  const a = createHomeAnalytics({
    send: (events) => void sent.push(events),
    layoutVersion: 7,
    device: () => "PHONE",
    platform: "ANDROID",
    disabled,
    now: () => new Date("2026-11-16T09:30:00Z"),
  });
  return { a, sent };
};

describe("home analytics queue", () => {
  it("batches until flushed, with the event fields the server expects", () => {
    const { a, sent } = make();
    a.view("b-1");
    a.click("b-1", "s-1");
    expect(sent).toEqual([]);
    a.flush();
    expect(sent).toEqual([
      [
        { block_key: "b-1", type: "VIEW", device: "PHONE", platform: "ANDROID", layout_version: 7, ts: "2026-11-16T09:30:00.000Z" },
        { block_key: "b-1", item_key: "s-1", type: "CLICK", device: "PHONE", platform: "ANDROID", layout_version: 7, ts: "2026-11-16T09:30:00.000Z" },
      ],
    ]);
    a.flush();
    expect(sent).toHaveLength(1);
  });

  it("counts a view once per mount (per block and item), every click", () => {
    const { a, sent } = make();
    a.view("b-1");
    a.view("b-1");
    a.view("b-1", "s-1");
    a.view("b-1", "s-1");
    a.click("b-1", "s-1");
    a.click("b-1", "s-1");
    a.flush();
    expect(sent[0]!.map((e) => `${e.type}:${e.item_key ?? ""}`)).toEqual(["VIEW:", "VIEW:s-1", "CLICK:s-1", "CLICK:s-1"]);
  });

  it("flushes by itself at 50 events", () => {
    const { a, sent } = make();
    for (let i = 0; i < MAX_QUEUE; i++) a.click("b", `i${i}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(50);
  });

  it("sends nothing from the admin preview", () => {
    const { a, sent } = make(true);
    a.view("b-1");
    a.click("b-1");
    a.flush();
    expect(sent).toEqual([]);
  });

  it("a failing sender never throws into the page", () => {
    const a = createHomeAnalytics({
      send: vi.fn(() => {
        throw new Error("offline");
      }),
      layoutVersion: 1,
      device: () => "DESKTOP",
      platform: "WEB",
      disabled: false,
    });
    a.click("b");
    expect(() => a.flush()).not.toThrow();
  });

  it("device classes: PHONE < 768 <= TABLET < 1024 <= DESKTOP", () => {
    expect(deviceClassFor(390)).toBe("PHONE");
    expect(deviceClassFor(767)).toBe("PHONE");
    expect(deviceClassFor(768)).toBe("TABLET");
    expect(deviceClassFor(1023)).toBe("TABLET");
    expect(deviceClassFor(1024)).toBe("DESKTOP");
  });
});
