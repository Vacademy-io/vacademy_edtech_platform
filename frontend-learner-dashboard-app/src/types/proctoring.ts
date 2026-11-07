/**
 * Proctoring config and events, as exchanged with assessment_service (V48).
 * Wire shape is snake_case; the learner runtime reads it as-is.
 */
export type ProctoringTier = "NONE" | "BASIC" | "PRO" | "ULTRA";

export interface ProctoringConfig {
  tier: ProctoringTier | string;
  camera_required: boolean;
  snapshot_interval_sec: number;
  face_check: boolean;
  max_violations: number;
  show_self_view: boolean;
}

/** Every unproctored assessment — and every failed config fetch — resolves to this. */
export const PROCTORING_OFF: ProctoringConfig = {
  tier: "NONE",
  camera_required: false,
  snapshot_interval_sec: 0,
  face_check: false,
  max_violations: 0,
  show_self_view: false,
};

export const isProctored = (config: ProctoringConfig | null | undefined) =>
  !!config && String(config.tier).toUpperCase() !== "NONE";

export type ProctorEventType =
  | "CHECK_IN"
  | "SNAPSHOT"
  | "CAMERA_DENIED"
  | "CAMERA_LOST"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "TAB_SWITCH"
  | "FULLSCREEN_EXIT"
  | "AUTO_SUBMITTED";

export type ProctorEventSeverity = "INFO" | "WARN" | "FLAG";

export interface ProctorEvent {
  event_type: ProctorEventType;
  severity: ProctorEventSeverity;
  occurred_at: string;
  evidence_file_id?: string | null;
  meta?: Record<string, string | number | boolean>;
}

export type CameraStatus = "idle" | "starting" | "on" | "denied" | "lost";
