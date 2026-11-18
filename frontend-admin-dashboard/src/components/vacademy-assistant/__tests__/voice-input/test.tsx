import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import {
    isVoiceInputSupported,
    pickRecordingMimeType,
    useVoiceInput,
    type TranscribeFn,
} from '@/hooks/use-voice-input';
import { VoiceInputControls, VoiceInputStatusMessage, formatElapsed } from '../../VoiceInput';
import { AssistantLaunchBar } from '../../AssistantLaunchBar';
import { useAssistDock } from '@/components/assist-dock/store';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/constants/urls', () => ({
    ASSISTANT_CAPABILITIES: '/assistant/capabilities',
    ASSISTANT_SPEECH_TO_TEXT: '/assistant/speech-to-text',
}));

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});
const voiceCopy = copy.assistant.voice;

// ── browser fakes ────────────────────────────────────────────────────────────

let supportedTypes: string[] = [];
const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];

class FakeMediaRecorder {
    static instances: FakeMediaRecorder[] = [];
    static isTypeSupported = (type: string) => supportedTypes.includes(type);
    state: 'inactive' | 'recording' = 'inactive';
    mimeType: string;
    options?: MediaRecorderOptions;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(_stream: unknown, options?: MediaRecorderOptions) {
        this.options = options;
        this.mimeType = options?.mimeType ?? 'audio/webm';
        FakeMediaRecorder.instances.push(this);
    }

    start() {
        this.state = 'recording';
    }

    stop() {
        this.state = 'inactive';
        // Like the real recorder: the last chunk and "stop" arrive asynchronously.
        void Promise.resolve().then(() => {
            this.ondataavailable?.({ data: new Blob(['a'.repeat(64)], { type: this.mimeType }) });
            this.onstop?.();
        });
    }
}

const getUserMedia = vi.fn();

function installBrowser({ secure = true, recorder = true, mediaDevices = true } = {}) {
    Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
    Object.defineProperty(window, 'MediaRecorder', {
        value: recorder ? FakeMediaRecorder : undefined,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        value: mediaDevices ? { getUserMedia } : undefined,
        configurable: true,
    });
}

function grantMic() {
    getUserMedia.mockImplementation(async () => {
        const track = { stop: vi.fn(), addEventListener: vi.fn() };
        tracks.push(track);
        return { getTracks: () => [track] };
    });
}

function domError(name: string) {
    return Object.assign(new Error(name), { name });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    supportedTypes = ['audio/webm;codecs=opus', 'audio/webm'];
    FakeMediaRecorder.instances = [];
    tracks.length = 0;
    getUserMedia.mockReset();
    grantMic();
    installBrowser();
    vi.mocked(authenticatedAxiosInstance.post).mockReset();
    vi.mocked(authenticatedAxiosInstance.get).mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ── a message box using the controls ────────────────────────────────────────

function Harness({ transcribe, maxSeconds }: { transcribe: TranscribeFn; maxSeconds?: number }) {
    const [text, setText] = useState('');
    const voice = useVoiceInput({
        onTranscript: (t) => setText((current) => (current ? `${current} ${t}` : t)),
        transcribe,
        maxSeconds,
    });
    return (
        <I18nextProvider i18n={i18n}>
            <VoiceInputStatusMessage voice={voice} />
            <input aria-label="message" value={text} onChange={(e) => setText(e.target.value)} />
            <VoiceInputControls voice={voice} />
        </I18nextProvider>
    );
}

async function startRecording() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: voiceCopy.start }));
    });
}

async function advance(ms: number) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

async function stopRecording() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: voiceCopy.stop }));
    });
}

// ── support detection and format ─────────────────────────────────────────────

describe('support', () => {
    it('is supported in a secure context with getUserMedia and MediaRecorder', () => {
        expect(isVoiceInputSupported()).toBe(true);
    });

    it.each([
        ['an insecure page', { secure: false }],
        ['no MediaRecorder', { recorder: false }],
        ['no getUserMedia', { mediaDevices: false }],
    ])('hides the mic button on %s', (_label, env) => {
        installBrowser(env);
        expect(isVoiceInputSupported()).toBe(false);
        render(<Harness transcribe={vi.fn()} />);
        expect(screen.queryByRole('button', { name: voiceCopy.start })).toBeNull();
    });

    it('prefers webm/opus', () => {
        expect(pickRecordingMimeType()).toBe('audio/webm;codecs=opus');
    });

    it('falls back to mp4 where only mp4 can be recorded (Safari)', () => {
        supportedTypes = ['audio/mp4'];
        expect(pickRecordingMimeType()).toBe('audio/mp4');
    });

    it('lets the browser choose when none of the preferred types is supported', () => {
        supportedTypes = [];
        expect(pickRecordingMimeType()).toBe('');
    });
});

// ── recording states ─────────────────────────────────────────────────────────

describe('recording', () => {
    it('asks for the mic on first click and shows the recording state', async () => {
        render(<Harness transcribe={vi.fn()} />);
        await startRecording();
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(FakeMediaRecorder.instances[0]?.options?.mimeType).toBe('audio/webm;codecs=opus');
        expect(screen.getByRole('group', { name: voiceCopy.recording })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: voiceCopy.stop })).toHaveFocus();
        expect(screen.getByRole('button', { name: voiceCopy.cancel })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(voiceCopy.announce.started);

        await advance(65_000);
        expect(screen.getByRole('timer')).toHaveTextContent('1:05');
        expect(screen.getByRole('timer')).toHaveAccessibleName('1:05 of 2:00');
    });

    it('transcribes on stop and puts the text in the box without sending it', async () => {
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>(async () => ({
            transcript: 'show pending fees',
        }));
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await advance(3_000);
        await stopRecording();

        await waitFor(() =>
            expect(screen.getByLabelText('message')).toHaveValue('show pending fees')
        );
        expect(transcribe).toHaveBeenCalledTimes(1);
        const recording = transcribe.mock.calls[0]![0];
        expect(recording.type).toBe('audio/webm;codecs=opus');
        expect(recording.size).toBeGreaterThan(0);
        expect(tracks[0]!.stop).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: voiceCopy.start })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(voiceCopy.announce.done);
    });

    it('shows a spinner while the recording is transcribed', async () => {
        let resolve: (value: { transcript: string }) => void = () => {};
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>(
            () => new Promise((r) => (resolve = r as typeof resolve))
        );
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await advance(2_000);
        await stopRecording();
        expect(screen.getByRole('button', { name: voiceCopy.transcribing })).toBeDisabled();
        await act(async () => resolve({ transcript: 'hello' }));
        expect(screen.getByLabelText('message')).toHaveValue('hello');
    });

    it('records mp4 on Safari and uploads it as mp4', async () => {
        supportedTypes = ['audio/mp4'];
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>(async () => ({
            transcript: 'ok',
        }));
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await advance(2_000);
        await stopRecording();
        await waitFor(() => expect(transcribe).toHaveBeenCalled());
        expect(transcribe.mock.calls[0]![0].type).toBe('audio/mp4');
    });

    it('stops by itself at the duration limit and transcribes', async () => {
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>(async () => ({
            transcript: 'long question',
        }));
        render(<Harness transcribe={transcribe} maxSeconds={5} />);
        await startRecording();
        await advance(5_250);
        await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByLabelText('message')).toHaveValue('long question'));
    });

    it('cancel discards the recording and releases the mic', async () => {
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>();
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await advance(2_000);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: voiceCopy.cancel }));
        });
        expect(transcribe).not.toHaveBeenCalled();
        expect(tracks[0]!.stop).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: voiceCopy.start })).toHaveFocus();
        expect(screen.getByRole('status')).toHaveTextContent(voiceCopy.announce.cancelled);
    });

    it('Escape cancels a recording', async () => {
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>();
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await act(async () => {
            fireEvent.keyDown(screen.getByRole('button', { name: voiceCopy.stop }), {
                key: 'Escape',
            });
        });
        expect(transcribe).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: voiceCopy.start })).toBeInTheDocument();
    });

    it('a click too short to hold a word is not uploaded', async () => {
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>();
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await advance(100);
        await stopRecording();
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(voiceCopy.errors.noSpeech)
        );
        expect(transcribe).not.toHaveBeenCalled();
    });
});

// ── errors ───────────────────────────────────────────────────────────────────

describe('errors', () => {
    it.each([
        ['NotAllowedError', voiceCopy.errors.permission],
        ['NotFoundError', voiceCopy.errors.noMic],
        ['NotReadableError', voiceCopy.errors.noMic],
    ])('%s from getUserMedia is explained', async (name, message) => {
        getUserMedia.mockRejectedValueOnce(domError(name));
        render(<Harness transcribe={vi.fn()} />);
        await startRecording();
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(screen.getByRole('button', { name: voiceCopy.start })).toBeInTheDocument();
    });

    it.each([
        [422, voiceCopy.errors.noSpeech],
        [413, voiceCopy.errors.tooLong.replace('{{minutes}}', '2')],
        [429, voiceCopy.errors.rateLimited],
        [502, voiceCopy.errors.server],
        [500, voiceCopy.errors.server],
    ])('a %s from the server is explained', async (status, message) => {
        const transcribe = vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>(async () => {
            throw Object.assign(new Error('failed'), { response: { status } });
        });
        render(<Harness transcribe={transcribe} />);
        await startRecording();
        await advance(2_000);
        await stopRecording();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
        expect(screen.getByLabelText('message')).toHaveValue('');
        expect(screen.getByRole('button', { name: voiceCopy.start })).toHaveFocus();
    });

    it('an empty transcript reads as nothing heard', async () => {
        render(
            <Harness
                transcribe={vi.fn<Parameters<TranscribeFn>, ReturnType<TranscribeFn>>(async () => ({
                    transcript: '  ',
                }))}
            />
        );
        await startRecording();
        await advance(2_000);
        await stopRecording();
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(voiceCopy.errors.noSpeech)
        );
    });

    it('the error can be dismissed', async () => {
        getUserMedia.mockRejectedValueOnce(domError('NotAllowedError'));
        render(<Harness transcribe={vi.fn()} />);
        await startRecording();
        fireEvent.click(screen.getByRole('button', { name: voiceCopy.dismiss }));
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

// ── the default upload ───────────────────────────────────────────────────────

describe('upload', () => {
    it('posts the recording as multipart with an auto language hint', async () => {
        vi.mocked(authenticatedAxiosInstance.post).mockResolvedValue({
            data: { transcript: 'namaste', language: 'hi-IN' },
        });
        const onTranscript = vi.fn();
        const { result } = renderHook(() => useVoiceInput({ onTranscript }));
        await act(async () => {
            await result.current.start();
        });
        await advance(2_000);
        await act(async () => {
            result.current.stop();
        });
        await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('namaste'));
        const [url, body] = vi.mocked(authenticatedAxiosInstance.post).mock.calls[0]!;
        expect(url).toBe('/assistant/speech-to-text');
        const form = body as FormData;
        expect(form.get('language')).toBe('auto');
        const file = form.get('file') as File;
        expect(file.name).toBe('question.webm');
        expect(file.type).toBe('audio/webm;codecs=opus');
    });
});

// ── dashboard launch bar ─────────────────────────────────────────────────────

describe('dashboard launch bar', () => {
    it('puts a spoken question in the box without asking it', async () => {
        vi.mocked(authenticatedAxiosInstance.post).mockResolvedValue({
            data: { transcript: 'who has fees due', language: 'en-IN' },
        });
        useAssistDock.setState({ panel: 'none', pendingPrompt: null });
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
        });
        client.setQueryData(['assistant-capabilities'], {
            groups: [{ key: 'learner_data', mode: 'READ', tools: ['find_learner'] }],
        });
        render(
            <I18nextProvider i18n={i18n}>
                <QueryClientProvider client={client}>
                    <AssistantLaunchBar />
                </QueryClientProvider>
            </I18nextProvider>
        );
        await startRecording();
        await advance(2_000);
        await stopRecording();
        const box = screen.getByRole('textbox');
        await waitFor(() => expect(box).toHaveValue('who has fees due'));
        expect(useAssistDock.getState().pendingPrompt).toBeNull();
        expect(useAssistDock.getState().panel).toBe('none');
    });
});

describe('formatElapsed', () => {
    it('formats minutes and seconds', () => {
        expect(formatElapsed(0)).toBe('0:00');
        expect(formatElapsed(65)).toBe('1:05');
        expect(formatElapsed(120)).toBe('2:00');
    });
});
