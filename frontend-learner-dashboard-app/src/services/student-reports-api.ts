// import { BASE_URL } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { getUserId } from "@/constants/getUserId";
import { saveFile } from "@/lib/download/save-file";
import { BASE_URL } from "@/constants/urls";

// ── V1 LLM-text report types (old endpoint) ───────────────────────────────────
export interface ReportContent {
  learning_frequency: string;
  progress: string;
  student_efforts: string;
  topics_of_improvement: string;
  topics_of_degradation: string;
  remedial_points: string;
  strengths: Record<string, number>;
  weaknesses: Record<string, number>;
}

export interface StudentReport {
  process_id: string;
  user_id: string;
  institute_id: string;
  start_date_iso: string;
  end_date_iso: string;
  status: string;
  created_at: string;
  updated_at: string;
  report: ReportContent;
}

export interface ReportsResponse {
  reports: StudentReport[];
  current_page: number;
  total_pages: number;
  total_elements: number;
  page_size: number;
}

export interface ReportDetailResponse {
  process_id: string;
  status: string;
  report: ReportContent;
  error_message: string;
}

// ── V2 Comprehensive Report types (new endpoint) ──────────────────────────────

export interface V2HeadlineMetric {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "steady";
  change?: string;
  sentiment?: "good" | "neutral" | "attention" | "bad";
}

export interface V2AttendanceWeekly {
  week: string;
  percentage: number;
}

export interface V2SubjectPerformance {
  subject: string;
  score_percentage: number;
  class_average: number;
  trend?: "up" | "down" | "steady";
  sentiment?: "good" | "neutral" | "attention" | "bad";
}

export interface V2Assessment {
  name: string;
  date: string;
  subject: string;
  marks: number;
  total_marks: number;
  percentage: number;
  grade: string;
  rank?: number;
  percentile?: number;
  class_average?: number;
  status: string;
}

export interface V2StudyHabitsContentEngagement {
  videos_watched: number;
  documents_read: number;
  quizzes_attempted: number;
}

export interface V2DailyStudyMinute {
  date: string;
  minutes: number;
}

export interface V2CourseProgressSubject {
  subject: string;
  completion_percentage: number;
  time_hours: number;
}

export interface V2LiveClassParticipation {
  questions_asked: number;
  polls_answered: number;
  avg_engagement: string;
}

export interface V2Strength {
  topic: string;
  confidence: number;
}

export interface V2Achievement {
  title: string;
  issued_at: string;
  type?: string;
  course_name?: string;
  completion_percentage?: number;
}

export interface V2Recommendation {
  priority: string;
  area: string;
  suggestion: string;
}

export interface V2SubjectMarksItem {
  subject: string;
  marks_obtained: number;
  total_marks: number;
  percentage: number;
  item_count: number;
  topics?: string[];
}

export interface V2GradedItem {
  type: "ASSESSMENT" | "ASSIGNMENT" | "QUIZ" | "QUESTION";
  title: string;
  subject?: string;
  marks_obtained: number;
  total_marks: number;
}

export interface V2ReportData {
  meta: {
    report_version: string;
    report_name: string;
    report_id: string;
    generated_at: string;
    language: string;
  };
  student: {
    name: string;
    class: string;
    batch: string;
    enrollment_no: string;
    roll_no: string;
    avatar_url?: string | null;
  };
  institute: {
    name: string;
    logo_url?: string | null;
    theme_color?: string;
  };
  period: {
    start_date: string;
    end_date: string;
    label: string;
    days: number;
  };
  overview: {
    overall_status: string;
    overall_grade: string;
    one_line: string;
    headline_metrics: V2HeadlineMetric[];
  };
  parent_summary?: string;
  attendance?: {
    available: boolean;
    overall_percentage: number;
    present: number;
    absent: number;
    late: number;
    total_sessions: number;
    trend?: string;
    change_vs_previous?: string;
    note?: string;
    weekly?: V2AttendanceWeekly[];
  };
  academics?: {
    available: boolean;
    average_percentage: number;
    class_average_percentage: number;
    best_subject: string;
    weakest_subject: string;
    assessments: V2Assessment[];
    subject_performance: V2SubjectPerformance[];
  };
  study_habits?: {
    available: boolean;
    total_study_hours: number;
    avg_minutes_per_day: number;
    active_days: number;
    total_days: number;
    longest_streak_days: number;
    consistency_rating: string;
    most_active_time: string;
    focus_score: number;
    content_engagement: V2StudyHabitsContentEngagement;
    daily_study_minutes: V2DailyStudyMinute[];
  };
  course_progress?: {
    available: boolean;
    overall_completion_percentage: number;
    subjects: V2CourseProgressSubject[];
  };
  live_classes?: {
    available: boolean;
    attended: number;
    missed: number;
    unmarked?: number;
    total: number;
    attendance_percentage: number;
    participation: V2LiveClassParticipation;
  };
  assignments?: {
    available: boolean;
    assigned: number;
    submitted: number;
    on_time: number;
    late: number;
    pending: number;
    avg_score_percentage: number;
  };
  subject_marks?: {
    available: boolean;
    subjects: V2SubjectMarksItem[];
    items?: V2GradedItem[];
  };
  strengths?: V2Strength[];
  areas_to_improve?: V2Strength[];
  achievements?: V2Achievement[];
  doubts_and_engagement?: {
    available: boolean;
    questions_asked: number;
    resolved: number;
    avg_resolution_hours: number;
    note?: string;
  };
  ai_insights?: {
    summary: string;
    cross_domain_insights: string[];
    recommendations: V2Recommendation[];
    section_commentary: Record<string, string>;
  };
  learning_insights?: V2LearningInsights;
  narrative?: V2Narrative;
  data_notes?: string[];
}

export interface V2LearningInsights {
  available: boolean;
  attempts_analyzed?: number;
  topic_mastery?: V2TopicMastery[];
  blooms?: V2BloomLevel[];
  confidence?: V2ConfidenceProfile;
  misconceptions?: V2Misconception[];
}

export interface V2TopicMastery {
  topic: string;
  questions?: number;
  correct?: number;
  accuracy?: number;
  avg_time_seconds?: number;
  mastery_level?: string;
}

export interface V2BloomLevel {
  level: string;
  total?: number;
  correct?: number;
  accuracy?: number;
}

export interface V2ConfidenceProfile {
  overall?: number;
  knows?: number;
  guesses?: number;
  high_confidence_wrong?: number;
}

export interface V2Misconception {
  topic?: string;
  context?: string;
  misconception?: string;
  remediation?: string;
}

export interface V2Narrative {
  learning_frequency?: string;
  progress?: string;
  student_efforts?: string;
  topics_of_improvement?: string;
  topics_of_degradation?: string;
  remedial_points?: string;
}

// ── My Reports API types (new owner-scoped endpoints, covers v1 + v2) ─────────

/** One row returned by GET /my/reports */
export interface ReportListItem {
  process_id: string;
  start_date_iso: string;
  end_date_iso: string;
  status: string;
  created_at: string;
  report_version?: string;
  /** Admin-supplied or auto-generated report name. */
  name?: string;
  /** Inline v1 LLM report content — null for v2 rows. */
  report: ReportContent | null;
}

export interface MyReportsListResponse {
  reports: ReportListItem[];
  current_page: number;
  total_pages: number;
  total_elements: number;
  page_size: number;
}

/** Detail returned by GET /my/report/{processId} */
export interface MyReportDetailResponse {
  process_id: string;
  status: string;
  /** 'v1' = old LLM-text report; 'v2' = new comprehensive report. */
  report_version: string;
  /** Admin-supplied or auto-generated report name. */
  name?: string;
  /** v1 LLM-text report content — non-null for v1 reports. */
  report: ReportContent | null;
  /** v2 comprehensive report object — non-null for v2 reports. */
  comprehensive_report: V2ReportData | null;
  error_message?: string;
}

// ── Old v1-only API functions (kept for backward compat) ──────────────────────

export const fetchStudentReports = async (
  page: number = 0,
  size: number = 10,
): Promise<ReportsResponse> => {
  const userId = await getUserId();
  const response = await authenticatedAxiosInstance.get<ReportsResponse>(
    `${BASE_URL}/admin-core-service/v1/student-analysis/reports/user/${userId}`,
    {
      params: { page, size },
    },
  );
  return response.data;
};

export const fetchStudentReportById = async (
  processId: string,
): Promise<ReportDetailResponse> => {
  const response = await authenticatedAxiosInstance.get<ReportDetailResponse>(
    `${BASE_URL}/admin-core-service/v1/student-analysis/report/${processId}`,
  );
  return response.data;
};

// ── New owner-scoped API functions (JWT, covers v1 + v2) ─────────────────────

export async function fetchMyReports(
  page = 0,
  size = 10,
): Promise<MyReportsListResponse> {
  const response = await authenticatedAxiosInstance.get<MyReportsListResponse>(
    `${BASE_URL}/admin-core-service/v1/student-analysis/my/reports`,
    { params: { page, size } },
  );
  return response.data;
}

export async function fetchMyReport(
  processId: string,
): Promise<MyReportDetailResponse> {
  const response = await authenticatedAxiosInstance.get<MyReportDetailResponse>(
    `${BASE_URL}/admin-core-service/v1/student-analysis/my/report/${processId}`,
  );
  return response.data;
}

/** Downloads the report PDF (owner-accessible) and triggers a browser save. */
export async function downloadReportPdf(processId: string): Promise<void> {
  const response = await authenticatedAxiosInstance.get(
    `${BASE_URL}/admin-core-service/v1/student-analysis/report/${processId}/pdf`,
    { responseType: "blob" },
  );
  await saveFile(response.data as Blob, `report-${processId}.pdf`);
}
