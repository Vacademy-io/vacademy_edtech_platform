import {
  getCurrentDomainInfo,
  resolveDomainRouting,
} from "@/services/domain-routing";
import { fetchStudentDetails } from "@/services/studentDetails";

// Auto-picking is only a convenience. If the routing or student-details API is
// down or slow, give up after this long and let the login carry on exactly as
// it does without auto-pick (the details API has no axios timeout of its own).
export const AUTO_PICK_TIMEOUT_MS = 4000;

/** Settles with `fallback` on rejection or after `ms`, never rejects. */
export const withTimeout = <T>(
  promise: Promise<T>,
  fallback: T,
  ms: number = AUTO_PICK_TIMEOUT_MS
): Promise<T> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });

// Enrollment statuses that mean the learner can use the institute right now.
// Everything else — INVITED, DELETED, TERMINATED, EXPIRED, legacy NULL rows —
// keeps today's behaviour rather than auto-landing someone on an empty
// dashboard. (The details API already drops INACTIVE rows but returns 200 for
// the rest, so a 200 alone does not prove a live enrollment.)
const LIVE_ENROLLMENT_STATUSES = ["ACTIVE", "PENDING_FOR_APPROVAL"];

/**
 * Side-effect-free check (a plain GET, nothing stored) that the learner has a
 * live enrollment in the institute. Any doubt — missing user, API error or
 * timeout, 201, no live row — answers false.
 */
export const hasLiveEnrollment = async (
  instituteId: string,
  userId: string | null | undefined
): Promise<boolean> => {
  if (!userId) return false;
  try {
    const res = await withTimeout(
      fetchStudentDetails(instituteId, userId),
      null
    );
    return (
      !!res &&
      res.status === 200 &&
      Array.isArray(res.data) &&
      res.data.some((row: { status?: string | null }) =>
        LIVE_ENROLLMENT_STATUSES.includes((row?.status ?? "").toUpperCase())
      )
    );
  } catch {
    return false;
  }
};

/**
 * Token logins that skip /institute-selection (the native OAuth deep link and
 * the `?accessToken=&refreshToken=` auto-login URL — web OAuth, "Switch to
 * learner", post-checkout, portal-access links) hydrate
 * `Object.keys(authorities)[0]`: whichever institute the backend's map happened
 * to list first. For a learner in two institutes that can open the wrong one,
 * e.g. Shiksha Nation inside the Enark app.
 *
 * When the token holds more than one institute, returns the one these paths
 * should open instead, only if the user belongs to it:
 *  1. the link's explicit `instituteId` (admin portal-access links), else
 *  2. the institute this host is mapped to, if the learner is live-enrolled
 *     there — the same rule the /institute-selection auto-pick uses.
 * Returns null otherwise, and the caller keeps its existing choice unchanged.
 */
export const pickLoginInstituteId = async (
  authorities: Record<string, unknown> | null | undefined,
  userId: string | null | undefined,
  hint?: string | null
): Promise<string | null> => {
  const keys = authorities ? Object.keys(authorities) : [];
  if (keys.length <= 1) return null;
  if (hint && keys.includes(hint)) return hint;

  // Routing + enrollment share one time budget; on timeout or any failure the
  // caller's default (authorities[0]) runs, i.e. today's behaviour.
  return withTimeout(pickHostInstitute(keys, userId), null);
};

const pickHostInstitute = async (
  keys: string[],
  userId: string | null | undefined
): Promise<string | null> => {
  try {
    const { domain, subdomain } = await getCurrentDomainInfo();
    // Only a real routing answer counts: resolveDomainRouting returns null on
    // 404 and throws on errors, never a cached id from an earlier session.
    const routed = await resolveDomainRouting(domain, subdomain || "*");
    if (
      routed?.instituteId &&
      keys.includes(routed.instituteId) &&
      (await hasLiveEnrollment(routed.instituteId, userId))
    ) {
      return routed.instituteId;
    }
  } catch {
    // Unmapped host or routing API down: keep the caller's default.
  }
  return null;
};
