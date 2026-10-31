import React from 'react';
import { useTranslation } from 'react-i18next';
import { isYouTubeUrl, convertToYouTubeEmbedUrl } from '../-utils/helper';

interface YouTubeVideoPlayerProps {
  url: string;
  className?: string;
}

export const YouTubeVideoPlayer: React.FC<YouTubeVideoPlayerProps> = ({
  url,
  className = ""
}) => {
  const { t } = useTranslation("courseDetailsB");

  if (!url || !isYouTubeUrl(url)) {
    return null;
  }

  const embedUrl = convertToYouTubeEmbedUrl(url);

  return (
    <div className={`relative overflow-hidden rounded-md shadow-md border border-black/10 bg-black/20 group ${className}`}>
      <div className="relative aspect-video">
        <iframe
          src={embedUrl}
          title={t("videoPlayer.youtubeTitle")}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="w-full h-full object-cover rounded-md"
        />
      </div>
      {/* Video overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none rounded-md"></div>
    </div>
  );
}; 