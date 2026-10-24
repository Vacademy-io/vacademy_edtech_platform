import { getUserId } from "@/constants/getUserId";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { getTokenFromStorage, isTokenExpired } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { getUserBasicDetails } from "./getBasicUserDetails";
import { QuizSubmission } from "@/components/chatbot/types";
import { AI_SERVICE_URL } from "@/constants/urls";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

export type ContextType = "slide" | "course_details" | "general";
export type SessionMode = "text" | "voice_interview" | "voice_doubt" | "voice_oral_test";
export type MessageType =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "quiz"
  | "quiz_feedback"
  | "card"
  | "token";
export type AIStatus = "idle" | "thinking" | "generating_quiz";
export type SessionStatus = "ACTIVE" | "CLOSED";
export type MessageIntent = "doubt" | "practice" | "general";

export interface ContextMeta {
  // Slide context
  name?: string;
  type?: string;
  content?: string;
  questions?: string[];
  options?: string[] | string[][];
  level?: string;
  order?: number;
  chapter?: string;
  module?: string;
  subject?: string;
  course?: string;
  progress?: string;

  // Course context
  watch_time?: string;
  total_length_in_minutes?: number | null;
  about?: string;
  why_learn?: string;
  who_should_learn?: string;
  session?: string;

  // General context
  courses_path?: string;

  // Voice call: what the interview / oral test / doubt call is about
  voice_topic?: string;

  // Ids the tutor's tools act on (e.g. a doubt handed to a teacher)
  slide_id?: string;
  subject_id?: string;
  package_session_id?: string;
  // Course-material search hints; the server re-derives access
  chapter_id?: string;
  tz?: string;
}

export interface InitSessionRequest {
  user_id: string;
  institute_id: string;
  user_name?: string;
  context_type?: ContextType;
  context_meta?: ContextMeta;
  initial_message?: string;
  session_mode?: SessionMode;
}

export interface InitSessionResponse {
  session_id: string;
  status: AIStatus;
}

export interface MessageEvent {
  id: number;
  type: MessageType;
  content: string;
  metadata?: {
    tool_name?: string;
    tool_arguments?: object;
    tool_call_id?: string;
    quiz_data?: object;
    feedback?: object;
    card?: object;
    suggestions?: string[];
    stopped?: boolean;
    /** Set when the learner saved (bookmarked) this reply. */
    saved_at?: string | null;
  };
  created_at: string;
}

/** Callbacks for {@link ChatbotAPIService.openStream}. */
export interface ChatStreamHandlers {
  onOpen?: () => void;
  /** One server-sent event: its `event:` name and raw `data:` payload. */
  onEvent: (event: string, data: string) => void;
  /**
   * The stream ended or could not be opened. `status` is set when the server
   * answered with an HTTP error (401/403/404/5xx) instead of a stream.
   */
  onDisconnect: (info: { status?: number; error?: unknown }) => void;
}

export interface ChatStream {
  close: () => void;
}

export interface StatusEvent {
  ai_status: AIStatus;
  session_status: SessionStatus;
}

export interface SendMessageRequest {
  message: string;
  intent?: MessageIntent;
  quiz_submission?: QuizSubmission;
  idempotency_key?: string;
  attachments?: Array<{type: string; url: string; mime_type?: string; name?: string}>;
}

export interface SendMessageResponse {
  message_id: number;
  status: AIStatus;
}

export interface CloseSessionResponse {
  session_id: string;
  status: "CLOSED";
  message_count: number;
}

/** One of the learner's past text chats (GET /chat-agent/sessions). */
export interface ChatSessionSummary {
  session_id: string;
  title: string | null;
  context_type: ContextType | string | null;
  status: SessionStatus | string;
  /** ISO timestamp in UTC (may lack the trailing "Z"). */
  last_active: string | null;
  question_count: number;
}

export interface ListSessionsResponse {
  sessions: ChatSessionSummary[];
}

export interface ResumeSessionResponse {
  session_id: string;
  status: "ACTIVE";
}

/** "none" clears an earlier rating. */
export type FeedbackRating = "up" | "down" | "none";

export interface MessageFeedbackResponse {
  message_id: number;
  rating: FeedbackRating;
}

export interface UpdateContextRequest {
  context_type: ContextType;
  context_meta: ContextMeta;
}

export interface UpdateContextResponse {
  session_id: string;
  context_type: ContextType;
  status: "success" | "error";
}

/** Icon of a personal starter (GET /chat-agent/starters). */
export type StarterIcon =
  | "explain"
  | "quiz"
  | "course"
  | "live"
  | "task"
  | "resume"
  | "test"
  | "plan"
  | "results"
  | "doubt";

/** A one-tap starter: `prompt` is a complete request, sent as the learner's message. */
export interface ChatStarter {
  icon: StarterIcon | string;
  label: string;
  sublabel?: string | null;
  prompt: string;
}

/** A time-sensitive nudge shown beside the closed launcher. */
export interface ChatPeek {
  text: string;
  prompt: string;
}

export interface ChatStartersResponse {
  starters: ChatStarter[];
  peek: ChatPeek | null;
  try_saying: string[];
}

/** One saved (bookmarked) tutor reply (GET /chat-agent/saved). */
export interface SavedAnswer {
  message_id: number;
  session_id: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  /** ISO timestamp in UTC (may lack the trailing "Z"). */
  saved_at: string | null;
  /** The learner's question this reply answered, when known. */
  question: string | null;
}

/** One spoken piece of a reply; play them in order. */
export interface ReplySpeechSegment {
  audio_base64: string;
  mime: string;
}

class ChatbotAPIService {
  private baseUrl: string;
  private instituteId: string | null = null;
  private userId: string | null = null;

  constructor() {
    this.baseUrl = AI_SERVICE_URL;
  }

  private async getInstituteId(): Promise<string> {
    if (this.instituteId) return this.instituteId;

    const { value } = await Preferences.get({ key: "InstituteDetails" });
    if (value) {
      try {
        const parsed = JSON.parse(value);
        this.instituteId = parsed?.id || "";
      } catch (e) {
        console.error("Error parsing institute details", e);
        this.instituteId = "";
      }
    } else {
      this.instituteId = "";
    }
    return this.instituteId || "";
  }

  private async getUserId(): Promise<string> {
    if (this.userId) return this.userId;
    const id = await getUserId();
    this.userId = id || "";
    return this.userId;
  }

  /** The learner and institute the chat belongs to (scopes local storage). */
  async getScope(): Promise<{ userId: string; instituteId: string }> {
    const [userId, instituteId] = await Promise.all([this.getUserId(), this.getInstituteId()]);
    return { userId, instituteId };
  }

  async initSession(
    initialMessage?: string,
    contextType?: ContextType,
    contextMeta?: ContextMeta,
    sessionMode?: SessionMode,
  ): Promise<InitSessionResponse> {
    const userId = await this.getUserId();
    const userDetails = await getUserBasicDetails([userId]);
    const name = userDetails?.[0]?.name || "";
    const instituteId = await this.getInstituteId();

    const request: InitSessionRequest = {
      user_id: userId,
      institute_id: instituteId,
      initial_message: initialMessage,
      user_name:
        name || getTerminology(RoleTerms.Learner, SystemTerms.Learner),
      context_type: contextType,
      context_meta: contextMeta,
      session_mode: sessionMode || "text",
    };

    const response = await authenticatedAxiosInstance.post<InitSessionResponse>(
      `${this.baseUrl}/chat-agent/session/init`,
      request,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 second timeout
      },
    );

    return response.data;
  }

  /**
   * Headers for the stream request. The token is refreshed through the shared
   * HTTP client (a cheap /whoami call) rather than here: that client is the one
   * place that rotates refresh tokens, and two refreshes racing would log the
   * learner out.
   */
  private async streamHeaders(): Promise<Record<string, string>> {
    let token = await getTokenFromStorage(TokenKey.accessToken);
    if (isTokenExpired(token)) {
      try {
        await authenticatedAxiosInstance.get(`${this.baseUrl}/chat-agent/whoami`);
      } catch {
        // Offline or refresh failed — open the stream without a token; the
        // server serves it until auth is enforced, then answers 401.
      }
      token = await getTokenFromStorage(TokenKey.accessToken);
    }
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token && !isTokenExpired(token)) headers.Authorization = `Bearer ${token}`;
    const instituteId = await this.getInstituteId();
    if (instituteId) headers.clientId = instituteId;
    return headers;
  }

  /**
   * Open the session's server-sent-event stream with fetch. EventSource cannot
   * send an Authorization header, so the stream is read and parsed here.
   */
  openStream(sessionId: string, handlers: ChatStreamHandlers): ChatStream {
    const controller = new AbortController();
    let closed = false;
    const url = `${this.baseUrl}/chat-agent/session/${sessionId}/stream`;

    const dispatch = (block: string) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length && !closed) handlers.onEvent(event, data.join("\n"));
    };

    void (async () => {
      try {
        const response = await fetch(url, {
          headers: await this.streamHeaders(),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok || !response.body) {
          if (!closed) handlers.onDisconnect({ status: response.status });
          return;
        }
        if (closed) return;
        handlers.onOpen?.();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.search(/\r?\n\r?\n/);
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
            dispatch(block);
            boundary = buffer.search(/\r?\n\r?\n/);
          }
        }
        if (!closed) handlers.onDisconnect({});
      } catch (error) {
        if (!closed) handlers.onDisconnect({ error });
      }
    })();

    return {
      close: () => {
        closed = true;
        controller.abort();
      },
    };
  }

  async sendMessage(
    sessionId: string,
    message: string,
    intent?: MessageIntent,
    quizSubmission?: QuizSubmission,
    attachments?: Array<{type: string; url: string; mime_type?: string; name?: string}>,
  ): Promise<SendMessageResponse> {
    const request: SendMessageRequest = {
      message,
      idempotency_key: crypto.randomUUID(),
      ...(intent && { intent }),
      ...(quizSubmission && { quiz_submission: quizSubmission }),
      ...(attachments?.length && { attachments }),
    };

    const response = await authenticatedAxiosInstance.post<SendMessageResponse>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/message`,
      request,
    );

    return response.data;
  }

  async closeSession(sessionId: string): Promise<CloseSessionResponse> {
    const response = await authenticatedAxiosInstance.post<CloseSessionResponse>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/close`,
    );

    return response.data;
  }

  /** The learner's own text chats that have at least one question, newest first. */
  async listSessions(limit = 20): Promise<ChatSessionSummary[]> {
    const response = await authenticatedAxiosInstance.get<ListSessionsResponse>(
      `${this.baseUrl}/chat-agent/sessions`,
      { params: { limit } },
    );
    return response.data?.sessions ?? [];
  }

  /** Re-open one of the learner's chats (403 if not theirs, 404 if gone). */
  async resumeSession(sessionId: string): Promise<ResumeSessionResponse> {
    const response = await authenticatedAxiosInstance.post<ResumeSessionResponse>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/resume`,
    );
    return response.data;
  }

  /** Stop the reply being generated: the pending question is marked answered server-side. */
  async stopTurn(sessionId: string): Promise<void> {
    await authenticatedAxiosInstance.post(`${this.baseUrl}/chat-agent/session/${sessionId}/stop`);
  }

  /** Thumbs up / down on an assistant reply; "none" clears it. */
  async sendFeedback(
    sessionId: string,
    messageId: number,
    rating: FeedbackRating,
    comment?: string,
  ): Promise<MessageFeedbackResponse> {
    const response = await authenticatedAxiosInstance.post<MessageFeedbackResponse>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/messages/${messageId}/feedback`,
      { rating, ...(comment ? { comment } : {}) },
    );
    return response.data;
  }

  /** Explicit institute header for endpoints scoped to the learner's institute. */
  private async instituteHeaders(): Promise<Record<string, string>> {
    const instituteId = await this.getInstituteId();
    return instituteId ? { clientId: instituteId } : {};
  }

  /**
   * Personal starters for the empty chat and the launcher peek. Works before a
   * chat exists. Labels come back in the learner's language (Accept-Language).
   */
  async getStarters(contextType?: ContextType, lesson?: string): Promise<ChatStartersResponse> {
    const response = await authenticatedAxiosInstance.get<Partial<ChatStartersResponse>>(
      `${this.baseUrl}/chat-agent/starters`,
      {
        params: {
          ...(contextType && { context_type: contextType }),
          ...(lesson && { lesson: lesson.slice(0, 300) }),
        },
        headers: await this.instituteHeaders(),
        timeout: 15000,
      },
    );
    const data = response.data ?? {};
    const starters = Array.isArray(data.starters)
      ? data.starters.filter(
          (s): s is ChatStarter =>
            !!s && typeof s.label === "string" && typeof s.prompt === "string" && !!s.prompt.trim(),
        )
      : [];
    const peek =
      data.peek && typeof data.peek.text === "string" && typeof data.peek.prompt === "string"
        ? data.peek
        : null;
    const trySaying = Array.isArray(data.try_saying)
      ? data.try_saying.filter((x): x is string => typeof x === "string" && !!x.trim())
      : [];
    return { starters, peek, try_saying: trySaying };
  }

  /** Save (bookmark) or unsave a tutor reply. */
  async setSaved(
    sessionId: string,
    messageId: number,
    saved: boolean,
  ): Promise<{ message_id: number; saved: boolean }> {
    const response = await authenticatedAxiosInstance.post<{ message_id: number; saved: boolean }>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/messages/${messageId}/save`,
      { saved },
    );
    return response.data;
  }

  /** The learner's saved replies across chats, newest first. */
  async listSaved(limit = 50): Promise<SavedAnswer[]> {
    const response = await authenticatedAxiosInstance.get<{ saved?: SavedAnswer[] }>(
      `${this.baseUrl}/chat-agent/saved`,
      { params: { limit }, headers: await this.instituteHeaders() },
    );
    return Array.isArray(response.data?.saved) ? response.data.saved : [];
  }

  /** A tutor reply as audio segments (base64), to be played in order. */
  async getReplySpeech(sessionId: string, messageId: number): Promise<ReplySpeechSegment[]> {
    const response = await authenticatedAxiosInstance.post<{ segments?: ReplySpeechSegment[] }>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/messages/${messageId}/speech`,
      undefined,
      { timeout: 60000 },
    );
    return Array.isArray(response.data?.segments)
      ? response.data.segments.filter((s) => !!s?.audio_base64)
      : [];
  }

  async sendAudioMessage(
    sessionId: string,
    audioBlob: Blob,
    language: string = "en-IN",
  ): Promise<{ transcript: string; message_id: number }> {
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    formData.append("language", language);
    const response = await authenticatedAxiosInstance.post(
      `${this.baseUrl}/chat-agent/session/${sessionId}/audio-message`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" }, timeout: 30000 }
    );
    return response.data;
  }

  getVoiceWebSocketUrl(sessionId: string): string {
    const wsBase = this.baseUrl.replace("https://", "wss://").replace("http://", "ws://");
    return `${wsBase}/chat-agent/session/${sessionId}/voice`;
  }

  async updateContext(
    sessionId: string,
    contextType: ContextType,
    contextMeta: ContextMeta,
  ): Promise<UpdateContextResponse> {
    const request: UpdateContextRequest = {
      context_type: contextType,
      context_meta: contextMeta,
    };

    const response = await authenticatedAxiosInstance.put<UpdateContextResponse>(
      `${this.baseUrl}/chat-agent/session/${sessionId}/context`,
      request,
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  }
}

export const chatbotAPI = new ChatbotAPIService();
