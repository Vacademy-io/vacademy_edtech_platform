import { BASE_URL } from "@/constants/urls";
import { createSseParser, toErrorCode, toStreamEvent } from "./sse";
import { normalizeCard } from "./cards-normalize";
import type {
  ContactBody,
  CreateSessionBody,
  SendMessageBody,
  SiteAssistantCard,
  SiteAssistantErrorCode,
  SiteAssistantHistoryItem,
  SiteAssistantInfo,
  SiteAssistantPersona,
  SiteAssistantSession,
  SiteAssistantStreamEvent,
} from "./types";

/**
 * Typed client for the visitor API (SPEC §4.1). Plain fetch — no axios
 * interceptors: these calls carry the assistant's own session token, never the
 * learner's refresh cycle, and the message call streams.
 */

/** Read at call time, not import time (pages that import the widget load without it). */
export const siteAssistantApiBase = (): string => `${BASE_URL}/ai-service/site-assistant/v1`;

export class SiteAssistantApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: SiteAssistantErrorCode,
    message: string,
  ) {
    super(message || code);
    this.name = "SiteAssistantApiError";
  }
}

const codeForStatus = (status: number): SiteAssistantErrorCode => {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 402) return "no_credits";
  if (status === 403) return "disabled";
  if (status === 400 || status === 404 || status === 409 || status === 422) return "invalid";
  return "internal";
};

/** FastAPI error bodies: {detail: "…"} or {detail: {code, message}} or {code, message}. */
export const errorFromResponse = async (res: Response): Promise<SiteAssistantApiError> => {
  let code: SiteAssistantErrorCode = codeForStatus(res.status);
  let message = "";
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const detail = body?.detail;
    const inner = (detail && typeof detail === "object" ? detail : body) as Record<string, unknown>;
    if (typeof inner?.code === "string" && res.status !== 401) code = toErrorCode(inner.code, code);
    if (typeof inner?.message === "string") message = inner.message;
    else if (typeof detail === "string") message = detail;
  } catch {
    // Not JSON (a proxy page): keep the status mapping.
  }
  return new SiteAssistantApiError(res.status, code, message);
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const PERSONAS: SiteAssistantPersona[] = ["warm", "formal", "friendly", "concise"];

export const normalizeAssistant = (raw: unknown): SiteAssistantInfo => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    name: str(o.name),
    avatar_url: str(o.avatar_url),
    greeting: str(o.greeting),
    suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(str).filter((x): x is string => !!x).slice(0, 6) : [],
    accent_color: str(o.accent_color),
    position: o.position === "bottom-left" ? "bottom-left" : o.position === "bottom-right" ? "bottom-right" : null,
    persona: PERSONAS.includes(o.persona as SiteAssistantPersona) ? (o.persona as SiteAssistantPersona) : null,
  };
};

/** History rows: accept `content` or `text`, `message_id` or `id`; drop tool rows. */
export const normalizeHistory = (raw: unknown): SiteAssistantHistoryItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): SiteAssistantHistoryItem[] => {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (o.role !== "user" && o.role !== "assistant") return [];
    const content = typeof o.content === "string" ? o.content : typeof o.text === "string" ? o.text : "";
    const cards = (Array.isArray(o.cards) ? o.cards : [])
      .map(normalizeCard)
      .filter((c): c is SiteAssistantCard => !!c);
    if (!content && !cards.length) return [];
    const id = o.message_id ?? o.id;
    return [
      {
        role: o.role,
        content,
        cards,
        message_id: typeof id === "string" || typeof id === "number" ? String(id) : null,
        answered: typeof o.answered === "boolean" ? o.answered : null,
        feedback: o.feedback === 1 || o.feedback === -1 ? o.feedback : null,
      },
    ];
  });
};

export const normalizeSession = (raw: unknown): SiteAssistantSession => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sessionId = str(o.session_id);
  const token = str(o.token);
  if (!sessionId || !token) throw new SiteAssistantApiError(200, "internal", "Malformed session response");
  return {
    session_id: sessionId,
    token,
    expires_at: str(o.expires_at),
    assistant: normalizeAssistant(o.assistant),
    history: normalizeHistory(o.history),
  };
};

export interface SiteAssistantApi {
  createSession: (body: CreateSessionBody, init?: { learnerToken?: string | null }) => Promise<SiteAssistantSession>;
  /** Streams one answer. Resolves when the stream ends; every outcome arrives through onEvent. */
  streamMessage: (
    sessionId: string,
    token: string,
    body: SendMessageBody,
    onEvent: (event: SiteAssistantStreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  contact: (sessionId: string, token: string, body: ContactBody) => Promise<{ status: string }>;
  feedback: (sessionId: string, token: string, messageId: string, rating: 1 | -1) => Promise<void>;
  getSession: (sessionId: string, token: string) => Promise<SiteAssistantHistoryItem[]>;
}

export const createSiteAssistantApi = (
  baseOverride?: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): SiteAssistantApi => {
  let resolvedBase = baseOverride;
  const baseUrl = () => (resolvedBase ??= siteAssistantApiBase());
  const json = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const sid = (id: string) => encodeURIComponent(id);

  return {
    async createSession(body, init) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (init?.learnerToken) headers.Authorization = `Bearer ${init.learnerToken}`;
      const res = await fetchImpl(`${baseUrl()}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        credentials: "omit",
      });
      return normalizeSession(await json<unknown>(res));
    },

    async streamMessage(sessionId, token, body, onEvent, signal) {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl()}/sessions/${sid(sessionId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...auth(token) },
          body: JSON.stringify(body),
          credentials: "omit",
          cache: "no-store",
          signal,
        });
      } catch (err) {
        if (signal?.aborted) return;
        throw new SiteAssistantApiError(0, "network", String((err as Error)?.message || ""));
      }
      if (!res.ok) throw await errorFromResponse(res);
      // A guard can answer with plain JSON (a canned reply) instead of a stream.
      const type = res.headers.get("content-type") || "";
      if (!type.includes("text/event-stream") && type.includes("application/json")) {
        const payload = (await res.json()) as Record<string, unknown>;
        if (typeof payload?.code === "string") {
          onEvent({ type: "error", code: toErrorCode(payload.code), message: String(payload.message || "") });
        }
        return;
      }
      if (!res.body) throw new SiteAssistantApiError(res.status, "network", "Empty stream");

      let finished = false;
      const parser = createSseParser((raw) => {
        const event = toStreamEvent(raw);
        if (!event) return;
        if (event.type === "done" || event.type === "error") finished = true;
        onEvent(event);
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.end();
      } catch (err) {
        if (signal?.aborted) return;
        if (!finished) throw new SiteAssistantApiError(0, "network", String((err as Error)?.message || ""));
      }
      if (!finished && !signal?.aborted) {
        throw new SiteAssistantApiError(0, "network", "Stream ended early");
      }
    },

    async contact(sessionId, token, body) {
      const res = await fetchImpl(`${baseUrl()}/sessions/${sid(sessionId)}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...auth(token) },
        body: JSON.stringify(body),
        credentials: "omit",
      });
      const out = await json<Record<string, unknown>>(res);
      return { status: typeof out?.status === "string" ? out.status : "received" };
    },

    async feedback(sessionId, token, messageId, rating) {
      const res = await fetchImpl(`${baseUrl()}/sessions/${sid(sessionId)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth(token) },
        body: JSON.stringify({ message_id: messageId, rating }),
        credentials: "omit",
      });
      if (!res.ok) throw await errorFromResponse(res);
    },

    async getSession(sessionId, token) {
      const res = await fetchImpl(`${baseUrl()}/sessions/${sid(sessionId)}`, {
        headers: { Accept: "application/json", ...auth(token) },
        credentials: "omit",
      });
      const out = await json<Record<string, unknown>>(res);
      return normalizeHistory(Array.isArray(out) ? out : out?.history);
    },
  };
};
