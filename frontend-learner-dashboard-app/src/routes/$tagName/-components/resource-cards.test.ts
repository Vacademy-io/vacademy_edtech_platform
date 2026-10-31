// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";
import {
  markResourceUnlocked,
  normalizeResourceUrl,
  rememberResourceIdentity,
  useResourceTrackingContext,
} from "../-utils/resource-unlock";

/**
 * featureGrid `resource` style — the free-resources library card. Asserts the
 * card anatomy (thumbnail, badge, chips, button) and the email gate: a gated
 * link is a button that asks the page shell for the gate list's form, and
 * turns into a plain link once that list is unlocked in this browser.
 */
// This jsdom build ships no Storage; a Map-backed one is all the unlock needs.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const GATE = "aud-free-pdfs";
const PDF = "https://cdn.example.com/CATALOGUE_DOCUMENTS/ADMIN/x-guide.pdf";

const features = [
  {
    title: "Daily Routine Chart",
    description: "A printable routine for mornings.",
    image: "https://img.example.com/thumb.png",
    badge: "Featured",
    chips: ["Ages 2–4", "PDF"],
    link: { text: "Download", url: PDF, gated: true },
  },
  {
    title: "Root Chakra Meditation",
    description: "Five quiet minutes.",
    image: "https://img.example.com/med.png",
    chips: ["5 min"],
    link: { text: "Listen", url: "https://www.youtube.com/watch?v=abc" },
  },
];

const element = (props: Record<string, unknown>) =>
  React.createElement(JsonRenderer, {
    page: {
      id: "p", route: "p", title: "p",
      components: [{ id: "lib", type: "featureGrid", enabled: true, props: { style: "resource", features, ...props } }],
    },
    globalSettings: {} as never,
    instituteId: "inst",
    tagName: "tag",
  } as never);

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = async (props: Record<string, unknown>) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element(props)));
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

describe("featureGrid resource style", () => {
  it("paints thumbnail, badge, chips, title and the action label", () => {
    const html = renderToString(element({}));
    expect(html).toContain("https://img.example.com/thumb.png");
    expect(html).toContain("Featured");
    expect(html).toContain("Ages 2–4");
    expect(html).toContain("Daily Routine Chart");
    expect(html).toContain("Download");
    expect(html).toContain("Listen");
  });

  it("without a gate list every link is a plain link", async () => {
    const el = await mount({});
    expect(el.querySelectorAll("article button")).toHaveLength(0);
    expect(el.querySelector(`a[href="${PDF}"]`)).not.toBeNull();
  });

  it("a gated link opens the gate list's form with the file to hand over", async () => {
    const el = await mount({ gateAudienceId: GATE, gateTitle: "Get your free printables" });
    const seen: unknown[] = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("openAudienceForm", onOpen);

    const button = el.querySelector("article button") as HTMLButtonElement;
    expect(button.textContent).toContain("Download");
    expect(el.querySelector(`a[href="${PDF}"]`)).toBeNull();
    // The ungated card stays a link.
    expect(el.querySelector('a[href="https://www.youtube.com/watch?v=abc"]')).not.toBeNull();

    await act(async () => button.click());
    window.removeEventListener("openAudienceForm", onOpen);
    expect(seen).toEqual([
      {
        audienceId: GATE,
        title: "Get your free printables",
        unlockUrl: PDF,
        unlockLabel: "Download",
        unlockTitle: "Daily Routine Chart",
      },
    ]);
  });

  it("unlocking the list turns the gated card into a direct link, live", async () => {
    const el = await mount({ gateAudienceId: GATE });
    expect(el.querySelector("article button")).not.toBeNull();
    await act(async () => markResourceUnlocked(GATE));
    expect(el.querySelector("article button")).toBeNull();
    expect(el.querySelector(`a[href="${PDF}"]`)).not.toBeNull();
  });

  it("gateAll gates every card in the section, not only flagged ones", async () => {
    const el = await mount({ gateAudienceId: GATE, gateAll: true });
    expect(el.querySelectorAll("article button")).toHaveLength(2);
    expect(el.querySelector('a[href="https://www.youtube.com/watch?v=abc"]')).toBeNull();
  });

  it("an earlier unlock in this browser is honoured on mount", async () => {
    window.localStorage.setItem(`catalogue-resource-unlock:${GATE}`, "1");
    const el = await mount({ gateAudienceId: GATE });
    expect(el.querySelector("article button")).toBeNull();
  });

  describe("download tracking", () => {
    const beacons: Array<{ url: string; body: Record<string, unknown> }> = [];
    const Shell = ({ withContext }: { withContext: boolean }) => {
      useResourceTrackingContext(
        withContext ? { instituteId: "inst", catalogueId: "cat", pageRoute: "free-resources" } : null
      );
      return element({ gateAudienceId: GATE });
    };
    const mountShell = async (withContext: boolean) => {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root!.render(React.createElement(Shell, { withContext })));
      return host;
    };

    afterEach(() => {
      beacons.length = 0;
    });

    const stubBeacon = () =>
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: (url: string, data: Blob) => {
          // Blob.text() is async; read synchronously through the stored JSON instead.
          beacons.push({ url, body: (data as Blob & { __json?: Record<string, unknown> }).__json ?? {} });
          return true;
        },
      });

    it("an opened card is recorded with the identity typed into the gate form", async () => {
      stubBeacon();
      const RealBlob = globalThis.Blob;
      vi.stubGlobal(
        "Blob",
        class extends RealBlob {
          __json: Record<string, unknown>;
          constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
            super(parts, opts);
            this.__json = JSON.parse(String(parts[0]));
          }
        }
      );
      rememberResourceIdentity({ email: "parent@example.com", mobileNumber: "+91 98765 43210" });
      const el = await mountShell(true);
      const link = el.querySelector('a[href="https://www.youtube.com/watch?v=abc"]') as HTMLAnchorElement;
      link.addEventListener("click", (e) => e.preventDefault());
      await act(async () => link.click());
      vi.unstubAllGlobals();

      expect(beacons).toHaveLength(1);
      expect(beacons[0].url).toContain("/admin-core-service/open/v1/catalogue-resources/download");
      expect(beacons[0].body).toMatchObject({
        instituteId: "inst",
        catalogueId: "cat",
        pageRoute: "free-resources",
        audienceId: GATE,
        resourceTitle: "Root Chakra Meditation",
        resourceUrl: "https://www.youtube.com/watch?v=abc",
        email: "parent@example.com",
        mobileNumber: "+91 98765 43210",
      });
    });

    it("nothing is sent before the page shell has said which institute it is", async () => {
      stubBeacon();
      const el = await mountShell(false);
      const link = el.querySelector('a[href="https://www.youtube.com/watch?v=abc"]') as HTMLAnchorElement;
      link.addEventListener("click", (e) => e.preventDefault());
      await act(async () => link.click());
      expect(beacons).toHaveLength(0);
    });
  });

  describe("pasted links", () => {
    it.each([
      ["drive.google.com/file/d/abc/view?usp=sharing", "https://drive.google.com/file/d/abc/view?usp=sharing"],
      ["www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=abc"],
      ["youtu.be/abc", "https://youtu.be/abc"],
      ["https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/playlist?list=PL1"],
      ["about-us", "about-us"],
      ["/blog/first-steps", "/blog/first-steps"],
      ["#pricing", "#pricing"],
      ["mailto:hi@example.com", "mailto:hi@example.com"],
      ["worksheet.pdf", "worksheet.pdf"],
      ["guides/intro.html", "guides/intro.html"],
      ["docs.google.com/document/d/x", "https://docs.google.com/document/d/x"],
    ])("%s → %s", (raw, expected) => {
      expect(normalizeResourceUrl(raw)).toBe(expected);
    });

    it("a Drive link pasted without https opens Drive, not a site page", async () => {
      const drive = "drive.google.com/file/d/abc/view";
      const el = await mount({
        features: [{ title: "Worksheet", link: { text: "Open", url: drive } }],
      });
      expect(el.querySelector(`a[href="https://${drive}"]`)).not.toBeNull();
    });
  });
});
