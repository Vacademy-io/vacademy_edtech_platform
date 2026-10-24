/**
 * AI agent registry (Vacademy AI personas) — the data layer behind
 * CRM → Calling → AI Agents.
 *
 * Same endpoints the Settings → AI Calling card talks to; saving an agent
 * auto-registers it as a VACADEMY_AI campaign server-side (campaignId = agent
 * id), which is why every mutation invalidates the campaign-options cache too.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

/** Wire shape of an AI agent — mirrors backend AiAgentDTO. */
export type { AiAgent } from '@/routes/settings/-components/AiAgentsCard';
import type { AiAgent } from '@/routes/settings/-components/AiAgentsCard';

export type { VoiceOption, TtsModelId, TtsModelMeta } from './tts-catalog';
export {
    FALLBACK_VOICES,
    TTS_MODELS,
    creditLine,
    normalizeTtsModel,
    resolveTtsModel,
    voiceLabel,
    voicesForModel,
    defaultVoiceFor,
    patchForModelChange,
} from './tts-catalog';
import { FALLBACK_VOICES, resolveTtsModel } from './tts-catalog';
import type { VoiceOption } from './tts-catalog';

export const AI_AGENTS_URL = `${BASE_URL}/admin-core-service/v1/telephony/ai-agents`;

/** Expressiveness presets → Bulbul v3 temperature. */
export const EXPRESSIVENESS_OPTIONS: { label: string; value: string; temperature?: number }[] = [
    { label: 'Model default', value: 'default' },
    { label: 'Calm & steady', value: 'calm', temperature: 0.3 },
    { label: 'Natural', value: 'natural', temperature: 0.6 },
    { label: 'Expressive', value: 'expressive', temperature: 0.9 },
];

/** Voice modulation presets → pitch-range expansion applied by the bot to the
 *  audio itself, so it works on every TTS engine. `undefined` = platform default. */
export const VOICE_MODULATION_OPTIONS: { label: string; value: string; factor?: number }[] = [
    { label: 'Platform default', value: 'default' },
    { label: 'Off', value: 'off', factor: 1.0 },
    { label: 'Subtle', value: 'subtle', factor: 1.3 },
    { label: 'Conversational', value: 'conversational', factor: 1.6 },
    { label: 'Lively', value: 'lively', factor: 2.0 },
];

export const DEFAULT_SAMPLE_TEXT =
    'Namaste! Main Aarushi bol rahi hoon. Kya main aapse do minute baat kar sakti hoon?';

/** The agent's Language field → Sarvam TTS language code for the voice tester. */
export function previewLang(language?: string): string {
    const l = (language || '').trim().toLowerCase();
    if (l === 'english' || l === 'en' || l === 'en-in') return 'en-IN';
    return 'hi-IN';
}

/** URL of the cached TTS sample for a given voice/pace/expressiveness. */
export function voicePreviewUrl(agent: AiAgent, text: string): string {
    const params = new URLSearchParams({
        text: text.trim() || DEFAULT_SAMPLE_TEXT,
        // NOT lowercased: Google voice ids are exact resource names
        // (hi-IN-Chirp3-HD-Achird), and a lowercased one is rejected — the
        // preview would then fail or, worse, be served by the fallback engine.
        voice: (agent.voice || 'priya').trim(),
        lang: previewLang(agent.language),
        pace: String(agent.pace ?? 1.0),
        // The preview must synthesise on the SAME engine the call will use —
        // otherwise the founder auditions a voice the caller never hears, and a
        // Rumik voice name sent to Sarvam 400s on every preview.
        model: resolveTtsModel(agent),
    });
    if (agent.temperature != null) params.set('temperature', String(agent.temperature));
    return `${BASE_URL}/voice-bot-service/preview.mp3?${params.toString()}`;
}

export function blankAgent(instituteId: string): AiAgent {
    return {
        instituteId,
        name: '',
        enabled: true,
        direction: 'OUTBOUND',
        language: 'hinglish',
        // New agents get the default engine and ITS voice, stamped explicitly so
        // no default anywhere downstream has to carry the pricing decision.
        // See TtsVoiceCatalog.NEW_AGENT_DEFAULT — Rumik is ~6x cheaper per
        // character on the line that dominates call cost.
        ttsModel: 'rumik',
        voice: 'ira',
        openingLine: '',
        systemPrompt: '',
        extractionQuestions: [],
        handoffNumbers: [],
        maxCallMinutes: 6,
    };
}

export const fetchAgents = async (instituteId: string): Promise<AiAgent[]> => {
    const { data } = await authenticatedAxiosInstance.get<AiAgent[]>(AI_AGENTS_URL, {
        params: { instituteId },
    });
    return Array.isArray(data) ? data : [];
};

export const saveAgent = async (agent: AiAgent): Promise<AiAgent> => {
    const { data } = await authenticatedAxiosInstance.post<AiAgent>(AI_AGENTS_URL, agent);
    return data;
};

export const deleteAgent = async (agentId: string, instituteId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${AI_AGENTS_URL}/${encodeURIComponent(agentId)}`, {
        params: { instituteId },
    });
};

/** One row of the institute's `templates` table (type=EMAIL). */
export interface InstituteEmailTemplate {
    id: string;
    name: string;
    subject?: string;
    content?: string;
    contentType?: string;
    status?: string;
}

/**
 * The institute's saved EMAIL templates, for the send-rule picker.
 *
 * Note this is only a SOURCE to copy from, not a live reference: the engagement
 * dispatcher emails `draft_body` verbatim (there is no template layer on the email
 * path), so the rule stores the text, not the template id. Editing the template
 * later does not change rules already written from it.
 */
export const fetchEmailTemplates = async (
    instituteId: string
): Promise<InstituteEmailTemplate[]> => {
    const { data } = await authenticatedAxiosInstance.get<InstituteEmailTemplate[]>(
        `${BASE_URL}/admin-core-service/institute/template/v1/institute/${encodeURIComponent(
            instituteId
        )}/type/EMAIL`
    );
    return Array.isArray(data) ? data : [];
};

export const fetchVoices = async (): Promise<VoiceOption[]> => {
    const { data } = await authenticatedAxiosInstance.get<VoiceOption[]>(`${AI_AGENTS_URL}/voices`);
    return data?.length ? data : FALLBACK_VOICES;
};
