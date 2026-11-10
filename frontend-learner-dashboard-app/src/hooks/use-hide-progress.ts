import { useEffect, useState } from "react";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { useCurrentInstituteId } from "@/services/points";

/**
 * The institute's "hide progress" choice (STUDENT_DISPLAY_SETTINGS
 * courseDetails.hideProgressCard). A skin that shows progress outside the course
 * page reads it here, so an institute that hides the progress card sees no
 * percent, bar or ring anywhere else either.
 *
 * Null until the setting has been read for the institute on screen. The answer is
 * kept across mounts, keyed by institute: coming back to Home does not start from
 * "not read yet", and after a switch inside the app the other institute's answer is
 * never taken for this one's.
 */
let lastAnswer: { key: string; hide: boolean } | null = null;

const remembered = (instituteId: string | null | undefined): boolean | null =>
  instituteId && lastAnswer?.key === instituteId ? lastAnswer.hide : null;

export function useHideProgress(): boolean | null {
  const instituteId = useCurrentInstituteId();
  const [answer, setAnswer] = useState<{ key: string | null | undefined; hide: boolean | null }>(() => ({
    key: instituteId,
    hide: remembered(instituteId),
  }));
  useEffect(() => {
    let live = true;
    const settle = (value: boolean) => {
      if (instituteId) lastAnswer = { key: instituteId, hide: value };
      if (live) setAnswer({ key: instituteId, hide: value });
    };
    getStudentDisplaySettings(false)
      .then((settings) => settle(settings?.courseDetails?.hideProgressCard === true))
      .catch(() => settle(false));
    return () => {
      live = false;
    };
  }, [instituteId]);
  // An answer read for another institute says nothing about this one.
  return answer.key === instituteId ? answer.hide : remembered(instituteId);
}
