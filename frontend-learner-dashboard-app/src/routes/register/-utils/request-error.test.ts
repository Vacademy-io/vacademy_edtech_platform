import { describe, expect, it } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import {
  isStaleBuildError,
  resolveRegisterErrorScreen,
} from "./request-error";

/**
 * /register overrides the router's `errorComponent`, so it does not inherit
 * SmartErrorPage's chunk-error recovery. Before this was wired up, a stale tab
 * whose hashed chunks had rotated off the CDN showed the dead-end
 * "Couldn't load the assessment" screen — the `unknown` variant — on the one
 * page a learner cannot navigate around.
 */

const axiosErrorWith = (status: number, data?: unknown) => {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data,
  });
};

const networkError = () =>
  new AxiosError("Network Error", "ERR_NETWORK", {
    headers: new AxiosHeaders(),
  });

describe("isStaleBuildError", () => {
  it("matches a dynamic-import failure", () => {
    expect(
      isStaleBuildError(
        new Error(
          "Failed to fetch dynamically imported module: https://x.test/assets/a-1234.js",
        ),
      ),
    ).toBe(true);
  });

  it("matches a ChunkLoadError by name", () => {
    const err = new Error("boom");
    err.name = "ChunkLoadError";
    expect(isStaleBuildError(err)).toBe(true);
  });

  it("matches the lazy-resolver TypeError a rewritten chunk produces", () => {
    const err = new TypeError(
      "Cannot read properties of undefined (reading 'default')",
    );
    expect(isStaleBuildError(err)).toBe(true);
  });

  it("does not match an ordinary render bug", () => {
    expect(isStaleBuildError(new TypeError("x.name is not a function"))).toBe(
      false,
    );
  });

  it("does not match a backend rejection", () => {
    expect(isStaleBuildError(axiosErrorWith(511, { ex: "User not found!" }))).toBe(
      false,
    );
  });
});

describe("resolveRegisterErrorScreen", () => {
  it("routes a stale build to the reload screen, not the error screen", () => {
    expect(
      resolveRegisterErrorScreen(
        new Error("Failed to fetch dynamically imported module: /assets/a.js"),
      ),
    ).toEqual({ kind: "reload" });
  });

  it("shows the expired screen when the backend says the assessment ended", () => {
    // Backend throws VacademyException("Assessment is ended") once
    // bound_end_time has passed. It used to land on the generic error card.
    expect(
      resolveRegisterErrorScreen(
        axiosErrorWith(510, { ex: "Assessment is ended" }),
      ),
    ).toEqual({ kind: "expired" });
  });

  it("treats a DELETED or DRAFT assessment as a dead link, not as expired", () => {
    // The backend deliberately rejects both as "Assessment not found" so a
    // deleted assessment does not admit it exists.
    expect(
      resolveRegisterErrorScreen(
        axiosErrorWith(510, { ex: "Assessment not found" }),
      ),
    ).toEqual({ kind: "notFound" });
  });

  it("does not treat an expired OTP as an expired assessment", () => {
    // Same 510/511 channel carries "OTP has expired". A bare /expired/ match
    // sent that to the "Assessment Expired" screen.
    expect(
      resolveRegisterErrorScreen(axiosErrorWith(510, { ex: "OTP has expired" })),
    ).toEqual({ kind: "error", detail: "OTP has expired" });
  });

  it("still shows notFound for an unknown share code", () => {
    expect(
      resolveRegisterErrorScreen(
        axiosErrorWith(510, { ex: "Assessment not found" }),
      ),
    ).toEqual({ kind: "notFound" });
  });

  it("still shows the network screen when the server is unreachable", () => {
    expect(resolveRegisterErrorScreen(networkError())).toEqual({
      kind: "network",
    });
  });

  it("surfaces a readable backend sentence on a business rejection", () => {
    expect(
      resolveRegisterErrorScreen(
        axiosErrorWith(511, { ex: "OTP has expired" }),
      ),
    ).toEqual({ kind: "error", detail: "OTP has expired" });
  });

  it("hides axios/JS noise on a 5xx", () => {
    expect(resolveRegisterErrorScreen(axiosErrorWith(502))).toEqual({
      kind: "error",
      detail: undefined,
    });
  });

  it("falls back to the error screen for a genuine render bug", () => {
    expect(
      resolveRegisterErrorScreen(new TypeError("value.name is undefined")),
    ).toEqual({ kind: "error", detail: undefined });
  });
});
