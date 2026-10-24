import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = { platform: "web" };
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => capacitor.platform },
}));

import {
  appendYouTubeEmbedOrigin,
  getYouTubeBridgeHost,
  routeYouTubeEmbedThroughBridge,
} from "./youtube-embed";

describe("YouTube embed bridge", () => {
  beforeEach(() => {
    capacitor.platform = "web";
  });

  it("leaves web and Android on YouTube's own host", () => {
    for (const platform of ["web", "android", "electron"]) {
      capacitor.platform = platform;
      expect(getYouTubeBridgeHost()).toBeUndefined();
      expect(routeYouTubeEmbedThroughBridge("https://www.youtube.com/embed/abcdefghijk?rel=0")).toBe(
        "https://www.youtube.com/embed/abcdefghijk?rel=0",
      );
    }
  });

  it("routes native iOS through the https bridge, keeping the query", () => {
    capacitor.platform = "ios";
    expect(getYouTubeBridgeHost()).toBe("https://learner.vacademy.io");
    expect(routeYouTubeEmbedThroughBridge("https://www.youtube.com/embed/abcdefghijk?rel=0")).toBe(
      "https://learner.vacademy.io/embed/abcdefghijk?rel=0",
    );
    expect(routeYouTubeEmbedThroughBridge("https://www.youtube-nocookie.com/embed/abcdefghijk")).toBe(
      "https://learner.vacademy.io/embed/abcdefghijk",
    );
  });

  it("only rewrites embed URLs", () => {
    capacitor.platform = "ios";
    expect(routeYouTubeEmbedThroughBridge("https://www.youtube.com/watch?v=abcdefghijk")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
  });

  it("appendYouTubeEmbedOrigin bridges on iOS only", () => {
    capacitor.platform = "ios";
    expect(appendYouTubeEmbedOrigin("https://www.youtube.com/embed/abcdefghijk")).toMatch(
      /^https:\/\/learner\.vacademy\.io\/embed\/abcdefghijk\?origin=/,
    );
    capacitor.platform = "web";
    expect(appendYouTubeEmbedOrigin("https://www.youtube.com/embed/abcdefghijk")).toMatch(
      /^https:\/\/www\.youtube\.com\/embed\/abcdefghijk\?origin=/,
    );
  });
});
