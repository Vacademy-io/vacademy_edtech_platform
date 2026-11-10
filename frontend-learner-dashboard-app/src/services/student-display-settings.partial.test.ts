import { beforeEach, describe, expect, it, vi } from "vitest";

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

// What the authenticated settings read gets back from the server.
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

const { getStudentDisplaySettings, getPublicStudentDisplaySettings } = await import(
  "./student-display-settings"
);

async function readAuthenticated(body: unknown) {
  serverBody = body;
  localStorage.clear();
  sessionStorage.clear();
  return getStudentDisplaySettings(true, "inst-1");
}

async function readPublic(body: unknown, id: string) {
  serverBody = body;
  localStorage.clear();
  return getPublicStudentDisplaySettings(id, { skipLocalCache: true });
}

/** Every leaf path that differs between two settings objects. */
function differingPaths(a: unknown, b: unknown, at = ""): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      differingPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k)
    );
  }
  return [at || "(root)"];
}

describe("a STUDENT_DISPLAY_SETTINGS object holding only ui.type", () => {
  beforeEach(() => get.mockClear());

  it("reads the same as nothing saved, apart from ui.type (authenticated read)", async () => {
    const nothing = await readAuthenticated("");
    const partial = await readAuthenticated({ data: { ui: { type: "play" } } });
    expect(get).toHaveBeenCalledTimes(2);
    expect(partial.ui.type).toBe("play");
    expect(differingPaths(nothing, partial)).toEqual(["ui.type"]);
  });

  it("reads the same as nothing saved, apart from ui.type (pre-login read)", async () => {
    const nothing = await readPublic(null, "inst-a");
    const partial = await readPublic({ ui: { type: "play" } }, "inst-b");
    expect(differingPaths(nothing, partial)).toEqual(["ui.type"]);
  });
});
