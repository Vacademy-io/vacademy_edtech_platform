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
import { JsonRenderer } from "./JsonRenderer";

/**
 * `videoEmbed` used to frame ANY url in an <iframe>. For an uploaded mp4 that
 * hands the visitor the browser's stock media document — with a download
 * menu, right-click "Save video as…", and nothing we can style (Sreedhar's
 * TTS gallery, 2026-09-18). Uploaded files now get the play/pause-only
 * PlainVideoPlayer; YouTube/Vimeo keep the iframe.
 */
const page = (props: Record<string, unknown>) => ({
  id: "home", route: "home", title: "home",
  components: [{ id: "v", type: "videoEmbed", enabled: true, props }],
});

const render = (props: Record<string, unknown>) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: page(props), globalSettings: {} as never,
      instituteId: "inst", tagName: "tag",
    } as never),
  );

const MP4 = "https://d1om4dxj9e7kkd.cloudfront.net/CATALOGUE_IMAGES/ADMIN/x/tts/abc-training-session-1-v2.mp4";

describe("videoEmbed with an uploaded file", () => {
  it("renders a <video> without native controls instead of an iframe", () => {
    const html = render({ url: MP4, aspectRatio: "9:16", caption: "Aptitude session" });
    expect(html).not.toContain("<iframe");
    expect(html).toContain("<video");
    expect(html).not.toMatch(/<video[^>]*\scontrols(\s|>|=)/);
  });

  it("blocks download, PiP and remote playback and keeps only a play/pause button", () => {
    const html = render({ url: MP4, poster: "https://d1om4dxj9e7kkd.cloudfront.net/p.jpg" });
    // React SSR keeps the JSX casing (controlsList, disablePictureInPicture); the DOM lower-cases them.
    expect(html).toMatch(/<video[^>]*\scontrolsList="nodownload noplaybackrate noremoteplayback nofullscreen"/i);
    expect(html).toMatch(/<video[^>]*\sdisablePictureInPicture/i);
    expect(html).toMatch(/<video[^>]*\sdisableRemotePlayback/i);
    expect(html).toContain('poster="https://d1om4dxj9e7kkd.cloudfront.net/p.jpg"');
    expect(html.match(/<button/g)?.length).toBe(1);
    // i18n is not initialised under vitest, so the raw key comes through.
    expect(html).toMatch(/aria-label="(Play|jsonRenderer\.play)"/);
  });

  it("honours the 9:16 box so portrait phone clips are not letterboxed", () => {
    const html = render({ url: MP4, aspectRatio: "9:16" });
    expect(html).toContain("padding-bottom:177.78%");
  });
});

describe("videoEmbed with a YouTube link", () => {
  it("still uses the iframe embed", () => {
    const html = render({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(html).toContain("<iframe");
    expect(html).toContain("youtube.com/embed/dQw4w9WgXcQ");
    expect(html).not.toContain("<video");
  });
});
