import type {
  ContactFormField,
  CourseCardData,
  LiveClassItem,
  SiteAssistantCard,
} from "./types";
import { safeHref, safeImageUrl } from "./links";
import { stripInstSuffix } from "./contact-form";

/**
 * Card JSON from the stream → a typed card, or null. The engine builds cards
 * from tool results, but the client still checks every field it renders: an
 * href that is not https/site-relative is dropped (the card loses its button,
 * or the whole card when the link IS the card), strings are strings, lists
 * are lists. Unknown card types are ignored.
 */

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const s = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const strList = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map(s).filter((x): x is string => !!x).slice(0, max) : [];

export const normalizeCourse = (raw: unknown): CourseCardData | null => {
  const o = asObj(raw);
  if (!o) return null;
  const id = s(o.id);
  const title = s(o.title);
  const url = safeHref(o.url);
  if (!id || !title || !url) return null;
  return {
    id,
    title,
    subtitle: s(o.subtitle),
    image_url: safeImageUrl(o.image_url),
    price_label: s(o.price_label),
    url,
    badges: strList(o.badges, 3),
    languages: strList(o.languages, 4),
    format_labels: strList(o.format_labels, 3),
    availability: s(o.availability),
  };
};

const normalizeLiveClass = (raw: unknown): LiveClassItem | null => {
  const o = asObj(raw);
  if (!o) return null;
  const title = s(o.title);
  const startsAt = s(o.starts_at);
  if (!title || !startsAt || Number.isNaN(Date.parse(startsAt))) return null;
  return {
    title,
    starts_at: startsAt,
    ends_at: s(o.ends_at),
    timezone: s(o.timezone),
    is_paid: o.is_paid === true,
    price_label: s(o.price_label),
    registration_url: safeHref(o.registration_url),
  };
};

const FIELD_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

const normalizeField = (raw: unknown): ContactFormField | null => {
  const o = asObj(raw);
  if (!o) return null;
  // A long admin_core key ("…_inst_<instituteId>") loses the suffix instead of the whole field;
  // the server maps the short key back to the campaign's field.
  const rawKey = s(o.key);
  const key = rawKey ? stripInstSuffix(rawKey) : null;
  const label = s(o.label) ?? key;
  if (!key || !FIELD_KEY.test(key) || !label) return null;
  return {
    key,
    label,
    type: (s(o.type) || "text").toLowerCase(),
    required: o.required === true,
    options: strList(o.options, 50),
  };
};

export const normalizeCard = (raw: unknown): SiteAssistantCard | null => {
  const o = asObj(raw);
  if (!o) return null;
  switch (o.type) {
    case "course": {
      const c = normalizeCourse(o);
      return c ? { type: "course", ...c } : null;
    }
    case "course_list": {
      const items = (Array.isArray(o.items) ? o.items : []).map(normalizeCourse).filter((x): x is CourseCardData => !!x);
      return items.length ? { type: "course_list", items: items.slice(0, 6), more_url: safeHref(o.more_url) } : null;
    }
    case "compare": {
      const courses = (Array.isArray(o.courses) ? o.courses : [])
        .map(normalizeCourse)
        .filter((x): x is CourseCardData => !!x)
        .slice(0, 3);
      const rows = (Array.isArray(o.rows) ? o.rows : [])
        .map((r) => {
          const row = asObj(r);
          const label = s(row?.label);
          if (!row || !label) return null;
          const values = Array.isArray(row.values) ? row.values.map((v) => s(v) ?? "—") : [];
          return { label, values };
        })
        .filter((x): x is { label: string; values: string[] } => !!x);
      return courses.length >= 2 && rows.length ? { type: "compare", rows, courses } : null;
    }
    case "path": {
      const name = s(o.name);
      const steps = (Array.isArray(o.steps) ? o.steps : [])
        .map((st, i) => {
          const step = asObj(st);
          const title = s(step?.title);
          if (!step || !title) return null;
          const position = typeof step.position === "number" ? step.position : i + 1;
          return { position, title, url: safeHref(step.url), price_label: s(step.price_label) };
        })
        .filter((x): x is { position: number; title: string; url: string | null; price_label: string | null } => !!x)
        .sort((a, b) => a.position - b.position);
      return name && steps.length ? { type: "path", name, steps } : null;
    }
    case "page_link": {
      const title = s(o.title);
      const href = safeHref(o.href);
      return title && href ? { type: "page_link", title, href, section_id: s(o.section_id), snippet: s(o.snippet) } : null;
    }
    case "live_class_list": {
      const items = (Array.isArray(o.items) ? o.items : [])
        .map(normalizeLiveClass)
        .filter((x): x is LiveClassItem => !!x);
      return items.length ? { type: "live_class_list", items: items.slice(0, 5) } : null;
    }
    case "notice": {
      const title = s(o.title);
      const body = s(o.body);
      return title && body ? { type: "notice", title, body, ends_at: s(o.ends_at) } : null;
    }
    case "contact_info": {
      const card = {
        type: "contact_info" as const,
        email: s(o.email),
        phone: s(o.phone),
        whatsapp: s(o.whatsapp),
        address: s(o.address),
        login_url: safeHref(o.login_url),
      };
      return card.email || card.phone || card.whatsapp || card.address || card.login_url ? card : null;
    }
    case "contact_form": {
      const kind = o.kind === "SUPPORT" ? "SUPPORT" : "SALES";
      const fields = (Array.isArray(o.fields) ? o.fields : [])
        .map(normalizeField)
        .filter((x): x is ContactFormField => !!x)
        .slice(0, 12);
      return {
        type: "contact_form",
        kind,
        reason: s(o.reason),
        campaign_id: s(o.campaign_id),
        fields,
        consent_text: s(o.consent_text),
        course_ids: strList(o.course_ids, 5),
      };
    }
    default:
      return null;
  }
};
