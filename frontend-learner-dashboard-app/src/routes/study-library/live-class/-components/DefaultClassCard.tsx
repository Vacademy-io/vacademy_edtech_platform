
import { Button } from "@/components/ui/button";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface DefaultClassCardProps {
    defaultClassLink: string;
    defaultClassName?: string | null;
}

export const DefaultClassCard = ({
    defaultClassLink,
    defaultClassName,
}: DefaultClassCardProps) => {
    const { t } = useTranslation("study");
    const liveSession = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const session = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const displayTitle = defaultClassName || t("liveClass.defaultClassCard.defaultTitle", { session });

    return (
        <div className="p-4 border rounded-xl bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 shadow-sm w-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex-1 w-full sm:w-auto space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">
                            {displayTitle}
                        </h3>
                        <span className="px-2 py-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 text-xs font-medium rounded-full whitespace-nowrap">
                            {t("liveClass.defaultClassCard.noLiveSession", { liveSession })}
                        </span>
                    </div>
                    <p className="text-sm text-neutral-600 dark:text-neutral-300">
                        {t("liveClass.defaultClassCard.description", { liveSession, session })}
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-stack w-full sm:w-auto">
                    <Button
                        variant="default"
                        size="sm"
                        className="w-full sm:w-auto shrink-0"
                        onClick={() => {
                            window.open(defaultClassLink, "_blank");
                        }}
                    >
                        <ArrowSquareOut size={16} className="me-1.5 text-white" />
                        <span className="text-white">{t("liveClass.defaultClassCard.viewSession", { session })}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
};
