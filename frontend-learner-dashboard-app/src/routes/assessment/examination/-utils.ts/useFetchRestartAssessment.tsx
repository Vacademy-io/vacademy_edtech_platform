import { Storage } from '@capacitor/storage';
import { useAssessmentStore } from "@/stores/assessment-store";
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { RESTART_ASSESSMENT } from '@/constants/urls';
import { getDuration } from './useFetchAssessment';
import { safeParse } from '@/lib/storage';
import {
  type CodingResponsePayload,
  type ResponseData,
  decodeAnswer,
  decodeCodingAnswer,
  encodeResponseData,
  responseHasAnswer,
} from '@/lib/assessment-response';

interface StoredData {
  assessment?: {
    attempt_id: string;
    assessment_id: string;
    preview_total_time?: number;
    section_dtos?: SectionDTO[];
  };
  entireTestTimer?: number;
  tabSwitchCount?: number;
  sectionTimers?: Record<string, { timeLeft: number }>;
  questionTimers?: Record<string, number>;
  questionTimeSpent?: Record<string, number>;
  questionStates?: Record<string, { isMarkedForReview: boolean; isVisited: boolean }>;
  answers?: Record<string, string[]>;
  codingAnswers?: Record<string, CodingResponsePayload>;
}

interface SectionDTO {
  id: string;
  duration?: number;
  question_preview_dto_list?: QuestionDTO[];
}

interface QuestionDTO {
  question_id: string;
  question_type: string;
}

interface FormattedData {
  attemptId: string;
  clientLastSync: string;
  assessment: {
    assessmentId: string;
    entireTestDurationLeftInSeconds: number;
    timeElapsedInSeconds: number;
    status: string;
    tabSwitchCount: number;
  };
  sections: Section[];
}

interface Section {
  sectionId: string;
  sectionDurationLeftInSeconds: number;
  timeElapsedInSeconds: number;
  questions: Question[];
}

interface Question {
  questionId: string;
  questionDurationLeftInSeconds: number;
  timeTakenInSeconds: number;
  isMarkedForReview: boolean;
  isVisited: boolean;
  responseData: ResponseData;
}


const formatStoredAssessmentData = (storedData: StoredData): FormattedData | null => {
  if (!storedData || !storedData.assessment) {
    console.error("Invalid stored assessment data.");
    return null;
  }

  return {
    attemptId: storedData.assessment?.attempt_id,
    clientLastSync: new Date().toISOString(),
    assessment: {
      assessmentId: storedData.assessment?.assessment_id,
      entireTestDurationLeftInSeconds: storedData.entireTestTimer || 0,
      timeElapsedInSeconds: storedData.assessment?.preview_total_time
        ? storedData.assessment.preview_total_time * 60 - (storedData.entireTestTimer || 0)
        : 0,
      status: "LIVE",
      tabSwitchCount: storedData.tabSwitchCount || 0,
    },
    sections: storedData.assessment?.section_dtos?.map((section) => {
      // sectionTimers store timeLeft in MILLISECONDS (assessment-store.ts:168),
      // but these fields are seconds. Convert once here — previously the raw ms
      // value was emitted as seconds and subtracted from section.duration*60,
      // producing wildly wrong (negative) elapsed times in the restart payload.
      const sectionTimeLeftSeconds = Math.round(
        (storedData.sectionTimers?.[section.id]?.timeLeft || 0) / 1000
      );
      return {
      sectionId: section.id,
      sectionDurationLeftInSeconds: sectionTimeLeftSeconds,
      timeElapsedInSeconds: section.duration
        ? section.duration * 60 - sectionTimeLeftSeconds
        : 0,
      questions: section.question_preview_dto_list?.map((question) => ({
        questionId: question.question_id,
        questionDurationLeftInSeconds:
          storedData.questionTimers?.[question.question_id] || 0,
        timeTakenInSeconds: storedData.questionTimeSpent?.[question.question_id] || 0,
        isMarkedForReview:
          storedData.questionStates?.[question.question_id]?.isMarkedForReview || false,
        isVisited:
          storedData.questionStates?.[question.question_id]?.isVisited || false,
        // Encode by question type. Previously every answer was written into
        // `optionIds` regardless of type, so a LONG_ANSWER/ONE_WORD/NUMERIC
        // answer went out in a field the restore path never reads back.
        responseData: encodeResponseData(
          question.question_type,
          storedData.answers?.[question.question_id],
          storedData.codingAnswers?.[question.question_id]
        ),
      })) || [],
      };
    }) || [],
  };
};

interface RestartAssessmentResponse {
  preview_response: any;
  // The backend (AssessmentRestartResponse) sends the saved attempt as the raw
  // JSON string `attempt_data_json`; the parsed DTO field is legacy and absent.
  learner_assessment_attempt_data_dto?: FormattedData;
  attempt_data_json?: string | null;
  update_status_response: UpdateStatusResponse | null;
  start_assessment_response: StartAssessmentResponse | null;
}

interface UpdateStatusResponse {
  duration?: { id?: string; type?: string; new_max_time_in_seconds?: number | null }[];
}

interface StartAssessmentResponse {
  start_time?: string | number;
  end_time?: string | number;
}

// Server-side time left for the whole attempt (attempt start + max_time - now),
// from the ASSESSMENT entry of update_status_response.duration.
const getServerTimeLeftSeconds = (
  updateStatusResponse: UpdateStatusResponse | null
): number | undefined => {
  const entries = Array.isArray(updateStatusResponse?.duration)
    ? updateStatusResponse.duration
    : [];
  const entry = entries.find((d) => d?.type === "ASSESSMENT") ?? entries[0];
  const seconds = Number(entry?.new_max_time_in_seconds ?? NaN);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
};

// The attempt's max_time in minutes: the restart's start_assessment_response is
// stamped start = now, end = now + max_time.
const getMaxTimeMinutes = (
  startAssessmentResponse: StartAssessmentResponse | null
): number | undefined => {
  if (startAssessmentResponse?.start_time == null || startAssessmentResponse?.end_time == null) {
    return undefined;
  }
  const start = new Date(startAssessmentResponse?.start_time).getTime();
  const end = new Date(startAssessmentResponse?.end_time).getTime();
  const minutes = Math.round((end - start) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
};

export async function restartAssessment(assessmentId: string, attemptId: string): Promise<boolean> { 
  console.log('Restarting assessment:', { assessmentId, attemptId });
  
  if (!assessmentId || !attemptId) {
    console.error('Missing required parameters:', { assessmentId, attemptId });
    return false;
  }
  
  const storedAssessmentData = await Storage.get({ key: `ASSESSMENT_STATE_${attemptId}` });

  console.log('Stored Assessment Data:', storedAssessmentData);
  const parsedStored = safeParse<StoredData | null>(storedAssessmentData.value, null);
  const body = parsedStored ? formatStoredAssessmentData(parsedStored) : {};
  console.log('Restarting assessment with body:', body);
  try {
    // API Call
    const restartApiResponse = await authenticatedAxiosInstance.post<RestartAssessmentResponse>(
      `${RESTART_ASSESSMENT}`,
      body, //api body
      { params: { assessmentId, attemptId } }
    );

    console.log('Restart API Response:', restartApiResponse);

    // Ensure we get the correct data
    const { data } = restartApiResponse;
    if (!data) throw new Error("Empty API response");

    const { learner_assessment_attempt_data_dto, attempt_data_json, update_status_response, start_assessment_response } = data;
    const attemptData =
      learner_assessment_attempt_data_dto ??
      safeParse<FormattedData | null>(attempt_data_json ?? null, null);

    // The restart preview carries no duration or section-switch flag. Without
    // them the store started the timer at 0 (instant auto-submit with no
    // answers) and locked section switching. Use the attempt's real max_time as
    // the duration. `distribution_duration` is deliberately NOT filled: the
    // section/question timers restored below are keyed and scaled differently
    // from what the SECTION/QUESTION tickers read, so turning those modes on
    // here would skip sections/questions every second.
    const durationData = await getDuration();
    // No max_time (an untimed practice/survey) keeps the old shape: no duration.
    const durationMinutes = getMaxTimeMinutes(start_assessment_response);
    const preview_response = {
      ...data.preview_response,
      can_switch_section: durationData.can_switch_section,
      ...(durationMinutes !== undefined ? { duration: durationMinutes } : {}),
    };
    const timeLeftSeconds = getServerTimeLeftSeconds(update_status_response);

    // Store data properly
    await Storage.set({ key: 'Assessment_questions', value: JSON.stringify(preview_response) });
    console.log('Stored Assessment Data:', await Storage.get({ key: 'Assessment_questions' }));

    // The restart stamps start_time = now. Shift it back to the effective start
    // so the visibilitychange reconcile (duration - elapsed since start) agrees
    // with the server's time left instead of handing out a fresh full timer.
    const nowMs = Date.now();
    const serverStartEndTime =
      timeLeftSeconds !== undefined && durationMinutes !== undefined
        ? {
            ...start_assessment_response,
            start_time: new Date(nowMs - (durationMinutes * 60 - timeLeftSeconds) * 1000).toISOString(),
            end_time: new Date(nowMs + timeLeftSeconds * 1000).toISOString(),
          }
        : start_assessment_response;
    await Storage.set({ key: 'server_start_end_time', value: JSON.stringify(serverStartEndTime) });
    console.log('Stored server_start_end_time:', await Storage.get({ key: 'server_start_end_time' }));

    console.log('preview_response.attemptId', preview_response, preview_response?.attempt_id);
    // Await so any failure inside surfaces through this function's try/catch
    // (returning false) instead of becoming an unhandled promise rejection.
    await storeFormattedData(attemptData, preview_response, timeLeftSeconds);

    await Storage.set({ key: 'Announcements', value: JSON.stringify(update_status_response) });
    console.log('Stored Announcements:', await Storage.get({ key: 'Announcements' }));

    console.log('Assessment restart completed successfully');
    return true;
  } catch (error) {
    console.error('Error restarting assessment:', error);
    return false;
  }
}
  



export const storeFormattedData = async (
  formattedData: any,
  preview_response: any,
  serverTimeLeftSeconds?: number
) => {
    const state = useAssessmentStore.getState();
    if (!preview_response) {
      console.error("Missing preview_response on restart");
      return;
    }
    const attemptId = preview_response.attempt_id;
    console.log("formattedData",formattedData,"preview_response",preview_response, "attemptId", attemptId);
  console.log(attemptId);
    if (!attemptId) {
      console.error("Attempt ID is missing in formatted data");
      return;
    }
  
    state.setAssessment(preview_response);
    // setAssessment (above) computes a correct entireTestTimer from the
    // assessment duration. Capture it so the restore setState below can fall
    // back to it instead of clobbering the timer to 0/undefined when the
    // server/stored remaining-time is missing.
    const computedEntireTestTimer = useAssessmentStore.getState().entireTestTimer;
    // The server's time left is authoritative; the attempt's last sync is up to
    // a minute stale and the computed value is a full fresh timer.
    const syncedTimeLeft = Number(formattedData?.assessment?.entireTestDurationLeftInSeconds);
    const restoredEntireTestTimer =
      serverTimeLeftSeconds !== undefined
        ? serverTimeLeftSeconds
        : syncedTimeLeft > 0
          ? syncedTimeLeft
          : computedEntireTestTimer;
    
    // Ensure we have valid data before setting state
    if (!preview_response.section_dtos || preview_response.section_dtos.length === 0) {
      console.error("Invalid preview_response: missing section_dtos");
      return;
    }
    
    if (!preview_response.section_dtos[0].question_preview_dto_list || preview_response.section_dtos[0].question_preview_dto_list.length === 0) {
      console.error("Invalid preview_response: missing questions in first section");
      return;
    }

    // The restart endpoint may omit `learner_assessment_attempt_data_dto`
    // (e.g. a fresh re-attempt with no prior saved progress). In that case
    // setAssessment(preview_response) above has already initialised the store as
    // a fresh attempt, so there is nothing to restore. Bail out instead of
    // dereferencing the missing payload, which would otherwise throw an
    // unhandled `can't access property "sections"` crash on the live-test page.
    const restoredSections: Section[] = formattedData?.sections ?? [];
    if (restoredSections.length === 0) {
      console.warn(
        "Missing learner_assessment_attempt_data_dto on restart; using default state from preview."
      );
      useAssessmentStore.setState({ entireTestTimer: restoredEntireTestTimer });
      await useAssessmentStore.getState().saveState();
      return;
    }

    useAssessmentStore.setState({
      assessment: preview_response,
      currentSection: 0,
      currentQuestion: preview_response.section_dtos[0].question_preview_dto_list[0],
      questionStates: Object.fromEntries(
        restoredSections.flatMap((section: Section) =>
          (section.questions ?? []).map((question: Question) => {
            const answered = responseHasAnswer(question.responseData);
            return [
              question.questionId,
              {
                // Derived from the decoded answer so it covers every question
                // type, not just MCQ. Also treat "has an answer" as visited: a
                // question the learner answered was obviously seen, and without
                // this the navigator paints it "Not Visited" (getQuestionStatus
                // checks isVisited before isAnswered) if that flag didn't persist.
                isAnswered: answered,
                isVisited: question.isVisited || answered,
                isMarkedForReview: question.isMarkedForReview,
                isDisabled: false, // Assuming default value
              },
            ];
          })
        )
      ),
      answers: Object.fromEntries(
        restoredSections.flatMap((section: Section) =>
          (section.questions ?? []).map((question: Question) => [
            question.questionId,
            decodeAnswer(question.responseData),
          ])
        )
      ),
      codingAnswers: Object.fromEntries(
        restoredSections.flatMap((section: Section) =>
          (section.questions ?? []).flatMap((question: Question) => {
            const coding = decodeCodingAnswer(question.responseData);
            return coding ? [[question.questionId, coding] as const] : [];
          })
        )
      ),
      sectionTimers: Object.fromEntries(
        restoredSections.map((section: Section) => [
          section.sectionId,
          { timeLeft: section.sectionDurationLeftInSeconds },
        ])
      ),
      questionTimers: Object.fromEntries(
        restoredSections.flatMap((section: Section) =>
          (section.questions ?? []).map((question: Question) => [
            question.questionId,
            question.questionDurationLeftInSeconds,
          ])
        )
      ),
      questionTimeSpent: Object.fromEntries(
        restoredSections.flatMap((section: Section) =>
          (section.questions ?? []).map((question: Question) => [
            question.questionId,
            question.timeTakenInSeconds,
          ])
        )
      ),
      entireTestTimer: restoredEntireTestTimer,
      // Default to 0: incrementTabSwitchCount does `count + 1`, so an
      // undefined count would turn into NaN and silently disable the
      // three-warning auto-submit.
      tabSwitchCount: Number(formattedData?.assessment?.tabSwitchCount) || 0,
      questionStartTime: {}, // Needs separate handling
    });
  
    // Save state to storage
    await useAssessmentStore.getState().saveState();
  };