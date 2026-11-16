// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyAppSkinClass, isAppSkinSuspended, suspendAppSkin } from "./app-skin";

const root = () => document.documentElement;

beforeEach(() => {
  root().className = "light";
});

describe("app skin suspension", () => {
  it("applies one skin class at a time", () => {
    applyAppSkinClass("ui-play");
    applyAppSkinClass("ui-fun");
    expect(root().className).toBe("light ui-fun");
    applyAppSkinClass(null);
    expect(root().className).toBe("light");
  });

  it("takes the skin off and puts it back exactly", () => {
    applyAppSkinClass("ui-cleaner-play");
    const release = suspendAppSkin();
    expect(isAppSkinSuspended()).toBe(true);
    expect(root().classList.contains("ui-cleaner-play")).toBe(false);
    expect(root().classList.contains("light")).toBe(true);
    release();
    expect(isAppSkinSuspended()).toBe(false);
    expect(root().classList.contains("ui-cleaner-play")).toBe(true);
  });

  it("a skin set while suspended waits for the release", () => {
    applyAppSkinClass("ui-play");
    const release = suspendAppSkin();
    applyAppSkinClass("ui-corporate");
    expect(root().classList.contains("ui-corporate")).toBe(false);
    expect(root().classList.contains("ui-play")).toBe(false);
    release();
    expect(root().classList.contains("ui-corporate")).toBe(true);
    expect(root().classList.contains("ui-play")).toBe(false);
  });

  it("nested holds release on the last one; a second release is ignored", () => {
    applyAppSkinClass("ui-vibrant");
    const first = suspendAppSkin();
    const second = suspendAppSkin();
    first();
    first();
    expect(root().classList.contains("ui-vibrant")).toBe(false);
    second();
    expect(root().classList.contains("ui-vibrant")).toBe(true);
  });

  it("no skin before the hold means no skin after it", () => {
    const release = suspendAppSkin();
    release();
    expect(root().className).toBe("light");
  });
});
