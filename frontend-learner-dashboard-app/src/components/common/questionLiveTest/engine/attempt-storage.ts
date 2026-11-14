/** Device-storage reads the live-test engine needs (Capacitor Preferences). */
import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { safeParse } from "@/lib/storage";

/** Server start and end time of the attempt, written by the start flow. */
export const getServerStartEndTime = async () => {
  const { value } = await Preferences.get({ key: "server_start_end_time" });
  return safeParse<{ start_time?: string; end_time?: string }>(value, {});
};

/** Server start time in ms, or 0 when it is not stored. */
export const getServerStartMs = async () => {
  const parsedValue = await getServerStartEndTime();
  return parsedValue.start_time ? new Date(parsedValue.start_time).getTime() : 0;
};

/** The assessment id the start flow stored for this attempt. */
export const readStoredAssessmentId = async () => {
  const stored = await Preferences.get({ key: "InstructionID_and_AboutID" });
  return safeParse<{ assessment_id?: string } | null>(stored.value, null)
    ?.assessment_id;
};

export interface AttemptContext {
  /** "" until storage has been read. */
  playMode: string;
  evaluationType: string;
  assessmentId: string;
  /** Paper title for the header. */
  assessmentName: string;
  instituteId: string | null;
  userId: string | null;
}

const EMPTY_CONTEXT: AttemptContext = {
  playMode: "",
  evaluationType: "",
  assessmentId: "",
  assessmentName: "",
  instituteId: null,
  userId: null,
};

/**
 * The attempt context the start flow stored (play mode, evaluation type,
 * assessment id and name) plus the institute and learner ids. Read once for
 * the whole exam screen.
 */
export function useAttemptContext(): AttemptContext {
  const [context, setContext] = useState<AttemptContext>(EMPTY_CONTEXT);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const [attempt, institute, student] = await Promise.all([
        Preferences.get({ key: "InstructionID_and_AboutID" }),
        Preferences.get({ key: "InstituteId" }),
        Preferences.get({ key: "StudentDetails" }),
      ]);
      const parsed = safeParse<{
        play_mode?: string;
        evaluation_type?: string;
        assessment_id?: string;
        name?: string;
      } | null>(attempt.value, null);
      const studentDetails = safeParse<{ user_id?: string } | null>(
        student.value,
        null,
      );
      if (!alive) return;
      setContext({
        playMode: parsed?.play_mode ?? "",
        evaluationType: parsed?.evaluation_type ?? "",
        assessmentId: parsed?.assessment_id ?? "",
        assessmentName: parsed?.name ?? "",
        instituteId: institute.value || null,
        userId: studentDetails?.user_id || null,
      });
    };
    void read();
    return () => {
      alive = false;
    };
  }, []);

  return context;
}
