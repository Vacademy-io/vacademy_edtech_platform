import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceRecorderOptions {
  onAudioChunk?: (base64Data: string) => void;
  /**
   * Called when recording stops by itself because the speaker went quiet.
   * Without it the caller cannot tell a finished turn from a live mic, and the
   * UI sits on "listening" with a dead recorder.
   */
  onSilenceStop?: () => void;
  /**
   * Called when the mic was open for `maxWaitForSpeechMs` and nobody spoke.
   * Distinct from onSilenceStop: there is no turn to hand over, so the caller
   * should go quiet rather than ship an empty clip to speech-to-text.
   */
  onNoSpeech?: () => void;
  silenceTimeout?: number;
  maxWaitForSpeechMs?: number;
  sampleRate?: number;
}

interface UseVoiceRecorderReturn {
  /** Resolves true once the mic is live; false if permission/device failed (see `error`). */
  startRecording: () => Promise<boolean>;
  /**
   * Stops the mic. Resolves once the recorder's LAST chunk has been emitted
   * through onAudioChunk — wait for it before telling the server the turn is
   * over, or that chunk arrives after "audio_end" and corrupts the next turn.
   */
  stopRecording: () => Promise<void>;
  isRecording: boolean;
  audioBlob: Blob | null;
  audioLevel: number;
  error: string | null;
  /** Container actually being recorded, e.g. "audio/webm" — send it with the audio. */
  mimeType: string;
  /** True once the current (or last) recording actually heard the speaker. */
  hadSpeech: () => boolean;
}

// Hysteresis: it takes a clear signal to count as speech starting, but a
// lower one to keep counting it as ongoing, so room noise doesn't start a turn
// and a soft trailing word doesn't end one early.
const SPEECH_ONSET_LEVEL = 0.08;
const SPEECH_SUSTAIN_LEVEL = 0.05;

export function useVoiceRecorder(
  options: UseVoiceRecorderOptions = {},
): UseVoiceRecorderReturn {
  const {
    onAudioChunk,
    onSilenceStop,
    onNoSpeech,
    silenceTimeout = 3000,
    maxWaitForSpeechMs = 12000,
    sampleRate = 16000,
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('audio/webm');

  // Read through a ref: monitorAudioLevel runs on animation frames and would
  // otherwise hold the first render's callback forever.
  const onSilenceStopRef = useRef(onSilenceStop);
  onSilenceStopRef.current = onSilenceStop;
  const onNoSpeechRef = useRef(onNoSpeech);
  onNoSpeechRef.current = onNoSpeech;
  const hasSpeechRef = useRef(false);
  const listenStartRef = useRef<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Every streamed chunk is encoded and sent through this chain, in order.
  const encodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const silenceStartRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const monitorAudioLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !isRecordingRef.current) {
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length / 255;
    setAudioLevel(average);

    // End-of-turn detection. The silence clock only runs AFTER speech has been
    // heard: counting from the moment the mic opens meant a student who took
    // three seconds to start talking had an empty clip sent to STT — and the
    // call then looped "I didn't catch that" every few seconds.
    const now = Date.now();
    const speaking = average >= (hasSpeechRef.current ? SPEECH_SUSTAIN_LEVEL : SPEECH_ONSET_LEVEL);
    if (speaking) {
      hasSpeechRef.current = true;
      silenceStartRef.current = null;
    } else if (hasSpeechRef.current) {
      if (silenceStartRef.current === null) {
        silenceStartRef.current = now;
      } else if (now - silenceStartRef.current >= silenceTimeout) {
        // The speaker paused after saying something: the turn is over.
        stopRecording();
        onSilenceStopRef.current?.();
        return;
      }
    } else if (
      listenStartRef.current !== null &&
      now - listenStartRef.current >= maxWaitForSpeechMs
    ) {
      // Nobody spoke at all — release the mic without a turn.
      stopRecording();
      onNoSpeechRef.current?.();
      return;
    }

    animFrameRef.current = requestAnimationFrame(monitorAudioLevel);
  }, [silenceTimeout, maxWaitForSpeechMs]);

  const stopRecording = useCallback((): Promise<void> => {
    isRecordingRef.current = false;
    setIsRecording(false);
    silenceStartRef.current = null;

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // MediaRecorder emits its final chunk asynchronously after stop(), then
    // fires "stop". Wait for that, then for the chunk to be encoded and sent.
    let flushed: Promise<void> = Promise.resolve();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      flushed = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1500); // never hang a turn on a stuck recorder
        recorder.addEventListener(
          'stop',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      recorder.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    return flushed.then(() => encodeChainRef.current);
  }, []);

  // Re-bind monitorAudioLevel's reference to stopRecording
  // by using refs instead of closures for the recursive call
  const monitorRef = useRef(monitorAudioLevel);
  monitorRef.current = monitorAudioLevel;

  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null);
    setAudioBlob(null);
    chunksRef.current = [];
    silenceStartRef.current = null;
    hasSpeechRef.current = false;
    listenStartRef.current = Date.now();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate,
        },
      });
      streamRef.current = stream;

      // Handle mic permission revocation or device unplugged
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          stopRecording();
          setError('Microphone access was lost');
        });
      });

      // Set up AudioContext + AnalyserNode for level monitoring
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Determine supported MIME type
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Let browser pick default
        }
      }

      const recorderOptions: MediaRecorderOptions = {};
      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }
      setMimeType((mimeType || 'audio/webm').split(';')[0]);

      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      const isStreamingMode = !!onAudioChunk;

      // Chunks are encoded and emitted through one promise chain so they leave
      // in the order MediaRecorder produced them. Independent FileReaders could
      // complete out of order, and a webm stream with a swapped chunk is a
      // corrupt file to the server-side decoder.
      encodeChainRef.current = Promise.resolve();
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          if (isStreamingMode) {
            const blob = event.data;
            encodeChainRef.current = encodeChainRef.current.then(async () => {
              const buffer = await blob.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i += 0x8000) {
                binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
              }
              onAudioChunk(btoa(binary));
            }).catch(() => {
              // A failed chunk read is dropped; the next one still goes out in order.
            });
          }
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (chunksRef.current.length > 0) {
          const finalMime = mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: finalMime });
          setAudioBlob(blob);
        }
      };

      mediaRecorder.onerror = () => {
        setError('MediaRecorder error occurred');
        stopRecording();
      };

      isRecordingRef.current = true;
      setIsRecording(true);

      // Start recording: use timeslice in streaming mode
      if (isStreamingMode) {
        mediaRecorder.start(250); // 250ms chunks
      } else {
        mediaRecorder.start();
      }

      // Start audio level monitoring
      monitorRef.current();
      return true;
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No microphone found'
            : `Failed to start recording: ${err instanceof Error ? err.message : String(err)}`;
      setError(message);
      cleanup();
      return false;
    }
  }, [sampleRate, onAudioChunk, stopRecording, cleanup]);

  return {
    startRecording,
    stopRecording,
    isRecording,
    audioBlob,
    audioLevel,
    error,
    mimeType,
    hadSpeech: () => hasSpeechRef.current,
  };
}
