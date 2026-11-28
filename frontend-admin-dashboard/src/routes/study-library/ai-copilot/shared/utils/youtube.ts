import { extractYouTubeVideoId } from '@/utils/youtube';

export { extractYouTubeVideoId };

/**
 * Convert YouTube URL to embed URL
 */
export const getYouTubeEmbedUrl = (url: string): string | null => {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
    }
    return null;
};

/**
 * Check if URL is a YouTube URL
 */
export const isYouTubeUrl = (url: string): boolean => {
    return /(?:youtube\.com|youtu\.be)/.test(url);
};
