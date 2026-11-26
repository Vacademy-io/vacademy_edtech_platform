// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { applyAppSkinClass } from "@/lib/app-skin";
import { useCatalogueSkinIsolation } from "./catalogue-skin-isolation";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const html = () => document.documentElement;

const SitePage = ({ active }: { active?: boolean }) => {
  useCatalogueSkinIsolation(active);
  return null;
};

let container: HTMLDivElement;
let root: Root;

const render = (node: React.ReactNode) => act(() => root.render(node));

beforeEach(() => {
  html().className = "light";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  applyAppSkinClass(null);
});

describe("useCatalogueSkinIsolation", () => {
  it("takes the learner skin off while a site page is on screen and puts it back after", () => {
    applyAppSkinClass("ui-play");
    render(<SitePage />);
    expect(html().classList.contains("ui-play")).toBe(false);
    expect(html().classList.contains("light")).toBe(true);

    render(null);
    expect(html().classList.contains("ui-play")).toBe(true);
  });

  it("keeps the skin where no site is drawn", () => {
    applyAppSkinClass("ui-play");
    render(<SitePage active={false} />);
    expect(html().classList.contains("ui-play")).toBe(true);
  });

  it("a skin that arrives while the site is open waits until the visitor leaves it", () => {
    render(<SitePage />);
    applyAppSkinClass(["ui-fun", "ui-neon-city"]);
    expect(html().classList.contains("ui-fun")).toBe(false);

    render(null);
    expect(html().classList.contains("ui-fun")).toBe(true);
    expect(html().classList.contains("ui-neon-city")).toBe(true);
  });

  it("a site page inside the site chrome keeps the skin off until both are gone", () => {
    applyAppSkinClass("ui-corporate");
    render(
      <>
        <SitePage active />
        <SitePage />
      </>,
    );
    render(<SitePage active />);
    expect(html().classList.contains("ui-corporate")).toBe(false);

    render(null);
    expect(html().classList.contains("ui-corporate")).toBe(true);
  });
});
