import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve = vi.fn();
const details = vi.fn();

vi.mock("@/services/domain-routing", () => ({
  getCurrentDomainInfo: async () => ({ domain: "enarkuplift.in", subdomain: "training" }),
  resolveDomainRouting: (domain: string, subdomain: string) => resolve(domain, subdomain),
}));
vi.mock("@/services/studentDetails", () => ({
  fetchStudentDetails: (instituteId: string, userId: string) => details(instituteId, userId),
}));

import {
  AUTO_PICK_TIMEOUT_MS,
  hasLiveEnrollment,
  pickLoginInstituteId,
  withTimeout,
} from "./pick-login-institute";

const hang = () => new Promise<never>(() => {});

const ENARK = "e1ea141d";
const SHIKSHA = "35675130";
const both = { [SHIKSHA]: {}, [ENARK]: {} };
const enrolled = (...statuses: (string | null)[]) => ({
  status: 200,
  data: statuses.map((status) => ({ status })),
});

describe("hasLiveEnrollment", () => {
  beforeEach(() => {
    details.mockReset();
  });

  it("accepts ACTIVE and PENDING_FOR_APPROVAL, case-insensitively", async () => {
    details.mockResolvedValue(enrolled("DELETED", "Active"));
    expect(await hasLiveEnrollment(ENARK, "u")).toBe(true);
    details.mockResolvedValue(enrolled("PENDING_FOR_APPROVAL"));
    expect(await hasLiveEnrollment(ENARK, "u")).toBe(true);
  });

  it("rejects removed, invited, legacy-null and no-enrollment answers", async () => {
    details.mockResolvedValue(enrolled("DELETED", "TERMINATED", "EXPIRED", "INVITED", null));
    expect(await hasLiveEnrollment(ENARK, "u")).toBe(false);
    details.mockResolvedValue({ status: 201, data: [{ status: "ACTIVE" }] });
    expect(await hasLiveEnrollment(ENARK, "u")).toBe(false);
    details.mockImplementation(async () => {
      throw new Error("down");
    });
    expect(await hasLiveEnrollment(ENARK, "u")).toBe(false);
  });

  it("never calls the API without a user", async () => {
    expect(await hasLiveEnrollment(ENARK, undefined)).toBe(false);
    expect(details).not.toHaveBeenCalled();
  });
});

describe("pickLoginInstituteId", () => {
  beforeEach(() => {
    resolve.mockReset();
    details.mockReset();
  });

  it("leaves single-institute tokens to the caller, without any network call", async () => {
    expect(await pickLoginInstituteId({ [SHIKSHA]: {} }, "u", ENARK)).toBeNull();
    expect(await pickLoginInstituteId(undefined, "u")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
  });

  it("picks the host's institute when the learner is live-enrolled there", async () => {
    resolve.mockResolvedValue({ instituteId: ENARK });
    details.mockResolvedValue(enrolled("ACTIVE"));
    expect(await pickLoginInstituteId(both, "u")).toBe(ENARK);
    expect(resolve).toHaveBeenCalledWith("enarkuplift.in", "training");
    expect(details).toHaveBeenCalledWith(ENARK, "u");
  });

  it("keeps the caller's default when the host enrollment is not live", async () => {
    resolve.mockResolvedValue({ instituteId: ENARK });
    details.mockResolvedValue(enrolled("DELETED"));
    expect(await pickLoginInstituteId(both, "u")).toBeNull();
  });

  it("prefers the link's explicit institute when the user belongs to it", async () => {
    resolve.mockResolvedValue({ instituteId: ENARK });
    expect(await pickLoginInstituteId(both, "u", SHIKSHA)).toBe(SHIKSHA);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("ignores a hint or host institute the user does not belong to", async () => {
    resolve.mockResolvedValue({ instituteId: "someone-else" });
    expect(await pickLoginInstituteId(both, "u", "not-mine")).toBeNull();
    expect(details).not.toHaveBeenCalled();
  });

  it("keeps the caller's default when the host is unmapped or routing fails", async () => {
    resolve.mockResolvedValue(null);
    expect(await pickLoginInstituteId(both, "u")).toBeNull();
    resolve.mockImplementation(async () => {
      throw new Error("down");
    });
    expect(await pickLoginInstituteId(both, "u")).toBeNull();
  });

  it("gives up and keeps the caller's default when routing hangs", async () => {
    vi.useFakeTimers();
    try {
      resolve.mockImplementation(hang);
      const picked = pickLoginInstituteId(both, "u");
      await vi.advanceTimersByTimeAsync(AUTO_PICK_TIMEOUT_MS);
      expect(await picked).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up and keeps the caller's default when the details API hangs", async () => {
    vi.useFakeTimers();
    try {
      resolve.mockResolvedValue({ instituteId: ENARK });
      details.mockImplementation(hang);
      const picked = pickLoginInstituteId(both, "u");
      await vi.advanceTimersByTimeAsync(AUTO_PICK_TIMEOUT_MS);
      expect(await picked).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withTimeout", () => {
  it("passes a timely value through", async () => {
    expect(await withTimeout(Promise.resolve("x"), "fallback")).toBe("x");
  });

  it("answers the fallback on rejection, never throws", async () => {
    expect(await withTimeout(Promise.reject(new Error("down")), "fallback")).toBe("fallback");
  });

  it("answers the fallback once the budget runs out", async () => {
    vi.useFakeTimers();
    try {
      const result = withTimeout(hang(), "fallback", 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toBe("fallback");
    } finally {
      vi.useRealTimers();
    }
  });
});
