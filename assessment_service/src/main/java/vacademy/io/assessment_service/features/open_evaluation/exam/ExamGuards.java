package vacademy.io.assessment_service.features.open_evaluation.exam;

import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;

import java.util.Map;
import java.util.Optional;

/** Lookups and state checks shared by the exam, question, candidate and rubric services. */
public final class ExamGuards {

    private ExamGuards() {
    }

    /** The exam of this institute, or 404 {@code exam_not_found} (also for deleted exams). */
    public static ApiExamStore.ApiExamRow requireLive(ApiExamStore store, String instituteId, String examId,
            boolean lock) {
        Optional<ApiExamStore.ApiExamRow> row = lock ? store.findForUpdate(instituteId, examId)
                : store.find(instituteId, examId);
        if (row.isEmpty() || row.get().isDeleted()) {
            throw examNotFound();
        }
        return row.get();
    }

    public static OpenApiException examNotFound() {
        return OpenApiException.notFound(ApiErrorCode.EXAM_NOT_FOUND, "No exam with this id.");
    }

    public static OpenApiException questionNotFound() {
        return OpenApiException.notFound(ApiErrorCode.QUESTION_NOT_FOUND, "No question with this id in this exam.");
    }

    /** 409 {@code exam_finalized} once the exam is finalized. */
    public static void requireNotFinalized(ApiExamStore.ApiExamRow exam) {
        if (exam.isFinalized()) {
            throw OpenApiException.conflict(ApiErrorCode.EXAM_FINALIZED,
                    "The exam is finalized; unfinalize its submissions before changing it.",
                    Map.of("exam_id", exam.assessmentId()));
        }
    }

    /** 409 {@code exam_open} unless the exam is still a draft (questions cannot be added or removed after open). */
    public static void requireDraft(ApiExamStore.ApiExamRow exam, String what) {
        requireNotFinalized(exam);
        if (!exam.isDraft()) {
            throw OpenApiException.conflict(ApiErrorCode.EXAM_OPEN,
                    "The exam is open; " + what + " is only possible while it is a draft.",
                    Map.of("exam_id", exam.assessmentId()));
        }
    }
}
