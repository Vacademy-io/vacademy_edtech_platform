import { useEffect, useMemo, useState } from "react";
import type { Frame } from "./types";

/**
 * Captions for lessons whose timeline reserves a caption band under the board
 * ("Board only" and the other lesson layouts). The band used to stay empty in
 * this player — a grey strip under every lesson — because it had no captions.
 */

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Phrase {
  text: string;
  start: number;
  end: number;
}

const LESSON_CAPTIONS_KEY = "ai-player-lesson-captions";

/** The pipeline writes the words next to the timeline (see captions-source in the admin app). */
export function wordsUrlForTimeline(timelineUrl?: string | null): string | undefined {
  if (!timelineUrl) return undefined;
  const m = timelineUrl.match(/^(.*\/ai-videos\/[^/]+\/)timeline\/time_based_frame\.json(\?.*)?$/);
  return m ? `${m[1]}words/narration.words.json` : undefined;
}

export function isLessonBand(frame: Frame): boolean {
  return frame.entry_meta?.kind === "lesson_band";
}

/** Short, readable lines: break at sentence ends, pauses, 10 words or 5 s. */
export function buildPhrases(words: Word[]): Phrase[] {
  const out: Phrase[] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const first = cur[0] as Word;
    const next = words[i + 1];
    const brk =
      /[.!?]$/.test(w.word.trim()) ||
      cur.length >= 10 ||
      w.end - first.start >= 5 ||
      (/[,;:]$/.test(w.word.trim()) && cur.length >= 5 && w.end - first.start >= 2) ||
      (next !== undefined && next.start - w.end > 0.5);
    if (brk || next === undefined) {
      out.push({ text: cur.map((x) => x.word).join(" "), start: first.start, end: w.end });
      cur = [];
    }
  });
  return out;
}

export function readLessonCaptionsOn(): boolean {
  try {
    return localStorage.getItem(LESSON_CAPTIONS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveLessonCaptionsOn(on: boolean): void {
  try {
    localStorage.setItem(LESSON_CAPTIONS_KEY, on ? "on" : "off");
  } catch {
    // Ignore storage errors
  }
}

/** Light band → dark text and the reverse, from the band's own background. */
function bandIsDark(html: string): boolean {
  const m = html.match(/background:\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (!m || !m[1]) return false;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

interface Props {
  frames: Frame[];
  /** Seconds on the narration clock (timeline time minus meta.audio_start_at). */
  audioTime: number;
  /** Timeline time, to pick the band active now. */
  timelineTime: number;
  wordsUrl?: string;
}

export function LessonBandCaptions({ frames, audioTime, timelineTime, wordsUrl }: Props) {
  const [phrases, setPhrases] = useState<Phrase[]>([]);

  useEffect(() => {
    if (!wordsUrl) {
      setPhrases([]);
      return;
    }
    let cancelled = false;
    fetch(wordsUrl)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled || !Array.isArray(data)) return;
        const words = data
          .filter((w) => w && typeof w === "object" && "word" in w && "start" in w && "end" in w)
          .map((w: { word: unknown; start: unknown; end: unknown }) => ({
            word: String(w.word),
            start: Number(w.start),
            end: Number(w.end),
          }));
        setPhrases(buildPhrases(words));
      })
      .catch(() => {
        if (!cancelled) setPhrases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [wordsUrl]);

  const band = useMemo(
    () => frames.find((f) => isLessonBand(f) && timelineTime >= f.inTime && timelineTime < f.exitTime),
    [frames, timelineTime]
  );
  const phrase = useMemo(
    () => phrases.find((p) => audioTime >= p.start - 0.1 && audioTime <= p.end + 0.3),
    [phrases, audioTime]
  );
  if (!band || !phrase) return null;

  const box = (band.entry_meta?.caption_box ?? {}) as { x?: number; w?: number; cy?: number };
  const dark = bandIsDark(band.html || "");
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center px-12 text-center"
      // Geometry comes from the timeline's caption box (1920×1080 stage px).
      style={{
        left: `${box.x ?? 0}px`,
        width: `${box.w ?? 1920}px`,
        top: `${box.cy ?? 961}px`,
        transform: "translateY(-50%)",
        zIndex: 500,
      }}
    >
      <span
        className={`text-5xl font-semibold leading-tight ${dark ? "text-white" : "text-gray-900"}`}
      >
        {phrase.text}
      </span>
    </div>
  );
}
