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
export type { AiAgent, AiAgentKnowledgeDocument } from '@/routes/settings/-components/AiAgentsCard';
import type { AiAgent, AiAgentKnowledgeDocument } from '@/routes/settings/-components/AiAgentsCard';

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

/** Same limits as AiAgentService: every document rides in the prompt of every turn. */
export const MAX_KNOWLEDGE_DOCUMENTS = 10;
export const MAX_KNOWLEDGE_CHARS = 20_000;
export const KNOWLEDGE_ACCEPT = '.pdf,.docx,.txt,.md,.csv';

/** Text of an uploaded PDF / DOCX / TXT. Stores nothing; saving the agent does. */
export const extractKnowledgeDocument = async (
    instituteId: string,
    file: File
): Promise<AiAgentKnowledgeDocument> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await authenticatedAxiosInstance.post<AiAgentKnowledgeDocument>(
        `${AI_AGENTS_URL}/knowledge/extract`,
        form,
        { params: { instituteId } }
    );
    return data;
};

export interface AgentTestCallResult {
    callLogId?: string;
    status?: string;
    dispatched?: boolean;
    providerMessage?: string;
    queuePosition?: number;
    queueEtaMinutes?: number;
}

/** The saved agent calls this number now (a real, billed call). */
export const placeAgentTestCall = async (
    agentId: string,
    body: { instituteId: string; phoneNumber: string; name?: string }
): Promise<AgentTestCallResult> => {
    const { data } = await authenticatedAxiosInstance.post<AgentTestCallResult>(
        `${AI_AGENTS_URL}/${encodeURIComponent(agentId)}/test-call`,
        body
    );
    return data;
};

/** The server's message for a failed request (VacademyException → `ex`). */
export const agentApiError = (err: unknown, fallback: string): string => {
    const data = (err as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || fallback;
};

/** Starting structure for a new agent's system prompt. */
export const systemPromptTemplate = (agentName: string): string =>
    `## Who you are
You are ${agentName.trim() || '<agent name>'}, calling on behalf of <business name>. Speak warmly and politely. Keep each reply to one or two short sentences and ask one question at a time.

## Greeting
Greet the person by name, say who you are and why you are calling, and check that it is a good time to talk.

## About the business
<What you offer, who it is for, where you are, timings, fees or price range, and what makes you different.>

## Goal of the call
<What a good call ends with, e.g. book a counselling session, or find out the student's class and target exam.>

## Frequently asked questions
Q: <What are the fees?>
A: <answer>
Q: <Where are you located?>
A: <answer>
Q: <What are the timings?>
A: <answer>

## Rules
- If you do not know an answer, say the team will confirm it. Never make up fees, dates or offers.
- If the person is busy, ask when to call back.
- If they are not interested, thank them and end the call politely.`;

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
