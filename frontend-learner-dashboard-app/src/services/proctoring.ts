import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { PROCTORING_CONFIG, PROCTORING_EVENTS } from "@/constants/urls";
import { UploadFileInS3 } from "@/services/upload_file";
import {
  PROCTORING_OFF,
  type ProctorEvent,
  type ProctoringConfig,
} from "@/types/proctoring";

/**
 * Config for one assessment. Never throws: an unreachable endpoint means the
 * exam runs unproctored, exactly as it did before V48, rather than not at all.
 */
export const fetchProctoringConfig = async (
  assessmentId: string
): Promise<ProctoringConfig> => {
  try {
    const response = await authenticatedAxiosInstance.get(PROCTORING_CONFIG, {
      params: { assessmentId },
    });
    const data = response.data as Partial<ProctoringConfig> | null;
    if (!data || !data.tier) return PROCTORING_OFF;
    return { ...PROCTORING_OFF, ...data };
  } catch (error) {
    console.warn("[proctoring] config fetch failed, running unproctored", error);
    return PROCTORING_OFF;
  }
};

/** A JPEG frame → media_service file id. Small on purpose: this is the whole storage bill. */
export const uploadSnapshot = async (
  blob: Blob,
  attemptId: string,
  userId: string
): Promise<string | undefined> => {
  const file = new File([blob], `proctor_${Date.now()}.jpg`, {
    type: "image/jpeg",
  });
  return UploadFileInS3(file, () => false, userId, "ASSESSMENT_PROCTOR", attemptId);
};

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT = 10;
const MAX_PENDING = 200;

/**
 * Batches device events and posts them to the server.
 *
 * Fire-and-forget from the caller's point of view: a failed flush keeps the
 * events for the next one (bounded), and nothing here can throw into the exam.
 * FLAG events flush immediately so the server's flag count is current when the
 * violation ceiling is checked.
 */
export class ProctorEventQueue {
  private pending: ProctorEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  /** FLAG count as the server knows it, from the last successful flush. */
  serverFlagCount = 0;

  constructor(
    private readonly attemptId: string,
    private readonly onServerFlagCount?: (count: number) => void
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  push(event: ProctorEvent) {
    this.pending.push(event);
    if (this.pending.length > MAX_PENDING) {
      // Keep the newest; the oldest routine snapshots are the least useful.
      this.pending.splice(0, this.pending.length - MAX_PENDING);
    }
    if (event.severity === "FLAG" || this.pending.length >= FLUSH_AT) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.inFlight || this.pending.length === 0) return;
    this.inFlight = true;
    const batch = this.pending.splice(0, 50);
    try {
      const response = await authenticatedAxiosInstance.post(
        PROCTORING_EVENTS,
        { events: batch },
        { params: { attemptId: this.attemptId } }
      );
      const flags = Number(response.data?.flag_count ?? 0);
      if (Number.isFinite(flags)) {
        this.serverFlagCount = flags;
        this.onServerFlagCount?.(flags);
      }
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status && status >= 400 && status < 500) {
        // Rejected, not lost: wrong owner, ended attempt, unproctored exam.
        // Retrying would only repeat the rejection.
        console.warn("[proctoring] event batch rejected", status);
      } else {
        // Put them back at the front so order survives; the next tick retries.
        this.pending.unshift(...batch);
        console.warn("[proctoring] event flush failed; will retry", error);
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** Drain on the way out. Best effort — the attempt is already submitted. */
  async drain(): Promise<void> {
    this.stop();
    let guard = 0;
    while (this.pending.length > 0 && guard++ < 5) {
      await this.flush();
    }
  }
}

/**
 * The check-in selfie is captured on the instructions page, before an attempt
 * exists, and uploaded by the live page once it does. One slot is enough: a
 * learner is only ever checking in to one exam.
 */
interface PendingCheckIn {
  assessmentId: string;
  blob: Blob;
  detector: string;
  /** Faces the detector saw when the learner confirmed; null = no detector. */
  faces: number | null;
  /** Confirmed without the detector agreeing on exactly one face. */
  unverified: boolean;
}

let pendingCheckIn: PendingCheckIn | null = null;

export const stashCheckIn = (checkIn: PendingCheckIn) => {
  pendingCheckIn = checkIn;
};

export const takeCheckIn = (assessmentId: string) => {
  const current = pendingCheckIn;
  if (!current || current.assessmentId !== assessmentId) return null;
  pendingCheckIn = null;
  return current;
};
