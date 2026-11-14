import { describe, expect, it, vi } from "vitest";
import type { PublicFolderNode, PublicFolderTree } from "../../-services/folder-library-service";
import { buildMegaMenuModel, initialStreamIndex, isMissingLibraryError, streamTextValues } from "./mega-menu-model";

// The folder service module reads the API base URL from `window` at import.
vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test" }));

const folder = (id: string, extra: Partial<PublicFolderNode> = {}, children: PublicFolderNode[] = []): PublicFolderNode => ({
  id,
  node_type: "FOLDER",
  title: id,
  children,
  ...extra,
});

const page = (id: string): PublicFolderNode => ({
  id,
  node_type: "PRODUCT_PAGE",
  product_page_code: id,
  product_page_name: id,
  children: [],
});

const tree = (roots: PublicFolderNode[]): PublicFolderTree => ({ library: { id: "lib", name: "Streams" }, roots });

describe("buildMegaMenuModel — tiles and categories", () => {
  const education = folder(
    "edu",
    {
      title: "शिक्षा",
      subtitle: "Education",
      tagline: "Learn the Indian way of learning.",
      description: "Pedagogy rooted in the gurukul tradition.",
      image_url: "https://cdn.example/edu.png",
      accent_color: "#F59E0B", // design-lint-ignore: test fixture colour
    },
    [
      folder("vedic", { title: "वैदिक गणित", subtitle: "Vedic Maths", description: "Speed maths" }),
      page("path-1"),
      folder("empty-cat", { title: "Sanskrit" }),
    ],
  );

  it("turns top-level folders into streams and their child folders into categories", () => {
    const model = buildMegaMenuModel(tree([education, page("loose-page"), folder("arts", { title: "Kala" })]), {});
    expect(model.streams.map((s) => s.id)).toEqual(["edu", "arts"]);
    const [edu] = model.streams;
    expect(edu).toMatchObject({
      slug: "education",
      title: "शिक्षा",
      subtitle: "Education",
      tagline: "Learn the Indian way of learning.",
      imageUrl: "https://cdn.example/edu.png",
      accentColor: "#F59E0B", // design-lint-ignore: test fixture colour
      comingSoon: false,
      ctaLabel: null,
    });
    // Product pages are not categories; empty folders are (they filter by tag).
    expect(edu.categories.map((c) => c.id)).toEqual(["vedic", "empty-cat"]);
  });

  it("links streams and categories with the default patterns, keyed by slug", () => {
    const [edu] = buildMegaMenuModel(tree([education]), {}).streams;
    expect(edu.action).toEqual({ kind: "link", link: { href: "/courses?stream=education", external: false } });
    expect(edu.categories[0].action).toEqual({
      kind: "link",
      link: { href: "/courses?stream=education&category=vedic-maths", external: false },
    });
  });

  it("uses the author's patterns, and a folder's own link_url over any pattern", () => {
    const withLink = folder("edu", { title: "Education", slug: "shiksha", link_url: "https://edu.example/" }, [
      folder("c1", { title: "Maths", slug: "ganit" }),
      folder("c2", { title: "Art", slug: "kala", link_url: "/art-hub" }),
    ]);
    const [edu] = buildMegaMenuModel(tree([withLink]), {
      streamLinkPattern: "/streams/{stream}",
      categoryLinkPattern: "/streams/{stream}/{category}",
    }).streams;
    expect(edu.action).toEqual({ kind: "link", link: { href: "https://edu.example/", external: true } });
    expect(edu.categories[0].action).toEqual({ kind: "link", link: { href: "/streams/shiksha/ganit", external: false } });
    expect(edu.categories[1].action).toEqual({ kind: "link", link: { href: "/art-hub", external: false } });
  });

  it("never links to an unsafe link_url or pattern", () => {
    const evil = folder("x", { title: "X", link_url: "javascript:alert(1)" }, [
      folder("y", { title: "Y", link_url: "//evil.example" }),
    ]);
    const [x] = buildMegaMenuModel(tree([evil]), { categoryLinkPattern: "data:text/html,{category}" }).streams;
    // A bad link_url falls back to the (safe) default stream pattern…
    expect(x.action).toEqual({ kind: "link", link: { href: "/courses?stream=x", external: false } });
    // …and a bad pattern leaves the category with nothing to open.
    expect(x.categories[0].action).toEqual({ kind: "none" });
  });

  it("drops bad images and colours, and folders with no name at all", () => {
    const messy = folder("m", { title: "M", image_url: "javascript:x", accent_color: "orange" }, [
      folder("nameless", { title: "  ", subtitle: "" }),
      folder("sub-only", { title: "", subtitle: "Only subtitle" }),
    ]);
    const [m] = buildMegaMenuModel(tree([messy]), {}).streams;
    expect(m.imageUrl).toBeNull();
    expect(m.accentColor).toBeNull();
    expect(m.categories.map((c) => [c.id, c.title, c.subtitle])).toEqual([["sub-only", "Only subtitle", ""]]);
  });

  it("gives an empty model for a missing or malformed tree", () => {
    expect(buildMegaMenuModel(undefined, {})).toEqual({ streams: [] });
    expect(buildMegaMenuModel({ library: { id: "l", name: "L" }, roots: null as never }, {}).streams).toEqual([]);
  });

  it("keeps the folder's own CTA label", () => {
    const [s] = buildMegaMenuModel(tree([folder("s", { title: "S", cta_label: " Explore Education " })]), {}).streams;
    expect(s.ctaLabel).toBe("Explore Education");
  });
});

describe("buildMegaMenuModel — coming soon", () => {
  it("turns a coming-soon category with a form into a notify action, without a link", () => {
    const s = folder("s", { title: "S" }, [
      folder("soon", { title: "Soon", coming_soon: true, audience_id: " aud-1 ", link_url: "/somewhere" }),
      folder("soon-no-form", { title: "Later", coming_soon: true }),
    ]);
    const model = buildMegaMenuModel(tree([s]), {});
    const [soon, later] = model.streams[0].categories;
    expect(soon).toMatchObject({ comingSoon: true, action: { kind: "notify", audienceId: "aud-1" } });
    expect(later).toMatchObject({ comingSoon: true, action: { kind: "none" } });
  });

  it("treats every category of a coming-soon stream as coming soon, using the stream's form as fallback", () => {
    const s = folder("s", { title: "S", coming_soon: true, audience_id: "stream-aud" }, [
      folder("a", { title: "A" }),
      folder("b", { title: "B", audience_id: "own-aud" }),
    ]);
    const [stream] = buildMegaMenuModel(tree([s]), {}).streams;
    expect(stream.action).toEqual({ kind: "notify", audienceId: "stream-aud" });
    expect(stream.categories.map((c) => c.action)).toEqual([
      { kind: "notify", audienceId: "stream-aud" },
      { kind: "notify", audienceId: "own-aud" },
    ]);
  });

  it("does not borrow the stream's form for a coming-soon category of an open stream", () => {
    const s = folder("s", { title: "S", audience_id: "stream-aud" }, [folder("a", { title: "A", coming_soon: true })]);
    expect(buildMegaMenuModel(tree([s]), {}).streams[0].categories[0].action).toEqual({ kind: "none" });
  });

  it("keeps an open stream's open categories linked", () => {
    const [stream] = buildMegaMenuModel(tree([folder("s", { title: "S" }, [folder("a")])]), {}).streams;
    expect(stream.comingSoon).toBe(false);
    expect(stream.categories.map((c) => [c.comingSoon, c.action.kind])).toEqual([[false, "link"]]);
  });
});

describe("isMissingLibraryError", () => {
  it("is true only for the public tree's 404 (deleted or unknown library)", () => {
    expect(isMissingLibraryError({ response: { status: 404 } })).toBe(true);
    expect(isMissingLibraryError({ response: { status: 500 } })).toBe(false);
    expect(isMissingLibraryError({ response: { status: "404" } })).toBe(false);
    expect(isMissingLibraryError(new Error("Network Error"))).toBe(false);
    expect(isMissingLibraryError(null)).toBe(false);
    expect(isMissingLibraryError(undefined)).toBe(false);
  });
});

describe("initialStreamIndex", () => {
  const streams = buildMegaMenuModel(
    tree([folder("a", { title: "A", slug: "shiksha" }), folder("b", { title: "B", slug: "kala" })]),
    {},
  ).streams;

  it("opens on the stream named by ?stream=, else the first", () => {
    expect(initialStreamIndex(streams, "kala")).toBe(1);
    expect(initialStreamIndex(streams, " KALA ")).toBe(1);
    expect(initialStreamIndex(streams, "unknown")).toBe(0);
    expect(initialStreamIndex(streams, null)).toBe(0);
    expect(initialStreamIndex([], "kala")).toBe(-1);
  });
});

describe("streamTextValues", () => {
  it("names a stream by its subtitle (the English caption), else its title", () => {
    expect(streamTextValues({ title: "शिक्षा", subtitle: "Education" })).toEqual({ stream: "Education", title: "शिक्षा" });
    expect(streamTextValues({ title: "Education", subtitle: "" })).toEqual({ stream: "Education", title: "Education" });
  });

  it("translates through the display translator", () => {
    const dict: Record<string, string> = { Education: "शिक्षा" };
    expect(streamTextValues({ title: "Education", subtitle: "" }, (s) => dict[s] ?? s)).toEqual({
      stream: "शिक्षा",
      title: "शिक्षा",
    });
  });
});
