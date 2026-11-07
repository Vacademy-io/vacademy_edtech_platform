/**
 * Loaded deck (metadata + every slide) through react-query, so the deck view,
 * the local presenter and the live presenter share one load per deck.
 */
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlideTypeEnum, type Slide as AppSlide } from '@/components/common/slides/utils/types';
import { loadDeck } from './deckLoader';
import type { DeckLoadProgress, PanelSlide } from './types';

export function voltDeckQueryKey(presentationId: string) {
    return ['panel', 'volt', 'deck', presentationId] as const;
}

// Load progress per deck, outside the query function's closure so every
// component showing the same deck sees it.
const progressById = new Map<string, DeckLoadProgress>();
const progressListeners = new Set<() => void>();

function setDeckProgress(presentationId: string, progress: DeckLoadProgress): void {
    progressById.set(presentationId, progress);
    progressListeners.forEach((listener) => listener());
}

function subscribeProgress(listener: () => void): () => void {
    progressListeners.add(listener);
    return () => {
        progressListeners.delete(listener);
    };
}

function fetchDeck(presentationId: string, signal: AbortSignal) {
    setDeckProgress(presentationId, { done: 0, total: 0 });
    return loadDeck(
        presentationId,
        (progress) => setDeckProgress(presentationId, progress),
        signal
    );
}

export function useVoltDeck(presentationId: string | undefined) {
    const id = presentationId ?? '';
    const query = useQuery({
        queryKey: voltDeckQueryKey(id),
        queryFn: ({ signal }) => fetchDeck(id, signal),
        enabled: !!presentationId,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 0,
    });
    const progress = useSyncExternalStore(
        subscribeProgress,
        () => progressById.get(id) ?? null,
        () => null
    );
    return { query, progress };
}

/**
 * The admin slide shape ResponseOverlay / SessionLeaderboardModal read
 * (utils/types.ts QuizSlideData / FeedbackSlideData; ids, type, elements).
 */
export function toAppSlide(slide: PanelSlide): AppSlide {
    if (slide.kind === 'quiz' || slide.kind === 'feedback') {
        return {
            id: slide.id,
            slide_order: slide.order,
            type: slide.kind === 'quiz' ? SlideTypeEnum.Quiz : SlideTypeEnum.Feedback,
            elements: { ...(slide.question ?? {}) },
        } as AppSlide;
    }
    return {
        id: slide.id,
        slide_order: slide.order,
        type: SlideTypeEnum.Excalidraw,
        elements: slide.scene?.elements ?? [],
        appState: slide.scene?.appState ?? {},
        files: slide.scene?.files ?? null,
    };
}
