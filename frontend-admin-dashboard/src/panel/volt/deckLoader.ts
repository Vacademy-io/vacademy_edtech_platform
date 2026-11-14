/**
 * Deck loader: presentation metadata + every slide's content, in parallel.
 *
 * Logic follows hooks/useGetSinglePresntation.tsx:13-124 (question slides from
 * added_question, Excalidraw slides from a signed S3 JSON), with three changes:
 *   - Excalidraw slides load 4 at a time instead of 2 serial round trips each;
 *   - nothing is written to localStorage or useSlideStore;
 *   - a slide that fails becomes a 'failed' placeholder instead of vanishing,
 *     so slide positions still match the live session's slide list.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { networkFirst } from '../offline/networkFirst';
import { getDeck, getPublicUrl } from './voltApi';
import type {
    DeckLoadProgress,
    PanelDeck,
    PanelQuestionData,
    PanelSceneData,
    PanelSlide,
    VoltQuestion,
    VoltWireSlide,
} from './types';

const CONCURRENCY = 4;
/** A big deck legitimately takes a while over a slow connection. */
const DECK_SLOW_MS = 20 * 1000;

/** Correct options as stored in auto_evaluation_json (snake or camel case). */
function correctOptionIds(question: VoltQuestion): string[] {
    if (!question.auto_evaluation_json) return [];
    try {
        const parsed = JSON.parse(question.auto_evaluation_json) as {
            data?: { correctOptionIds?: unknown; correct_option_ids?: unknown };
        };
        const ids = parsed?.data?.correctOptionIds || parsed?.data?.correct_option_ids;
        return Array.isArray(ids) ? ids.map((id) => String(id)) : [];
    } catch {
        return [];
    }
}

/** useGetSinglePresntation.tsx:38-73 */
export function questionFromWire(question: VoltQuestion): {
    kind: 'quiz' | 'feedback';
    data: PanelQuestionData;
} {
    const kind =
        question.question_type === 'MCQS' || question.question_type === 'MCQM'
            ? 'quiz'
            : 'feedback';
    const correct = correctOptionIds(question);
    const options = (question.options || []).map((option, index) => ({
        id: option.id,
        name: option.text?.content || '',
        isSelected:
            correct.indexOf(option.id) >= 0 ||
            correct.indexOf(String(option.preview_id)) >= 0 ||
            (typeof option.option_order === 'number' &&
                correct.indexOf(String(option.option_order + 1)) >= 0) ||
            correct.indexOf(String(index + 1)) >= 0,
    }));
    return {
        kind,
        data: {
            questionName: question.text?.content || '',
            singleChoiceOptions: options,
            feedbackAnswer: '',
            timeLimit: (question.default_question_time_mins || 0) * 60 || 60,
        },
    };
}

function sceneFromJson(raw: unknown): PanelSceneData {
    const data = (raw && typeof raw === 'object' ? raw : {}) as {
        elements?: unknown;
        appState?: unknown;
        files?: unknown;
    };
    return {
        elements: Array.isArray(data.elements) ? (data.elements as ExcalidrawElement[]) : [],
        appState:
            data.appState && typeof data.appState === 'object'
                ? (data.appState as PanelSceneData['appState'])
                : {},
        files:
            data.files && typeof data.files === 'object'
                ? (data.files as PanelSceneData['files'])
                : null,
    };
}

async function fetchSceneJson(fileId: string, signal?: AbortSignal): Promise<PanelSceneData> {
    const url = await getPublicUrl(fileId, signal);
    // Plain GET, no custom headers: a custom header would force a CORS preflight
    // against the S3 bucket. The signed URL is unique per request anyway.
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Slide file HTTP ${response.status}`);
    return sceneFromJson(await response.json());
}

async function withOneRetry<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
        return await task();
    } catch (error) {
        if (signal?.aborted) throw error;
        return task();
    }
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let next = 0;
    const runners: Promise<void>[] = [];
    const run = async () => {
        while (next < items.length) {
            const item = items[next];
            next += 1;
            if (item !== undefined) await worker(item);
        }
    };
    for (let i = 0; i < Math.min(limit, items.length); i += 1) runners.push(run());
    await Promise.all(runners);
}

function wireToSlide(slide: VoltWireSlide): PanelSlide {
    const base = { id: slide.id, order: slide.slide_order, title: slide.title || undefined };
    if (slide.source === 'question' && slide.added_question) {
        const { kind, data } = questionFromWire(slide.added_question);
        return { ...base, kind, question: data };
    }
    // Filled in by the scene fetch; stays 'failed' if that fails.
    return { ...base, kind: 'failed' };
}

/**
 * Load a whole deck, from the network or, when that fails, from this teacher's saved
 * copy. A deck with failed slides is not saved, and a whole saved copy is preferred
 * over it. `onProgress` reports Excalidraw slide files fetched so far (question slides
 * need no fetch). Rejects only when the deck itself fails.
 */
export function loadDeck(
    presentationId: string,
    onProgress?: (progress: DeckLoadProgress) => void,
    signal?: AbortSignal
): Promise<PanelDeck> {
    return networkFirst(
        `deck:${presentationId}`,
        () => fetchWholeDeck(presentationId, onProgress, signal),
        { isPartial: (deck) => deck.failedCount > 0, slowMs: DECK_SLOW_MS }
    );
}

async function fetchWholeDeck(
    presentationId: string,
    onProgress?: (progress: DeckLoadProgress) => void,
    signal?: AbortSignal
): Promise<PanelDeck> {
    const detail = await getDeck(presentationId, signal);
    const wire = (detail.added_slides || [])
        .filter((slide): slide is VoltWireSlide => !!slide && !!slide.id)
        .slice()
        .sort((a, b) => (a.slide_order ?? 0) - (b.slide_order ?? 0));

    const slides = wire.map(wireToSlide);
    const sceneJobs: { index: number; fileId: string }[] = [];
    wire.forEach((slide, index) => {
        const isQuestion = slide.source === 'question' && !!slide.added_question;
        if (!isQuestion && slide.content) sceneJobs.push({ index, fileId: slide.content });
    });

    let done = 0;
    onProgress?.({ done, total: sceneJobs.length });
    await mapLimit(sceneJobs, CONCURRENCY, async (job) => {
        try {
            const scene = await withOneRetry(() => fetchSceneJson(job.fileId, signal), signal);
            const current = slides[job.index];
            if (current) slides[job.index] = { ...current, kind: 'scene', scene };
        } catch (error) {
            if (signal?.aborted) throw error;
            console.warn('[panel/volt] slide failed to load', job.fileId, error);
        } finally {
            done += 1;
            onProgress?.({ done, total: sceneJobs.length });
        }
    });

    return {
        id: detail.id,
        title: detail.title || '',
        slides,
        failedCount: slides.filter((slide) => slide.kind === 'failed').length,
    };
}
