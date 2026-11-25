import { useAssessmentStore } from "@/stores/assessment-store";
import {
  clockAfterGrant,
  grantedExtraSeconds,
  remainingFromServerStart,
} from "./clock-logic";

/** What the start call told this device about the attempt (`server_start_end_time`). */
export interface ServerStart {
  /** Server start time in ms; 0 when unknown. */
  startMs: number;
  /**
   * The attempt's limit this device has already accounted for, in minutes (end - start of
   * `server_start_end_time`); null when unknown. The caller moves `end_time` on by every grant
   * it applies, so a reload does not apply the same grant again.
   */
  startMaxMinutes: number | null;
}

/**
 * The highest limit already applied per attempt in this page session. Belt and braces for the
 * caller's saved end_time: if writing that ever fails, the next autosave still does not apply
 * the same grant twice.
 */
const appliedLimit = new Map<string, number>();

/** For tests: forget the limits applied in this session. */
export function resetAppliedGrants(): void {
  appliedLimit.clear();
}

export interface GrantResult {
  /** Minutes the running clock gained (0 = nothing changed). */
  addedMinutes: number;
}

/**
 * Applies time the institute granted while the exam is open. Every autosave answers with the
 * attempt's current max_time; when it is beyond the limit the attempt started with (an admin
 * approved a "more time" request), the clocks gain the difference.
 *
 * The limit compared against is the one the start call returned, not the paper's cached
 * duration: the two can differ for reasons that have nothing to do with a grant (a preview
 * attempt created before the admin changed the duration), and the clock must keep running on
 * the duration it shows, as it always did, until time is actually granted.
 */
export function applyGrantedTime(
  serverMaxTimeMinutes: unknown,
  playMode: string,
  serverStart: ServerStart | null = null,
  nowMs: number = Date.now(),
): GrantResult {
  const state = useAssessmentStore.getState();
  if (state.isSubmitted || !state.assessment) return { addedMinutes: 0 };
  const duration = Number(state.assessment.duration);
  const attemptId = state.assessment.attempt_id ?? "";
  const baseline = Math.max(
    serverStart?.startMaxMinutes ?? duration,
    appliedLimit.get(attemptId) ?? 0,
  );
  const extraSeconds = grantedExtraSeconds(serverMaxTimeMinutes, baseline, playMode);
  if (extraSeconds <= 0 || !Number.isFinite(duration) || duration <= 0) return { addedMinutes: 0 };
  const extraMinutes = Math.round(extraSeconds / 60);
  // Time left by this device's own limit once the grant is in; used only to spot a clock that
  // already holds the grant (restored after a reload) so it is not added twice.
  const newLeft =
    serverStart && serverStart.startMs > 0
      ? remainingFromServerStart(duration * 60 + extraSeconds, serverStart.startMs, nowMs)
      : null;
  const clock = clockAfterGrant(state.entireTestTimer, extraSeconds, newLeft);
  state.extendAttemptTime(duration + extraMinutes, clock - state.entireTestTimer, extraSeconds);
  appliedLimit.set(attemptId, serverMaxTimeMinutes as number);
  return { addedMinutes: extraMinutes };
}
