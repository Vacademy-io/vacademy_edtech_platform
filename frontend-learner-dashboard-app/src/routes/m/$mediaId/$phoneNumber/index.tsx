import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { WarningCircle, SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { getPublicMediaDetails } from "../../-services/media-service";
import { YouTubeEmbedPlayer } from "../../-components/YouTubeEmbedPlayer";
import { GenericMediaViewer } from "../../-components/GenericMediaViewer";
import { MediaSource } from "../../-types/types";

export const Route = createFileRoute("/m/$mediaId/$phoneNumber/")({
    component: PublicMediaPage,
});

function PublicMediaPage() {
    const { t } = useTranslation("miscRoutesA");
    const params = Route.useParams();
    
    // Sometimes during SPA navigation, params might be undefined momentarily
    // In that case, fall back to parsing the URL directly
    let mediaId = params.mediaId || '';
    
    if (!mediaId) {
        // Fallback: Parse params from URL directly
        // URL structure: /m/$mediaId/$phoneNumber
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2 && pathParts[0] === 'm') {
            mediaId = pathParts[1] || '';
        }
    }

    const {
        data: mediaDetails,
        isLoading,
        error,
    } = useQuery({
        queryKey: ["public-media", mediaId],
        queryFn: () => getPublicMediaDetails(mediaId),
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 2,
        enabled: !!mediaId, // Only run query when we have a mediaId
    });

    // Loading state - minimal centered loader (fixed fullscreen)
    if (isLoading) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center"
                >
                    <SpinnerGap className="w-8 h-8 text-white/60 animate-spin mx-auto" />
                </motion.div>
            </div>
        );
    }

    // Error state - minimal error display (fixed fullscreen)
    if (error || !mediaDetails) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center max-w-md"
                >
                    <WarningCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                    <h1 className="text-xl font-semibold text-white mb-2">
                        {t("media.notFound")}
                    </h1>
                    <p className="text-white/50 text-sm mb-4">
                        {error instanceof Error ? error.message : t("media.loadFailed")}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-white/10 text-white text-sm font-medium rounded-lg hover:bg-white/20 transition-colors"
                    >
                        {t("myMentors.common.tryAgain")}
                    </button>
                </motion.div>
            </div>
        );
    }

    const isYouTube = mediaDetails.source === MediaSource.YOUTUBE;

    return (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-auto">
            {/* Content-only view - media takes full viewport */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="w-full h-full flex items-center justify-center p-2 sm:p-4 md:p-6"
            >
                <div className="w-full max-w-vw-100 md:max-w-vw-95 lg:max-w-vw-90">
                    {isYouTube ? (
                        <YouTubeEmbedPlayer
                            url={mediaDetails.source_id}
                            title={mediaDetails.file_name || t("media.video")}
                            className="w-full"
                        />
                    ) : (
                        <GenericMediaViewer
                            mediaDetails={mediaDetails}
                            className="w-full"
                        />
                    )}
                </div>
            </motion.div>
        </div>
    );
}
