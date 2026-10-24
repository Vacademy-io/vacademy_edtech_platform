package vacademy.io.assessment_service.features.open_evaluation.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.OpenApiCaller;
import vacademy.io.assessment_service.features.open_evaluation.credits.OpenCreditsService;
import vacademy.io.assessment_service.features.open_evaluation.idempotency.IdempotencyService;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.upload.OpenUploadService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.List;
import java.util.Map;

/**
 * Uploads and credits of the partner API (docs/AI_EVALUATION_PUBLIC_API.md 7.5, 7.11).
 * Upload URLs are short-lived presigned PUTs to private storage; responses that carry them
 * are never cached.
 */
@RestController
@RequestMapping(OpenApiPaths.BASE)
@Tag(name = "Uploads and credits", description = "Presigned uploads for answer sheets; credit balance and quotes")
public class OpenUploadController {

    private final OpenUploadService uploads;
    private final OpenCreditsService credits;
    private final IdempotencyService idempotency;

    public OpenUploadController(OpenUploadService uploads, OpenCreditsService credits, IdempotencyService idempotency) {
        this.uploads = uploads;
        this.credits = credits;
        this.idempotency = idempotency;
    }

    @Operation(summary = "Presigned PUT URLs for one or up to 100 PDFs (valid 1 hour)")
    @PostMapping("/uploads")
    @PreAuthorize("@apiScopes.has('evaluation:write')")
    public ResponseEntity<?> create(@RequestBody SubmissionInputs.CreateUploads body,
            @RequestHeader(value = IdempotencyService.HEADER, required = false) String idemKey,
            HttpServletRequest request) {
        ApiKeyPrincipal key = OpenApiCaller.require();
        // The presigned PUT URLs are bearer credentials: never kept in the idempotency table.
        return idempotency.executeRedacted(key, idemKey, "POST", request.getRequestURI(), body,
                OpenUploadController::withoutUploadUrls, () -> {
                    List<Map<String, Object>> created = uploads.create(key, body);
                    return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                            .body(Map.of("uploads", created));
                });
    }

    /**
     * What a replay of POST /uploads returns: the uploads without their upload_url (spec 7.0:
     * a stored response never carries a secret). The caller requests new uploads, with a new
     * Idempotency-Key, when it no longer has the URLs.
     */
    static Object withoutUploadUrls(Object body) {
        if (!(body instanceof Map<?, ?> map) || !(map.get("uploads") instanceof List<?> rows)) {
            return body;
        }
        List<Map<String, Object>> redacted = new java.util.ArrayList<>();
        for (Object r : rows) {
            Map<String, Object> copy = new java.util.LinkedHashMap<>();
            if (r instanceof Map<?, ?> row) {
                row.forEach((k, v) -> copy.put(String.valueOf(k), v));
            }
            copy.remove("upload_url");
            copy.remove("headers");
            copy.put("upload_url_redacted", true);
            redacted.add(copy);
        }
        return Map.of("uploads", redacted);
    }

    @Operation(summary = "An upload; checked (size, type, page count) on the first read after the PUT")
    @GetMapping("/uploads/{uploadId}")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> get(@PathVariable String uploadId) {
        return uploads.get(OpenApiCaller.require(), uploadId);
    }

    @Operation(summary = "Credit balance, committed credits and this institute's API rate card")
    @GetMapping("/credits")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> credits() {
        return credits.credits(OpenApiCaller.require());
    }

    @Operation(summary = "Quote pages, uploads (exact page counts) or typed answers")
    @PostMapping("/credits/quote")
    @PreAuthorize("@apiScopes.has('evaluation:read')")
    public Map<String, Object> quote(@RequestBody SubmissionInputs.Quote body) {
        return credits.quote(OpenApiCaller.require(), body);
    }
}
