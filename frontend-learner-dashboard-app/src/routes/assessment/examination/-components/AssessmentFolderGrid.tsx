import { ArrowLeft, CaretRight, Folder, Stack } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { type LearnerFolderList } from "@/services/assessment-folders";

const FolderImage = ({
  imageUrl,
  icon,
  className,
}: {
  imageUrl?: string | null;
  icon: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-center justify-center overflow-hidden bg-primary-50 text-primary-500",
      className
    )}
  >
    {imageUrl ? (
      <img src={imageUrl} alt="" loading="lazy" className="size-full object-cover" />
    ) : (
      icon
    )}
  </div>
);

/**
 * The institute's assessment folders as cards. Tapping one opens its tests (with the
 * usual Live / Upcoming / Past tabs). Tests in no folder are listed below the cards
 * by the caller, not behind a card of their own.
 */
export const AssessmentFolderGrid = ({
  data,
  onOpen,
}: {
  data: LearnerFolderList;
  onOpen: (folderId: string) => void;
}) => {
  const { t } = useTranslation("assessment");
  const cards = [
    ...data.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      imageUrl: folder.image_url,
      count: folder.assessment_count,
      icon: <Folder size={40} weight="duotone" />,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-h3 font-semibold text-foreground">
          {t("scheduleTest.folders.title")}
        </h2>
        <p className="text-caption text-muted-foreground">
          {t("scheduleTest.folders.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onOpen(card.id)}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <FolderImage
              imageUrl={card.imageUrl}
              icon={card.icon}
              className="aspect-video w-full"
            />
            <div className="flex items-center gap-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-body font-semibold text-foreground">
                  {card.name}
                </p>
                <p className="text-caption text-muted-foreground">
                  {t("scheduleTest.folders.count", { count: card.count })}
                </p>
                {card.description ? (
                  <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
                    {card.description}
                  </p>
                ) : null}
              </div>
              <CaretRight
                size={18}
                className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/** Back to the folders + the open folder's name, above its tabs. */
export const AssessmentFolderHeader = ({
  name,
  imageUrl,
  count,
  isOthers,
  onBack,
}: {
  name: string;
  imageUrl?: string | null;
  count?: number;
  isOthers?: boolean;
  onBack: () => void;
}) => {
  const { t } = useTranslation("assessment");
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("scheduleTest.folders.back")}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted sm:min-h-9 sm:min-w-9"
      >
        <ArrowLeft size={18} />
      </button>
      <FolderImage
        imageUrl={imageUrl}
        icon={isOthers ? <Stack size={22} /> : <Folder size={22} weight="duotone" />}
        className="size-11 shrink-0 rounded-lg"
      />
      <div className="min-w-0">
        <h2 className="line-clamp-1 text-h3 font-semibold text-foreground">{name}</h2>
        {typeof count === "number" ? (
          <p className="text-caption text-muted-foreground">
            {t("scheduleTest.folders.count", { count })}
          </p>
        ) : null}
      </div>
    </div>
  );
};
