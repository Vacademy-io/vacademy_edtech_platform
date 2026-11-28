// @vitest-environment jsdom
//
// The repo default is `environment: "node"`, which has no window,
// sessionStorage or fetch — and this module is entirely about all three.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  captureUtmOnce,
  getStoredUtm,
  hasStoredUtm,
  trackUtmAttribution,
} from "./utm-attribution";

// `hostname` is included because config/baseUrl.ts reads it at module-eval
// time when constants/urls is imported; a location stub without it breaks the
// import graph rather than the assertion.
const setUrl = (search: string) => {
  Object.defineProperty(window, "location", {
    value: {
      search,
      pathname: "/audience-response",
      hostname: "learner.example.com",
      href: `https://learner.example.com/audience-response${search}`,
    } as Location,
    writable: true,
    configurable: true,
  });
};

describe("first-touch capture", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setUrl("");
  });

  it("banks the campaign off the landing URL", () => {
    setUrl("?instituteId=1&utm_source=meta&utm_medium=cpc&utm_campaign=diwali");
    captureUtmOnce();
    expect(getStoredUtm()).toEqual({
      utm_source: "meta",
      utm_medium: "cpc",
      utm_campaign: "diwali",
    });
  });

  // FIRST touch wins. A learner who arrives from an ad, browses the catalogue
  // and then reaches the form through an untagged internal link must still be
  // credited to the ad — re-capturing would overwrite the campaign with nothing.
  it("does not overwrite the first campaign on a later untagged page", () => {
    setUrl("?utm_source=meta");
    captureUtmOnce();
    setUrl("?instituteId=1");
    captureUtmOnce();
    expect(getStoredUtm()).toEqual({ utm_source: "meta" });
  });

  it("stores nothing at all for an untagged arrival", () => {
    setUrl("?instituteId=1&audienceId=9");
    captureUtmOnce();
    expect(hasStoredUtm()).toBe(false);
    expect(getStoredUtm()).toEqual({});
  });

  it("caps an absurdly long value rather than storing it whole", () => {
    setUrl(`?utm_campaign=${"a".repeat(500)}`);
    captureUtmOnce();
    expect(getStoredUtm().utm_campaign).toHaveLength(120);
  });

  it("survives the tab closing — a learner who comes back still carries the campaign", () => {
    // The bug this fixes: sessionStorage dies with the tab, so someone who
    // opened the ad link, closed it, and returned later to actually enrol
    // arrived with no campaign and the ad showed zero conversions.
    setUrl("?utm_source=meta&utm_campaign=ganesh-2026");
    captureUtmOnce();
    sessionStorage.clear(); // new tab
    setUrl("");             // and the router has stripped the params
    expect(getStoredUtm()).toEqual({
      utm_source: "meta",
      utm_campaign: "ganesh-2026",
    });
  });

  it("stops crediting a touch older than the attribution window", () => {
    setUrl("?utm_source=meta&utm_campaign=old-campaign");
    captureUtmOnce();
    const saved = JSON.parse(localStorage.getItem("vac_utm_first_touch")!);
    saved.at = new Date().getTime() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
    localStorage.setItem("vac_utm_first_touch", JSON.stringify(saved));
    sessionStorage.clear();
    setUrl("");
    expect(getStoredUtm()).toEqual({});
  });

  it("prefers the campaign on the CURRENT url over an older stored one", () => {
    setUrl("?utm_source=meta&utm_campaign=old");
    captureUtmOnce();
    setUrl("?utm_source=whatsapp&utm_campaign=new");
    // Landing on a freshly tagged link credits that link, not the stale one.
    expect(getStoredUtm()).toEqual({
      utm_source: "whatsapp",
      utm_campaign: "new",
    });
  });

  it("answers empty when storage holds junk", () => {
    sessionStorage.setItem("vac_utm_first_touch", "{not json");
    expect(getStoredUtm()).toEqual({});
  });
});

describe("reporting a touch", () => {
  // Loosely typed on purpose: vi.fn()'s inferred generic does not unify with
  // the ambient `fetch` signature, and pinning it adds nothing to the assertions.
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setUrl("");
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response)) as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const capture = () => {
    setUrl("?utm_source=meta&utm_campaign=diwali");
    captureUtmOnce();
  };

  it("posts the banked campaign with the identity", async () => {
    capture();
    trackUtmAttribution({
      instituteId: "inst-1",
      userId: "user-1",
      sourceType: "AUDIENCE",
      sourceId: "aud-9",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      institute_id: "inst-1",
      user_id: "user-1",
      source_type: "AUDIENCE",
      source_id: "aud-9",
      utm_source: "meta",
      utm_campaign: "diwali",
    });
    // keepalive: the successful submit is normally followed straight away by a
    // thank-you redirect or a payment gateway hop.
    expect(init.keepalive).toBe(true);
  });

  // An untagged arrival is the absence of attribution, not a data point.
  it("retires the persisted touch once credited, so a shared device does not inherit it", () => {
    setUrl("?utm_source=meta&utm_campaign=ganesh-2026");
    captureUtmOnce();
    expect(localStorage.getItem("vac_utm_first_touch")).toBeTruthy();

    trackUtmAttribution({
      instituteId: "inst-1",
      userId: "user-1",
      sourceType: "ENROLL_INVITE",
    });
    expect(fetchMock).toHaveBeenCalled();

    // Persisted copy gone; the next person on this browser starts clean.
    expect(localStorage.getItem("vac_utm_first_touch")).toBeNull();
    // This tab keeps it, so a second enrolment in the same visit still counts.
    expect(sessionStorage.getItem("vac_utm_first_touch")).toBeTruthy();
  });

  it("sends nothing when this session carries no campaign", () => {
    trackUtmAttribution({
      instituteId: "inst-1",
      userId: "user-1",
      sourceType: "AUDIENCE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when there is nobody to attach the touch to", () => {
    capture();
    trackUtmAttribution({ instituteId: "inst-1", sourceType: "AUDIENCE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing without an institute", () => {
    capture();
    trackUtmAttribution({ userId: "user-1", sourceType: "AUDIENCE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an email-only identity, for surfaces that have no user id yet", () => {
    capture();
    trackUtmAttribution({
      instituteId: "inst-1",
      email: "learner@example.com",
      sourceType: "CATALOGUE",
      sourceId: "site:contact-form",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // By the time this runs the learner has already done the thing they came to
  // do; telemetry must never surface as an error on a form that succeeded.
  it("never throws when the network call blows up", () => {
    capture();
    vi.stubGlobal("fetch", () => {
      throw new Error("offline");
    });
    expect(() =>
      trackUtmAttribution({
        instituteId: "inst-1",
        userId: "user-1",
        sourceType: "ASSESSMENT",
      })
    ).not.toThrow();
  });
});
