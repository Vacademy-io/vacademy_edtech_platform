import { useCallback, useEffect, useRef, useState } from "react";
import { speechLangFor } from "./companion-utils";

type Phase = "idle" | "loading" | "playing";

/**
 * One read-aloud voice for the whole study room: starting a new clip stops the
 * previous one. `fetchUrl` asks the server for narration (an https or data:
 * URL); on any failure (503 unavailable, 403 off, network) it falls back to the
 * browser's own speech synthesis with `fallbackText`, so the button never
 * simply does nothing.
 */
export function useReadAloud(language: string | null | undefined) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tokenRef = useRef(0);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* not supported */
    }
    setActiveKey(null);
    setPhase("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const speakWithBrowser = useCallback(
    (text: string, token: number) => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || !text.trim() || typeof SpeechSynthesisUtterance === "undefined") {
        setActiveKey(null);
        setPhase("idle");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = speechLangFor(language);
      utterance.rate = 0.95;
      utterance.onend = () => {
        if (tokenRef.current === token) {
          setActiveKey(null);
          setPhase("idle");
        }
      };
      utterance.onerror = utterance.onend;
      synth.cancel();
      synth.speak(utterance);
      setPhase("playing");
    },
    [language],
  );

  const play = useCallback(
    async (key: string, fetchUrl: () => Promise<string>, fallbackText: string) => {
      if (activeKey === key) {
        stop();
        return;
      }
      stop();
      const token = tokenRef.current;
      setActiveKey(key);
      setPhase("loading");
      try {
        const url = await fetchUrl();
        if (tokenRef.current !== token) return;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (tokenRef.current === token) {
            setActiveKey(null);
            setPhase("idle");
          }
        };
        await audio.play();
        if (tokenRef.current === token) setPhase("playing");
      } catch {
        if (tokenRef.current !== token) return;
        audioRef.current = null;
        speakWithBrowser(fallbackText, token);
      }
    },
    [activeKey, speakWithBrowser, stop],
  );

  return { activeKey, phase, play, stop };
}

export type ReadAloud = ReturnType<typeof useReadAloud>;
