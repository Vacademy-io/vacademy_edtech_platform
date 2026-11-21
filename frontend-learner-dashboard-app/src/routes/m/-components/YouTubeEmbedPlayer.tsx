import React from "react";
import { useTranslation } from "react-i18next";
import {
    getYouTubeEmbedOrigin,
    routeYouTubeEmbedThroughBridge,
} from "@/utils/youtube-embed";

interface YouTubeEmbedPlayerProps {
    url: string;
    title?: string;
    className?: string;
}

// Utility: extract the 11-character YouTube ID from any common URL form
function extractYouTubeVideoId(url: string): string | null {
    if (!url) return null;
    const regExp =
        /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|live\/))([a-zA-Z0-9_-]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
}

// Check if URL is a YouTube URL
function isYouTubeUrl(url: string): boolean {
    if (!url) return false;
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
}

// Convert any YouTube URL to embed format with branding disabled
function convertToYouTubeEmbedUrl(url: string): string {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return url;

    // YouTube embed parameters to minimize branding and disable seeking
    const origin = getYouTubeEmbedOrigin();
    const params = new URLSearchParams({
        modestbranding: '1',  // Reduce YouTube logo in controls
        rel: '0',             // Don't show related videos from other channels
        fs: '1',              // Enable fullscreen button
        playsinline: '1',     // Play inline on mobile
        iv_load_policy: '3',  // Hide video annotations
        disablekb: '1',       // Disable keyboard controls (prevents seeking via arrow keys)
        cc_load_policy: '0',  // Don't force captions
        origin,               // Valid http(s) origin — iOS capacitor:// is rejected (Error 153)
        widget_referrer: origin,
    });

    // Use youtube-nocookie.com for privacy-enhanced mode (less branding)
    return routeYouTubeEmbedThroughBridge(
        `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`,
    );
}

export const YouTubeEmbedPlayer: React.FC<YouTubeEmbedPlayerProps> = ({
    url,
    title,
    className = "",
}) => {
    const { t } = useTranslation("miscRoutesA");
    if (!url || !isYouTubeUrl(url)) {
        return (
            <div className="flex items-center justify-center h-screen-40 sm:h-screen-50 bg-white/5 rounded-lg sm:rounded-xl p-4 sm:p-8">
                <p className="text-white/50 text-sm sm:text-base">{t("media.invalidYoutubeUrl")}</p>
            </div>
        );
    }

    const embedUrl = convertToYouTubeEmbedUrl(url);

    return (
        <div className={`youtube-embed-container relative overflow-hidden rounded-lg sm:rounded-xl bg-black ${className}`}>
            <div className="relative aspect-video">
                <iframe
                    src={embedUrl}
                    title={title || t("media.video")}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="w-full h-full absolute inset-0"
                    loading="lazy"
                />

                {/* Overlay to block timeline and YouTube branding at the bottom */}
                <div
                    className="absolute bottom-0 start-0 end-0 h-12 sm:h-14 z-10 cursor-default"
                    style={{ background: 'transparent' }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                />

                {/* Overlay to block "Watch on YouTube" button in top-right corner */}
                <div
                    className="absolute top-0 end-0 w-28 h-10 sm:w-36 sm:h-12 z-10 cursor-default"
                    style={{ background: 'transparent' }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                />
            </div>
        </div>
    );
};

export { extractYouTubeVideoId, isYouTubeUrl, convertToYouTubeEmbedUrl };
