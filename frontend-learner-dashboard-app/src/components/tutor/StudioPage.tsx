import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  CircleNotch,
  FilePdf,
  Lightbulb,
  Microphone,
  PencilSimpleLine,
  Sparkle,
  TextT,
  YoutubeLogo,
} from "@phosphor-icons/react";
import {
  createTutorStudioJob,
  getTutorStudioConfig,
  getTutorStudioJob,
  startTutorDemo,
  tutorStudioQrUrl,
  TUTOR_LANGUAGE_LABEL,
  type TutorLanguage,
  type TutorStudioConfig,
  type TutorStudioJob,
  type TutorStudioKind,
} from "@/services/tutor-api";
import { writeTutorGuest } from "@/lib/tutorGuest";
import { preloadAvatarKit } from "@/hooks/useSpatiusAvatar";
import { cn } from "@/lib/utils";

/**
 * Tutezy Studio: name a topic (or hand over a PDF / YouTube link) and a live
 * AI teacher teaches it about a minute later. Made for the exhibition
 * stall: runs full-screen on a TV with a hand-held microphone (`?k=<kiosk
 * code>`), and on a visitor's own phone from the QR (`?v=<visitor code>`).
 *
 * Three screens in one page: build → building (the wait is part of the show)
 * → after the lesson (take it home, get it for your institute).
 */
export interface StudioSearch {
  /** Kiosk code (stall screen). */
  k?: string;
  /** Visitor code (phones, from the QR). */
  v?: string;
  /** Topic key of the lesson that just ended. */
  done?: string;
  /** Its title and how many seconds it took to build. */
  t?: string;
  s?: string;
}

export const parseStudioSearch = (search: Record<string, unknown>): StudioSearch => {
  const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
  return { k: str(search.k), v: str(search.v), done: str(search.done), t: str(search.t), s: str(search.s) };
};

const CODE_KEY = "tutor.studio.code";
const TUTEZY = "https://tutezy.ai";
const LEARNER = "https://learner.vacademy.io";
/** The closing screen returns to the start by itself on the stall screen. */
const KIOSK_RESET_SECONDS = 75;

const SAMPLES = [
  "Photosynthesis for class 7",
  "Pythagoras theorem",
  "How UPI works",
  "GST basics for commerce students",
  "Newton's third law",
  "Fire safety at the workplace",
];

const STEPS = [
  { label: "Reading what you asked for", icon: Lightbulb },
  { label: "Writing the lesson plan", icon: PencilSimpleLine },
  { label: "Drawing the whiteboard", icon: TextT },
  { label: "Waking the teacher", icon: Sparkle },
] as const;

/** Shown one at a time while the lesson is being built. All true of the product today. */
const FACTS = [
  "The same engine reads your PDFs, your videos and your whole course.",
  "She teaches in English, Hindi, Kannada and Bengali.",
  "She can speak in your own teacher's voice, with your teacher's face.",
  "Every answer is saved, so teachers see who understood what.",
  "It runs under your brand, inside your own app and website.",
];

/** Kannada before Bengali: the stall is in Bengaluru. */
const LANGUAGE_ORDER: TutorLanguage[] = ["en", "hi", "kn", "bn"];

const SPEECH_LOCALE: Record<TutorLanguage, string> = { en: "en-IN", hi: "hi-IN", bn: "bn-IN", kn: "kn-IN" };

interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognizer {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognizerCtor = new () => SpeechRecognizer;

function speechRecognizer(): SpeechRecognizerCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognizerCtor; webkitSpeechRecognition?: SpeechRecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Ask for the microphone once and release it straight away; false if blocked or absent. */
async function micAllowed(): Promise<boolean> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) || "";
  } catch {
    return "";
  }
}

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function StudioPage({ search }: { search: StudioSearch }) {
  const navigate = useNavigate();
  const [code] = useState(() => {
    const fromLink = search.k || search.v || "";
    if (fromLink) {
      try {
        localStorage.setItem(CODE_KEY, fromLink);
      } catch {
        /* private mode: the code lives for this page only */
      }
      return fromLink;
    }
    return readCode();
  });
  const [config, setConfig] = useState<TutorStudioConfig | null>(null);
  const [locked, setLocked] = useState(false);

  const [kind, setKind] = useState<TutorStudioKind>("topic");
  const [topic, setTopic] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<TutorLanguage>("en");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<"VOICE" | "TEXT">("VOICE");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");

  const [job, setJob] = useState<TutorStudioJob | null>(null);
  const [asked, setAsked] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [starting, setStarting] = useState(false);
  const startedAtRef = useRef(0);
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const kiosk = config?.role === "kiosk";
  const building = job !== null && (job.status === "QUEUED" || job.status === "WRITING" || job.status === "BUILDING" || starting);

  const loadConfig = useCallback(() => {
    if (!code) {
      setLocked(true);
      return;
    }
    getTutorStudioConfig(code)
      .then((c) => {
        setConfig(c);
        setLocked(false);
      })
      .catch(() => setLocked(true));
  }, [code]);
  useEffect(loadConfig, [loadConfig]);

  // The counter and the "just made" line stay fresh on a screen that is open all day.
  useEffect(() => {
    if (!config || building) return;
    const t = window.setInterval(loadConfig, 60000);
    return () => window.clearInterval(t);
  }, [config, building, loadConfig]);

  const reset = useCallback(() => {
    setJob(null);
    setStarting(false);
    setTopic("");
    setLink("");
    setFile(null);
    setName("");
    setOrg("");
    setPhone("");
    setError("");
    setKind("topic");
    navigate({ to: "/studio", search: {} as never, replace: true });
    loadConfig();
  }, [navigate, loadConfig]);

  // ── speak the topic (the stall's hand-held microphone) ──
  const canListen = useMemo(() => speechRecognizer() !== null, []);
  const toggleListen = () => {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    const Ctor = speechRecognizer();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = SPEECH_LOCALE[language];
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const heard = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (heard) setTopic(heard.slice(0, 200));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognizerRef.current = r;
    setError("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  };
  useEffect(() => () => recognizerRef.current?.stop(), []);

  // ── build ──
  const build = async () => {
    const who = name.trim();
    const text = kind === "topic" ? topic.trim() : link.trim();
    if (!who) {
      setError("Tell the teacher your first name.");
      return;
    }
    if (kind === "pdf" ? !file : text.length < 2) {
      setError(kind === "topic" ? "Name a topic first. Anything you teach." : kind === "pdf" ? "Choose a PDF first." : "Paste a YouTube link first.");
      return;
    }
    setError("");
    recognizerRef.current?.stop();
    if (mode === "VOICE") {
      // Ask for the microphone inside this tap, long before the lesson starts.
      const ok = await micAllowed();
      if (!ok) {
        setError("We couldn't use the microphone. Allow it in the browser's address bar, or choose Type my answers.");
        return;
      }
      // The animated teacher's SDK downloads while the lesson is being built.
      void preloadAvatarKit().catch(() => undefined);
    }
    try {
      startedAtRef.current = Date.now();
      setElapsed(0);
      setAsked(kind === "topic" ? text : kind === "pdf" ? file?.name ?? "your PDF" : "your video");
      const { job_id } = await createTutorStudioJob({
        code,
        kind,
        text: kind === "pdf" ? undefined : text,
        file: kind === "pdf" ? file ?? undefined : undefined,
        name: who,
        language,
        org: org.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setJob({ id: job_id, status: "QUEUED", kind, title: null, language, topic_key: null, error: null, seconds: null, elapsed: 0 });
    } catch (e: unknown) {
      setError(errorDetail(e, "We couldn't start that. Please try again in a moment."));
    }
  };

  // Poll the build, and tick the on-screen clock.
  const jobId = job?.id;
  const jobActive = job !== null && (job.status === "QUEUED" || job.status === "WRITING" || job.status === "BUILDING");
  useEffect(() => {
    if (!jobId || !jobActive) return;
    let stop = false;
    const poll = async () => {
      try {
        const next = await getTutorStudioJob(jobId);
        if (!stop) setJob(next);
      } catch {
        /* a dropped poll on venue Wi-Fi: the next one catches up */
      }
    };
    const p = window.setInterval(() => void poll(), 1200);
    const c = window.setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 250);
    return () => {
      stop = true;
      window.clearInterval(p);
      window.clearInterval(c);
    };
  }, [jobId, jobActive]);

  // Ready: straight into the lesson, no extra tap.
  const readyKey = job?.status === "READY" ? job.topic_key : null;
  useEffect(() => {
    if (!readyKey || !job || starting) return;
    setStarting(true);
    const who = name.trim() || "Friend";
    const builtIn = Math.max(1, Math.round(job.seconds ?? (Date.now() - startedAtRef.current) / 1000));
    startTutorDemo({ name: who, topicKey: readyKey, language: job.language, mode, studioCode: code })
      .then((r) => {
        writeTutorGuest({
          token: r.token,
          boot: r.boot,
          minutes: r.minutes,
          name: who,
          topicKey: readyKey,
          returnTo: "/studio",
          builtInSeconds: builtIn,
          title: job.title ?? undefined,
        });
        navigate({
          to: "/study-library/courses/course-details/tutor",
          search: { courseId: "demo", packageSessionId: "demo", slideId: r.boot.slide_id, mode: mode === "VOICE" ? "voice" : "text", demo: "1" } as never,
        });
      })
      .catch((e: unknown) => {
        setStarting(false);
        setJob(null);
        setError(errorDetail(e, "The lesson is ready but could not start. Please try once more."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);

  // A build that was refused or failed goes back to the form with the reason.
  useEffect(() => {
    if (!job || (job.status !== "REJECTED" && job.status !== "FAILED")) return;
    setError(job.error || "We could not build that lesson. Try another topic.");
    setJob(null);
  }, [job]);

  // ── closing screen: back to the start by itself on the stall screen ──
  const [resetIn, setResetIn] = useState(KIOSK_RESET_SECONDS);
  const showDone = !!search.done && !job;
  useEffect(() => {
    if (!showDone || !kiosk) return;
    setResetIn(KIOSK_RESET_SECONDS);
    const t = window.setInterval(() => setResetIn((v) => v - 1), 1000);
    return () => window.clearInterval(t);
  }, [showDone, kiosk]);
  useEffect(() => {
    if (showDone && kiosk && resetIn <= 0) reset();
  }, [showDone, kiosk, resetIn, reset]);

  const step = !job ? 0 : starting || job.status === "READY" ? 3 : job.status === "BUILDING" ? 2 : elapsed > 1.5 ? 1 : 0;
  const fact = FACTS[Math.floor(elapsed / 6) % FACTS.length];
  const recentTitles = useMemo(() => Array.from(new Set((config?.recent ?? []).map((r) => r.title))).slice(0, 5), [config]);
  const didac = (config?.event ?? "").toLowerCase().includes("didac");
  const bookLink = didac ? "https://vacademy.io/didac/?src=tutezy-studio" : `${TUTEZY}/#demo`;

  return (
    <main className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-neutral-50 text-neutral-900">
      <div className="mx-auto flex min-h-full w-full max-w-screen-2xl flex-col px-4 py-5 sm:px-8 lg:px-12 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={reset} className="flex flex-col items-start gap-1" aria-label="Start again">
            <img src="/tutezy-logo.png" alt="tutezy.ai" className="h-9 w-auto lg:h-12" />
            <span className="text-xs font-medium tracking-wide text-neutral-500 lg:text-sm">AI live classes · by Vacademy</span>
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {config?.event ? (
              <span className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 lg:px-4 lg:py-1.5 lg:text-base">{config.event}</span>
            ) : null}
            {config && config.made > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-500 lg:px-4 lg:py-1.5 lg:text-base">
                <Sparkle className="size-4" weight="fill" /> {config.made.toLocaleString("en-IN")} lessons made here
              </span>
            ) : null}
          </div>
        </header>

        {locked ? (
          <section className="m-auto w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-2xl font-bold">This screen opens at the Vacademy stall.</h1>
            <p className="mt-2 text-neutral-600">Scan the code on our screen to build a lesson on your own phone, or take a ready-made lesson right now.</p>
            <a href={`${LEARNER}/try`} className="mt-5 inline-block rounded-full bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white">Take a free lesson</a>
          </section>
        ) : !config ? (
          <p className="m-auto flex items-center gap-2 text-neutral-500"><CircleNotch className="size-5 animate-spin" /> Getting the studio ready…</p>
        ) : building ? (
          <section className="m-auto grid w-full max-w-6xl gap-8 py-8 lg:grid-cols-5 lg:gap-12" aria-live="polite">
            <div className="lg:col-span-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary-500 lg:text-lg">Building your lesson</p>
              <h1 className="mt-2 break-words text-3xl font-bold leading-tight sm:text-4xl lg:text-6xl">{job?.title || asked}</h1>
              <ol className="mt-8 space-y-3 lg:space-y-5">
                {STEPS.map((s, i) => {
                  const Icon = s.icon;
                  const done = i < step;
                  const active = i === step;
                  return (
                    <li key={s.label} className={cn("flex items-center gap-3 text-lg lg:gap-5 lg:text-3xl", done ? "text-neutral-900" : active ? "font-semibold text-neutral-900" : "text-neutral-400")}>
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full lg:size-14", done ? "bg-success-500 text-white" : active ? "bg-primary-500 text-white" : "bg-neutral-200 text-neutral-500")}>
                        {done ? <Check className="size-5 lg:size-8" weight="bold" /> : active ? <CircleNotch className="size-5 animate-spin lg:size-8" /> : <Icon className="size-5 lg:size-8" />}
                      </span>
                      {s.label}
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="flex flex-col justify-between gap-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm lg:col-span-2 lg:p-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-base">On the clock</p>
                <p className="mt-1 text-6xl font-bold tabular-nums text-primary-500 lg:text-8xl">{clock(elapsed)}</p>
                <p className="mt-2 text-sm text-neutral-600 lg:text-xl">Most lessons are ready in about a minute.</p>
              </div>
              <div className="rounded-xl bg-primary-50 p-4 lg:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-500 lg:text-base">While you wait</p>
                <p className="mt-1 text-lg font-semibold leading-snug lg:text-3xl">{fact}</p>
              </div>
            </div>
          </section>
        ) : showDone ? (
          <section className="m-auto grid w-full max-w-6xl gap-8 py-8 lg:grid-cols-2 lg:gap-12">
            <div className="flex flex-col justify-center">
              {search.t ? <p className="text-sm font-semibold uppercase tracking-wide text-primary-500 lg:text-lg">{search.t}</p> : null}
              <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl lg:text-6xl">
                {search.s ? `That lesson did not exist ${search.s} seconds before you started it.` : "You named it. She taught it."}
              </h1>
              <p className="mt-4 text-lg text-neutral-600 lg:text-2xl">
                Now picture every chapter of your syllabus taught like this: from your own notes and videos, in your teachers&apos; voice, under your brand.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-full bg-primary-500 px-6 py-3 text-base font-semibold text-white lg:px-8 lg:py-4 lg:text-2xl">
                  Build another lesson <ArrowRight className="size-5 lg:size-7" weight="bold" />
                </button>
                {kiosk ? <span className="text-sm tabular-nums text-neutral-500 lg:text-lg">Next visitor in {Math.max(0, resetIn)} s</span> : null}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
              <QrCard
                title={kiosk ? "Take this lesson home" : "Keep this lesson"}
                text={kiosk ? "Scan to open the same lesson on your phone and finish it." : "Tap to open it again any time, or scan it from another phone."}
                link={`${LEARNER}/try?topic=${encodeURIComponent(search.done ?? "")}`}
                tappable={!kiosk}
              />
              <QrCard
                title="Get this for your institute"
                text={kiosk ? "Scan to book 15 minutes with our team, or just ask us here at the stall." : "Scan or tap to book 15 minutes with our team."}
                link={bookLink}
                tappable={!kiosk}
              />
            </div>
          </section>
        ) : (
          <section className="m-auto grid w-full gap-8 py-6 lg:grid-cols-2 lg:gap-12 lg:py-8">
            <div className="flex flex-col justify-center">
              <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-7xl">
                Name any topic. <span className="text-primary-500">Meet its AI teacher</span> in about a minute.
              </h1>
              <p className="mt-4 text-lg text-neutral-600 lg:text-2xl">
                She writes on a whiteboard, explains aloud, asks you a question and listens to your answer. Built in front of you from a topic, a PDF or a video.
              </p>
              <ul className="mt-6 hidden space-y-2 text-base text-neutral-700 sm:block lg:space-y-3 lg:text-xl">
                {["Your syllabus, not ours: any subject, any class, any course", "English, हिंदी, ಕನ್ನಡ and বাংলা", "Your teacher's voice and face, under your brand"].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-1 size-5 shrink-0 text-success-500 lg:size-6" weight="bold" /> {line}
                  </li>
                ))}
              </ul>
              {recentTitles.length > 0 ? (
                <p className="mt-6 hidden text-sm text-neutral-500 sm:block lg:text-lg">
                  <span className="font-semibold text-neutral-700">Just made here:</span> {recentTitles.join(" · ")}
                </p>
              ) : null}
              {kiosk && config.visitor_link ? (
                <div className="mt-6 hidden items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 lg:flex">
                  <img src={tutorStudioQrUrl(config.visitor_link)} alt="Scan to build a lesson on your phone" className="size-28 rounded-lg" />
                  <p className="text-lg text-neutral-700"><span className="font-semibold text-neutral-900">Queue too long?</span> Scan and build one on your own phone.</p>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6 lg:p-8">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Build the lesson from">
                {([
                  { id: "topic", label: "A topic", icon: Lightbulb },
                  { id: "pdf", label: "A PDF", icon: FilePdf },
                  { id: "youtube", label: "A YouTube video", icon: YoutubeLogo },
                ] as const).map((k) => {
                  const Icon = k.icon;
                  return (
                    <button key={k.id} type="button" onClick={() => { setKind(k.id); setError(""); }} aria-pressed={kind === k.id}
                      className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm lg:px-5 lg:py-2.5 lg:text-lg", kind === k.id ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200 hover:bg-neutral-50")}>
                      <Icon className="size-5" /> {k.label}
                    </button>
                  );
                })}
              </div>

              {kind === "topic" ? (
                <div className="mt-4">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">What should she teach?</span>
                    <div className="mt-1 flex items-stretch gap-2">
                      <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="Anything you teach. Try: Ohm's law for class 10"
                        className="w-full min-w-0 rounded-xl border border-neutral-300 px-4 py-3 text-lg outline-none focus:border-primary-500 lg:py-4 lg:text-2xl" />
                      {canListen ? (
                        <button type="button" onClick={toggleListen} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Say the topic"}
                          className={cn("flex shrink-0 items-center justify-center rounded-xl px-4 lg:px-6", listening ? "bg-danger-500 text-white" : "bg-primary-500 text-white")}>
                          <Microphone className={cn("size-6 lg:size-8", listening && "animate-pulse")} weight="fill" />
                        </button>
                      ) : null}
                    </div>
                  </label>
                  <p className="mt-1 text-xs text-neutral-500 lg:text-sm">{listening ? "Listening… say the topic, then tap the microphone again." : canListen ? "Type it, or tap the microphone and say it." : "Type any topic."}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SAMPLES.map((s) => (
                      <button key={s} type="button" onClick={() => setTopic(s)} className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 lg:text-base">{s}</button>
                    ))}
                  </div>
                </div>
              ) : kind === "pdf" ? (
                <div className="mt-4">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">Your chapter, notes or handout</span>
                  <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); }} />
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="mt-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-300 px-4 py-5 text-start hover:bg-neutral-50 lg:py-7">
                    <FilePdf className="size-8 shrink-0 text-primary-500 lg:size-10" />
                    <span className="min-w-0">
                      <span className="block truncate text-lg font-semibold lg:text-2xl">{file ? file.name : "Choose a PDF"}</span>
                      <span className="block text-sm text-neutral-500 lg:text-base">Text PDFs up to 15 MB. She teaches its main idea.</span>
                    </span>
                  </button>
                </div>
              ) : (
                <label className="mt-4 block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">A lecture on YouTube (with captions)</span>
                  <input value={link} onChange={(e) => setLink(e.target.value)} maxLength={300} inputMode="url" placeholder="https://www.youtube.com/watch?v=…"
                    className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-lg outline-none focus:border-primary-500 lg:py-4 lg:text-2xl" />
                </label>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">Your first name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" placeholder="She will call you by it"
                    className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-base outline-none focus:border-primary-500 lg:py-3 lg:text-xl" />
                </label>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">Teach me in</span>
                  <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Lesson language">
                    {LANGUAGE_ORDER.filter((l) => config.languages.includes(l)).map((l) => (
                      <button key={l} type="button" onClick={() => setLanguage(l)} aria-pressed={language === l}
                        className={cn("rounded-full border px-3 py-2 text-sm lg:px-4 lg:text-lg", language === l ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200 hover:bg-neutral-50")}>
                        {TUTOR_LANGUAGE_LABEL[l]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">Your institute (optional)</span>
                  <input value={org} onChange={(e) => setOrg(e.target.value)} maxLength={120} autoComplete="off" placeholder="School, college or company"
                    className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-base outline-none focus:border-primary-500 lg:py-3 lg:text-xl" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 lg:text-sm">Phone (optional)</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} inputMode="tel" autoComplete="off" placeholder="So our team can call you"
                    className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-base outline-none focus:border-primary-500 lg:py-3 lg:text-xl" />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="How you answer">
                <button type="button" onClick={() => setMode("VOICE")} aria-pressed={mode === "VOICE"}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm lg:text-base", mode === "VOICE" ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200")}>
                  <Microphone className="size-4" /> Talk to her
                </button>
                <button type="button" onClick={() => setMode("TEXT")} aria-pressed={mode === "TEXT"}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm lg:text-base", mode === "TEXT" ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200")}>
                  <TextT className="size-4" /> Type my answers
                </button>
              </div>

              {error ? <p role="alert" className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 lg:text-lg">{error}</p> : null}

              <button type="button" onClick={() => void build()}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-4 text-lg font-semibold text-white lg:py-5 lg:text-3xl">
                <Sparkle className="size-6 lg:size-8" weight="fill" /> Build my lesson
              </button>
              <p className="mt-3 text-center text-xs text-neutral-500 lg:text-sm">
                A {config.minutes}-minute lesson, made by AI in front of you. With your own material, the teacher stays inside what you gave her.
              </p>
            </div>
          </section>
        )}

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-neutral-500 lg:text-sm">
          <span>Tutezy is a product of <span className="font-semibold text-neutral-700">Vacademy</span></span>
          <span>vacademy.io · tutezy.ai</span>
        </footer>
      </div>
    </main>
  );
}

/** A scannable link. On the stall screen it is only a picture: a tap must never take the kiosk away. */
function QrCard({ title, text, link, tappable }: { title: string; text: string; link: string; tappable: boolean }) {
  const body = (
    <>
      <img src={tutorStudioQrUrl(link)} alt={title} className="size-40 rounded-lg lg:size-56" />
      <span className="mt-4 text-lg font-bold lg:text-2xl">{title}</span>
      <span className="mt-1 text-sm text-neutral-600 lg:text-lg">{text}</span>
    </>
  );
  const box = "flex flex-col items-center rounded-2xl border border-neutral-200 bg-white p-5 text-center shadow-sm lg:p-7";
  return tappable ? (
    <a href={link} target="_blank" rel="noreferrer" className={box}>{body}</a>
  ) : (
    <div className={box}>{body}</div>
  );
}
