import { createStore, type StoreApi } from "zustand/vanilla";
import { SiteAssistantApiError, type SiteAssistantApi } from "./api";
import { randomId } from "./storage";
import type {
  ContactBody,
  SiteAssistantCard,
  SiteAssistantChatMessage,
  SiteAssistantErrorCode,
  SiteAssistantHistoryItem,
  SiteAssistantInfo,
  SiteAssistantPageContext,
  SiteAssistantSession,
} from "./types";

/**
 * One conversation's state and actions, outside React: the hosted widget is
 * remounted on every catalogue navigation (catalogue page → course page are
 * different trees), and "Take me there" must not lose the chat or cut an
 * answer that is still streaming. Hosted controllers are kept per site (see
 * getHostedController); the embed page owns exactly one.
 */

export const MAX_MESSAGE_CHARS = 1000;

export interface SessionSource {
  /** The conversation to talk in (hosted: create or resume; embed: handed over by the loader). */
  get: () => Promise<SiteAssistantSession>;
  /** A fresh one after the token was refused (expired, revoked). */
  refresh: () => Promise<SiteAssistantSession>;
}

export interface SiteAssistantState {
  open: boolean;
  status: "idle" | "connecting" | "ready" | "failed";
  failure: SiteAssistantErrorCode | null;
  sessionId: string | null;
  assistant: SiteAssistantInfo | null;
  messages: SiteAssistantChatMessage[];
  streaming: boolean;
  /** Contact forms already sent, by card key — survives remounts. */
  contactDone: Record<string, true>;
}

export interface SiteAssistantController {
  store: StoreApi<SiteAssistantState>;
  setOpen: (open: boolean) => void;
  connect: () => Promise<void>;
  send: (text: string) => Promise<void>;
  retry: (assistantLocalId: string) => Promise<void>;
  rate: (localId: string, rating: 1 | -1) => Promise<void>;
  submitContact: (cardKey: string, body: ContactBody) => Promise<string>;
  /** Replaces the session (embed: the loader re-issued one). */
  adoptSession: (session: SiteAssistantSession) => void;
}

export interface ControllerDeps {
  api: SiteAssistantApi;
  source: SessionSource;
  getPage: () => SiteAssistantPageContext;
  onSession?: (session: SiteAssistantSession) => void;
}

export const historyToMessages = (history: SiteAssistantHistoryItem[]): SiteAssistantChatMessage[] =>
  history.map((h) => ({
    localId: randomId(),
    role: h.role,
    text: h.content,
    cards: h.cards,
    messageId: h.message_id,
    answered: h.answered,
    feedback: h.feedback,
    pending: false,
    error: null,
  }));

const initialState = (): SiteAssistantState => ({
  open: false,
  status: "idle",
  failure: null,
  sessionId: null,
  assistant: null,
  messages: [],
  streaming: false,
  contactDone: {},
});

/** Errors that mean "talk to a person instead" — they get a contact card. */
export const CONTACT_FALLBACK_CODES: SiteAssistantErrorCode[] = ["rate_limited", "daily_cap", "no_credits"];

/** The token was refused or the chat was closed: a fresh session (same client_msg_id) is the fix. */
const needsNewSession = (code: SiteAssistantErrorCode) => code === "unauthorized" || code === "closed";

export const createSiteAssistantController = (deps: ControllerDeps): SiteAssistantController => {
  const store = createStore<SiteAssistantState>(() => initialState());
  let token: string | null = null;
  let connecting: Promise<void> | null = null;
  let seeded = false;

  const patchMessage = (localId: string, patch: (m: SiteAssistantChatMessage) => Partial<SiteAssistantChatMessage>) =>
    store.setState((s) => ({
      messages: s.messages.map((m) => (m.localId === localId ? { ...m, ...patch(m) } : m)),
    }));

  const adoptSession = (session: SiteAssistantSession) => {
    token = session.token;
    deps.onSession?.(session);
    const firstSession = !seeded;
    seeded = true;
    store.setState((s) => ({
      status: "ready",
      failure: null,
      sessionId: session.session_id,
      assistant: session.assistant,
      // History (a resumed conversation) goes in once, ahead of anything the
      // visitor typed while it loaded; a re-issued session never duplicates
      // what is already on screen.
      messages: firstSession ? [...historyToMessages(session.history), ...s.messages] : s.messages,
    }));
  };

  const connect = (): Promise<void> => {
    if (token && store.getState().status === "ready") return Promise.resolve();
    if (connecting) return connecting;
    store.setState({ status: "connecting", failure: null });
    connecting = deps.source
      .get()
      .then(adoptSession)
      .catch((err: unknown) => {
        const code = err instanceof SiteAssistantApiError ? err.code : "network";
        store.setState({ status: "failed", failure: code });
      })
      .finally(() => {
        connecting = null;
      });
    return connecting;
  };

  const refreshSession = async (): Promise<boolean> => {
    try {
      adoptSession(await deps.source.refresh());
      return true;
    } catch {
      return false;
    }
  };

  const stream = async (userText: string, clientMsgId: string, assistantId: string) => {
    store.setState({ streaming: true });
    const run = async () => {
      const { sessionId } = store.getState();
      if (!sessionId || !token) throw new SiteAssistantApiError(0, "network", "");
      await deps.api.streamMessage(
        sessionId,
        token,
        { text: userText, page: deps.getPage(), client_msg_id: clientMsgId },
        (event) => {
          switch (event.type) {
            case "token":
              patchMessage(assistantId, (m) => ({ text: m.text + event.text }));
              break;
            case "card":
              patchMessage(assistantId, (m) => ({ cards: [...m.cards, event.card] }));
              break;
            case "done":
              patchMessage(assistantId, () => ({
                pending: false,
                messageId: event.message_id,
                answered: event.answered,
              }));
              break;
            case "error":
              patchMessage(assistantId, () => ({
                pending: false,
                error: { code: event.code, message: event.message },
              }));
              break;
          }
        },
      );
    };
    try {
      try {
        await run();
      } catch (err) {
        // The token expired mid-conversation: get a fresh session and resend
        // the same client_msg_id (the server is idempotent on it).
        if (err instanceof SiteAssistantApiError && needsNewSession(err.code) && (await refreshSession())) {
          patchMessage(assistantId, () => ({ text: "", cards: [], error: null, pending: true }));
          await run();
        } else {
          throw err;
        }
      }
    } catch (err) {
      const code: SiteAssistantErrorCode = err instanceof SiteAssistantApiError ? err.code : "network";
      const message = err instanceof SiteAssistantApiError ? err.message : "";
      patchMessage(assistantId, () => ({ pending: false, error: { code, message } }));
    } finally {
      store.setState({ streaming: false });
    }
  };

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text || store.getState().streaming) return;
    const clientMsgId = randomId();
    const assistantId = randomId();
    store.setState((s) => ({
      messages: [
        ...s.messages,
        {
          localId: randomId(),
          role: "user",
          text,
          cards: [],
          messageId: null,
          answered: null,
          feedback: null,
          pending: false,
          error: null,
          clientMsgId,
        },
        {
          localId: assistantId,
          role: "assistant",
          text: "",
          cards: [],
          messageId: null,
          answered: null,
          feedback: null,
          pending: true,
          error: null,
        },
      ],
    }));
    await connect();
    if (store.getState().status !== "ready") {
      const failure = store.getState().failure ?? "network";
      patchMessage(assistantId, () => ({ pending: false, error: { code: failure, message: "" } }));
      return;
    }
    await stream(text, clientMsgId, assistantId);
  };

  const retry = async (assistantLocalId: string) => {
    const { messages, streaming } = store.getState();
    if (streaming) return;
    const idx = messages.findIndex((m) => m.localId === assistantLocalId);
    const user = idx > 0 ? messages[idx - 1] : undefined;
    if (!user || user.role !== "user" || !user.clientMsgId) return;
    patchMessage(assistantLocalId, () => ({ text: "", cards: [], error: null, pending: true }));
    await connect();
    if (store.getState().status !== "ready") {
      const failure = store.getState().failure ?? "network";
      patchMessage(assistantLocalId, () => ({ pending: false, error: { code: failure, message: "" } }));
      return;
    }
    await stream(user.text, user.clientMsgId, assistantLocalId);
  };

  const rate = async (localId: string, rating: 1 | -1) => {
    const msg = store.getState().messages.find((m) => m.localId === localId);
    const { sessionId } = store.getState();
    if (!msg?.messageId || !sessionId || !token || msg.feedback === rating) return;
    const previous = msg.feedback;
    patchMessage(localId, () => ({ feedback: rating }));
    try {
      await deps.api.feedback(sessionId, token, msg.messageId, rating);
    } catch {
      patchMessage(localId, () => ({ feedback: previous }));
    }
  };

  const submitContact = async (cardKey: string, body: ContactBody): Promise<string> => {
    await connect();
    const { sessionId } = store.getState();
    if (!sessionId || !token) throw new SiteAssistantApiError(0, "network", "");
    let result: { status: string };
    try {
      result = await deps.api.contact(sessionId, token, body);
    } catch (err) {
      if (err instanceof SiteAssistantApiError && needsNewSession(err.code) && (await refreshSession())) {
        result = await deps.api.contact(store.getState().sessionId as string, token as string, body);
      } else {
        throw err;
      }
    }
    store.setState((s) => ({ contactDone: { ...s.contactDone, [cardKey]: true } }));
    return result.status;
  };

  return {
    store,
    setOpen: (open) => store.setState({ open }),
    connect,
    send,
    retry,
    rate,
    submitContact,
    adoptSession,
  };
};

/** True when an assistant turn ended in an error that should offer a person. */
export const needsContactFallback = (m: SiteAssistantChatMessage): boolean =>
  !!m.error && CONTACT_FALLBACK_CODES.includes(m.error.code);

/** The turn already carries a way to reach a person (the server sends one for daily_cap/no_credits). */
export const hasContactCard = (cards: SiteAssistantCard[]): boolean =>
  cards.some((c) => c.type === "contact_info" || c.type === "contact_form");

// ── hosted registry ────────────────────────────────────────────────────────

const hosted = new Map<string, SiteAssistantController>();

/** One controller per hosted site for the life of the tab (see the header comment). */
export const getHostedController = (siteKey: string, create: () => SiteAssistantController): SiteAssistantController => {
  let c = hosted.get(siteKey);
  if (!c) {
    c = create();
    hosted.set(siteKey, c);
  }
  return c;
};
