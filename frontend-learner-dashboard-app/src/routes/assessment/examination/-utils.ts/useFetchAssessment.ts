import { useAssessmentStore } from "@/stores/assessment-store";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { toast } from "sonner";
import i18next from "i18next";
import { getBackendErrorMessage } from "@/utils/error-message";
import {
  Assessment_List_Filter,
  ASSESSMENT_PREVIEW,
  START_ASSESSMENT,
} from "@/constants/urls";
import { Preferences } from "@capacitor/preferences";
import {
  Assessment,
  assessmentTypes,
  distribution_duration_types,
  SectionDto,
} from "@/types/assessment";
import { Storage } from "@capacitor/storage";
import { safeJsonParse } from "@/utils/safe-json-parse";
import {
  getAllSessionListFromStorage,
  getEnrolledBatchIds,
} from "@/services/studentDetails";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import {
  fetchLearnerAssessmentFolders,
  OTHERS_FOLDER_ID,
  type LearnerFolderList,
} from "@/services/assessment-folders";

export const getStoredDetails = async () => {
  const studentData = await Preferences.get({ key: "StudentDetails" });
  const instituteData = await Preferences.get({ key: "InstituteDetails" });

  const student = safeJsonParse(studentData.value);
  const institute = safeJsonParse(instituteData.value);

  return { student, institute };
};

const getStartAssessmentDetails = async () => {
  const InstructionID_and_AboutID = await Preferences.get({
    key: "InstructionID_and_AboutID",
  });
  const assessment_questions = await Preferences.get({
    key: "Assessment_questions",
  });

  const assessment = InstructionID_and_AboutID.value
    ? JSON.parse(InstructionID_and_AboutID.value)
    : null;
  const questions = assessment_questions.value
    ? JSON.parse(assessment_questions.value)
    : null;

  return {
    assessment_id: assessment.assessment_id,
    user_id: questions.assessment_user_registration_id,
    attempt_id: questions.attempt_id,
  };
};

export const getDuration = async (): Promise<{
  can_switch_section: boolean;
  duration: number;
  distribution_duration: distribution_duration_types;
}> => {
  const InstructionID_and_AboutID = await Preferences.get({
    key: "InstructionID_and_AboutID",
  });

  const assessment = InstructionID_and_AboutID.value
    ? JSON.parse(InstructionID_and_AboutID.value)
    : null;

  return {
    can_switch_section: assessment?.can_switch_section || false,
    duration: assessment?.duration || 1,
    // The list API returns this field as `distribution_duration`, but the
    // assessment-detail / public-registration API returns it as
    // `duration_distribution`. Read both spellings so the live test uses the
    // real mode. Default to ASSESSMENT (one overall timer) — never QUESTION —
    // so a missing field can't spin up a 0-length per-question timer that
    // auto-advances every question.
    distribution_duration:
      assessment?.distribution_duration ||
      assessment?.duration_distribution ||
      "ASSESSMENT",
  };
};

export const fetchAssessmentData = async (
  pageNo: number,
  pageSize: number,
  assessmentType: assessmentTypes,
  assessment_types: string,
  /** Assessment folder id, or OTHERS_FOLDER_ID for tests in no folder. */
  folderId?: string
) => {
  try {
    const { student, institute } = await getStoredDetails();
    if (!student || !institute) {
      toast.error(i18next.t("assessment:util.toast.missingDetails"));
      return;
    }
    // Source batch_ids from a LIVE /details fetch (every enrolled batch) instead
    // of the cached `sessionList`, which collapses to a single primary batch for
    // multi-batch learners and hides assessments on their other batches.
    const batchIds = await getEnrolledBatchIds(institute.id, student.user_id);

    const requestBody = {
      name: "",
      batch_ids: batchIds?.length > 0 ? batchIds : [student.package_session_id],
      user_ids: [student.user_id],
      tag_ids: [],
      assessment_types: [assessment_types],
      get_live_assessments: assessmentType === assessmentTypes.LIVE,
      get_passed_assessments: assessmentType === assessmentTypes.PAST,
      get_upcoming_assessments: assessmentType === assessmentTypes.UPCOMING,
      institute_ids: [institute.id],
      sort_columns: {},
      ...(folderId === OTHERS_FOLDER_ID
        ? { unfiled_only: true }
        : folderId
          ? { folder_id: folderId }
          : {}),
    };

    const response = await authenticatedAxiosInstance.post(
      `${Assessment_List_Filter}`,
      requestBody,
      {
        params: {
          pageNo: pageNo,
          pageSize: pageSize,
          instituteId: institute.id,
        },
      }
    );
    return response.data;
  } catch (error) {
    // Re-throw so callers' try/catch can react instead of receiving an
    // implicit `undefined` and dereferencing `.content` on it.
    console.error("Error fetching assessments:", error);
    throw error;
  } finally {
    // setLoading(false);
  }
};

/** The folders this learner has tests in, scoped exactly like the assessment list. */
export const fetchAssessmentFolderList = async (
  assessment_types: string
): Promise<LearnerFolderList | null> => {
  const { student, institute } = await getStoredDetails();
  if (!student || !institute) return null;
  const batchIds = await getEnrolledBatchIds(institute.id, student.user_id);
  return fetchLearnerAssessmentFolders({
    instituteId: institute.id,
    batchIds:
      batchIds?.length > 0 ? batchIds : [student.package_session_id].filter(Boolean),
    userIds: [student.user_id],
    assessmentTypes: [assessment_types],
  });
};

export const storeAssessmentInfo = async (assessmentInfo: any) => {
  await Storage.set({
    key: "InstructionID_and_AboutID",
    value: JSON.stringify(assessmentInfo),
  });
};

// Resolve a full assessment record by id from the learner's own lists.
// Used as a fallback when the InstructionID_and_AboutID storage key is absent
// (direct/public link, or the InstructionPage read winning the race against the
// navigation source's write) so the exam flow can self-heal instead of crashing.
export const resolveAssessmentById = async (
  id: string
): Promise<Assessment | undefined> => {
  const tabs = [
    assessmentTypes.LIVE,
    assessmentTypes.UPCOMING,
    assessmentTypes.PAST,
  ];

  for (const tab of tabs) {
    const response = await fetchAssessmentData(0, 100, tab, "ASSESSMENT");
    const assessments = response?.content ?? [];
    const matchedAssessment = assessments.find(
      (assessment: Assessment) => assessment.assessment_id === id
    );

    if (matchedAssessment) {
      return matchedAssessment;
    }
  }

  return undefined;
};

export const fetchPreviewData = async (
  assessment_id: string,
  batch_id?: string
) => {
  try {
    const { student, institute } = await getStoredDetails();
    if (!student || !institute) {
      toast.error(i18next.t("assessment:util.toast.missingDetails"));
      return;
    }

    const getStudentDetails = async () => {
      const storedData = await Storage.get({ key: "StudentDetails" });
      if (storedData.value) {
        try {
          return JSON.parse(storedData.value);
        } catch (error) {
          console.error("Error parsing student details:", error);
        }
      }
    };

    const getInstituteId = async () => {
      const institute_id_value = await Storage.get({ key: "InstituteId" });
      return institute_id_value.value || null;
    };

    const institute_id = await getInstituteId();
    const student_details = await getStudentDetails();

    if (!student_details) {
      toast.error(i18next.t("assessment:util.toast.studentDetailsNotFound"));
      return;
    }

    // Send EVERY enrolled batch — the SAME source the assessment LIST uses
    // (getEnrolledBatchIds: a live /details fetch of all enrollments) — so any
    // assessment visible in the list can also be started. Previously we sent a
    // single batch_id, which broke multi-batch learners: when the assessment
    // was registered to a batch other than the one passed, the backend matched
    // nothing and threw "Assessment batch not found", even though the list
    // (which queries all enrolled batches) showed the assessment.
    const enrolledBatchIds = await getEnrolledBatchIds(
      institute.id,
      student.user_id
    );

    // Cached session list as an extra fallback for offline/transient cases.
    const sessions = await getAllSessionListFromStorage();
    const cachedBatchIds = sessions?.map((session) => session.id) || [];

    // Union the explicit hint + all enrolled batches + fallbacks, drop
    // null/undefined, and dedupe. This list may legitimately be EMPTY for
    // PUBLIC / open-registration participants, who are never enrolled in a
    // batch. Do NOT hard-block on an empty list: batch_ids is optional
    // server-side, and the backend resolves an already-registered participant
    // by (assessment_id + user_id). Registration is still mandatory — if the
    // user has not registered, the backend rejects the start, and we surface
    // that precise reason in the catch block below.
    let resolvedBatchIds: string[] = Array.from(
      new Set(
        [
          ...(batch_id ? [batch_id] : []),
          ...enrolledBatchIds,
          ...cachedBatchIds,
          student_details.package_session_id,
        ].filter((id): id is string => Boolean(id))
      )
    );

    // Last-resort fallback for slide-linked assessments: when the caller passed
    // no batch_id, the learner has no enrolled batch in storage, and there's no
    // default package_session_id (common for open/public or root-user
    // contexts), fall back to the package_session_id of the course currently
    // being viewed in the study library. Without this the start-preview call
    // sends an empty batch_ids and the backend rejects it with
    // "batch id not found". Only runs when the list is otherwise empty, so it
    // never changes behaviour for flows that already resolve a batch.
    if (resolvedBatchIds.length === 0) {
      const slideBatchId = useContentStore.getState().currentPackageSessionId;
      if (slideBatchId) resolvedBatchIds = [slideBatchId];
    }

    const requestBody = {
      username: student_details.username,
      user_id: student_details.user_id,
      email: student_details.email,
      full_name: student_details.full_name,
      mobile_number: student_details.mobile_number,
      file_id: null,
      guardian_email: student_details.parents_email,
      guardian_mobile_number: student_details.parents_mobile_number,
      reattempt_count: 3,
      batch_ids: resolvedBatchIds,
      institute_id: institute_id,
      assessment_id: assessment_id,
    };

    const response = await authenticatedAxiosInstance.post(
      `${ASSESSMENT_PREVIEW}`,
      requestBody,
      {
        params: {
          batch_ids: resolvedBatchIds.join(","),
          instituteId: institute_id,
          assessment_id: assessment_id,
        },
      }
    );

    const durationData = await getDuration();
    if (response.status === 200) {
      // Clone response data to avoid direct mutation
      const responseData = { ...response.data, ...durationData };

      // Iterate over sections to check for randomization
      responseData.section_dtos = responseData.section_dtos.map(
        (section: SectionDto) => {
          if (
            section.problem_randomization === "RANDOM" &&
            Array.isArray(section.question_preview_dto_list)
          ) {
            section.question_preview_dto_list = shuffleArray(
              section.question_preview_dto_list
            );
          }
          // Assign serial question numbers
          section.question_preview_dto_list =
            section.question_preview_dto_list.map((question, index) => ({
              ...question,
              serial_number: index + 1,
            }));
          return section;
        }
      );

      // Save to local storage
      await Storage.set({
        key: "Assessment_questions",
        value: JSON.stringify(responseData),
      });

      // Update the state. This path sets `assessment` directly instead of going
      // through the `setAssessment` reducer, so `entireTestTimer` would stay at
      // its default 0 and the live-test timer would read "00:00 / time's up"
      // from the start. Derive the timer from the merged duration here too, but
      // never clobber an already-running timer (>0) for this attempt.
      const durationMinutes = Number(responseData.duration);
      useAssessmentStore.setState((state) => ({
        ...state,
        assessment: responseData,
        entireTestTimer:
          state.entireTestTimer > 0
            ? state.entireTestTimer
            : Number.isFinite(durationMinutes) && durationMinutes > 0
              ? durationMinutes * 60
              : state.entireTestTimer,
      }));
    }

    return response.data;
    // if (response.status === 200) {
    //   // Save to local storage
    //   await Storage.set({
    //     key: "Assessment_questions",
    //     value: JSON.stringify({ ...response.data, ...durationData }),
    //   });

    //   useAssessmentStore.setState((state) => ({
    //     ...state,
    //     assessment: { ...response.data, ...durationData },
    //   }));
    // }

    // return response.data;
  } catch (error) {
    console.error("Error fetching assessments:", error);
    // Surface the backend's actual reason (e.g. not registered for this
    // assessment, assessment not yet started, attempt already live) instead of
    // failing silently. VacademyException is serialized as ErrorInfo.ex.
    toast.error(
      getBackendErrorMessage(
        error,
        i18next.t("assessment:util.toast.startFailed")
      )
    );
  }
};

export const startAssessment = async () => {
  try {
    const { assessment_id, user_id, attempt_id } =
      await getStartAssessmentDetails();

    const requestBody = {
      assessment_id: assessment_id,
      user_registration_id: user_id,
      attempt_id: attempt_id,
    };

    const response = await authenticatedAxiosInstance.post(
      `${START_ASSESSMENT}`,
      requestBody
    );
    if (response.status === 200) {
      await Storage.set({
        key: "server_start_end_time",
        value: JSON.stringify(response.data),
      });
      return response.data;
    }
  } catch (error) {
    console.error("Error fetching assessments:", error);
    // toast.error("Failed to fetch assessments.");
  } finally {
    // setLoading(false);
  }
};

// Utility function to shuffle an array (Fisher-Yates algorithm)
function shuffleArray(array: any[]) {
  const shuffledArray = [...array];
  for (let i = shuffledArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
  }
  return shuffledArray;
}

// export const updateAssessmentAccordingToApiResponse = async (
//   UpdateApiResponse: UpdateApiResponse
// ) => {
//   const Assessment_question = await Preferences.get({
//     key: "Assessment_questions",
//   });
//   const assessment = Assessment_question.value
//     ? JSON.parse(Assessment_question.value)
//     : null;
// };
