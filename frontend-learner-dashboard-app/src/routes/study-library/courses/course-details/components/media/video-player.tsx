import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isYouTubeUrl, isVimeoUrl, getVimeoVideoId } from '../../-utils/helper';
import { YouTubeVideoPlayer } from './youtube-video-player';

interface VideoPlayerProps {
  src: string;
  className?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  className = ""
}) => {
  // Native videos report their natural dimensions via `loadedmetadata`. We
  // size the container to match so portrait clips aren't cropped to a 16/9
  // box. Defaults to 16/9 until the metadata arrives so the layout doesn't
  // jump too aggressively.
  const { t } = useTranslation("courseDetailsC");
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);

  if (!src) {
    return null;
  }

  // If it's a YouTube URL, use the YouTube player
  if (isYouTubeUrl(src)) {
    return <YouTubeVideoPlayer url={src} className={className} />;
  }

  // If it's a Vimeo URL, use Vimeo embed (iframe has no metadata event we
  // can hook into without the Vimeo SDK, so we keep the 16/9 default).
  if (isVimeoUrl(src)) {
    const vimeoId = getVimeoVideoId(src);
    if (vimeoId) {
      return (
        <div className={`relative overflow-hidden rounded-md shadow-md border border-black/10 bg-black/20 ${className}`}>
          <div className="relative aspect-video">
            <iframe
              src={`https://player.vimeo.com/video/${vimeoId}?badge=0&autopause=0&player_id=0`}
              className="w-full h-full rounded-md"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title={t("videoPlayer.vimeoTitle")}
            />
          </div>
        </div>
      );
    }
  }

  // Otherwise, use the regular video element with a dynamic aspect ratio.
  // The wrapper caps height at 60vh so portrait videos (aspect < 1) don't
  // stretch the page vertically — instead the container shrinks in width
  // proportionally and centers itself within the available column. Landscape
  // videos still fill the column at their natural ratio.
  return (
    <div className={`relative overflow-hidden rounded-md shadow-md border border-black/10 bg-black group ${className}`}>
      <div
        className="relative w-full mx-auto"
        style={{ aspectRatio, maxHeight: "60vh" }}
      >
        <video
          src={src}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          // `object-contain` keeps the video undistorted; combined with the
          // dynamic aspect-ratio wrapper there's no visible letterboxing once
          // metadata loads (the container hugs the video).
          className="w-full h-full object-contain rounded-md"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setAspectRatio(v.videoWidth / v.videoHeight);
            }
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.parentElement?.classList.add("bg-black");
          }}
        >
          {t("videoPlayer.unsupported")}
        </video>
      </div>
      {/* Video overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none rounded-md"></div>
    </div>
  );
};