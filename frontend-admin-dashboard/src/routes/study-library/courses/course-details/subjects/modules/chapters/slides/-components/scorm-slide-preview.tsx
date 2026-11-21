'use client';

import { Slide } from '../-hooks/use-slides';
import { getPublicUrl } from '@/services/upload_file';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash, Package, ArrowSquareOut, Globe } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Route } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/index';

// SCORM Tracking endpoints
const SCORM_TRACKING_BASE = `${BASE_URL}/admin-core-service/scorm/tracking/v1`;

interface ScormSlidePreviewProps {
    activeItem: Slide;
    isLearnerView?: boolean;
}

interface ScormTrackingData {
    [key: string]: string;
}

const ScormSlidePreview = ({ activeItem, isLearnerView = false }: ScormSlidePreviewProps) => {
    const { t } = useTranslation('studyLibraryScormSlidePreview');
    const [launchUrl, setLaunchUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const cmiDataRef = useRef<ScormTrackingData>({});
    const lastErrorRef = useRef<string>('0');

    const scormSlide = activeItem.scorm_slide;
    const { getPackageSessionId } = useInstituteDetailsStore();

    let packageSessionId = '';
    try {
        const routeSearch = Route.useSearch();
        packageSessionId =
            getPackageSessionId({
                courseId: routeSearch.courseId || '',
                levelId: routeSearch.levelId || '',
                sessionId: routeSearch.sessionId || '',
            }) || '';
    } catch {
        // Route may not be available in all contexts
    }

    // Reset state when switching slides
    useEffect(() => {
        setLaunchUrl('');
        setIsLoading(true);
        setError(null);
    }, [activeItem.id]);

    // Fetch initial tracking data and set up SCORM API
    const initializeScormTracking = useCallback(async () => {
        if (!isLearnerView || !activeItem.id) return;

        try {
            const response = await authenticatedAxiosInstance.get(
                `${SCORM_TRACKING_BASE}/${activeItem.id}/initialize?packageSessionId=${packageSessionId}`
            );
            cmiDataRef.current = response.data || {};
        } catch (err) {
            console.warn('SCORM tracking initialization failed (may be first launch):', err);
            cmiDataRef.current = {};
        }
    }, [isLearnerView, activeItem.id, packageSessionId]);

    // Commit tracking data to backend
    const commitScormData = useCallback(async () => {
        if (!isLearnerView || !scormSlide?.id) return;

        try {
            await authenticatedAxiosInstance.post(
                `${SCORM_TRACKING_BASE}/${scormSlide.id}/commit`,
                {
                    scorm_slide_id: scormSlide.id,
                    package_session_id: packageSessionId,
                    ...cmiDataRef.current,
                }
            );
        } catch (err) {
            console.error('SCORM commit failed:', err);
        }
    }, [isLearnerView, scormSlide?.id, packageSessionId]);

    // Set up postMessage bridge for SCORM tracking via the S3 wrapper
    useEffect(() => {
        if (!isLearnerView) return;

        const handleScormMessage = (event: MessageEvent) => {
            if (!event.data || event.data.type !== 'vacademy_scorm') return;

            const { action, key, value } = event.data;

            switch (action) {
                case 'LMSInitialize':
                case 'Initialize':
                    break;
                case 'LMSSetValue':
                case 'SetValue':
                    cmiDataRef.current[key] = value;
                    break;
                case 'LMSGetValue':
                case 'GetValue':
                    break;
                case 'LMSCommit':
                case 'Commit':
                    commitScormData();
                    break;
                case 'LMSFinish':
                case 'Terminate':
                    commitScormData();
                    break;
            }
        };

        window.addEventListener('message', handleScormMessage);

        return () => {
            window.removeEventListener('message', handleScormMessage);
        };
    }, [isLearnerView, commitScormData]);

    // Resolve the launch URL
    useEffect(() => {
        const fetchLaunchUrl = async () => {
            if (!scormSlide) {
                setError(t('errors.dataNotFound'));
                setIsLoading(false);
                return;
            }

            try {
                // Initialize tracking data first (for learner view)
                await initializeScormTracking();

                if (scormSlide.launch_url) {
                    // Preferred: launch_url is the full public S3 URL
                    // getPublicUrl() will return it as-is since it starts with https://
                    const url = await getPublicUrl(scormSlide.launch_url);
                    setLaunchUrl(url);
                } else if (scormSlide.launch_path?.startsWith('http')) {
                    // launch_path is already a full URL
                    setLaunchUrl(scormSlide.launch_path);
                } else if (scormSlide.original_file_id && scormSlide.launch_path) {
                    // Fallback for older SCORM slides without launch_url:
                    // construct the full S3 key and try getPublicUrl
                    const fullFileId = `${scormSlide.original_file_id}/${scormSlide.launch_path}`;
                    const url = await getPublicUrl(fullFileId);
                    setLaunchUrl(url);
                } else {
                    setError(t('errors.launchPathNotConfigured'));
                }
            } catch (err) {
                console.error('Error resolving SCORM launch URL:', err);
                setError(t('errors.loadFailed'));
            } finally {
                setIsLoading(false);
            }
        };

        fetchLaunchUrl();
    }, [scormSlide, initializeScormTracking, t]);

    // Check if the slide is deleted
    if (activeItem?.status === 'DELETED') {
        return (
            <div className="flex size-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b bg-red-50 px-6 py-4">
                    <h2 className="text-lg font-semibold text-red-700">{t('header.title')}</h2>
                    <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-600">
                        {t('deleted.badge')}
                    </span>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-12">
                    <div className="text-center">
                        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-red-100">
                            <Trash size={24} className="text-red-500" />
                        </div>
                        <h3 className="mb-2 text-lg font-medium text-slate-600">
                            {t('deleted.heading')}
                        </h3>
                        <p className="text-sm text-slate-400">{t('deleted.description')}</p>
                    </div>
                </div>
            </div>
        );
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100">
                <div className="flex flex-col items-center gap-3">
                    <div className="size-12 animate-spin rounded-full border-y-2 border-primary-500"></div>
                    <p className="text-sm text-gray-600">{t('loading')}</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex h-64 flex-col items-center justify-center rounded-lg bg-red-50 p-4">
                <p className="mb-2 font-medium text-red-500">{error}</p>
            </div>
        );
    }

    return (
        <div
            key={`scorm-${activeItem.id}`}
            className="flex size-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
        >
            {/* SCORM Info Header */}
            <div className="flex items-center justify-between border-b border-neutral-100 bg-gradient-to-r from-teal-50 to-cyan-50 px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-teal-100">
                        <Package size={24} className="text-teal-600" weight="duotone" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-neutral-800">
                            {activeItem.title || t('header.untitled')}
                        </h3>
                        {scormSlide?.scorm_version && (
                            <p className="text-xs text-neutral-500">
                                {t('header.scormVersion', { version: scormSlide.scorm_version })}
                            </p>
                        )}
                    </div>
                </div>
                {!isLearnerView && (
                    <div className="flex items-center gap-2">
                        <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-700">
                            {t('header.interactiveBadge')}
                        </span>
                    </div>
                )}
            </div>

            {/* Description */}
            {activeItem.description && (
                <div className="border-b border-neutral-100 px-6 py-3">
                    <p className="text-sm text-neutral-600">{activeItem.description}</p>
                </div>
            )}
            {/* SCORM Content Area */}
            {launchUrl ? (
                <>
                    {/* Admin info bar - only shown in admin view */}
                    {!isLearnerView && (
                        <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2">
                            <div className="flex items-center gap-4 text-xs text-neutral-500">
                                {scormSlide?.scorm_version && (
                                    <span>
                                        {t('infoBar.versionLabel')}{' '}
                                        <strong className="text-neutral-700">
                                            {t('header.scormVersion', {
                                                version: scormSlide.scorm_version,
                                            })}
                                        </strong>
                                    </span>
                                )}
                                {scormSlide?.launch_path && (
                                    <span>
                                        {t('infoBar.entryLabel')}{' '}
                                        <strong className="text-neutral-700">
                                            {scormSlide.launch_path.split('/').pop()}
                                        </strong>
                                    </span>
                                )}
                                <span>
                                    {t('infoBar.statusLabel')}{' '}
                                    <strong className="capitalize text-neutral-700">
                                        {activeItem.status?.toLowerCase()}
                                    </strong>
                                </span>
                            </div>
                            <a
                                href={launchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-teal-600 active:scale-95"
                            >
                                <ArrowSquareOut size={14} />
                                {t('infoBar.openInNewTab')}
                            </a>
                        </div>
                    )}

                    {/* Embedded SCORM iframe - shown for both admin and learner.
                        min-h-0 lets this flex child shrink below the iframe's
                        intrinsic height so it tracks the card instead of
                        overflowing the parent's overflow-hidden on short viewports. */}
                    <div className="relative min-h-0 flex-1">
                        <iframe
                            ref={iframeRef}
                            src={launchUrl}
                            // Absolute rather than size-full: iOS WKWebView
                            // collapses height:100% iframes to their intrinsic
                            // content height (same fix as the learner app's
                            // scorm-slide).
                            className="absolute inset-0 block size-full border-0"
                            title={activeItem.title || t('iframeTitle')}
                            allow="fullscreen"
                            onLoad={() => {
                                // Send saved tracking data to the wrapper for resume (learner view).
                                // Admin view still answers, with null data: the wrapper holds the
                                // package back until it hears from us, and null leaves the older
                                // wrapper's in-memory data untouched.
                                if (iframeRef.current?.contentWindow) {
                                    iframeRef.current.contentWindow.postMessage(
                                        {
                                            type: 'vacademy_scorm_init',
                                            cmiData: isLearnerView ? cmiDataRef.current : null,
                                        },
                                        '*'
                                    );
                                }
                            }}
                        />
                    </div>
                </>
            ) : (
                // No launch URL available
                <div className="flex flex-1 flex-col items-center justify-center p-12">
                    <div className="text-center">
                        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-cyan-100 shadow-inner">
                            <Globe size={40} className="text-teal-600" weight="duotone" />
                        </div>
                        <h3 className="mb-2 text-xl font-semibold text-neutral-800">
                            {t('notReady.heading')}
                        </h3>
                        <p className="max-w-md text-sm text-neutral-500">
                            {t('notReady.description')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScormSlidePreview;
