import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Brain, CaretRight } from "@phosphor-icons/react";
import { getInstituteId } from "@/constants/helper";
import { fetchDueCount } from "@/lib/notes/api";
import { hasUsedNotes } from "@/lib/notes/outbox";
import { useNotesAllowed } from "./LessonNotesHost";

/**
 * "3 notes to revise" on the dashboard. Shows nothing, and asks the server
 * nothing, on a device where the learner has never made a note.
 */
export function NotebookReviewLine() {
  const { t } = useTranslation("notebook");
  const [instituteId, setInstituteId] = useState<string | null>(null);
  const allowed = useNotesAllowed();
  const used = hasUsedNotes() && allowed;

  useEffect(() => {
    if (used) void getInstituteId().then((id) => setInstituteId(id ?? null));
  }, [used]);

  const due = useQuery({
    queryKey: ["notebook-due-count", instituteId],
    enabled: used && !!instituteId,
    queryFn: () => fetchDueCount(instituteId as string),
  });
  if (!due.data) return null;

  return (
    <Link
      to="/notebook"
      className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <Brain size={18} weight="duotone" className="shrink-0 text-primary-500" />
      <span className="min-w-0 flex-1 truncate text-caption font-medium text-neutral-800">
        {t("review.ready", { count: due.data })}
      </span>
      <CaretRight size={14} className="shrink-0 text-neutral-500 rtl:rotate-180" />
    </Link>
  );
}
