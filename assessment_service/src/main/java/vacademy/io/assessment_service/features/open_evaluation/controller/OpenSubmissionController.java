package vacademy.io.assessment_service.features.open_evaluation.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.OpenApiCaller;
import vacademy.io.assessment_service.features.open_evaluation.finalize.ApiFinalizeService;
import vacademy.io.assessment_service.features.open_evaluation.idempotency.IdempotencyService;
import vacademy.io.assessment_service.features.open_evaluation.result.CheckedCopyService;
import vacademy.io.assessment_service.features.open_evaluation.result.ResultRules;
import vacademy.io.assessment_service.features.open_evaluation.result.SubmissionResultService;
import vacademy.io.assessment_service.features.open_evaluation.review.OpenReviewService;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Submissions, results, review and finalize of the partner API
 * (docs/AI_EVALUATION_PUBLIC_API.md 7.6, 7.8, 7.9, 7.10). The tenant is always the calling
 * key's institute; ids of other institutes answer 404. Every POST takes an optional
 * {@code Idempotency-Key}.
 */
@RestController
@RequestMapping(OpenApiPaths.BASE)
@Tag(name = "Submissions", description = "Answer sheets and typed answers, results, review and finalize")
public class OpenSubmissionController {

    private final OpenSubmissionService submissions;
    private final SubmissionResultService results;
    private final CheckedCopyService checkedCopies;
    private final OpenReviewService review;
    private final ApiFinalizeService finalizer;
    private final IdempotencyService idempotency;

    public OpenSubmissionController(OpenSubmissionService submissions, SubmissionResultService results,
            CheckedCopyService checkedCopies, OpenReviewService review, ApiFinalizeService finalizer,
            IdempotencyService idempotency) {
        this.submissions = submissions;
        this.results = results;
        this.checkedCopies = checkedCopies;
        this.review = review;
        this.finalizer = finalizer;
        this.idempotency = idempotency;
    }

    // ------------------------------------------------------------------ create / read

    @Operation(summary = "Submit a handwritten copy (upload_id) or typed answers (answers[]) for a candidate")
    @PostMapping("/exams/{examId}/submissions")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> create(@PathVariable String examId, @RequestBody SubmissionInputs.CreateSubmission body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false,
                OpenSubmissionController::idOf, null, () -> {
                    OpenSubmissionService.Created created = submissions.create(key, examId, body);
                    Map<String, Object> view = new LinkedHashMap<>(submissions.get(key, created.submissionId()));
                    view.put("quote", created.quote());
                    view.put("warnings", created.warnings());
                    return ResponseEntity.status(HttpStatus.ACCEPTED).cacheControl(CacheControl.noStore()).body(view);
                });
    }

    static String idOf(ResponseEntity<?> response) {
        return response.getBody() instanceof Map<?, ?> m && m.get("id") != null ? String.valueOf(m.get("id")) : null;
    }

    @Operation(summary = "A submission's status (queue position and ETA while queued)")
    @GetMapping("/submissions/{submissionId}")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> get(@PathVariable String submissionId) {
        return submissions.get(OpenApiCaller.require(), submissionId);
    }

    @Operation(summary = "An exam's submissions; include=result for full results (limit capped at 50)")
    @GetMapping("/exams/{examId}/submissions")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Paging.Page<Map<String, Object>> listForExam(@PathVariable String examId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "needs_review", required = false) String needsReview,
            @RequestParam(value = "finalized", required = false) String finalized,
            @RequestParam(value = "candidate_id", required = false) String candidateId,
            @RequestParam(value = "updated_since", required = false) String updatedSince,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit,
            @RequestParam(value = "include", required = false) String include) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        boolean withResult = include != null && include.toLowerCase().contains("result");
        ResultRules.Include inc = ResultRules.Include.parse(include);
        return submissions.list(key, examId, status, needsReview, finalized, candidateId, updatedSince, cursor, limit,
                withResult ? v -> results.build(key, v, inc) : null);
    }

    @Operation(summary = "Feed of submissions across all exams, ordered by (updated_at, id); updated_since required")
    @GetMapping("/submissions")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Paging.Page<Map<String, Object>> feed(
            @RequestParam(value = "updated_since", required = false) String updatedSince,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "needs_review", required = false) String needsReview,
            @RequestParam(value = "finalized", required = false) String finalized,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return submissions.list(OpenApiCaller.require(), null, status, needsReview, finalized, null, updatedSince, cursor,
                limit, null);
    }

    // ------------------------------------------------------------------ re-evaluate / cancel / delete

    @Operation(summary = "Grade the copy again (charged again); keep_reviewed keeps teacher-edited questions")
    @PostMapping("/submissions/{submissionId}/re-evaluate")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> reevaluate(@PathVariable String submissionId,
            @RequestBody(required = false) SubmissionInputs.Reevaluate body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false,
                OpenSubmissionController::idOf, null, () -> {
                    submissions.reevaluate(key, submissionId, body);
                    return ResponseEntity.status(HttpStatus.ACCEPTED).body(submissions.get(key, submissionId));
                });
    }

    @Operation(summary = "Cancel a queued or running evaluation (not billed)")
    @PostMapping("/submissions/{submissionId}/cancel")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> cancel(@PathVariable String submissionId,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), null, false, r -> submissionId, null,
                () -> {
                    submissions.cancel(key, submissionId);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("id", submissionId);
                    out.put("status", "cancelled");
                    return ResponseEntity.ok(out);
                });
    }

    @Operation(summary = "Delete a submission that is not finalized (e.g. a wrong upload)")
    @DeleteMapping("/submissions/{submissionId}")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> delete(@PathVariable String submissionId) {
        submissions.delete(OpenApiCaller.require(), submissionId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", submissionId);
        out.put("deleted", true);
        return out;
    }

    // ------------------------------------------------------------------ results

    @Operation(summary = "Question-wise result; include=annotations,model_answer (extracted_answer on by default)")
    @GetMapping("/submissions/{submissionId}/result")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> result(@PathVariable String submissionId,
            @RequestParam(value = "include", required = false) String include) {
        return results.result(OpenApiCaller.require(), submissionId, include);
    }

    @Operation(summary = "Results of an exam, one per live submission (same shape as GET /submissions/{id}/result); "
            + "limit 1-50, default 20; format=csv is not available yet")
    @GetMapping("/exams/{examId}/results")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Paging.Page<Map<String, Object>> examResults(@PathVariable String examId,
            @RequestParam(value = "format", required = false) String format,
            @RequestParam(value = "finalized", required = false) String finalized,
            @RequestParam(value = "updated_since", required = false) String updatedSince,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit,
            @RequestParam(value = "include", required = false) String include) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        ResultRules.Include inc = ResultRules.Include.parse(include);
        return submissions.results(key, examId, format, finalized, updatedSince, cursor, limit,
                v -> results.build(key, v, inc));
    }

    @Operation(summary = "The checked (annotated) copy as PDF; redirect=true gives a private-CDN link when configured")
    @GetMapping("/submissions/{submissionId}/checked-copy")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public ResponseEntity<?> checkedCopy(@PathVariable String submissionId,
            @RequestParam(value = "redirect", required = false) Boolean redirect,
            @RequestParam(value = "expires_in", required = false) Integer expiresIn) {
        CheckedCopyService.CheckedCopy copy = checkedCopies.open(OpenApiCaller.require(), submissionId,
                Boolean.TRUE.equals(redirect), expiresIn);
        if (copy.redirectUrl() != null) {
            return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(copy.redirectUrl()))
                    .cacheControl(CacheControl.noStore()).build();
        }
        // Copied to the response on this thread (no async dispatch) and closed afterwards.
        InputStreamResource body = new InputStreamResource(copy.body());
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + copy.filename() + "\"")
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    // ------------------------------------------------------------------ review

    @Operation(summary = "Override one question's marks and feedback (0.5 steps)")
    @PatchMapping("/submissions/{submissionId}/questions/{questionId}")
    @PreAuthorize("@apiScopes.has('evaluation:review')")
    public Map<String, Object> overrideQuestion(@PathVariable String submissionId, @PathVariable String questionId,
            @RequestBody SubmissionInputs.ReviewQuestion body) {
        return review.overrideQuestion(OpenApiCaller.require(), submissionId, questionId, body);
    }

    @Operation(summary = "Approve the AI marks as reviewed, without changes")
    @PostMapping("/submissions/{submissionId}/approve")
    @PreAuthorize("@apiScopes.has('evaluation:review')")
    public ResponseEntity<?> approve(@PathVariable String submissionId,
            @RequestBody(required = false) SubmissionInputs.Approve body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false,
                OpenSubmissionController::idOf, null, () -> {
                    review.approve(key, submissionId, body);
                    return ResponseEntity.ok(submissions.get(key, submissionId));
                });
    }

    // ------------------------------------------------------------------ finalize

    @Operation(summary = "Finalize graded submissions (no emails, PDFs or workflow events)")
    @PostMapping("/exams/{examId}/finalize")
    @PreAuthorize("@apiScopes.has('evaluation:finalize')")
    public ResponseEntity<?> finalizeExam(@PathVariable String examId, @RequestBody SubmissionInputs.Finalize body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false, r -> examId, null,
                () -> ResponseEntity.ok(finalizer.finalizeExam(key, examId, body)));
    }

    @Operation(summary = "Put a finalized result back on hold (reason required, audited)")
    @PostMapping("/submissions/{submissionId}/unfinalize")
    @PreAuthorize("@apiScopes.has('evaluation:finalize')")
    public ResponseEntity<?> unfinalize(@PathVariable String submissionId,
            @RequestBody SubmissionInputs.Unfinalize body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false,
                OpenSubmissionController::idOf, null, () -> {
                    finalizer.unfinalize(key, submissionId, body);
                    return ResponseEntity.ok(submissions.get(key, submissionId));
                });
    }
}
