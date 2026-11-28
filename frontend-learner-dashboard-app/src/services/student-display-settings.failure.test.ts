// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { get } }));
vi.mock("@/constants/helper", () => ({ getInstituteId: async () => "inst-1" }));
vi.mock("@/utils/study-library/get-list-from-stores/getPackageSessionId", () => ({
  getInstituteId: async () => "inst-1",
}));

const KEY = "STUDENT_DISPLAY_SETTINGS_CACHE_V1:inst-1";
const saved = {
  ui: { type: "play" },
  sidebar: { visible: true, tabs: [{ id: "assessment-center", order: 4, visible: false }] },
};

const save = (ts = Date.now()) => {
  const raw = JSON.stringify({ ts, data: saved });
  localStorage.setItem(KEY, raw);
  return raw;
};

const load = async () => {
  vi.resetModules();
  return import("./student-display-settings");
};

const assessments = (s: { sidebar?: { tabs?: { id: string; visible: boolean }[] } }) =>
  s.sidebar?.tabs?.find((tab) => tab.id === "assessment-center")?.visible;

describe("student display settings when the read fails", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "ui-play";
    get.mockReset();
  });

  it("keeps the saved copy byte for byte and serves it", async () => {
    const raw = save();
    get.mockRejectedValue(new Error("offline"));
    const { getStudentDisplaySettings } = await load();
    const result = await getStudentDisplaySettings(true);
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(assessments(result)).toBe(false);
  });

  it("keeps the institute's skin on a forced read", async () => {
    save();
    get.mockRejectedValue(new Error("offline"));
    const { getStudentDisplaySettings } = await load();
    await getStudentDisplaySettings(true);
    expect(document.documentElement.classList.contains("ui-play")).toBe(true);
  });

  it("serves a copy past its freshness window rather than the defaults", async () => {
    const raw = save(Date.now() - 3 * 24 * 60 * 60 * 1000);
    get.mockRejectedValue(new Error("offline"));
    const { getStudentDisplaySettings } = await load();
    const result = await getStudentDisplaySettings(false);
    expect(assessments(result)).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it("uses the defaults with nothing saved, and saves nothing so the next read retries", async () => {
    get.mockRejectedValue(new Error("offline"));
    const { getStudentDisplaySettings } = await load();
    expect(await getStudentDisplaySettings(true)).toEqual(DEFAULT_STUDENT_DISPLAY_SETTINGS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("replaces the saved copy once a read succeeds", async () => {
    save();
    get.mockResolvedValue({ data: { data: { ui: { type: "vibrant" } } } });
    const { getStudentDisplaySettings } = await load();
    await getStudentDisplaySettings(true);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").data.ui.type).toBe("vibrant");
  });
});

describe("student display settings while the read keeps failing", () => {
  const MINUTE = 60 * 1000;
  const networkDown = () => get.mockRejectedValue(new Error("offline"));

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    get.mockReset();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("does not ask again for a minute, across a reload, and answers straight away", async () => {
    networkDown();
    await (await load()).getStudentDisplaySettings(false);
    expect(get).toHaveBeenCalledOnce();

    const { getStudentDisplaySettings } = await load();
    expect(await getStudentDisplaySettings(false)).toEqual(DEFAULT_STUDENT_DISPLAY_SETTINGS);
    expect(get).toHaveBeenCalledOnce();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("serves the saved copy during that pause and writes nothing", async () => {
    const raw = save(Date.now() - 3 * 24 * 60 * 60 * 1000);
    networkDown();
    const first = (await load()).getStudentDisplaySettings(false);
    await vi.advanceTimersByTimeAsync(0);
    await first;
    get.mockClear();

    const result = await (await load()).getStudentDisplaySettings(false);
    expect(get).not.toHaveBeenCalled();
    expect(assessments(result)).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it("asks again after the pause and goes back to normal when the read succeeds", async () => {
    networkDown();
    await (await load()).getStudentDisplaySettings(false);
    vi.setSystemTime(Date.now() + MINUTE + 1);
    get.mockReset();
    get.mockResolvedValue({ data: { data: { ui: { type: "vibrant" } } } });

    const { getStudentDisplaySettings } = await load();
    expect((await getStudentDisplaySettings(false)).ui?.type).toBe("vibrant");
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").data.ui.type).toBe("vibrant");
  });

  it("still asks on a forced read, which is what a sign-in depends on", async () => {
    networkDown();
    await (await load()).getStudentDisplaySettings(false);
    get.mockReset();
    get.mockResolvedValue({ data: { data: { ui: { type: "vibrant" } } } });

    const { getStudentDisplaySettings } = await load();
    expect((await getStudentDisplaySettings(true)).ui?.type).toBe("vibrant");
    expect(get).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps asking when the server answers with a refusal, because it is up", async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    await (await load()).getStudentDisplaySettings(false);
    await (await load()).getStudentDisplaySettings(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("pauses on a server error", async () => {
    get.mockRejectedValue({ response: { status: 503 } });
    await (await load()).getStudentDisplaySettings(false);
    await (await load()).getStudentDisplaySettings(false);
    expect(get).toHaveBeenCalledOnce();
  });

  it("pauses per institute", async () => {
    networkDown();
    await (await load()).getStudentDisplaySettings(false);
    await (await load()).getStudentDisplaySettings(false, "inst-2");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("paints with an expired copy after a moment when the server is slow, and saves the late answer", async () => {
    save(Date.now() - 3 * 24 * 60 * 60 * 1000);
    let answer: (value: unknown) => void = () => {};
    get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { getStudentDisplaySettings } = await load();
    const read = getStudentDisplaySettings(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(assessments(await read)).toBe(false);

    answer({ data: { data: { ui: { type: "vibrant" } } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").data.ui.type).toBe("vibrant");
  });

  it("prefers the server's answer over an expired copy when it arrives in time", async () => {
    save(Date.now() - 3 * 24 * 60 * 60 * 1000);
    get.mockResolvedValue({ data: { data: { ui: { type: "vibrant" } } } });
    const { getStudentDisplaySettings } = await load();
    expect((await getStudentDisplaySettings(false)).ui?.type).toBe("vibrant");
  });

  it("waits for the server when there is no copy at all, rather than guess", async () => {
    let answer: (value: unknown) => void = () => {};
    get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { getStudentDisplaySettings } = await load();
    let settled = false;
    const read = getStudentDisplaySettings(false).then((s) => {
      settled = true;
      return s;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    answer({ data: { data: { ui: { type: "vibrant" } } } });
    expect((await read).ui?.type).toBe("vibrant");
  });
});
