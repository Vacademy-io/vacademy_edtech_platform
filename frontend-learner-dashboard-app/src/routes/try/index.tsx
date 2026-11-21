import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleNotch, Microphone, TextT } from "@phosphor-icons/react";
import { getTutorDemoTopics, startTutorDemo, type TutorDemoTopic } from "@/services/tutor-api";
import { writeTutorGuest } from "@/lib/tutorGuest";
import { preloadAvatarKit } from "@/hooks/useSpatiusAvatar";

interface TrySearch {
  done?: string;
  topic?: string;
}

/**
 * Public demo lesson for tutezy.ai visitors: a name, a topic, then the
 * real tutor page with a guest token. No sign-up, one per visitor per day.
 */
export const Route = createFileRoute("/try/")({
  component: TryPage,
  validateSearch: (search: Record<string, unknown>): TrySearch => ({
    done: search.done ? String(search.done) : undefined,
    topic: search.topic ? String(search.topic) : undefined,
  }),
});

const TUTEZY = "https://tutezy.ai";

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

function TryPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [topics, setTopics] = useState<TutorDemoTopic[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  // Placeholder until /demo/topics answers with the real tutor.demo.minutes.
  const [minutes, setMinutes] = useState(10);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState(search.topic || "");
  const [mode, setMode] = useState<"VOICE" | "TEXT">("VOICE");
  const [busy, setBusy] = useState(false);
  // A link that already names a topic (tutezy.ai buttons do) shows just that
  // topic; eighteen cards stood between a phone visitor and the Start button.
  const [showAllTopics, setShowAllTopics] = useState(!search.topic);
  const [error, setError] = useState("");

  useEffect(() => {
    getTutorDemoTopics()
      .then((r) => {
        setTopics(r.topics);
        setEnabled(r.enabled);
        setMinutes(r.minutes);
        if (!topic && r.topics[0]) setTopic(r.topics[0].key);
      })
      .catch(() => {
        setTopics([]);
        setEnabled(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    if (!name.trim() || !topic) {
      setError("Your first name and a topic, that's all we need.");
      return;
    }
    setError("");
    setBusy(true);
    // Voice: ask for the microphone HERE, before the lesson (and before the
    // free lesson is used up), not at the student's first answer mid-lesson.
    if (mode === "VOICE") {
      const ok = await micAllowed();
      if (!ok) {
        setError("We couldn't use your microphone. Allow it in your browser's address bar, or choose Text only.");
        setBusy(false);
        return;
      }
    }
    // The animated teacher's SDK downloads while the session is being created.
    if (mode === "VOICE") void preloadAvatarKit().catch(() => undefined);
    try {
      const r = await startTutorDemo({ name: name.trim(), topicKey: topic, mode });
      writeTutorGuest({ token: r.token, boot: r.boot, minutes: r.minutes, name: name.trim(), topicKey: topic });
      navigate({
        to: "/study-library/courses/course-details/tutor",
        search: { courseId: "demo", packageSessionId: "demo", slideId: r.boot.slide_id, mode: mode === "VOICE" ? "voice" : "text", demo: "1" } as never,
      });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Could not start the lesson. Please try again in a moment.");
      setBusy(false);
    }
  };

  return (
    <main className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-neutral-50 px-4 py-8 text-neutral-900">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <a href={TUTEZY} className="flex flex-col gap-1" aria-label="tutezy.ai">
            <img src="/tutezy-logo.png" alt="tutezy.ai" className="h-9 w-auto" />
            <span className="text-xs font-medium tracking-wide text-neutral-500">Personalized learning · AI live classes · by Vacademy</span>
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700">
            <span className="size-2 rounded-full bg-success-500" /> Free {minutes}-minute lesson
          </span>
        </header>

        {search.done ? (
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">That was your free lesson.</h1>
            <p className="mt-2 text-neutral-600">
              Imagine every student of yours getting this, on your own content, in your teachers&apos; voices. We set it up on a 20-minute call.
            </p>
            <a href={`${TUTEZY}/#demo`} className="mt-5 inline-block rounded-full bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white">Book a demo</a>
            <a href={TUTEZY} className="ms-3 text-sm font-semibold text-neutral-600 hover:underline">Back to tutezy.ai</a>
          </section>
        ) : !enabled && topics !== null ? (
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">The free lesson is taking a break.</h1>
            <p className="mt-2 text-neutral-600">Book a demo and we will run a full lesson on your own chapter.</p>
            <a href={`${TUTEZY}/#demo`} className="mt-5 inline-block rounded-full bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white">Book a demo</a>
          </section>
        ) : (
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold sm:text-2xl">Take a {minutes}-minute lesson. No sign-up.</h1>
            <p className="mt-1 text-sm text-neutral-600">The teacher writes on a whiteboard, speaks, asks you a question and listens to your answer.</p>

            <label className="mt-5 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">What should the teacher call you?</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoComplete="given-name"
                placeholder="Your first name"
                className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 outline-none focus:border-primary-500"
              />
            </label>

            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-500">How do you want to talk?</p>
            <div className="mt-2 flex gap-2" role="group" aria-label="Lesson mode">
              <button type="button" onClick={() => setMode("VOICE")} aria-pressed={mode === "VOICE"} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${mode === "VOICE" ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200"}`}>
                <Microphone className="size-4" /> Voice (needs a mic)
              </button>
              <button type="button" onClick={() => setMode("TEXT")} aria-pressed={mode === "TEXT"} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${mode === "TEXT" ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200"}`}>
                <TextT className="size-4" /> Text only
              </button>
            </div>

            {/* A link with ?topic=<key> that is not in the public list is an unlisted lesson
                built from the visitor's own material. Show that, not ten unrelated topics. */}
            {topics !== null && search.topic && !topics.some((t) => t.key === search.topic) ? (
              <div className="mt-5 rounded-xl border border-primary-500 bg-primary-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Your lesson</p>
                <p className="mt-1 text-sm font-semibold">Built from your chapter — it&apos;s ready.</p>
                <p className="mt-0.5 text-xs text-neutral-600">Add your name, choose voice or text, and press start.</p>
              </div>
            ) : (
            <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Pick a topic</p>
            {topics === null ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-neutral-500"><CircleNotch className="size-4 animate-spin" /> Loading topics…</p>
            ) : (
              !showAllTopics && topics.some((t) => t.key === topic) ? (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary-500 bg-primary-50 px-3 py-2.5 text-sm font-semibold">
                  {(() => {
                    const t = topics.find((x) => x.key === topic)!;
                    return (
                      <>
                        {t.emoji && <span className="text-lg" aria-hidden="true">{t.emoji}</span>}
                        <span className="min-w-0 flex-1 break-words">{t.title}</span>
                      </>
                    );
                  })()}
                  <button type="button" onClick={() => setShowAllTopics(true)} className="shrink-0 text-xs font-medium text-primary-500 hover:underline">
                    Change topic
                  </button>
                </div>
              ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {topics.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTopic(t.key)}
                    aria-pressed={topic === t.key}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm ${topic === t.key ? "border-primary-500 bg-primary-50 font-semibold" : "border-neutral-200 hover:bg-neutral-50"}`}
                  >
                    {t.emoji && <span className="text-lg" aria-hidden="true">{t.emoji}</span>}
                    <span className="min-w-0 flex-1 break-words">{t.title}{t.language === "hi" ? <span className="ms-1 text-xs text-neutral-500">हिंदी</span> : null}</span>
                  </button>
                ))}
              </div>
              )
            )}
            </>
            )}

            {/* Pinned to the bottom of the screen on phones so Start is always one tap away. */}
            <div className="sticky bottom-0 -mx-6 mt-2 bg-white px-6 pb-4 pt-2 sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0">
            {error && <p role="alert" className="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}

            <button
              type="button"
              onClick={() => void start()}
              disabled={busy || topics === null || topics.length === 0}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-primary-500 px-5 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? <CircleNotch className="size-5 animate-spin" /> : null}
              {busy ? "Waking the teacher…" : "Start my lesson"}
            </button>
            </div>
            <p className="mt-3 text-center text-xs text-neutral-500">One free lesson per visitor per day. The lesson ends on its own after {minutes} minutes.</p>
          </section>
        )}
      </div>
      <footer className="mx-auto mt-8 flex w-full max-w-lg flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>A product of <a href="https://vacademy.io" className="font-semibold text-neutral-700 hover:underline">Vacademy</a></span>
        <span className="flex gap-4">
          <a href={`${TUTEZY}/#pricing`} className="hover:underline">Pricing</a>
          <a href={`${TUTEZY}/#demo`} className="hover:underline">Book a demo</a>
          <a href="https://vacademy.io/privacy-policy" className="hover:underline">Privacy</a>
        </span>
      </footer>
    </main>
  );
}
