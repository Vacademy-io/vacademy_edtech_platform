/**
 * Site Assistant — the public AI chatbot on an institute's website (hosted
 * catalogue sites and, through public/site-assistant.js, the institute's own
 * site). Contracts mirror docs/site-assistant/SPEC.md §1 (settings), §4.1
 * (visitor API) and §4.4 (cards); names are binding there.
 */

// ── §1 settings: globalSettings.siteAssistant ─────────────────────────────

export type SiteAssistantPersona = "warm" | "formal" | "friendly" | "concise";
export type SiteAssistantPlacementMode = "all" | "catalogue_and_courses" | "routes";
export type SiteAssistantPosition = "bottom-right" | "bottom-left";

export interface SiteAssistantSettings {
  enabled: boolean;
  name: string | null;
  avatarUrl: string | null;
  greeting: string | null;
  persona: SiteAssistantPersona;
  suggestions: string[];
  placement: { mode: SiteAssistantPlacementMode; routes: string[] };
  position: SiteAssistantPosition;
  accentColor: string | null;
  leads: { campaignId: string | null; consentText: string | null };
  support: {
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    loginUrl: string | null;
  };
  embed: { enabled: boolean };
}

// ── §4.1 visitor API ───────────────────────────────────────────────────────

export interface SiteAssistantPageContext {
  url: string;
  route: string;
  title: string;
  course_id?: string;
}

/** `assistant` block of POST /sessions. */
export interface SiteAssistantInfo {
  name: string | null;
  avatar_url: string | null;
  greeting: string | null;
  suggestions: string[];
  accent_color: string | null;
  position: SiteAssistantPosition | null;
  persona: SiteAssistantPersona | null;
}

/**
 * One stored turn, as POST /sessions (resume) and GET /sessions/{id} return
 * it. The spec leaves the row shape open; the client accepts `content` or
 * `text`, and `message_id` or `id` (see normalizeHistory in api.ts).
 */
export interface SiteAssistantHistoryItem {
  role: "user" | "assistant";
  content: string;
  cards: SiteAssistantCard[];
  message_id: string | null;
  answered: boolean | null;
  feedback: 1 | -1 | null;
}

export interface SiteAssistantSession {
  session_id: string;
  token: string;
  expires_at: string | null;
  assistant: SiteAssistantInfo;
  history: SiteAssistantHistoryItem[];
}

export interface CreateSessionBody {
  site_tag: string;
  page: SiteAssistantPageContext;
  visitor_id?: string;
  resume_session_id?: string;
  /** Extra to the spec: the site language the visitor is reading (conversation.locale). */
  locale?: string;
  /** Extra to the spec: first-touch UTM tags (conversation.utm). */
  utm?: Record<string, string>;
}

export interface SendMessageBody {
  text: string;
  page: SiteAssistantPageContext;
  client_msg_id: string;
}

export type ContactKind = "SALES" | "SUPPORT";

export interface ContactBody {
  kind: ContactKind;
  full_name: string;
  email?: string;
  phone?: string;
  fields: Record<string, string | boolean>;
  consent: true;
  course_ids?: string[];
}

export type SiteAssistantErrorCode =
  | "rate_limited"
  | "daily_cap"
  | "no_credits"
  | "disabled"
  | "invalid"
  | "internal"
  /** The website is not one the assistant serves (unknown host, origin not verified, bad key). */
  | "not_allowed"
  /** The chat was closed on the server; a new one has to be started. */
  | "closed"
  /** The session token was refused (expired / not ours). */
  | "unauthorized"
  /** Client-side only: the network dropped or the stream ended early. */
  | "network";

// ── SSE events ────────────────────────────────────────────────────────────

export type SiteAssistantStreamEvent =
  | { type: "token"; text: string }
  | { type: "card"; card: SiteAssistantCard }
  | { type: "done"; message_id: string | null; answered: boolean; billed: boolean }
  | { type: "error"; code: SiteAssistantErrorCode; message: string };

// ── §4.4 cards ─────────────────────────────────────────────────────────────

export interface CourseCardData {
  id: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  price_label?: string | null;
  url: string;
  badges?: string[];
  languages?: string[];
  format_labels?: string[];
  availability?: string | null;
}

export interface LiveClassItem {
  title: string;
  starts_at: string;
  ends_at?: string | null;
  timezone?: string | null;
  is_paid?: boolean;
  price_label?: string | null;
  registration_url?: string | null;
}

export interface ContactFormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export type SiteAssistantCard =
  | ({ type: "course" } & CourseCardData)
  | { type: "course_list"; items: CourseCardData[]; more_url?: string | null }
  | { type: "compare"; rows: { label: string; values: string[] }[]; courses: CourseCardData[] }
  | {
      type: "path";
      name: string;
      steps: { position: number; title: string; url?: string | null; price_label?: string | null }[];
    }
  | { type: "page_link"; title: string; href: string; section_id?: string | null; snippet?: string | null }
  | { type: "live_class_list"; items: LiveClassItem[] }
  | { type: "notice"; title: string; body: string; ends_at?: string | null }
  | {
      type: "contact_info";
      email?: string | null;
      phone?: string | null;
      whatsapp?: string | null;
      address?: string | null;
      login_url?: string | null;
    }
  | {
      type: "contact_form";
      kind: ContactKind;
      reason?: string | null;
      campaign_id?: string | null;
      fields: ContactFormField[];
      consent_text?: string | null;
      /** Optional extra: the courses the offer was about (sent back on submit). */
      course_ids?: string[];
    };

export type SiteAssistantCardType = SiteAssistantCard["type"];

// ── UI state ───────────────────────────────────────────────────────────────

export interface SiteAssistantChatMessage {
  /** Stable client key. */
  localId: string;
  role: "user" | "assistant";
  text: string;
  cards: SiteAssistantCard[];
  /** Server id from `done` (or history); needed for thumbs. */
  messageId: string | null;
  answered: boolean | null;
  feedback: 1 | -1 | null;
  /** Assistant turn still streaming. */
  pending: boolean;
  error: { code: SiteAssistantErrorCode; message: string } | null;
  /** For a user turn: idempotency key, reused by Retry. */
  clientMsgId?: string;
}
