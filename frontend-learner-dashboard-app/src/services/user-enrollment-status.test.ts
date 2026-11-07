import { beforeEach, describe, expect, it, vi } from "vitest";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { fetchEnrolledCoursePackages, fetchEnrolmentLookup } from "./user-enrollment-status";

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
