/**
 * The per-kind remote table, driven through the real PanelPlayer and the real
 * PanelPdfViewer: only the network, the router and the heavy players are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { applyNavCounter, getRemoteTargetInfo, resetNavBaseline } from './remoteTarget';

const pdf = vi.hoisted(() => ({
    jumpToNextPage: vi.fn(),
    jumpToPreviousPage: vi.fn(),
    jumpToPage: vi.fn(),
}));
const router = vi.hoisted(() => ({ navigate: vi.fn(), goBack: vi.fn() }));
const lessons = vi.hoisted(() => ({ slides: [] as unknown[] }));

vi.mock('../router', () => ({
    navigate: router.navigate,
    goBack: router.goBack,
    AUTH_REQUIRED_SCREENS: [],
    getCurrentRoute: () => ({ screen: 'lessons', params: {} }),
    redirectToLogin: vi.fn(),
    subscribeRoute: () => () => undefined,
    usePanelRoute: () => ({ screen: 'lessons', params: {} }),
}));
vi.mock('../i18n', () => ({ ensureNamespaces: () => Promise.resolve() }));
vi.mock('../content/lessonApi', () => ({
    useSlides: () => ({ data: lessons.slides, isLoading: false, isError: false }),
    useSignedUrl: (fileId: string | null) => ({
        data: fileId ? `http://localhost/${fileId}` : undefined,
        isLoading: false,
        isError: false,
        error: null,
        dataUpdatedAt: 1,
        refetch: vi.fn(),
    }),
    useAiVideoRender: () => ({
        data: { status: 'completed', video_url: 'http://localhost/ai.mp4', progress: 100 },
        isLoading: false,
        isError: false,
        error: null,
        dataUpdatedAt: 1,
        refetch: vi.fn(),
    }),
}));
vi.mock('../content/pdf.worker.ts?worker&url', () => ({ default: 'pdf-worker.js' }));
vi.mock('../content/PanelVideo', () => ({ default: () => <div>video</div> }));
vi.mock('../content/ContentSceneView', () => ({ default: () => <div>scene</div> }));
vi.mock('../content/EmbedPlayer', () => ({ EmbedPlayer: () => <div>embed</div> }));
vi.mock(
    '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/deck-player',
    () => ({ default: () => <div>deck</div> })
);
vi.mock('@react-pdf-viewer/core', () => ({
    SpecialZoomLevel: { PageFit: 'PageFit', PageWidth: 'PageWidth' },
    Worker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Viewer: ({
        onDocumentLoad,
    }: {
        onDocumentLoad: (event: { doc: { numPages: number } }) => void;
    }) => {
        useEffect(() => {
            onDocumentLoad({ doc: { numPages: 12 } });
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return <div>pdf</div>;
    },
}));
vi.mock('@react-pdf-viewer/page-navigation', () => ({ pageNavigationPlugin: () => pdf }));
vi.mock('@react-pdf-viewer/zoom', () => ({ zoomPlugin: () => ({ zoomTo: vi.fn() }) }));

import { PanelPlayer } from '../content/PanelPlayer';

const docSlide = (id: string, type: string, data: string) => ({
    id,
    title: `Title ${id}`,
    source_type: 'DOCUMENT',
    document_slide: { type, data },
});
const videoSlide = (id: string, source_type: string, url: string) => ({
    id,
    title: `Title ${id}`,
    source_type: 'VIDEO',
    video_slide: { source_type, url, published_url: url },
});

const SLIDES = [
    docSlide('before', 'PRESENTATION', 'scene-0'),
    docSlide('a-pdf', 'PDF', 'file-pdf'),
    docSlide('a-deck', 'PPT_ANIM', 'https://localhost/deck'),
    videoSlide('a-youtube', 'YOUTUBE', 'https://youtu.be/dQw4w9WgXcQ'),
    videoSlide('a-vimeo', 'VIMEO', 'https://vimeo.com/76979871'),
    videoSlide('a-file', 'FILE_ID', 'file-video'),
    {
        id: 'an-ai',
        title: 'Title an-ai',
        source_type: 'HTML_VIDEO',
        html_video_slide: { ai_gen_video_id: 'vid-1' },
    },
    docSlide('a-scene', 'PRESENTATION', 'scene-1'),
    docSlide('a-doc', 'DOC', 'text'),
    docSlide('no-file', 'PDF', ''),
    docSlide('after', 'PRESENTATION', 'scene-2'),
];

const open = (slideId: string) =>
    render(<PanelPlayer params={{ courseId: 'c', chapterId: 'ch', slideId }} />);

beforeEach(() => {
    vi.clearAllMocks();
    resetNavBaseline();
    lessons.slides = SLIDES;
});
afterEach(() => resetNavBaseline());

function press() {
    applyNavCounter({ session_id: 's', nav_counter: 0, nav_age_ms: 10 });
    return applyNavCounter({ session_id: 's', nav_counter: 1, nav_age_ms: 10 });
}

describe('PDF arrow keys', () => {
    const arrow = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

    it.each(['role="dialog"', 'role="alertdialog"', 'data-panel-lock'])(
        'leave the page alone while %s is on top',
        async (attribute) => {
            open('a-pdf');
            await waitFor(() => expect(getRemoteTargetInfo().hasTarget).toBe(true));
            const overlay = document.createElement('div');
            const [name, value] = attribute.replace(/"/g, '').split('=');
            overlay.setAttribute(name as string, value ?? '');
            document.body.appendChild(overlay);
            try {
                arrow();
                expect(pdf.jumpToNextPage).not.toHaveBeenCalled();
            } finally {
                // Left in place, it would read as an open dialog in every later test.
                overlay.remove();
            }
            arrow();
            expect(pdf.jumpToNextPage).toHaveBeenCalledTimes(1);
        }
    );
});

describe('remote target per slide kind', () => {
    it('PDF: a press turns the page and never changes the lesson', async () => {
        open('a-pdf');
        await waitFor(() => expect(getRemoteTargetInfo().hasTarget).toBe(true));
        expect(getRemoteTargetInfo().state).toEqual({
            index: 0,
            total: 12,
            title: 'Title a-pdf',
        });
        expect(press().outcome).toBe('APPLIED');
        expect(pdf.jumpToNextPage).toHaveBeenCalledTimes(1);
        expect(router.navigate).not.toHaveBeenCalled();

        expect(applyNavCounter({ session_id: 's', nav_counter: 0, nav_age_ms: 10 }).steps).toBe(-1);
        await waitFor(() => expect(pdf.jumpToPreviousPage).toHaveBeenCalledTimes(1), {
            timeout: 2000,
        });
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it.each(['a-deck', 'a-youtube', 'a-vimeo', 'a-doc', 'no-file'])(
        '%s has no target: the press is dropped and nothing moves',
        async (slideId) => {
            const { findByText, queryByText } = open(slideId);
            if (slideId === 'a-deck') await findByText('deck');
            if (slideId === 'a-youtube' || slideId === 'a-vimeo') {
                expect(queryByText('embed')).not.toBeNull();
            }
            expect(getRemoteTargetInfo()).toEqual({ hasTarget: false, state: null });
            expect(press().outcome).toBe('NO_TARGET');
            expect(router.navigate).not.toHaveBeenCalled();
            expect(pdf.jumpToNextPage).not.toHaveBeenCalled();
        }
    );

    it.each(['a-scene', 'a-file', 'an-ai'])(
        '%s: a press moves to the next slide in the chapter',
        async (slideId) => {
            open(slideId);
            await waitFor(() => expect(getRemoteTargetInfo().hasTarget).toBe(true));
            const position = SLIDES.findIndex((slide) => slide.id === slideId);
            expect(getRemoteTargetInfo().state).toEqual({
                index: position,
                total: SLIDES.length,
                title: `Title ${slideId}`,
            });
            expect(press().outcome).toBe('APPLIED');
            expect(router.navigate).toHaveBeenCalledTimes(1);
            expect(router.navigate.mock.calls[0]?.[1]).toMatchObject({
                slideId: SLIDES[position + 1]?.id,
            });
        }
    );

    it('moving from a scene onto a PDF hands the slot to the viewer', async () => {
        const { rerender } = open('a-scene');
        await waitFor(() => expect(getRemoteTargetInfo().hasTarget).toBe(true));
        rerender(<PanelPlayer params={{ courseId: 'c', chapterId: 'ch', slideId: 'a-pdf' }} />);
        await waitFor(() => expect(getRemoteTargetInfo().state?.total).toBe(12));
        press();
        expect(pdf.jumpToNextPage).toHaveBeenCalledTimes(1);
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('leaving the player empties the slot', async () => {
        const { unmount } = open('a-pdf');
        await waitFor(() => expect(getRemoteTargetInfo().hasTarget).toBe(true));
        unmount();
        expect(getRemoteTargetInfo().hasTarget).toBe(false);
    });
});
