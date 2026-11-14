import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import { uploadDocsFile } from '@/routes/assessment/question-papers/-services/question-paper-services';
import {
    handleGetQuestionsFromText,
    handleGetQuestionsInvidualTask,
} from '@/routes/ai-center/-services/ai-center-service';

/**
 * Where new library questions come from before they are saved: the Word parser and the
 * AI text-to-questions task. Both only return questions; saving is importLibraryQuestions.
 */

const TASK_STATUS_URL = `${AI_SERVICE_BASE_URL}/task-status/get-status`;
const POLL_EVERY_MS = 4000;
/** A text-to-questions run takes well under this; past it the run is treated as lost. */
const GIVE_UP_AFTER_MS = 6 * 60 * 1000;

/** Parses a .docx in the usual format ((1.) questions, (a.) options, Ans:, Exp:, Tags:). */
export const parseWordFile = async (
    file: File,
    onProgress: (percent: number) => void
): Promise<QuestionResponse[]> => {
    const data = await uploadDocsFile('(1.)', '(a.)', 'Ans:', 'Exp:', file, (value) =>
        onProgress(typeof value === 'function' ? 0 : value)
    );
    return Array.isArray(data) ? (data as QuestionResponse[]) : [];
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls an AI task until it is done. Stops quietly when the caller has gone away. */
export const waitForAiTask = async (
    taskId: string,
    isAlive: () => boolean = () => true
): Promise<{ questions?: QuestionResponse[] } | null> => {
    const deadline = Date.now() + GIVE_UP_AFTER_MS;
    while (Date.now() < deadline) {
        await wait(POLL_EVERY_MS);
        if (!isAlive()) return null;
        const { data } = await authenticatedAxiosInstance.get<{
            status?: string;
            statusMessage?: string;
        }>(TASK_STATUS_URL, { params: { taskId } });
        if (data?.status === 'COMPLETED') return handleGetQuestionsInvidualTask(taskId);
        if (data?.status === 'FAILED') {
            throw new Error(data.statusMessage || 'The AI could not finish these questions');
        }
    }
    throw new Error('The AI is taking too long. Please try again.');
};

/**
 * AI questions on one topic, all of one difficulty. The topic path and the difficulty go in
 * the topics field, which the prompt is told to honour; the owner's notes, if any, are the
 * text the questions are drawn from.
 */
export const generateTopicQuestions = async ({
    topicPath,
    notes,
    count,
    difficulty,
    questionType,
    language,
    isAlive,
}: {
    topicPath: string;
    notes: string;
    count: number;
    difficulty: string;
    questionType: string;
    language: string;
    isAlive?: () => boolean;
}): Promise<QuestionResponse[]> => {
    const level = difficulty.toLowerCase();
    const topics = `${topicPath}. Make every question ${level} difficulty and set "level": "${level}" on each.`;
    const text = notes.trim() || `Write exam questions on: ${topicPath}`;
    const started = await handleGetQuestionsFromText(
        `Question Library: ${topicPath} (${level})`,
        text,
        count,
        '',
        topics,
        questionType,
        language,
        ''
    );
    const taskId: string | undefined = started?.taskId ?? started?.task_id;
    if (!taskId) throw new Error('The AI did not start');
    const result = await waitForAiTask(taskId, isAlive);
    return result?.questions ?? [];
};
