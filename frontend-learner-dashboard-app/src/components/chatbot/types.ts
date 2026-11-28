export type MessageRole =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "quiz"
  | "quiz_feedback"
  | "card";

export interface ChatbotContext {
  route: string;
  courseId?: string;
  packageSessionId?: string;
  subjectId?: string;
  moduleId?: string;
  chapterId?: string;
  slideId?: string;
  sessionId?: string;
}

export interface QuizQuestion {
  id: string;
  question: string; // Markdown format
  options: string[]; // Markdown format
}

export interface QuizData {
  quiz_id: string;
  title: string;
  topic: string;
  total_questions: number;
  time_limit_seconds?: number;
  questions: QuizQuestion[];
}

export interface QuestionFeedback {
  question_id: string;
  question_text: string;
  correct: boolean;
  user_answer_index?: number;
  correct_answer_index: number;
  user_answer_text?: string;
  correct_answer_text: string;
  explanation?: string;
}

export interface QuizFeedbackData {
  quiz_id: string;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  overall_feedback: string;
  recommendations: string[];
  time_taken_seconds?: number;
  question_feedback: QuestionFeedback[];
}

export interface QuizSubmission {
  quiz_id: string;
  answers: Record<string, number>; // question_id -> selected_option_index
  time_taken_seconds?: number;
}

export interface Attachment {
  type: 'image' | 'video';
  url: string;
  mime_type?: string;
  name?: string;
}

export interface ChatMessage {
  id: number;
  role: MessageRole;
  content: string;
  timestamp: number;
  context?: ChatbotContext;
  status?: 'sent' | 'pending' | 'failed';
  attachments?: Attachment[];
  /**
   * Shown only in this tab, never sent by the server: the partial reply kept
   * on screen after Stop until the server's saved copy arrives on replay.
   */
  isLocal?: boolean;
  /** Delivered by the server's stream, so `id` is the saved message's id (ratable). */
  fromServer?: boolean;
  /** Arrived in the transcript replay of an opened chat (shown without entrance motion). */
  replayed?: boolean;
  metadata?: {
    tool_name?: string;
    tool_arguments?: object;
    tool_call_id?: string;
    quiz_data?: QuizData;
    /**
     * Role "quiz_feedback": the quiz result. Assistant replies: the learner's
     * thumbs rating ({@link MessageRating}).
     */
    feedback?: QuizFeedbackData | MessageRating;
    /** Present on role "card": structured data rendered by cards/ChatCard. */
    card?: ChatCardData;
    /** Follow-up questions the learner might ask next (final assistant replies). */
    suggestions?: string[];
    /** The learner stopped this reply mid-stream; the content is partial. */
    stopped?: boolean;
    /** Set when the learner saved (bookmarked) this reply; null/absent = not saved. */
    saved_at?: string | null;
  };
}

/** The learner's rating of an assistant reply ("none" = cleared). */
export interface MessageRating {
  rating: "up" | "down" | "none";
  comment?: string;
}

/** The active thumbs rating of a message, if any. */
export const getMessageRating = (msg: ChatMessage): "up" | "down" | null => {
  const feedback = msg.metadata?.feedback as { rating?: unknown } | undefined;
  return feedback?.rating === "up" || feedback?.rating === "down" ? feedback.rating : null;
};

/**
 * Rich cards the assistant can send (SSE message type "card"). The message's
 * `content` is a markdown fallback, rendered when the kind is unknown or the
 * data is malformed, so the backend can add kinds before the UI knows them.
 */
export type CardIcon =
  | "course"
  | "slide"
  | "video"
  | "pdf"
  | "quiz"
  | "question"
  | "live"
  | "assessment"
  | "link";

export interface CardLinkItem {
  title: string;
  subtitle?: string;
  /** "/path?query" = in-app route; "https://..." = new tab; anything else = plain text. */
  href?: string;
  icon?: CardIcon;
  badge?: string;
}

export interface LinkListCardData {
  kind: "link_list";
  title?: string;
  items: CardLinkItem[];
}

export interface ProgressCardItem {
  title: string;
  /** 0-100; clamped by the renderer. */
  percent: number;
  subtitle?: string;
  href?: string;
}

export interface ProgressCardData {
  kind: "progress";
  title?: string;
  items: ProgressCardItem[];
}

export interface StepsCardItem {
  title: string;
  /** Markdown + LaTeX, rendered with ChatMarkdown. */
  body: string;
}

export interface StepsCardData {
  kind: "steps";
  title?: string;
  items: StepsCardItem[];
}

export interface FlashcardItem {
  front: string;
  back: string;
}

export interface FlashcardsCardData {
  kind: "flashcards";
  title?: string;
  items: FlashcardItem[];
}

export type ChatCardData =
  | LinkListCardData
  | ProgressCardData
  | StepsCardData
  | FlashcardsCardData;

export interface ChatResponse {
  message: string;
}
