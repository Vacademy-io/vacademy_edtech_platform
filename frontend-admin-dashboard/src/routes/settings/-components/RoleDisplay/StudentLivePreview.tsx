import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, ArrowsIn, ArrowsOut, ArrowSquareOut, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
    DEVICE_ICON,
    DEVICES,
    DeviceFrame,
    learnerBaseUrl,
    PREVIEW_FRAME_NAME,
    PREVIEW_MESSAGE_SOURCE,
    PREVIEW_QUERY_PARAM,
    useFitScale,
    type PreviewDevice,
} from '@/components/common/learner-preview/DeviceFrame';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { StudentDisplaySettingsData } from '@/types/student-display-settings';
import type { ThemeEditorDraft } from '../Appearance/ThemeEditor';

const PAGES = [
    { key: 'dashboard', path: '/dashboard' },
    { key: 'courses', path: '/study-library/courses' },
    { key: 'liveClasses', path: '/study-library/live-class' },
    { key: 'assessments', path: '/assessment/examination' },
    { key: 'attendance', path: '/learning-centre/attendance' },
    { key: 'login', path: '/login' },
] as const;

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

    const src = `${base}${page}?${PREVIEW_QUERY_PARAM}=1`;
    const appName = instituteDetails?.institute_name || '';

    // Fit the device frame into the panel.
    const scale = useFitScale(wrapRef, device, expanded ? 200 : 240);

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
                    <DeviceFrame
                        device={device}
                        scale={scale}
                        appName={appName}
                        addressText={`${base.replace(/^https?:\/\//, '')}${currentPath}`}
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
                            onLoad={() => window.setTimeout(() => send(payloadRef.current), 300)}
                        />
                    </DeviceFrame>
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
