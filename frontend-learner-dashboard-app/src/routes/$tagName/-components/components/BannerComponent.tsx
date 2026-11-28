import React from "react";
import { useTranslation } from "react-i18next";
import { BannerProps } from "../../-types/course-catalogue-types";

export const BannerComponent: React.FC<BannerProps> = ({
  title,
  media,
  alignment,
}) => {
  const { t } = useTranslation("coursePlayerB");

  const getAlignmentClass = () => {
    switch (alignment) {
      case "left":
        return "text-start";
      case "right":
        return "text-end";
      case "center":
      default:
        return "text-center";
    }
  };

  return (
    <div className="relative h-48 sm:h-56 md:h-64 lg:h-72 overflow-hidden">
      {/* Background Media */}
      {media.type === "image" && (
        <div className="absolute inset-0">
          <img
            src={media.url}
            alt={t("banner.alt")}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      {media.type === "video" && (
        <div className="absolute inset-0">
          <video
            className="w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          >
            <source src={media.url} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 h-full flex items-center justify-center">
        <div className={`w-full px-4 sm:px-6 lg:px-8 ${getAlignmentClass()}`}>
          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-white">
            {title}
          </h1>
        </div>
      </div>
    </div>
  );
};
