package vacademy.io.assessment_service.features.submission_review.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.assessment_service.features.submission_review.dto.SubmissionReviewRequests;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Submission review, phase 1a (contract 5): one learner's submission, its marks, history
 * and release. Staff only; the attempt (or assessment) must belong to the clientId
 * institute. The path never contains "internal" (the default authenticated rule applies).
 */
@RestController
@RequestMapping("/assessment-service/assessment/submission-review/v1")
public class SubmissionReviewController {

    private final SubmissionReviewService service;
    private final EvaluationAccessValidator accessValidator;

    public SubmissionReviewController(SubmissionReviewService service, EvaluationAccessValidator accessValidator) {
        this.service = service;
        this.accessValidator = accessValidator;
    }

    private StudentAttempt attempt(CustomUserDetails user, String instituteId, String attemptId) {
        accessValidator.requireStaffRole(user);
        return accessValidator.requireAttemptAccess(user, instituteId, attemptId);
    }

    private Assessment assessment(CustomUserDetails user, String instituteId, String assessmentId) {
        accessValidator.requireStaffRole(user);
        accessValidator.requireAssessmentInInstitute(user, instituteId, assessmentId);
        return service.requireAssessment(assessmentId);
    }

    /** A1. */
    @GetMapping("/submissions/{attemptId}")
    public ResponseEntity<Map<String, Object>> outline(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId) {
        return ResponseEntity.ok(service.outline(user, attempt(user, instituteId, attemptId)));
    }

    /** A1d. */
    @GetMapping("/submissions/{attemptId}/questions/{sectionId}/{questionId}")
    public ResponseEntity<Map<String, Object>> question(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @PathVariable String sectionId, @PathVariable String questionId) {
        return ResponseEntity.ok(service.question(user, attempt(user, instituteId, attemptId), sectionId, questionId));
    }

    /** A2. */
    @GetMapping("/submissions/{attemptId}/history")
    public ResponseEntity<Map<String, Object>> history(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId,
            @RequestParam(value = "section_id", required = false) String sectionId,
            @RequestParam(value = "question_id", required = false) String questionId,
            @RequestParam(value = "limit", required = false, defaultValue = "100") int limit) {
        return ResponseEntity.ok(service.history(user, attempt(user, instituteId, attemptId), sectionId, questionId,
                limit));
    }

    /** A3. */
    @PatchMapping("/submissions/{attemptId}/questions/{sectionId}/{questionId}")
    public ResponseEntity<Map<String, Object>> edit(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @PathVariable String sectionId, @PathVariable String questionId,
            @RequestBody SubmissionReviewRequests.EditMarksRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        if (body == null || body.expectedRevision() == null || body.expectedRelease() == null) {
            throw badRequest("expected_revision and expected_release are required");
        }
        boolean notAnswered = Boolean.TRUE.equals(body.notAnswered());
        if (!notAnswered && body.marks() == null) throw badRequest("marks is required");
        MarkWriter.MarkChange change = new MarkWriter.MarkChange(attemptId, sectionId, questionId,
                MarkWriter.Writer.TEACHER, body.marks(), partMarks(body.partMarks()), body.feedback(), notAnswered,
                body.reason(), user.getUserId(), body.expectedRevision(), body.expectedRelease(),
                Boolean.TRUE.equals(body.notifyLearner()), body.annotationEdits(), null, null);
        return ResponseEntity.ok(service.editOne(user, attempt, change, Boolean.TRUE.equals(body.preview())));
    }

    /** A3b. */
    @PatchMapping("/submissions/{attemptId}/questions")
    public ResponseEntity<Map<String, Object>> quickMarks(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @RequestBody SubmissionReviewRequests.QuickMarksRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        if (body == null || body.items() == null || body.items().isEmpty() || body.expectedRelease() == null) {
            throw badRequest("items and expected_release are required");
        }
        List<MarkWriter.MarkChange> changes = new ArrayList<>();
        for (SubmissionReviewRequests.QuickMarksItem i : body.items()) {
            boolean notAnswered = Boolean.TRUE.equals(i.notAnswered());
            if (i.sectionId() == null || i.questionId() == null || (!notAnswered && i.marks() == null)) {
                throw badRequest("every item needs section_id, question_id and marks (or not_answered)");
            }
            changes.add(new MarkWriter.MarkChange(attemptId, i.sectionId(), i.questionId(), MarkWriter.Writer.TEACHER,
                    i.marks(), null, i.feedback(), notAnswered, body.reason(), user.getUserId(), i.expectedRevision(),
                    body.expectedRelease(), Boolean.TRUE.equals(body.notifyLearner()), null, null, null));
        }
        return ResponseEntity.ok(service.editMany(user, attempt, changes, new MarkWriter.BatchContext(body.reason(),
                body.expectedRelease(), Boolean.TRUE.equals(body.notifyLearner()), user.getUserId(),
                MarkWriter.Writer.TEACHER)));
    }

    /** A3p. */
    @PutMapping("/submissions/{attemptId}/questions/{sectionId}/{questionId}/pages")
    public ResponseEntity<Map<String, Object>> pages(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @PathVariable String sectionId, @PathVariable String questionId,
            @RequestBody SubmissionReviewRequests.AnswerPagesRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        return ResponseEntity.ok(service.setPages(user, attempt, sectionId, questionId,
                body == null ? null : body.answerPages()));
    }

    /** A4. */
    @PostMapping("/submissions/{attemptId}/accept-ai")
    public ResponseEntity<Map<String, Object>> acceptAi(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @RequestBody(required = false) SubmissionReviewRequests.AcceptAiRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        // The release token is checked under the attempt lock: a release between the
        // permission check and the write comes back as 409, never as an edit after release.
        if (body == null || body.expectedRelease() == null) throw badRequest("expected_release is required");
        return ResponseEntity.ok(service.acceptAi(user, attempt, body.questionKeys(), body.expectedRelease(),
                body.expectedRevisions()));
    }

    /** A6. */
    @PostMapping("/submissions/{attemptId}/questions/{sectionId}/{questionId}/reapply-key")
    public ResponseEntity<Map<String, Object>> reapplyKey(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @PathVariable String sectionId, @PathVariable String questionId,
            @RequestBody(required = false) SubmissionReviewRequests.ReapplyKeyRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        if (body == null || body.expectedRelease() == null) throw badRequest("expected_release is required");
        return ResponseEntity.ok(service.reapplyKey(user, attempt, sectionId, questionId,
                Boolean.TRUE.equals(body.force()), body.reason(), body.expectedRelease()));
    }

    /** A8: 200 when released, 202 when it will be released once marked. */
    @PostMapping("/submissions/{attemptId}/release")
    public ResponseEntity<Map<String, Object>> release(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @RequestBody(required = false) SubmissionReviewRequests.ReleaseRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        Map<String, Object> out = service.release(user, attempt, body == null || !Boolean.FALSE.equals(body.sendResult()),
                body != null && Boolean.TRUE.equals(body.allowUnmarked()),
                body != null && Boolean.TRUE.equals(body.releaseWhenMarked()),
                body == null ? null : body.expectedRelease());
        boolean released = Boolean.TRUE.equals(out.get("released"));
        return ResponseEntity.status(released ? HttpStatus.OK : HttpStatus.ACCEPTED).body(out);
    }

    /** A9. */
    @PostMapping("/submissions/{attemptId}/withdraw")
    public ResponseEntity<Map<String, Object>> withdraw(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId, @RequestBody(required = false) SubmissionReviewRequests.WithdrawRequest body) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        return ResponseEntity.ok(service.withdraw(user, attempt, body == null ? null : body.reason()));
    }

    /** A9b. */
    @PostMapping("/submissions/{attemptId}/send-update")
    public ResponseEntity<Map<String, Object>> sendUpdate(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String attemptId) {
        StudentAttempt attempt = attempt(user, instituteId, attemptId);
        return ResponseEntity.ok(service.sendUpdate(user, attempt));
    }

    /** A10. */
    @GetMapping("/assessments/{assessmentId}/marking-summary")
    public ResponseEntity<Map<String, Object>> markingSummary(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String assessmentId,
            @RequestParam(value = "attempt_ids", required = false) String attemptIds) {
        Assessment assessment = assessment(user, instituteId, assessmentId);
        List<String> ids = attemptIds == null || attemptIds.isBlank() ? List.of()
                : Arrays.stream(attemptIds.split(",")).map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
        return ResponseEntity.ok(service.markingSummary(user, assessment, ids));
    }

    /** A11. */
    @PostMapping("/assessments/{assessmentId}/release-check")
    public ResponseEntity<Map<String, Object>> releaseCheck(@RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String assessmentId,
            @RequestBody(required = false) SubmissionReviewRequests.ReleaseCheckRequest body) {
        Assessment assessment = assessment(user, instituteId, assessmentId);
        return ResponseEntity.ok(service.releaseCheck(user, assessment, instituteId,
                body == null ? null : body.attemptIds(), body != null && Boolean.TRUE.equals(body.all())));
    }

    private static List<MarkWriter.PartMark> partMarks(List<SubmissionReviewRequests.PartMarkDto> in) {
        if (in == null) return null;
        List<MarkWriter.PartMark> out = new ArrayList<>();
        for (SubmissionReviewRequests.PartMarkDto p : in) {
            if (p == null) continue;
            out.add(new MarkWriter.PartMark(p.criterion(), p.marks() == null ? 0.0 : p.marks(), p.max()));
        }
        return out;
    }

    private static SubmissionReviewException badRequest(String message) {
        return new SubmissionReviewException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
    }
}
