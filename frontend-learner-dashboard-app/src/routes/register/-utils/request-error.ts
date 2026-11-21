import { AxiosError } from "axios";
import { isChunkLoadError, isLazyResolverError } from "@/lib/chunk-reload";

/**
 * Coarse buckets the register page can pick a message for.
 *
 * - `network`  — no response at all (offline, DNS, timeout, server unreachable).
 * - `server`   — a real 5xx from the edge or the app (500/502/503/504).
 * - `business` — 510/511: the backend's own "readable rejection" codes. Every
 *                VacademyException lands here with the text in `ex`
 *                (e.g. "Assessment not found", "User not found!", "OTP has
 *                expired"). Not a transport problem — retrying won't help.
 * - `client`   — any other 4xx.
 * - `unknown`  — not an axios error (a plain throw / render bug).
 */
export type RequestErrorKind =
  | "network"
  | "server"
  | "business"
  | "client"
  | "unknown";

export interface ClassifiedRequestError {
  kind: RequestErrorKind;
  status?: number;
  /** Innermost human-readable message the backend attached, if any. */
  message?: string;
}

// auth-service relays notification-service failures verbatim, so `ex` can be
// `510 : "{"url":..., "ex":"OTP has expired...", ...}"`. Pull out the innermost
// `ex` so the toast shows the sentence, not the envelope.
const extractBackendMessage = (raw: unknown): string | undefined => {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const nested = [...raw.matchAll(/"ex"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  if (nested.length > 0) {
    const last = nested[nested.length - 1]?.[1];
    if (last) return last.replace(/\\"/g, '"');
  }
  return raw;
};

export const classifyRequestError = (error: unknown): ClassifiedRequestError => {
  if (error instanceof AxiosError) {
    if (!error.response) {
      return { kind: "network", message: error.message };
    }
    const status = error.response.status;
    const message = extractBackendMessage(
      (error.response.data as { ex?: unknown } | undefined)?.ex,
    );
    if (status === 510 || status === 511) {
      return { kind: "business", status, message };
    }
    if (status >= 500) return { kind: "server", status, message };
    return { kind: "client", status, message };
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : undefined,
  };
};

/** True when a retry has a realistic chance of succeeding. */
export const isTransientRequestError = (error: unknown): boolean => {
  const { kind } = classifyRequestError(error);
  return kind === "network" || kind === "server";
};

/**
 * The backend's "this assessment is over" rejection
 * (VacademyException("Assessment is ended"), thrown once bound_end_time has
 * passed). It arrives as a plain business error, so without this it landed on
 * the generic "Something went wrong / Couldn't load the assessment" card —
 * which tells a learner nothing and invites them to hit Try again forever.
 *
 * Matched on the whole phrase, not a bare "expired": this channel also carries
 * "OTP has expired", and sending someone to an "Assessment Expired" screen
 * because their one-time code lapsed would be worse than the generic card.
 */
export const isAssessmentEndedError = (error: unknown): boolean => {
  const { kind, message } = classifyRequestError(error);
  return kind === "business" && /assessment\s+is\s+(ended|expired)/i.test(message ?? "");
};

/** The assessment-page lookup's "no such share code" rejection. */
export const isAssessmentNotFoundError = (error: unknown): boolean => {
  const { kind, status, message } = classifyRequestError(error);
  return (
    status === 404 ||
    (kind === "business" && /not found/i.test(message ?? ""))
  );
};

/**
 * A stale tab whose hashed chunks no longer exist on the CDN. The app handles
 * this globally (installChunkErrorHandler) and on every route that uses the
 * router's SmartErrorPage default, but /register overrides `errorComponent`,
 * so without this the same recoverable failure surfaced as a dead-end
 * "Couldn't load the assessment" — on the one screen the learner cannot skip.
 */
export const isStaleBuildError = (error: unknown): boolean =>
  isChunkLoadError(error) || isLazyResolverError(error);

/** Which screen the register route's error boundary should show. */
export type RegisterErrorScreen =
  | { kind: "reload" }
  | { kind: "notFound" }
  | { kind: "expired" }
  | { kind: "network" }
  | { kind: "error"; detail?: string };

/**
 * Pure decision behind RegisterErrorComponent, kept out of the component so the
 * routing can be tested without rendering the router.
 */
export const resolveRegisterErrorScreen = (
  error: unknown,
): RegisterErrorScreen => {
  if (isStaleBuildError(error)) return { kind: "reload" };
  // Order matters: a DELETED/DRAFT assessment is rejected as "not found" so it
  // reads as a dead link rather than admitting the assessment exists.
  if (isAssessmentNotFoundError(error)) return { kind: "notFound" };
  if (isAssessmentEndedError(error)) return { kind: "expired" };

  const classified = classifyRequestError(error);
  if (classified.kind === "network") return { kind: "network" };

  return {
    kind: "error",
    // Only surface backend sentences; axios/JS messages are noise to a learner.
    detail: classified.kind === "business" ? classified.message : undefined,
  };
};
