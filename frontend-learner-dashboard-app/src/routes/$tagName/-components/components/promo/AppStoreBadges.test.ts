import { describe, expect, it } from "vitest";
import { resolveAppStoreLinks } from "./AppStoreBadges";

describe("resolveAppStoreLinks", () => {
  const play = "https://play.google.com/store/apps/details?id=com.example.app";
  const ios = "https://apps.apple.com/us/app/example/id123";

  it("keeps both https store links", () => {
    expect(resolveAppStoreLinks({ playStore: play, appStore: ios })).toEqual({ playStore: play, appStore: ios });
  });

  it("keeps one store when the other is empty", () => {
    expect(resolveAppStoreLinks({ playStore: ` ${play} `, appStore: "" })).toEqual({ playStore: play, appStore: null });
  });

  it("drops links that are not https", () => {
    expect(resolveAppStoreLinks({ playStore: "javascript:alert(1)", appStore: "http://apps.apple.com/x" })).toBeNull();
    expect(resolveAppStoreLinks({ playStore: "/login" })).toBeNull();
  });

  it("is null when nothing usable is authored", () => {
    expect(resolveAppStoreLinks(undefined)).toBeNull();
    expect(resolveAppStoreLinks({})).toBeNull();
    expect(resolveAppStoreLinks([play])).toBeNull();
  });
});
