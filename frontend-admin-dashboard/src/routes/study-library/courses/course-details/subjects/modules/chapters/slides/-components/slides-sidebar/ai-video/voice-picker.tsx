import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle, CircleNotch, Play, Stop } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    clearLmsVoiceDefault,
    parseLmsVideoError,
    previewLmsVoice,
    setLmsVoiceDefault,
    type LmsVideoVoiceGender,
    type LmsVoiceOption,
    type LmsVoiceProvider,
    type LmsVoiceProviderId,
    type LmsVoicesResponse,
} from '@/services/lms-ai-video';
import {
    findVoiceProvider,
    isVoiceDefault,
    selectVoice,
    selectVoiceProvider,
    voicesForGender,
    type AiVideoFormState,
} from './ai-video-form';
import { ChoiceGroup, SectionHeading } from './ai-video-ui';

const NS = 'studyLibraryAddAiVideoDialog';

export const VOICES_QUERY_KEY = 'lms-ai-video-voices';

/**
 * Plays one voice sample at a time. A voice without a ready-made sample is
 * fetched from POST /voices/preview (with the caller's auth) and played from an
 * object URL that is revoked when playback stops; fetched samples are kept for
 * the dialog's lifetime so replaying doesn't fetch again.
 */
function useVoicePreview(language: string) {
    const { t } = useTranslation(NS);
    const [playingKey, setPlayingKey] = useState<string | null>(null);
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const requestRef = useRef<AbortController | null>(null);
    const samples = useRef(new Map<string, Blob>());

    const stop = useCallback(() => {
        requestRef.current?.abort();
        requestRef.current = null;
        audioRef.current?.pause();
        audioRef.current = null;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
        setPlayingKey(null);
        setLoadingKey(null);
    }, []);

    useEffect(() => stop, [stop]);

    const toggle = async (provider: LmsVoiceProviderId, voice: LmsVoiceOption) => {
        const key = `${provider}:${voice.id}`;
        const wasActive = playingKey === key || loadingKey === key;
        stop();
        if (wasActive) return;

        const fail = () => {
            stop();
            toast.error(t('format.voice.previewFailed'));
        };

        let src = voice.sample_url;
        if (!src) {
            const controller = new AbortController();
            requestRef.current = controller;
            setLoadingKey(key);
            const cacheKey = `${language}:${key}`;
            try {
                let blob = samples.current.get(cacheKey);
                if (!blob) {
                    blob = await previewLmsVoice(
                        { tts_provider: provider, voice_id: voice.id, language },
                        controller.signal
                    );
                    samples.current.set(cacheKey, blob);
                }
                if (controller.signal.aborted) return;
                requestRef.current = null;
                src = URL.createObjectURL(blob);
                objectUrlRef.current = src;
            } catch {
                if (!controller.signal.aborted) fail();
                return;
            }
        }

        const audio = new Audio(src);
        // A stopped sample can still fire ended/error — only the current one may reset the state.
        audio.onended = () => audioRef.current === audio && stop();
        audio.onerror = () => audioRef.current === audio && fail();
        audioRef.current = audio;
        setLoadingKey(null);
        setPlayingKey(key);
        audio.play().catch(() => audioRef.current === audio && fail());
    };

    return { playingKey, loadingKey, toggle };
}

/**
 * Step 2 "Voice": provider cards with their narration rate, the female/male
 * filter, the provider's voices with a play button each, and — for institute
 * admins — setting the selected voice as the institute default.
 */
export function VoicePicker({
    state,
    onChange,
    catalog,
    loading,
    failed,
}: {
    state: AiVideoFormState;
    onChange: (next: AiVideoFormState) => void;
    /** GET /voices for the form's language; undefined while loading or after a failure. */
    catalog: LmsVoicesResponse | undefined;
    loading: boolean;
    failed: boolean;
}) {
    const { t } = useTranslation(NS);
    const queryClient = useQueryClient();
    const preview = useVoicePreview(state.language);
    const [savingDefault, setSavingDefault] = useState(false);

    const provider = findVoiceProvider(catalog, state.ttsProvider);
    const voices = voicesForGender(provider, state.voiceGender);
    const selectedVoice = voices.find((v) => v.id === state.voiceId) ?? null;
    const selectedIsDefault = isVoiceDefault(catalog, state.ttsProvider, state.voiceId);

    const defaultProvider = findVoiceProvider(catalog, catalog?.default?.tts_provider ?? null);
    const defaultLabel = catalog?.default
        ? [
              defaultProvider?.label ?? catalog.default.tts_provider,
              defaultProvider?.voices.find((v) => v.id === catalog.default?.voice_id)?.name ??
                  catalog.default.voice_id,
          ].join(' · ')
        : null;

    const changeDefault = async (voice: LmsVoiceOption | null) => {
        setSavingDefault(true);
        try {
            if (voice && state.ttsProvider) {
                await setLmsVoiceDefault({
                    tts_provider: state.ttsProvider,
                    voice_id: voice.id,
                    voice_gender: voice.gender ?? state.voiceGender,
                });
                toast.success(t('format.voice.default.saved', { name: voice.name }));
            } else {
                await clearLmsVoiceDefault();
                toast.success(t('format.voice.default.cleared'));
            }
            await queryClient.invalidateQueries({ queryKey: [VOICES_QUERY_KEY] });
        } catch (err) {
            toast.error(parseLmsVideoError(err, t('format.voice.default.failed')).detail);
        } finally {
            setSavingDefault(false);
        }
    };

    return (
        <section className="flex flex-col gap-3">
            <SectionHeading title={t('format.voice.label')} helper={t('format.voice.helper')} />

            {catalog && (
                <div
                    role="radiogroup"
                    aria-label={t('format.voice.provider.label')}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                    {catalog.providers.map((p) => (
                        <ProviderCard
                            key={p.id}
                            provider={p}
                            selected={p.id === state.ttsProvider}
                            onClick={() => onChange(selectVoiceProvider(state, p.id))}
                        />
                    ))}
                </div>
            )}

            <ChoiceGroup<LmsVideoVoiceGender>
                label={t('format.voice.gender')}
                value={state.voiceGender}
                columns="two"
                options={[
                    { value: 'female', label: t('format.voice.female') },
                    { value: 'male', label: t('format.voice.male') },
                ]}
                onChange={(voiceGender) => onChange({ ...state, voiceGender, voiceTouched: true })}
            />

            {loading && !catalog && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CircleNotch className="size-3.5 animate-spin" />
                    {t('format.voice.list.loading')}
                </p>
            )}
            {failed && !catalog && (
                <p className="text-xs text-muted-foreground">{t('format.voice.list.failed')}</p>
            )}

            {catalog && provider && (
                <div className="flex flex-col gap-2">
                    <div
                        role="radiogroup"
                        aria-label={t('format.voice.list.label')}
                        className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border"
                    >
                        <VoiceRow
                            name={t('format.voice.list.auto')}
                            tag={t('format.voice.list.autoHelper', { language: state.language })}
                            selected={!state.voiceId}
                            onSelect={() => onChange(selectVoice(state, null))}
                        />
                        {voices.map((v) => {
                            const key = `${provider.id}:${v.id}`;
                            return (
                                <VoiceRow
                                    key={v.id}
                                    name={v.name}
                                    tag={v.accent}
                                    isDefault={isVoiceDefault(catalog, provider.id, v.id)}
                                    selected={state.voiceId === v.id}
                                    onSelect={() => onChange(selectVoice(state, v))}
                                    preview={{
                                        playing: preview.playingKey === key,
                                        loading: preview.loadingKey === key,
                                        onToggle: () => void preview.toggle(provider.id, v),
                                    }}
                                />
                            );
                        })}
                    </div>
                    {voices.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                            {t('format.voice.list.empty', { language: state.language })}
                        </p>
                    )}
                    {catalog.can_set_default && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {defaultLabel && (
                                <span className="text-muted-foreground">
                                    {t('format.voice.default.current', { voice: defaultLabel })}
                                </span>
                            )}
                            {selectedVoice && !selectedIsDefault && (
                                <LinkButton
                                    disabled={savingDefault}
                                    onClick={() => void changeDefault(selectedVoice)}
                                >
                                    {t('format.voice.default.set', { name: selectedVoice.name })}
                                </LinkButton>
                            )}
                            {catalog.default && (
                                <LinkButton
                                    disabled={savingDefault}
                                    onClick={() => void changeDefault(null)}
                                >
                                    {t('format.voice.default.clear')}
                                </LinkButton>
                            )}
                            {savingDefault && (
                                <CircleNotch className="size-3.5 animate-spin text-muted-foreground" />
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

function ProviderCard({
    provider,
    selected,
    onClick,
}: {
    provider: LmsVoiceProvider;
    selected: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation(NS);
    const rate =
        provider.credits_per_minute > 0
            ? t('format.voice.provider.perMinute', { value: provider.credits_per_minute })
            : t('format.voice.provider.free');
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!provider.available}
            onClick={onClick}
            className={cn(
                'flex min-w-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-start transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                selected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-border bg-card hover:border-primary-200 hover:bg-muted',
                !provider.available &&
                    'cursor-not-allowed opacity-50 hover:border-border hover:bg-card'
            )}
        >
            <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                    {provider.label}
                </span>
                <span
                    className={cn(
                        'shrink-0 text-xs font-medium',
                        provider.credits_per_minute > 0
                            ? 'text-muted-foreground'
                            : 'text-success-600'
                    )}
                >
                    {rate}
                </span>
            </span>
            <span className="text-xs text-muted-foreground">
                {provider.available
                    ? provider.description
                    : provider.unavailable_reason || t('format.voice.provider.unavailable')}
            </span>
        </button>
    );
}

function VoiceRow({
    name,
    tag,
    isDefault,
    selected,
    onSelect,
    preview,
}: {
    name: string;
    tag?: string | null;
    isDefault?: boolean;
    selected: boolean;
    onSelect: () => void;
    preview?: { playing: boolean; loading: boolean; onToggle: () => void };
}) {
    const { t } = useTranslation(NS);
    return (
        <div className={cn('flex items-center gap-2 px-2 py-1', selected && 'bg-primary-50')}>
            <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={onSelect}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
                {selected ? (
                    <CheckCircle className="size-4 shrink-0 text-primary-500" weight="fill" />
                ) : (
                    <span className="size-4 shrink-0 rounded-full border border-border" />
                )}
                <span className="truncate text-sm text-foreground">{name}</span>
                {tag && (
                    <span className="shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
                        {tag}
                    </span>
                )}
                {isDefault && (
                    <span className="shrink-0 rounded-sm bg-primary-100 px-1.5 text-xs font-medium text-primary-600">
                        {t('format.voice.default.badge')}
                    </span>
                )}
            </button>
            {preview && (
                <button
                    type="button"
                    onClick={preview.onToggle}
                    aria-label={
                        preview.playing || preview.loading
                            ? t('format.voice.stop', { name })
                            : t('format.voice.play', { name })
                    }
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary-500 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    {preview.loading ? (
                        <CircleNotch className="size-4 animate-spin" />
                    ) : preview.playing ? (
                        <Stop className="size-4" weight="fill" />
                    ) : (
                        <Play className="size-4" weight="fill" />
                    )}
                </button>
            )}
        </div>
    );
}

function LinkButton({
    disabled,
    onClick,
    children,
}: {
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="font-medium text-primary-500 hover:text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}
