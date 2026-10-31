// Display helpers shared by the course tree sidebar and the slides route
// footer ("Up next" pill): resolving a slide's display title, de-duplicating
// ancestor names out of it, un-shouting ALL-CAPS titles, and compact row
// metadata (duration/pages).

import i18n from "@/i18n";
import { toTitleCase } from "@/lib/utils";
import type { Slide } from "@/hooks/study-library/use-slides";
import { getSlideTypeDisplay } from "./chapter-sidebar-slides";

/** Longest all-caps token we still treat as an acronym rather than shouting.
 *  Real acronyms in this domain top out around 5 letters (NCERT, AIIMS, NEET,
 *  MCQ, PDF); a 6+ letter all-caps word is a teacher holding down shift
 *  ("INTRODUCTION", "OBJECTIVES", "OUTLINE"). */
const MAX_ACRONYM_LEN = 5;

/** Content authors routinely type chapter and slide names in full caps, which
 *  at sidebar width turns the tree into a wall of shouting and costs ~15% more
 *  horizontal space per row than mixed case. `toTitleCase` deliberately
 *  preserves all-caps words as acronyms, so it can't fix this on its own —
 *  lowercase the long shouted words first, then let toTitleCase re-capitalise
 *  (which still protects genuine short acronyms). */
export function unshout(text: string): string {
  if (!text) return "";
  // Only act on strings with no lowercase letters at all — a mixed-case title
  // that happens to contain a long acronym is left exactly as the author wrote it.
  if (/[a-z]/.test(text)) return text;
  const hasShoutedWord = text
    .split(/[\s_\-|:/·]+/)
    .some((w) => /^[A-Z]+$/.test(w) && w.length > MAX_ACRONYM_LEN);
  return hasShoutedWord ? text.toLowerCase() : text;
}

/** Display-ready label for a tree row: un-shouted, then title-cased. */
export function humanizeTitle(text: string): string {
  return toTitleCase(unshout(text));
}

export function getSlideTitle(slide: Slide): string {
  return (
    (slide.source_type === "DOCUMENT" && slide.document_slide?.title) ||
    (slide.source_type === "VIDEO" && slide.video_slide?.title) ||
    slide.title ||
    i18n.t("libraryCommonB:slideDisplayUtils.untitled")
  );
}

/** Teachers commonly stamp every slide with the module/chapter name, either
 *  as a prefix ("Exploring the Investigative World of Science | Doubt 01") or
 *  as a suffix ("Chapter Quiz — INTRODUCTION", "Solutions - INTRODUCTION"),
 *  which makes each sidebar row mostly identical text with the differing part
 *  buried at one end — and at sidebar width the suffix form truncates away
 *  exactly the words that distinguish the row. Strip the ancestor name from
 *  either end (plus the separators around it) so rows show only what
 *  distinguishes them; the full title stays on the row's `title` attribute.
 *  Returns "" when the title is nothing but its ancestor's name, so callers
 *  can substitute something more useful (see computeDisplayTitles). */
export function stripAncestorName(
  title: string,
  ancestorNames: Array<string | null | undefined>
): string {
  const SEP = /[-\s|:·>\u2013\u2014]+/;
  let out = title.trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const raw of ancestorNames) {
      const name = (raw || "").trim();
      // Very short ancestor names ("Ch 1") risk eating real title words.
      if (name.length < 4) continue;
      const lower = out.toLowerCase();
      const target = name.toLowerCase();
      if (out.length === name.length && lower === target) {
        // Title is exactly the ancestor name — nothing distinguishing left.
        return "";
      }
      if (out.length > name.length && lower.startsWith(target)) {
        const rest = out
          .slice(name.length)
          .replace(new RegExp(`^${SEP.source}`), "")
          .trim();
        if (rest) {
          out = rest;
          stripped = true;
          continue;
        }
      }
      if (out.length > name.length && lower.endsWith(target)) {
        const rest = out
          .slice(0, out.length - name.length)
          .replace(new RegExp(`${SEP.source}$`), "")
          .trim();
        if (rest) {
          out = rest;
          stripped = true;
        }
      }
    }
  }
  return out;
}

/** Back-compat alias — prefix-only was the original behaviour and the name
 *  is still referenced from the slides route. */
export const stripAncestorPrefix = stripAncestorName;

/** Length of the shared case-insensitive prefix of two titles, backtracked
 *  to a word boundary so we never cut mid-word. */
function sharedPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i]!.toLowerCase() === b[i]!.toLowerCase()) i++;
  while (i > 0 && !/[\s|:·>–—-]/.test(a[i - 1]!)) i--;
  return i;
}

// Below this, a shared prefix is likely a real word in common ("Lecture 1" /
// "Lecture 2") rather than a copy-pasted heading — leave those alone.
const MIN_SHARED_PREFIX = 10;

/** Display titles for a chapter's slides, de-duplicated two ways:
 *  1. ancestor names stripped (module/chapter name pasted into every title);
 *  2. any long prefix a slide shares with a SIBLING stripped — catches slides
 *     copied between modules that carry the ORIGINAL module's name, which
 *     ancestor stripping can't see ("EXPLORING THE INVESTIGATIVE WORLD…"
 *     slides sitting under a "Practice Test" module).
 *  Keyed by slide id; callers keep the full title on the `title` attribute. */
export function computeDisplayTitles(
  slides: Slide[],
  ancestorNames: Array<string | null | undefined>
): Map<string, string> {
  const visible = slides.filter((s) => s.id !== "feedback-slide");
  const entries = visible.map((s) => ({
    id: s.id,
    slide: s,
    title: stripAncestorName(getSlideTitle(s), ancestorNames),
  }));
  const result = new Map<string, string>();
  for (const entry of entries) {
    let best = 0;
    for (const other of entries) {
      if (other.id === entry.id) continue;
      best = Math.max(best, sharedPrefixLen(entry.title, other.title));
    }
    let display = entry.title;
    if (best >= MIN_SHARED_PREFIX) {
      const rest = entry.title
        .slice(best)
        .replace(/^[\s|:·>–—-]+/, "")
        .trim();
      if (rest) display = rest;
    }
    result.set(entry.id, display);
  }

  // 3. Anything that reduced to nothing was named exactly like its chapter
  //    ("INTRODUCTION" inside chapter "INTRODUCTION"), so the row repeated
  //    the header directly above it and said nothing about itself. Name it by
  //    what it IS instead ("Document", "Quiz") — the chapter row above already
  //    supplies the subject matter, and the untouched title stays in the
  //    row's tooltip. Same-type siblings get a 1-based ordinal so two
  //    documents in one chapter stay tellable apart.
  const unnamed = entries
    .filter((e) => !result.get(e.id))
    .map((e) => ({
      ...e,
      typeLabel:
        getSlideTypeDisplay(e.slide) ||
        i18n.t("libraryCommonB:slideDisplayUtils.item"),
    }));
  const perType = new Map<string, number>();
  for (const e of unnamed) {
    perType.set(e.typeLabel, (perType.get(e.typeLabel) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const e of unnamed) {
    if ((perType.get(e.typeLabel) ?? 0) > 1) {
      const n = (seen.get(e.typeLabel) ?? 0) + 1;
      seen.set(e.typeLabel, n);
      result.set(e.id, `${e.typeLabel} ${n}`);
    } else {
      result.set(e.id, e.typeLabel);
    }
  }
  return result;
}

/** Compact h:mm:ss / m:ss clock — locale-neutral, so no i18n needed. */
function formatClock(millis: number): string {
  const totalSeconds = Math.round(millis / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Right-aligned row metadata: duration for video/audio, page count for
 *  documents. The payload already carries these — they were just unused. */
export function getSlideMeta(slide: Slide): string {
  const type = slide.source_type?.toUpperCase();
  if (type === "VIDEO") {
    const ms =
      slide.video_slide?.video_length_in_millis ||
      slide.video_slide?.published_video_length_in_millis;
    if (ms) return formatClock(ms);
  }
  if (type === "HTML_VIDEO") {
    const ms = slide.html_video_slide?.video_length_in_millis;
    if (ms) return formatClock(ms);
  }
  if (type === "AUDIO") {
    const ms =
      slide.audio_slide?.published_audio_length_in_millis ||
      slide.audioSlide?.published_audio_length_in_millis;
    if (ms) return formatClock(ms);
  }
  if (type === "DOCUMENT") {
    const pages =
      slide.document_slide?.total_pages ||
      slide.document_slide?.published_document_total_pages;
    // "1 page" carries no information — every short doc slide is one page, so
    // showing it just adds a column of identical grey text down the sidebar.
    if (pages && pages > 1)
      return i18n.t("studyContent:slideDetails.pageCount", { count: pages });
  }
  return "";
}
