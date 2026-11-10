import axios from "axios";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { BASE_URL, urlPublicCourseDetails } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { noteEnrolmentList } from "@/services/enrolled-courses";

const LEARNER_INFO_URL = `${BASE_URL}/admin-core-service/learner/info/v1/details`;
const USER_PLAN_URL = `${BASE_URL}/admin-core-service/v1/user-plan`;

export interface EnrolledCourseSummary {
  id: string;
  package_name: string;
  package_session_id: string;
  level_id: string | null;
  level_name: string | null;
  session_id: string | null;
  session_name: string | null;
  percentage_completed?: number | null;
}

/** An enrolment list, and whether both of its lookups came back. */
export interface EnrolmentLookup {
  courses: EnrolledCourseSummary[];
  complete: boolean;
}

interface LearnerPackagesSearchResponse {
  content: Array<{
    id: string;
    package_name: string;
    package_session_id: string;
    level_id: string | null;
    level_name: string | null;
    session_id: string | null;
    session_name: string | null;
    percentage_completed?: number | null;
  }>;
  totalPages: number;
  last: boolean;
  number: number;
}

const ENROLLED_PAGE_SIZE = 100;

// Read-only response memo. Course-details mounts two useEnrollmentStatus
// instances (page + course structure), and each re-reads on mount,
// instituteId arrival, institute-store updates and window focus — the same
// enrollment search would otherwise fire 6-8x per page load. Callers that
// just changed enrollment state must pass { force: true } to bypass.
interface MemoEntry<T> {
  ts: number;
  promise: Promise<T>;
}

const memoized = <T>(
  cache: Map<string, MemoEntry<T>>,
  key: string,
  ttlMs: number,
  force: boolean | undefined,
  fetcher: () => Promise<T>,
): Promise<T> => {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.ts <= ttlMs) {
    return hit.promise;
  }
  const promise = fetcher();
  cache.set(key, { ts: Date.now(), promise });
  // Never memoize failures — the next caller should retry the network.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
};

const fetchEnrolledByType = async (
  instituteId: string,
  type: "PROGRESS" | "COMPLETED",
  signal?: AbortSignal,
): Promise<LearnerPackagesSearchResponse["content"]> => {
  const requestPage = async (page: number) => {
    const response =
      await authenticatedAxiosInstance.post<LearnerPackagesSearchResponse>(
        urlPublicCourseDetails,
        {
          status: [],
          level_ids: [],
          faculty_ids: [],
          search_by_name: "",
          tag: [],
          min_percentage_completed: 0,
          max_percentage_completed: 0,
          type,
          sort_columns: { created_at: "DESC" },
        },
        {
          params: { instituteId, page, size: ENROLLED_PAGE_SIZE },
          headers: { accept: "*/*", "Content-Type": "application/json" },
          signal,
        },
      );
    return response.data;
  };

  const first = await requestPage(0);
  const all = [...(first?.content ?? [])];
  if (first && !first.last && first.totalPages > 1) {
    const remaining = await Promise.all(
      Array.from({ length: first.totalPages - 1 }, (_, i) =>
        requestPage(i + 1),
      ),
    );
    remaining.forEach((page) => all.push(...(page?.content ?? [])));
  }
  return all;
};

const enrolledPackagesMemo = new Map<string, MemoEntry<EnrolmentLookup>>();
const ENROLLED_PACKAGES_TTL_MS = 30_000;

// Returns courses the learner is enrolled in — both in-progress and completed —
// so the "All Courses" tab can hide "Enroll Now" for either state.
export const fetchEnrolledCoursePackages = async (
  instituteId: string,
  opts?: { force?: boolean },
): Promise<EnrolledCourseSummary[]> =>
  (
    await memoized(
      enrolledPackagesMemo,
      instituteId,
      ENROLLED_PACKAGES_TTL_MS,
      opts?.force,
      () => fetchEnrolledCoursePackagesUncached(instituteId),
    )
  ).courses;

// For a caller that must tell "not in the list" from "the list is partial". It
// sends its own requests, so one that stalls leaves nothing for another reader
// to wait on. A complete answer is kept for those readers.
export const fetchEnrolmentLookup = async (
  instituteId: string,
  signal?: AbortSignal,
): Promise<EnrolmentLookup> => {
  const lookup = await fetchEnrolledCoursePackagesUncached(instituteId, signal);
  if (lookup.complete) {
    enrolledPackagesMemo.set(instituteId, {
      ts: Date.now(),
      promise: Promise.resolve(lookup),
    });
  }
  return lookup;
};

const fetchEnrolledCoursePackagesUncached = async (
  instituteId: string,
  signal?: AbortSignal,
): Promise<EnrolmentLookup> => {
  const [progressResult, completedResult] = await Promise.allSettled([
    fetchEnrolledByType(instituteId, "PROGRESS", signal),
    fetchEnrolledByType(instituteId, "COMPLETED", signal),
  ]);
  const progress =
    progressResult.status === "fulfilled" ? progressResult.value : [];
  const completed =
    completedResult.status === "fulfilled" ? completedResult.value : [];
  const complete =
    progressResult.status === "fulfilled" &&
    completedResult.status === "fulfilled";
  if (!complete) {
    // Degraded result (network blip): serve what we have — same as before the
    // memo existed — but evict the entry so the next read retries the network
    // instead of pinning a partial/empty enrollment list for the whole TTL.
    enrolledPackagesMemo.delete(instituteId);
  }

  const byPackageSessionId = new Map<
    string,
    LearnerPackagesSearchResponse["content"][number]
  >();
  // Order matters only for dedup tiebreak; both responses carry the same shape.
  for (const c of progress) byPackageSessionId.set(c.package_session_id, c);
  for (const c of completed) {
    if (!byPackageSessionId.has(c.package_session_id)) {
      byPackageSessionId.set(c.package_session_id, c);
    }
  }

  if (complete) noteEnrolmentList(instituteId, Array.from(byPackageSessionId.values()));

  const courses = Array.from(byPackageSessionId.values()).map((c) => ({
    id: c.id,
    package_name: c.package_name,
    package_session_id: c.package_session_id,
    level_id: c.level_id,
    level_name: c.level_name,
    session_id: c.session_id,
    session_name: c.session_name,
    percentage_completed: c.percentage_completed,
  }));
  return { courses, complete };
};

export interface LearnerInfo {
  id: string;
  username: string;
  user_id: string;
  email: string;
  full_name: string;
  address_line: string | null;
  region: string | null;
  city: string | null;
  pin_code: string | null;
  mobile_number: string | null;
  date_of_birth: string | null;
  gender: string | null;
  father_name: string;
  mother_name: string;
  parents_mobile_number: string;
  parents_email: string;
  linked_institute_name: string;
  package_session_id: string;
  institute_enrollment_id: string;
  status: string;
  session_expiry_days: string | null;
  institute_id: string;
  face_file_id: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  parents_to_mother_mobile_number: string;
  parents_to_mother_email: string;
  user_plan_id: string | null;
}

export interface PaymentLog {
  id: string;
  status: string;
  payment_status: string;
  user_id: string;
  vendor: string;
  vendor_id: string;
  date: string;
  currency: string;
  payment_specific_data: string;
  payment_amount: number;
}

export interface UserPlan {
  id: string;
  userId: string;
  paymentPlanId: string;
  planJson: string;
  appliedCouponDiscountId: string | null;
  appliedCouponDiscountJson: string | null;
  enrollInviteId: string | null;
  paymentOptionId: string | null;
  paymentOptionJson: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  paymentLogs: PaymentLog[];
}

const learnerInfoMemo = new Map<string, MemoEntry<LearnerInfo[]>>();
const LEARNER_INFO_TTL_MS = 60_000;

/**
 * Get learner information from the API
 */
export const getLearnerInfo = async (
  instituteId: string,
  opts?: { force?: boolean },
): Promise<LearnerInfo[]> =>
  memoized(
    learnerInfoMemo,
    instituteId,
    LEARNER_INFO_TTL_MS,
    opts?.force,
    async () => {
      const token = await getTokenFromStorage(TokenKey.accessToken);
      if (!token) {
        throw new Error("No access token found");
      }

      const response = await axios.get<LearnerInfo[]>(LEARNER_INFO_URL, {
        params: { instituteId },
        headers: {
          accept: "*/*",
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    },
  );

const userPlanMemo = new Map<string, MemoEntry<UserPlan>>();
const USER_PLAN_TTL_MS = 60_000;

// Call after any flow that records a payment/donation so the next
// hasUserDonated()/getLearnerInfo() read hits the network instead of the
// pre-payment memo (e.g. DonationDialog success → remount within the TTL).
export const invalidateDonationStatusCache = (): void => {
  learnerInfoMemo.clear();
  userPlanMemo.clear();
};

// These memos cache USER-specific responses but are keyed by instituteId, so
// an in-SPA logout (no page reload) would otherwise serve the previous user's
// enrollments/PII to the next login on a shared device. Logout must call this.
export const clearUserScopedReadCaches = (): void => {
  enrolledPackagesMemo.clear();
  learnerInfoMemo.clear();
  userPlanMemo.clear();
};

/**
 * Get user plan details to check donation status
 */
export const getUserPlanDetails = async (
  userPlanId: string,
  opts?: { force?: boolean },
): Promise<UserPlan> =>
  memoized(
    userPlanMemo,
    userPlanId,
    USER_PLAN_TTL_MS,
    opts?.force,
    async () => {
      const token = await getTokenFromStorage(TokenKey.accessToken);
      if (!token) {
        throw new Error("No access token found");
      }

      const response = await axios.get<UserPlan>(
        `${USER_PLAN_URL}/${userPlanId}/with-payment-logs`,
        {
          headers: {
            accept: "*/*",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    },
  );

/**
 * Check if user has donated at least once
 */
export const hasUserDonated = async (
  instituteId: string,
  opts?: { force?: boolean },
): Promise<boolean> => {
  try {
    // Get learner info to find user_plan_id
    const learnerInfo = await getLearnerInfo(instituteId, opts);

    if (!learnerInfo || learnerInfo.length === 0) {
      return false;
    }

    // Find the first learner record with a user_plan_id
    const learnerWithPlan = learnerInfo.find(learner => learner.user_plan_id);
    const userPlanId = learnerWithPlan?.user_plan_id;

    if (!userPlanId) {
      return false;
    }

    // Get user plan details to check payment logs
    const userPlan = await getUserPlanDetails(userPlanId, opts);

    // Check if any payment log has "Paid" status
    const hasDonated = userPlan.paymentLogs?.some(log => log.payment_status === "Paid") || false;

    return hasDonated;
  } catch {
    return false;
  }
};

/**
 * Check if user is enrolled in a specific course
 */
export const isUserEnrolledInCourse = async (
  instituteId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  courseId: string
): Promise<boolean> => {
  try {
    const learnerInfo = await getLearnerInfo(instituteId);

    if (!learnerInfo || learnerInfo.length === 0) {
      return false;
    }

    // Check if any of the enrolled sessions match the course
    // This is a simplified check - you might need to enhance this based on your data structure
    return learnerInfo.some(learner =>
      learner.package_session_id && learner.institute_enrollment_id
    );
  } catch {
    return false;
  }
};
