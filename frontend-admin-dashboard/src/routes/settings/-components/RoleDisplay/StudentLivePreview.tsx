import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
    AppWindow,
    ArrowClockwise,
    ArrowsIn,
    ArrowsOut,
    ArrowSquareOut,
    BatteryFull,
    CellSignalFull,
    DeviceMobile,
    DeviceTablet,
    Globe,
    Minus,
    Square,
    WifiHigh,
    X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { StudentDisplaySettingsData } from '@/types/student-display-settings';
import type { ThemeEditorDraft } from '../Appearance/ThemeEditor';

/** Must match frontend-learner-dashboard-app/src/lib/student-preview.ts. */
const PREVIEW_MESSAGE_SOURCE = 'vx-student-preview';
const PREVIEW_QUERY_PARAM = 'vx_preview';
const PREVIEW_FRAME_NAME = 'vx-student-preview';

type PreviewDevice = 'mobile' | 'tablet' | 'windows' | 'website';
type FrameChrome = 'phone' | 'tablet' | 'window' | 'browser';
/**
 * w × h is the learner app's real viewport; the chrome (bezel, status bar,
 * window title bar, browser bar) is drawn around it. Windows app and website
 * are both the learner app's "desktop" layout — the Windows app is the same
 * app in a desktop window.
 */
const DEVICES: Record<PreviewDevice, { w: number; h: number; chrome: FrameChrome }> = {
    mobile: { w: 390, h: 800, chrome: 'phone' },
    tablet: { w: 820, h: 1140, chrome: 'tablet' },
    windows: { w: 1280, h: 768, chrome: 'window' },
    website: { w: 1440, h: 864, chrome: 'browser' },
};
const DEVICE_ICON = {
    mobile: DeviceMobile,
    tablet: DeviceTablet,
    windows: AppWindow,
    website: Globe,
};
/** Extra size the chrome adds around the viewport (px, before scaling). */
const CHROME_EXTRA: Record<FrameChrome, { w: number; h: number }> = {
    phone: { w: 24, h: 24 + 28 + 20 },
    tablet: { w: 32, h: 32 + 24 },
    window: { w: 2, h: 2 + 32 },
    browser: { w: 2, h: 2 + 40 },
};
const PAGES = [
    { key: 'dashboard', path: '/dashboard' },
    { key: 'courses', path: '/study-library/courses' },
    { key: 'liveClasses', path: '/study-library/live-class' },
    { key: 'assessments', path: '/assessment/examination' },
    { key: 'attendance', path: '/learning-centre/attendance' },
    { key: 'login', path: '/login' },
] as const;

function learnerBaseUrl(portalUrl: string | null | undefined): string {
    const raw = (portalUrl || BASE_URL_LEARNER_DASHBOARD).trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

interface StudentLivePreviewProps {
    /** Unsaved Student Display settings. */
    settings: StudentDisplaySettingsData;
    /** Unsaved theme from the Theme section; null until it has loaded. */
    themeDraft: ThemeEditorDraft | null;
    onClose: () => void;
}

/**
 * The real learner app in a device frame, driven by the admin's UNSAVED
 * settings. The frame loads the institute's own learner site with
 * `?vx_preview=1`; the learner app then accepts drafts over postMessage
 * (see the learner's lib/student-preview.ts) and re-renders with them. Nothing
 * is saved and real learners are unaffected until Save.
 */
export function StudentLivePreview({ settings, themeDraft, onClose }: StudentLivePreviewProps) {
    const { t } = useTranslation('settingsStudentDisplay');
    const { instituteDetails } = useInstituteDetailsStore();
    const base = useMemo(
        // learner_portal_base_url is what the institute API actually returns
        // (learnerPortalUrl is filled by a different call and often absent).
        () =>
            learnerBaseUrl(
                instituteDetails?.learner_portal_base_url || instituteDetails?.learnerPortalUrl
            ),
        [instituteDetails?.learner_portal_base_url, instituteDetails?.learnerPortalUrl]
    );
    const origin = useMemo(() => {
        try {
            return new URL(base).origin;
        } catch {
            return '';
        }
    }, [base]);

    const [device, setDevice] = useState<PreviewDevice>('mobile');
    const [page, setPage] = useState<string>(PAGES[0].path);
    const [currentPath, setCurrentPath] = useState<string>(PAGES[0].path);
    const [frameKey, setFrameKey] = useState(0);
    const [ready, setReady] = useState(false);
    // Big view: the same panel over the whole screen (portalled, so the iframe
    // reloads once on the switch),
    // so the tablet / Windows / website frames are readable.
    const [expanded, setExpanded] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    const src = `${base}${page}?${PREVIEW_QUERY_PARAM}=1`;
    const size = DEVICES[device];
    const extra = CHROME_EXTRA[size.chrome];
    const frameW = size.w + extra.w;
    const frameH = size.h + extra.h;
    const appName = instituteDetails?.institute_name || '';

    // Fit the device frame into the panel.
    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const fit = () => {
            const maxW = el.clientWidth;
            const maxH = Math.max(320, window.innerHeight - (expanded ? 200 : 240));
            setScale(Math.min(1, maxW / frameW, maxH / frameH));
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        window.addEventListener('resize', fit);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', fit);
        };
    }, [frameW, frameH, expanded]);

    const payload = useMemo(
        () => ({
            source: PREVIEW_MESSAGE_SOURCE,
            type: 'draft',
            display: settings,
            theme: themeDraft?.theme ?? null,
            brand: themeDraft?.brand ?? null,
        }),
        [settings, themeDraft]
    );
    const payloadRef = useRef(payload);
    payloadRef.current = payload;

    // Where the learner app actually ended up: its "ready" tells us, so a
    // learner host that redirects (domain routing) still gets the drafts.
    const frameOriginRef = useRef<string | null>(null);
    const send = (message: unknown) => {
        const target = frameOriginRef.current ?? origin;
        if (!target) return;
        iframeRef.current?.contentWindow?.postMessage(message, target);
    };

    // The learner app announces itself once booted (and after every reload a
    // draft triggers); answer with the current draft. Its own check skips the
    // reload when the draft is unchanged, so this cannot loop.
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            // Only our own preview frame, whatever origin it landed on.
            if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
            const data = event.data as { source?: string; type?: string; path?: string };
            if (!data || data.source !== PREVIEW_MESSAGE_SOURCE) return;
            frameOriginRef.current = event.origin;
            if (data.type === 'ready') {
                setReady(true);
                if (data.path) setCurrentPath(data.path);
                send(payloadRef.current);
            } else if (data.type === 'route' && data.path) {
                setCurrentPath(data.path);
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [origin]);

    // Stream edits, debounced so typing a label does not reload per keystroke.
    useEffect(() => {
        if (!ready) return;
        const id = window.setTimeout(() => send(payload), 600);
        return () => window.clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payload, ready]);

    const reload = () => {
        setReady(false);
        setFrameKey((k) => k + 1);
    };

    const content = (
        <>
            {expanded && (
                <div
                    className="fixed inset-0 z-40 bg-neutral-900/50"
                    onClick={() => setExpanded(false)}
                    aria-hidden
                />
            )}
            <div
                className={cn(
                    'flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3',
                    expanded ? 'fixed inset-4 z-50 overflow-y-auto shadow-2xl' : 'h-full'
                )}
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{t('livePreview.title')}</div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={onClose}
                        aria-label={t('livePreview.close')}
                    >
                        <X className="size-4" />
                    </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-md border border-neutral-200 p-0.5">
                        {(Object.keys(DEVICES) as PreviewDevice[]).map((d) => {
                            const Icon = DEVICE_ICON[d];
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => setDevice(d)}
                                    className={cn(
                                        'flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium',
                                        device === d
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'text-neutral-600 hover:bg-neutral-50'
                                    )}
                                >
                                    <Icon className="size-4" />
                                    {t(`livePreview.devices.${d}`)}
                                </button>
                            );
                        })}
                    </div>
                    <Select
                        value={page}
                        onValueChange={(v) => {
                            setPage(v);
                            reload();
                        }}
                    >
                        <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PAGES.map((p) => (
                                <SelectItem key={p.path} value={p.path}>
                                    {t(`livePreview.pages.${p.key}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={reload}
                        aria-label={t('livePreview.reload')}
                    >
                        <ArrowClockwise className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => setExpanded((v) => !v)}
                    >
                        {expanded ? (
                            <ArrowsIn className="size-4" />
                        ) : (
                            <ArrowsOut className="size-4" />
                        )}
                        {expanded ? t('livePreview.shrink') : t('livePreview.expand')}
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" asChild>
                        <a
                            href={`${base}${currentPath}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t('livePreview.openSite')}
                        >
                            <ArrowSquareOut className="size-4" />
                        </a>
                    </Button>
                </div>

                <div className="truncate text-xs text-neutral-500">
                    {base.replace(/^https?:\/\//, '')}
                    {currentPath}
                </div>

                <div ref={wrapRef} className="flex w-full justify-center">
                    <div
                        style={{ width: frameW * scale, height: frameH * scale }} // design-lint-ignore: device frame size is computed
                    >
                        {/* Fixed three-slot structure (top chrome, viewport, bottom
                        chrome) so switching device never remounts the iframe. */}
                        <div
                            className={cn(
                                'flex origin-top-left flex-col overflow-hidden',
                                size.chrome === 'phone' &&
                                    'rounded-3xl bg-neutral-900 p-3 shadow-xl',
                                size.chrome === 'tablet' &&
                                    'rounded-3xl bg-neutral-800 p-4 shadow-xl',
                                (size.chrome === 'window' || size.chrome === 'browser') &&
                                    'rounded-md border border-neutral-300 bg-white shadow-xl'
                            )}
                            style={{ width: frameW, height: frameH, transform: `scale(${scale})` }} // design-lint-ignore: real device size, scaled to fit
                        >
                            <div
                                className={cn(
                                    'flex shrink-0 items-center',
                                    size.chrome === 'phone' &&
                                        'h-7 justify-between rounded-t-2xl bg-white px-6 text-xs font-semibold text-neutral-900',
                                    size.chrome === 'tablet' &&
                                        'h-6 justify-between rounded-t-xl bg-white px-5 text-xs font-semibold text-neutral-900',
                                    size.chrome === 'window' &&
                                        'h-8 justify-between border-b border-neutral-200 bg-neutral-50 ps-3',
                                    size.chrome === 'browser' &&
                                        'h-10 gap-3 border-b border-neutral-200 bg-neutral-100 px-3'
                                )}
                            >
                                {(size.chrome === 'phone' || size.chrome === 'tablet') && (
                                    <>
                                        <span>9:41</span>
                                        <span className="flex items-center gap-1">
                                            <CellSignalFull className="size-3.5" weight="fill" />
                                            <WifiHigh className="size-3.5" weight="bold" />
                                            <BatteryFull className="size-4" weight="fill" />
                                        </span>
                                    </>
                                )}
                                {size.chrome === 'window' && (
                                    <>
                                        <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-700">
                                            <span className="size-3.5 shrink-0 rounded-sm bg-primary-500" />
                                            <span className="truncate">{appName}</span>
                                        </span>
                                        <span className="flex h-full text-neutral-600">
                                            <span className="flex w-11 items-center justify-center">
                                                <Minus className="size-3.5" />
                                            </span>
                                            <span className="flex w-11 items-center justify-center">
                                                <Square className="size-3" />
                                            </span>
                                            <span className="flex w-11 items-center justify-center">
                                                <X className="size-3.5" />
                                            </span>
                                        </span>
                                    </>
                                )}
                                {size.chrome === 'browser' && (
                                    <>
                                        <span className="flex gap-1.5">
                                            <span className="size-3 rounded-full bg-danger-400" />
                                            <span className="size-3 rounded-full bg-warning-400" />
                                            <span className="size-3 rounded-full bg-success-400" />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate rounded-full bg-white px-4 py-1 text-xs text-neutral-600">
                                            {base.replace(/^https?:\/\//, '')}
                                            {currentPath}
                                        </span>
                                    </>
                                )}
                            </div>
                            <div
                                className="shrink-0 overflow-hidden bg-white"
                                style={{ width: size.w, height: size.h }} // design-lint-ignore: the learner app's real viewport
                            >
                                <iframe
                                    // The learner app enters preview mode only in a
                                    // frame with this name (lib/student-preview.ts).
                                    name={PREVIEW_FRAME_NAME}
                                    key={frameKey}
                                    ref={iframeRef}
                                    title={t('livePreview.title')}
                                    src={src}
                                    className="block size-full border-0 bg-white"
                                    onLoad={() =>
                                        window.setTimeout(() => send(payloadRef.current), 300)
                                    }
                                />
                            </div>
                            <div
                                className={cn(
                                    'shrink-0 items-center justify-center',
                                    size.chrome === 'phone'
                                        ? 'flex h-5 rounded-b-2xl bg-white'
                                        : 'hidden'
                                )}
                            >
                                <span className="h-1 w-28 rounded-full bg-neutral-900" />
                            </div>
                        </div>
                    </div>
                </div>

                <p className="text-xs text-neutral-500">{t('livePreview.sessionNote')}</p>
            </div>
        </>
    );

    // Expanded, the panel has to sit above the whole admin (its docked parent
    // is its own low stacking context), so it is portalled to <body>. The
    // iframe reloads once on the switch; the learner keeps the same draft.
    return expanded ? createPortal(content, document.body) : content;
}
