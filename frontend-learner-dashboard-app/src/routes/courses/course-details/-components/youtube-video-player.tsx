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
  const { t } = useTranslation("coursesRouteB");

  if (!url || !isYouTubeUrl(url)) {
    return null;
  }

  const embedUrl = convertToYouTubeEmbedUrl(url);

  return (
    <div className={`w-full overflow-hidden rounded-lg shadow-xl ${className}`}>
      <div className="relative aspect-video bg-black">
        <iframe
          src={embedUrl}
          title={t("videoPlayer.youtubeTitle")}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="size-full rounded-lg"
        />
      </div>
    </div>
  );
}; 