// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setLike = vi.fn();
vi.mock("../-services/blog-service", () => ({
  BlogService: { setLike: (...args: unknown[]) => setLike(...args) },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; minutes?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { BlogLikeButton } from "./components/BlogLikeButton";
import { BlogCard } from "./components/BlogCard";

/**
 * Likes on blog posts: the heart shows only where the section allows it, a
 * tap fills it and moves the count at once, the server's total then wins,
 * and a failed request puts everything back.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// This jsdom setup has no usable localStorage; a Map-backed one is all the hook needs.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const post = { id: "p1", slug: "first", title: "First post", like_count: 4 };
const cardProps = {
  post,
  horizontal: false,
  href: "/school/blog/first",
  onOpen: () => {},
  showCoverImage: false,
  showExcerpt: false,
  showDate: false,
  showAuthor: false,
  showCategory: false,
  showReadingTime: false,
  readMoreLabel: "Read",
  locale: "en",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  setLike.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = () => container.querySelector("button") as HTMLButtonElement;

describe("blog card", () => {
  it("has no heart unless the section allows likes", () => {
    expect(renderToString(React.createElement(BlogCard, cardProps))).not.toContain("aria-pressed");
    const html = renderToString(
      React.createElement(BlogCard, { ...cardProps, likes: { instituteId: "inst", disabled: false } })
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">4<");
  });
});

describe("BlogLikeButton", () => {
  it("fills at once, then shows the server total and remembers the like", async () => {
    let answer: (v: { liked: boolean; like_count: number }) => void = () => {};
    setLike.mockReturnValue(new Promise((r) => (answer = r)));
    await act(async () => {
      root.render(React.createElement(BlogLikeButton, { postId: "p1", instituteId: "inst", likeCount: 4, variant: "compact" }));
    });

    await act(async () => button().click());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().textContent).toBe("5");
    const [instituteId, postId, visitorKey, liked] = setLike.mock.calls[0];
    expect([instituteId, postId, liked]).toEqual(["inst", "p1", true]);
    expect(visitorKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    await act(async () => answer({ liked: true, like_count: 9 }));
    expect(button().textContent).toBe("9");
    expect(JSON.parse(window.localStorage.getItem("catalogue-blog-liked") || "[]")).toEqual(["p1"]);
  });

  it("puts everything back when the request fails", async () => {
    setLike.mockRejectedValue(new Error("offline"));
    await act(async () => {
      root.render(React.createElement(BlogLikeButton, { postId: "p2", instituteId: "inst", likeCount: 2, variant: "button" }));
    });
    await act(async () => button().click());
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(button().textContent).toBe("blog.likeCount:2");
    expect(window.localStorage.getItem("catalogue-blog-liked")).toBe("[]");
  });

  it("never writes a like from the editor preview", async () => {
    await act(async () => {
      root.render(
        React.createElement(BlogLikeButton, { postId: "p3", instituteId: "inst", likeCount: 0, variant: "button", disabled: true })
      );
    });
    await act(async () => button().click());
    expect(setLike).not.toHaveBeenCalled();
    expect(button().textContent).toBe("blog.like");
  });
});
