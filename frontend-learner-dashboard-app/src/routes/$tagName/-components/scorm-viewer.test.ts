// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
import React from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { JsonRenderer } from "./JsonRenderer";

/**
 * `scormViewer` plays a SCORM package (a flip-book preview) on the page in our
 * player wrapper. SSR paints the frame chrome and the iframe; these assert the
 * section is wired into the renderer, the frame is sandboxed so the package
 * cannot navigate the site, and a bad / missing URL degrades to a placeholder
 * instead of an empty or hostile frame.
 */
const LAUNCH = "https://vacademy-media-storage-public.s3.amazonaws.com/scorm/abc/vacademy_player_v2.html";

const page = (props: Record<string, unknown>) => ({
  id: "p", route: "p", title: "p",
  components: [{ id: "scorm", type: "scormViewer", enabled: true, props }],
});

const render = (props: Record<string, unknown>) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: page(props), globalSettings: {} as never,
      instituteId: "inst", tagName: "tag",
    } as never),
  );

describe("scormViewer", () => {
  it("is a known component type and paints its heading and frame", () => {
    const html = render({ heading: "Take a Look Inside", launchUrl: LAUNCH, title: "Preview" });
    expect(html).toContain("Take a Look Inside");
    expect(html).not.toContain("Unknown component");
    expect(html).toContain(`src="${LAUNCH}"`);
    expect(html).toContain("Preview");
    expect(html).toContain("jsonRenderer.scormViewer.fullScreen");
    // The website preview waits for marked frames before its screenshot.
    expect(html).toContain("data-scorm-frame");
  });

  it("sandboxes the package: scripts run, the site cannot be navigated away", () => {
    const html = render({ launchUrl: LAUNCH });
    expect(html).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
    expect(html).not.toContain("allow-top-navigation");
  });

  it("hides the full-screen control when turned off", () => {
    const html = render({ launchUrl: LAUNCH, showFullScreen: false });
    expect(html).not.toContain("jsonRenderer.scormViewer.fullScreen");
  });

  it("book appearance drops the card and bar and asks the wrapper to hide the player's controls", () => {
    const html = render({ launchUrl: LAUNCH, appearance: "book", backgroundColor: "#fffdf8", title: "Preview" });
    expect(html).toContain(`src="${LAUNCH}#vchrome=none&amp;vbg=FFFDF8"`);
    expect(html).not.toContain("jsonRenderer.scormViewer.fullScreen");
    expect(html).not.toContain("jsonRenderer.scormViewer.openInNewTab");
    expect(html).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
  });

  it("book appearance waits for the backdrop colour before framing the package", () => {
    // No explicit colour: it is read from the page after mount, so SSR paints no frame yet.
    const html = render({ launchUrl: LAUNCH, appearance: "book" });
    expect(html).not.toContain("<iframe");
  });

  it("a missing or non-http launch URL shows the placeholder, never a frame", () => {
    for (const launchUrl of ["", "javascript:alert(1)", "not a url", undefined]) {
      const html = render({ heading: "x", launchUrl });
      expect(html).toContain("jsonRenderer.scormViewer.noPackage");
      expect(html).not.toContain("<iframe");
    }
  });

  it("on Android keeps the frame above 70% of the screen height, where iSpring players size themselves", async () => {
    const mount = async (ua: string) => {
      vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
      vi.spyOn(window.screen, "height", "get").mockReturnValue(900);
      const el = document.createElement("div");
      const root = createRoot(el);
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      await act(async () => {
        root.render(React.createElement(JsonRenderer, {
          page: page({ launchUrl: LAUNCH, mobileHeight: "60vh", height: "60vh" }), globalSettings: {} as never,
          instituteId: "inst", tagName: "tag",
        } as never));
      });
      const box = el.querySelector("iframe[data-scorm-frame]")?.parentElement as HTMLElement;
      const h = box.style.height;
      act(() => root.unmount());
      vi.restoreAllMocks();
      return h;
    };
    expect(await mount("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/134.0 Mobile Safari/537.36"))
      .toBe("max(60vh, 632px)");
    expect(await mount("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/134.0 Safari/537.36"))
      .toBe("60vh");
  });
});
