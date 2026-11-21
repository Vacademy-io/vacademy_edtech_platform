import { describe, expect, it, vi } from "vitest";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
vi.stubGlobal("localStorage", memoryStorage());
vi.stubGlobal("sessionStorage", memoryStorage());

let serverBody: unknown = "";
const get = vi.fn(async () => ({ data: serverBody }));
vi.mock("@/lib/auth/axiosInstance", () => ({
  default: { get: (...args: unknown[]) => get(...(args as [])), post: async () => ({}) },
}));
vi.mock("@/constants/urls", () => ({
  BASE_URL: "https://backend.example.invalid",
  OPEN_STUDENT_DISPLAY_SETTINGS: "https://backend.example.invalid/open-student-display",
}));
vi.mock("@/constants/helper", () => ({ getInstituteId: async () => "inst-1" }));

const {
  getStudentDisplaySettings,
  mergeWithDefaults,
  isCustomWidget,
  visibleCustomWidgets,
  customWidgetLinkAction,
} = await import("./student-display-settings");
const { DEFAULT_STUDENT_DISPLAY_SETTINGS } = await import(
  "@/constants/display-settings/student-defaults"
);
type Widget = import("@/types/student-display-settings").StudentDashboardWidgetConfig;

/**
 * Custom dashboard widgets used to share the id "custom", and the merge keyed by
 * id, so the learner home only ever had the last one.
 */
const legacyThree = [
  { id: "custom", title: "One", link: "/one", order: 20, visible: true, isCustom: true },
  { id: "custom", title: "Two", link: "https://example.com", order: 21, visible: false, isCustom: true },
  { id: "custom", title: "Three", link: "/three?x=1", order: 22, visible: true, isCustom: true },
];

const merge = (widgets: unknown[]) =>
  mergeWithDefaults({ dashboard: { widgets } } as never).dashboard.widgets;
const customsOf = (widgets: Widget[]) => widgets.filter((w) => isCustomWidget(w));
const builtInsOf = (widgets: Widget[]) => widgets.filter((w) => !isCustomWidget(w));

describe("learner merge of custom dashboard widgets", () => {
  it("keeps all three legacy entries, with the same ids the admin app gives them", () => {
    const customs = customsOf(merge(legacyThree));
    expect(customs.map((w) => [w.id, w.title, w.visible, w.order])).toEqual([
      ["custom", "One", true, 20],
      ["custom:legacy-1", "Two", false, 21],
      ["custom:legacy-2", "Three", true, 22],
    ]);
    // Deterministic: a second load agrees.
    expect(customsOf(merge(legacyThree)).map((w) => w.id)).toEqual(customs.map((w) => w.id));
  });

  it("keeps them through the authenticated settings read too", async () => {
    serverBody = { data: { dashboard: { widgets: legacyThree } } };
    localStorage.clear();
    const s = await getStudentDisplaySettings(true, "inst-1");
    expect(customsOf(s.dashboard.widgets)).toHaveLength(3);
  });

  it("keeps distinct new-style ids as stored", () => {
    const customs = customsOf(
      merge([
        { id: "custom:abc", title: "A", order: 30, visible: true, isCustom: true },
        { id: "custom:def", title: "B", order: 31, visible: true, isCustom: true },
        { id: "custom", title: "Legacy", order: 32, visible: true, isCustom: true },
      ])
    );
    expect(customs.map((w) => w.id)).toEqual(["custom:abc", "custom:def", "custom"]);
  });

  it("leaves the built-in widget merge unchanged", () => {
    const overrides = [
      { id: "myBooks", visible: false },
      { id: "continueLearning", order: 99 },
    ];
    const without = merge(overrides);
    const withCustoms = merge([...legacyThree, ...overrides]);
    expect(builtInsOf(withCustoms)).toEqual(without);
    expect(without.map((w) => w.id).sort()).toEqual(
      DEFAULT_STUDENT_DISPLAY_SETTINGS.dashboard.widgets.map((w) => w.id).sort()
    );
    expect(without.find((w) => w.id === "myBooks")?.visible).toBe(false);
    expect(without.find((w) => w.id === "continueLearning")?.order).toBe(99);
  });
});

describe("visibleCustomWidgets (what the learner home renders)", () => {
  it("returns every visible custom widget in order, and no built-ins", () => {
    const widgets = merge([
      { id: "custom", title: "Third", order: 40, visible: true, isCustom: true },
      { id: "custom", title: "Hidden", order: 10, visible: false, isCustom: true },
      { id: "custom", title: "First", order: 5, visible: true, isCustom: true },
      { id: "custom:abc", title: "Second", order: 6, visible: true, isCustom: true },
    ]);
    expect(visibleCustomWidgets(widgets).map((w) => w.title)).toEqual(["First", "Second", "Third"]);
  });

  it("returns nothing before settings load", () => {
    expect(visibleCustomWidgets(null)).toEqual([]);
  });
});

describe("customWidgetLinkAction", () => {
  it("opens web addresses outside the app", () => {
    expect(customWidgetLinkAction("https://example.com/a")).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
    expect(customWidgetLinkAction("//example.com/a")).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
  });

  it("hands mailto: and tel: to the browser and ignores other schemes", () => {
    expect(customWidgetLinkAction("mailto:a@example.com")).toEqual({
      kind: "assign",
      url: "mailto:a@example.com",
    });
    expect(customWidgetLinkAction("javascript:alert(1)")).toBeNull();
    expect(customWidgetLinkAction("")).toBeNull();
    expect(customWidgetLinkAction(undefined)).toBeNull();
  });

  it("navigates app routes with a query string as a URL, plain routes as before", () => {
    expect(customWidgetLinkAction("/study-library/courses/course-details?courseId=c1")).toEqual({
      kind: "href",
      href: "/study-library/courses/course-details?courseId=c1",
    });
    expect(customWidgetLinkAction("/study-library")).toEqual({ kind: "to", to: "/study-library" });
  });
});
