import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LiveSiteFrame, frameScale, framePayload, pageForRoute, previewPathOf, selectableId } from './LiveSiteFrame';
import { useEditorStore } from '../-stores/editor-store';
import type { CatalogueConfig, Component, Page } from '../-types/editor-types';

/**
 * The Website view: the real site laid out at a real device width and scaled
 * to fit the canvas, the page's real route and (when editing हिन्दी) the
 * language sent with the draft, Select | Browse, and the frame's clicks —
 * nested blocks, and links to other pages — landing in the editor.
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));

// The test DOM must not fetch the site the frame points at.
(window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }).happyDOM!.settings.disableIframePageLoading = true;

const heading = (id: string): Component => ({ id, type: 'sectionHeading', enabled: true, props: { title: id } });
const columns: Component = {
    id: 'cols',
    type: 'columnLayout',
    enabled: true,
    props: { slots: [[heading('in-column')], []] },
};
const tabs: Component = {
    id: 'tabs',
    type: 'tabsAccordion',
    enabled: true,
    props: { items: [{ title: 'One', slot: [heading('in-tab')] }] },
};

const site = (i18nEnabled = true): CatalogueConfig =>
    ({
        globalSettings: {
            i18n: {
                enabled: i18nEnabled,
                defaultLocale: 'en',
                locales: [
                    { code: 'en', label: 'EN' },
                    { code: 'hi', label: 'हिन्दी' },
                ],
                strings: {},
            },
        },
        pages: [
            { id: 'home', route: 'home', title: 'Home', components: [heading('hero')] },
            { id: 'courses', route: 'courses', title: 'Courses', components: [columns, tabs] },
            { id: 'learning-paths', route: 'learning-paths', title: 'Learning Paths', components: [] },
        ],
    }) as unknown as CatalogueConfig;

/** jsdom has no layout: the canvas area reports this size. */
let areaSize = { width: 1152, height: 720 };
class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
        this.callback(
            [{ contentRect: { width: areaSize.width, height: areaSize.height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
        );
    }
    disconnect() {}
    unobserve() {}
}

const SITE = 'https://learn.acme.in/acme';
const renderFrame = (liveConfigJson?: string) =>
    render(
        <LiveSiteFrame
            siteUrl={SITE}
            liveConfigJson={liveConfigJson}
            nameInstitute={false}
            dropRef={() => {}}
            isDropOver={false}
        />
    );
const iframe = () => screen.getByTitle('frameTitle') as HTMLIFrameElement;
const fromFrame = (data: unknown, origin = 'https://learn.acme.in') =>
    act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, source: iframe().contentWindow as Window, origin }));
    });
/** The test DOM loads no site, so the frame's window is a stand-in. */
const standInWindow = () => {
    const sent = vi.fn();
    Object.defineProperty(iframe(), 'contentWindow', { configurable: true, value: { postMessage: sent } });
    return sent;
};
/** Mount, answer READY like the site does, and collect what the frame is sent. */
const readyFrame = (liveConfigJson?: string) => {
    renderFrame(liveConfigJson);
    const sent = standInWindow();
    fromFrame({ type: 'PREVIEW_READY' });
    return sent;
};
const sentOfType = (sent: ReturnType<typeof vi.fn>, type: string) =>
    sent.mock.calls.map((call) => call[0] as Record<string, unknown>).filter((m) => m.type === type);

/** Per-browser storage for the toolbar choices (fresh for every test). */
const memoryStorage = () => {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
        clear: () => items.clear(),
    };
};

beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    areaSize = { width: 1152, height: 720 };
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    useEditorStore.getState().setConfig(site());
    useEditorStore.getState().selectPage('courses');
    useEditorStore.getState().setViewport('desktop');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('frame size', () => {
    it('computes the scale from the container width (Fit), never above real size', () => {
        expect(frameScale(1152, 1440, true)).toBeCloseTo(0.8);
        expect(frameScale(1600, 1440, true)).toBe(1);
        expect(frameScale(1152, 1440, false)).toBe(1);
        expect(frameScale(0, 1440, true)).toBe(1);
    });

    it('lays the desktop site out at 1440 px and scales it into the canvas', () => {
        renderFrame();
        const frame = iframe();
        expect(frame.style.width).toBe('1440px');
        expect(frame.style.transform).toBe('scale(0.8)');
        expect(frame.style.transformOrigin).toBe('top left');
        expect(frame.style.height).toBe('900px'); // 720 / 0.8: fills the canvas height
        expect((frame.parentElement as HTMLElement).style.width).toBe('1152px');
    });

    it('offers 1280 for desktop and real size (100%)', () => {
        renderFrame();
        // Both width buttons share the key (t is mocked); the second is 1280.
        fireEvent.click(screen.getAllByText('toolbar.widthPx')[1]!);
        expect(iframe().style.width).toBe('1280px');
        expect(iframe().style.transform).toBe('scale(0.9)');
        fireEvent.click(screen.getByText('toolbar.actualSize'));
        expect(iframe().style.transform).toBe('');
        expect((iframe().parentElement as HTMLElement).style.width).toBe('1280px');
        expect(screen.getByTestId('live-site-area').className).toContain('overflow-auto');
    });

    it('shows tablet and phone at their real widths, unscaled when they fit', () => {
        useEditorStore.getState().setViewport('tablet');
        const { unmount } = renderFrame();
        expect(iframe().style.width).toBe('768px');
        expect(iframe().style.transform).toBe('');
        expect(screen.queryByText('toolbar.widthPx')).toBeNull();
        unmount();
        useEditorStore.getState().setViewport('mobile');
        renderFrame();
        expect(iframe().style.width).toBe('375px');
    });
});

describe('what the frame is sent', () => {
    it('the selected page as the root page, with its real route for the header', async () => {
        const sent = readyFrame();
        const [update] = sentOfType(sent, 'CATALOGUE_CONFIG_UPDATE');
        expect(update?.previewPath).toBe('courses');
        expect((update?.payload as CatalogueConfig).pages[0]?.title).toBe('Courses');
        expect(sent.mock.calls[0]?.[1]).toBe('https://learn.acme.in');
    });

    it('editing हिन्दी before languages are live: switches them on in the preview only', () => {
        useEditorStore.getState().setConfig(site(false));
        useEditorStore.getState().selectPage('home');
        useEditorStore.getState().setEditingLocale('hi');
        const sent = readyFrame();
        const [update] = sentOfType(sent, 'CATALOGUE_CONFIG_UPDATE');
        expect((update?.payload as CatalogueConfig).globalSettings.i18n?.enabled).toBe(true);
        expect(update?.previewPath).toBe('');
        // The draft itself is untouched.
        expect(useEditorStore.getState().config!.globalSettings.i18n?.enabled).toBe(false);
    });

    it('in the base language the payload keeps the site as it is', () => {
        const config = site(false);
        expect(framePayload(config, 'home', null).globalSettings.i18n?.enabled).toBe(false);
        expect(framePayload(config, 'home', 'hi').globalSettings.i18n?.enabled).toBe(true);
    });

    it('a reloaded frame (READY again) gets the draft, the mode and the highlight again', () => {
        useEditorStore.getState().selectComponent('cols');
        const sent = readyFrame();
        fireEvent.click(screen.getByText('toolbar.browse'));
        sent.mockClear();
        fromFrame({ type: 'PREVIEW_READY' });
        expect(sentOfType(sent, 'CATALOGUE_CONFIG_UPDATE').length).toBeGreaterThan(0);
        expect(sentOfType(sent, 'PREVIEW_INTERACT')).toEqual([{ type: 'PREVIEW_INTERACT', on: true }]);
        expect(sentOfType(sent, 'HIGHLIGHT_COMPONENT')).toEqual([{ type: 'HIGHLIGHT_COMPONENT', componentId: 'cols' }]);
    });

    it('keeps posting to the origin that first answered, whatever claims READY later', () => {
        const sent = readyFrame();
        fromFrame({ type: 'PREVIEW_READY' }, 'https://evil.example');
        useEditorStore.getState().selectPage('home');
        act(() => {
            useEditorStore.getState().selectComponent('hero');
        });
        expect(sent.mock.calls.every((call) => call[1] === 'https://learn.acme.in')).toBe(true);
    });

    it('Draft | Live shows the published site, and only when it is known', async () => {
        const live = { ...site(), pages: [{ id: 'courses', route: 'courses', title: 'Published courses', components: [] }] };
        const sent = readyFrame(JSON.stringify(live));
        fireEvent.click(screen.getByText('toolbar.live'));
        await act(() => new Promise((resolve) => setTimeout(resolve, 200))); // the push debounce
        const updates = sentOfType(sent, 'CATALOGUE_CONFIG_UPDATE');
        expect((updates.at(-1)?.payload as CatalogueConfig).pages[0]?.title).toBe('Published courses');
        // Blocks are picked in the draft, not on the published site.
        fromFrame({ type: 'COMPONENT_SELECTED', componentId: 'in-column', pageId: 'courses' });
        expect(useEditorStore.getState().selectedComponentId).toBeNull();
    });

    it('Live: a page not published yet says so, and a click says how to pick blocks', () => {
        const live = { ...site(), pages: [{ id: 'home', route: 'home', title: 'Home', components: [heading('hero')] }] };
        readyFrame(JSON.stringify(live));
        fireEvent.click(screen.getByText('toolbar.live'));
        expect(screen.getByText('livePageMissing')).toBeTruthy();
        fromFrame({ type: 'COMPONENT_SELECTED', componentId: 'hero', pageId: 'home' });
        expect(screen.getByText('liveClick')).toBeTruthy();
        expect(useEditorStore.getState().selectedComponentId).toBeNull();
        fireEvent.click(screen.getByText('toolbar.draft'));
        expect(screen.queryByText('livePageMissing')).toBeNull();
    });

    it('without the published site there is no Draft | Live switch', () => {
        renderFrame();
        expect(screen.queryByText('toolbar.live')).toBeNull();
    });

    it('Select | Browse posts PREVIEW_INTERACT, Select first', () => {
        const sent = readyFrame();
        expect(sentOfType(sent, 'PREVIEW_INTERACT')).toEqual([{ type: 'PREVIEW_INTERACT', on: false }]);
        fireEvent.click(screen.getByText('toolbar.browse'));
        expect(sentOfType(sent, 'PREVIEW_INTERACT').at(-1)).toEqual({ type: 'PREVIEW_INTERACT', on: true });
        fireEvent.click(screen.getByText('toolbar.select'));
        expect(sentOfType(sent, 'PREVIEW_INTERACT').at(-1)).toEqual({ type: 'PREVIEW_INTERACT', on: false });
    });
});

describe('clicks in the frame', () => {
    it('a block inside a column opens that block', () => {
        readyFrame();
        fromFrame({ type: 'COMPONENT_SELECTED', componentId: 'in-column', parentId: 'cols', pageId: 'home' });
        expect(useEditorStore.getState().selectedComponentId).toBe('in-column');
    });

    it('a block inside a tab opens its tabs block (tab slots are edited there)', () => {
        readyFrame();
        fromFrame({ type: 'COMPONENT_SELECTED', componentId: 'in-tab', parentId: 'tabs', pageId: 'home' });
        expect(useEditorStore.getState().selectedComponentId).toBe('tabs');
    });

    it('with Global Settings open, selects the shown page too', () => {
        useEditorStore.getState().selectGlobalSettings();
        readyFrame();
        fromFrame({ type: 'COMPONENT_SELECTED', componentId: 'hero', pageId: 'home' });
        expect(useEditorStore.getState().selectedPageId).toBe('home');
        expect(useEditorStore.getState().selectedComponentId).toBe('hero');
    });

    it('a link to another page (Browse) opens that page', () => {
        readyFrame();
        fromFrame({ type: 'PREVIEW_NAVIGATE', route: 'learning-paths' });
        expect(useEditorStore.getState().selectedPageId).toBe('learning-paths');
        fromFrame({ type: 'PREVIEW_NAVIGATE', route: '' });
        expect(useEditorStore.getState().selectedPageId).toBe('home');
    });

    it('a link that is not a page of the site says where it goes', () => {
        readyFrame();
        fromFrame({ type: 'PREVIEW_NAVIGATE', route: 'login', href: 'https://learn.acme.in/login' });
        expect(useEditorStore.getState().selectedPageId).toBe('courses');
        expect(screen.getByRole('status').textContent).toBe('notAPage');
    });

    it('after READY, only the origin that answered can select blocks or change pages', () => {
        readyFrame();
        fromFrame({ type: 'COMPONENT_SELECTED', componentId: 'in-column', pageId: 'courses' }, 'https://other.example');
        fromFrame({ type: 'PREVIEW_NAVIGATE', route: 'learning-paths' }, 'https://other.example');
        expect(useEditorStore.getState().selectedComponentId).toBeNull();
        expect(useEditorStore.getState().selectedPageId).toBe('courses');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('nothing but READY is accepted before the frame has answered', () => {
        renderFrame();
        standInWindow();
        fromFrame({ type: 'PREVIEW_NAVIGATE', route: 'learning-paths' });
        expect(useEditorStore.getState().selectedPageId).toBe('courses');
    });

    it('ignores messages from any other window', () => {
        readyFrame();
        act(() => {
            window.dispatchEvent(
                new MessageEvent('message', { data: { type: 'PREVIEW_NAVIGATE', route: 'home' }, source: window })
            );
        });
        expect(useEditorStore.getState().selectedPageId).toBe('courses');
    });
});

describe('when a link takes the frame off the preview', () => {
    it('asks the reloaded frame, and offers the way back when the preview does not answer', () => {
        vi.useFakeTimers();
        const sent = readyFrame();
        fireEvent.load(iframe()); // the first document's own load
        expect(sentOfType(sent, 'PREVIEW_HELLO')).toHaveLength(0);
        fireEvent.load(iframe()); // a link took the frame to a new document
        expect(sentOfType(sent, 'PREVIEW_HELLO')).toHaveLength(1);
        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        expect(screen.getByText('leftPreview.title')).toBeTruthy();
        const before = iframe();
        fireEvent.click(screen.getByText('leftPreview.back'));
        expect(iframe()).not.toBe(before); // a fresh frame on the same URL
        expect(screen.queryByText('leftPreview.title')).toBeNull();
    });

    it('a frame that answers is still the preview', () => {
        vi.useFakeTimers();
        readyFrame();
        fireEvent.load(iframe());
        fireEvent.load(iframe());
        fromFrame({ type: 'PREVIEW_READY' });
        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        expect(screen.queryByText('leftPreview.title')).toBeNull();
    });

    it('READY before the first document has finished loading: its load is not a departure', () => {
        // An older learner build never answers HELLO; it must not be covered.
        vi.useFakeTimers();
        const sent = readyFrame();
        fireEvent.load(iframe());
        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        expect(sentOfType(sent, 'PREVIEW_HELLO')).toHaveLength(0);
        expect(screen.queryByText('leftPreview.title')).toBeNull();
    });

    it('the first load is not a departure', () => {
        vi.useFakeTimers();
        renderFrame();
        fireEvent.load(iframe());
        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        expect(screen.queryByText('leftPreview.title')).toBeNull();
    });
});

describe('toolbar choices', () => {
    it('are remembered for the next visit', () => {
        const { unmount } = renderFrame();
        fireEvent.click(screen.getByText('toolbar.browse'));
        fireEvent.click(screen.getAllByText('toolbar.widthPx')[1]!);
        fireEvent.click(screen.getByText('toolbar.actualSize'));
        unmount();
        renderFrame();
        expect(screen.getByText('toolbar.browse').closest('button')?.getAttribute('aria-pressed')).toBe('true');
        expect(iframe().style.width).toBe('1280px');
        expect(iframe().style.transform).toBe('');
    });
});

describe('helpers', () => {
    const pages = site().pages as Page[];

    it('pageForRoute matches by route, home aliases and the first segment', () => {
        expect(pageForRoute(pages, '/courses/')?.id).toBe('courses');
        expect(pageForRoute(pages, 'courses/some-course')?.id).toBe('courses');
        expect(pageForRoute(pages, 'homepage')?.id).toBe('home');
        expect(pageForRoute(pages, 'nope')).toBeUndefined();
    });

    it('previewPathOf gives "" for any home route', () => {
        expect(previewPathOf({ id: 'x', route: 'homepage', components: [] })).toBe('');
        expect(previewPathOf({ id: 'x', route: '/about/', components: [] })).toBe('about');
    });

    it('selectableId opens the tabs block for a column inside a tab', () => {
        const nested: Component = {
            id: 'tabs2',
            type: 'tabsAccordion',
            enabled: true,
            props: { items: [{ title: 'One', slot: [{ ...columns, id: 'cols-in-tab' }] }] },
        };
        expect(selectableId([nested], 'in-column', 'cols-in-tab')).toBe('tabs2');
    });

    it('selectableId keeps an unknown block as it was', () => {
        expect(selectableId([columns], 'zzz', 'yyy')).toBe('zzz');
        expect(selectableId([columns], 'cols')).toBe('cols');
    });
});

describe('when the preview cannot load here', () => {
    it('tells the canvas, offers the block previews, and takes it back when READY comes late', () => {
        vi.useFakeTimers();
        const availability = vi.fn();
        const showPreviews = vi.fn();
        render(
            <LiveSiteFrame
                siteUrl={SITE}
                nameInstitute={false}
                dropRef={() => {}}
                isDropOver={false}
                onAvailabilityChange={availability}
                onShowPreviews={showPreviews}
            />
        );
        standInWindow();
        expect(availability).not.toHaveBeenCalledWith(false);
        act(() => {
            vi.advanceTimersByTime(15_000);
        });
        expect(availability).toHaveBeenLastCalledWith(false);
        fireEvent.click(screen.getByText('failed.showPreviews'));
        expect(showPreviews).toHaveBeenCalledTimes(1);
        fromFrame({ type: 'PREVIEW_READY' });
        expect(availability).toHaveBeenLastCalledWith(true);
    });

    it('an unusable site URL is unavailable at once', () => {
        const availability = vi.fn();
        render(
            <LiveSiteFrame
                siteUrl="not a url"
                nameInstitute={false}
                dropRef={() => {}}
                isDropOver={false}
                onAvailabilityChange={availability}
            />
        );
        expect(availability).toHaveBeenLastCalledWith(false);
        expect(screen.getByText('failed.title')).toBeTruthy();
    });
});
