import { describe, expect, it } from "vitest";
import { countdown, eventPhase, eventTimes, nextTickDelay } from "./event-timing";

const START = Date.parse("2026-12-01T13:30:00Z");
const times = eventTimes({ starts_at: "2026-12-01T13:30:00Z", ends_at: "2026-12-01T15:00:00Z", join_opens_minutes: 15 })!;

describe("event timing", () => {
  it("opens join 15 minutes before the start by default, or at the server's join_opens_at", () => {
    expect(times.joinOpensMs).toBe(START - 15 * 60_000);
    const server = eventTimes({
      starts_at: "2026-12-01T13:30:00Z",
      ends_at: "2026-12-01T15:00:00Z",
      join_opens_at: "2026-12-01T13:00:00Z",
    })!;
    expect(server.joinOpensMs).toBe(Date.parse("2026-12-01T13:00:00Z"));
  });

  it("rejects unreadable instants", () => {
    expect(eventTimes({ starts_at: "soon", ends_at: "later" })).toBeNull();
  });

  it("Register → Join → Live → hidden", () => {
    expect(eventPhase(times, START - 16 * 60_000)).toBe("BEFORE");
    expect(eventPhase(times, START - 15 * 60_000)).toBe("JOIN");
    expect(eventPhase(times, START)).toBe("LIVE");
    expect(eventPhase(times, Date.parse("2026-12-01T15:00:00Z"))).toBe("ENDED");
  });

  it("counts down in days, hours, minutes, then seconds", () => {
    expect(countdown(times, START - (2 * 24 + 4) * 3_600_000 - 5 * 60_000)).toEqual({ kind: "days", days: 2, hours: 4 });
    expect(countdown(times, START - 3 * 3_600_000 - 5 * 60_000)).toEqual({ kind: "hours", hours: 3, minutes: 5 });
    expect(countdown(times, START - 12 * 60_000)).toEqual({ kind: "minutes", minutes: 12 });
    expect(countdown(times, START - 60 * 60_000)).toEqual({ kind: "minutes", minutes: 60 });
    expect(countdown(times, START - 45_000)).toEqual({ kind: "seconds", seconds: 45 });
    expect(countdown(times, START + 1)).toEqual({ kind: "live" });
    expect(countdown(times, times.endsMs)).toEqual({ kind: "ended" });
  });

  it("ticks every minute, every second in the last minute, and lands on the switch instants", () => {
    expect(nextTickDelay(times, START - 3 * 3_600_000)).toBe(60_000);
    expect(nextTickDelay(times, START - 3 * 3_600_000 - 20_000)).toBe(20_000);
    expect(nextTickDelay(times, START - 30_500)).toBe(500);
    // 15m 30s before: the next text change (15m) is also the join instant.
    expect(nextTickDelay(times, START - 15 * 60_000 - 30_000)).toBe(30_000);
    expect(nextTickDelay(times, times.endsMs - 10_000)).toBe(10_000);
  });
});
