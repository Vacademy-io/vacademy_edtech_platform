import { describe, expect, it, vi, beforeEach } from "vitest";

const { fetchStudentDetailsMock, store } = vi.hoisted(() => ({
  fetchStudentDetailsMock: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
  },
}));
vi.mock("@/services/studentDetails", () => ({
  fetchStudentDetails: fetchStudentDetailsMock,
}));
vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenFromStorage: vi.fn(async () => "token"),
  getTokenDecodedData: vi.fn(() => ({ user: "user-1" })),
}));

import { loadPackageSessionIds } from "./getPackageSessionId";

// What login saved: one course, for institute inst-login.
const oldRow = { user_id: "user-1", package_session_id: "batch-old", extra: "kept" };
const newRow = { user_id: "user-1", package_session_id: "batch-new" };

const load = async () => {
  const calls: string[][] = [];
  await loadPackageSessionIds((ids) => calls.push(ids));
  return calls;
};

describe("loadPackageSessionIds", () => {
  beforeEach(() => {
    store.clear();
    store.set("students", JSON.stringify([oldRow]));
    store.set("StudentDetails", JSON.stringify({ ...oldRow, institute_id: "inst-login" }));
    fetchStudentDetailsMock.mockReset();
  });

  it("gives the saved ids first, then adds a course joined after login", async () => {
    fetchStudentDetailsMock.mockResolvedValue({ status: 200, data: [oldRow, newRow] });

    expect(await load()).toEqual([["batch-old"], ["batch-old", "batch-new"]]);
    // Asked for the institute the saved list belongs to.
    expect(fetchStudentDetailsMock).toHaveBeenCalledWith("inst-login", "user-1");
    // Saved list is extended; the existing row is untouched.
    expect(JSON.parse(store.get("students")!)).toEqual([oldRow, newRow]);
  });

  it("changes nothing when the saved list is already complete", async () => {
    fetchStudentDetailsMock.mockResolvedValue({ status: 200, data: [oldRow] });

    expect(await load()).toEqual([["batch-old"]]);
    expect(JSON.parse(store.get("students")!)).toEqual([oldRow]);
  });

  it("never drops a saved course the server no longer lists", async () => {
    fetchStudentDetailsMock.mockResolvedValue({ status: 200, data: [newRow] });

    expect(await load()).toEqual([["batch-old"], ["batch-old", "batch-new"]]);
    expect(JSON.parse(store.get("students")!)).toEqual([oldRow, newRow]);
  });

  it("keeps the saved ids when the learner has no enrollment rows (201)", async () => {
    fetchStudentDetailsMock.mockResolvedValue({
      status: 201,
      data: [{ user_id: "user-1", package_session_id: null }],
    });

    expect(await load()).toEqual([["batch-old"]]);
    expect(JSON.parse(store.get("students")!)).toEqual([oldRow]);
  });

  it("keeps the saved ids when the request fails", async () => {
    fetchStudentDetailsMock.mockRejectedValue(new Error("offline"));

    expect(await load()).toEqual([["batch-old"]]);
    expect(JSON.parse(store.get("students")!)).toEqual([oldRow]);
  });

  it("does not call the server when the saved institute is unknown", async () => {
    store.set("StudentDetails", JSON.stringify(oldRow));

    expect(await load()).toEqual([["batch-old"]]);
    expect(fetchStudentDetailsMock).not.toHaveBeenCalled();
  });

  it("adds the course but does not create a students list login never saved", async () => {
    store.delete("students");
    store.set("sessionList", JSON.stringify([{ id: "batch-old" }]));
    fetchStudentDetailsMock.mockResolvedValue({ status: 200, data: [oldRow, newRow] });

    expect(await load()).toEqual([["batch-old"], ["batch-old", "batch-new"]]);
    expect(store.has("students")).toBe(false);
  });
});
