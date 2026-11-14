import { beforeEach, describe, expect, it, vi } from "vitest";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { answeredEnrolments } from "./enrolled-courses";
import {
  clearUserScopedReadCaches,
  fetchEnrolledCoursePackages,
  fetchEnrolmentLookup,
} from "./user-enrollment-status";

vi.mock("@/lib/auth/axiosInstance", () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock("@/lib/auth/sessionUtility", () => ({ getTokenFromStorage: vi.fn() }));
vi.mock("@/constants/urls", () => ({ BASE_URL: "", urlPublicCourseDetails: "/search" }));

const post = vi.mocked(authenticatedAxiosInstance.post);
const page = (content: unknown[]) => ({ data: { content, last: true, totalPages: 1, number: 0 } });
const row = { id: "c1", package_name: "C", package_session_id: "ps1" };
const stalled = () => new Promise(() => {}) as never;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("fetchEnrolmentLookup", () => {
  let institute = 0;
  const nextInstitute = () => `inst-${++institute}`;

  beforeEach(() => {
    post.mockReset();
  });

  it("leaves a complete list for Home to read, with the fields a home card needs", async () => {
    const id = nextInstitute();
    post.mockResolvedValue(page([{ ...row, percentage_completed: 30, read_time_in_minutes: 5 }]) as never);
    await fetchEnrolledCoursePackages(id);
    expect(answeredEnrolments(id)).toMatchObject([{ percentage_completed: 30, read_time_in_minutes: 5 }]);
  });

  it("leaves the new list for Home when a caller re-reads after an enrolment", async () => {
    const id = nextInstitute();
    post.mockResolvedValue(page([]) as never);
    await fetchEnrolledCoursePackages(id);
    expect(answeredEnrolments(id)).toEqual([]);
    post.mockResolvedValue(page([{ ...row, percentage_completed: 0 }]) as never);
    await fetchEnrolledCoursePackages(id, { force: true });
    expect(answeredEnrolments(id)).toMatchObject([{ percentage_completed: 0 }]);
  });

  it("leaves nothing for the next learner once logout clears the caches", async () => {
    const id = nextInstitute();
    post.mockResolvedValue(page([{ ...row, percentage_completed: 62 }]) as never);
    await fetchEnrolledCoursePackages(id);
    expect(answeredEnrolments(id)).not.toBeNull();
    clearUserScopedReadCaches();
    expect(answeredEnrolments(id)).toBeNull();
  });

  it("keeps a list asked for before the logout from landing after it", async () => {
    const id = nextInstitute();
    const waiting: ((value: unknown) => void)[] = [];
    post.mockImplementation(() => new Promise((resolve) => waiting.push(resolve)) as never);
    const pending = fetchEnrolmentLookup(id);
    await settle();
    clearUserScopedReadCaches();
    expect(waiting).toHaveLength(2);
    waiting.forEach((release) => release(page([{ ...row, percentage_completed: 62 }])));
    await expect(pending).resolves.toMatchObject({ complete: true });
    expect(answeredEnrolments(id)).toBeNull();
  });

  it("leaves nothing for Home to read when part of the list failed", async () => {
    const id = nextInstitute();
    post.mockResolvedValueOnce(page([row]) as never).mockRejectedValueOnce(new Error("down"));
    await fetchEnrolmentLookup(id);
    expect(answeredEnrolments(id)).toBeNull();
  });

  it("leaves nothing for another reader to join while it is stalled", async () => {
    const id = nextInstitute();
    post.mockImplementationOnce(stalled).mockImplementationOnce(stalled);
    void fetchEnrolmentLookup(id);
    await settle();

    post.mockResolvedValue(page([row]) as never);
    await expect(fetchEnrolledCoursePackages(id)).resolves.toMatchObject([{ id: "c1" }]);
    expect(post).toHaveBeenCalledTimes(4);
  });

  it("gives up its requests with the signal, reporting a partial list", async () => {
    const id = nextInstitute();
    post.mockImplementation((_url, _body, config) => {
      return new Promise((_, reject) => {
        (config as { signal: AbortSignal }).signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }) as never;
    });
    const controller = new AbortController();
    const lookup = fetchEnrolmentLookup(id, controller.signal);
    controller.abort();

    await expect(lookup).resolves.toEqual({ courses: [], complete: false });
  });

  it("keeps a complete answer for other readers, who then send nothing", async () => {
    const id = nextInstitute();
    post.mockResolvedValue(page([row]) as never);
    await fetchEnrolmentLookup(id);
    post.mockClear();

    await expect(fetchEnrolledCoursePackages(id)).resolves.toMatchObject([{ id: "c1" }]);
    expect(post).not.toHaveBeenCalled();
  });

  it("does not keep a partial answer", async () => {
    const id = nextInstitute();
    post.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(page([row]) as never);
    await expect(fetchEnrolmentLookup(id)).resolves.toMatchObject({ complete: false });

    post.mockResolvedValue(page([row]) as never);
    post.mockClear();
    await fetchEnrolledCoursePackages(id);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("still shares one lookup between readers of the course list", async () => {
    const id = nextInstitute();
    post.mockResolvedValue(page([row]) as never);
    await Promise.all([fetchEnrolledCoursePackages(id), fetchEnrolledCoursePackages(id)]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
