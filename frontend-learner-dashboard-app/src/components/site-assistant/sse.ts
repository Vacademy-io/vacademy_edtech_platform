import type { SiteAssistantCard, SiteAssistantErrorCode, SiteAssistantStreamEvent } from "./types";
import { normalizeCard } from "./cards-normalize";

/**
 * Server-Sent Events over a fetch() body (POST can't use EventSource).
 *
 * createSseParser is fed decoded text chunks in any split — a chunk boundary
 * may fall inside a field name, a JSON payload or a CRLF pair — and emits one
 * {event, data} per blank-line-terminated block, per the HTML spec's
 * event-stream rules: `data:` lines join with "\n", a single space after the
 * colon is dropped, `:` lines are comments (keep-alives), the event name
 * defaults to "message", a block with no data is not dispatched.
 */

export interface RawSseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  push: (chunk: string) => void;
  /** End of stream: dispatches a final block the server didn't blank-line terminate. */
  end: () => void;
}

export const createSseParser = (onEvent: (event: RawSseEvent) => void): SseParser => {
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let lastId: string | undefined;
  let sawData = false;

  const dispatch = () => {
    if (sawData) {
      onEvent({ event: eventName || "message", data: dataLines.join("\n"), id: lastId });
    }
    eventName = "";
    dataLines = [];
    sawData = false;
  };

  const processLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") {
      dataLines.push(value);
      sawData = true;
    } else if (field === "id") lastId = value;
    // "retry" and unknown fields are ignored.
  };

  const drain = (final: boolean) => {
    for (;;) {
      const nl = buffer.search(/\r\n|\r|\n/);
      if (nl === -1) break;
      // A lone "\r" at the very end may be the first half of "\r\n": wait.
      if (!final && buffer[nl] === "\r" && nl === buffer.length - 1) break;
      const line = buffer.slice(0, nl);
      const sepLen = buffer.startsWith("\r\n", nl) ? 2 : 1;
      buffer = buffer.slice(nl + sepLen);
      processLine(line);
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      drain(false);
    },
    end() {
      drain(true);
      if (buffer) {
        processLine(buffer);
        buffer = "";
      }
      dispatch();
    },
  };
};

const ERROR_CODES: SiteAssistantErrorCode[] = [
  "rate_limited",
  "daily_cap",
  "no_credits",
  "disabled",
  "invalid",
  "internal",
  "not_allowed",
  "closed",
];

/** The ai_service refusal codes (SPEC §4.1 error bodies) that have no event code of their own. */
const SERVER_CODES: Record<string, SiteAssistantErrorCode> = {
  origin_not_allowed: "not_allowed",
  unknown_site: "not_allowed",
  invalid_api_key: "not_allowed",
  not_found: "disabled",
  // "This chat belongs to another session" / an expired token: a fresh session fixes it.
  forbidden: "unauthorized",
  invalid_token: "unauthorized",
};

/** A server code → the client's code; an unknown one → `fallback` (the HTTP status's meaning). */
export const toErrorCode = (raw: unknown, fallback: SiteAssistantErrorCode = "internal"): SiteAssistantErrorCode => {
  if (ERROR_CODES.includes(raw as SiteAssistantErrorCode)) return raw as SiteAssistantErrorCode;
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(SERVER_CODES, raw)) return SERVER_CODES[raw];
  return fallback;
};

const parseJson = (data: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * A raw block → the typed SPEC §4.1 event, or null for anything this client
 * doesn't understand (unknown event names, malformed JSON, invalid cards):
 * one bad frame never kills the answer.
 */
export const toStreamEvent = (raw: RawSseEvent): SiteAssistantStreamEvent | null => {
  const payload = parseJson(raw.data);
  switch (raw.event) {
    case "token": {
      const text = payload?.text;
      return typeof text === "string" && text ? { type: "token", text } : null;
    }
    case "card": {
      // The event data IS the card, flat ({type, ...fields}, SPEC §4.1/§4.4); a
      // `{card: {...}}` wrapper is still read so an older server keeps working.
      const card: SiteAssistantCard | null = normalizeCard(payload?.card ?? payload);
      return card ? { type: "card", card } : null;
    }
    case "done":
      return {
        type: "done",
        message_id:
          typeof payload?.message_id === "string" || typeof payload?.message_id === "number"
            ? String(payload.message_id)
            : null,
        answered: payload?.answered !== false,
        billed: payload?.billed === true,
      };
    case "error":
      return {
        type: "error",
        code: toErrorCode(payload?.code),
        message: typeof payload?.message === "string" ? payload.message : "",
      };
    default:
      return null;
  }
};
