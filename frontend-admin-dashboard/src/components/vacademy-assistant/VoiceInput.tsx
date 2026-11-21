import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Microphone, SpinnerGap, Stop, Warning, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { VoiceInput, VoiceInputError } from '@/hooks/use-voice-input';

const ERROR_KEYS: Record<VoiceInputError, string> = {
    permission: 'assistant.voice.errors.permission',
    'no-mic': 'assistant.voice.errors.noMic',
    'no-speech': 'assistant.voice.errors.noSpeech',
    'too-long': 'assistant.voice.errors.tooLong',
    'rate-limited': 'assistant.voice.errors.rateLimited',
    server: 'assistant.voice.errors.server',
};

export function formatElapsed(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * The microphone control for a message box: a mic button; while recording, a
 * pulsing indicator with the elapsed time, Cancel and Stop; while the clip is
 * transcribed, a spinner. Escape cancels a recording. Renders nothing where
 * the browser cannot record.
 */
export function VoiceInputControls({
    voice,
    disabled,
    className,
}: {
    voice: VoiceInput;
    disabled?: boolean;
    className?: string;
}) {
    const { t } = useTranslation('dashboardIndex');
    const stopRef = useRef<HTMLButtonElement>(null);
    const micRef = useRef<HTMLButtonElement>(null);
    const previous = useRef(voice.status);

    // Keep keyboard focus on the control that replaced the one just pressed.
    useEffect(() => {
        const before = previous.current;
        previous.current = voice.status;
        if (voice.status === 'recording' && before !== 'recording') stopRef.current?.focus();
        if (
            voice.status === 'idle' &&
            (before === 'recording' || (before === 'transcribing' && voice.error))
        ) {
            micRef.current?.focus();
        }
    }, [voice.status, voice.error]);

    if (!voice.supported) return null;

    if (voice.status === 'recording') {
        return (
            <div
                role="group"
                aria-label={t('assistant.voice.recording')}
                className={cn('flex shrink-0 items-center gap-1', className)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        voice.cancel();
                    }
                }}
            >
                <span className="flex items-center gap-1.5 px-1 text-caption text-danger-600">
                    <span className="relative flex size-2" aria-hidden="true">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger-400 opacity-75 motion-reduce:animate-none" />
                        <span className="relative inline-flex size-2 rounded-full bg-danger-500" />
                    </span>
                    <span
                        role="timer"
                        aria-label={t('assistant.voice.elapsed', {
                            elapsed: formatElapsed(voice.elapsedSeconds),
                            limit: formatElapsed(voice.maxSeconds),
                        })}
                        className="tabular-nums"
                    >
                        {formatElapsed(voice.elapsedSeconds)}
                    </span>
                </span>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="icon"
                    aria-label={t('assistant.voice.cancel')}
                    title={t('assistant.voice.cancel')}
                    onClick={voice.cancel}
                >
                    <X size={18} aria-hidden="true" />
                </MyButton>
                <MyButton
                    ref={stopRef}
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="icon"
                    aria-label={t('assistant.voice.stop')}
                    title={t('assistant.voice.stop')}
                    onClick={voice.stop}
                >
                    <Stop size={18} weight="fill" className="text-danger-600" aria-hidden="true" />
                </MyButton>
            </div>
        );
    }

    if (voice.status === 'transcribing') {
        return (
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                layoutVariant="icon"
                disable
                aria-busy="true"
                aria-label={t('assistant.voice.transcribing')}
                title={t('assistant.voice.transcribing')}
                className={cn('shrink-0', className)}
            >
                <SpinnerGap size={18} className="animate-spin" aria-hidden="true" />
            </MyButton>
        );
    }

    const requesting = voice.status === 'requesting';
    const label = requesting ? t('assistant.voice.starting') : t('assistant.voice.start');
    return (
        <MyButton
            ref={micRef}
            type="button"
            buttonType="secondary"
            scale="medium"
            layoutVariant="icon"
            disable={disabled || requesting}
            aria-busy={requesting || undefined}
            aria-label={label}
            title={label}
            onClick={() => void voice.start()}
            className={cn('shrink-0', className)}
        >
            <Microphone size={18} aria-hidden="true" />
        </MyButton>
    );
}

/**
 * What the microphone is doing, for screen readers (a polite live region), and
 * a visible, dismissible error when something went wrong.
 */
export function VoiceInputStatusMessage({
    voice,
    className,
}: {
    voice: VoiceInput;
    className?: string;
}) {
    const { t } = useTranslation('dashboardIndex');
    const minutes = Math.round(voice.maxSeconds / 60);
    const [announcement, setAnnouncement] = useState('');
    const previous = useRef(voice.status);

    useEffect(() => {
        const before = previous.current;
        previous.current = voice.status;
        if (before === voice.status) return;
        if (voice.status === 'recording') {
            setAnnouncement(t('assistant.voice.announce.started'));
        } else if (voice.status === 'transcribing') {
            setAnnouncement(
                voice.stoppedAtLimit
                    ? `${t('assistant.voice.announce.limit', { minutes })} ${t('assistant.voice.transcribing')}`
                    : t('assistant.voice.transcribing')
            );
        } else if (voice.status === 'idle') {
            if (voice.outcome === 'transcribed')
                setAnnouncement(t('assistant.voice.announce.done'));
            else if (voice.outcome === 'cancelled')
                setAnnouncement(t('assistant.voice.announce.cancelled'));
            else setAnnouncement('');
        }
    }, [voice.status, voice.outcome, voice.stoppedAtLimit, minutes, t]);

    return (
        <>
            <span className="sr-only" role="status" aria-live="polite">
                {announcement}
            </span>
            {voice.error && (
                <div
                    role="alert"
                    className={cn(
                        'flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2',
                        className
                    )}
                >
                    <Warning
                        size={16}
                        className="mt-0.5 shrink-0 text-danger-500"
                        aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 text-caption text-danger-700">
                        {t(ERROR_KEYS[voice.error], { minutes })}
                    </span>
                    <button
                        type="button"
                        aria-label={t('assistant.voice.dismiss')}
                        onClick={voice.clearError}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-danger-500 transition-colors hover:bg-danger-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-300"
                    >
                        <X size={12} aria-hidden="true" />
                    </button>
                </div>
            )}
        </>
    );
}
