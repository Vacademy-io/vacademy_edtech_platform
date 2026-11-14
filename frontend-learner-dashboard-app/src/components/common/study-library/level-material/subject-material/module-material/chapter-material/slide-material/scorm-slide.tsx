import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useFileUpload } from '@/hooks/use-file-upload';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { Slide, ScormSlide } from '@/hooks/study-library/use-slides';
import { useResolvedPackageSessionId } from '@/hooks/study-library/useResolvedPackageSessionId';
import { refreshProgressAfterSubmit } from '@/utils/study-library/tracking/refreshProgressAfterSubmit';

// SCORM Tracking endpoints
const SCORM_TRACKING_BASE = `${BASE_URL}/admin-core-service/scorm/tracking/v1`;

interface ScormTrackingData {
    [key: string]: string;
}

/** Matches the backend ScormTrackingDTO exactly */
interface ScormTrackingCommitPayload {
    scorm_slide_id: string;
    package_session_id: string;
    chapter_id?: string;
    module_id?: string;
    subject_id?: string;
    cmi_suspend_data?: string | null;
    cmi_location?: string | null;
    cmi_exit?: string | null;
    completion_status?: string | null;
    success_status?: string | null;
    score_raw?: number | null;
    score_min?: number | null;
    score_max?: number | null;
    score_scaled?: number | null;
    progress_measure?: number | null;
    total_time?: string | null;
    cmi_json?: Record<string, string> | null;
}

// SCORM-spec CMI keys all begin with "cmi." (e.g. cmi.score.raw, cmi.completion_status).
// The earlier permissive "cmi_" prefix also matched the DTO's own `cmi_json` field
// (when it accidentally leaked into the ref) — leading to a self-referential
// "cmi_json": "[object Object]" entry in subsequent commits. Anchor strictly to
// "cmi." to stop that class of bleed-through.
const isCmiKey = (key: string) => key.startsWith('cmi.');

const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

interface ScormSlideComponentProps {
    slide: Slide;
    packageSessionId?: string;
}

const ScormSlideComponent = ({
    slide,
    packageSessionId: propPackageSessionId = '',
}: ScormSlideComponentProps) => {
    const { t } = useTranslation('libraryCommonB');
    const [launchUrl, setLaunchUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [resolvedPackageSessionId, setResolvedPackageSessionId] = useState<string>(
        propPackageSessionId
    );
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const cmiDataRef = useRef<ScormTrackingData>({});
    const { getPublicUrl } = useFileUpload();
    const router = useRouter();
    const queryClient = useQueryClient();

    const scormSlide = slide.scorm_slide as ScormSlide | undefined;

    // Resolve the batch if the parent didn't pass one (slide-material doesn't).
    // Must come from the course being studied, not the single id cached at
    // login — a multi-batch learner would otherwise report SCORM completion
    // against the wrong package_session and their course progress would sit
    // still. See useResolvedPackageSessionId.
    const resolvePackageSessionId = useResolvedPackageSessionId();
    useEffect(() => {
        if (!propPackageSessionId) {
            resolvePackageSessionId().then((id) => {
                if (id) setResolvedPackageSessionId(id);
            });
        }
    }, [propPackageSessionId, resolvePackageSessionId]);

    // Reset state when switching slides
    useEffect(() => {
        setLaunchUrl('');
        setIsLoading(true);
        setError(null);
    }, [slide.id]);

    // Initialize tracking data from backend.
    //
    // The backend returns the full ScormTrackingDTO (typed fields + the raw
    // cmi_json map). We only restore the raw cmi.* keys into cmiDataRef —
    // anything else (typed score fields, status fields, parent's cmi_json
    // string, etc.) is derived state and must NOT be round-tripped on the
    // next commit, otherwise cmi_json would nest one layer deeper on every
    // commit (request payload grows quadratically; that was the bug).
    const initializeScormTracking = useCallback(async () => {
        if (!slide.id) return;

        try {
            const response = await authenticatedAxiosInstance.get(
                `${SCORM_TRACKING_BASE}/${slide.id}/initialize?packageSessionId=${resolvedPackageSessionId}`
            );
            const cmiJson = (response.data?.cmi_json ?? {}) as Record<string, unknown>;
            const restored: ScormTrackingData = {};
            for (const [key, value] of Object.entries(cmiJson)) {
                if (isCmiKey(key) && value != null) {
                    restored[key] = String(value);
                }
            }
            cmiDataRef.current = restored;
        } catch (err) {
            console.warn(
                'SCORM tracking initialization failed (may be first launch):',
                err
            );
            cmiDataRef.current = {};
        }
    }, [slide.id, resolvedPackageSessionId]);

    // Commit tracking data to backend.
    // NOTE: Both initialize and commit MUST use slide.id (the parent Slide entity's ID)
    // because scorm_learner_progress is indexed by slide_id (not scorm_slide.id).
    const commitScormData = useCallback(async () => {
        if (!slide.id) return;

        const cmi = cmiDataRef.current;

        // SCORM 2004 keys (cmi.*) take precedence over SCORM 1.2 keys
        // (cmi.core.*) for any field where both spellings exist. A 2004
        // package writes the new-style keys; a 1.2 package writes the old
        // ones; neither writes both. SCORM 1.2 has no separate success
        // field — lesson_status carries both completion and pass/fail in
        // one enum, so it maps only to completion_status here.
        const completionStatus = cmi['cmi.completion_status']
            ?? cmi['cmi.core.lesson_status']
            ?? null;
        const successStatus = cmi['cmi.success_status'] ?? null;
        const scoreRaw = toNum(cmi['cmi.score.raw'] ?? cmi['cmi.core.score.raw']);
        const scoreMin = toNum(cmi['cmi.score.min'] ?? cmi['cmi.core.score.min']);
        const scoreMax = toNum(cmi['cmi.score.max'] ?? cmi['cmi.core.score.max']);
        const scoreScaled = toNum(cmi['cmi.score.scaled']);
        const progressMeasure = toNum(cmi['cmi.progress_measure']);

        // Only ship raw cmi.* keys in cmi_json — see initializeScormTracking
        // for the rationale. Filtering here is the belt to initialize's
        // braces: if anything ever sneaks into cmiDataRef that isn't a cmi
        // key, we strip it before sending.
        const rawCmi: Record<string, string> = {};
        for (const [key, value] of Object.entries(cmi)) {
            if (isCmiKey(key) && value != null) {
                rawCmi[key] = String(value);
            }
        }

        // Cascade-context IDs live in the slide route's URL search params.
        // The route names `sessionId` for what the backend calls
        // `packageSessionId` (see validateSearch in the slide route).
        const search = router.state.location.search as Record<string, unknown>;
        const chapterIdForCascade = (search.chapterId as string | undefined) ?? '';
        const moduleIdForCascade = (search.moduleId as string | undefined) ?? '';
        const subjectIdForCascade = (search.subjectId as string | undefined) ?? '';
        const packageSessionIdForCascade =
            (search.sessionId as string | undefined)
            ?? (search.packageSessionId as string | undefined)
            ?? resolvedPackageSessionId
            ?? '';

        const payload: ScormTrackingCommitPayload = {
            scorm_slide_id: scormSlide?.id || '',
            package_session_id: packageSessionIdForCascade,
            chapter_id: chapterIdForCascade || undefined,
            module_id: moduleIdForCascade || undefined,
            subject_id: subjectIdForCascade || undefined,
            cmi_location: cmi['cmi.location'] ?? cmi['cmi.core.lesson_location'] ?? null,
            cmi_exit: cmi['cmi.exit'] ?? cmi['cmi.core.exit'] ?? null,
            cmi_suspend_data: cmi['cmi.suspend_data'] ?? null,
            completion_status: completionStatus,
            success_status: successStatus,
            score_raw: scoreRaw,
            score_min: scoreMin,
            score_max: scoreMax,
            score_scaled: scoreScaled,
            progress_measure: progressMeasure,
            total_time: cmi['cmi.session_time'] ?? cmi['cmi.core.session_time'] ?? null,
            cmi_json: Object.keys(rawCmi).length > 0 ? rawCmi : null,
        };

        try {
            await authenticatedAxiosInstance.post(
                `${SCORM_TRACKING_BASE}/${slide.id}/commit`,
                payload
            );
            if (chapterIdForCascade) {
                void refreshProgressAfterSubmit(queryClient, chapterIdForCascade);
            }
        } catch (err) {
            console.error('SCORM commit failed:', err);
        }
    }, [scormSlide?.id, slide.id, resolvedPackageSessionId, router, queryClient]);

    // Listen for postMessage events from the SCORM wrapper on S3
    useEffect(() => {
        const handleScormMessage = (event: MessageEvent) => {
            if (!event.data || event.data.type !== 'vacademy_scorm') return;

            const { action, key, value } = event.data;

            switch (action) {
                case 'LMSInitialize':
                case 'Initialize':
                    console.log(`[SCORM Bridge] ${action}`);
                    break;
                case 'LMSSetValue':
                case 'SetValue':
                    console.log(
                        `[SCORM Bridge] ${action}("${key}", "${value}")`
                    );
                    cmiDataRef.current[key] = value;
                    break;
                case 'LMSGetValue':
                case 'GetValue':
                    console.log(
                        `[SCORM Bridge] ${action}("${key}") = "${value}"`
                    );
                    break;
                case 'LMSCommit':
                case 'Commit':
                    console.log('[SCORM Bridge] Commit');
                    commitScormData();
                    break;
                case 'LMSFinish':
                case 'Terminate':
                    console.log(`[SCORM Bridge] ${action}`);
                    commitScormData();
                    break;
            }
        };

        window.addEventListener('message', handleScormMessage);
        return () => window.removeEventListener('message', handleScormMessage);
    }, [commitScormData]);

    // Resolve the launch URL
    useEffect(() => {
        const fetchLaunchUrl = async () => {
            if (!scormSlide) {
                setError(t('scormSlide.errors.dataNotFound'));
                setIsLoading(false);
                return;
            }

            try {
                // Initialize tracking data
                await initializeScormTracking();

                if (scormSlide.launch_url) {
                    const url = await getPublicUrl(scormSlide.launch_url);
                    setLaunchUrl(url);
                } else if (scormSlide.launch_path?.startsWith('http')) {
                    setLaunchUrl(scormSlide.launch_path);
                } else if (
                    scormSlide.original_file_id &&
                    scormSlide.launch_path
                ) {
                    const fullFileId = `${scormSlide.original_file_id}/${scormSlide.launch_path}`;
                    const url = await getPublicUrl(fullFileId);
                    setLaunchUrl(url);
                } else {
                    setError(t('scormSlide.errors.launchPathNotConfigured'));
                }
            } catch (err) {
                console.error('Error resolving SCORM launch URL:', err);
                setError(t('scormSlide.errors.loadFailed'));
            } finally {
                setIsLoading(false);
            }
        };

        fetchLaunchUrl();
    }, [scormSlide, initializeScormTracking, getPublicUrl]);

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="flex flex-col items-center gap-stack">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-500"></div>
                    <p className="text-sm text-neutral-500">
                        {t('scormSlide.loading')}
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                        <svg
                            className="h-7 w-7 text-red-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                    </div>
                    <p className="text-sm font-medium text-red-600">{error}</p>
                </div>
            </div>
        );
    }

    if (!launchUrl) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <p className="text-sm text-neutral-500">
                    {t('scormSlide.urlNotAvailable')}
                </p>
            </div>
        );
    }

    return (
        // iOS WKWebView collapses iframes with height:100% to their intrinsic
        // content height. Position the iframe absolutely so it fills the parent
        // box on iOS the same way it does on Chrome/Android.
        <div
            className="relative h-full w-full"
            style={{
                minHeight: 'calc(100vh - 120px)',
                WebkitOverflowScrolling: 'touch',
            }}
        >
            <iframe
                ref={iframeRef}
                src={launchUrl}
                className="absolute inset-0 block h-full w-full border-0"
                title={slide.title || t('scormSlide.defaultTitle')}
                allow="fullscreen; autoplay; encrypted-media; clipboard-read; clipboard-write"
                onLoad={() => {
                    console.log('[SCORM] iframe loaded, sending init data');
                    // Send saved tracking data to the wrapper for resume
                    if (iframeRef.current?.contentWindow) {
                        iframeRef.current.contentWindow.postMessage(
                            {
                                type: 'vacademy_scorm_init',
                                cmiData: cmiDataRef.current,
                            },
                            '*'
                        );
                    }
                }}
            />
        </div>
    );
};

export default ScormSlideComponent;
