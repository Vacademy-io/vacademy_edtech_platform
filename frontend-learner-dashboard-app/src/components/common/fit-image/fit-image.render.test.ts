// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FitImage, ImageFitProvider, siteImageFit, type FitImageProps } from "./FitImage";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Renders with the box measuring `box` (jsdom lays nothing out). */
const mount = (props: Partial<FitImageProps>, opts: { box?: [number, number]; siteFit?: unknown } = {}) => {
  const [w, h] = opts.box ?? [320, 180];
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const el = React.createElement(FitImage, { src: "https://x/a.png", alt: "Cover", className: "absolute inset-0 size-full", ...props });
  act(() => root!.render(opts.siteFit === undefined ? el : React.createElement(ImageFitProvider, { fit: opts.siteFit }, el)));
  HTMLElement.prototype.getBoundingClientRect = rect;
  return host;
};

/** The image finishes loading at this natural size. */
const load = (el: HTMLElement, width: number, height: number) => {
  const img = el.querySelector("img:not([aria-hidden])") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  act(() => {
    img.dispatchEvent(new Event("load"));
  });
  return img;
};

const box = (el: HTMLElement) => el.firstElementChild as HTMLElement;
const backdrop = (el: HTMLElement) => el.querySelector("img[aria-hidden]");

describe("FitImage", () => {
  it("fills its box before the image loads, with the section's box classes on the box", () => {
    const el = mount({});
    const img = el.querySelector("img")!;
    expect(box(el).className).toContain("absolute inset-0 size-full");
    expect(box(el).className).toContain("overflow-hidden");
    expect(img.className).toContain("object-cover");
    expect(img.getAttribute("alt")).toBe("Cover");
    expect(backdrop(el)).toBeNull();
  });

  it("keeps filling an image of about the box's shape", () => {
    const el = mount({});
    const img = load(el, 1600, 900);
    expect(img.className).toContain("object-cover");
    expect(backdrop(el)).toBeNull();
    expect(box(el).getAttribute("data-fit")).toBe("cover");
  });

  it("fits an image that filling would cut too much, over a blurred copy of itself", () => {
    const el = mount({}, { box: [200, 200] }); // a square tile
    const img = load(el, 1600, 900);
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
    const copy = backdrop(el)!;
    expect(copy.getAttribute("src")).toBe("https://x/a.png");
    expect(copy.getAttribute("alt")).toBe("");
    expect(copy.className).toContain("blur");
    expect(box(el).getAttribute("data-fit")).toBe("contain");
  });

  it("keeps an explicit fit as it always was: contain without a backdrop, cover even for a poster", () => {
    const contained = mount({ fit: "contain" });
    expect(load(contained, 1600, 900).className).toContain("object-contain");
    expect(backdrop(contained)).toBeNull();
    act(() => root?.unmount());

    const covered = mount({ fit: "cover" }, { box: [200, 200] });
    expect(load(covered, 600, 1200).className).toContain("object-cover");
    expect(backdrop(covered)).toBeNull();
  });

  it("follows the site's opt-out, and ignores a setting it does not know", () => {
    const off = mount({}, { box: [200, 200], siteFit: "cover" });
    expect(load(off, 1600, 900).className).toContain("object-cover");
    act(() => root?.unmount());

    const unknown = mount({}, { box: [200, 200], siteFit: "zoom" });
    expect(load(unknown, 1600, 900).className).toContain("object-contain");
  });

  it("passes the image's own attributes and handlers through", () => {
    let loaded = 0;
    const el = mount({ loading: "lazy", onLoad: () => loaded++, imgClassName: "rounded" });
    const img = load(el, 800, 450);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.className).toContain("rounded");
    expect(loaded).toBe(1);
  });
});

describe("siteImageFit", () => {
  it("reads globalSettings.images.fit, whatever the settings hold", () => {
    expect(siteImageFit({ images: { fit: "cover" } })).toBe("cover");
    expect(siteImageFit({})).toBeUndefined();
    expect(siteImageFit(null)).toBeUndefined();
  });
});
