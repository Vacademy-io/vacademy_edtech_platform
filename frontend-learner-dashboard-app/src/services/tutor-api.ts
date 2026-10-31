/**
 * Live AI Tutor — learner-side REST (ai_service /tutor/v1). The socket lives in
 * hooks/useTutorSocket.ts.
 */
import authenticatedAxiosInstance, { guestAxiosInstance } from "@/lib/auth/axiosInstance";
import { AI_SERVICE_URL } from "@/constants/urls";

const BASE = `${AI_SERVICE_URL}/tutor/v1`;

export interface TutorAvailability {
  enabled: boolean;
  default_on: boolean;
  teacher_name: string;
  teacher_avatar_file_id?: string | null;
  course_language: "en" | "hi";
  languages: string[];
  session_language: "course" | "learner";
  tts_provider: string;
  ready_slides: number;
  teachable_slides: number;
  available: boolean;
  resume_slide_id?: string | null;
  first_slide_id?: string | null;
  resume_chapter_id?: string | null;
  first_chapter_id?: string | null;
  resume_module_id?: string | null;
  resume_subject_id?: string | null;
  first_module_id?: string | null;
  first_subject_id?: string | null;
  /** The course's premium face: lets the tap that opens a voice lesson start the SDK download. */
  avatar?: { provider: "spatius"; app_id: string } | null;
}

export interface TutorChapterSlide {
  slide_id: string;
  title: string | null;
  source_type: string;
  order: number | null;
  teachable: boolean;
  plan_id: string | null;
  chapter_id?: string | null;
  module_id?: string | null;
  subject_id?: string | null;
}

export interface TutorStartResponse {
  tutor_session_id: string;
  slide_id: string;
  slide_title?: string;
  language: "en" | "hi";
  /** Languages the learner may switch to during the lesson. */
  languages?: Array<"en" | "hi">;
  resumed: boolean;
  teacher_name: string;
  teacher_avatar_file_id?: string | null;
  learner_name: string | null;
  topics: Array<{ id: string; title: string; concepts: number }>;
  progress: { done: number; total: number; percent: number };
  socket_path: string;
  /** Premium teacher avatar for this course (voice lessons only). */
  avatar?: { provider: "spatius"; avatar_id: string; app_id: string } | null;
}

export interface TutorAvatarToken {
  provider: "spatius";
  session_token: string;
  expires_at: number;
  app_id: string;
  avatar_id: string;
}

export const getTutorAvatarToken = async (tutorSessionId: string): Promise<TutorAvatarToken> => {
  const res = await authenticatedAxiosInstance.post<TutorAvatarToken>(`${BASE}/sessions/${tutorSessionId}/avatar-token`, {});
  return res.data;
};

export const getTutorAvailability = async (
  packageId: string,
  packageSessionId?: string,
): Promise<TutorAvailability> => {
  const res = await authenticatedAxiosInstance.get<TutorAvailability>(
    `${BASE}/learner/packages/${packageId}/availability`,
    { params: packageSessionId ? { package_session_id: packageSessionId } : undefined },
  );
  return res.data;
};

export const getTutorChapterSlides = async (
  chapterId: string,
  packageSessionId: string,
): Promise<TutorChapterSlide[]> => {
  const res = await authenticatedAxiosInstance.get<{ slides: TutorChapterSlide[] }>(
    `${BASE}/learner/chapters/${chapterId}/slides`,
    { params: { package_session_id: packageSessionId } },
  );
  return res.data.slides;
};

/** One slide in the course outline (tutor left rail). */
export interface TutorOutlineSlide {
  slide_id: string;
  title: string | null;
  source_type: string;
  order: number | null;
  teachable: boolean;
}

/** One chapter of the batch, in course order, with its slides. */
export interface TutorOutlineChapter {
  chapter_id: string;
  chapter_name: string | null;
  module_id: string | null;
  module_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
  slides: TutorOutlineSlide[];
}

/** Every chapter of the batch with tutor readiness — lets the rail and "Next" cross chapters. */
export const getTutorCourseOutline = async (packageSessionId: string): Promise<TutorOutlineChapter[]> => {
  const res = await authenticatedAxiosInstance.get<{ chapters: TutorOutlineChapter[] }>(
    `${BASE}/learner/packages/${packageSessionId}/outline`,
  );
  return res.data.chapters ?? [];
};

export const startTutorSession = async (params: {
  packageSessionId: string;
  slideId?: string;
  mode: "TEXT" | "VOICE";
  language?: "en" | "hi";
}): Promise<TutorStartResponse> => {
  const res = await authenticatedAxiosInstance.post<TutorStartResponse>(`${BASE}/sessions`, {
    package_session_id: params.packageSessionId,
    slide_id: params.slideId,
    mode: params.mode,
    language: params.language,
  });
  return res.data;
};

export const endTutorSession = async (tutorSessionId: string): Promise<void> => {
  try {
    await authenticatedAxiosInstance.post(`${BASE}/sessions/${tutorSessionId}/end`);
  } catch {
    /* the socket usually ends it first */
  }
};

// ── quiz completion ──────────────────────────────────────────────────────────

import { SUBMIT_QUIZ_SLIDE_ACTIVITY_LOG } from "@/constants/urls";
import { getUserId } from "@/constants/getUserId";
import type { TutorQuizResult } from "@/hooks/useTutorSocket";

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/**
 * A quiz slide taught by the tutor is completed the way the quiz viewer
 * completes it: one activity log with a quiz_sides row per question. The
 * tracking service re-grades every row from the answer key, so the
 * option ids matter more than the status sent here.
 */
export const submitTutorQuizActivity = async (params: {
  slideId: string;
  chapterId?: string;
  moduleId?: string;
  subjectId?: string;
  packageSessionId: string;
  results: TutorQuizResult[];
}): Promise<void> => {
  const userId = (await getUserId()) || "";
  const { slideId, chapterId, moduleId, subjectId, packageSessionId, results } = params;
  if (!slideId || !chapterId || !moduleId || !subjectId || !packageSessionId || !userId) {
    throw new Error("Quiz completion needs the slide's chapter, module and subject ids");
  }
  const now = Date.now();
  const payload = {
    id: uuid(),
    source_id: slideId,
    source_type: "QUIZ",
    user_id: userId,
    slide_id: slideId,
    start_time_in_millis: now - 60_000,
    end_time_in_millis: now,
    percentage_watched: 100,
    videos: [],
    documents: [],
    question_slides: [],
    assignment_slides: [],
    video_slides_questions: [],
    new_activity: true,
    concentration_score: { id: uuid(), concentration_score: 100, tab_switch_count: 0, pause_count: 0, answer_times_in_seconds: [] },
    quiz_sides: results.map((r) => {
      const byId = new Map(r.options.map((o) => [o.id, o.name] as const));
      const status = !r.answered || r.skipped ? "SKIPPED" : r.correct ? "CORRECT" : "WRONG";
      return {
        id: uuid(),
        response_json: JSON.stringify({
          questionName: r.question_name,
          selectedOptions: r.selected_option_ids.map((id) => ({ id, name: byId.get(id) ?? r.answer })),
          correctOptions: r.correct_option_ids.map((id) => ({ id, name: byId.get(id) ?? id })),
          learnerAnswer: r.answer,
          marks: r.correct ? 1 : 0,
          maxMarks: 1,
          isCorrect: r.correct,
          questionType: r.options.length ? "MCQS" : "ONE_WORD",
          source: "tutor",
        }),
        response_status: status,
        activity_id: slideId,
        question_id: r.question_id,
      };
    }),
  };
  await authenticatedAxiosInstance.post(
    `${SUBMIT_QUIZ_SLIDE_ACTIVITY_LOG}?slideId=${slideId}&chapterId=${chapterId}&moduleId=${moduleId}&subjectId=${subjectId}&packageSessionId=${packageSessionId}&userId=${userId}`,
    payload,
  );
};

// ── public demo lesson (no auth; length = tutor.demo.minutes) ───────────────────────────────────────────

export interface TutorDemoTopic {
  key: string;
  title: string;
  emoji?: string;
  language?: "en" | "hi";
}

export const getTutorDemoTopics = async (): Promise<{ enabled: boolean; minutes: number; topics: TutorDemoTopic[] }> => {
  const res = await guestAxiosInstance.get(`${BASE}/demo/topics`);
  return res.data;
};

export const startTutorDemo = async (params: {
  name: string;
  topicKey: string;
  language?: "en" | "hi";
  mode: "VOICE" | "TEXT";
}): Promise<{ token: string; minutes: number; boot: TutorStartResponse }> => {
  const res = await guestAxiosInstance.post(`${BASE}/demo/start`, {
    name: params.name,
    topic_key: params.topicKey,
    language: params.language,
    mode: params.mode,
  });
  return res.data;
};

/** Guest lessons: the Spatius token for the demo avatar, authenticated with the guest JWT. */
export const getTutorDemoAvatarToken = async (tutorSessionId: string, guestToken: string): Promise<TutorAvatarToken> => {
  const res = await guestAxiosInstance.post<TutorAvatarToken>(
    `${BASE}/demo/avatar-token`,
    { tutor_session_id: tutorSessionId },
    { headers: { Authorization: `Bearer ${guestToken}` } }
  );
  return res.data;
};
