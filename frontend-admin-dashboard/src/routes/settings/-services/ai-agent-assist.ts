import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

const ASSIST_BASE = `${BASE_URL}/admin-core-service/v1/telephony/ai-agents/assist`;

/** Flat cost per assist operation (mirrors backend AiAgentAssistService.COST). */
export const AGENT_ASSIST_CREDIT_COST = 1;

export interface AssistDimension {
    key: string;
    label: string;
    score: number;
    comment?: string;
}

export interface AssistSuggestion {
    title: string;
    detail?: string;
    addition: string;
}

export interface AssistDerived {
    opening_line?: string;
    extraction_questions?: string[];
    dispositions?: string[];
}

export interface AssistAnalysis {
    score: number;
    persona?: string;
    dimensions?: AssistDimension[];
    suggestions?: AssistSuggestion[];
    derived?: AssistDerived;
    /** draft / improve / feedback / regenerate also return the (new) prompt + opening line. */
    prompt?: string;
    opening_line?: string;
    change_summary?: string;
    /** feedback / regenerate. */
    call_insights?: string[];
    /** Deterministic spoken-line checks on the resulting prompt (placeholders, slashes, …). */
    lint?: string[];
}

/** Everything about the agent the assistant reads, and hands back in sync after a rewrite. */
export interface AssistAgentFields {
    agentName?: string;
    language?: string;
    openingLine?: string;
    extractionQuestions?: string[];
    dispositions?: string[];
}

export type AssistOperation = 'draft' | 'analyze' | 'improve' | 'feedback' | 'regenerate';

export interface AssistJobRequest extends AssistAgentFields {
    instituteId: string;
    agentId?: string;
    prompt?: string;
    brief?: string;
    additions?: string[];
    feedback?: string;
    notes?: string;
}

interface AssistJob {
    jobId: string;
    status: 'RUNNING' | 'DONE' | 'FAILED';
    result?: AssistAnalysis;
    error?: string;
    elapsedSeconds?: number;
}

const POLL_MS = 3000;
/** A full rewrite on a reasoning model can take several minutes; stop waiting after 12. */
const MAX_WAIT_MS = 12 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs an assist operation as a background job and polls until it finishes. The job
 * keeps running server-side if the tab closes; `onProgress` gets elapsed seconds.
 */
export async function runAssistJob(
    operation: AssistOperation,
    req: AssistJobRequest,
    onProgress?: (elapsedSeconds: number) => void
): Promise<AssistAnalysis> {
    const { data: started } = await authenticatedAxiosInstance.post<AssistJob>(
        `${ASSIST_BASE}/jobs`,
        { ...req, operation }
    );
    const deadline = Date.now() + MAX_WAIT_MS;
    let job = started;
    while (job.status === 'RUNNING') {
        if (Date.now() > deadline) throw new Error('assist-timeout');
        await sleep(POLL_MS);
        const { data } = await authenticatedAxiosInstance.get<AssistJob>(
            `${ASSIST_BASE}/jobs/${job.jobId}`,
            { params: { instituteId: req.instituteId } }
        );
        job = data;
        onProgress?.(job.elapsedSeconds ?? 0);
    }
    if (job.status === 'FAILED' || !job.result) {
        throw Object.assign(new Error(job.error ?? 'assist-failed'), { assistMessage: job.error });
    }
    return job.result;
}
