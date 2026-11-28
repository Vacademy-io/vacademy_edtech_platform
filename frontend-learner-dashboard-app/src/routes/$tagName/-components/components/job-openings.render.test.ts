// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const location = { pathname: "/school/careers", searchStr: "" };
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "school" }),
  useLocation: () => location,
  useRouter: () => ({ navigate: () => {}, latestLocation: { search: {} } }),
  Link: () => null,
}));
vi.mock("../../-services/blog-service", () => ({
  BlogService: { listPosts: () => new Promise(() => {}), getPost: () => new Promise(() => {}) },
}));
import React from "react";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "../JsonRenderer";
import { JOB_TEMPLATES, resolveJobs, safeExternalUrl, slugifyJobTitle } from "../../-utils/job-openings";

/**
 * The `jobOpenings` section renders job cards on the page URL and one job as
 * a page of its own on /<page>/<job-slug> — the blog's address shape, no
 * popup. These pin the wiring through JsonRenderer: card links, the detail
 * face with its external Apply link, the unknown-slug fallback, hidden
 * disabled jobs, and every template rendering both faces.
 */
const JOBS = [
  {
    id: "j1",
    title: "Educator Vacancy",
    summary: "Teach Biology to NEET aspirants.",
    location: "Jaipur",
    jobType: "Full-time",
    compensation: "₹40,000 / month",
    details: [{ label: "Exam focus", value: "NEET" }],
    image: "https://cdn.example.com/poster.png",
    description: "<h2>Role</h2><ul><li>Teach</li></ul><p>Hello</p><script>alert(1)</script>",
    applyUrl: "https://forms.gle/abc123",
    enabled: true,
  },
  {
    id: "j2",
    slug: "",
    title: "Content Writer",
    summary: "Write study notes.",
    description: "<p>Notes</p>",
    applyUrl: "javascript:alert(1)",
    enabled: true,
  },
  { id: "j3", title: "Hidden Role", summary: "Not open", applyUrl: "https://forms.gle/x", enabled: false },
];

const render = (pathname: string, props: Record<string, unknown> = {}, searchStr = "") => {
  location.pathname = pathname;
  location.searchStr = searchStr;
  return renderToString(
    React.createElement(JsonRenderer, {
      page: {
        id: "careers",
        route: "careers",
        title: "Careers",
        components: [
          { id: "jobs", type: "jobOpenings", enabled: true, props: { headerText: "Join our team", jobs: JOBS, ...props } },
        ],
      } as never,
      globalSettings: {} as never,
      instituteId: "inst",
      tagName: "school",
    })
  );
};

describe("jobOpenings section", () => {
  it("renders a card per enabled job, linking to /<tag>/<page>/<slug>", () => {
    const html = render("/school/careers");
    expect(html).toContain("Join our team");
    expect(html).toContain('href="/school/careers/educator-vacancy"');
    expect(html).toContain('href="/school/careers/content-writer"');
    expect(html).toContain("Teach Biology to NEET aspirants.");
    expect(html).not.toContain("data-job-detail");
  });

  it("hides disabled jobs", () => {
    const html = render("/school/careers");
    expect(html).not.toContain("Hidden Role");
    expect(html).not.toContain("hidden-role");
  });

  it("renders the job page for a matching slug, with an external Apply link", () => {
    const html = render("/school/careers/educator-vacancy");
    expect(html).toContain('data-job-detail="educator-vacancy"');
    expect(html).toContain('href="https://forms.gle/abc123"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<h2>Role</h2>");
    expect(html).toContain("<li>Teach</li>");
    expect(html).toContain("NEET");
    expect(html).toContain('href="/school/careers"');
    expect(html).not.toContain("<script>");
    // The cards are gone while one job is open.
    expect(html).not.toContain('data-job-card="content-writer"');
  });

  it("drops a non-http apply link", () => {
    const html = render("/school/careers/content-writer");
    expect(html).toContain('data-job-detail="content-writer"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data-job-apply");
  });

  it("falls back to the cards for an unknown or disabled job slug", () => {
    for (const path of ["/school/careers/no-such-job", "/school/careers/hidden-role"]) {
      const html = render(path);
      expect(html).not.toContain("data-job-detail");
      expect(html).toContain('href="/school/careers/educator-vacancy"');
    }
  });

  it("uses ?job= on the home page", () => {
    location.pathname = "/school";
    location.searchStr = "";
    const html = renderToString(
      React.createElement(JsonRenderer, {
        page: { id: "home", route: "homepage", components: [{ id: "j", type: "jobOpenings", enabled: true, props: { jobs: JOBS } }] } as never,
        globalSettings: {} as never,
        instituteId: "inst",
        tagName: "school",
      })
    );
    expect(html).toContain('href="/school?job=educator-vacancy"');
  });

  it.each(JOB_TEMPLATES)("template %s renders cards and the job page", (template) => {
    const cards = render("/school/careers", { template });
    expect(cards).toContain(`data-job-openings="${template}"`);
    expect(cards).toContain('href="/school/careers/educator-vacancy"');
    expect(cards).toContain("Content Writer");
    const detail = render("/school/careers/educator-vacancy", { template });
    expect(detail).toContain('data-job-detail="educator-vacancy"');
    expect(detail).toContain('href="https://forms.gle/abc123"');
    expect(detail).toContain("<h2>Role</h2>");
  });

  it("falls back to classic for an unknown template", () => {
    expect(render("/school/careers", { template: "nope" })).toContain('data-job-openings="classic"');
  });
});

describe("job helpers", () => {
  it("derives unique slugs from titles, keeping non-Latin letters", () => {
    const jobs = resolveJobs([
      { title: "Educator Vacancy" },
      { title: "Educator  vacancy!" },
      { title: "शिक्षक भर्ती" },
      { title: "Ops", slug: "Custom Slug" },
      { title: "" },
    ]);
    expect(jobs.map((j) => j.slug)).toEqual(["educator-vacancy", "educator-vacancy-2", "शिक्षक-भर्ती", "custom-slug"]);
    expect(slugifyJobTitle("  --Hi, there--  ")).toBe("hi-there");
  });

  it("takes slugs from the authored jobs, not translated ones", () => {
    const jobs = resolveJobs([{ title: "Professeur" }], [{ title: "Teacher" }]);
    expect(jobs[0].slug).toBe("teacher");
    expect(jobs[0].title).toBe("Professeur");
  });

  it("accepts only http(s) apply links", () => {
    expect(safeExternalUrl("https://forms.gle/a")).toBe("https://forms.gle/a");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("/careers")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });
});
