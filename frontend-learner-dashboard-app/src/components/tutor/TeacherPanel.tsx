import { useEffect, useRef, useState } from "react";
import { Microphone, PaperPlaneRight, SkipForward, ArrowCounterClockwise, Question, SpeakerHigh, SpeakerSlash, Stop, CheckCircle, Circle, XCircle, Fire, Eye, EyeSlash, ArrowsClockwise, SlidersHorizontal, ArrowsOut, ArrowsIn, Lock } from "@phosphor-icons/react";
import { TeacherAvatar, useTeacherPhotoUrl } from "./TeacherAvatar";
import type { TutorPace } from "@/hooks/useTutorSocket";

export interface TranscriptLine {
  role: "teacher" | "learner";
  text: string;
  /** What the teacher line is (evaluate, remediate, revisit_verdict, nudge…). */
  kind?: string;
  score?: number | null;
  cleared?: boolean;
  /** The teacher turn this line belongs to (voice mode). */
  turn?: number;
}

export interface LessonStats {
  asked: number;
  correct: number;
  streak: number;
  best: number;
}

const LANGUAGE_LABEL: Record<"en" | "hi", string> = { en: "English", hi: "हिंदी" };

const PACES: Array<{ id: TutorPace; label: string }> = [
  { id: "slower", label: "Slower" },
  { id: "slow", label: "Slow" },
  { id: "normal", label: "Medium" },
  { id: "fast", label: "Fast" },
];

/** A correct / partly / not-yet chip on a verdict line. */
const Verdict: React.FC<{ line: TranscriptLine }> = ({ line }) => {
  const k = line.kind;
  if (k !== "evaluate" && k !== "remediate" && k !== "revisit_verdict") return null;
  const score = typeof line.score === "number" ? line.score : null;
  const ok = k === "evaluate" || (k === "revisit_verdict" && line.cleared);
  const partly = !ok && score !== null && score >= 0.3;
  const cls = ok ? "bg-success-50 text-success-700 border-success-200" : partly ? "bg-warning-50 text-warning-700 border-warning-200" : "bg-neutral-100 text-neutral-600 border-neutral-200";
  const Icon = ok ? CheckCircle : partly ? Circle : XCircle;
  return (
    <span className={`mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <Icon className="size-3.5" weight="fill" /> {ok ? "Correct" : partly ? "Partly" : "Not yet"}
    </span>
  );
};

const QUESTION_KINDS = new Set(["ask", "revisit_ask", "predict"]);

/**
 * A question already said, word for word, since the learner last spoke — the
 * question spoken inside the narration and then again as its own line. Shown
 * once. Only question lines: a re-taught explanation (Repeat, welcome back)
 * is meant to be read again.
 */
const repeatsEarlierTeacherLine = (lines: TranscriptLine[], i: number): boolean => {
  const m = lines[i];
  const text = m?.text.trim() ?? "";
  if (!m || m.role !== "teacher" || !QUESTION_KINDS.has(m.kind ?? "") || text.length < 12) return false;
  for (let j = i - 1; j >= 0; j -= 1) {
    const prev = lines[j]!;
    if (prev.role === "learner") return false;
    if (prev.text.includes(text)) return true;
  }
  return false;
};

export type TutorPhase = "connecting" | "speaking" | "listening" | "thinking" | "idle" | "question" | "media" | "done";

interface TeacherPanelProps {
  teacherName: string;
  teacherAvatarFileId?: string | null;
  phase: TutorPhase;
  transcript: TranscriptLine[];
  check: { prompt: string | null; options: string[]; check_type: string | null; revisit?: boolean; predict?: boolean } | null;
  /** The teacher's speaking pace, chosen by the learner. */
  pace?: TutorPace;
  onPace?: (pace: TutorPace) => void;
  /** Premium teacher avatar: the container the SDK renders into, its state, and a hide/show toggle. */
  avatarContainerRef?: React.RefObject<HTMLDivElement>;
  avatarState?: "loading" | "on" | "off" | "failed";
  onToggleAvatar?: () => void;
  /** Why the avatar stopped (vendor error code or message), and a way to start it again. */
  avatarError?: string;
  /** `avatarError` is a plain sentence (this device cannot carry the face), not a vendor error. */
  avatarErrorSoft?: boolean;
  onRetryAvatar?: () => void;
  /** Draw the face at this multiple of the card and scale it down: sharper on 1x–1.5x screens. */
  avatarSupersample?: number;
  /** The SDK has drawn its first frame: the photo poster cross-fades to the live face. */
  avatarPainted?: boolean;
  /** Asset download 0..1 while the face loads; null when unknown. */
  avatarProgress?: number | null;
  /** Cold load: the browser needs a tap before any audio — asked once, before the teacher speaks. */
  gate?: boolean;
  onGateTap?: () => void;
  /** Public demo: dials are shown but locked, and the header carries the time left. */
  locked?: boolean;
  countdown?: string;
  /** The lesson language and the ones the course allows switching to. */
  language?: "en" | "hi";
  languages?: Array<"en" | "hi">;
  onLanguage?: (language: "en" | "hi") => void;
  /** Checks asked / answered right in this slide, and the streak. */
  stats?: LessonStats;
  awaiting: "continue" | "answer" | "done" | null;
  voiceMode: boolean;
  micOn: boolean;
  speakOn: boolean;
  onSendText: (text: string) => void;
  onAsk: (text: string) => void;
  onContinue: () => void;
  onControl: (intent: "repeat" | "skip" | "slower" | "faster" | "doubt" | "done") => void;
  onToggleMic: () => void;
  onToggleSpeak: () => void;
  onInterrupt: () => void;
  onEnd: () => void;
  /** Transient server notice (a failed transcription, a slide that cannot be opened). */
  notice?: string | null;
  /** Socket gone: inputs are inert until the learner reconnects. */
  disabled?: boolean;
  /** Phones: the page shows its own teacher strip, so the panel header hides below lg. */
  compact?: boolean;
  /** Opt-in camera activeness card (consent, preview, live score); laptops only. */
  activeness?: React.ReactNode;
}

const PHASE_LABEL: Record<TutorPhase, string> = {
  connecting: "Connecting…",
  speaking: "Speaking…",
  listening: "Listening…",
  thinking: "Thinking…",
  idle: "Ready",
  question: "Your turn",
  media: "Watch, then tap Done",
  done: "Slide complete",
};

/** Right rail: the teacher, the conversation, the check, and the controls. */
export const TeacherPanel: React.FC<TeacherPanelProps> = ({
  teacherName, teacherAvatarFileId, phase, transcript, check, awaiting, voiceMode, micOn, speakOn,
  onSendText, onAsk, onContinue, onControl, onToggleMic, onToggleSpeak, onInterrupt, onEnd,
  notice, disabled, pace, onPace, stats, language, languages, onLanguage,
  avatarContainerRef, avatarState, onToggleAvatar, avatarError, avatarErrorSoft, onRetryAvatar, avatarPainted, avatarProgress, avatarSupersample = 1, gate, onGateTap, locked, countdown, activeness,
}) => {
  const photoUrl = useTeacherPhotoUrl(teacherAvatarFileId);
  const [text, setText] = useState("");
  const [askMode, setAskMode] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  // The options popover closes on an outside tap or Escape.
  useEffect(() => {
    if (!optionsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!optionsRef.current?.contains(e.target as Node)) setOptionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOptionsOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [optionsOpen]);

  // The question card sits at the end of the list, so its arrival must scroll
  // too — keyed on transcript length alone, the card (and its last options)
  // landed below the fold behind the answer bar. phase / micOn: the voice
  // guidance line appears a beat later and shrinks the list after the scroll.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript.length, check?.prompt, awaiting, phase, micOn]);

  // The teacher's words are revealed INTO the current bubble while she speaks,
  // so the list grows with no new message and no effect above fires — the
  // question card kept ending up behind the answer bar. Follow any growth of
  // the list while the student is at (or near) the bottom; never pull them
  // down if they have scrolled up to re-read.
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    const follow = new MutationObserver(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    follow.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      follow.disconnect();
    };
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (askMode || awaiting !== "answer") onAsk(t);
    else onSendText(t);
    setText("");
    setAskMode(false);
  };

  const avatarShown = !!avatarContainerRef && (avatarState === "on" || avatarState === "loading");
  const avatarUsable = !!avatarContainerRef && avatarState !== "failed" && !!onToggleAvatar;

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const canFullscreen = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  const hasOptions = (!!onLanguage && (languages?.length ?? 0) > 1) || (voiceMode && !!onPace) || canFullscreen;
  const scoreChip = stats && stats.asked > 0 ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs">
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-800">{stats.correct}/{stats.asked} right</span>
      {stats.streak >= 2 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-50 px-1.5 py-0.5 font-medium text-warning-700">
          <Fire className="size-3" weight="fill" /> {stats.streak}
        </span>
      )}
    </span>
  ) : null;
  const optionsButton = (onDark: boolean) =>
    hasOptions ? (
      <button
        type="button"
        onClick={() => setOptionsOpen((v) => !v)}
        aria-expanded={optionsOpen}
        aria-label="Lesson options"
        title="Language and pace"
        className={onDark ? "rounded-full bg-neutral-900/40 p-1.5 text-white hover:bg-neutral-900/60" : "rounded-full p-2 text-neutral-500 hover:bg-neutral-100"}
      >
        <SlidersHorizontal className="size-4" />
      </button>
    ) : null;

  const Segmented = <T extends string>({ label, items, value, onPick }: { label: string; items: Array<{ id: T; label: string }>; value?: T; onPick: (v: T) => void }) => (
    <div className="flex min-w-0 items-center justify-between gap-2" role="group" aria-label={label}>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
        {locked && <Lock className="size-3" weight="fill" />} {label}
      </span>
      <div className={`flex shrink-0 flex-nowrap gap-0.5 rounded-full bg-neutral-100 p-0.5 ${locked ? "opacity-60" : ""}`} title={locked ? "Students can change this in the full product" : undefined}>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            disabled={locked}
            onClick={() => onPick(it.id)}
            aria-pressed={value === it.id}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed ${value === it.id ? "bg-white font-semibold text-primary-500 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The teacher: an animated avatar card when it is on, otherwise the photo row.
          The card keeps its final size from the first render; the teacher's photo
          stands in until the SDK paints, then cross-fades to the live face. */}
      {avatarContainerRef && (
        <div className={`relative overflow-hidden rounded-2xl bg-primary-100 ${avatarShown ? "aspect-[21/9] w-full lg:aspect-video" : "h-0"}`}>
          <div
            ref={avatarContainerRef}
            className={`size-full origin-top-left transition-opacity duration-700 ${avatarPainted ? "opacity-100" : "opacity-0"}`}
            // Genuinely dynamic value (screen pixel ratio): the SDK sizes its canvas from this
            // box's layout size, so a larger box scaled down renders the face with more pixels.
            style={avatarSupersample > 1 ? { width: `${avatarSupersample * 100}%`, height: `${avatarSupersample * 100}%`, transform: `scale(${1 / avatarSupersample})` } : undefined}
            aria-label={`${teacherName}'s avatar`}
          />
          {avatarShown && (
            <div className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${avatarPainted ? "opacity-0" : "opacity-100"}`} aria-hidden={avatarPainted}>
              {photoUrl ? (
                <img src={photoUrl} alt="" className="size-full object-cover" />
              ) : (
                // No photo: a quiet placeholder. The illustrated face would read
                // as a different teacher than the one about to fade in.
                <div className="flex size-full animate-pulse items-center justify-center bg-gradient-to-b from-primary-50 to-primary-100">
                  <span className="font-semibold text-3xl text-primary-500/70">{teacherName.trim().charAt(0).toUpperCase() || "T"}</span>
                </div>
              )}
              {avatarState === "loading" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
                  {/* Genuinely dynamic value (download progress); same idiom as TutorSidebar's progress bar. */}
                  <div
                    className="h-full bg-white transition-[width] duration-300"
                    style={{ width: `${Math.round((avatarProgress ?? 0) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {avatarShown && gate && onGateTap && (
            <button
              type="button"
              onClick={onGateTap}
              className="absolute inset-0 flex items-center justify-center bg-neutral-900/35"
              aria-label="Tap to begin"
            >
              <span className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-lg">Tap to begin</span>
            </button>
          )}
          {avatarShown && (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-900/75 to-transparent" />
              <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{teacherName}</p>
                  <p className="flex items-center gap-1.5 text-xs text-neutral-200">
                    {phase === "speaking" && <span className="inline-block size-1.5 animate-pulse rounded-full bg-success-500" />}
                    {avatarState === "loading"
                      ? typeof avatarProgress === "number" && avatarProgress > 0 && avatarProgress < 1
                        ? `Getting your teacher ready · ${Math.round(avatarProgress * 100)}%`
                        : "Getting your teacher ready…"
                      : gate ? "Ready when you are" : PHASE_LABEL[phase]}
                    {stats && stats.asked > 0 && <span className="ms-1 rounded-full bg-white/15 px-1.5 py-px text-white">{stats.correct}/{stats.asked} right{stats.streak >= 2 ? ` · 🔥${stats.streak}` : ""}</span>}
                    {countdown && <span className="ms-1 rounded-full bg-warning-500 px-1.5 py-px font-semibold tabular-nums text-white">{countdown}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {phase === "speaking" && (
                    <button type="button" onClick={onInterrupt} className="rounded-full bg-neutral-900/40 p-1.5 text-white hover:bg-neutral-900/60" title="Stop">
                      <Stop className="size-4" weight="fill" />
                    </button>
                  )}
                  {voiceMode && (
                    <button type="button" onClick={onToggleSpeak} className="rounded-full bg-neutral-900/40 p-1.5 text-white hover:bg-neutral-900/60" title={speakOn ? "Mute teacher" : "Unmute teacher"}>
                      {speakOn ? <SpeakerHigh className="size-4" /> : <SpeakerSlash className="size-4" />}
                    </button>
                  )}
                  {optionsButton(true)}
                  {avatarUsable && avatarState === "on" && (
                    <button type="button" onClick={onToggleAvatar} className="rounded-full bg-neutral-900/40 p-1.5 text-white hover:bg-neutral-900/60" title="Hide the teacher">
                      <EyeSlash className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {!avatarShown && (
        <div className="flex items-center gap-3 border-b border-neutral-200 pb-3">
          <TeacherAvatar fileId={teacherAvatarFileId} name={teacherName} speaking={phase === "speaking"} className="size-12" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-900">{teacherName}</p>
            <p className="text-xs text-neutral-500">{gate ? "Ready when you are" : PHASE_LABEL[phase]}</p>
          </div>
          {gate && onGateTap && (
            <button type="button" onClick={onGateTap} className="shrink-0 rounded-full bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white">
              Tap to begin
            </button>
          )}
          {scoreChip}
          {countdown && <span className="shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-warning-700">{countdown}</span>}
          {optionsButton(false)}
          {avatarUsable && avatarState === "off" && (
            <button type="button" onClick={onToggleAvatar} className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100" title="Show the teacher">
              <Eye className="size-4" />
            </button>
          )}
          {avatarState === "failed" && onRetryAvatar && (
            <button type="button" onClick={onRetryAvatar} className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100" title={`Restart the teacher avatar${avatarError ? ` (${avatarError})` : ""}`}>
              <ArrowsClockwise className="size-4" />
            </button>
          )}
          {voiceMode && (
            <button type="button" onClick={onToggleSpeak} className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100" title={speakOn ? "Mute teacher" : "Unmute teacher"}>
              {speakOn ? <SpeakerHigh className="size-4" /> : <SpeakerSlash className="size-4" />}
            </button>
          )}
          {phase === "speaking" && (
            <button type="button" onClick={onInterrupt} className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100" title="Stop">
              <Stop className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Language and pace live in a small popover so the conversation keeps the height. */}
      {hasOptions && optionsOpen && (
        <div className="relative">
          <div ref={optionsRef} className="absolute inset-x-0 top-1 z-20 space-y-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg" role="dialog" aria-label="Lesson options">
            {onLanguage && (languages?.length ?? 0) > 1 && (
              <Segmented label="Language" items={(languages ?? []).map((l) => ({ id: l, label: LANGUAGE_LABEL[l] }))} value={language} onPick={onLanguage} />
            )}
            {voiceMode && onPace && <Segmented label="Pace" items={PACES} value={pace} onPick={onPace} />}
            {locked && <p className="text-xs text-neutral-500">Language and pace are chosen by the student in the full product.</p>}
            {canFullscreen && (
              <button type="button" onClick={toggleFullscreen} className="flex w-full items-center justify-between rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-200">
                <span className="uppercase tracking-wide text-neutral-500">Screen</span>
                <span className="inline-flex items-center gap-1 font-medium">
                  {isFullscreen ? <ArrowsIn className="size-3.5" /> : <ArrowsOut className="size-3.5" />}
                  {isFullscreen ? "Exit full screen" : "Full screen"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {activeness}

      {avatarError && !gate && (avatarState === "failed" || avatarState === "on") && (
        <p role="status" className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600">
          {avatarErrorSoft ? (
            avatarError
          ) : (
            <>
              {avatarState === "failed" ? "Teacher avatar stopped: " : "Teacher avatar hiccup: "}
              <span className="font-mono">{avatarError}</span>
            </>
          )}
          {avatarState === "failed" && onRetryAvatar && (
            <button type="button" onClick={onRetryAvatar} className="ms-2 font-medium text-primary-500 hover:underline">Try again</button>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-1.5 text-xs text-warning-700">
          {notice}
        </p>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
        {transcript.map((m, i) => (
          // While the question card is up it IS the question; the spoken prompt's
          // own bubble would show the same sentence a second time. The same
          // teacher line twice in a row (a re-asked question) shows once.
          (check && awaiting === "answer" && m.role === "teacher" && m.text.trim() === (check.prompt || "").trim()) ||
          repeatsEarlierTeacherLine(transcript, i) ||
          // A turn cut off before any of it was spoken (barge-in, stepped away).
          (m.role === "teacher" && !m.text.trim() && i < transcript.length - 1) ? null : (
          <div key={i} className={`flex ${m.role === "learner" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-md rounded-2xl px-3 py-2 text-sm ${m.role === "learner" ? "bg-primary-500 text-white" : m.kind === "nudge" ? "border border-warning-200 bg-warning-50 text-neutral-800" : "bg-neutral-100 text-neutral-800"}`}>
              {m.role === "teacher" && (m.kind === "evaluate" || m.kind === "remediate" || m.kind === "revisit_verdict") && (
                <div><Verdict line={m} /></div>
              )}
              {m.text}
            </div>
          </div>
          )
        ))}
        {check && awaiting === "answer" && (
          <div className="rounded-xl border border-primary-200 bg-primary-50 p-3">
            <p className="text-xs font-semibold uppercase text-primary-500">{check.predict ? "Your guess" : check.revisit ? "Quick revisit · one try" : "Question"}</p>
            <p className="mt-1 text-sm text-neutral-900">{check.prompt}</p>
            {check.options.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {check.options.map((o, i) => (
                  <button key={i} type="button" onClick={() => onSendText(o)} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-start text-sm hover:border-primary-300">
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`space-y-1.5 border-t border-neutral-200 pt-2 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        <div className="flex flex-wrap items-center gap-1">
          {awaiting === "continue" && (
            <button
              type="button"
              onClick={onContinue}
              className={`rounded-full bg-primary-500 px-3 py-1 text-xs font-medium text-white ${voiceMode ? "" : "animate-pulse ring-2 ring-primary-200"}`}
            >
              {voiceMode ? "Continue now" : "Continue"}
            </button>
          )}
          {awaiting === "done" && (
            <button type="button" onClick={() => onControl("done")} className="rounded-full bg-primary-500 px-3 py-1 text-xs font-medium text-white">I'm done</button>
          )}
          <button type="button" onClick={() => onControl("repeat")} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50"><ArrowCounterClockwise className="size-3" /> Repeat</button>
          <button type="button" onClick={() => setAskMode((v) => !v)} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${askMode ? "border-primary-500 bg-primary-50 text-primary-500" : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`}><Question className="size-3" /> Doubt</button>
          <button type="button" onClick={() => onControl("skip")} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50"><SkipForward className="size-3" /> Skip</button>
          <button type="button" onClick={onEnd} className="ms-auto shrink-0 rounded-full px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-danger-600">End</button>
        </div>
        {/* Voice answers are tap-to-talk. Most voice sessions used to end without a
            single answer: students spoke to a microphone that was never on. */}
        {voiceMode && awaiting === "answer" && !micOn && phase !== "speaking" && phase !== "thinking" && (
          <p role="status" className="text-xs font-medium text-primary-500">
            <Microphone className="me-1 inline size-3.5 align-text-bottom" weight="fill" />
            Tap <span className="font-semibold">Answer</span>, then speak — it sends when you pause. Or type below.
          </p>
        )}
        {voiceMode && micOn && (
          <p role="status" className="text-xs font-medium text-danger-500">Listening… tap Done when you finish.</p>
        )}
        <div className="flex items-center gap-2">
          {voiceMode && (
            <button
              type="button"
              onClick={onToggleMic}
              disabled={phase === "thinking" || phase === "connecting"}
              aria-pressed={micOn}
              className={`flex shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                micOn
                  ? "bg-danger-500 text-white animate-pulse"
                  : `bg-primary-500 text-white hover:bg-primary-400 ${awaiting === "answer" && phase !== "speaking" ? "ring-4 ring-primary-200 animate-pulse" : ""}`
              }`}
            >
              <Microphone className="size-5" weight="fill" />
              {micOn ? "Done" : awaiting === "answer" ? "Answer" : "Speak"}
            </button>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={askMode ? "Ask your doubt…" : awaiting === "answer" ? (check?.predict ? "Take a guess…" : "Type your answer…") : "Say something or ask…"}
            className="min-w-0 flex-1 rounded-full border border-neutral-200 px-4 py-2 text-sm outline-none focus:border-primary-400"
          />
          <button type="button" onClick={submit} className="rounded-full bg-primary-500 p-2 text-white" title="Send">
            <PaperPlaneRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
