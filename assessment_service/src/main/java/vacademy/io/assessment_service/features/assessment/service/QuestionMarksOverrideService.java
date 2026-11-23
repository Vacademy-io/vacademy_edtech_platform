package vacademy.io.assessment_service.features.assessment.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.QuestionMarksOverrideRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.submission_review.model.MarksSource;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * PUT /assessment-service/admin/participants/question-marks (PR #3814): staff set the marks
 * of one question of one submitted attempt. Kept for its callers; since the Phase 1a merge
 * it is a thin adapter over the one mark write path ({@link MarkWriter}, writer
 * {@code QUESTION_MARKS_PUT}), so a change made here gets the attempt and row locks, the
 * mark_event history, the marks_revision bump ("Released, changed" / the learner's Revised
 * tag / "Send updated result") and the AI verdict mirror, exactly as the Submission page.
 *
 * <p>Request and response keep their shape. What the old endpoint decided itself now
 * follows MarkWriter (contract deviations "reconcile with PR #3814"):
 * <ul>
 *   <li>the mark is stored as MANUAL (the old TEACHER value is still read as MANUAL);</li>
 *   <li>marks are clamped into the question's range (min = minus the negative marks of an
 *   objective question, else 0; max = marking JSON total, else the section's marks per
 *   question);</li>
 *   <li>an answer an AI run is still checking is refused (409); one a person already
 *   marked is not, because the AI never overwrites it;</li>
 *   <li>after release: an evaluator-only user is refused (as on the Submission page); for
 *   everyone else the change is recorded with the request's {@code reason}, or a default
 *   one when the caller sends none, and the learner is not emailed unless
 *   {@code notify_learner} is true;</li>
 *   <li>no evaluation_logs MARKS_OVERRIDE row any more: mark_event is the history.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class QuestionMarksOverrideService {

    /** Reason recorded for a change after release when the caller gives none. */
    static final String DEFAULT_REASON_AFTER_RELEASE = "Changed with the question marks endpoint (no reason given)";

    private final StudentAttemptRepository studentAttemptRepository;
    private final MarkWriter markWriter;
    private final SubmissionReviewAccess access;
    private final SubmissionReviewStore store;

    public Map<String, Object> override(CustomUserDetails user, String assessmentId, String attemptId,
                                        QuestionMarksOverrideRequest request) {
        if (request == null || isBlank(request.getSectionId()) || isBlank(request.getQuestionId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Question and section are required");
        }
        Double marks = request.getMarks();
        if (marks == null || marks.isNaN() || marks.isInfinite()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Enter the marks for this question");
        }

        StudentAttempt attempt = studentAttemptRepository.findById(attemptId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Attempt not found"));
        Assessment assessment = attempt.getRegistration() != null ? attempt.getRegistration().getAssessment() : null;
        if (assessment == null || !Objects.equals(assessment.getId(), assessmentId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Attempt not found in this assessment");
        }
        SubmissionReviewStore.AttemptState state = store.attempt(attemptId);
        boolean released = state != null && state.released();
        try {
            access.requireEdit(user, attempt, released);
        } catch (SubmissionReviewException e) {
            throw new VacademyException(e.getStatus(), e.getMessage());
        }

        String reason = isBlank(request.getReason()) ? (released ? DEFAULT_REASON_AFTER_RELEASE : null)
                : request.getReason().trim();
        // Old contract: null keeps the remark, blank clears it. MarkWriter: "" clears.
        String feedback = request.getFeedback() == null ? null
                : request.getFeedback().isBlank() ? "" : request.getFeedback();
        MarkWriter.MarkChange change = new MarkWriter.MarkChange(attemptId, request.getSectionId(),
                request.getQuestionId(), MarkWriter.Writer.QUESTION_MARKS_PUT, marks, null, feedback, false, reason,
                user.getUserId(), request.getExpectedRevision(), request.getExpectedRelease(),
                Boolean.TRUE.equals(request.getNotifyLearner()), null, null, null);

        MarkWriter.MarkResult result;
        try {
            result = markWriter.apply(change);
        } catch (SubmissionReviewException e) {
            // This controller has no {code, message} error body; keep the old one.
            throw new VacademyException(e.getStatus(), e.getMessage());
        }

        MarkWriter.RowResult row = result.rows().isEmpty() ? null : result.rows().get(0);
        SubmissionSnapshots.KeyState key = result.after() == null ? null
                : result.after().find(request.getSectionId(), request.getQuestionId());
        Double stored = result.attemptBefore() == null ? null : result.attemptBefore().totalMarks();
        log.info("[marks-override] attempt {} question {} section {}: {} -> {} by {} (changed {})", attemptId,
                request.getQuestionId(), request.getSectionId(), row == null ? null : row.oldMarks(),
                row == null ? null : row.newMarks(), user.getUserId(), result.changed());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("question_id", request.getQuestionId());
        out.put("section_id", request.getSectionId());
        out.put("marks", row == null ? null : row.newMarks());
        out.put("max_marks", key == null ? null : key.max());
        out.put("marks_source", row == null ? null : MarksSource.canonical(row.newSource()));
        out.put("attempt_total_marks", result.changed() > 0 ? result.totalAfter() : stored);
        return out;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
