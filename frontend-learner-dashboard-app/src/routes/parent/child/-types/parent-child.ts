// Types for the "My Child" parent-portal BFF (/admin-core-service/parent-portal/v1).
// The BFF-specific DTOs serialize camelCase (plain @Data, no snake_case config in
// admin_core); reused domain payloads (attendance, live sessions, progress,
// assessments) keep their own shapes and are typed loosely where their field
// contract isn't owned here.

export interface EnrollmentSummary {
  packageSessionId: string;
  batchName: string;
  status: string;
}

export interface ParentChildSummary {
  childUserId: string;
  fullName: string;
  email?: string | null;
  mobileNumber?: string | null;
  profilePicFileId?: string | null;
  instituteId: string;
  instituteName?: string | null;
  enrollments: EnrollmentSummary[];
}

export interface ChildReportListItem {
  processId: string;
  name?: string | null;
  status: string;
  createdAt: string; // ISO
}

export interface ChildOverview {
  child: ParentChildSummary;
  badgeCount?: number | null;
  certificateCount?: number | null;
  invoiceCount?: number | null;
  pendingInvoiceCount?: number | null;
  reportCount?: number | null;
  latestReport?: ChildReportListItem | null;
  // Headline numbers for the home tiles (backend-enriched; optional so the UI
  // degrades gracefully if the backend hasn't been redeployed yet).
  attendancePercent?: number | null;
  courseCompletionPercent?: number | null;
  upcomingSessionCount?: number | null;
  assessmentCount?: number | null;
  availableModules: string[];
  unavailableModules: string[];
}

export type ParentModuleKey =
  | "overview"
  | "attendance"
  | "liveSessions"
  | "assessments"
  | "progress"
  | "payments"
  | "badges"
  | "certificates"
  | "reports";

export interface ParentPortalSettings {
  enabled: boolean;
  modules: Record<string, boolean>;
  reportAccess: string;
  allowViewAsChild: boolean;
  allowSwitchToParentView: boolean;
}

export interface IssuedCertificate {
  certificateId: string;
  courseName?: string | null;
  packageSessionId?: string | null;
  completionPercentage?: number | null;
  issuedAt?: string | null;
  fileId?: string | null;
  fileUrl?: string | null;
}

export interface LearnerBadge {
  // Mirrors admin_core_service LearnerBadgeDTO (camelCase). Legacy field names
  // (name/description/iconFileId/icon) are kept optional for older payloads.
  id?: string;
  userId?: string;
  instituteId?: string;
  badgeId?: string;
  badgeName?: string | null;
  badgeIcon?: string | null;
  badgeDescription?: string | null;
  /** Staff note shown to the learner/parent (manual awards only). */
  reason?: string | null;
  status?: string;
  /** "MANUAL" (staff award) or "AUTO" (synced auto-unlock); absent on older servers = MANUAL. */
  source?: string | null;
  awardedByUserId?: string | null;
  awardedAt?: string | null;
  // Legacy / loose fields
  name?: string;
  description?: string;
  iconFileId?: string;
  icon?: string;
  [k: string]: unknown;
}

// Reused domain payloads — shape owned by their source module. Typed as unknown-ish
// records so screens can read the fields they need without over-committing here.
export type AttendanceReport = Record<string, unknown>;
export type LiveSessionsGrouped = Array<Record<string, unknown>>;
export type PastSessionsResponse = Record<string, unknown>;
export type SubjectProgress = Array<Record<string, unknown>>;
export type AssessmentHistory = Record<string, unknown> | null;
