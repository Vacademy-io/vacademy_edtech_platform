import { useCallback, useEffect, useRef, useState } from "react";
import { chatbotAPI } from "@/services/chatbot-api";

/**
 * "Read aloud" for tutor replies. One reply plays at a time: starting another
 * (or calling stop) ends the current one. The server returns the reply as
 * sentence-sized audio segments, played back to back.
 */
export const useReplySpeech = (sessionId: string | null) => {
  /** The reply being read aloud, or null. */
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null);
  /** The reply whose audio is being fetched, or null. */
  const [speechLoadingId, setSpeechLoadingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Bumped on every start/stop so a late fetch or `ended` event is ignored. */
  const runRef = useRef(0);

  const stopSpeech = useCallback(() => {
    runRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
    }
    setSpeakingMessageId(null);
    setSpeechLoadingId(null);
  }, []);

  const toggleReadAloud = useCallback(
    async (messageId: number) => {
      if (speakingMessageId === messageId || speechLoadingId === messageId) {
        stopSpeech();
        return;
      }
      stopSpeech();
      if (!sessionId) return;
      const run = runRef.current;
      // Made inside the tap and reused for every segment: Safari only lets an
      // element play after the fetch if it was created by the gesture.
      const audio = new Audio();
      audioRef.current = audio;
      setSpeechLoadingId(messageId);
      let segments;
      try {
        segments = await chatbotAPI.getReplySpeech(sessionId, messageId);
      } catch (error) {
        console.error("[chatbot] could not read the reply aloud:", error);
        if (runRef.current === run) setSpeechLoadingId(null);
        return;
      }
      if (runRef.current !== run) return;
      setSpeechLoadingId(null);
      if (!segments.length) return;

      setSpeakingMessageId(messageId);
      const playAt = (index: number) => {
        if (runRef.current !== run) return;
        const segment = segments[index];
        if (!segment) {
          audioRef.current = null;
          setSpeakingMessageId(null);
          return;
        }
        audio.src = `data:${segment.mime || "audio/mpeg"};base64,${segment.audio_base64}`;
        audio.onended = () => playAt(index + 1);
        // A broken segment is skipped rather than ending the whole reply.
        audio.onerror = () => playAt(index + 1);
        audio.play().catch((error) => {
          console.error("[chatbot] audio playback was blocked:", error);
          if (runRef.current === run) stopSpeech();
        });
      };
      playAt(0);
    },
    [sessionId, speakingMessageId, speechLoadingId, stopSpeech],
  );

  // Switching chats (or leaving) ends playback.
  useEffect(() => stopSpeech, [sessionId, stopSpeech]);

  return { speakingMessageId, speechLoadingId, toggleReadAloud, stopSpeech };
};
