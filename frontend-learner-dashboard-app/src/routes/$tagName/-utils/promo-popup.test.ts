import { describe, expect, it } from "vitest";
import {
  canShowAgain,
  formatCountdown,
  splitHtmlAndCss,
  clampNumber,
  countdownParts,
  isWithinSchedule,
  normalizeFrequency,
  normalizeTemplate,
  normalizeTrigger,
  promoStorageKey,
  rememberSeen,
  scrollPercent,
  whatsappDigits,
} from "./promo-popup";

/** In-memory Storage stand-in. */
const memoryStore = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
};
const stores = () => ({ local: memoryStore(), session: memoryStore() });

const DAY = 24 * 60 * 60 * 1000;
const KEY = promoStorageKey("inst-1", "comp-1");

describe("normalizers", () => {
  it("falls back for unknown or missing values", () => {
    expect(normalizeTemplate("poster")).toBe("poster");
    expect(normalizeTemplate("nope")).toBe("spotlight");
    expect(normalizeTemplate(undefined)).toBe("spotlight");
    expect(normalizeFrequency("weekly")).toBe("weekly");
    expect(normalizeFrequency(3)).toBe("session");
    expect(normalizeTrigger("exit")).toBe("exit");
    expect(normalizeTrigger("")).toBe("delay");
  });

  it("clamps numbers, reading numeric strings and ignoring junk", () => {
    expect(clampNumber(5, 0, 120, 3)).toBe(5);
    expect(clampNumber("7", 0, 120, 3)).toBe(7);
    expect(clampNumber(-4, 0, 120, 3)).toBe(0);
    expect(clampNumber(999, 0, 120, 3)).toBe(120);
    expect(clampNumber("abc", 0, 120, 3)).toBe(3);
    expect(clampNumber("", 0, 120, 3)).toBe(3);
    expect(clampNumber(undefined, 5, 100, 40)).toBe(40);
  });
});

describe("isWithinSchedule", () => {
  const now = new Date("2026-10-22T12:00").getTime();
  it("is open with no bounds or bad dates", () => {
    expect(isWithinSchedule("", "", now)).toBe(true);
    expect(isWithinSchedule("not a date", undefined, now)).toBe(true);
  });
  it("respects start and end", () => {
    expect(isWithinSchedule("2026-10-23T00:00", "", now)).toBe(false);
    expect(isWithinSchedule("2026-10-21T00:00", "2026-10-22T11:59", now)).toBe(false);
    expect(isWithinSchedule("2026-10-21T00:00", "2026-10-31T23:59", now)).toBe(true);
  });
});

describe("countdownParts", () => {
  it("splits the remaining time", () => {
    const now = 0;
    const end = 2 * DAY + 3 * 3600_000 + 4 * 60_000 + 5_000;
    expect(countdownParts(end, now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
  });
  it("is null once the end has passed", () => {
    expect(countdownParts(1000, 1000)).toBeNull();
    expect(countdownParts(1000, 5000)).toBeNull();
  });
});

describe("frequency", () => {
  it("always shows for every-visit popups and stores nothing", () => {
    const s = stores();
    rememberSeen("always", KEY, 0, s);
    expect(s.local.map.size + s.session.map.size).toBe(0);
    expect(canShowAgain("always", KEY, 0, s)).toBe(true);
  });

  it("session: hidden for the rest of the visit, back in a new session", () => {
    const s = stores();
    expect(canShowAgain("session", KEY, 0, s)).toBe(true);
    rememberSeen("session", KEY, 0, s);
    expect(canShowAgain("session", KEY, 1, s)).toBe(false);
    expect(s.local.map.size).toBe(0);
    expect(canShowAgain("session", KEY, 1, { local: s.local, session: memoryStore() })).toBe(true);
  });

  it("daily and weekly come back after their cooldown", () => {
    const s = stores();
    rememberSeen("daily", KEY, 0, s);
    expect(canShowAgain("daily", KEY, DAY - 1, s)).toBe(false);
    expect(canShowAgain("daily", KEY, DAY, s)).toBe(true);
    const w = stores();
    rememberSeen("weekly", KEY, 0, w);
    expect(canShowAgain("weekly", KEY, 6 * DAY, w)).toBe(false);
    expect(canShowAgain("weekly", KEY, 7 * DAY, w)).toBe(true);
  });

  it("once never comes back", () => {
    const s = stores();
    rememberSeen("once", KEY, 0, s);
    expect(canShowAgain("once", KEY, 365 * DAY, s)).toBe(false);
  });

  it("a visitor who clicked the offer is not asked again, even in a new session", () => {
    const s = stores();
    rememberSeen("daily", KEY, 0, s, true);
    expect(canShowAgain("daily", KEY, 30 * DAY, s)).toBe(false);
    const t = stores();
    rememberSeen("session", KEY, 0, t, true);
    expect(canShowAgain("session", KEY, 1, { local: t.local, session: memoryStore() })).toBe(false);
  });

  it("keys are per institute and block", () => {
    const s = stores();
    rememberSeen("once", KEY, 0, s);
    expect(canShowAgain("once", promoStorageKey("inst-1", "comp-2"), 0, s)).toBe(true);
    expect(canShowAgain("once", promoStorageKey("inst-2", "comp-1"), 0, s)).toBe(true);
  });

  it("never hides the offer when storage is missing, corrupt or throws", () => {
    expect(canShowAgain("once", KEY, 0, { local: null, session: null })).toBe(true);
    const bad = stores();
    bad.local.setItem(KEY, "{not json");
    expect(canShowAgain("once", KEY, 0, bad)).toBe(true);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberSeen("daily", KEY, 0, { local: throwing, session: throwing })).not.toThrow();
  });
});

describe("helpers", () => {
  it("scrollPercent treats an unscrollable page as fully read", () => {
    expect(scrollPercent(0, 800, 800)).toBe(100);
    expect(scrollPercent(500, 800, 1800)).toBe(50);
    expect(scrollPercent(5000, 800, 1800)).toBe(100);
  });
  it("whatsappDigits keeps digits only", () => {
    expect(whatsappDigits("+91 98765-43210")).toBe("919876543210");
    expect(whatsappDigits(undefined)).toBe("");
  });
});

describe("custom HTML", () => {
  it("splits <style> blocks out of the markup", () => {
    const { html, css } = splitHtmlAndCss(
      '<style>.a{color:red}</style><div class="a">Hi</div><style media="x">.b{margin:0}</style>',
    );
    expect(html).toBe('<div class="a">Hi</div>');
    expect(css).toBe(".a{color:red}\n.b{margin:0}");
  });
  it("handles markup without CSS, empty and non-string input", () => {
    expect(splitHtmlAndCss("<p>x</p>")).toEqual({ html: "<p>x</p>", css: "" });
    expect(splitHtmlAndCss("  ")).toEqual({ html: "", css: "" });
    expect(splitHtmlAndCss(undefined)).toEqual({ html: "", css: "" });
  });
  it("formats the countdown with days only when there are some", () => {
    expect(formatCountdown({ days: 2, hours: 5, minutes: 4, seconds: 3 })).toBe("2d 05:04:03");
    expect(formatCountdown({ days: 0, hours: 0, minutes: 9, seconds: 59 })).toBe("00:09:59");
  });
});
