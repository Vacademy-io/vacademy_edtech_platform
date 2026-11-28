// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DashboardHero, type DashboardHeroProps } from "./DashboardHero";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/assets/play-illustrations", () => ({
  playIllustrations: new Proxy({}, { get: () => "x.svg" }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_: string, fallback: string) => fallback,
  getTerminologyPlural: (_: string, fallback: string) => `${fallback}s`,
}));

const render = (over: Partial<DashboardHeroProps>) =>
  renderToStaticMarkup(
    createElement(DashboardHero, {
      userName: "A",
      liveSessions: [],
      isLoadingLive: false,
      hasAnyProgress: true,
      resume: null,
      resumeResolving: false,
      coursesBand: false,
      studyLibraryLoaded: true,
      onJoinSession: () => {},
      showGettingStarted: true,
      ...over,
    }),
  );

const RESUME = { slideId: "s", slideTitle: "A lesson", open: () => {} };

describe("DashboardHero", () => {
  it("shows a confirmed lesson even while the rest of the page is out", () => {
    const html = render({ resume: RESUME, studyLibraryLoaded: false, hasAnyProgress: false });
    expect(html).toContain("data-resume-band");
    expect(html).not.toContain('aria-busy="true"');
  });

  it("holds the slot while the answer is out", () => {
    expect(render({ resumeResolving: true })).toContain('aria-busy="true"');
    expect(render({ studyLibraryLoaded: false })).toContain('aria-busy="true"');
  });

  it("swaps the slot for the courses band when no lesson came, even with the first-run question open", () => {
    const html = render({ coursesBand: true, studyLibraryLoaded: false, hasAnyProgress: false });
    expect(html).toContain("data-courses-band");
    expect(html).toContain("hero.goToCourses");
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain("dashboardHero.getStartedTitle");
  });

  it("shows no first-run copy while the first-run question is open", () => {
    const html = render({ studyLibraryLoaded: false, hasAnyProgress: false });
    expect(html).not.toContain("dashboardHero.getStartedTitle");
  });

  it("gives a learner known to be new the checklist, not the courses band", () => {
    const html = render({ coursesBand: true, hasAnyProgress: false });
    expect(html).toContain("dashboardHero.getStartedTitle");
    expect(html).not.toContain("data-courses-band");
  });

  it("keeps the courses band for a new learner whose institute turned the checklist off", () => {
    const html = render({ coursesBand: true, hasAnyProgress: false, showGettingStarted: false });
    expect(html).toContain("data-courses-band");
  });

  it("prefers the lesson to the courses band", () => {
    const html = render({ coursesBand: true, resume: RESUME });
    expect(html).toContain("data-resume-band");
    expect(html).not.toContain("data-courses-band");
  });

  it("renders nothing for a returning learner with no slot held", () => {
    expect(render({})).toBe("");
  });
});
