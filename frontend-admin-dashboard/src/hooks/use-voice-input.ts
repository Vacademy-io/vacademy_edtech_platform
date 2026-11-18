import { useCallback, useEffect, useRef, useState } from 'react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_SPEECH_TO_TEXT } from '@/constants/urls';

/** Longest spoken question, in seconds. Matches the server's limit. */
export const VOICE_INPUT_MAX_SECONDS = 120;

/** Below this a recording cannot hold a word; it is not uploaded. */
const MIN_RECORDING_MS = 400;

export type VoiceInputStatus = 'idle' | 'requesting' | 'recording' | 'transcribing';

export type VoiceInputError =
    | 'permission'
    | 'no-mic'
    | 'no-speech'
    | 'too-long'
    | 'rate-limited'
    | 'server';

/** How the last recording ended, for announcing it. */
export type VoiceInputOutcome = 'transcribed' | 'cancelled' | null;

export interface TranscribeResult {
    transcript: string;
    language?: string | null;
}

export type TranscribeFn = (recording: Blob, signal: AbortSignal) => Promise<TranscribeResult>;

/**
 * Recorder formats in order of preference. Chrome, Edge and Firefox record
 * webm/opus; Safari (macOS and iOS) records mp4/aac. The server transcodes all
 * of them.
 */
const PREFERRED_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
];

/** True when this page can record: a secure context with getUserMedia and MediaRecorder. */
export function isVoiceInputSupported(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return (
        window.isSecureContext === true &&
        typeof navigator.mediaDevices?.getUserMedia === 'function' &&
        typeof window.MediaRecorder === 'function'
    );
}

/** The first preferred format the browser can record, or '' to let it choose. */
export function pickRecordingMimeType(): string {
    const recorder = typeof window === 'undefined' ? undefined : window.MediaRecorder;
    if (!recorder || typeof recorder.isTypeSupported !== 'function') return '';
    return PREFERRED_MIME_TYPES.find((type) => recorder.isTypeSupported(type)) ?? '';
}

function fileExtension(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a';
    if (mimeType.includes('mpeg')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    return 'webm';
}

/** Uploads a recording to the speech-to-text API and returns the transcript. */
export const transcribeWithAssistant: TranscribeFn = async (recording, signal) => {
    const form = new FormData();
    const type = recording.type || 'audio/webm';
    form.append('file', new File([recording], `question.${fileExtension(type)}`, { type }));
    form.append('language', 'auto');
    const response = await authenticatedAxiosInstance.post<TranscribeResult>(
        ASSISTANT_SPEECH_TO_TEXT,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' }, signal }
    );
    return response.data;
};

function errorFromUpload(err: unknown): VoiceInputError {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 422) return 'no-speech';
    if (status === 413) return 'too-long';
    if (status === 429) return 'rate-limited';
    return 'server';
}

function errorFromGetUserMedia(err: unknown): VoiceInputError {
    const name = (err as { name?: string })?.name;
    if (
        name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        name === 'PermissionDeniedError'
    ) {
        return 'permission';
    }
    return 'no-mic';
}

function isCancel(err: unknown): boolean {
    const name = (err as { name?: string; code?: string })?.name;
    const code = (err as { code?: string })?.code;
    return name === 'CanceledError' || name === 'AbortError' || code === 'ERR_CANCELED';
}

export interface UseVoiceInputOptions {
    /** Called with the transcript; the caller puts it in its input for review. */
    onTranscript: (text: string) => void;
    maxSeconds?: number;
    transcribe?: TranscribeFn;
}

export interface VoiceInput {
    supported: boolean;
    status: VoiceInputStatus;
    elapsedSeconds: number;
    maxSeconds: number;
    error: VoiceInputError | null;
    /** True when the last recording stopped itself at the duration limit. */
    stoppedAtLimit: boolean;
    outcome: VoiceInputOutcome;
    start: () => Promise<void>;
    /** Stop recording and transcribe. */
    stop: () => void;
    /** Stop recording (or the upload) and discard it. */
    cancel: () => void;
    clearError: () => void;
}

/**
 * Speak instead of type: records the microphone, uploads the clip when the
 * user stops (or at the duration limit), and hands back the transcript.
 * Nothing is sent anywhere else; the caller decides what to do with the text.
 */
export function useVoiceInput({
    onTranscript,
    maxSeconds = VOICE_INPUT_MAX_SECONDS,
    transcribe = transcribeWithAssistant,
}: UseVoiceInputOptions): VoiceInput {
    const [supported] = useState(isVoiceInputSupported);
    const [status, setStatus] = useState<VoiceInputStatus>('idle');
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [error, setError] = useState<VoiceInputError | null>(null);
    const [stoppedAtLimit, setStoppedAtLimit] = useState(false);
    const [outcome, setOutcome] = useState<VoiceInputOutcome>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startedAtRef = useRef(0);
    const discardRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    const onTranscriptRef = useRef(onTranscript);
    onTranscriptRef.current = onTranscript;
    const transcribeRef = useRef(transcribe);
    transcribeRef.current = transcribe;

    const releaseMic = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    const upload = useCallback(async (recording: Blob) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setStatus('transcribing');
        try {
            const result = await transcribeRef.current(recording, controller.signal);
            if (!mountedRef.current || controller.signal.aborted) return;
            const text = (result?.transcript ?? '').trim();
            if (text) {
                setOutcome('transcribed');
                onTranscriptRef.current(text);
            } else {
                setError('no-speech');
            }
        } catch (err) {
            if (!mountedRef.current || isCancel(err) || controller.signal.aborted) return;
            setError(errorFromUpload(err));
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            if (mountedRef.current) setStatus('idle');
        }
    }, []);

    const stopRecorder = useCallback(
        (discard: boolean) => {
            discardRef.current = discard;
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            const recorder = recorderRef.current;
            if (recorder) {
                // onstop (fired after the last chunk) uploads or discards.
                setStatus(discard ? 'idle' : 'transcribing');
                if (recorder.state !== 'inactive') recorder.stop();
                return;
            }
            releaseMic();
            setStatus('idle');
        },
        [releaseMic]
    );

    const start = useCallback(async () => {
        if (!supported || status !== 'idle') return;
        setError(null);
        setOutcome(null);
        setStoppedAtLimit(false);
        setElapsedSeconds(0);
        setStatus('requesting');
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
            });
        } catch (err) {
            if (mountedRef.current) {
                setError(errorFromGetUserMedia(err));
                setStatus('idle');
            }
            return;
        }
        if (!mountedRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        streamRef.current = stream;

        let recorder: MediaRecorder;
        try {
            const mimeType = pickRecordingMimeType();
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch {
            releaseMic();
            setError('no-mic');
            setStatus('idle');
            return;
        }
        recorderRef.current = recorder;
        chunksRef.current = [];
        discardRef.current = false;

        recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
            const durationMs = Date.now() - startedAtRef.current;
            const type = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
            const recording = new Blob(chunksRef.current, { type });
            chunksRef.current = [];
            recorderRef.current = null;
            releaseMic();
            if (!mountedRef.current) return;
            if (discardRef.current) {
                setStatus('idle');
                return;
            }
            if (recording.size === 0 || durationMs < MIN_RECORDING_MS) {
                setError('no-speech');
                setStatus('idle');
                return;
            }
            void upload(recording);
        };
        recorder.onerror = () => {
            if (mountedRef.current) setError('no-mic');
            stopRecorder(true);
            if (recorder.state === 'inactive' && recorderRef.current === recorder) {
                // A failed recorder may never fire stop.
                recorderRef.current = null;
                releaseMic();
            }
        };
        // The device was unplugged or permission revoked mid-recording.
        stream.getTracks().forEach((track) =>
            track.addEventListener('ended', () => {
                if (recorderRef.current === recorder && recorder.state !== 'inactive') {
                    recorder.stop();
                }
            })
        );

        startedAtRef.current = Date.now();
        recorder.start();
        setStatus('recording');
        timerRef.current = setInterval(() => {
            const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
            setElapsedSeconds(Math.min(seconds, maxSeconds));
            if (seconds >= maxSeconds) {
                setStoppedAtLimit(true);
                stopRecorder(false);
            }
        }, 250);
    }, [supported, status, maxSeconds, releaseMic, stopRecorder, upload]);

    const stop = useCallback(() => stopRecorder(false), [stopRecorder]);

    const cancel = useCallback(() => {
        if (recorderRef.current || abortRef.current) setOutcome('cancelled');
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
            setStatus('idle');
            return;
        }
        stopRecorder(true);
    }, [stopRecorder]);

    const clearError = useCallback(() => setError(null), []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            discardRef.current = true;
            abortRef.current?.abort();
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== 'inactive') recorder.stop();
            if (timerRef.current) clearInterval(timerRef.current);
            streamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    return {
        supported,
        status,
        elapsedSeconds,
        maxSeconds,
        error,
        stoppedAtLimit,
        outcome,
        start,
        stop,
        cancel,
        clearError,
    };
}
