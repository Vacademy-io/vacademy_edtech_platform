import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Microphone } from "@phosphor-icons/react";
import { getTutorAvailability, type TutorAvailability } from "@/services/tutor-api";
import { preloadAvatarKit, warmAvatarSdk } from "@/hooks/useSpatiusAvatar";
import { TeacherAvatar } from "./TeacherAvatar";

interface TutorEntryCardProps {
  courseId: string;
  packageSessionId: string;
  /** The course page's tab, so ending the lesson returns to the same view. */
  selectedTab?: string;
}

/**
 * "Learn with your teacher" — shown on the course page when the course has
 * tutor mode enabled and at least one prepared slide. Resumes where the
 * learner left off, else starts at the first prepared slide. Enrolment is
 * enforced by the server when the session starts (the page's own
 * `isEnrolledInCourse` flag is documented as unreliable), so the card is
 * gated on availability alone.
 */
export const TutorEntryCard: React.FC<TutorEntryCardProps> = ({ courseId, packageSessionId, selectedTab }) => {
  const navigate = useNavigate();
  const [avail, setAvail] = useState<TutorAvailability | null>(null);

  useEffect(() => {
    if (!courseId || !packageSessionId) return;
    let cancelled = false;
    getTutorAvailability(courseId, packageSessionId)
      .then((a) => {
        if (!cancelled) setAvail(a);
      })
      .catch(() => {
        /* not available: render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, packageSessionId]);

  if (!avail || !avail.available) return null;
  const resuming = !!avail.resume_slide_id;
  const slideId = avail.resume_slide_id || avail.first_slide_id || undefined;
  const chapterId = resuming ? avail.resume_chapter_id : avail.first_chapter_id;
  const moduleId = resuming ? avail.resume_module_id : avail.first_module_id;
  const subjectId = resuming ? avail.resume_subject_id : avail.first_subject_id;
  const go = (mode: "text" | "voice") => {
    // A voice lesson may bring the animated teacher: start its SDK download
    // now, a whole round-trip before the lesson page asks for it — with the
    // app id, the SDK's own first-visit template download too.
    if (mode === "voice") {
      if (avail.avatar?.app_id) warmAvatarSdk(avail.avatar.app_id);
      else void preloadAvatarKit().catch(() => undefined);
    }
    return navigate({
      to: "/study-library/courses/course-details/tutor",
      search: {
        courseId, packageSessionId, slideId, chapterId: chapterId || undefined,
        moduleId: moduleId || undefined, subjectId: subjectId || undefined, mode,
        selectedTab,
      } as never,
    });
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 sm:flex-row sm:items-center">
      <TeacherAvatar fileId={avail.teacher_avatar_file_id} name={avail.teacher_name} className="size-14 shadow-sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900">
          Learn with {avail.teacher_name}, your AI teacher
        </p>
        <p className="text-xs text-neutral-600">
          One-to-one on a whiteboard: {avail.teacher_name} explains, checks that you got it, and clears your doubts.
          {avail.resume_slide_id ? " Pick up where you left off." : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => go("voice")} className="inline-flex items-center gap-1 rounded-full bg-primary-500 px-4 py-2 text-sm font-medium text-white">
          <Microphone className="size-4" /> Start lesson
        </button>
        <button type="button" onClick={() => go("text")} className="rounded-full border border-primary-300 bg-white px-4 py-2 text-sm font-medium text-primary-500">
          Text only
        </button>
      </div>
    </div>
  );
};
