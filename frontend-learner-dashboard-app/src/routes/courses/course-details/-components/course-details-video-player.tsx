import React from 'react';
import { useTranslation } from 'react-i18next';
import { isYouTubeUrl, isVimeoUrl, getVimeoVideoId } from '../-utils/helper';
import { YouTubeVideoPlayer } from './youtube-video-player';

interface VideoPlayerProps {
  src: string;
  className?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  className = ""
}) => {
  const { t } = useTranslation("coursesRouteB");

  if (!src) {
    return null;
  }

  // If it's a YouTube URL, use the YouTube player
  if (isYouTubeUrl(src)) {
    return <YouTubeVideoPlayer url={src} className={className} />;
  }

  // If it's a Vimeo URL, use Vimeo embed
  if (isVimeoUrl(src)) {
    const vimeoId = getVimeoVideoId(src);
    if (vimeoId) {
      return (
        <div className={`w-card-500 overflow-hidden rounded-lg shadow-xl ${className}`}>
          <div className="relative aspect-video bg-black">
            <iframe
              src={`https://player.vimeo.com/video/${vimeoId}?badge=0&autopause=0&player_id=0`}
              className="size-full rounded-lg"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title={t("videoPlayer.vimeoTitle")}
            />
          </div>
        </div>
      );
    }
  }

  // Otherwise, use the regular video element
  return (
    <div className={`w-card-500 overflow-hidden rounded-lg shadow-xl ${className}`}>
      <div className="relative aspect-video bg-black">
        <video
          src={src}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          className="size-full rounded-lg object-contain"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.parentElement?.classList.add("bg-black");
          }}
        >
          {t("videoPlayer.unsupported")}
        </video>
      </div>
    </div>
  );
}; 