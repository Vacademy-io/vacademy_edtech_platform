import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/lib/auth/axiosInstance", () => ({ default: { post: (...args: unknown[]) => post(...args) } }));
vi.mock("@/constants/urls", () => ({ urlPublicCourseDetails: "/search" }));

const { fetchEnrolledCourses, fetchEnrolledHasProgress } = await import("./enrolled-courses");

// Every test starts past the window in which an earlier answer is reused.
let now = 1_000_000;
vi.spyOn(Date, "now").mockImplementation(() => now);
const later = () => {
  now += 60_000;
};
const pageSizes = () =>
  post.mock.calls.map((call: unknown[]) => (call[2] as { params: { size: number } }).params.size);

const page = (rows: unknown[]) => ({ data: { content: rows } });
const answer = (progress: unknown, completed: unknown) =>
  post.mockImplementation((_url: string, body: { type: string }) => {
    const value = body.type === "PROGRESS" ? progress : completed;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });

describe("fetchEnrolledHasProgress", () => {
  beforeEach(() => {
    post.mockReset();
    later();
  });

  it("is true for an in-progress row with progress", async () => {
    answer(page([{ id: "a", percentage_completed: 24 }]), page([]));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
  });

  it("is true for a completed course", async () => {
    answer(page([{ id: "a", percentage_completed: 0 }]), page([{ id: "b" }]));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
  });

  it("is false when every row is at zero", async () => {
    answer(page([{ id: "a", percentage_completed: 0 }, { id: "b" }]), page([]));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(false);
  });

  it("still answers yes from the bucket that responded", async () => {
    answer(page([{ id: "a", percentage_completed: 5 }]), new Error("down"));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
    later();
    answer(new Error("down"), page([{ id: "b" }]));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
  });

  it("is false when nothing responded", async () => {
    answer(new Error("down"), new Error("down"));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(false);
  });
});

describe("request sharing", () => {
  beforeEach(() => {
    post.mockReset();
    later();
  });

  it("serves the progress check and the course list from one request each", async () => {
    answer(page([{ id: "a", package_session_id: "p", percentage_completed: 5 }]), page([]));
    const [hasProgress, courses] = await Promise.all([
      fetchEnrolledHasProgress("inst"),
      fetchEnrolledCourses("inst"),
    ]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(hasProgress).toBe(true);
    expect(courses.map((course) => course.id)).toEqual(["a"]);
  });

  it("reads the answer the course list just got instead of asking again", async () => {
    answer(page([{ id: "a", package_session_id: "p", percentage_completed: 5 }]), page([]));
    await fetchEnrolledCourses("inst");
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("reads that answer whatever page size the list used", async () => {
    answer(page([{ id: "a", package_session_id: "p", percentage_completed: 5 }]), page([]));
    await fetchEnrolledCourses("inst", undefined, { all: true });
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("asks again once that answer has aged", async () => {
    answer(page([]), page([]));
    await fetchEnrolledHasProgress("inst");
    later();
    await fetchEnrolledHasProgress("inst");
    expect(post).toHaveBeenCalledTimes(4);
  });

  it("does not reuse a failed bucket", async () => {
    answer(page([]), new Error("down"));
    await fetchEnrolledHasProgress("inst");
    answer(page([]), page([{ id: "b" }]));
    await expect(fetchEnrolledHasProgress("inst")).resolves.toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("asks for itself when the list it joined is cancelled", async () => {
    let cancel = () => {};
    post.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { cancel = () => reject(new axios.CanceledError()); }),
    );
    post.mockImplementationOnce(() => Promise.resolve(page([])));
    post.mockImplementation((_url: string, body: { type: string }) =>
      Promise.resolve(page(body.type === "PROGRESS" ? [{ id: "a", percentage_completed: 5 }] : [])),
    );
    const list = fetchEnrolledCourses("inst", new AbortController().signal);
    const check = fetchEnrolledHasProgress("inst");
    cancel();
    await expect(check).resolves.toBe(true);
    await list;
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("shares one request with a show-all course list, whichever asks first", async () => {
    answer(page([{ id: "a", package_session_id: "p", percentage_completed: 5 }]), page([]));
    const checkFirst = fetchEnrolledHasProgress("inst", { all: true });
    const listSecond = fetchEnrolledCourses("inst", undefined, { all: true });
    await Promise.all([checkFirst, listSecond]);
    expect(post).toHaveBeenCalledTimes(2);

    later();
    post.mockClear();
    const listFirst = fetchEnrolledCourses("inst", undefined, { all: true });
    const checkSecond = fetchEnrolledHasProgress("inst", { all: true });
    await Promise.all([listFirst, checkSecond]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(pageSizes()).toEqual([200, 200]);
  });

  it("asks for the widget's usual page unless told to show all", async () => {
    answer(page([]), page([]));
    await fetchEnrolledHasProgress("inst");
    expect(pageSizes()).toEqual([12, 12]);
  });

  it("the course list always asks", async () => {
    answer(page([]), page([]));
    await fetchEnrolledHasProgress("inst");
    await fetchEnrolledCourses("inst");
    expect(post).toHaveBeenCalledTimes(4);
  });

  it("does not share a request across institutes or page sizes", async () => {
    answer(page([]), page([]));
    await Promise.all([
      fetchEnrolledHasProgress("inst"),
      fetchEnrolledHasProgress("other"),
      fetchEnrolledCourses("inst", undefined, { all: true }),
    ]);
    expect(post).toHaveBeenCalledTimes(6);
  });
});
