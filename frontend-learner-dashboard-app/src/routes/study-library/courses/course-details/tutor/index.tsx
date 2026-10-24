import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useSidebar } from "@/components/ui/sidebar";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useSpatiusAvatar, type AvatarBoot, type AvatarDiag } from "@/hooks/useSpatiusAvatar";
import { BEGIN_CAP_MS, decideBegin, hasUserActivation } from "@/lib/tutorAudioGate";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useTutorSocket, type TutorBoardOp, type TutorCheckEvent, type TutorPace, type TutorStateEvent } from "@/hooks/useTutorSocket";
import { Whiteboard } from "@/components/tutor/Whiteboard";
import { TutorSidebar, type TutorTopicItem } from "@/components/tutor/TutorSidebar";
import { TeacherAvatar } from "@/components/tutor/TeacherAvatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ListBullets } from "@phosphor-icons/react";
import { TeacherPanel, type LessonStats, type TranscriptLine, type TutorPhase } from "@/components/tutor/TeacherPanel";
import { ActivenessCard } from "@/components/tutor/ActivenessCard";
import { useActiveness } from "@/hooks/useActiveness";
import {
  endTutorSession,
  getTutorAvatarToken,
  getTutorChapterSlides,
  getTutorCourseOutline,
  getTutorDemoAvatarToken,
  startTutorSession,
  type TutorChapterSlide,
  type TutorOutlineChapter,
  type TutorStartResponse,
} from "@/services/tutor-api";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import { submitTutorQuizActivity } from "@/services/tutor-api";
import { readTutorGuest, writeTutorGuest } from "@/lib/tutorGuest";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { aiUsageLimitMessage, claimAiUsageLimit } from "@/lib/ai-usage-limit-notify";

interface TutorSearch {
  courseId: string;
  packageSessionId: string;
  chapterId?: string;
  slideId?: string;
  subjectId?: string;
  moduleId?: string;
  mode?: "text" | "voice";
  /** "1": the public guest lesson — session and token come from sessionStorage, nothing is written back. */
  demo?: string;
  /** The course page's tab (ALL / PROGRESS / COMPLETED), handed back when the lesson ends. */
  selectedTab?: string;
}

/** True for "1", the number 1, or a JSON-quoted "\"1\"" — see validateSearch below. */
export function isDemoFlag(value: unknown): boolean {
  if (value === 1) return true;
  return typeof value === "string" && value.replace(/^"|"$/g, "") === "1";
}

export const Route = createFileRoute("/study-library/courses/course-details/tutor/")({
  component: TutorPage,
  validateSearch: (search: Record<string, unknown>): TutorSearch => ({
    courseId: String(search.courseId ?? ""),
    packageSessionId: String(search.packageSessionId ?? ""),
    chapterId: search.chapterId ? String(search.chapterId) : undefined,
    slideId: search.slideId ? String(search.slideId) : undefined,
    subjectId: search.subjectId ? String(search.subjectId) : undefined,
    moduleId: search.moduleId ? String(search.moduleId) : undefined,
    mode: search.mode === "voice" ? "voice" : "text",
    // The router's default search stringifier JSON-encodes any value that is itself
    // valid JSON, so a client-side navigate emits demo="1" (quoted) while a
    // hand-written link carries demo=1, which parses to the number 1. Accept all forms.
    demo: isDemoFlag(search.demo) ? "1" : undefined,
    selectedTab: search.selectedTab ? String(search.selectedTab) : undefined,
  }),
});

type Disconnect = {
  reason: "lost" | "idle" | "limit" | "credits" | "usage" | "ended";
  /** `usage`: the localized AI-usage-limit sentence (replaces the generic text). */
  message?: string;
};

// The teacher "writes" a concept's elements one at a time while speaking,
// instead of dropping the whole board at once.
const REVEAL_MS = 900;
// Voice mode: a concept with no question does not stall on a button — the
// teacher pauses for a beat and carries on, unless the learner taps first.
const AUTO_CONTINUE_MS = 1500;

const DISCONNECT_TEXT: Record<Disconnect["reason"], string> = {
  lost: "The connection to your teacher dropped.",
  idle: "The lesson paused because nothing happened for a while.",
  limit: "This lesson reached its time limit.",
  credits: "Your institute's lesson credits have run out for now.",
  usage: "You've reached your AI usage limit for now.",
  ended: "The lesson ended.",
};

/**
 * Learn with your teacher (design §6): a whiteboard the teacher fills in while
 * speaking, a check after each concept, and a sidebar with the boards of this
 * slide and the chapter's other slides. Progression inside a slide is the
 * server's; moving to the next slide is decided here, and completion is
 * written through the same call the slide viewer uses.
 */
function TutorPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const voiceMode = search.mode === "voice";

  const [boot, setBoot] = useState<TutorStartResponse | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState<Disconnect | null>(null);
  const [phase, setPhase] = useState<TutorPhase>("connecting");
  const [state, setState] = useState<TutorStateEvent | null>(null);
  const [topics, setTopics] = useState<TutorTopicItem[]>([]);
  const [slideTitle, setSlideTitle] = useState("");
  const [boardOps, setBoardOps] = useState<TutorBoardOp[]>([]);
  const [liveOps, setLiveOps] = useState<TutorBoardOp[]>([]);
  const [boardKey, setBoardKey] = useState("b0");
  const [revealKey, setRevealKey] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [check, setCheck] = useState<TutorCheckEvent | null>(null);
  const [awaiting, setAwaiting] = useState<"continue" | "answer" | "done" | null>(null);
  const [chapterSlides, setChapterSlides] = useState<TutorChapterSlide[]>([]);
  // Every chapter of the course: the rail and "Next" cross chapters with it.
  const [courseOutline, setCourseOutline] = useState<TutorOutlineChapter[]>([]);
  // Read by socket callbacks, which must see the latest list, not a stale render's.
  const courseSlidesRef = useRef<TutorChapterSlide[]>([]);
  const [speakOn, setSpeakOn] = useState(true);
  const speakOnRef = useRef(true);
  speakOnRef.current = speakOn;
  const [micOn, setMicOn] = useState(false);
  const [pace, setPace] = useState<TutorPace>("normal");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  // Premium teacher avatar (Spatius): mounted when the course has one and the learner keeps it on.
  // Device reports go to the lesson summary; held until the socket is ready.
  const sendAvatarDiagRef = useRef<((d: AvatarDiag) => void) | null>(null);
  const pendingAvatarDiagRef = useRef<AvatarDiag[]>([]);
  const avatar = useSpatiusAvatar((d) => {
    if (sendAvatarDiagRef.current) sendAvatarDiagRef.current(d);
    else pendingAvatarDiagRef.current.push(d);
  });
  const [avatarOn, setAvatarOn] = useState(true);
  // A hidden face stops drawing; its CPU goes back to the lesson.
  useEffect(() => {
    avatar.setShown(avatarOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarOn, avatar.ready]);
  const avatarContainerRef = useRef<HTMLDivElement | null>(null);
  const avatarBootedRef = useRef(false);
  const pendingAvatarRef = useRef<AvatarBoot | null>(null);
  // Wanted: a voice lesson on a course with a face, kept on. Active: painted and
  // unlocked, so narration goes through it; until then the speaker plays.
  const avatarWanted = voiceMode && avatarOn && !!boot?.avatar;
  const avatarShown = avatarWanted && !avatar.failed;
  const avatarActive = avatarShown && avatar.painted && avatar.activated;
  const avatarActiveRef = useRef(false);
  avatarActiveRef.current = avatarActive;
  // Speaker or face is chosen once per teacher turn, never mid-sentence.
  const turnRouteRef = useRef<{ turn?: number; viaAvatar: boolean }>({ viaAvatar: false });
  // Cold load (reload, direct link): the browser wants a tap before any audio.
  // The tap that opened the lesson from the course page already counts.
  const [needsTap, setNeedsTap] = useState(() => !hasUserActivation());
  const [gate, setGate] = useState(false);
  // The server holds the teacher's first words until this device says `begin`.
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const begunRef = useRef(false);
  // Narration sync: the sentence being spoken and the elements written for it.
  const [sentence, setSentence] = useState<number | null>(null);
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [stats, setStats] = useState<LessonStats>({ asked: 0, correct: 0, streak: 0, best: 0 });
  // Phones: the outline lives in a bottom sheet instead of a left rail.
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Phones: one pane at a time — the board, or the teacher's conversation.
  // A question or a nudge flips to the teacher so nothing is missed.
  // Voice lessons open on the Teacher pane: a display:none pane has no size, so
  // the face could never paint there and the voice always arrived first. The
  // first thing the teacher writes after the greeting flips it to the Board.
  const [phoneView, setPhoneView] = useState<"board" | "teacher">(voiceMode ? "teacher" : "board");
  const arrivalViewRef = useRef(voiceMode);
  // The open question (spoken + shown in the card); appended to the transcript with the answer.
  const pendingAskRef = useRef<TranscriptLine | null>(null);
  const flushAsk = (answer: string) => {
    const ask = pendingAskRef.current;
    pendingAskRef.current = null;
    setTranscript((prev) => [...prev, ...(ask ? [ask] : []), { role: "learner" as const, text: answer }]);
  };
  // Desktop: the outline folds to a thin strip so the board and the teacher get the width.
  const [outlineCollapsed, setOutlineCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("tutor.outlineCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleOutline = () => {
    setOutlineCollapsed((v) => {
      try {
        localStorage.setItem("tutor.outlineCollapsed", v ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !v;
    });
  };
  const currentSlideRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const boardCounter = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootSeq = useRef(0);

  // The app sidebar folds to its icon rail for the lesson and comes back on leave.
  const sidebar = useSidebar();
  useEffect(() => {
    const wasOpen = sidebar.open;
    if (wasOpen) sidebar.setOpen(false);
    return () => {
      if (wasOpen) sidebar.setOpen(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── progressive board reveal ──
  const revealQueueRef = useRef<TutorBoardOp[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopReveal = useCallback(() => {
    if (revealTimerRef.current) {
      clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);
  const flushReveal = useCallback(() => {
    stopReveal();
    const rest = [...revealQueueRef.current, ...syncQueueRef.current];
    revealQueueRef.current = [];
    syncQueueRef.current = [];
    if (rest.length) setBoardOps((prev) => [...prev, ...rest]);
    setFocusIds([]);
  }, [stopReveal]);
  // Narration-synced reveal: elements carry the sentence (`say_index`) they
  // belong to and appear as that sentence starts playing.
  const syncQueueRef = useRef<TutorBoardOp[]>([]);
  const syncedRef = useRef(false);
  // The server's audio_end arrives when the last chunk is SENT, not played:
  // the board's tail is flushed when playback really ends.
  const flushPendingRef = useRef(false);
  // Questions asked in this slide (a Repeat or a reconnect re-sends the check).
  const askedRef = useRef<Set<string>>(new Set());
  const revealSynced = useCallback((upTo: number) => {
    const now: TutorBoardOp[] = [];
    const rest: TutorBoardOp[] = [];
    for (const op of syncQueueRef.current) {
      if ((typeof op.say_index === "number" ? op.say_index : 0) <= upTo) now.push(op);
      else rest.push(op);
    }
    syncQueueRef.current = rest;
    if (now.length) setBoardOps((prev) => [...prev, ...now]);
    setFocusIds(now.map((o) => String(o.id ?? "")).filter(Boolean));
    setSentence(upTo);
  }, []);
  const queueReveal = useCallback(
    (ops: TutorBoardOp[]) => {
      if (!ops.length) return;
      const synced = voiceMode && speakOn && ops.some((o) => typeof o.say_index === "number");
      syncedRef.current = synced;
      if (synced) {
        syncQueueRef.current.push(...ops);
        revealSynced(0);
        return;
      }
      // The first element lands with the narration; the rest write in one by one.
      const [first, ...rest] = ops;
      setBoardOps((prev) => [...prev, first as TutorBoardOp]);
      revealQueueRef.current.push(...rest);
      if (revealQueueRef.current.length && !revealTimerRef.current) {
        revealTimerRef.current = setInterval(() => {
          const op = revealQueueRef.current.shift();
          if (op) setBoardOps((prev) => [...prev, op]);
          if (!revealQueueRef.current.length) stopReveal();
        }, REVEAL_MS);
      }
    },
    [stopReveal, voiceMode, speakOn, revealSynced],
  );
  useEffect(() => () => stopReveal(), [stopReveal]);

  const showNotice = useCallback((m: string) => {
    setNotice(m);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  }, []);

  // ── audio out ──
  const audioPlayer = useAudioPlayer();
  const chunksRef = useRef<Uint8Array[]>([]);
  // Each queued segment carries the sentence(s) it speaks, shown as it starts;
  // a `gap` entry is a beat of silence (before a question).
  const queueRef = useRef<Array<{ buf: ArrayBuffer | null; text: string; sentence?: number; gap?: number; turn?: number; endTurn?: number }>>([]);
  const segmentTextRef = useRef("");
  const segmentSentenceRef = useRef(0);
  // Teacher turns overlap (the next ai_text arrives while the last audio is
  // still playing): every bubble, segment and completion carries its turn.
  const turnSeqRef = useRef(0);
  const turnTextRef = useRef<Map<number, string>>(new Map());
  const teacherTextRef = useRef("");
  const drainingRef = useRef(false);
  // The server's phase for AFTER the current narration; applied when the
  // last queued segment finishes so the label never flips mid-sentence.
  const pendingPhaseRef = useRef<TutorPhase | null>(null);
  const turnEndedRef = useRef(false);
  const takeSegment = useCallback((): ArrayBuffer | null => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) return null;
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out.buffer as ArrayBuffer;
  }, []);
  const audioBusy = () => voiceMode && speakOn && (drainingRef.current || queueRef.current.length > 0);
  const applyPhase = useCallback(
    (p: TutorPhase) => {
      if (voiceMode && speakOn && (drainingRef.current || queueRef.current.length > 0)) {
        pendingPhaseRef.current = p;
        return;
      }
      setPhase(p);
    },
    [voiceMode, speakOn],
  );
  /** Append spoken text to the bubble of its turn (voice mode). */
  const revealTeacherText = useCallback((text: string, turn?: number) => {
    if (!text) return;
    setTranscript((prev) => {
      let i = prev.length - 1;
      if (typeof turn === "number") {
        while (i >= 0 && !(prev[i]!.role === "teacher" && prev[i]!.turn === turn)) i -= 1;
      }
      const at = i >= 0 && prev[i]!.role === "teacher" ? i : -1;
      if (at < 0) return [...prev, { role: "teacher", text, turn }];
      const line = prev[at]!;
      const merged = line.text ? `${line.text} ${text}` : text;
      return [...prev.slice(0, at), { ...line, text: merged }, ...prev.slice(at + 1)];
    });
  }, []);
  /** The turn's audio is over: its bubble shows the whole line (drops any segment that failed to play). */
  const completeTeacherText = useCallback((turn?: number) => {
    const id = typeof turn === "number" ? turn : turnSeqRef.current;
    const full = turnTextRef.current.get(id) ?? teacherTextRef.current;
    if (!full) return;
    setTranscript((prev) => {
      let i = prev.length - 1;
      while (i >= 0 && !(prev[i]!.role === "teacher" && (prev[i]!.turn === id || prev[i]!.turn === undefined))) i -= 1;
      if (i < 0 || prev[i]!.text === full) return prev;
      return [...prev.slice(0, i), { ...prev[i]!, text: full }, ...prev.slice(i + 1)];
    });
  }, []);
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length) {
        const seg = queueRef.current.shift();
        if (!seg) continue;
        if (seg.gap) {
          await new Promise((r) => setTimeout(r, seg.gap));
          continue;
        }
        if (typeof seg.endTurn === "number") {
          completeTeacherText(seg.endTurn);
          // Phones: she has greeted the learner face to face; now the board.
          if (arrivalViewRef.current) {
            arrivalViewRef.current = false;
            setPhoneView("board");
          }
          continue;
        }
        setPhase("speaking");
        revealTeacherText(seg.text, seg.turn);
        // The board writes the elements of this sentence as it is spoken.
        if (syncedRef.current && typeof seg.sentence === "number") revealSynced(seg.sentence);
        if (!seg.buf) continue;
        // The avatar plays the audio itself, lips in sync; otherwise the speaker
        // does. Decided at the first segment of a turn and held for the turn.
        if (turnRouteRef.current.turn !== seg.turn) turnRouteRef.current = { turn: seg.turn, viaAvatar: avatarActiveRef.current };
        try {
          if (turnRouteRef.current.viaAvatar) await avatar.speak(seg.buf);
          else await audioPlayer.playAudio(seg.buf);
        } catch {
          /* autoplay blocked or decode error: keep going */
        }
      }
    } finally {
      drainingRef.current = false;
      if (turnEndedRef.current && !queueRef.current.length) {
        const next = pendingPhaseRef.current;
        pendingPhaseRef.current = null;
        setPhase((p) => (p === "speaking" ? (next ?? "idle") : next ?? p));
        completeTeacherText();
        if (flushPendingRef.current) {
          flushPendingRef.current = false;
          flushReveal();
          setRevealKey((k) => k + 1);
        }
      }
    }
  }, [audioPlayer, revealTeacherText, completeTeacherText, revealSynced, flushReveal, avatar]);
  /** Everything the teacher has not "written" yet lands now (voice mode: once the audio has played). */
  const settleBoard = useCallback(() => {
    if (voiceMode && speakOn) {
      if (drainingRef.current || queueRef.current.length) {
        flushPendingRef.current = true;
        return;
      }
      flushReveal();
      setRevealKey((k) => k + 1);
    }
    // Text mode: the 900 ms cadence and the diagram's own step timers finish by themselves.
  }, [voiceMode, speakOn, flushReveal]);
  const stopAudio = useCallback(() => {
    turnEndedRef.current = false;
    pendingPhaseRef.current = null;
    flushPendingRef.current = false;
    queueRef.current = [];
    chunksRef.current = [];
    audioPlayer.stop();
    avatar.interrupt();
    completeTeacherText();
    // A barge-in: whatever the narration had not written yet lands now.
    flushReveal();
    setRevealKey((k) => k + 1);
  }, [audioPlayer, completeTeacherText, flushReveal, avatar]);

  // ── socket ──
  const socket = useTutorSocket({
    getToken: () => guestRef.current?.token,
    onReady: (ev) => {
      // Controls stay inert until `begin`: the teacher has not started, and
      // a tap now would only race the opening.
      setReadyAt(Date.now());
      sendAvatarDiagRef.current = socket.sendAvatarDiag;
      pendingAvatarDiagRef.current.splice(0).forEach((d) => socket.sendAvatarDiag(d));
      setDisconnected(null);
      if (typeof ev.pace === "string") setPace(ev.pace as TutorPace);
      if (ev.language === "en" || ev.language === "hi") setLanguage(ev.language);
      if (Array.isArray(ev.topics)) setTopics(ev.topics as TutorTopicItem[]);
      if (typeof ev.slide_title === "string") setSlideTitle(ev.slide_title);
    },
    onLesson: (ev) => {
      setTopics(ev.topics);
      setSlideTitle(ev.slide_title || "");
      currentSlideRef.current = ev.slide_id;
    },
    onState: (ev) => {
      setState(ev);
      if (ev.language === "en" || ev.language === "hi") setLanguage(ev.language);
      if (ev.phase === "await_answer" || ev.phase === "remediate" || ev.phase === "revisit" || ev.phase === "predict") applyPhase("question");
      else if (ev.phase === "media_task") applyPhase("media");
      else if (ev.phase === "slide_done") applyPhase("done");
    },
    onBoard: (ops, clear, live, _topicId, replay) => {
      // Muted voice lesson: no audio turn will end, so flip on the first board.
      if (arrivalViewRef.current && begunRef.current && ops.length > 0 && !speakOnRef.current) {
        arrivalViewRef.current = false;
        setPhoneView("board");
      }
      if (live) {
        setLiveOps(ops);
        return;
      }
      // A new concept's elements retire the previous turn's highlights.
      setLiveOps([]);
      if (clear) {
        stopReveal();
        revealQueueRef.current = [];
        syncQueueRef.current = [];
        syncedRef.current = false;
        setSentence(null);
        setFocusIds([]);
        boardCounter.current += 1;
        setBoardKey(`b${boardCounter.current}`);
        setBoardOps([]);
        return;
      }
      if (replay) setBoardOps((prev) => [...prev, ...ops]);
      else queueReveal(ops);
    },
    onAiText: (text, meta) => {
      turnEndedRef.current = false;
      teacherTextRef.current = text;
      const turn = ++turnSeqRef.current;
      turnTextRef.current.set(turn, text);
      if (turnTextRef.current.size > 20) turnTextRef.current.delete(turnTextRef.current.keys().next().value as number);
      const line: TranscriptLine = { role: "teacher", text: voiceMode && speakOn ? "" : text, kind: meta.kind, score: meta.score ?? null, cleared: meta.cleared, turn };
      // The question is shown ONCE: while it is open it lives in the check
      // card (with its options); it joins the transcript when the learner
      // answers, so the history still reads as a conversation.
      if (meta.kind === "ask" || meta.kind === "revisit_ask" || meta.kind === "predict") {
        pendingAskRef.current = { ...line, text };
        return;
      }
      // The bubble fills sentence by sentence as the audio plays (voice mode).
      setTranscript((prev) => [...prev, line]);
      if (!(voiceMode && speakOn)) setPhase("idle");
      if (meta.kind === "nudge") activeness.markNudged();
      // Scoreboard: a verdict on a check, a cleared revisit, a miss.
      const k = meta.kind;
      const score = typeof meta.score === "number" ? meta.score : null;
      if (k === "evaluate" || (k === "revisit_verdict" && meta.cleared)) {
        setStats((s) => ({ ...s, correct: s.correct + 1, streak: s.streak + 1, best: Math.max(s.best, s.streak + 1) }));
      } else if ((k === "remediate" || k === "revisit_verdict") && (score ?? 0) < 0.7) {
        setStats((s) => ({ ...s, streak: 0 }));
      }
    },
    onSegmentText: (text, index, count) => {
      segmentTextRef.current = text;
      segmentSentenceRef.current = index + Math.max(1, count) - 1;
    },
    onBeat: (ms) => {
      if (voiceMode && speakOn) queueRef.current.push({ buf: null, text: "", gap: ms });
    },
    onPace: (p) => setPace(p),
    onAudioChunk: (b64) => {
      if (!speakOn) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      chunksRef.current.push(bytes);
    },
    onAudioSegmentEnd: () => {
      const seg = takeSegment();
      const text = segmentTextRef.current;
      segmentTextRef.current = "";
      const sentenceIdx = segmentSentenceRef.current;
      if (seg) {
        queueRef.current.push({ buf: seg, text, sentence: sentenceIdx, turn: turnSeqRef.current });
        void drain();
      } else {
        // No audio for this sentence (engine hiccup): still show the words.
        revealTeacherText(text, turnSeqRef.current);
        if (syncedRef.current) revealSynced(sentenceIdx);
      }
    },
    onAudioEnd: () => {
      // Whatever the teacher has not "written" yet lands once the audio has played.
      settleBoard();
      turnEndedRef.current = true;
      const seg = takeSegment();
      if (seg) queueRef.current.push({ buf: seg, text: segmentTextRef.current, sentence: segmentSentenceRef.current, turn: turnSeqRef.current });
      segmentTextRef.current = "";
      // The bubble completes when ITS audio is over, in queue order.
      if (voiceMode && speakOn) queueRef.current.push({ buf: null, text: "", endTurn: turnSeqRef.current });
      if (drainingRef.current || queueRef.current.length) {
        void drain();
      } else {
        completeTeacherText();
        const next = pendingPhaseRef.current;
        pendingPhaseRef.current = null;
        setPhase((p) => (p === "speaking" ? (next ?? "idle") : next ?? p));
      }
    },
    onCheck: (ev) => {
      setPhoneView("teacher");
      settleBoard();
      setCheck(ev);
      setAwaiting("answer");
      applyPhase("question");
      // Revisits re-ask a concept; predictions are guesses; a Repeat or a
      // reconnect re-sends the same check: none counts as a new question.
      const key = ev.concept_id || "";
      if (!ev.predict && !ev.revisit && !ev.remediation && key && !askedRef.current.has(key)) {
        askedRef.current.add(key);
        setStats((s) => ({ ...s, asked: s.asked + 1 }));
      }
    },
    onAwait: (what) => {
      setAwaiting(what);
      if (what === "answer") applyPhase("question");
      else if (what === "done") applyPhase("media");
      else applyPhase("idle");
    },
    onTranscriptFinal: (text) => {
      if (text) flushAsk(text);
      setPhase("thinking");
    },
    onSlideDone: async (ev) => {
      setPhase("done");
      setAwaiting(null);
      setCheck(null);
      const slideType = currentSlideType();
      const current = courseSlidesRef.current.find((s) => s.slide_id === ev.slide_id);
      // The slide's own chapter first: after moving to another chapter from the
      // rail, the chapter in the URL is the one the lesson STARTED in.
      const ids = {
        chapterId: current?.chapter_id || search.chapterId || undefined,
        moduleId: current?.module_id || search.moduleId || undefined,
        subjectId: current?.subject_id || search.subjectId || undefined,
      };
      try {
        if (slideType === "QUIZ" || (ev.quiz_results?.length ?? 0) > 0) {
          // A quiz is completed through its activity log (the tracking
          // service rejects a manual mark); the server graded each answer.
          if (isDemo) return;
          await submitTutorQuizActivity({
            slideId: ev.slide_id, packageSessionId: search.packageSessionId, ...ids,
            results: ev.quiz_results ?? [],
          });
        } else {
          if (!isDemo) await markSlideCompletion({
            slideId: ev.slide_id,
            slideType,
            ...ids,
            packageSessionId: search.packageSessionId,
            completed: true,
          });
        }
      } catch {
        showNotice("Your progress for this slide could not be saved right now.");
      }
    },
    onSummary: () => {
      setPhase("done");
    },
    onEnded: (reason) => {
      stopAudio();
      const next: Disconnect = { reason: reason === "idle" || reason === "limit" || reason === "credits" ? reason : "ended" };
      // A usage-limit frame already said why; a trailing `ended` must not overwrite it.
      setDisconnected((d) => (d?.reason === "usage" ? d : next));
      setPhase("idle");
    },
    onUsageLimit: (body) => {
      stopAudio();
      setDisconnected({ reason: "usage", message: aiUsageLimitMessage(body) });
      setPhase("idle");
      // The server closes right after this frame; if it has not within a
      // moment, close our side so nothing keeps running (no reconnect offered).
      const seq = bootSeq.current;
      window.setTimeout(() => {
        if (bootSeq.current === seq) socket.disconnect();
      }, 1500);
    },
    onError: (m, isFatal) => {
      if (isFatal) setFatal(m);
      else {
        showNotice(m);
        setPhase((p) => (p === "thinking" ? "idle" : p));
      }
    },
    onClose: () => {
      setPhase((p) => (p === "done" ? p : "idle"));
      setDisconnected((d) => d ?? { reason: "lost" });
    },
  });

  // ── activeness (opt-in camera, on-device) ──
  // Stepping away pauses the teacher: what she was saying stops here, and the
  // server says she will wait. Back in front of the camera, she picks up again.
  const activeness = useActiveness({
    active: readyAt !== null && !disconnected && phase !== "connecting" && phase !== "done",
    speaking: phase === "speaking",
    questionOpen: awaiting === "answer",
    onPresence: (present) => {
      // Cut off mid-speech: the server is told, so she repeats what was missed.
      const cut = !present && phase === "speaking";
      if (cut) stopAudio();
      socket.sendPresence(present, cut);
    },
    onReport: (report) => socket.sendActiveness({ ...report }),
  });

  const currentSlideType = () =>
    courseSlidesRef.current.find((s) => s.slide_id === currentSlideRef.current)?.source_type || "DOCUMENT";

  // ── mic ──
  const recorder = useVoiceRecorder({
    onAudioChunk: (b64) => socket.sendAudioChunk(b64),
    onSilenceStop: () => {
      finishRecording();
    },
    onNoSpeech: () => {
      recorder.stopRecording();
      setMicOn(false);
      socket.sendAudioDiscard();
      setPhase("idle");
    },
    // How long a pause ends the answer. Two seconds cut students off mid-thought;
    // open questions (explain it, tell your story, give your introduction) get
    // the longest allowance, quick picks a shorter one. Tapping Done always
    // sends at once.
    silenceTimeout: check?.check_type === "open" ? 5000 : 3500,
    maxWaitForSpeechMs: 15000,
  });
  // MediaRecorder flushes its last chunk AFTER stop() returns; sending
  // audio_end at once would leave that tail in the server buffer, where it
  // corrupts the next recording's header (every second recording failed).
  const AUDIO_END_DELAY_MS = 400;
  const finishRecording = () => {
    const mime = recorder.mimeType;
    recorder.stopRecording();
    setMicOn(false);
    if (!recorder.hadSpeech()) {
      // A stray press or a quiet room: nothing to transcribe.
      socket.sendAudioDiscard();
      setPhase("idle");
      showNotice("I didn't catch anything. Tap the button and speak when you're ready.");
      return;
    }
    setPhase("thinking");
    window.setTimeout(() => socket.sendAudioEnd(mime), AUDIO_END_DELAY_MS);
  };
  const toggleMic = async () => {
    if (disconnected) return;
    if (micOn) {
      finishRecording();
      return;
    }
    // Barge-in: nothing queued may keep talking into the open microphone,
    // and nothing stale may sit in the server's audio buffer.
    stopAudio();
    socket.sendInterrupt();
    socket.sendAudioDiscard();
    const ok = await recorder.startRecording();
    if (ok) {
      setMicOn(true);
      setPhase("listening");
    } else {
      showNotice("The microphone could not be started. Check the browser's microphone permission.");
    }
  };

  // The server meters the avatar only while the learner's device shows it.
  useEffect(() => {
    if (!boot?.avatar) return;
    socket.sendConfig({ avatar: avatarActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarActive]);
  // Unlock the face's audio and connect its motion session as soon as the view
  // exists — in parallel with the first paint, not after it (that serialised
  // 2-3 s of a silent face). No second tap when the document already has user
  // activation; otherwise the gate asks for one.
  useEffect(() => {
    if (!avatarShown || !avatar.ready || avatar.activated || needsTap) return;
    void avatar.activate().then((ok) => {
      if (!ok) setNeedsTap(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarShown, avatar.ready, avatar.activated, needsTap]);
  // Opening: the server keeps the teacher quiet until this device can show and
  // play her — or until the cap, so a slow face never holds the lesson.
  useEffect(() => {
    if (readyAt === null || begunRef.current) return;
    const decide = () => {
      if (begunRef.current) return;
      const d = decideBegin({
        avatarWanted, painted: avatar.painted, activated: avatar.activated, failed: !!avatar.failed, needsTap,
        sinceReadyMs: Date.now() - readyAt,
      });
      if (d === "gate") {
        setGate(true);
        return;
      }
      if (d === "now") {
        begunRef.current = true;
        setGate(false);
        setPhase("idle");
        socket.sendBegin();
        // The demo clock counts from the first words, not from the download.
        if (guestRef.current) setDemoLeft((v) => (v === null ? (guestRef.current?.minutes ?? 10) * 60 : v));
      }
    };
    decide();
    const t = window.setTimeout(decide, Math.max(0, BEGIN_CAP_MS - (Date.now() - readyAt)) + 20);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyAt, avatarWanted, avatar.painted, avatar.activated, avatar.failed, needsTap]);
  // The one tap a cold load needs: unlock inside the gesture, then begin.
  const onGateTap = async () => {
    if (avatarShown && avatar.ready) await avatar.activate();
    setNeedsTap(false);
    setGate(false);
  };
  // Mount the face as soon as its container exists; the token request is
  // already in flight and SDK init overlaps it.
  useEffect(() => {
    const pending = pendingAvatarRef.current;
    const container = avatarContainerRef.current;
    if (!pending || !container || avatarBootedRef.current) return;
    avatarBootedRef.current = true;
    void avatar.mount(pending, container);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot?.avatar, voiceMode]);

  // Voice mode: after the audio of a no-question concept (or a topic summary)
  // has finished, continue by itself. Any tap — the mic, Doubt, typing — changes
  // `awaiting`/`micOn`/`phase` and cancels the timer. Never while the camera
  // says the learner stepped away: the teacher is waiting for them to return.
  useEffect(() => {
    if (!voiceMode || awaiting !== "continue" || phase !== "idle" || micOn || !!disconnected || activeness.away) return;
    const t = window.setTimeout(() => {
      setAwaiting(null);
      socket.sendContinue();
    }, AUTO_CONTINUE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, awaiting, phase, micOn, disconnected, activeness.away]);

  // ── boot (also used by Reconnect: the server resumes from the saved pointer) ──
  const isDemo = search.demo === "1";
  const guestRef = useRef(isDemo ? readTutorGuest() : null);
  // Public demo: a visible clock, counted from the moment the lesson opens.
  const [demoLeft, setDemoLeft] = useState<number | null>(null);
  useEffect(() => {
    if (demoLeft === null || demoLeft <= 0) return;
    const t = setInterval(() => setDemoLeft((v) => (v === null ? v : Math.max(0, v - 1))), 1000);
    return () => clearInterval(t);
  }, [demoLeft !== null && demoLeft > 0]);
  const demoClock = demoLeft === null ? undefined : `${Math.floor(demoLeft / 60)}:${String(demoLeft % 60).padStart(2, "0")}`;

  const bootSession = useCallback(async () => {
    const seq = ++bootSeq.current;
    setFatal(null);
    setDisconnected(null);
    setPhase("connecting");
    begunRef.current = false;
    setReadyAt(null);
    setGate(false);
    try {
      const [b, slides, outlineRes] = await Promise.all([
        isDemo
          ? (guestRef.current ? Promise.resolve(guestRef.current.boot) : Promise.reject(new Error("Your free lesson has expired. Start again from tutezy.ai.")))
          : startTutorSession({ packageSessionId: search.packageSessionId, slideId: search.slideId, mode: voiceMode ? "VOICE" : "TEXT" }),
        search.chapterId && !isDemo ? getTutorChapterSlides(search.chapterId, search.packageSessionId) : Promise.resolve([]),
        // Optional: without it the rail falls back to this chapter's slides.
        !isDemo && search.packageSessionId
          ? getTutorCourseOutline(search.packageSessionId).catch(() => [] as TutorOutlineChapter[])
          : Promise.resolve([] as TutorOutlineChapter[]),
      ]);
      if (seq !== bootSeq.current) {
        // The page moved on while the request was in flight: close what we opened.
        void endTutorSession(b.tutor_session_id);
        return;
      }
      setBoot(b);
      setTopics(b.topics ?? []);
      setSlideTitle(b.slide_title || "");
      setChapterSlides(slides);
      setCourseOutline(outlineRes);
      currentSlideRef.current = b.slide_id;
      sessionRef.current = b.tutor_session_id;
      socket.connect(b.socket_path);
      // Premium avatar: the session token is requested now, in parallel with
      // the socket; the face mounts once its card is in the DOM. The lesson
      // carries on with plain audio if any step fails.
      if (b.avatar && voiceMode && !avatarBootedRef.current && !pendingAvatarRef.current) {
        const tok = guestRef.current
          ? getTutorDemoAvatarToken(b.tutor_session_id, guestRef.current.token)
          : getTutorAvatarToken(b.tutor_session_id);
        tok.catch(() => undefined);
        pendingAvatarRef.current = {
          provider: "spatius",
          app_id: b.avatar.app_id,
          avatar_id: b.avatar.avatar_id,
          session_token: tok.then((t) => t.session_token),
        };
      }
    } catch (e: unknown) {
      if (seq !== bootSeq.current) return;
      const usageLimit = claimAiUsageLimit(e);
      if (usageLimit) {
        setFatal(aiUsageLimitMessage(usageLimit));
        return;
      }
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFatal(msg || (e instanceof Error ? e.message : "Could not start the tutor"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.packageSessionId, search.slideId, search.chapterId, voiceMode]);

  useEffect(() => {
    void bootSession();
    return () => {
      bootSeq.current += 1;
      socket.disconnect();
      if (sessionRef.current) void endTutorSession(sessionRef.current);
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootSession]);

  const reconnect = () => {
    stopAudio();
    syncedRef.current = false;
    setSentence(null);
    setTranscript([]);
    setCheck(null);
    setAwaiting(null);
    setLiveOps([]);
    void bootSession();
  };

  const nextSlides = useMemo(
    () => chapterSlides.map((s) => ({ ...s, current: s.slide_id === (state?.slide_id ?? boot?.slide_id) })),
    [chapterSlides, state?.slide_id, boot?.slide_id],
  );
  // The whole course in order, each slide carrying its chapter lineage; falls
  // back to this chapter's slides when the outline is unavailable.
  const courseSlides = useMemo<TutorChapterSlide[]>(
    () =>
      courseOutline.length > 0
        ? courseOutline.flatMap((ch) =>
            ch.slides.map((sl) => ({ ...sl, plan_id: null, chapter_id: ch.chapter_id, module_id: ch.module_id, subject_id: ch.subject_id })),
          )
        : chapterSlides,
    [courseOutline, chapterSlides],
  );
  courseSlidesRef.current = courseSlides;
  // "Next" continues into the next chapter instead of stopping at the chapter's end.
  const nextTeachable = useMemo(() => {
    const idx = courseSlides.findIndex((s) => s.slide_id === (state?.slide_id ?? boot?.slide_id));
    return courseSlides.slice(idx + 1).find((s) => s.teachable) || null;
  }, [courseSlides, state?.slide_id, boot?.slide_id]);

  const goToSlide = (slideId: string) => {
    stopAudio();
    stopReveal();
    revealQueueRef.current = [];
    syncQueueRef.current = [];
    syncedRef.current = false;
    setSentence(null);
    askedRef.current = new Set();
    setStats({ asked: 0, correct: 0, streak: 0, best: 0 });
    currentSlideRef.current = slideId;
    setTranscript([]);
    setCheck(null);
    setAwaiting(null);
    setLiveOps([]);
    socket.sendNextSlide(slideId);
  };

  const endAndLeave = () => {
    stopAudio();
    activeness.flush();
    socket.sendEndSession();
    setTimeout(() => {
      if (isDemo) {
        writeTutorGuest(null);
        navigate({ to: "/try", search: { done: "1" } as never });
        return;
      }
      navigate({
        to: "/study-library/courses/course-details",
        search: { courseId: search.courseId, packageSessionId: search.packageSessionId, selectedTab: search.selectedTab } as never,
      });
    }, 400);
  };

  if (fatal) {
    return (
      <LayoutContainer>
        <div className="mx-auto max-w-lg rounded-2xl border border-danger-200 bg-danger-50 p-6 text-center">
          <p className="text-sm text-danger-700">{fatal}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700" onClick={() => window.history.back()}>
              Go back
            </button>
            <button type="button" className="rounded-full bg-primary-500 px-4 py-2 text-sm text-white" onClick={reconnect}>
              Try again
            </button>
          </div>
        </div>
      </LayoutContainer>
    );
  }

  const title = slideTitle || courseSlides.find((s) => s.slide_id === (state?.slide_id ?? boot?.slide_id))?.title || "Lesson";
  const progress = state?.progress ?? boot?.progress ?? { done: 0, total: 1, percent: 0 };
  const lessonOver = phase === "done" && !audioBusy();

  const outline = (
    <TutorSidebar
      slideTitle={title}
      topics={topics}
      activeTopicId={state?.topic_id ?? null}
      progressPercent={progress.percent}
      done={progress.done}
      total={progress.total}
      nextSlides={nextSlides}
              outline={courseOutline}
              currentSlideId={state?.slide_id ?? boot?.slide_id ?? null}
      onPickSlide={(id) => {
        setOutlineOpen(false);
        goToSlide(id);
      }}
      onBack={endAndLeave}
    />
  );

  return (
    <LayoutContainer immersive enableChatbotPanel={false}>
      {/* Phones: a slim strip (teacher, status, outline) and a Board / Teacher switch. */}
      <div className="mb-2 flex items-center gap-2 lg:hidden">
        <TeacherAvatar fileId={boot?.teacher_avatar_file_id} name={boot?.teacher_name} speaking={phase === "speaking"} className="size-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-neutral-900">{boot?.teacher_name || "Teacher"}<span className="ms-1 font-normal text-neutral-500" title={`${progress.done} of ${progress.total} steps done`}>· {progress.done}/{progress.total}</span></p>
        </div>
        {demoClock && <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning-700">{demoClock}</span>}
        <div className="flex rounded-full bg-neutral-100 p-0.5" role="tablist" aria-label="View">
          {(["board", "teacher"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={phoneView === v}
              onClick={() => setPhoneView(v)}
              className={`relative rounded-full px-3 py-1 text-xs font-semibold ${phoneView === v ? "bg-white text-primary-500 shadow-sm" : "text-neutral-600"}`}
            >
              {v === "board" ? "Board" : "Teacher"}
              {v === "teacher" && phoneView === "board" && awaiting === "answer" && (
                <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-danger-500" aria-label="Your turn" />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOutlineOpen(true)}
          className="rounded-full border border-neutral-200 p-1.5 text-neutral-700"
          aria-label="Outline"
        >
          <ListBullets className="size-4" />
        </button>
      </div>
      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="bottom" className="max-h-svh overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="text-start">This lesson</SheetTitle>
          </SheetHeader>
          <div className="mt-3">{outline}</div>
        </SheetContent>
      </Sheet>

      {isDemo && (
        <div className="mb-2 flex items-center gap-x-3 gap-y-1 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm sm:px-4 sm:py-2">
          <span className="font-semibold text-neutral-900">Tutezy demo</span>
          <span className="hidden text-neutral-600 md:inline">
            {/* Length comes from the server (tutor.demo.minutes) via the guest session, never a literal. */}
            {guestRef.current?.minutes ? `A ${guestRef.current.minutes}-minute taste.` : "A short taste."} Your students would get the whole chapter, in your teacher&apos;s voice.
          </span>
          {demoClock && <span className="hidden rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning-700 lg:inline">{demoClock} left</span>}
          <a href="https://tutezy.ai/#demo" className="ms-auto shrink-0 rounded-full bg-primary-500 px-3 py-1 text-xs font-semibold text-white">Book a demo</a>
        </div>
      )}
      <div className="flex h-full min-h-0 flex-col gap-2 lg:flex-row lg:gap-3">
        <div className={`hidden min-h-0 shrink-0 overflow-y-auto rounded-2xl border border-neutral-200 bg-white transition-[width] lg:block ${outlineCollapsed ? "w-12 p-1" : "w-60 p-3"}`}>
          {outlineCollapsed ? (
            <TutorSidebar
              slideTitle={title}
              topics={topics}
              activeTopicId={state?.topic_id ?? null}
              progressPercent={progress.percent}
              done={progress.done}
              total={progress.total}
              nextSlides={nextSlides}
              outline={courseOutline}
              currentSlideId={state?.slide_id ?? boot?.slide_id ?? null}
              onPickSlide={goToSlide}
              onBack={endAndLeave}
              collapsed
              onToggleCollapse={toggleOutline}
            />
          ) : (
            <TutorSidebar
              slideTitle={title}
              topics={topics}
              activeTopicId={state?.topic_id ?? null}
              progressPercent={progress.percent}
              done={progress.done}
              total={progress.total}
              nextSlides={nextSlides}
              outline={courseOutline}
              currentSlideId={state?.slide_id ?? boot?.slide_id ?? null}
              onPickSlide={goToSlide}
              onBack={endAndLeave}
              onToggleCollapse={toggleOutline}
            />
          )}
        </div>
        <div className={`min-h-0 min-w-0 flex-1 flex-col lg:flex lg:min-h-0 ${phoneView === "board" ? "flex" : "hidden"}`}>
          {disconnected && isDemo && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-neutral-800">
              <span className="font-semibold">{disconnected.reason === "limit" ? "That was your free lesson." : "The lesson ended."}</span>
              <span>Every student of yours could learn like this, on your own content.</span>
              <a href="https://tutezy.ai/#demo" className="rounded-full bg-primary-500 px-3 py-1 text-xs font-medium text-white">Book a demo</a>
              <button type="button" onClick={endAndLeave} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700">Done</button>
            </div>
          )}
          {disconnected && !isDemo && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
              <span>{disconnected.message || DISCONNECT_TEXT[disconnected.reason]} Your place is saved.</span>
              {disconnected.reason !== "credits" && disconnected.reason !== "usage" && (
                <button type="button" onClick={reconnect} className="rounded-full bg-primary-500 px-3 py-1 text-xs font-medium text-white">
                  {disconnected.reason === "lost" ? "Reconnect" : "Continue the lesson"}
                </button>
              )}
              <button type="button" onClick={endAndLeave} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700">
                Back to {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <Whiteboard
              ops={boardOps}
              liveOps={liveOps}
              boardKey={boardKey}
              teacherName={boot?.teacher_name}
              revealKey={revealKey}
              sentence={syncedRef.current ? sentence : null}
              focusIds={focusIds}
            />
          </div>
          {lessonOver && !disconnected && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">
              <span>
                Slide complete.
                {stats.asked > 0 ? ` You got ${stats.correct} of ${stats.asked} right` : ""}
                {stats.best >= 3 ? ` · best streak ${stats.best}` : ""}
                {stats.asked > 0 ? "." : ""}
              </span>
              {nextTeachable ? (
                <button type="button" onClick={() => goToSlide(nextTeachable.slide_id)} className="rounded-full bg-primary-500 px-3 py-1 text-xs font-medium text-white">
                  Next: {nextTeachable.title || "next slide"}
                </button>
              ) : (
                <button type="button" onClick={endAndLeave} className="rounded-full bg-primary-500 px-3 py-1 text-xs font-medium text-white">
                  Back to {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}
                </button>
              )}
            </div>
          )}
        </div>
        <div className={`min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white p-3 lg:flex lg:w-80 lg:flex-none xl:w-96 ${phoneView === "teacher" ? "flex" : "hidden"}`}>
          <TeacherPanel
            compact
            teacherName={boot?.teacher_name || "Teacher"}
            teacherAvatarFileId={boot?.teacher_avatar_file_id}
            phase={phase}
            transcript={transcript}
            check={check ? { prompt: check.prompt, options: check.options, check_type: check.check_type, revisit: !!check.revisit, predict: !!check.predict } : null}
            locked={isDemo}
            countdown={demoClock}
            pace={pace}
            onPace={(p) => {
              setPace(p);
              socket.sendConfig({ pace: p });
            }}
            avatarContainerRef={boot?.avatar && voiceMode ? avatarContainerRef : undefined}
            avatarState={boot?.avatar && voiceMode ? (avatar.failed ? "failed" : !avatarOn ? "off" : avatar.painted ? "on" : "loading") : undefined}
            avatarPainted={avatar.painted}
            avatarProgress={avatar.progress}
            avatarSupersample={avatar.supersample}
            avatarErrorSoft={avatar.softFailed}
            gate={gate}
            onGateTap={() => void onGateTap()}
            avatarError={avatar.failed ?? avatar.warning ?? undefined}
            onToggleAvatar={() => setAvatarOn((v) => !v)}
            onRetryAvatar={async () => {
              if (!sessionRef.current) return;
              try {
                const tok = guestRef.current
                  ? await getTutorDemoAvatarToken(sessionRef.current, guestRef.current.token)
                  : await getTutorAvatarToken(sessionRef.current);
                await avatar.retry({ provider: "spatius", app_id: tok.app_id, avatar_id: tok.avatar_id, session_token: tok.session_token });
                setAvatarOn(true);
              } catch {
                /* stays off */
              }
            }}
            language={language}
            languages={boot?.languages ?? ["en"]}
            onLanguage={(l) => {
              if (l === language) return;
              setLanguage(l);
              socket.sendConfig({ language: l });
              showNotice(l === "hi" ? "The teacher will continue in Hindi from the next line." : "The teacher will continue in English from the next line.");
            }}
            stats={stats}
            activeness={
              <ActivenessCard
                status={activeness.status}
                score={activeness.score}
                parts={activeness.parts}
                away={activeness.away}
                attachVideo={activeness.attachVideo}
                onEnable={activeness.enable}
                onDisable={activeness.disable}
              />
            }
            awaiting={awaiting}
            voiceMode={voiceMode}
            micOn={micOn}
            speakOn={speakOn}
            notice={notice}
            disabled={!!disconnected || phase === "connecting"}
            onSendText={(t) => {
              flushAsk(t);
              setPhase("thinking");
              setAwaiting(null);
              socket.sendAnswer(t);
            }}
            onAsk={(t) => {
              setTranscript((prev) => [...prev, { role: "learner", text: t }]);
              setPhase("thinking");
              socket.sendAsk(t);
            }}
            onContinue={() => {
              setAwaiting(null);
              socket.sendContinue();
            }}
            onControl={(intent) => {
              if (intent === "skip") activeness.markSkipped();
              setAwaiting(null);
              socket.sendControl(intent);
            }}
            onToggleMic={() => void toggleMic()}
            onToggleSpeak={() => {
              setSpeakOn((v) => {
                socket.sendConfig({ speak: !v });
                if (v) stopAudio();
                return !v;
              });
            }}
            onInterrupt={() => {
              stopAudio();
              socket.sendInterrupt();
              setPhase("idle");
            }}
            onEnd={endAndLeave}
          />
        </div>
      </div>
    </LayoutContainer>
  );
}
