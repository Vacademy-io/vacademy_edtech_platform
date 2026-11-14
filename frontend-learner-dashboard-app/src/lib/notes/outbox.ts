import { getUserId } from "@/constants/getUserId";
import { deleteNote, saveNote } from "./api";
import type { LearnerNote } from "./types";

/**
 * Writes that have not reached the server yet. A note made on a bad connection
 * stays here and is sent on the next chance, so it is not lost and is not sent
 * twice as two notes (ids come from the device).
 *
 * Everything is stored per learner. A shared device can change who is signed in
 * without clearing storage (a sign-in link, an expired session), and one
 * learner's notes must never be shown to, or sent as, the next.
 */
const OUTBOX_KEY = "learner-notes-outbox-v1";
const SLIDE_CACHE_PREFIX = "learner-notes-slide-v1";
const USED_KEY = "learner-notes-used-v1";

export type OutboxEntry = { op: "save"; note: LearnerNote } | { op: "delete"; id: string };

let learnerId: string | null = null;
/** Holds the queue while the app is open if the device's storage refuses it. */
let memoryQueue: { learner: string; entries: OutboxEntry[] } | null = null;

/**
 * Binds storage to whoever is signed in right now. Nothing is read or sent until
 * this has run, so call it before the first read on any screen.
 */
export async function bindNotesToLearner(): Promise<string | null> {
  learnerId = await getUserId();
  return learnerId;
}

export function readOutbox(): OutboxEntry[] {
  if (!learnerId) return [];
  if (memoryQueue?.learner === learnerId) return memoryQueue.entries;
  try {
    const raw = localStorage.getItem(`${OUTBOX_KEY}:${learnerId}`);
    const parsed = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]) {
  if (!learnerId) return;
  try {
    localStorage.setItem(`${OUTBOX_KEY}:${learnerId}`, JSON.stringify(entries));
    memoryQueue = null;
  } catch {
    memoryQueue = { learner: learnerId, entries };
  }
}

const entryId = (entry: OutboxEntry) => (entry.op === "save" ? entry.note.id : entry.id);

/** Keeps only the latest write per note; a delete replaces any unsent save. */
export function enqueue(entries: OutboxEntry[], next: OutboxEntry): OutboxEntry[] {
  return [...entries.filter((e) => entryId(e) !== entryId(next)), next];
}

/** The slide's notes as this device sees them: server list plus unsent writes. */
export function mergeWithOutbox(
  serverNotes: LearnerNote[],
  entries: OutboxEntry[],
  slideId: string,
): LearnerNote[] {
  const byId = new Map(serverNotes.map((note) => [note.id, note]));
  for (const entry of entries) {
    if (entry.op === "delete") byId.delete(entry.id);
    else if (entry.note.slide_id === slideId) byId.set(entry.note.id, entry.note);
  }
  return Array.from(byId.values());
}

const cacheKey = (slideId: string) => `${SLIDE_CACHE_PREFIX}:${learnerId}:${slideId}`;

export function readSlideCache(slideId: string): LearnerNote[] {
  if (!learnerId) return [];
  try {
    const raw = localStorage.getItem(cacheKey(slideId));
    const parsed = raw ? (JSON.parse(raw) as LearnerNote[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSlideCache(slideId: string, notes: LearnerNote[]) {
  if (!learnerId) return;
  try {
    if (notes.length === 0) localStorage.removeItem(cacheKey(slideId));
    else localStorage.setItem(cacheKey(slideId), JSON.stringify(notes));
    if (notes.length > 0) localStorage.setItem(USED_KEY, "1");
  } catch {
    /* offline reading only; safe to skip */
  }
}

/** Whether this device has any notes, so others are spared the review-count call. */
export function hasUsedNotes(): boolean {
  try {
    return localStorage.getItem(USED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * How a failed write should be treated. Only an answer that says this write is
 * itself wrong drops it. Anything else, including a 403 or 404 from a server
 * that does not have this API yet, keeps the learner's note for another try.
 */
export function classifyFailure(error: unknown): "drop" | "offline" | "retry-later" {
  const response = (error as { response?: { status?: number } })?.response;
  if (!response?.status) return "offline";
  return [400, 409, 413, 422].includes(response.status) ? "drop" : "retry-later";
}

export interface FlushResult {
  sent: number;
  rejected: number;
  pending: number;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Sends waiting writes. Without a connection it stops; a write the server keeps
 * failing is left in the queue and the rest still go, so one bad note cannot
 * hold up the others. Each version of a write is tried once per flush, so this
 * always ends.
 */
export function flushOutbox(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let rejected = 0;
    const tried = new Set<string>();
    for (;;) {
      const entry = readOutbox().find((e) => !tried.has(JSON.stringify(e)));
      if (!entry) break;
      const version = JSON.stringify(entry);
      tried.add(version);
      let remove = true;
      try {
        if (entry.op === "save") await saveNote(entry.note);
        else await deleteNote(entry.id);
        sent += 1;
      } catch (error) {
        const failure = classifyFailure(error);
        if (failure === "offline") break;
        if (failure === "drop") rejected += 1;
        else remove = false;
      }
      // Only this exact version: the learner may have edited the note meanwhile.
      if (remove) writeOutbox(readOutbox().filter((e) => JSON.stringify(e) !== version));
    }
    return { sent, rejected, pending: readOutbox().length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function queueWrite(entry: OutboxEntry) {
  writeOutbox(enqueue(readOutbox(), entry));
}

/** Deletes from anywhere, including through the same queue as the lesson's writes. */
export function queueDelete(id: string, slideId?: string | null) {
  queueWrite({ op: "delete", id });
  if (slideId) writeSlideCache(slideId, readSlideCache(slideId).filter((note) => note.id !== id));
}
