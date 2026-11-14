import { describe, expect, it } from "vitest";
import type { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import { bannerClassOf, dayOffset, formatClassTime, laterClassOf, lastEntryMs } from "./live-timing";

// Sessions in UTC with an explicit zone, so the result does not depend on the machine.
const NOW = Date.UTC(2026, 10, 6, 4, 30); // 10:00 in Kolkata
const at = (minutes: number) => new Date(NOW + minutes * 60_000);
const hhmm = (d: Date) => d.toISOString().slice(11, 19);
const session = (id: string, startMin: number, lengthMin = 60, extra: Partial<SessionDetails> = {}): SessionDetails => ({
  session_id: id,
  schedule_id: `sch-${id}`,
  waiting_room_time: 0,
  meeting_date: at(startMin).toISOString().slice(0, 10),
  start_time: hhmm(at(startMin)),
  last_entry_time: hhmm(at(startMin + lengthMin)),
  recurrence_type: "none",
  access_level: "private",
  title: `Class ${id}`,
  subject: "",
  meeting_link: "",
  session_streaming_service_type: "x",
  timezone: "UTC",
  ...extra,
});

describe("bannerClassOf", () => {
  it("is live between the start and the last entry time", () => {
    expect(bannerClassOf([session("a", -10)], NOW)).toMatchObject({ isLive: true, minutesUntilStart: 0 });
    expect(bannerClassOf([session("a", -70, 60)], NOW)).toBeNull();
  });
  it("is not live during the waiting room before the start", () => {
    const b = bannerClassOf([session("a", 5, 60, { waiting_room_time: 15 })], NOW);
    expect(b).toMatchObject({ isLive: false, minutesUntilStart: 5 });
  });
  it("picks the soonest class within the hour, and any live class over it", () => {
    expect(bannerClassOf([session("a", 50), session("b", 20)], NOW)?.session.session_id).toBe("b");
    expect(bannerClassOf([session("a", 20), session("b", -5)], NOW)?.session.session_id).toBe("b");
    expect(bannerClassOf([session("a", 61)], NOW)).toBeNull();
  });
  it("rolls a last entry before the start past midnight", () => {
    const late = session("a", -30, 60, { last_entry_time: "00:30:00" });
    expect(bannerClassOf([late], NOW)?.isLive).toBe(true);
  });
});

describe("laterClassOf", () => {
  it("takes the next class within 24 hours that is not on the banner", () => {
    const soon = session("a", 20);
    const later = session("b", 6 * 60);
    const banner = bannerClassOf([soon, later], NOW);
    expect(laterClassOf([soon, later], NOW, banner)?.session_id).toBe("b");
    expect(laterClassOf([session("c", 25 * 60)], NOW, null)).toBeNull();
    expect(laterClassOf([session("d", -5)], NOW, null)).toBeNull();
  });
});

describe("dayOffset", () => {
  it("counts calendar days on the device", () => {
    const now = new Date(2026, 10, 6, 22, 0).getTime();
    expect(dayOffset(new Date(2026, 10, 6, 23, 0).getTime(), now)).toBe(0);
    expect(dayOffset(new Date(2026, 10, 7, 9, 0).getTime(), now)).toBe(1);
  });
});

describe("formatClassTime", () => {
  // 17:00 on the device's own clock, whatever zone the test runs in.
  const five = new Date(2026, 10, 6, 17, 0).getTime();
  it("writes the time in the reader's language", () => {
    expect((formatClassTime(five, "en") ?? "").replace(/\s/g, " ")).toBe("5:00 PM");
    expect(formatClassTime(five, "fr")).toBe("17:00");
    expect(formatClassTime(five, "ar")).toMatch(/^(5:00|٥:٠٠)\s*م$/);
  });
  it("puts the part of the day first in Hindi, as on board A-Hindi", () => {
    expect(formatClassTime(five, "hi")).toBe("शाम 5:00");
  });
  it("is null for a time that cannot be read", () => {
    expect(formatClassTime(Number.NaN, "en")).toBeNull();
  });
});

describe("lastEntryMs", () => {
  it("is NaN without a last entry time", () => {
    expect(Number.isNaN(lastEntryMs(session("a", 10, 60, { last_entry_time: "" })))).toBe(true);
  });
});
