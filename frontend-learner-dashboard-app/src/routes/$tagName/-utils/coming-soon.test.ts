// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLaunchDate, openComingSoonForm, readComingSoon } from "./coming-soon";

describe("readComingSoon", () => {
  it("is null for every course that is not Coming Soon", () => {
    expect(readComingSoon(null)).toBeNull();
    expect(readComingSoon(undefined)).toBeNull();
    expect(readComingSoon({ enabled: false, audience_id: "a1" })).toBeNull();
    expect(readComingSoon("yes")).toBeNull();
  });

  it("maps the snake_case API object and drops blank strings", () => {
    expect(
      readComingSoon({
        enabled: true,
        launch_date: "2026-11-15",
        ribbon_text: "  ",
        button_text: "Join waitlist",
        audience_id: "aud-1",
      }),
    ).toEqual({
      enabled: true,
      launchDate: "2026-11-15",
      ribbonText: undefined,
      buttonText: "Join waitlist",
      audienceId: "aud-1",
    });
  });
});

describe("formatLaunchDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 15, 0, 0)); // 4 Oct 2026, afternoon
  });
  afterEach(() => vi.useRealTimers());

  it("formats a future date as the local calendar day", () => {
    const out = formatLaunchDate("2026-11-15", "en-GB");
    expect(out).toContain("15");
    expect(out).toContain("Nov");
  });

  it("still shows a launch that is today", () => {
    expect(formatLaunchDate("2026-10-04", "en-GB")).toContain("4");
  });

  it("hides a past, missing or malformed date", () => {
    expect(formatLaunchDate("2026-10-03", "en-GB")).toBeUndefined();
    expect(formatLaunchDate(undefined)).toBeUndefined();
    expect(formatLaunchDate("next month")).toBeUndefined();
  });
});

describe("openComingSoonForm", () => {
  it("opens the course's audience form through the page-shell event", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("openAudienceForm", listener);
    const opened = openComingSoonForm(
      { enabled: true, audienceId: "aud-1" },
      "Get notified when X launches",
    );
    window.removeEventListener("openAudienceForm", listener);
    expect(opened).toBe(true);
    expect(seen).toEqual([{ audienceId: "aud-1", title: "Get notified when X launches" }]);
  });

  it("reports false when there is no form, so the caller can open the details page", () => {
    expect(openComingSoonForm({ enabled: true }, "t")).toBe(false);
    expect(openComingSoonForm(null, "t")).toBe(false);
  });
});
