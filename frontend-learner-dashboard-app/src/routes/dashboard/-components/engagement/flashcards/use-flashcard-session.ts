import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUserId } from "@/constants/getUserId";
import {
  engagementErrorMessage,
  engagementReasonAction,
  fetchEngagementItem,
  parseFlashcards,
  type EngagementFlashcard,
  type EngagementFlashcardsPayload,
  type EngagementItem,
  type EngagementReasonCode,
  type EngagementSubmitResponse,
  type FlashcardOutcome,
  type FlashcardResult,
} from "@/services/engagement";
import { useServerClockSkew, useSubmitEngagement } from "../use-engagement-feed";

/**
 * The flashcards study session (flashcards spec B2): deck order, first-pass
 * ratings, Undo, resume, the submit, the stale-deck recovery and the local
 * practice rounds. `FlashcardsBody` renders it; everything here that can be
 * pure is exported for tests.
 *
 * Rules the server holds us to (EngagementLearnerService FLASHCARDS grading):
 * - one FIRST rating per card of the CURRENT deck, sent as `cardOutcomes`, plus
 *   the deck `itemVersion` studied, and nothing else;
 * - a stale version is refused (FLASHCARDS_STALE): refetch, keep the ratings of
 *   cards that still exist, study the rest;
 * - a submit sooner than max(5 s, min(n x 1.5 s, 60 s)) after the first open is
 *   refused (FLASHCARDS_TOO_FAST), so the client waits that out before sending.
 *
 * Practice rounds after the summary are local only and never re-submitted.
 */

// ── Constants ────────────────────────────────────────────────────────

/** A drag further than this after the flip rates the card (px). */
export const FLASHCARD_SWIPE_PX = 80;
/** A flick faster than this rates the card even when short (px/s). */
export const FLASHCARD_FLICK_VELOCITY = 500;
/** A flick still has to travel this far, so a jittery tap never rates (px). */
export const FLASHCARD_FLICK_MIN_PX = 24;
/** Extra wait on top of the server's patience gate, for clock noise (ms). */
const GATE_SLACK_MS = 750;
/** One automatic retry after a TOO_FAST refusal waits this long (ms). */
const TOO_FAST_RETRY_MS = 3_000;

const STORAGE_PREFIX = "vacademy.engagement.flashcards.v1:";

/** The server's patience gate for a deck of `n` cards (ms). */
export function flashcardGateMs(n: number): number {
  return Math.max(5_000, Math.min(Math.max(0, n) * 1_500, 60_000));
}

// ── Seeded order ─────────────────────────────────────────────────────

/** FNV-1a (32 bit). Stable across browsers, enough to seed a shuffle. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny deterministic PRNG in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with a seeded PRNG: the same seed always gives the same order. */
export function seededShuffle<T>(list: readonly T[], seed: number): T[] {
  const out = list.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The seed key: the same learner sees the same order for the same deck version. */
export function flashcardSeedKey(
  userId: string | null | undefined,
  itemId: string,
  version: number
): string {
  return `${userId ?? ""}:${itemId}:${version}`;
}

/** Study order of a deck: seeded when the teacher left shuffle on, else deck order. */
export function deckOrder(
  cards: readonly EngagementFlashcard[],
  shuffle: boolean,
  seedKey: string
): string[] {
  const ids = cards.map((c) => c.id);
  return shuffle ? seededShuffle(ids, hashSeed(seedKey)) : ids;
}

// ── One round (the first pass, or a practice round) ──────────────────

export interface FlashcardRound {
  /** Card ids in study order. */
  order: string[];
  /** Position of the card on screen; `order.length` once every card is rated. */
  index: number;
  /** The rating of each card in this round (the FIRST pass is what is submitted). */
  ratings: Record<string, FlashcardResult>;
  /** Card ids in the order they were rated; Undo pops the last one. */
  log: string[];
  /** The current card shows its back. */
  flipped: boolean;
  /** The current card has been flipped at least once: rating is unlocked. */
  seen: boolean;
  /** The hint of the current card is open. */
  hintShown: boolean;
}

export type FlashcardRoundAction =
  | { type: "flip" }
  | { type: "rate"; result: FlashcardResult }
  | { type: "undo" }
  | { type: "showHint" };

export function newRound(order: readonly string[]): FlashcardRound {
  return {
    order: order.slice(),
    index: 0,
    ratings: {},
    log: [],
    flipped: false,
    seen: false,
    hintShown: false,
  };
}

export function ratedCount(round: FlashcardRound): number {
  return round.order.reduce((n, id) => (round.ratings[id] ? n + 1 : n), 0);
}

export function isRoundComplete(round: FlashcardRound): boolean {
  return round.order.length > 0 && round.order.every((id) => Boolean(round.ratings[id]));
}

export function currentCardId(round: FlashcardRound): string | null {
  return round.order[round.index] ?? null;
}

export function roundCounts(round: FlashcardRound): { known: number; learning: number } {
  let known = 0;
  let learning = 0;
  for (const id of round.order) {
    const r = round.ratings[id];
    if (r === "KNOWN") known++;
    else if (r === "LEARNING") learning++;
  }
  return { known, learning };
}

/** The next unrated position after `from`, wrapping round; `order.length` when none. */
function nextUnrated(order: string[], ratings: Record<string, FlashcardResult>, from: number): number {
  for (let i = from; i < order.length; i++) if (!ratings[order[i]]) return i;
  for (let i = 0; i < Math.min(from, order.length); i++) if (!ratings[order[i]]) return i;
  return order.length;
}

/** Pure round transitions. Rating is ignored until the current card was flipped. */
export function roundReducer(round: FlashcardRound, action: FlashcardRoundAction): FlashcardRound {
  switch (action.type) {
    case "flip": {
      if (currentCardId(round) == null) return round;
      return { ...round, flipped: !round.flipped, seen: true };
    }
    case "showHint": {
      if (currentCardId(round) == null) return round;
      return { ...round, hintShown: true };
    }
    case "rate": {
      const id = currentCardId(round);
      if (id == null || !round.seen || round.ratings[id]) return round;
      const ratings = { ...round.ratings, [id]: action.result };
      return {
        ...round,
        ratings,
        log: [...round.log, id],
        index: nextUnrated(round.order, ratings, round.index + 1),
        flipped: false,
        seen: false,
        hintShown: false,
      };
    }
    case "undo": {
      const id = round.log[round.log.length - 1];
      if (id == null) return round;
      const ratings = { ...round.ratings };
      delete ratings[id];
      const index = round.order.indexOf(id);
      return {
        ...round,
        ratings,
        log: round.log.slice(0, -1),
        index: index >= 0 ? index : nextUnrated(round.order, ratings, 0),
        // Back on the card, answer side up, so the learner can re-rate at once.
        flipped: true,
        seen: true,
        hintShown: false,
      };
    }
    default:
      return round;
  }
}

/**
 * The deck changed under the learner (FLASHCARDS_STALE). Keep the order and the
 * ratings of cards that still exist, append new cards in `appendOrder`, and
 * resume at the first unrated card.
 */
export function reconcileRound(
  round: FlashcardRound,
  cards: readonly EngagementFlashcard[],
  appendOrder: readonly string[]
): FlashcardRound {
  const alive = new Set(cards.map((c) => c.id));
  const kept = round.order.filter((id) => alive.has(id));
  const keptSet = new Set(kept);
  const added = appendOrder.filter((id) => alive.has(id) && !keptSet.has(id));
  const order = [...kept, ...added];
  const ratings: Record<string, FlashcardResult> = {};
  for (const id of order) {
    const r = round.ratings[id];
    if (r) ratings[id] = r;
  }
  return {
    order,
    index: nextUnrated(order, ratings, 0),
    ratings,
    log: round.log.filter((id) => alive.has(id) && Boolean(ratings[id])),
    flipped: false,
    seen: false,
    hintShown: false,
  };
}

/**
 * The submit body's outcomes: exactly one per card of the current deck, in deck
 * order. Null while any card is unrated (the server would refuse it anyway).
 */
export function buildCardOutcomes(
  round: FlashcardRound,
  cards: readonly EngagementFlashcard[]
): FlashcardOutcome[] | null {
  const out: FlashcardOutcome[] = [];
  for (const card of cards) {
    const result = round.ratings[card.id];
    if (!result) return null;
    out.push({ cardId: card.id, result });
  }
  return out;
}

/** Same card ids, ignoring order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// ── Resume (sessionStorage, keyed by itemId:version) ─────────────────

export function flashcardStorageKey(itemId: string, version: number): string {
  return `${STORAGE_PREFIX}${itemId}:${version}`;
}

interface StoredSession {
  order: string[];
  index: number;
  ratings: Record<string, FlashcardResult>;
  log: string[];
  /** Server-clock ms of this device's first open, a floor for the patience gate. */
  firstSeenAt?: number;
}

/**
 * Read a saved first pass. Anything that no longer matches the deck exactly (a
 * different card set, a rating for an unknown card) is discarded, never trusted.
 */
export function readStoredRound(
  key: string,
  cardIds: readonly string[]
): { round: FlashcardRound; firstSeenAt: number | null } | null {
  let raw: string | null = null;
  try {
    raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!s || !Array.isArray(s.order) || !s.order.every((id) => typeof id === "string")) return null;
    if (new Set(s.order).size !== s.order.length || !sameIds(s.order, cardIds)) return null;
    const ratings: Record<string, FlashcardResult> = {};
    const known = new Set(s.order);
    for (const [id, r] of Object.entries(s.ratings ?? {})) {
      if (!known.has(id) || (r !== "KNOWN" && r !== "LEARNING")) return null;
      ratings[id] = r;
    }
    const log = Array.isArray(s.log) ? s.log.filter((id) => typeof id === "string" && Boolean(ratings[id])) : [];
    const round: FlashcardRound = {
      order: s.order,
      ratings,
      log,
      index: nextUnrated(s.order, ratings, 0),
      flipped: false,
      seen: false,
      hintShown: false,
    };
    const firstSeenAt = typeof s.firstSeenAt === "number" && Number.isFinite(s.firstSeenAt) ? s.firstSeenAt : null;
    return { round, firstSeenAt };
  } catch {
    return null;
  }
}

export function writeStoredRound(key: string, round: FlashcardRound, firstSeenAt: number | null): void {
  try {
    const value: StoredSession = {
      order: round.order,
      index: round.index,
      ratings: round.ratings,
      log: round.log,
      ...(firstSeenAt != null ? { firstSeenAt } : {}),
    };
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: resume is a convenience, never a blocker.
  }
}

export function clearStoredRound(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore: see writeStoredRound.
  }
}

// ── The hook ─────────────────────────────────────────────────────────

export type FlashcardPhase =
  /** Waiting for the learner id that seeds the order. */
  | "loading"
  /** The deck has no playable card. */
  | "empty"
  | "study"
  /** Every card rated: waiting out the patience gate, then sending. */
  | "finishing"
  /** The deck changed on the server: fetching the new one. */
  | "syncing"
  /** The submit failed; `error` says why. */
  | "error"
  | "summary"
  | "practice"
  | "practiceDone";

export interface FlashcardSessionError {
  message: string;
  reasonCode?: EngagementReasonCode;
  /** False when the task can no longer be finished (closed, not open). */
  retryable: boolean;
}

export interface FlashcardSummaryData {
  /** Null when an older server did not say (a finished deck with no stats). */
  known: number | null;
  total: number;
  /** Still-learning cards that exist in the current deck, in study order. */
  learning: EngagementFlashcard[];
}

export interface FlashcardSession {
  item: EngagementItem;
  deck: EngagementFlashcardsPayload | null;
  phase: FlashcardPhase;
  /** The round on screen: the first pass, or the practice round. */
  round: FlashcardRound;
  /** The first pass (what was submitted), whatever round is on screen. */
  firstPass: FlashcardRound;
  isPractice: boolean;
  current: EngagementFlashcard | null;
  /** 1-based position of the card on screen ("Card 4 of 12"). */
  position: number;
  total: number;
  counts: { known: number; learning: number };
  /** The learner reopened a pass saved earlier in this tab. */
  resumed: boolean;
  /** The deck was updated mid-session and the ratings were carried over. */
  cardsUpdated: boolean;
  dismissCardsUpdated: () => void;
  flip: () => void;
  rate: (result: FlashcardResult) => void;
  undo: () => void;
  canUndo: boolean;
  showHint: () => void;
  /** Client-clock ms when the pending submit goes out, while waiting on the gate. */
  finishAt: number | null;
  /** The submit request is in flight. */
  submitting: boolean;
  error: FlashcardSessionError | null;
  retry: () => void;
  /** The server's answer to this session's submit, or a synthesised one (read-only). */
  result: EngagementSubmitResponse | null;
  /** The task was already complete when opened: summary only. */
  readOnly: boolean;
  summary: FlashcardSummaryData | null;
  practiceSummary: FlashcardSummaryData | null;
  /** Start a local practice round over these cards (default: the still-learning ones). */
  startPractice: (cardIds?: string[]) => void;
  backToSummary: () => void;
}

function isCompleted(item: EngagementItem): boolean {
  return (item.attemptStatus ?? "").toUpperCase() === "COMPLETED";
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** A stand-in response for a deck finished before this open (read-only summary). */
function completedResponse(item: EngagementItem): EngagementSubmitResponse {
  return {
    attemptId: "",
    status: "COMPLETED",
    isCorrect: null,
    pointsAwarded: item.pointsAwarded ?? 0,
    isLate: Boolean(item.isLate),
    isVerified: false,
    isRevealed: false,
    alreadyCompleted: true,
    flashcardsResult: item.flashcardsResult ?? null,
  };
}

function summaryFrom(
  cards: readonly EngagementFlashcard[],
  byId: Map<string, EngagementFlashcard>,
  round: FlashcardRound | null,
  server: { known: number; total: number; learningCardIds: string[] } | null | undefined
): FlashcardSummaryData {
  if (server && Number.isFinite(server.known) && Number.isFinite(server.total)) {
    const ids = new Set(server.learningCardIds ?? []);
    const order = round?.order.length ? round.order : cards.map((c) => c.id);
    const learning = order
      .filter((id) => ids.has(id))
      .map((id) => byId.get(id))
      .filter((c): c is EngagementFlashcard => Boolean(c));
    // Cards the round never saw (another device) still count, in deck order.
    for (const c of cards) if (ids.has(c.id) && !learning.includes(c)) learning.push(c);
    return { known: server.known, total: server.total, learning };
  }
  if (round && round.order.length) {
    const counts = roundCounts(round);
    const learning = round.order
      .filter((id) => round.ratings[id] === "LEARNING")
      .map((id) => byId.get(id))
      .filter((c): c is EngagementFlashcard => Boolean(c));
    return { known: counts.known, total: round.order.length, learning };
  }
  return { known: null, total: cards.length, learning: [] };
}

export interface UseFlashcardSessionOptions {
  /** Fired once, as soon as the server accepts the first pass. */
  onSubmitted?: (response: EngagementSubmitResponse) => void;
}

export function useFlashcardSession(
  initialItem: EngagementItem,
  opts: UseFlashcardSessionOptions = {}
): FlashcardSession {
  const { t } = useTranslation("dashboardEngagement");
  const submitEngagement = useSubmitEngagement();
  const skew = useServerClockSkew();

  const [item, setItem] = useState<EngagementItem>(initialItem);
  const deck = useMemo(() => parseFlashcards(item), [item]);
  const cards = useMemo(() => deck?.cards ?? [], [deck]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const storageKey = flashcardStorageKey(item.id, item.version);

  const readOnly0 = isCompleted(initialItem);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [readOnly, setReadOnly] = useState(readOnly0);
  const [result, setResult] = useState<EngagementSubmitResponse | null>(() =>
    readOnly0 ? completedResponse(initialItem) : null
  );

  // A pass saved earlier in this tab resumes at once, before the learner id is known.
  const [boot] = useState(() =>
    readOnly0 || !deck
      ? null
      : readStoredRound(
          flashcardStorageKey(initialItem.id, initialItem.version),
          deck.cards.map((c) => c.id)
        )
  );
  const [round, setRound] = useState<FlashcardRound>(() => boot?.round ?? newRound([]));
  const [phase, setPhase] = useState<FlashcardPhase>(() => {
    if (readOnly0) return "summary";
    if (!deck) return "empty";
    if (boot) return isRoundComplete(boot.round) ? "finishing" : "study";
    return "loading";
  });
  const [resumed] = useState(() => Boolean(boot && boot.round.log.length > 0));
  const [practice, setPractice] = useState<FlashcardRound | null>(null);
  const [cardsUpdated, setCardsUpdated] = useState(false);
  const [error, setError] = useState<FlashcardSessionError | null>(null);
  const [finishAt, setFinishAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const firstSeenRef = useRef<number | null>(boot?.firstSeenAt ?? null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const autoRetriedRef = useRef<{ tooFast: boolean; staleVersion: number | null }>({
    tooFast: false,
    staleVersion: null,
  });
  const mountedRef = useRef(true);
  const onSubmittedRef = useRef(opts.onSubmitted);
  onSubmittedRef.current = opts.onSubmitted;
  const itemRef = useRef(item);
  itemRef.current = item;
  const roundRef = useRef(round);
  roundRef.current = round;
  const skewRef = useRef(skew);
  skewRef.current = skew;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  /** Latest `recover`; `send` is created once and reaches it through this. */
  const recoverRef = useRef<(e: unknown) => Promise<void>>(async () => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Record this device's first open (server clock), a floor for the gate.
  useEffect(() => {
    if (firstSeenRef.current == null) firstSeenRef.current = Date.now() + skewRef.current;
  }, []);

  // The learner id seeds the shuffle, so two learners don't share one order.
  useEffect(() => {
    let alive = true;
    getUserId()
      .then((id) => alive && setUserId(id ?? null))
      .catch(() => alive && setUserId(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "loading" || userId === undefined || !deck) return;
    setRound(newRound(deckOrder(deck.cards, deck.shuffle, flashcardSeedKey(userId, item.id, item.version))));
    setPhase("study");
  }, [phase, userId, deck, item.id, item.version]);

  // Persist the first pass while it is still the learner's to change.
  useEffect(() => {
    if (readOnly || !deck || round.order.length === 0) return;
    if (phase !== "study" && phase !== "finishing" && phase !== "error") return;
    writeStoredRound(storageKey, round, firstSeenRef.current);
  }, [round, phase, readOnly, deck, storageKey]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Sends the first pass now. Every exit path lands in a stable phase. */
  const send = useCallback(async () => {
    if (inFlightRef.current) return;
    const current = itemRef.current;
    const parsed = parseFlashcards(current);
    const outcomes = parsed ? buildCardOutcomes(roundRef.current, parsed.cards) : null;
    if (!parsed || !outcomes) {
      setPhase("study");
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setFinishAt(null);
    setError(null);
    try {
      // Exactly these two fields: the server builds everything else itself.
      const response = await submitEngagement(current.id, {
        cardOutcomes: outcomes,
        itemVersion: current.version,
      });
      inFlightRef.current = false;
      clearStoredRound(flashcardStorageKey(current.id, current.version));
      if (!mountedRef.current) return;
      setSubmitting(false);
      setResult(response);
      setPhase("summary");
      onSubmittedRef.current?.(response);
    } catch (e) {
      // Release the guard first: recovery may send again straight away.
      inFlightRef.current = false;
      if (!mountedRef.current) return;
      setSubmitting(false);
      await recoverRef.current(e);
    }
  }, [submitEngagement]);

  /** Wait out the patience gate (server clock), then send. */
  const scheduleSend = useCallback(
    (extraWaitMs = 0) => {
      clearTimer();
      const current = itemRef.current;
      const n = parseFlashcards(current)?.cards.length ?? 0;
      const serverNow = Date.now() + skewRef.current;
      const started = parseTime(current.startedAt) ?? firstSeenRef.current ?? serverNow;
      const wait = Math.max(extraWaitMs, flashcardGateMs(n) + GATE_SLACK_MS - (serverNow - started));
      setPhase("finishing");
      setError(null);
      if (wait <= 0) {
        setFinishAt(null);
        void send();
        return;
      }
      setFinishAt(Date.now() + wait);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void send();
      }, wait);
    },
    [send, clearTimer]
  );

  /** A refused or failed submit: reload a changed deck, wait out the gate, or explain. */
  const recover = async (e: unknown) => {
    const { message, reasonCode } = engagementErrorMessage(e, t);
    const action = engagementReasonAction(reasonCode);
    if (action === "close") {
      setError({ message, reasonCode, retryable: false });
      setPhase("error");
      return;
    }
    if (reasonCode === "FLASHCARDS_TOO_FAST") {
      if (!autoRetriedRef.current.tooFast) {
        autoRetriedRef.current.tooFast = true;
        scheduleSend(TOO_FAST_RETRY_MS);
        return;
      }
      setError({ message, reasonCode, retryable: true });
      setPhase("error");
      return;
    }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline || (reasonCode && reasonCode !== "FLASHCARDS_STALE" && reasonCode !== "FLASHCARDS_INCOMPLETE")) {
      setError({ message, reasonCode, retryable: true });
      setPhase("error");
      return;
    }
    // STALE, INCOMPLETE, or an older server with no reasonCode: the deck may have
    // changed under the learner. Refetch it and compare before blaming anyone.
    setPhase("syncing");
    let fresh: EngagementItem;
    try {
      fresh = await fetchEngagementItem(itemRef.current.id);
    } catch {
      if (!mountedRef.current) return;
      setError({ message, reasonCode, retryable: true });
      setPhase("error");
      return;
    }
    if (!mountedRef.current) return;
    applyFreshItem(fresh, { message, reasonCode });
  };

  const applyFreshItem = (
    fresh: EngagementItem,
    failure: { message: string; reasonCode?: EngagementReasonCode }
  ) => {
    const before = itemRef.current;
    if (isCompleted(fresh)) {
      // Finished elsewhere (another tab or device) in the meantime.
      clearStoredRound(flashcardStorageKey(before.id, before.version));
      setItem(fresh);
      setReadOnly(true);
      setResult(completedResponse(fresh));
      setPhase("summary");
      return;
    }
    const freshDeck = parseFlashcards(fresh);
    const oldIds = roundRef.current.order;
    const changed =
      fresh.version !== before.version || !freshDeck || !sameIds(freshDeck.cards.map((c) => c.id), oldIds);
    if (!changed) {
      setError({ ...failure, retryable: true });
      setPhase("error");
      return;
    }
    clearStoredRound(flashcardStorageKey(before.id, before.version));
    setItem(fresh);
    if (!freshDeck) {
      setPhase("empty");
      return;
    }
    const append = deckOrder(
      freshDeck.cards,
      freshDeck.shuffle,
      flashcardSeedKey(userIdRef.current, fresh.id, fresh.version)
    );
    const next = reconcileRound(roundRef.current, freshDeck.cards, append);
    roundRef.current = next;
    itemRef.current = fresh;
    setRound(next);
    setCardsUpdated(true);
    if (isRoundComplete(next) && autoRetriedRef.current.staleVersion !== fresh.version) {
      // Only removals: every surviving card is rated, so finish straight away (once).
      autoRetriedRef.current.staleVersion = fresh.version;
      scheduleSend();
    } else {
      setPhase("study");
    }
  };

  recoverRef.current = recover;

  // A resumed pass that was already complete goes straight to finishing.
  useEffect(() => {
    if (phase === "finishing" && !submitting && finishAt == null && !timerRef.current && !inFlightRef.current) {
      scheduleSend();
    }
    // Only on mount / resume: later transitions schedule themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ────────────────────────────────────────────────────────

  const isPractice = phase === "practice" || (phase === "practiceDone" && practice != null);
  const active = phase === "practice" || phase === "practiceDone" ? practice ?? newRound([]) : round;

  const flip = useCallback(() => {
    if (phase === "study") setRound((r) => roundReducer(r, { type: "flip" }));
    else if (phase === "practice") setPractice((r) => (r ? roundReducer(r, { type: "flip" }) : r));
  }, [phase]);

  const showHint = useCallback(() => {
    if (phase === "study") setRound((r) => roundReducer(r, { type: "showHint" }));
    else if (phase === "practice") setPractice((r) => (r ? roundReducer(r, { type: "showHint" }) : r));
  }, [phase]);

  const rate = useCallback(
    (result: FlashcardResult) => {
      if (phase === "study") {
        const next = roundReducer(roundRef.current, { type: "rate", result });
        if (next === roundRef.current) return;
        roundRef.current = next;
        setRound(next);
        if (isRoundComplete(next)) scheduleSend();
      } else if (phase === "practice" && practice) {
        const next = roundReducer(practice, { type: "rate", result });
        if (next === practice) return;
        setPractice(next);
        if (isRoundComplete(next)) setPhase("practiceDone");
      }
    },
    [phase, practice, scheduleSend]
  );

  const canUndo =
    (phase === "study" && round.log.length > 0) ||
    (phase === "finishing" && !submitting && round.log.length > 0) ||
    (phase === "error" && Boolean(error?.retryable) && round.log.length > 0) ||
    (phase === "practice" && (practice?.log.length ?? 0) > 0);

  const undo = useCallback(() => {
    if (!canUndo) return;
    if (phase === "practice") {
      setPractice((r) => (r ? roundReducer(r, { type: "undo" }) : r));
      return;
    }
    clearTimer();
    setFinishAt(null);
    setError(null);
    const next = roundReducer(roundRef.current, { type: "undo" });
    roundRef.current = next;
    setRound(next);
    setPhase("study");
  }, [canUndo, phase, clearTimer]);

  const retry = useCallback(() => {
    if (phase !== "error" || !error?.retryable) return;
    if (isRoundComplete(roundRef.current)) scheduleSend();
    else setPhase("study");
  }, [phase, error, scheduleSend]);

  const summary = useMemo<FlashcardSummaryData | null>(() => {
    if (phase !== "summary" && phase !== "practice" && phase !== "practiceDone") return null;
    return summaryFrom(cards, byId, readOnly ? null : round, result?.flashcardsResult ?? item.flashcardsResult);
  }, [phase, cards, byId, readOnly, round, result, item.flashcardsResult]);

  const practiceSummary = useMemo<FlashcardSummaryData | null>(
    () => (phase === "practiceDone" && practice ? summaryFrom(cards, byId, practice, null) : null),
    [phase, practice, cards, byId]
  );

  const startPractice = useCallback(
    (cardIds?: string[]) => {
      const source =
        cardIds ??
        (phase === "practiceDone" && practiceSummary
          ? practiceSummary.learning.map((c) => c.id)
          : summary?.learning.map((c) => c.id)) ??
        [];
      const ids = source.filter((id) => byId.has(id));
      if (ids.length === 0) return;
      setPractice(newRound(ids));
      setPhase("practice");
    },
    [phase, practiceSummary, summary, byId]
  );

  const backToSummary = useCallback(() => {
    setPractice(null);
    setPhase("summary");
  }, []);

  const currentId = currentCardId(active);
  const current = currentId ? byId.get(currentId) ?? null : null;
  const counts = roundCounts(active);
  const position = Math.min(ratedCount(active) + 1, Math.max(active.order.length, 1));

  return {
    item,
    deck,
    phase,
    round: active,
    firstPass: round,
    isPractice,
    current,
    position,
    total: active.order.length,
    counts,
    resumed,
    cardsUpdated,
    dismissCardsUpdated: () => setCardsUpdated(false),
    flip,
    rate,
    undo,
    canUndo,
    showHint,
    finishAt,
    submitting,
    error,
    retry,
    result,
    readOnly,
    summary,
    practiceSummary,
    startPractice,
    backToSummary,
  };
}
