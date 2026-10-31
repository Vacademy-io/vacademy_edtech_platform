/**
 * What the course page shows beyond the course's own fields, read
 * defensively from what the API carries:
 *
 * - course_page_json (admin "Course page" section): the course's mode and
 *   its FAQs — `{"v":1,"mode":"SELF_PACED"|"LIVE"|null,"faqs":[{q,a}]}`.
 * - course_media_id: the preview video behind "Watch preview" (a JSON
 *   `{type, id}` or a plain URL); an image is not a preview.
 * - the course's language, the series chips' short labels.
 *
 * Pure. Anything malformed reads as "nothing to show", never as an error.
 */

export type CourseMode = "SELF_PACED" | "LIVE";

export interface CourseFaq {
  q: string;
  /** Rich text (sanitise at display). */
  a: string;
}

export interface CoursePageContent {
  mode: CourseMode | null;
  faqs: CourseFaq[];
}

const EMPTY: CoursePageContent = { mode: null, faqs: [] };
const MAX_FAQS = 30;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const parseCoursePageJson = (raw: unknown): CoursePageContent => {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return EMPTY;
    try {
      data = JSON.parse(raw);
    } catch {
      return EMPTY;
    }
  }
  if (!isObject(data)) return EMPTY;
  const mode = data.mode === "SELF_PACED" || data.mode === "LIVE" ? data.mode : null;
  const faqs: CourseFaq[] = [];
  if (Array.isArray(data.faqs)) {
    for (const item of data.faqs) {
      if (!isObject(item)) continue;
      const q = text(item.q);
      const a = text(item.a);
      if (q && a) faqs.push({ q, a });
      if (faqs.length >= MAX_FAQS) break;
    }
  }
  return { mode, faqs };
};

export type PreviewVideo =
  | { kind: "youtube"; id: string }
  | { kind: "vimeo"; id: string }
  /** A media-service file id (resolve to a URL) or a direct video URL. */
  | { kind: "file"; id: string }
  | { kind: "url"; url: string };

const YOUTUBE_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/;
const VIMEO_ID = /(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/;
const VIDEO_FILE = /\.(mp4|webm|ogg|mov|m3u8)(\?|#|$)/i;

const fromUrl = (url: string): PreviewVideo | null => {
  const yt = url.match(YOUTUBE_ID);
  if (yt) return { kind: "youtube", id: yt[1]! };
  const vm = url.match(VIMEO_ID);
  if (vm) return { kind: "vimeo", id: vm[1]! };
  if (/^https?:\/\//i.test(url) && VIDEO_FILE.test(url)) return { kind: "url", url };
  return null;
};

/** The course's preview video, or null when its media is an image (or none). */
export const previewVideoOf = (raw: unknown): PreviewVideo | null => {
  const value = text(raw);
  if (!value) return null;
  if (value.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
    if (!isObject(parsed)) return null;
    const type = text(parsed.type).toLowerCase();
    const id = text(parsed.id) || text(parsed.url);
    if (!id) return null;
    if (type === "youtube") {
      const fromLink = fromUrl(id);
      return fromLink?.kind === "youtube" ? fromLink : /^[A-Za-z0-9_-]{6,}$/.test(id) ? { kind: "youtube", id } : null;
    }
    if (type === "vimeo") {
      const fromLink = fromUrl(id);
      return fromLink?.kind === "vimeo" ? fromLink : /^\d+$/.test(id) ? { kind: "vimeo", id } : null;
    }
    if (type === "video") return /^https?:\/\//i.test(id) ? (fromUrl(id) ?? { kind: "url", url: id }) : { kind: "file", id };
    return null;
  }
  return fromUrl(value);
};

/** The embeddable address of a YouTube / Vimeo preview (autoplay once opened). */
export const embedUrlOf = (video: PreviewVideo): string | null => {
  if (video.kind === "youtube") return `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`;
  if (video.kind === "vimeo") return `https://player.vimeo.com/video/${video.id}?autoplay=1`;
  return null;
};

/**
 * The course's language for the facts strip: its version's level when the
 * site names languages that way ("Hindi", "English (UK)"), else a tag that
 * names one of the site's languages, else null.
 */
export const courseLanguageLabel = (input: {
  levelName?: string | null;
  tags?: string[] | null;
  languages: Array<{ code: string; label: string }>;
}): string | null => {
  const langs = input.languages;
  if (!langs.length) return null;
  const level = (input.levelName || "").trim().toLowerCase();
  if (level) {
    const hit = langs.find(
      (l) => level === l.code.toLowerCase() || level === l.label.toLowerCase() || level.split(/[\s()/,-]+/).includes(l.label.toLowerCase()),
    );
    if (hit) return hit.label;
  }
  for (const tag of input.tags || []) {
    const t = tag.trim().toLowerCase();
    const hit = langs.find((l) => t === l.code.toLowerCase() || t === l.label.toLowerCase());
    if (hit) return hit.label;
  }
  return null;
};

/**
 * Series chips name each step briefly: the words every step title starts with
 * ("Holistic Parenting") are dropped, with the separator after them —
 * "Holistic Parenting - Basic premise" → "Basic premise". A title that would
 * be left empty, or a series whose titles share nothing, keeps its titles.
 */
export const shortStepLabels = (titles: string[]): string[] => {
  const words = titles.map((t) => t.trim().split(/\s+/));
  if (titles.length < 2) return titles.map((t) => t.trim());
  let common = 0;
  const shortest = Math.min(...words.map((w) => w.length));
  while (common < shortest && words.every((w) => w[common]!.toLowerCase() === words[0]![common]!.toLowerCase())) common++;
  if (common === 0) return titles.map((t) => t.trim());
  return titles.map((t, i) => {
    const rest = words[i]!.slice(common).join(" ").replace(/^[\s\-–—:|·,]+/, "").trim();
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : t.trim();
  });
};

/**
 * courseDetails.seriesLimit: the "Part of …" chips show at most `limit` steps,
 * a window around the current course (the first ones when the course is not a
 * step), numbered from 1 in path order. No limit (missing, not a whole number,
 * < 1) shows every step.
 */
export const seriesWindow = <T extends { current: boolean }>(
  steps: T[],
  limit: unknown,
): { step: T; number: number }[] => {
  const numbered = (shown: T[]) => shown.map((step, i) => ({ step, number: i + 1 }));
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || steps.length <= limit) return numbered(steps);
  const at = steps.findIndex((s) => s.current);
  const start = at < 0 ? 0 : Math.min(Math.max(at - Math.floor((limit - 1) / 2), 0), steps.length - limit);
  return numbered(steps.slice(start, start + limit));
};
