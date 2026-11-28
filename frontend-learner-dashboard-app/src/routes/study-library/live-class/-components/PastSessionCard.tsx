import { useState } from "react";
import {
  Clock,
  MapPin,
  PlayCircle,
  CheckCircle,
  XCircle,
  MinusCircle,
  ChatTeardrop,
  HandPalm,
  Smiley,
  ChartBar,
  FilePdf,
  VideoCamera,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { InstructorLine } from "./InstructorLine";
import {
  formatSessionTimeInUserTimezone,
  getTimezoneDisplayInfo,
} from "@/utils/timezone";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/formatters";
import { getPublicUrl } from "@/services/upload_file";
import {
  PastSessionDetails,
  LearnerRecording,
  PastSessionMaterial,
} from "../-types/types";
import { RecordingPlayerDialog } from "./RecordingPlayerDialog";

interface PastSessionCardProps {
  session: PastSessionDetails;
}

const AttendanceBadge = ({
  status,
}: {
  status: PastSessionDetails["attendance_status"];
}) => {
  const { t } = useTranslation("study");
  if (!status) return null;
  if (status === "PRESENT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-1 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-300">
        <CheckCircle size={14} weight="fill" />
        {t("liveClass.pastSession.attendance.present")}
      </span>
    );
  }
  if (status === "ABSENT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-1 text-xs font-medium text-danger-700 dark:bg-danger-900/30 dark:text-danger-300">
        <XCircle size={14} weight="fill" />
        {t("liveClass.pastSession.attendance.absent")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      <MinusCircle size={14} />
      {t("liveClass.pastSession.attendance.notMarked")}
    </span>
  );
};

const ActivityChips = ({
  activity,
}: {
  activity: PastSessionDetails["activity"];
}) => {
  const { t } = useTranslation("study");
  if (!activity) return null;
  const chips: { icon: JSX.Element; label: string }[] = [];

  if (activity.duration_minutes != null) {
    chips.push({
      icon: <Clock size={12} />,
      label: t("liveClass.pastSession.activity.attended", { minutes: activity.duration_minutes }),
    });
  }
  if (activity.chats != null) {
    chips.push({ icon: <ChatTeardrop size={12} />, label: t("liveClass.pastSession.activity.chats", { count: activity.chats }) });
  }
  if (activity.poll_votes != null) {
    chips.push({ icon: <ChartBar size={12} />, label: t("liveClass.pastSession.activity.pollVotes", { count: activity.poll_votes }) });
  }
  if (activity.raise_hand != null) {
    chips.push({ icon: <HandPalm size={12} />, label: t("liveClass.pastSession.activity.handRaises", { count: activity.raise_hand }) });
  }
  if (activity.emojis != null) {
    chips.push({ icon: <Smiley size={12} />, label: t("liveClass.pastSession.activity.reactions", { count: activity.emojis }) });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip, idx) => (
        <span
          key={idx}
          className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300"
        >
          {chip.icon}
          {chip.label}
        </span>
      ))}
    </div>
  );
};

export const PastSessionCard = ({ session }: PastSessionCardProps) => {
  const { t } = useTranslation("study");
  const [activeRecording, setActiveRecording] = useState<LearnerRecording | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const recordings = session.recordings ?? [];
  const materials = session.materials ?? [];

  // Video/YouTube materials reuse the recording player dialog via a pseudo
  // recording; PDFs resolve the media-service file id and open in a new tab.
  const handleOpenMaterial = async (material: PastSessionMaterial) => {
    if (material.kind === "PDF") {
      if (!material.file_id) return;
      try {
        const url = await getPublicUrl(material.file_id);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        else toast.error(t("liveClass.pastSession.toast.materialOpenFailed"));
      } catch {
        toast.error(t("liveClass.pastSession.toast.materialOpenFailed"));
      }
      return;
    }
    setActiveRecording({
      recording_id: `material-${material.slide_id}`,
      playback_type: material.kind === "YOUTUBE" ? "YOUTUBE" : "S3",
      file_id: material.file_id,
      url: material.url,
    });
    setDialogOpen(true);
  };

  const handleWatch = (recording: LearnerRecording) => {
    if (recording.expired) return;
    if (recording.playback_type === "BBB") {
      if (recording.url) window.open(recording.url, "_blank", "noopener,noreferrer");
      return;
    }
    setActiveRecording(recording);
    setDialogOpen(true);
  };

  const recordingLabel = (recording: LearnerRecording, index: number) =>
    recording.part_label ||
    (recordings.length > 1
      ? t("liveClass.pastSession.recording.part", { number: index + 1 })
      : t("liveClass.pastSession.recording.watch"));

  const cardBody = (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">
          {session.title}
        </h3>
        <AttendanceBadge status={session.attendance_status} />
      </div>

      {session.subject && session.subject.toLowerCase() !== "none" && (
        <div className="flex items-center gap-1 text-sm text-neutral-600 dark:text-neutral-300 mb-2">
          <MapPin size={16} className="text-neutral-500 dark:text-neutral-400" />
          <span className="capitalize">{session.subject}</span>
        </div>
      )}

      <InstructorLine instructors={session.instructors} className="mb-2" />

      <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 mb-2">
        <Clock size={16} className="text-neutral-500 dark:text-neutral-400" />
        <span>
          {formatDate(session.meeting_date, {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          {" · "}
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

      {session.activity && (
        <div className="mb-2">
          <ActivityChips activity={session.activity} />
        </div>
      )}

      {recordings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {recordings.map((recording, idx) => (
            <Button
              key={recording.recording_id || idx}
              variant="outline"
              size="sm"
              disabled={!!recording.expired}
              onClick={() => handleWatch(recording)}
            >
              <PlayCircle size={16} className="me-1.5" />
              {recording.expired ? t("liveClass.pastSession.recording.expired") : recordingLabel(recording, idx)}
            </Button>
          ))}
        </div>
      )}

      {materials.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("liveClass.pastSession.materialsLabel")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {materials.map((material) => (
              <Button
                key={material.slide_id}
                variant="outline"
                size="sm"
                onClick={() => void handleOpenMaterial(material)}
              >
                {material.kind === "PDF" ? (
                  <FilePdf size={16} className="me-1.5" />
                ) : (
                  <VideoCamera size={16} className="me-1.5" />
                )}
                <span className="max-w-48 truncate">{material.title || t("liveClass.pastSession.materialFallback")}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="p-4 border rounded-xl bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:shadow-sm transition-all duration-200 w-full">
      {cardBody}
      <RecordingPlayerDialog
        recording={activeRecording}
        title={session.title}
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setActiveRecording(null);
        }}
      />
    </div>
  );
};
