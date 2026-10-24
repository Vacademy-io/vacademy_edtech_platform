import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Microphone, MicrophoneSlash, PhoneDisconnect } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { VoiceAvatar } from "./VoiceAvatar";
import { useChatbotAvatarUrl } from "@/services/chatbot-settings";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useVoiceWebSocket } from "@/hooks/useVoiceWebSocket";
import { aiUsageLimitMessage, type AiUsageLimitBody } from "@/lib/ai-usage-limit-notify";
import { SessionScorecard } from "./SessionScorecard";

interface VoiceModePanelProps {
  sessionId: string;
  mode: "voice_interview" | "voice_doubt" | "voice_oral_test";
  language: string;
  voice: string;
  onClose: () => void;
  chatbotSettings: { assistant_name: string };
  /** What the call is about, resolved from the student's current chapter/course. */
  topic?: string;
}

/**
 * "connecting" covers the socket handshake and the agent's opening line, which
 * the server starts on its own — the student never has to speak first.
 */
type VoiceState = "connecting" | "idle" | "listening" | "speaking" | "processing";

interface TranscriptMessage {
  role: "user" | "ai";
  text: string;
}

/** End-of-call scorecard, as rendered by SessionScorecard. */
interface SessionSummary {
  score?: number;
  total_questions?: number;
  strengths?: string[];
  areas_to_improve?: string[];
  feedback?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const VoiceModePanel: React.FC<VoiceModePanelProps> = ({
  sessionId,
  mode,
  language,
  voice,
  onClose,
  chatbotSettings,
  topic,
}) => {
  const { t } = useTranslation("chatFeatureB");
  const avatarUrl = useChatbotAvatarUrl();
  const MODE_LABELS: Record<VoiceModePanelProps["mode"], { label: string; icon: string }> = {
    voice_interview: { label: t("voiceModeLabels.interview"), icon: "briefcase" },
    voice_doubt: { label: t("voiceModeLabels.doubt"), icon: "message" },
    voice_oral_test: { label: t("voiceModeLabels.oralTest"), icon: "file-question" },
  };
  const [voiceState, setVoiceState] = useState<VoiceState>("connecting");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<SessionSummary | null>(null);
  const [showScorecard, setShowScorecard] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;
  // Bytes of the segment currently arriving, then the queue of whole segments
  // waiting to be spoken. Streaming per segment is what lets the student hear
  // the first sentence while the rest is still being synthesized.
  const ttsChunksRef = useRef<Uint8Array[]>([]);
  const segmentQueueRef = useRef<ArrayBuffer[]>([]);
  const isDrainingRef = useRef(false);
  const turnEndedRef = useRef(false);
  const interruptedRef = useRef(false);
  // Once the student hangs up, nothing may re-open the microphone.
  const isEndingRef = useRef(false);
  const isMicMutedRef = useRef(isMicMuted);
  isMicMutedRef.current = isMicMuted;
  const endTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll the full transcript while it is open.
  useEffect(() => {
    if (showTranscript) transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, showTranscript]);

  // Audio player
  const audioPlayer = useAudioPlayer();

  const recorderMimeRef = useRef("audio/webm");

  /**
   * Hand the turn to the agent. Used both by the silence detector and by the
   * mic button, so a turn always ends the same way.
   */
  const finishSpeaking = useCallback(() => {
    if (isEndingRef.current) return;
    interruptedRef.current = false;
    // The recorder's last chunk is still on its way: send the end of turn only
    // after it, or it lands in the server's buffer as the start of the NEXT
    // turn and that clip has no header ("Something went wrong" on turn two).
    const flushed = recorder.stopRecording();
    if (!recorder.hadSpeech()) {
      // Nothing was said (a stray tap, a quiet room): don't send a silent
      // clip to speech-to-text — tell the server to forget it and go quiet.
      setVoiceState("idle");
      void flushed.then(() => ws.sendAudioDiscard());
      return;
    }
    setVoiceState("processing");
    void flushed.then(() => {
      if (!isEndingRef.current) ws.sendAudioEnd(recorderMimeRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finishSpeakingRef = useRef(finishSpeaking);

  /** The mic was open long enough and nobody spoke — hand control back quietly. */
  const handleNoSpeech = useCallback(() => {
    if (isEndingRef.current) return;
    setVoiceState("idle");
    // Discard only after the last chunk is in, so nothing is left to prefix the next turn.
    void recorder.stopRecording().then(() => ws.sendAudioDiscard());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleNoSpeechRef = useRef(handleNoSpeech);

  // Voice recorder. The silence callback is what makes this a call rather than
  // a walkie-talkie: the student just stops talking and the agent replies.
  const recorder = useVoiceRecorder({
    silenceTimeout: 2000,
    maxWaitForSpeechMs: 15000,
    onSilenceStop: () => finishSpeakingRef.current(),
    onNoSpeech: () => handleNoSpeechRef.current(),
    onAudioChunk: (base64Data) => {
      ws.sendAudioChunk(base64Data);
    },
  });
  recorderMimeRef.current = recorder.mimeType;

  /**
   * Open the mic for the student's turn, unless they muted it or hung up.
   *
   * Idempotent on purpose: barging in stops playback, which resolves the
   * play promise and tries to arm the mic a second time. Two getUserMedia
   * streams would leak the first one's tracks (a live mic indicator that
   * never goes away).
   */
  const isArmingRef = useRef(false);
  const armMicrophone = useCallback(async () => {
    if (isEndingRef.current || isMicMutedRef.current) {
      setVoiceState("idle");
      return;
    }
    if (voiceStateRef.current === "listening" || isArmingRef.current) return;
    isArmingRef.current = true;
    try {
      // startRecording swallows getUserMedia failures and reports them via
      // its return value, so a denied or missing microphone is not an exception.
      const started = await recorder.startRecording();
      if (!started) {
        setNotice(t("voiceModePanel.noticeMic"));
        setVoiceState("idle");
        return;
      }
      voiceStateRef.current = "listening";
      setVoiceState("listening");
    } catch {
      setNotice(t("voiceModePanel.noticeMic"));
      setVoiceState("idle");
    } finally {
      isArmingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket callbacks
  const onTranscriptFinal = useCallback((text: string) => {
    if (!text.trim()) return;
    setTranscript((prev) => [...prev, { role: "user", text }]);
    setVoiceState("processing");
  }, []);

  const onAiText = useCallback((text: string) => {
    setNotice(null);
    setTranscript((prev) => {
      // If last message is AI, append to it; else add new
      const last = prev[prev.length - 1];
      if (last && last.role === "ai") {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { role: "ai", text }];
    });
  }, []);

  const onAudioChunk = useCallback((base64Data: string) => {
    setVoiceState("speaking");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    ttsChunksRef.current.push(bytes);
  }, []);

  /** Join the chunks received so far into one playable buffer. */
  const takeSegment = useCallback((): ArrayBuffer | null => {
    const chunks = ttsChunksRef.current;
    ttsChunksRef.current = [];
    if (chunks.length === 0) return null;
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined.buffer as ArrayBuffer;
  }, []);

  /**
   * Play queued segments back to back, then hand the turn to the student. Runs
   * as a single drain loop so segments never overlap and the mic is armed
   * exactly once, when the agent has actually stopped talking.
   */
  const drainSegments = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    try {
      while (segmentQueueRef.current.length > 0 && !interruptedRef.current) {
        const segment = segmentQueueRef.current.shift();
        if (!segment) continue;
        setVoiceState("speaking");
        try {
          await audioPlayer.playAudio(segment);
        } catch {
          // A bad segment shouldn't strand the call — move on to the next.
        }
      }
    } finally {
      isDrainingRef.current = false;
    }
    if (interruptedRef.current) return;
    if (turnEndedRef.current && segmentQueueRef.current.length === 0) {
      turnEndedRef.current = false;
      await armMicrophone();
    }
  }, [audioPlayer, armMicrophone]);

  const onAudioSegmentEnd = useCallback(() => {
    const segment = takeSegment();
    if (!segment || interruptedRef.current) return;
    segmentQueueRef.current.push(segment);
    void drainSegments();
  }, [takeSegment, drainSegments]);

  const onAudioEnd = useCallback(
    (reason: string) => {
      if (reason === "no_speech") setNotice(t("voiceModePanel.noticeNoSpeech"));
      else if (reason === "error") setNotice(t("voiceModePanel.noticeError"));

      // Anything left unterminated still belongs to this turn.
      const trailing = takeSegment();
      if (trailing && !interruptedRef.current) segmentQueueRef.current.push(trailing);

      turnEndedRef.current = true;
      if (isDrainingRef.current) return; // the drain loop will arm the mic
      void drainSegments();
    },
    [takeSegment, drainSegments, t],
  );

  const onSummary = useCallback((data: unknown) => {
    // The server wraps it as { type: "summary", data: {...} }.
    const payload = (data as { data?: SessionSummary })?.data ?? (data as SessionSummary);
    setSummaryData(payload ?? null);
    setShowScorecard(true);
  }, []);

  const onError = useCallback(
    (message: string) => {
      console.error("Voice WS error:", message);
      setNotice(t("voiceModePanel.noticeError"));
    },
    [t],
  );

  // Use a ref to call sendConfig from the onReady callback
  // (avoids circular dependency between ws and onReady)
  const wsRef = useRef<ReturnType<typeof useVoiceWebSocket> | null>(null);

  const onUsageLimit = useCallback((body: AiUsageLimitBody) => {
    setNotice(aiUsageLimitMessage(body));
  }, []);

  const onReady = useCallback(() => {
    // The config also tells the server to open the call, so this is the whole
    // handshake the student has to do: nothing.
    wsRef.current?.sendConfig(language, voice);
  }, [language, voice]);

  // WebSocket
  const ws = useVoiceWebSocket({
    onTranscriptFinal,
    onAiText,
    onAudioChunk,
    onAudioSegmentEnd,
    onAudioEnd,
    onSummary,
    onError,
    onUsageLimit,
    onReady,
  });
  wsRef.current = ws;
  finishSpeakingRef.current = finishSpeaking;
  handleNoSpeechRef.current = handleNoSpeech;

  // Connect on mount, full cleanup on unmount. Everything per-call is reset on
  // the way in: the cleanup below marks the call as ending, and if the session
  // id ever changes that flag must not leak into the next connection.
  useEffect(() => {
    isEndingRef.current = false;
    interruptedRef.current = false;
    turnEndedRef.current = false;
    segmentQueueRef.current = [];
    ttsChunksRef.current = [];
    setVoiceState("connecting");
    setTranscript([]);
    setNotice(null);
    ws.connect(sessionId);
    return () => {
      isEndingRef.current = true;
      if (endTimeoutRef.current) clearTimeout(endTimeoutRef.current);
      ws.disconnect();
      recorder.stopRecording();
      audioPlayer.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Session timer — counts the call, so it starts when the call does.
  useEffect(() => {
    if (ws.connectionState !== "connected") return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [ws.connectionState]);

  // Watchdog: if the agent's opening line never arrives (a wedged turn, a TTS
  // outage), hand the call to the student rather than leaving them on a
  // "Connecting…" screen with a disabled button.
  useEffect(() => {
    if (voiceState !== "connecting") return;
    const timer = setTimeout(() => {
      if (voiceStateRef.current !== "connecting") return;
      setNotice(t("voiceModePanel.noticeError"));
      setVoiceState("idle");
    }, 15000);
    return () => clearTimeout(timer);
  }, [voiceState, t]);

  // Surface a dead microphone instead of silently staying on "listening".
  useEffect(() => {
    if (recorder.error) {
      setNotice(t("voiceModePanel.noticeMic"));
      setVoiceState("idle");
    }
  }, [recorder.error, t]);

  // Determine current audio level based on state
  const currentAudioLevel =
    voiceState === "listening"
      ? recorder.audioLevel
      : voiceState === "speaking"
        ? audioPlayer.audioLevel
        : 0;

  /**
   * The mic button is live in every state — including while the agent talks,
   * where it is a barge-in — so a stalled turn can never trap the student.
   */
  const toggleMic = useCallback(async () => {
    setNotice(null);
    if (voiceState === "listening") {
      finishSpeaking();
      return;
    }
    if (voiceState === "speaking" || voiceState === "processing") {
      // Talking over the agent: drop the reply on both sides, including
      // segments already queued but not yet spoken.
      interruptedRef.current = true;
      turnEndedRef.current = false;
      segmentQueueRef.current = [];
      ttsChunksRef.current = [];
      audioPlayer.stop();
      ws.sendInterrupt();
    }
    setIsMicMuted(false);
    isMicMutedRef.current = false;
    await armMicrophone();
  }, [voiceState, finishSpeaking, audioPlayer, ws, armMicrophone]);

  // End session
  const handleEndSession = useCallback(() => {
    isEndingRef.current = true;
    recorder.stopRecording();
    audioPlayer.stop();
    ws.sendEndSession();
    setVoiceState("idle");
    // Close anyway if the scorecard never arrives.
    endTimeoutRef.current = setTimeout(() => {
      endTimeoutRef.current = null;
      onClose();
    }, 8000);
  }, [recorder, audioPlayer, ws, onClose]);

  // The scorecard arrived in time — stop the fallback close from firing under it.
  useEffect(() => {
    if (summaryData && endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }
  }, [summaryData]);

  /** Muting is about the microphone: it stops the call re-arming it each turn. */
  const toggleMute = useCallback(() => {
    setIsMicMuted((muted) => {
      const next = !muted;
      isMicMutedRef.current = next;
      if (next && voiceStateRef.current === "listening") finishSpeaking();
      return next;
    });
  }, [finishSpeaking]);

  const modeInfo = MODE_LABELS[mode];

  // Live captions: the latest line large, the other side's line before it small.
  const latestLine = transcript.length > 0 ? transcript[transcript.length - 1] : null;
  const earlierLine =
    transcript.length > 1 && transcript[transcript.length - 2].role !== latestLine?.role
      ? transcript[transcript.length - 2]
      : null;

  const isReconnecting = ws.connectionState === "connecting" && voiceState !== "connecting";

  const hint = isReconnecting
    ? t("voiceModePanel.reconnecting")
    : voiceState === "connecting"
      ? t("voiceModePanel.connecting")
      : isMicMuted
        ? t("voiceModePanel.muted")
        : voiceState === "idle"
          ? t("voiceModePanel.hintIdle")
          : voiceState === "listening"
            ? t("voiceModePanel.hintListening")
            : voiceState === "processing"
              ? t("voiceModePanel.hintProcessing")
              : t("voiceModePanel.hintSpeaking");

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-slate-900 to-slate-950"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0">
          <div className="flex min-w-0 flex-col">
            <span className="text-white/70 text-sm font-medium">{modeInfo.label}</span>
            {topic && (
              <span className="truncate text-caption text-white/40">
                {t("voiceModePanel.topicPrefix", { topic })}
              </span>
            )}
          </div>
          <span className="text-white/50 text-sm font-mono tabular-nums">
            {formatTime(elapsedSeconds)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/70 hover:text-white hover:bg-white/10 h-8 w-8"
            onClick={() => {
              isEndingRef.current = true;
              ws.disconnect();
              recorder.stopRecording();
              audioPlayer.stop();
              onClose();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Center area */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <VoiceAvatar
            avatarUrl={avatarUrl}
            assistantName={chatbotSettings.assistant_name}
            state={voiceState === "connecting" ? "processing" : voiceState}
            audioLevel={currentAudioLevel}
          />
          <p className="text-white/50 text-xs mt-2 px-6 text-center">{hint}</p>
          {notice && (
            <p className="text-amber-300/80 text-xs mt-1 max-w-sm px-6 text-center">{notice}</p>
          )}
        </div>

        {/* Live captions. Not a live region: the tutor's lines are already spoken
            aloud, so announcing them too would talk over the call. */}
        <section
          aria-label={t("voiceModePanel.captionsLabel")}
          className="shrink-0 px-6 pb-2"
        >
          <div className="mx-auto flex min-h-24 max-w-xl flex-col justify-end gap-2 text-center">
            {earlierLine && (
              <p dir="auto" className="line-clamp-2 text-sm text-white/50">
                {earlierLine.role === "user" && (
                  <span className="font-medium text-white/70">{t("voiceModePanel.captionYou")}: </span>
                )}
                {earlierLine.text}
              </p>
            )}
            {latestLine && (
              <p
                dir="auto"
                className={`line-clamp-4 text-xl font-medium leading-snug sm:text-2xl ${
                  latestLine.role === "user" ? "text-white/80" : "text-white"
                }`}
              >
                {latestLine.role === "user" && (
                  <span className="text-primary-200">{t("voiceModePanel.captionYou")}: </span>
                )}
                {latestLine.text}
              </p>
            )}
          </div>
          {transcript.length > 1 && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                aria-expanded={showTranscript}
                className="rounded-full px-3 py-1 text-caption text-white/50 transition-colors hover:bg-white/10 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {showTranscript ? t("voiceModePanel.hideTranscript") : t("voiceModePanel.showTranscript")}
              </button>
            </div>
          )}
        </section>

        {/* Full transcript, on request */}
        {showTranscript && (
          <div className="max-h-pct-30 px-6 overflow-y-auto">
            <div className="max-w-lg mx-auto space-y-2 pb-2">
              {transcript.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-lg px-3 py-1.5 text-sm max-w-pct-80 ${
                      msg.role === "user"
                        ? "bg-primary/20 text-white"
                        : "bg-white/10 text-white"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}

        {/* Controls bar */}
        <div className="shrink-0 pb-8 pt-4 flex items-center justify-center gap-6">
          {/* Mic mute toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={toggleMute}
            title={isMicMuted ? t("voiceModePanel.unmute") : t("voiceModePanel.mute")}
          >
            {isMicMuted ? (
              <MicrophoneSlash className="h-5 w-5" />
            ) : (
              <Microphone className="h-5 w-5" />
            )}
          </Button>

          {/* Large mic button */}
          <button
            className={`h-16 w-16 rounded-full flex items-center justify-center transition-all ${
              voiceState === "listening"
                ? "bg-red-500 text-white animate-pulse"
                : "bg-white text-slate-900 hover:bg-white/90"
            } ${voiceState === "connecting" ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={toggleMic}
            disabled={voiceState === "connecting"}
            title={t("voiceModePanel.talk")}
          >
            {voiceState === "listening" ? (
              <MicrophoneSlash className="h-7 w-7" />
            ) : (
              <Microphone className="h-7 w-7" />
            )}
          </button>

          {/* End call button */}
          <Button
            variant="ghost"
            className="h-10 rounded-full bg-white/10 text-white hover:bg-red-500/30 hover:text-red-300 px-4 gap-2 text-sm"
            onClick={handleEndSession}
          >
            <PhoneDisconnect className="h-4 w-4" />
            {t("voiceModePanel.end")}
          </Button>
        </div>

        {/* Session scorecard overlay */}
        {showScorecard && summaryData && (
          <SessionScorecard
            summary={summaryData}
            mode={mode}
            onClose={onClose}
            onStartNew={() => {
              ws.disconnect();
              recorder.stopRecording();
              audioPlayer.stop();
              onClose();
              // Parent will handle re-opening voice mode selector with a new session
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
};
