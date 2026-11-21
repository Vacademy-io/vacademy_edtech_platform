import React from "react";
import { FileText, Image, FilmStrip, FileDashed } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { PublicMediaDetails } from "../-types/types";
import { MediaSource } from "../-types/types";

interface GenericMediaViewerProps {
    mediaDetails: PublicMediaDetails;
    className?: string;
}

export const GenericMediaViewer: React.FC<GenericMediaViewerProps> = ({
    mediaDetails,
    className = "",
}) => {
    const { t } = useTranslation("miscRoutesA");
    const { source, url, file_name, file_type } = mediaDetails;

    // PDF Viewer - responsive height for different devices
    if (source === MediaSource.PDF || file_type?.toLowerCase().includes("pdf")) {
        return (
            <div className={`relative overflow-hidden rounded-lg sm:rounded-xl bg-white ${className}`}>
                <div className="relative w-full h-screen-60 sm:h-screen-70 md:h-screen-80 lg:h-screen-85">
                    <iframe
                        src={`${url}#toolbar=0&navpanes=0&scrollbar=1`}
                        title={file_name || t("media.pdfDocument")}
                        className="w-full h-full border-0"
                    />
                </div>
            </div>
        );
    }

    // Image Viewer - responsive sizing
    if (source === MediaSource.IMAGE || file_type?.toLowerCase().startsWith("image/")) {
        return (
            <div className={`relative overflow-hidden rounded-lg sm:rounded-xl bg-transparent ${className}`}>
                <div className="relative flex items-center justify-center min-h-screen-40 sm:min-h-screen-50">
                    <img
                        src={url}
                        alt={file_name || t("media.image")}
                        className="max-w-full max-h-screen-70 sm:max-h-screen-80 md:max-h-screen-85 object-contain"
                    />
                </div>
            </div>
        );
    }

    // Video Viewer (non-YouTube) - responsive aspect ratio
    if (source === MediaSource.VIDEO || file_type?.toLowerCase().startsWith("video/")) {
        return (
            <div className={`relative overflow-hidden rounded-lg sm:rounded-xl bg-black ${className}`}>
                <div className="relative aspect-video">
                    <video
                        src={url}
                        controls
                        controlsList="nodownload noremoteplayback"
                        disablePictureInPicture
                        playsInline
                        className="w-full h-full object-contain"
                    >
                        {t("media.videoNotSupported")}
                    </video>
                </div>
            </div>
        );
    }

    // Unsupported/Unknown type - responsive padding and sizing
    return (
        <div className={`relative overflow-hidden rounded-lg sm:rounded-xl ${className}`}>
            <div className="bg-white/5 backdrop-blur-sm p-6 sm:p-8 md:p-12 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full bg-white/10 mb-4 sm:mb-6">
                    {getMediaIcon(source, file_type)}
                </div>
                <h3 className="text-base sm:text-lg md:text-xl font-semibold text-white mb-2 line-clamp-2 px-2">
                    {file_name || t("media.unknownFile")}
                </h3>
                <p className="text-white/50 text-sm mb-4 sm:mb-6">{t("media.previewUnsupported")}</p>
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-white/10 text-white text-sm sm:text-base font-medium rounded-lg hover:bg-white/20 transition-colors"
                >
                    <span>{t("media.openFile")}</span>
                </a>
            </div>
        </div>
    );
};

function getMediaIcon(source: string, fileType: string) {
    const iconClass = "w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 text-white/80";

    if (source === MediaSource.PDF || fileType?.toLowerCase().includes("pdf")) {
        return <FileText className={iconClass} />;
    }
    if (source === MediaSource.IMAGE || fileType?.toLowerCase().startsWith("image/")) {
        return <Image className={iconClass} />;
    }
    if (source === MediaSource.VIDEO || fileType?.toLowerCase().startsWith("video/")) {
        return <FilmStrip className={iconClass} />;
    }
    return <FileDashed className={iconClass} />;
}
