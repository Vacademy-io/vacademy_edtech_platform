// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
vi.mock("@/services/upload_file", () => ({
  // media ids → URLs, the way media-service does; direct URLs pass through
  getPublicUrlWithoutLogin: async (id: string) =>
    /^https?:/.test(id) ? id : `https://d1om4dxj9e7kkd.cloudfront.net/resolved/${id}.png`,
}));
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HtmlPageSection, OPEN_COURSE_ENROLLMENT_EVENT } from "./components/HtmlPageSection";
import { applyCourseTokens, buildCourseTokens, courseTokenMediaKeys } from "../-utils/course-html-tokens";

/**
 * One html `details` page for every course: `{{course.*}}` tokens are filled
 * from courseData before the page is sanitised and rendered, and a
 * data-vacademy="enrol" button opens the course's own enrolment flow.
 */
const course = {
  courseId: "b91f69a4", title: "The Engineer's Toolkit <Vol 1>", price: 490, elevatedPrice: 500, currency: "INR",
  duration: "6m", level: "DEFAULT", instructor: "Sreedhar Jalapati", rating: 5, tags: ["aptitude", "reasoning"],
  about_the_course_html: "<p>Puzzles &amp; <b>problems</b></p><script>alert(1)</script>",
  whyLearn: "<p>Speed</p>", whoShouldLearn: "<p>First-years</p>",
  previewImage: "faf7021b", bannerImage: "/api/placeholder/400/300", thumbnail: "a68e9902",
};

describe("course tokens (pure)", () => {
  it("escapes text tokens, keeps *_html raw, formats money and discount", () => {
    const t = buildCourseTokens(course);
    expect(t.title).toBe("The Engineer's Toolkit <Vol 1>");
    expect(applyCourseTokens("<h1>{{course.title}}</h1>", t)).toBe("<h1>The Engineer&#39;s Toolkit &lt;Vol 1&gt;</h1>");
    expect(applyCourseTokens("{{ course.description_html }}", t)).toContain("<b>problems</b>");
    expect(t.price).toBe("₹490"); expect(t.mrp).toBe("₹500"); expect(t.discount).toBe("2");
    expect(t.banner).toBe("");           // placeholder path → empty, never rendered as an <img>
    expect(t.image).toBe("faf7021b");    // media id, resolved by the host
    expect(applyCourseTokens("{{course.nope}}|{{course.tags}}", t)).toBe("|aptitude, reasoning");
  });

  it("keeps {{#course.x}} blocks only when the token has a value", () => {
    const t = buildCourseTokens(course);
    const tpl = "<b>{{course.price}}</b>{{#course.mrp}}<s>{{course.mrp}}</s> {{course.discount}}% off{{/course.mrp}}{{#course.banner}}<img src=\"{{course.banner}}\">{{/course.banner}}";
    expect(applyCourseTokens(tpl, t)).toBe("<b>₹490</b><s>₹500</s> 2% off");
    expect(applyCourseTokens(tpl, buildCourseTokens({ ...course, elevatedPrice: undefined }))).toBe("<b>₹490</b>");
    // unknown price (no enroll-invite context) → empty, so a {{#course.price}} block hides the price box
    expect(buildCourseTokens({ ...course, price: 0, elevatedPrice: undefined }).price).toBe("");
  });

  it("lists only the media tokens the markup uses", () => {
    expect(courseTokenMediaKeys("<img src='{{course.image}}'> {{course.title}} {{course.image}}")).toEqual(["image"]);
    expect(courseTokenMediaKeys("{{course.title}}")).toEqual([]);
  });
});

const mount = async (html: string, courseData: unknown) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(React.createElement(HtmlPageSection, { html, css: "", tagName: "tag", courseData }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); // media resolution tick
  const host = el.querySelector(".catalogue-html-section") as HTMLElement;
  return { root, shadow: host.shadowRoot! };
};

describe("html details page on a course route", () => {
  it("renders course fields, resolves the image id, and drops scripts from rich text", async () => {
    const { root, shadow } = await mount(
      '<section><h1>{{course.title}}</h1><img src="{{course.image}}" alt=""><div class="d">{{course.description_html}}</div>' +
      '<b class="p">{{course.price}}</b><s>{{course.mrp}}</s><button data-vacademy="enrol" data-course="{{course.id}}">Enrol</button></section>',
      course,
    );
    expect(shadow.querySelector("h1")!.textContent).toBe("The Engineer's Toolkit <Vol 1>");
    expect(shadow.querySelector("img")!.getAttribute("src")).toBe("https://d1om4dxj9e7kkd.cloudfront.net/resolved/faf7021b.png");
    expect(shadow.querySelector(".d b")!.textContent).toBe("problems");
    expect(shadow.querySelector("script")).toBeNull();
    expect(shadow.querySelector(".p")!.textContent).toBe("₹490");
    expect(shadow.querySelector("s")!.textContent).toBe("₹500");
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail.courseId);
    window.addEventListener(OPEN_COURSE_ENROLLMENT_EVENT, listener);
    (shadow.querySelector("button") as HTMLButtonElement).click();
    window.removeEventListener(OPEN_COURSE_ENROLLMENT_EVENT, listener);
    expect(seen).toEqual(["b91f69a4"]);
    await act(async () => root.unmount());
  });

  it("leaves tokens untouched-as-empty when there is no course (ordinary pages)", async () => {
    const { root, shadow } = await mount("<p>{{course.title}}</p>", undefined);
    expect(shadow.querySelector("p")!.textContent).toBe("{{course.title}}");
    await act(async () => root.unmount());
  });
});
