import { useCallback, useEffect, useRef, useState } from "react";
import { AI_SERVICE_URL } from "@/constants/urls";
import { getTokenFromCookie } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { parseAiUsageLimitBody, type AiUsageLimitBody } from "@/lib/ai-usage-limit";

export type TutorBoardOp = Record<string, unknown> & { op: string; id?: string; target?: string };

export interface TutorStateEvent {
  slide_id: string;
  topic_id: string | null;
  topic_title: string | null;
  concept_id: string | null;
  concept_title: string | null;
  phase: string;
  progress: { done: number; total: number; percent: number; topic_index: number; topic_count: number };
  language: "en" | "hi";
  remediations: number;
}

export interface TutorCheckEvent {
  concept_id: string | null;
  check_type: string | null;
  prompt: string | null;
  options: string[];
  remediation: number;
  /** A fresh question on a concept the learner found hard earlier (one attempt). */
  revisit?: boolean;
  /** A guess the teacher asks for before the board appears (never graded). */
  predict?: boolean;
}

/** What a teacher line is: a verdict carries a score, a note the concept it closes. */
export interface TutorSayMeta {
  kind?: string;
  score?: number | null;
  concept_id?: string | null;
  cleared?: boolean;
}

export type TutorPace = "slower" | "slow" | "normal" | "fast";

export interface TutorLessonEvent {
  slide_id: string;
  slide_title: string;
  resumed: boolean;
  topics: Array<{ id: string; title: string; concepts: number }>;
  progress: { done: number; total: number; percent: number };
}

export interface TutorQuizResult {
  question_id: string;
  question_name: string;
  answered: boolean;
  correct: boolean;
  answer: string;
  selected_option_ids: string[];
  correct_option_ids: string[];
  options: Array<{ id: string; name: string }>;
  score: number | null;
  skipped: boolean;
}

export interface TutorSlideDoneEvent {
  slide_id: string;
  weak_concepts: string[];
  skipped_concepts: string[];
  done: number;
  total: number;
  /** Quiz slides only: what to write to the quiz activity log. */
  quiz_results?: TutorQuizResult[];
}

interface Callbacks {
  onReady?: (ev: Record<string, unknown>) => void;
  /** After next_slide: the new slide's topics and progress. */
  onLesson?: (ev: TutorLessonEvent) => void;
  onState?: (ev: TutorStateEvent) => void;
  /** `replay` = the board being restored on resume (show at once, no writing animation pacing). */
  onBoard?: (ops: TutorBoardOp[], clear: boolean, live: boolean, topicId?: string | null, replay?: boolean) => void;
  onAiText?: (text: string, meta: TutorSayMeta) => void;
  /** The sentence(s) the next audio segment speaks (voice mode), with their index in the narration. */
  onSegmentText?: (text: string, index: number, count: number) => void;
  /** A short silence before a question. */
  onBeat?: (ms: number) => void;
  /** The teacher's pace changed (a control word or the pace picker). */
  onPace?: (pace: TutorPace) => void;
  onAudioChunk?: (base64: string) => void;
  onAudioSegmentEnd?: () => void;
  onAudioEnd?: (reason: string, detail?: string) => void;
  onCheck?: (ev: TutorCheckEvent) => void;
  onAwait?: (what: "continue" | "answer" | "done") => void;
  onTranscriptFinal?: (text: string) => void;
  onSlideDone?: (ev: TutorSlideDoneEvent) => void;
  onSummary?: (data: unknown) => void;
  /** `fatal` frames end the session (auth, missing plan); the rest are transient notices. */
  onError?: (message: string, fatal: boolean) => void;
  /** The server closed the session on its own (idle, time limit). */
  onEnded?: (reason: string) => void;
  /**
   * An AI usage limit stopped the lesson (`{"type":"usage_limit", …}`, the same
   * body as the HTTP 429). The server closes the socket right after.
   */
  onUsageLimit?: (body: AiUsageLimitBody) => void;
  onClose?: () => void;
  /** Guest lessons: the token to authenticate with instead of the signed-in user's. */
  getToken?: () => string | null | undefined;
}

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

function wsUrl(socketPath: string): string {
  let base = AI_SERVICE_URL;
  if (base.startsWith("https://")) base = "wss://" + base.slice("https://".length);
  else if (base.startsWith("http://")) base = "ws://" + base.slice("http://".length);
  return `${base}${socketPath}`;
}

function readToken(): string {
  try {
    return getTokenFromCookie(TokenKey.accessToken) || localStorage.getItem(TokenKey.accessToken) || "";
  } catch {
    return "";
  }
}

/**
 * Tutor socket client (design §6.2). The server requires an `auth` frame
 * first; everything else is a small JSON message. Callbacks are read through a
 * ref so the socket never holds a stale closure.
 */
export function useTutorSocket(callbacks: Callbacks) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentionalRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
    wsRef.current = null;
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const connect = useCallback(
    (socketPath: string) => {
      cleanup();
      intentionalRef.current = false;
      setConnectionState("connecting");
      const ws = new WebSocket(wsUrl(socketPath));
      wsRef.current = ws;
      ws.onopen = () => {
        // `hold`: the server sends `ready` but keeps the teacher quiet until
        // `begin` — the face and the audio get to be on screen first.
        ws.send(JSON.stringify({ type: "auth", token: cbRef.current.getToken?.() || readToken(), hold: true }));
        setConnectionState("connected");
        pingRef.current = setInterval(() => send({ type: "ping" }), 25000);
      };
      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }
        const cb = cbRef.current;
        switch (msg.type) {
          case "ready":
            cb.onReady?.(msg);
            break;
          case "lesson":
            cb.onLesson?.(msg as unknown as TutorLessonEvent);
            break;
          case "ended":
            cb.onEnded?.(String(msg.reason ?? "ended"));
            break;
          case "state":
            cb.onState?.(msg as unknown as TutorStateEvent);
            break;
          case "board":
            cb.onBoard?.((msg.ops as TutorBoardOp[]) || [], !!msg.clear, !!msg.live, msg.topic_id as string | null, !!msg.replay);
            break;
          case "ai_text":
            cb.onAiText?.(String(msg.text ?? ""), (msg.meta as TutorSayMeta) || {});
            break;
          case "segment_text":
            cb.onSegmentText?.(String(msg.text ?? ""), Number(msg.index ?? 0), Number(msg.count ?? 1));
            break;
          case "beat":
            cb.onBeat?.(Number(msg.ms ?? 400));
            break;
          case "pace":
            cb.onPace?.(String(msg.pace) as TutorPace);
            break;
          case "audio_chunk":
            cb.onAudioChunk?.(String(msg.data ?? ""));
            break;
          case "audio_segment_end":
            cb.onAudioSegmentEnd?.();
            break;
          case "audio_end":
            cb.onAudioEnd?.(String(msg.reason ?? "complete"), msg.detail as string | undefined);
            break;
          case "check":
            cb.onCheck?.(msg as unknown as TutorCheckEvent);
            break;
          case "await":
            cb.onAwait?.(msg.what as "continue" | "answer" | "done");
            break;
          case "transcript_final":
            cb.onTranscriptFinal?.(String(msg.text ?? ""));
            break;
          case "slide_done":
            cb.onSlideDone?.(msg as unknown as TutorSlideDoneEvent);
            break;
          case "summary":
            cb.onSummary?.(msg.data);
            break;
          case "error":
            cb.onError?.(String(msg.message ?? "Error"), !!msg.fatal);
            break;
          case "usage_limit": {
            // Older servers never send it; a malformed frame still ends politely.
            const body = parseAiUsageLimitBody(msg) ?? { ...msg, error: "AI_USAGE_LIMIT" as const };
            cb.onUsageLimit?.(body as AiUsageLimitBody);
            break;
          }
          default:
            break;
        }
      };
      ws.onerror = () => setConnectionState("error");
      ws.onclose = () => {
        setConnectionState("disconnected");
        if (pingRef.current) {
          clearInterval(pingRef.current);
          pingRef.current = null;
        }
        if (!intentionalRef.current) cbRef.current.onClose?.();
      };
    },
    [cleanup, send],
  );

  const disconnect = useCallback(() => {
    intentionalRef.current = true;
    cleanup();
    setConnectionState("disconnected");
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    connectionState,
    connect,
    disconnect,
    /** The device can show and play the teacher: open the lesson. */
    sendBegin: () => send({ type: "begin" }),
    sendContinue: () => send({ type: "continue" }),
    sendAnswer: (text: string) => send({ type: "answer", text }),
    sendAsk: (text: string) => send({ type: "ask", text }),
    sendControl: (intent: "repeat" | "skip" | "slower" | "faster" | "doubt" | "pause" | "resume" | "done") =>
      send({ type: "control", intent }),
    sendConfig: (cfg: { language?: "en" | "hi"; speak?: boolean; pace?: TutorPace; avatar?: boolean }) => send({ type: "config", ...cfg }),
    sendNextSlide: (slideId: string) => send({ type: "next_slide", slide_id: slideId }),
    sendAudioChunk: (base64: string) => send({ type: "audio_chunk", data: base64 }),
    sendAudioEnd: (mime?: string) => send({ type: "audio_end", mime: mime || "audio/webm" }),
    sendAudioDiscard: () => send({ type: "audio_discard" }),
    sendInterrupt: () => send({ type: "interrupt" }),
    sendEndSession: () => send({ type: "end_session" }),
    // Activeness tracker (opt-in camera): the learner left / came back, and the
    // running session average. Neither counts as activity on the server.
    sendPresence: (present: boolean, interrupted = false) => send({ type: "presence", present, interrupted }),
    sendActiveness: (report: Record<string, unknown>) => send({ type: "activeness", ...report }),
    // Premium avatar device report (tier, renderer, timings, step-downs) for the lesson summary.
    sendAvatarDiag: (diag: Record<string, string | number>) => send({ type: "avatar_diag", ...diag }),
  };
}
