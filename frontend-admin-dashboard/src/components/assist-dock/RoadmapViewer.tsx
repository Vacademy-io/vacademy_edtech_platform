import { RocketLaunch, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * Full-screen "What's coming" viewer. The HTML is super-admin-authored (health-check → Roadmap),
 * rendered via srcDoc in a restrictive sandbox (no allow-same-origin) so it can't reach the parent
 * app's DOM/session even though it's trusted content — same posture as TutorialViewer/GuideViewer.
 */
export function RoadmapViewer({
    open,
    html,
    loading = false,
    onClose,
}: {
    open: boolean;
    html: string;
    /**
     * The body is fetched only once this panel opens, so there is a real gap
     * between opening and having HTML. Without this the empty branch below would
     * claim nothing is published while the request is still in flight.
     */
    loading?: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation('roadmapViewer');

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex justify-center bg-black/60 p-4 sm:p-10"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div
                className="flex size-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <RocketLaunch size={18} className="text-primary-500" />
                        <p className="text-subtitle font-semibold text-neutral-800">
                            {t('title')}
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label={t('closeAriaLabel')}
                        onClick={onClose}
                        className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="relative flex-1 bg-neutral-50">
                    {html ? (
                        <iframe
                            title={t('iframeTitle')}
                            srcDoc={html}
                            className="size-full border-0"
                            sandbox="allow-scripts allow-popups"
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center px-6 text-center">
                            <p className="text-caption text-neutral-500">
                                {loading ? t('loading') : t('empty')}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
