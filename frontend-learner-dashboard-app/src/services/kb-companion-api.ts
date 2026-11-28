/**
 * Knowledge Base companions — learner-side REST (ai_service /kb-companion/v1).
 *
 * A companion is a study tutor built on one knowledge base: a topic map with
 * progress, visual lessons compiled once per topic, practice sets, and a
 * grounded "Ask" thread. Design: docs/student-ai/KB_COMPANIONS_DESIGN.md.
 */
import axios from "axios";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { aiUsageLimitMessage, claimAiUsageLimit } from "@/lib/ai-usage-limit-notify";
import { AI_SERVICE_URL } from "@/constants/urls";

const BASE = `${AI_SERVICE_URL}/kb-companion/v1`;

// ── types ────────────────────────────────────────────────────────────────────

export type CompanionMode = "learn" | "practice" | "ask";
export type CompanionLanguage = "en" | "hi" | "kn";

export interface CompanionProgressSummary {
  leaves_total: number;
  started: number;
  completed: number;
  /** 0-100, averaged over every leaf in scope (untouched leaves count as 0). */
  mastery: number;
}

export interface CompanionResume {
  node_id: string;
  card_index: number;
  reason: "continue" | "next";
  title?: string | null;
}

/** Public companion fields (what the detail endpoint returns under `companion`). */
export interface CompanionPublic {
  id: string;
  knowledge_base_id: string;
  kb_name: string;
  name: string;
  description?: string | null;
  avatar_emoji?: string | null;
  accent_color?: string | null;
  language: CompanionLanguage;
  modes: CompanionMode[];
  voice_enabled: boolean;
  show_on_dashboard: boolean;
  daily_question_cap?: number | null;
}

export interface CompanionSummary extends CompanionPublic {
  progress: CompanionProgressSummary;
  resume: CompanionResume | null;
  topics_total: number;
}

export interface LeafProgress {
  status: "IN_PROGRESS" | "COMPLETED";
  card_index: number;
  cards_total: number;
  mastery: number;
  last_activity_at?: string | null;
}

export interface CompanionLeaf {
  id: string;
  title: string;
  summary?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  /** True when a topic has no subtopics, so the topic itself is the leaf. */
  is_topic?: boolean;
  progress: LeafProgress | null;
  lesson_ready: boolean;
}

export interface CompanionTopic {
  id: string;
  title: string;
  summary?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  leaves: CompanionLeaf[];
}

export interface CompanionDetail {
  companion: CompanionPublic;
  learner_name: string | null;
  topics: CompanionTopic[];
  progress: CompanionProgressSummary;
  resume: CompanionResume | null;
}

export type ArtifactStatus = "MISSING" | "GENERATING" | "READY" | "FAILED";

export type LessonCardKind =
  | "hook"
  | "concept"
  | "figure"
  | "compare"
  | "process"
  | "example"
  | "flashcards"
  | "check"
  | "recap";

export interface LessonCheck {
  question: string;
  options: string[];
  answer_index: number;
  explanation?: string | null;
}

export interface LessonCard {
  id: string;
  kind: LessonCardKind;
  title: string;
  say?: string | null;
  citation: string | null;
  status: "pending" | "ready";
  check: LessonCheck | null;
  objective?: string | null;
  pages?: number[] | null;
  /** Full sandbox-ready HTML document for visual cards (absent for checks / pending). */
  html_doc?: string;
}

export interface CompanionLesson {
  status: ArtifactStatus;
  node_id: string;
  title?: string | null;
  cards_planned?: number;
  cards: LessonCard[];
  error?: string | null;
}

export interface PracticeQuestion {
  id: string;
  question: string;
  options: string[];
  answer_index: number;
  explanation?: string | null;
  difficulty?: "easy" | "medium" | "hard";
  pages?: number[] | null;
  citation?: string | null;
}

export interface CompanionPractice {
  status: ArtifactStatus;
  node_id: string;
  title?: string | null;
  questions: PracticeQuestion[];
  error?: string | null;
}

export interface ProgressUpdate {
  node_id: string;
  card_index: number;
  cards_total: number;
  check?: { card_id: string; correct: boolean };
  practice?: { correct: number; total: number };
  completed?: boolean;
}

export interface ProgressUpdateResponse {
  node: (Partial<LeafProgress> & { node_id?: string }) | null;
  progress: CompanionProgressSummary;
  resume: CompanionResume | null;
}

export interface AskCitation {
  n: number;
  label: string;
  page_start?: number | null;
  page_end?: number | null;
}

export interface AskFigure {
  image_url: string;
  caption?: string | null;
  page_number?: number | null;
}

export interface AskMessageMeta {
  kind?: "answer" | "care" | "not_found";
  citations?: AskCitation[];
  figures?: AskFigure[];
  follow_ups?: string[];
  in_scope?: boolean;
  node_id?: string | null;
}

export interface AskMessage {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  meta: AskMessageMeta;
  created_at?: string | null;
}

export interface AskThread {
  messages: AskMessage[];
  questions_today: number;
  daily_cap: number | null;
}

export interface SpeechResponse {
  url: string;
  cached: boolean;
}

// ── endpoints ────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

export const listMyCompanions = async (): Promise<CompanionSummary[]> => {
  const res = await authenticatedAxiosInstance.get<{ companions: CompanionSummary[] }>(
    `${BASE}/learner/companions`,
  );
  return res.data?.companions ?? [];
};

export const getMyCompanion = async (companionId: string): Promise<CompanionDetail> => {
  const res = await authenticatedAxiosInstance.get<CompanionDetail>(
    `${BASE}/learner/companions/${enc(companionId)}`,
  );
  return res.data;
};

/** Open a lesson; the first learner of a topic starts its compile. */
export const openLesson = async (companionId: string, nodeId: string): Promise<CompanionLesson> => {
  const res = await authenticatedAxiosInstance.post<CompanionLesson>(
    `${BASE}/learner/companions/${enc(companionId)}/nodes/${enc(nodeId)}/lesson`,
    {},
  );
  return res.data;
};

export const pollLesson = async (companionId: string, nodeId: string): Promise<CompanionLesson> => {
  const res = await authenticatedAxiosInstance.get<CompanionLesson>(
    `${BASE}/learner/companions/${enc(companionId)}/nodes/${enc(nodeId)}/lesson`,
  );
  return res.data;
};

/** Get or start a practice set for a topic. */
export const openPractice = async (companionId: string, nodeId: string): Promise<CompanionPractice> => {
  const res = await authenticatedAxiosInstance.post<CompanionPractice>(
    `${BASE}/learner/companions/${enc(companionId)}/nodes/${enc(nodeId)}/practice`,
    {},
  );
  return res.data;
};

export const pollPractice = async (companionId: string, nodeId: string): Promise<CompanionPractice> => {
  const res = await authenticatedAxiosInstance.get<CompanionPractice>(
    `${BASE}/learner/companions/${enc(companionId)}/nodes/${enc(nodeId)}/practice`,
  );
  return res.data;
};

export const recordProgress = async (
  companionId: string,
  body: ProgressUpdate,
): Promise<ProgressUpdateResponse> => {
  const res = await authenticatedAxiosInstance.post<ProgressUpdateResponse>(
    `${BASE}/learner/companions/${enc(companionId)}/progress`,
    body,
  );
  return res.data;
};

export const getAskThread = async (companionId: string): Promise<AskThread> => {
  const res = await authenticatedAxiosInstance.get<AskThread>(
    `${BASE}/learner/companions/${enc(companionId)}/thread`,
  );
  return res.data;
};

/** The server stores the learner's question too; append it locally on success. */
export const askCompanion = async (
  companionId: string,
  body: { question: string; node_id?: string },
): Promise<AskMessage> => {
  const res = await authenticatedAxiosInstance.post<{ message: AskMessage }>(
    `${BASE}/learner/companions/${enc(companionId)}/ask`,
    body,
  );
  return res.data.message;
};

export const getCompanionSpeech = async (
  companionId: string,
  body: { node_id: string; card_id: string } | { message_id: number | string },
): Promise<SpeechResponse> => {
  const res = await authenticatedAxiosInstance.post<SpeechResponse>(
    `${BASE}/learner/companions/${enc(companionId)}/speech`,
    body,
  );
  return res.data;
};

// ── errors ───────────────────────────────────────────────────────────────────

export interface CompanionApiError {
  status: number | null;
  code: string | null;
  /** Server-written, learner-safe message when the API sent one. */
  message: string | null;
}

/**
 * Normalise an ai_service error. FastAPI puts either a string or
 * `{code, message}` under `detail`.
 */
export function readCompanionError(error: unknown): CompanionApiError {
  if (!axios.isAxiosError(error)) return { status: null, code: null, message: null };
  const status = error.response?.status ?? null;
  // AI usage limit (429 AI_USAGE_LIMIT, top-level body): shown inline by the
  // caller, so the global toast is skipped. Other 429s read exactly as before.
  const usageLimit = claimAiUsageLimit(error);
  if (usageLimit) return { status, code: usageLimit.error, message: aiUsageLimitMessage(usageLimit) };
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
  if (detail && typeof detail === "object") {
    const d = detail as { code?: unknown; message?: unknown };
    return {
      status,
      code: typeof d.code === "string" ? d.code : null,
      message: typeof d.message === "string" ? d.message : null,
    };
  }
  return { status, code: null, message: typeof detail === "string" ? detail : null };
}
