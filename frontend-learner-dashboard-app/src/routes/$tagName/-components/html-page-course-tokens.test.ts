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

  it("renders template content, FAQs and instructors from course_page_json + authors", () => {
    const coursePageJson = JSON.stringify({
      v: 1, mode: null,
      faqs: [{ q: "Is it live?", a: "<p>Both <b>live</b> and recorded.</p>" }, { q: "Empty", a: "<p></p>" }],
      template: {
        tagline: "Learn <calmly>",
        short_description: "A short line",
        framework: { heading: "The method", intro: "Para one\n\nPara two", cards: [
          { title: "Observe", body: "Look first", points: ["See", "Note"], takeaway: "Pause" },
          { title: "Act" },
        ] },
        learning_experience: { heading: "How you learn", cards: [{ title: "Videos", body: "Short clips" }], callout: "<p>Bonus</p>" },
        testimonials: [{ quote: "Loved it", name: "A. Learner", details: "Parent", review: "Long review" }, { quote: "No name" }],
        enrolment: { description: "<p>Join now</p>", image_id: "enrol01" },
        inclusions: { heading: "Included", items: ["Videos", "Worksheets"] },
      },
    });
    const instructors = [
      { name: "Dr. One", subtitle: "Psychologist", description: "<p>Bio</p>", profilePicId: "pic1" },
      { name: "Two", role: "Instructor", description: "<p></p>" },
    ];
    const t = buildCourseTokens({ ...course, coursePageJson, instructors }, { pic1: "https://cdn.example/pic1.png" });
    expect(applyCourseTokens("{{course.tagline}}", t)).toBe("Learn &lt;calmly&gt;");
    expect(t.short_description).toBe("A short line");
    expect(t.framework_html).toBe(
      '<h2>The method</h2><p>Para one</p><p>Para two</p><div class="course-framework-grid">' +
      '<article class="course-framework-card"><span class="course-card-number">1</span><h3>Observe</h3><p>Look first</p><ul><li>See</li><li>Note</li></ul><p class="course-card-takeaway">Pause</p></article>' +
      '<article class="course-framework-card"><span class="course-card-number">2</span><h3>Act</h3></article></div>',
    );
    expect(t.learning_experience_html).toContain('<article class="course-learning-card"><h3>Videos</h3><p>Short clips</p></article>');
    expect(t.learning_experience_html).toContain('<div class="course-callout"><p>Bonus</p></div>');
    // a review without a name is skipped
    expect(t.testimonials_html).toBe(
      '<blockquote class="course-testimonial"><p class="course-testimonial-quote">Loved it</p><cite>A. Learner<span>Parent</span></cite><p>Long review</p></blockquote>',
    );
    expect(t.enrolment_description).toBe("<p>Join now</p>");
    expect(t.enrolment_image).toBe("enrol01");
    expect(t.inclusions_html).toBe("<h3>Included</h3><ul><li>Videos</li><li>Worksheets</li></ul>");
    // an FAQ with an empty answer is skipped
    expect(t.faqs_html).toBe('<div class="course-faq-item"><h3>Is it live?</h3><div class="course-faq-answer"><p>Both <b>live</b> and recorded.</p></div></div>');
    expect(t.instructors_html).toBe(
      '<article class="course-instructor"><img src="https://cdn.example/pic1.png" alt="Dr. One" loading="lazy"><h3>Dr. One</h3><p class="course-instructor-role">Psychologist</p><div class="course-instructor-bio"><p>Bio</p></div></article>' +
      '<article class="course-instructor"><h3>Two</h3><p class="course-instructor-role">Instructor</p></article>',
    );
    expect(applyCourseTokens("{{course.faqs_html}}", t)).toContain("<b>live</b>");
  });

  it("leaves every template token empty when the course has no page content", () => {
    const t = buildCourseTokens({ ...course, coursePageJson: '{"v":1,"faqs":[]}' });
    for (const k of ["tagline", "short_description", "framework_html", "learning_experience_html", "testimonials_html",
      "enrolment_description", "enrolment_image", "inclusions_html", "faqs_html", "instructors_html"]) {
      expect(t[k]).toBe("");
    }
    expect(buildCourseTokens({ ...course, coursePageJson: "not json" }).framework_html).toBe("");
    // heading alone is not a section
    const headingOnly = JSON.stringify({ template: { framework: { heading: "Only a heading" } } });
    expect(buildCourseTokens({ ...course, coursePageJson: headingOnly }).framework_html).toBe("");
  });

  it("turns the admin's headings and button text into escaped label_* tokens", () => {
    const coursePageJson = JSON.stringify({
      template: { labels: { about: "About <this> course", enrol_button: "  Join now ", faq: "", "Bad-Key": "x", _x: "y", title: "Not a course token" } },
    });
    const t = buildCourseTokens({ ...course, coursePageJson });
    expect(t.label_about).toBe("About <this> course");
    expect(t.label_enrol_button).toBe("Join now");
    expect(t.label_faq).toBeUndefined();
    expect(t["label_Bad-Key"]).toBeUndefined();
    expect(t.label__x).toBeUndefined();
    // prefixed, so a label can never replace a course token
    expect(t.label_title).toBe("Not a course token");
    expect(t.title).toBe(course.title);
    expect(applyCourseTokens("<h2>{{course.label_about}}</h2><b>{{course.label_faq}}</b>", t)).toBe(
      "<h2>About &lt;this&gt; course</h2><b></b>",
    );
    expect(buildCourseTokens({ ...course }).label_about).toBeUndefined();
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

  it("resolves the enrolment image and instructor photos before rendering", async () => {
    const coursePageJson = JSON.stringify({ template: { enrolment: { image_id: "enrol01" } } });
    const { root, shadow } = await mount(
      '{{#course.enrolment_image}}<img class="e" src="{{course.enrolment_image}}" alt="">{{/course.enrolment_image}}<div class="i">{{course.instructors_html}}</div>',
      { ...course, coursePageJson, instructors: [{ name: "Dr. One", profilePicId: "pic1" }] },
    );
    expect(shadow.querySelector("img.e")!.getAttribute("src")).toBe("https://d1om4dxj9e7kkd.cloudfront.net/resolved/enrol01.png");
    expect(shadow.querySelector(".i img")!.getAttribute("src")).toBe("https://d1om4dxj9e7kkd.cloudfront.net/resolved/pic1.png");
    expect(shadow.querySelector(".i h3")!.textContent).toBe("Dr. One");
    await act(async () => root.unmount());
  });

  it("re-fills the instructor list when it changes after the first render (Show All Teachers lands late)", async () => {
    const html = '<div class="i">{{course.instructors_html}}</div>';
    const one = { ...course, instructors: [{ name: "First" }] };
    const { root, shadow } = await mount(html, one);
    expect(shadow.querySelectorAll(".i h3")).toHaveLength(1);
    await act(async () => {
      root.render(React.createElement(HtmlPageSection, { html, css: "", tagName: "tag", courseData: { ...one, instructors: [{ name: "First" }, { name: "Second" }] } }));
    });
    expect(shadow.querySelectorAll(".i h3")).toHaveLength(2);
    await act(async () => root.unmount());
  });

  it("leaves tokens untouched-as-empty when there is no course (ordinary pages)", async () => {
    const { root, shadow } = await mount("<p>{{course.title}}</p>", undefined);
    expect(shadow.querySelector("p")!.textContent).toBe("{{course.title}}");
    await act(async () => root.unmount());
  });
});
