package vacademy.io.assessment_service.features.open_evaluation.controller;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.OpenApiCaller;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.idempotency.IdempotencyService;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Candidates of the partner API (spec 7.3). Partner ids ({@code external_id}, roll numbers,
 * names) travel in bodies only, never in paths or query strings (6.6).
 */
@RestController
@RequestMapping(OpenApiPaths.BASE)
@Tag(name = "Candidates", description = "Institute candidates and exam registration")
public class OpenCandidateController {

    private final ApiCandidateService candidates;
    private final IdempotencyService idempotency;

    public OpenCandidateController(ApiCandidateService candidates, IdempotencyService idempotency) {
        this.candidates = candidates;
        this.idempotency = idempotency;
    }

    /** {@code {"candidates":[…]}} or {@code {"candidate_ids":[…]}}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CandidatesBody {
        private List<ExamInputs.CandidateInput> candidates;
        private List<String> candidateIds;
    }

    /** {@code {"external_ids":[…]}}. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SearchBody {
        private List<String> externalIds;
    }

    @Operation(summary = "Upsert institute candidates by external_id")
    @PostMapping("/candidates")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> upsert(@RequestBody CandidatesBody body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false, r -> null, null,
                () -> ResponseEntity.ok(Map.of("candidates",
                        candidates.upsert(key, body == null ? null : body.getCandidates()))));
    }

    @Operation(summary = "Find candidates by external_id")
    @PostMapping("/candidates/search")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> search(@RequestBody SearchBody body) {
        return Map.of("data", candidates.search(OpenApiCaller.require(), body == null ? null : body.getExternalIds()));
    }

    @Operation(summary = "Get a candidate by Vacademy id")
    @GetMapping("/candidates/{candidateId}")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> get(@PathVariable String candidateId) {
        return candidates.get(OpenApiCaller.require(), candidateId);
    }

    @Operation(summary = "Register candidates on an exam (upserts them first when sent inline)")
    @PostMapping("/exams/{examId}/candidates")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> register(@PathVariable String examId, @RequestBody CandidatesBody body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        return idempotency.execute(key, idemKey, "POST", request.getRequestURI(), body, false, r -> examId, null, () -> {
            ApiCandidateService.Registration r = candidates.register(key, examId,
                    body == null ? null : body.getCandidates(), body == null ? null : body.getCandidateIds());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("registered", r.registered());
            out.put("already_registered", r.alreadyRegistered());
            out.put("candidates", r.candidates());
            return ResponseEntity.ok(out);
        });
    }

    @Operation(summary = "Candidates registered on an exam, with their latest submission")
    @GetMapping("/exams/{examId}/candidates")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Paging.Page<Map<String, Object>> listForExam(@PathVariable String examId,
            @RequestParam(value = "limit", required = false) Integer limit,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "updated_since", required = false) String updatedSince) {
        return candidates.listForExam(OpenApiCaller.require(), examId, limit, cursor, updatedSince);
    }

    @Operation(summary = "Unregister a candidate without a submission")
    @DeleteMapping("/exams/{examId}/candidates/{candidateId}")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public Map<String, Object> unregister(@PathVariable String examId, @PathVariable String candidateId) {
        candidates.unregister(OpenApiCaller.require(), examId, candidateId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("exam_id", examId);
        out.put("candidate_id", candidateId);
        out.put("registered", false);
        return out;
    }
}
