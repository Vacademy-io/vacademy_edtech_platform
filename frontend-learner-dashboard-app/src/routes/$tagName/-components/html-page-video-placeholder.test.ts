// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HtmlPageSection } from "./components/HtmlPageSection";
import { collectVideoMounts, isOwnMediaUrl, sanitizeCustomHtml } from "../-utils/catalogue-html";

/**
 * An HTML page cannot carry <video> (sanitizer), so it marks a spot with
 * `<div data-vacademy="video" data-src="…">` and HtmlPageSection portals the
 * play/pause-only PlainVideoPlayer into it — the same player the typed
 * videoEmbed uses, so pasted markup never exposes a download menu either.
 */
const CDN = "https://d1om4dxj9e7kkd.cloudfront.net/CATALOGUE_IMAGES/ADMIN/x/tts";
const placeholder = (src: string, extra = "") =>
  `<section><div data-vacademy="video" data-src="${src}" data-poster="${CDN}/p.jpg" data-aspect="9:16" aria-label="Aptitude session"${extra}>` +
  `<img src="${CDN}/p.jpg" alt=""></div></section>`;

const mount = async (html: string) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(React.createElement(HtmlPageSection, { html, css: "", siteCss: ".x{}", tagName: "tag" }));
  });
  const host = el.querySelector(".catalogue-html-section") as HTMLElement;
  return { root, el, shadow: host.shadowRoot! };
};

describe("data-vacademy=video placeholder in an HTML page", () => {
  it("survives sanitising with its src/poster/aspect attributes", () => {
    const out = sanitizeCustomHtml(placeholder(`${CDN}/clip.mp4`), true);
    expect(out).toContain('data-vacademy="video"');
    expect(out).toContain(`data-src="${CDN}/clip.mp4"`);
    expect(out).toContain(`data-poster="${CDN}/p.jpg"`);
    expect(out).toContain('data-aspect="9:16"');
  });

  it("mounts the play/pause-only player into the placeholder and drops the preview image", async () => {
    const { root, shadow } = await mount(placeholder(`${CDN}/clip.mp4`));
    const box = shadow.querySelector('[data-vacademy="video"]')!;
    const video = box.querySelector("video")!;
    expect(video).toBeTruthy();
    expect(video.getAttribute("src")).toBe(`${CDN}/clip.mp4`);
    expect(video.getAttribute("poster")).toBe(`${CDN}/p.jpg`);
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.getAttribute("controlslist")).toContain("nodownload");
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelectorAll("button").length).toBe(1);
    expect((box.firstElementChild as HTMLElement).style.paddingBottom).toBe("177.78%");
    // The player's sheet is injected ahead of the site CSS (vitest does not
    // process `?inline` CSS imports, so only the ordering can be asserted here;
    // the local Playwright render checks the `.pvp` rules are really present).
    expect(shadow.querySelector("style")!.textContent).toContain(".x{}");
    await act(async () => root.unmount());
  });

  it("ignores a placeholder whose src is not on our media hosts", async () => {
    const { root, shadow } = await mount(placeholder("https://evil.example.com/clip.mp4"));
    expect(shadow.querySelector("video")).toBeNull();
    // and leaves the author's fallback content alone
    expect(shadow.querySelector('[data-vacademy="video"] img')).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("collectVideoMounts / isOwnMediaUrl accept only our hosts and known aspects", () => {
    expect(isOwnMediaUrl(`${CDN}/a.mp4`)).toBe(true);
    expect(isOwnMediaUrl("https://vacademy-media-storage-public.s3.amazonaws.com/a.mp4")).toBe(true);
    expect(isOwnMediaUrl("https://evil-bucket.s3.amazonaws.com/a.mp4")).toBe(false);
    const frag = document.createElement("div");
    frag.innerHTML =
      `<div data-vacademy="video" data-src="${CDN}/a.mp4" data-poster="https://other.host/p.jpg" data-aspect="weird"></div>` +
      `<div data-vacademy="video" data-src="https://other.host/b.mp4"></div>`;
    const mounts = collectVideoMounts(frag);
    expect(mounts.length).toBe(1);
    expect(mounts[0].poster).toBeUndefined();     // foreign poster dropped
    expect(mounts[0].paddingBottom).toBe("56.25%"); // unknown aspect → 16:9
  });
});
