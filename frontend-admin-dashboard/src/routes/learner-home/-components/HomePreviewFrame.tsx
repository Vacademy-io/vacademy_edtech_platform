import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, ArrowSquareOut, Desktop, DeviceMobile } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import {
    DeviceFrame,
    learnerBaseUrl,
    PREVIEW_FRAME_NAME,
    PREVIEW_MESSAGE_SOURCE,
    PREVIEW_QUERY_PARAM,
    useFitScale,
    type PreviewDevice,
} from '@/components/common/learner-preview/DeviceFrame';
import { cn } from '@/lib/utils';
import { BatchPicker } from '@/routes/announcement/create/-components/BatchPicker';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type {
    HomeBlock,
    LayoutSettings,
    PreviewDevice as ApiDevice,
    ResolvedHome,
} from '../-types/learner-home-types';
import { learnerHomeApi } from '../-services/learner-home-service';
import { blockPayload } from '../-utils/payload';
import { wallToInstant } from '../-utils/schedule';
import {
    useBatchOptions,
    useInstituteZone,
    useLearnerTagOptions,
} from '../-hooks/usePickerOptions';

/** The learner route that renders a home draft inside the admin's preview frame. */
export const HOME_PREVIEW_PATH = '/home-preview';
const PREVIEW_DEBOUNCE_MS = 800;

const DEVICE_OF: Record<ApiDevice, PreviewDevice> = { PHONE: 'mobile', DESKTOP: 'windows' };

/**
 * Live preview (spec 8.2, 8.3 HomePreviewFrame): the learner app's
 * /home-preview in a phone or desktop frame. Each change of the draft is
 * resolved by POST /preview (as the picked batches and tags would see it,
 * at the picked time) and the result is posted into the frame. The frame shows
 * whoever is signed in on the learner site in this browser; built-in widgets
 * are placeholders.
 */
export function HomePreviewFrame({
    instituteId,
    blocks,
    settings,
    active = true,
}: {
    /** False while the preview pane is hidden: no POST /preview is sent. */
    active?: boolean;
    instituteId: string;
    blocks: HomeBlock[];
    settings: LayoutSettings;
}) {
    const { t } = useTranslation('learnerHome');
    const { instituteDetails } = useInstituteDetailsStore();
    const zone = useInstituteZone();
    const batchOptions = useBatchOptions();
    const tags = useLearnerTagOptions();
    const [device, setDevice] = useState<ApiDevice>('PHONE');
    const [batchIds, setBatchIds] = useState<string[]>([]);
    const [tagIds, setTagIds] = useState<string[]>([]);
    const [atWall, setAtWall] = useState('');
    const [frameKey, setFrameKey] = useState(0);
    const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const frameOriginRef = useRef<string | null>(null);
    const resolvedRef = useRef<ResolvedHome | null>(null);

    const base = useMemo(
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
    const frameDevice = DEVICE_OF[device];
    const scale = useFitScale(wrapRef, frameDevice, 320);

    const send = () => {
        const target = frameOriginRef.current ?? origin;
        const home = resolvedRef.current;
        if (!target || !home) return;
        iframeRef.current?.contentWindow?.postMessage(
            { source: PREVIEW_MESSAGE_SOURCE, type: 'home', home },
            target
        );
    };

    // The learner app says "ready" once booted; answer with the latest draft.
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
            const data = event.data as { source?: string; type?: string };
            if (!data || data.source !== PREVIEW_MESSAGE_SOURCE) return;
            frameOriginRef.current = event.origin;
            if (data.type === 'ready') send();
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [origin]);

    const request = useMemo(
        () => ({
            source: 'INLINE' as const,
            blocks: blocks.map(blockPayload),
            settings,
            as: { package_session_ids: batchIds, user_tag_ids: tagIds },
            device,
            ...(atWall ? { at: wallToInstant(atWall, zone) ?? undefined } : {}),
        }),
        [blocks, settings, batchIds, tagIds, device, atWall, zone]
    );

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        const id = window.setTimeout(async () => {
            setState('loading');
            try {
                const home = await learnerHomeApi.preview(instituteId, request);
                if (cancelled) return;
                resolvedRef.current = home;
                setState('idle');
                send();
            } catch {
                if (!cancelled) setState('error');
            }
        }, PREVIEW_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteId, request, active]);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div
                    className="flex rounded-md border border-neutral-200 p-0.5"
                    role="group"
                    aria-label={t('preview.title')}
                >
                    {(['PHONE', 'DESKTOP'] as const).map((d) => {
                        const Icon = d === 'PHONE' ? DeviceMobile : Desktop;
                        return (
                            <button
                                key={d}
                                type="button"
                                aria-pressed={device === d}
                                onClick={() => setDevice(d)}
                                className={cn(
                                    'flex items-center gap-1 rounded-sm px-2 py-1 text-caption font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    device === d
                                        ? 'bg-primary-50 text-primary-500'
                                        : 'text-neutral-600 hover:bg-neutral-50'
                                )}
                            >
                                <Icon className="size-4" aria-hidden />
                                {d === 'PHONE' ? t('preview.phone') : t('preview.desktop')}
                            </button>
                        );
                    })}
                </div>
                <MyButton
                    type="button"
                    buttonType="text"
                    layoutVariant="icon"
                    scale="medium"
                    aria-label={t('preview.reload')}
                    onClick={() => setFrameKey((k) => k + 1)}
                >
                    <ArrowClockwise className="size-4" />
                </MyButton>
                <a
                    href={`${base}/dashboard`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm p-1 text-neutral-600 hover:text-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('preview.open')}
                >
                    <ArrowSquareOut className="size-4" />
                </a>
                <span className="text-caption text-neutral-500" aria-live="polite">
                    {state === 'loading'
                        ? t('preview.updating')
                        : state === 'error'
                          ? t('preview.failed')
                          : ''}
                </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <Label>{t('preview.previewAs')}</Label>
                    <BatchPicker
                        batches={batchOptions}
                        selected={batchIds}
                        onChange={setBatchIds}
                        noun={t('audience.batch')}
                        nounPlural={t('audience.batches')}
                    />
                    {batchIds.length === 0 && (
                        <p className="text-caption text-neutral-500">{t('preview.anyLearner')}</p>
                    )}
                </div>
                <div className="space-y-1">
                    <Label>{t('preview.tags')}</Label>
                    <MultiSelect
                        options={(tags.data ?? []).map((o) => ({ label: o.label, value: o.value }))}
                        selected={tagIds}
                        onChange={setTagIds}
                        placeholder={t('audience.pickTags')}
                        checkboxes
                    />
                </div>
                <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="lh-preview-at">{t('preview.at')}</Label>
                    <Input
                        id="lh-preview-at"
                        type="datetime-local"
                        value={atWall}
                        onChange={(e) => setAtWall(e.target.value)}
                        className="w-60"
                    />
                    {!atWall && <p className="text-caption text-neutral-500">{t('preview.now')}</p>}
                </div>
            </div>

            <div ref={wrapRef} className="flex w-full justify-center">
                <DeviceFrame
                    device={frameDevice}
                    scale={scale}
                    appName={instituteDetails?.institute_name || ''}
                    addressText={`${base.replace(/^https?:\/\//, '')}/dashboard`}
                >
                    <iframe
                        // The learner app enters preview mode only in a frame with this name.
                        name={PREVIEW_FRAME_NAME}
                        key={frameKey}
                        ref={iframeRef}
                        title={t('preview.title')}
                        src={`${base}${HOME_PREVIEW_PATH}?${PREVIEW_QUERY_PARAM}=1`}
                        className="block size-full border-0 bg-white"
                        onLoad={() => window.setTimeout(send, 300)}
                    />
                </DeviceFrame>
            </div>
            <p className="text-caption text-neutral-500">{t('preview.note')}</p>
        </div>
    );
}
