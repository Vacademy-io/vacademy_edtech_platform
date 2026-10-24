// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SlideDownloadButton, SlideImagesDownloadButton, imageSrcsFromHtml } from "./slide-download-button";

/** The slide Download button: shown only when Content Protection allows the type. */

let allowed = false;
vi.mock("@/hooks/useSlideDownloadPermission", () => ({
  useSlideDownloadPermission: () => ({ canDownload: () => allowed }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((r) => setTimeout(r, 0));

let root: Root | null = null;
const mount = async (props: React.ComponentProps<typeof SlideDownloadButton>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(SlideDownloadButton, props));
  });
  return host;
};
const click = async (host: HTMLElement) => {
  await act(async () => {
    host.querySelector("button")!.click();
  });
  await act(tick);
  await act(tick);
};

/** The `download` names of every link the component clicks. */
const capturedDownloads = () => {
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  return names;
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SlideDownloadButton", () => {
  it("renders nothing when the role may not download the slide type", async () => {
    allowed = false;
    const host = await mount({ typeKey: "AUDIO", url: "https://x/a.mp3" });
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing without a source even when allowed", async () => {
    allowed = true;
    const host = await mount({ typeKey: "DOCUMENT_DOC" });
    expect(host.innerHTML).toBe("");
  });

  it("saves an authored document as an .html file named after the slide", async () => {
    allowed = true;
    const names = capturedDownloads();
    const host = await mount({ typeKey: "DOCUMENT_DOC", title: "Reading: Note/1", html: "<p>Hi</p>" });
    expect(host.textContent).toContain("common.download");
    await click(host);
    expect(names).toEqual(["Reading Note 1.html"]);
  });

  it("names a fetched file by its type", async () => {
    allowed = true;
    const names = capturedDownloads();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"], { type: "audio/mpeg" }) })));
    const host = await mount({ typeKey: "AUDIO", title: "Talk", url: "https://cdn/x?sig=1" });
    await click(host);
    expect(names).toEqual(["Talk.mp3"]);
  });

  it("opens the file in a new tab when the fetch is refused", async () => {
    allowed = true;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("CORS"); }));
    const host = await mount({ typeKey: "AUDIO", title: "Talk", url: "https://cdn/x.mp3" });
    await click(host);
    expect(open).toHaveBeenCalledWith("https://cdn/x.mp3", "_blank", "noopener,noreferrer");
  });
});

describe("Images in a Docs slide", () => {
  const mountImages = async (props: React.ComponentProps<typeof SlideImagesDownloadButton>) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(SlideImagesDownloadButton, props));
    });
    return host;
  };

  it("lists http(s) and data: images in order without repeats", () => {
    const html =
      '<p>a</p><img src="https://cdn/1.png"><img src="https://cdn/2.jpg?x=1&amp;y=2">' +
      '<img src="https://cdn/1.png"><img src="data:image/png;base64,AA=="><img src="javascript:x"><img>';
    expect(imageSrcsFromHtml(html)).toEqual([
      "https://cdn/1.png",
      "https://cdn/2.jpg?x=1&y=2",
      "data:image/png;base64,AA==",
    ]);
    expect(imageSrcsFromHtml("<p>no images</p>")).toEqual([]);
    expect(imageSrcsFromHtml(null)).toEqual([]);
  });

  it("renders nothing when Images is off or the document has no image", async () => {
    allowed = false;
    expect((await mountImages({ html: '<img src="https://cdn/1.png">' })).innerHTML).toBe("");
    act(() => root?.unmount());
    allowed = true;
    expect((await mountImages({ html: "<p>text</p>" })).innerHTML).toBe("");
  });

  it("downloads a single image named after the slide", async () => {
    allowed = true;
    const names = capturedDownloads();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"], { type: "image/png" }) })));
    const host = await mountImages({ title: "Practice Page", html: '<img src="https://cdn/a">' });
    expect(host.textContent).toContain("common.downloadImages");
    await click(host);
    expect(names).toEqual(["Practice Page.png"]);
  });
});
