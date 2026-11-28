import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SpinnerGap, X } from '@phosphor-icons/react';
import { useAssistDock } from './store';
import { useInstituteBrand } from './useInstituteBrand';
import { fetchBrandedTutorial, tutorialUrl } from './loadTutorial';

/**
 * Big modal that plays a walkthrough. Tries the branded path (fetch + inject the
 * institute's name/logo/theme via srcDoc); if that fails (e.g. S3 CORS not set),
 * falls back to a plain cross-origin <iframe src> with the default chrome.
 */
export function TutorialViewer() {
    const { t } = useTranslation('tutorialViewer');
    const activeTutorial = useAssistDock((s) => s.activeTutorial);
    const closeTutorial = useAssistDock((s) => s.closeTutorial);
    const brand = useInstituteBrand();

    const [srcDoc, setSrcDoc] = useState<string | null>(null);
    const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const file = activeTutorial?.file ?? null;
    const title = activeTutorial?.title ?? '';

    useEffect(() => {
        if (!file) {
            setSrcDoc(null);
            setFallbackSrc(null);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setSrcDoc(null);
        setFallbackSrc(null);
        fetchBrandedTutorial(file, brand, controller.signal)
            .then((html) => setSrcDoc(html))
            .catch((e) => {
                if ((e as Error)?.name === 'AbortError') return;
                // Branding unavailable (CORS/network) — play the file directly.
                setFallbackSrc(tutorialUrl(file));
            })
            .finally(() => setLoading(false));
        return () => controller.abort();
        // Re-run when the institute brand resolves so the player gets re-branded
        // (brand is memoized, so its identity is stable until a field changes).
    }, [file, brand]);

    if (!file) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex justify-center bg-black/60 p-4 sm:p-10"
            role="dialog"
            aria-modal="true"
            onClick={closeTutorial}
        >
            <div
                className="flex size-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
                    <p className="truncate text-subtitle font-semibold text-neutral-800">{title}</p>
                    <button
                        type="button"
                        aria-label={t('closeTutorial')}
                        onClick={closeTutorial}
                        className="flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="relative flex-1 bg-neutral-50">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center gap-2 text-neutral-500">
                            <SpinnerGap size={22} className="animate-spin text-primary-500" />
                            <span className="text-caption">{t('loadingTutorial')}</span>
                        </div>
                    )}
                    {srcDoc && (
                        <iframe
                            title={title}
                            srcDoc={srcDoc}
                            className="size-full border-0"
                            sandbox="allow-scripts allow-popups"
                        />
                    )}
                    {fallbackSrc && (
                        <iframe
                            title={title}
                            src={fallbackSrc}
                            className="size-full border-0"
                            sandbox="allow-scripts allow-same-origin allow-popups"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
