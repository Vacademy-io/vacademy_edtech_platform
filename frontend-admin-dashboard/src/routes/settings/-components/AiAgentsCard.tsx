import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { PencilSimple, Play, Plus, Robot, SpinnerGap, Stop, Trash } from '@phosphor-icons/react';
import { fetchBookingPages } from '@/routes/meetings/-services/meetings-services';
import { AiAgentPromptAssistant, type AgentAssistUpdate } from './AiAgentPromptAssistant';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { Campaign } from './AiCallingSettings';

import {
    FALLBACK_VOICES,
    TTS_MODELS,
    creditLine,
    patchForModelChange,
    resolveTtsModel,
    voicesForModel,
    voiceLabel,
} from '@/routes/calling/ai-agents/-services/tts-catalog';
import type { TtsModelId, VoiceOption } from '@/routes/calling/ai-agents/-services/tts-catalog';
import { VOICE_MODULATION_OPTIONS } from '@/routes/calling/ai-agents/-services/ai-agents';

/** Wire shape of an AI agent (Vacademy AI persona) — mirrors backend AiAgentDTO. */
export interface AiAgent {
    id?: string;
    instituteId: string;
    name: string;
    enabled?: boolean;
    direction?: 'OUTBOUND' | 'INBOUND' | 'BOTH';
    language?: string;
    voice?: string;
    openingLine?: string;
    systemPrompt?: string;
    extractionQuestions?: string[];
    dispositions?: string[];
    handoffNumbers?: string[];
    maxCallMinutes?: number;
    /** Speaking rate 0.5–2.0 (1.0 native); empty = platform default. */
    pace?: number;
    /** Expressiveness 0.01–2.0 (~0.6 model default); empty = model default. */
    temperature?: number;
    /** Voice modulation 1.0–2.5 (pitch-range expansion on the audio, any engine); empty = platform default. */
    voiceModulation?: number;
    /** Optional booking page this agent auto-books on when a call yields a meeting request. */
    bookingPageId?: string;
    /**
     * TTS engine: 'rumik' (default, included in the base rate) or 'sarvam'
     * (+4 credits/min). Omitting it on save KEEPS the stored engine, so an older
     * client cannot reprice an agent by not sending the field.
     */
    ttsModel?: string;
    /**
     * What to send / book when a call ends in a given state. Like ttsModel, OMITTING
     * this on save keeps whatever is stored — only an explicit array replaces it.
     */
    sendRules?: AiCallActionRule[];
}

/** One "when X, do Y" rule — mirrors backend AiCallActionRule. */
export interface AiCallActionRule {
    /**
     * Stable id, minted by the backend on first save. NEVER regenerate it on edit:
     * it is half the send-idempotency key (callLogId:ruleId), so a new id would make
     * an edited rule re-fire for every lead whose call is later reprocessed.
     */
    id?: string;
    label?: string;
    enabled?: boolean;
    /**
     * The offer the agent makes out loud ("kya main aapko WhatsApp par bhej doon?").
     * Injected into the call prompt, so the rule is self-contained — no need to also
     * hand-write the same line into the system prompt and keep the two in sync.
     */
    askLine?: string;
    /** POST_CALL (default) — after the call is analysed; MID_CALL — the agent fires it live. */
    timing?: 'POST_CALL' | 'MID_CALL';
    /** Stable key the AI uses to name this artefact. */
    artefact?: string;
    actionType?: 'SHARE_LINK' | 'SEND_MESSAGE' | 'BOOK_MEETING';
    channel?: 'WHATSAPP' | 'EMAIL';
    template?: string;
    templateLanguage?: string;
    /**
     * WhatsApp only: what fills the template's {{1}}, {{2}}, ... in order. The count must
     * equal the template's parameter count or Meta rejects the send outright (#132000). design-lint-ignore: Meta API error code, not a color literal
     */
    templateParams?: string[];
    /**
     * WhatsApp only: the image or document a media-header template shows above its body.
     * Required for such a template — without it Meta rejects the send with 132012,
     * "header: Format mismatch, expected IMAGE, received UNKNOWN". Travels to the send as
     * the `_headerUrl` variable, which both provider paths keep out of the body params.
     */
    templateHeaderUrl?: string;
    /**
     * Which kind of file `templateHeaderUrl` points at. Derived from the chosen template,
     * never typed. The send must say so explicitly — WhatsAppService treats anything that
     * is not literally "image" as a document, so an absent type makes Meta reject an image
     * template with 132012, "expected IMAGE, received DOCUMENT".
     */
    templateHeaderType?: 'image' | 'document';
    /**
     * EMAIL only: the message the person receives. Email has no template layer — it is
     * sent verbatim and its FIRST LINE becomes the subject. Supports {{name}}.
     */
    messageBody?: string;
    to?: 'phone' | 'email';
    bookingPageId?: string;
    when?: {
        disposition?: string;
        promised?: string;
        /** The agent offered this artefact and the caller REFUSED it. */
        declined?: string;
        /** A sentence the admin wrote, judged true of the call by the post-call analyser. */
        custom?: string;
        meetingRequested?: boolean;
        extracted?: Record<string, string>;
    };
}

/** Expressiveness presets → Bulbul v3 temperature. */
function getExpressivenessOptions(
    t: TFunction
): { label: string; value: string; temperature?: number }[] {
    return [
        { label: t('expressiveness.default'), value: 'default' },
        { label: t('expressiveness.calm'), value: 'calm', temperature: 0.3 },
        { label: t('expressiveness.natural'), value: 'natural', temperature: 0.6 },
        { label: t('expressiveness.expressive'), value: 'expressive', temperature: 0.9 },
    ];
}

const DEFAULT_SAMPLE_TEXT =
    'Namaste! Main Aarushi bol rahi hoon. Kya main aapse do minute baat kar sakti hoon?';

/** The agent's Language field → Sarvam TTS language code for the voice tester. */
function previewLang(language?: string): string {
    const l = (language || '').trim().toLowerCase();
    if (l === 'english' || l === 'en' || l === 'en-in') return 'en-IN';
    return 'hi-IN';
}

const AI_AGENTS_URL = `${BASE_URL}/admin-core-service/v1/telephony/ai-agents`;

const fetchAgents = async (instituteId: string): Promise<AiAgent[]> => {
    const { data } = await authenticatedAxiosInstance.get<AiAgent[]>(AI_AGENTS_URL, {
        params: { instituteId },
    });
    return data ?? [];
};

const saveAgent = async (agent: AiAgent): Promise<AiAgent> => {
    const { data } = await authenticatedAxiosInstance.post<AiAgent>(AI_AGENTS_URL, agent);
    return data;
};

const deleteAgent = async (agentId: string, instituteId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${AI_AGENTS_URL}/${encodeURIComponent(agentId)}`, {
        params: { instituteId },
    });
};

function blankAgent(instituteId: string): AiAgent {
    return {
        instituteId,
        name: '',
        enabled: true,
        direction: 'OUTBOUND',
        language: 'hinglish',
        // See TtsVoiceCatalog.NEW_AGENT_DEFAULT.
        ttsModel: 'rumik',
        voice: 'ira',
        openingLine: '',
        systemPrompt: '',
        extractionQuestions: [],
        handoffNumbers: [],
        maxCallMinutes: 6,
    };
}

/**
 * The Vacademy AI agent registry editor. Saving an agent auto-registers it in
 * the campaigns list server-side (campaignId = agent id, provider VACADEMY_AI) —
 * the `onBridged`/`onRemoved` callbacks mirror that into the parent settings
 * screen's unsaved local state so a later "Save changes" doesn't clobber it.
 */
export function AiAgentsCard({
    onBridged,
    onRemoved,
}: {
    onBridged: (campaign: Campaign) => void;
    onRemoved: (agentId: string) => void;
}) {
    const { t } = useTranslation('settingsAiAgentsCard');
    const instituteId = getCurrentInstituteId() ?? '';
    const queryClient = useQueryClient();
    const EXPRESSIVENESS_OPTIONS = getExpressivenessOptions(t);

    const agentsQuery = useQuery({
        queryKey: ['ai-agents', instituteId],
        queryFn: () => fetchAgents(instituteId),
        enabled: !!instituteId,
    });

    const [editing, setEditing] = useState<AiAgent | null>(null);

    // Voice tester: short sample text spoken by the currently-selected voice at the
    // chosen pace/expressiveness, via the voice-bot's cached /preview.mp3 (same TTS
    // stack as live calls, so what you hear is what callers get — minus telephony's
    // 8 kHz narrowband, which always sounds slightly crisper here than on a phone).
    const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE_TEXT);
    const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const bookingPagesQuery = useQuery({
        queryKey: ['ai-agent-booking-pages', instituteId],
        queryFn: () => fetchBookingPages({ instituteId }),
        staleTime: 60_000,
    });
    const bookingPages = bookingPagesQuery.data ?? [];

    const voicesQuery = useQuery({
        queryKey: ['ai-agent-voices'],
        queryFn: async (): Promise<VoiceOption[]> => {
            const { data } = await authenticatedAxiosInstance.get<VoiceOption[]>(
                `${AI_AGENTS_URL}/voices`
            );
            return data?.length ? data : FALLBACK_VOICES;
        },
        staleTime: 24 * 60 * 60 * 1000,
    });
    const allVoices = voicesQuery.data ?? FALLBACK_VOICES;
    // Engine decides the palette — the two share no voice names, so offering all of
    // them would let someone pick a voice that mutes every call.
    const ttsModel = editing ? resolveTtsModel(editing) : 'google';
    const voices = voicesForModel(allVoices, ttsModel);

    const stopPreview = () => {
        audioRef.current?.pause();
        audioRef.current = null;
        setPreviewState('idle');
    };

    const playPreview = (agent: AiAgent) => {
        stopPreview();
        // Case preserved on purpose: Google voice ids are exact resource names.
        const voice = (agent.voice || 'priya').trim();
        const params = new URLSearchParams({
            text: sampleText.trim() || DEFAULT_SAMPLE_TEXT,
            voice,
            lang: previewLang(agent.language),
            pace: String(agent.pace ?? 1.0),
        });
        if (agent.temperature != null) params.set('temperature', String(agent.temperature));
        // Audition on the SAME engine the call will use. Without this the tester
        // always synthesised through Sarvam, so picking any other engine here
        // auditioned a voice the caller would never hear (and a non-Sarvam voice
        // name makes the preview fail outright).
        params.set('model', resolveTtsModel(agent));
        const audio = new Audio(`${BASE_URL}/voice-bot-service/preview.mp3?${params.toString()}`);
        audioRef.current = audio;
        setPreviewState('loading');
        audio.onplaying = () => setPreviewState('playing');
        audio.onended = stopPreview;
        audio.onerror = () => {
            stopPreview();
            toast.error(t('toast.previewSynthesisFailed'));
        };
        void audio.play().catch(() => {
            stopPreview();
            toast.error(t('toast.previewPlaybackFailed'));
        });
    };

    const saveMutation = useMutation({
        mutationFn: saveAgent,
        onSuccess: (saved) => {
            toast.success(t('toast.agentSaved'));
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['ai-agents', instituteId] });
            queryClient.invalidateQueries({
                queryKey: ['ai-calling-campaign-options', instituteId],
            });
            if (saved.id) {
                if (saved.enabled === false) {
                    onRemoved(saved.id);
                } else {
                    onBridged({
                        campaignId: saved.id,
                        name: saved.name,
                        direction: saved.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
                        provider: 'VACADEMY_AI',
                    });
                }
            }
        },
        onError: (err: unknown) => {
            const msg = (err as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.agentSaveFailed'));
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (agentId: string) => deleteAgent(agentId, instituteId),
        onSuccess: (_res, agentId) => {
            toast.success(t('toast.agentDeleted'));
            queryClient.invalidateQueries({ queryKey: ['ai-agents', instituteId] });
            queryClient.invalidateQueries({
                queryKey: ['ai-calling-campaign-options', instituteId],
            });
            onRemoved(agentId);
        },
        onError: () => toast.error(t('toast.agentDeleteFailed')),
    });

    const agents = agentsQuery.data ?? [];
    const patch = (p: Partial<AiAgent>) => setEditing((prev) => (prev ? { ...prev, ...p } : prev));

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Robot className="size-5" /> {t('header.title')}
                </CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {agentsQuery.isLoading && (
                    <p className="text-xs text-muted-foreground">{t('loading')}</p>
                )}
                {!agentsQuery.isLoading && agents.length === 0 && !editing && (
                    <p className="text-xs text-muted-foreground">{t('empty')}</p>
                )}

                {agents.map((a) => (
                    <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {a.name}
                                {a.enabled === false && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {t('list.disabled')}
                                    </span>
                                )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                                {t('list.summary', {
                                    direction: a.direction ?? 'OUTBOUND',
                                    language: a.language ?? 'hinglish',
                                    voice: a.voice ?? 'priya',
                                })}
                                {a.maxCallMinutes
                                    ? t('list.maxMinutesSuffix', { count: a.maxCallMinutes })
                                    : ''}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setEditing({ ...blankAgent(instituteId), ...a })}
                            >
                                <PencilSimple className="size-4" />
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => a.id && deleteMutation.mutate(a.id)}
                            >
                                <Trash className="size-4" />
                            </MyButton>
                        </div>
                    </div>
                ))}

                {editing ? (
                    <div className="space-y-3 rounded-md border border-dashed p-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label>{t('form.agentName.label')}</Label>
                                <Input
                                    value={editing.name}
                                    placeholder={t('form.agentName.placeholder')}
                                    onChange={(e) => patch({ name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>{t('form.direction.label')}</Label>
                                <Select
                                    value={editing.direction ?? 'OUTBOUND'}
                                    onValueChange={(v) =>
                                        patch({ direction: v as AiAgent['direction'] })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="OUTBOUND">
                                            {t('direction.outbound')}
                                        </SelectItem>
                                        <SelectItem value="INBOUND">
                                            {t('direction.inbound')}
                                        </SelectItem>
                                        <SelectItem value="BOTH">{t('direction.both')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end justify-between gap-3">
                                <div className="flex-1 space-y-1.5">
                                    <Label>{t('form.maxCallMinutes.label')}</Label>
                                    <Input
                                        type="number"
                                        value={editing.maxCallMinutes ?? ''}
                                        onChange={(e) =>
                                            patch({
                                                maxCallMinutes: e.target.value
                                                    ? Number(e.target.value)
                                                    : undefined,
                                            })
                                        }
                                    />
                                </div>
                                <div className="flex items-center gap-2 pb-2">
                                    <Label className="text-xs">{t('form.enabled.label')}</Label>
                                    <Switch
                                        checked={editing.enabled !== false}
                                        onCheckedChange={(v) => patch({ enabled: v })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>{t('form.language.label')}</Label>
                                <Input
                                    value={editing.language ?? ''}
                                    placeholder={t('form.language.placeholder')}
                                    onChange={(e) => patch({ language: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>{t('form.voiceEngine.label')}</Label>
                                <Select
                                    value={ttsModel}
                                    onValueChange={(v) =>
                                        patch(
                                            patchForModelChange(
                                                v as TtsModelId,
                                                editing?.voice,
                                                allVoices
                                            )
                                        )
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {TTS_MODELS.map((m) => (
                                            <SelectItem key={m.id} value={m.id}>
                                                {m.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {TTS_MODELS.find((m) => m.id === ttsModel)?.note}
                                    {creditLine(TTS_MODELS.find((m) => m.id === ttsModel)) && (
                                        <span className="mt-0.5 block font-medium text-neutral-700">
                                            {creditLine(TTS_MODELS.find((m) => m.id === ttsModel))}
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>{t('form.voice.label')}</Label>
                                <Select
                                    value={editing.voice ?? ''}
                                    onValueChange={(v) => patch({ voice: v })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('form.voice.placeholder')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {voices.map((v) => (
                                            <SelectItem key={v.id} value={v.id}>
                                                {voiceLabel(v)} ·{' '}
                                                {v.gender === 'male'
                                                    ? t('form.voice.genderMale')
                                                    : t('form.voice.genderFemale')}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('form.voice.genderHint')}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>{t('form.speakingPace.label')}</Label>
                                <Input
                                    type="number"
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    value={editing.pace ?? ''}
                                    placeholder={t('form.speakingPace.placeholder')}
                                    onChange={(e) =>
                                        patch({
                                            pace: e.target.value
                                                ? Number(e.target.value)
                                                : undefined,
                                        })
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('form.speakingPace.hint')}
                                    {ttsModel === 'rumik' ? t('form.speakingPace.rumikHint') : ''}
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>{t('form.expressivenessField.label')}</Label>
                                <Select
                                    value={
                                        EXPRESSIVENESS_OPTIONS.find(
                                            (o) => o.temperature === editing.temperature
                                        )?.value ?? 'default'
                                    }
                                    onValueChange={(v) =>
                                        patch({
                                            temperature: EXPRESSIVENESS_OPTIONS.find(
                                                (o) => o.value === v
                                            )?.temperature,
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {EXPRESSIVENESS_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>
                                                {o.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('form.expressivenessField.hint')}
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>{t('form.voiceModulation.label')}</Label>
                                <Select
                                    value={
                                        VOICE_MODULATION_OPTIONS.find(
                                            (o) => o.factor === editing.voiceModulation
                                        )?.value ?? 'default'
                                    }
                                    onValueChange={(v) =>
                                        patch({
                                            voiceModulation: VOICE_MODULATION_OPTIONS.find(
                                                (o) => o.value === v
                                            )?.factor,
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {VOICE_MODULATION_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>
                                                {t(`form.voiceModulation.options.${o.value}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('form.voiceModulation.hint')}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-1.5 rounded-md border p-3">
                            <Label>{t('form.voiceTester.label')}</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={sampleText}
                                    maxLength={300}
                                    placeholder={DEFAULT_SAMPLE_TEXT}
                                    onChange={(e) => setSampleText(e.target.value)}
                                />
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    disable={previewState === 'loading'}
                                    onClick={() =>
                                        previewState === 'playing'
                                            ? stopPreview()
                                            : playPreview(editing)
                                    }
                                >
                                    {previewState === 'loading' ? (
                                        <SpinnerGap className="size-4 animate-spin" />
                                    ) : previewState === 'playing' ? (
                                        <Stop className="size-4" />
                                    ) : (
                                        <Play className="size-4" />
                                    )}
                                    {previewState === 'playing'
                                        ? t('form.voiceTester.stop')
                                        : t('form.voiceTester.play')}
                                </MyButton>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('form.voiceTester.hint')}
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label>{t('form.openingLine.label')}</Label>
                            <Textarea
                                rows={2}
                                value={editing.openingLine ?? ''}
                                placeholder={t('form.openingLine.placeholder')}
                                onChange={(e) => patch({ openingLine: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('form.systemPrompt.label')}</Label>
                            <Textarea
                                rows={5}
                                value={editing.systemPrompt ?? ''}
                                placeholder={t('form.systemPrompt.placeholder')}
                                onChange={(e) => patch({ systemPrompt: e.target.value })}
                            />
                        </div>
                        <AiAgentPromptAssistant
                            instituteId={instituteId}
                            agentId={editing.id}
                            prompt={editing.systemPrompt ?? ''}
                            fields={{
                                agentName: editing.name,
                                language: editing.language,
                                openingLine: editing.openingLine,
                                extractionQuestions: editing.extractionQuestions,
                                dispositions: editing.dispositions,
                            }}
                            onApply={(u: AgentAssistUpdate) => patch(u)}
                        />
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>{t('form.extractionQuestions.label')}</Label>
                                <Textarea
                                    rows={3}
                                    value={(editing.extractionQuestions ?? []).join('\n')}
                                    placeholder={t('form.extractionQuestions.placeholder')}
                                    onChange={(e) =>
                                        patch({
                                            extractionQuestions: e.target.value
                                                .split('\n')
                                                .map((s) => s.trim())
                                                .filter(Boolean),
                                        })
                                    }
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>{t('form.handoffNumbers.label')}</Label>
                                <Input
                                    value={(editing.handoffNumbers ?? []).join(', ')}
                                    placeholder={t('form.handoffNumbers.placeholder')}
                                    onChange={(e) =>
                                        patch({
                                            handoffNumbers: e.target.value
                                                .split(',')
                                                .map((s) => s.trim())
                                                .filter(Boolean),
                                        })
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('form.handoffNumbers.hint')}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>{t('form.bookingPage.label')}</Label>
                            <Select
                                value={editing.bookingPageId || 'NONE'}
                                onValueChange={(v) =>
                                    patch({ bookingPageId: v === 'NONE' ? undefined : v })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('form.bookingPage.placeholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="NONE">
                                        {t('form.bookingPage.none')}
                                    </SelectItem>
                                    {bookingPages.map((bp) => (
                                        <SelectItem key={bp.id} value={bp.id ?? ''}>
                                            {bp.title}
                                            {bp.audience_id
                                                ? t('form.bookingPage.audienceSuffix')
                                                : t('form.bookingPage.noAudienceSuffix')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {t('form.bookingPage.hint')}
                                {bookingPages.length === 0 && t('form.bookingPage.hintNoPages')}
                            </p>
                        </div>

                        <div className="flex justify-end gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setEditing(null)}
                            >
                                {t('form.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                disable={saveMutation.isPending || !editing.name.trim()}
                                onClick={() => saveMutation.mutate(editing)}
                            >
                                {saveMutation.isPending ? t('form.saving') : t('form.save')}
                            </MyButton>
                        </div>
                    </div>
                ) : (
                    <div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setEditing(blankAgent(instituteId))}
                        >
                            <Plus className="size-4" /> {t('form.newAgent')}
                        </MyButton>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
