import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SessionDetails } from "../../-types/types";
import { SessionStatus } from "../-helpers/checkSessionStatus";
import {
  Clock,
  MapPin,
  ArrowSquareOut,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  formatSessionTimeInUserTimezone,
  getTimezoneDisplayInfo,
} from "@/utils/timezone";
import { calculateDuration } from "@/lib/live-class/utils";
import { useTranslation } from "react-i18next";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface SessionSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Array<{ session: SessionDetails; status: SessionStatus }>;
  onSelectSession: (session: SessionDetails) => void;
}

export function SessionSelectionDialog({
  open,
  onOpenChange,
  sessions,
  onSelectSession,
}: SessionSelectionDialogProps) {
  const { t } = useTranslation("study");
  const sessionsTerm = getTerminologyPlural(ContentTerms.Session, SystemTerms.Session).toLowerCase();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-screen-80 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-2">
            <WarningCircle size={28} className="text-primary-600" />
            {t("liveClass.sessionSelection.title")}
          </DialogTitle>
          <DialogDescription className="text-neutral-600 dark:text-neutral-300">
            {t("liveClass.sessionSelection.description", {
              count: sessions.length,
              sessions: sessionsTerm,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {sessions.map(({ session, status }) => (
            <div
              key={session.schedule_id}
              className={`p-5 border rounded-xl transition-all duration-200 hover:shadow-md ${
                status.isInWaitingRoom
                  ? "bg-gradient-to-r from-primary-50/50 to-primary-100/30 border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-900"
                  : "bg-gradient-to-r from-danger-50/50 to-danger-100/30 border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-900"
              }`}
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 space-y-3">
                  {/* Title and Status Badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">
                      {session.title}
                    </h3>
                    <span
                      className={`px-2.5 py-1 text-white text-xs font-medium rounded-full animate-pulse ${
                        status.isInWaitingRoom
                          ? "bg-orange-600"
                          : "bg-danger-600"
                      }`}
                    >
                      {status.isInWaitingRoom
                        ? t("liveClass.badge.waitingRoom")
                        : t("liveClass.badge.liveNow")}
                    </span>
                  </div>

                  {/* Subject */}
                  <div className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
                    <MapPin size={16} className="text-neutral-500" />
                    <span className="capitalize">{session.subject}</span>
                  </div>

                  {/* Time Information */}
                  <div className="flex flex-col sm:flex-row gap-stack text-sm">
                    <div className="flex items-center gap-1.5">
                      <Clock size={16} className="text-neutral-500" />
                      <span className="text-neutral-600 dark:text-neutral-300">
                        <span className="font-medium">{t("liveClass.field.starts")}</span>{" "}
                        {formatSessionTimeInUserTimezone(
                          session.meeting_date,
                          session.start_time,
                          session.timezone
                        )}
                        {session.timezone && (
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 ms-1">
                            ({getTimezoneDisplayInfo(session.timezone).sessionTz})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={16} className="text-neutral-500" />
                      <span className="text-neutral-600 dark:text-neutral-300">
                        <span className="font-medium">{t("liveClass.field.duration")}</span>{" "}
                        {calculateDuration(
                          session.start_time,
                          session.last_entry_time
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Join Button */}
                <Button
                  onClick={() => onSelectSession(session)}
                  className={`flex-shrink-0 ${
                    status.isInWaitingRoom &&
                    session.waiting_room_type !== "PRE_JOINING"
                      ? "bg-gradient-to-r from-primary-500 to-primary-400 hover:from-primary-400 hover:to-primary-300"
                      : "bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700"
                  } text-white shadow-sm hover:shadow-md transition-all duration-200`}
                  size="lg"
                >
                  <ArrowSquareOut size={18} className="me-2" />
                  {status.isInWaitingRoom &&
                  session.waiting_room_type !== "PRE_JOINING"
                    ? t("liveClass.button.joinWaitingRoom")
                    : status.isInWaitingRoom
                      ? t("liveClass.button.joinLiveClass")
                      : t("liveClass.button.joinSession")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <span className="font-semibold">{t("liveClass.sessionSelection.tipLabel")}</span>{" "}
            {t("liveClass.sessionSelection.tipBody", { session: getTerminology(ContentTerms.Session, SystemTerms.Session).toLowerCase() })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
