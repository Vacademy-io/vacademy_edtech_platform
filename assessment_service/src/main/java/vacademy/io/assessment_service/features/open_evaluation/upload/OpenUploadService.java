package vacademy.io.assessment_service.features.open_evaluation.upload;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.client.EvalApiStorageClient;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiErrors;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.ratelimit.ApiRateLimiter;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Uploads (spec 7.5, T1.23). A partner asks for presigned PUTs (media C3, private
 * {@code eval-api/{institute}/} prefix, bound to content type and length), PUTs the files
 * itself, then a submission names the upload. The upload row is the proof that the file is
 * the institute's own (gate G12).
 *
 * <p>Validation happens on the first read after the PUT and again on submission: HEAD the
 * object (C3), then ask ai_service for the page count ({@code /copy-check/inspect}, C4) —
 * PDF parsing never runs in this service. The outcome is {@code ready} with {@code pages}, or
 * {@code rejected} with {@code file_too_large}, {@code not_a_pdf}, {@code too_many_pages},
 * {@code missing_object} or {@code unparseable}. A check that cannot be made (media or
 * ai_service down) is 503 {@code engine_unavailable} and changes nothing.
 *
 * <p>v1 takes PDFs only: photo answers ({@code images[]}) are Phase 2 and nothing could use
 * an image upload yet, so image types are refused with {@code feature_not_available}.
 */
@Slf4j
@Service
public class OpenUploadService {

    public static final int MAX_FILES = 100;
    public static final long MAX_PDF_BYTES = 50L * 1024 * 1024;
    public static final String PDF = "application/pdf";
    public static final java.util.Set<String> IMAGE_TYPES = java.util.Set.of("image/jpeg", "image/png", "image/heic");
    public static final int MAX_FILENAME = 255;
    /** media signs the PUT for one hour. */
    public static final long UPLOAD_URL_SECONDS = 3600;
    /** Signed GET handed to ai_service for the inspect read. */
    static final int INSPECT_URL_SECONDS = 300;
    /** ai_service's inspect cap; a longer PDF is rejected outright. */
    public static final int INSPECT_MAX_PAGES = 200;

    public static final String REJECT_FILE_TOO_LARGE = "file_too_large";
    public static final String REJECT_NOT_A_PDF = "not_a_pdf";
    public static final String REJECT_TOO_MANY_PAGES = "too_many_pages";
    public static final String REJECT_MISSING_OBJECT = "missing_object";
    public static final String REJECT_UNPARSEABLE = "unparseable";

    static final String EVAL_API_SOURCE = "AI_EVAL_API";
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");

    private final EvalApiUploadStore store;
    private final EvalApiStorageClient storage;
    private final AiServiceCopyCheckClient copyCheck;
    private final ApiRateLimiter rateLimiter;
    private Clock clock = Clock.systemUTC();

    public OpenUploadService(EvalApiUploadStore store, EvalApiStorageClient storage, AiServiceCopyCheckClient copyCheck,
            ApiRateLimiter rateLimiter) {
        this.store = store;
        this.storage = storage;
        this.copyCheck = copyCheck;
        this.rateLimiter = rateLimiter;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ------------------------------------------------------------------ POST /uploads

    /**
     * Presigns every file first and records them only when all were presigned, so a media
     * failure halfway leaves no half-created batch behind.
     */
    public List<Map<String, Object>> create(ApiKeyPrincipal key, SubmissionInputs.CreateUploads body) {
        List<SubmissionInputs.UploadFile> files = normalise(body);
        validate(files);
        if (rateLimiter != null) {
            ApiRateLimiter.Decision decision = rateLimiter.acquire(key, ApiRateLimiter.Kind.UPLOAD, files.size());
            if (!decision.allowed()) {
                throw new OpenApiException(HttpStatus.TOO_MANY_REQUESTS, ApiErrorCode.RATE_LIMITED,
                        "Too many files presigned for this API key or institute. Retry after "
                                + decision.retryAfterSeconds() + " s.",
                        Map.of("retry_after_seconds", decision.retryAfterSeconds()),
                        Map.of("Retry-After", String.valueOf(decision.retryAfterSeconds())));
            }
        }
        List<EvalApiStorageClient.PresignedUpload> presigned = new ArrayList<>();
        for (SubmissionInputs.UploadFile f : files) {
            try {
                presigned.add(storage.presignUpload(key.getInstituteId(), f.getFilename().trim(),
                        f.getContentType().trim().toLowerCase(Locale.ROOT), f.getSizeBytes()));
            } catch (EvalApiStorageClient.Refused refused) {
                throw OpenApiException.validation("files[" + presigned.size() + "]",
                        refused.getCode() == null ? "invalid" : refused.getCode(),
                        "The file was refused by storage" + (refused.getMessage() == null ? "." : ": " + refused.getMessage()));
            } catch (EvalApiStorageClient.NotFound | EvalApiStorageClient.Unavailable e) {
                throw OpenApiErrors.engineUnavailable(30);
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            SubmissionInputs.UploadFile f = files.get(i);
            EvalApiStorageClient.PresignedUpload p = presigned.get(i);
            String id = UUID.randomUUID().toString();
            Instant expires = parseInstant(p.expiresAt(), clock.instant().plusSeconds(UPLOAD_URL_SECONDS));
            store.insert(id, key.getInstituteId(), key.getKeyId(), p.fileId(), f.getFilename().trim(),
                    f.getContentType().trim().toLowerCase(Locale.ROOT), f.getSizeBytes(), sha(f.getSha256()), expires);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", id);
            row.put("filename", f.getFilename().trim());
            row.put("upload_url", p.uploadUrl());
            row.put("method", p.method() == null ? "PUT" : p.method());
            row.put("headers", p.headers());
            row.put("expires_at", expires.toString());
            row.put("status", EvalApiUploadStore.STATUS_PENDING);
            out.add(row);
        }
        return out;
    }

    static List<SubmissionInputs.UploadFile> normalise(SubmissionInputs.CreateUploads body) {
        if (body == null) {
            throw OpenApiException.validation("files", "required", "Send one file or up to " + MAX_FILES + " in files[].");
        }
        boolean single = body.getFilename() != null || body.getContentType() != null || body.getSizeBytes() != null;
        boolean many = body.getFiles() != null;
        if (single == many) {
            throw OpenApiException.validation("files", "required",
                    "Send either one file (filename, content_type, size_bytes) or files[], not both.");
        }
        return many ? body.getFiles()
                : List.of(new SubmissionInputs.UploadFile(body.getFilename(), body.getContentType(), body.getSizeBytes(),
                        body.getSha256()));
    }

    static void validate(List<SubmissionInputs.UploadFile> files) {
        if (files.isEmpty() || files.size() > MAX_FILES) {
            throw OpenApiException.validation("files", "out_of_range", "Send 1 to " + MAX_FILES + " files.");
        }
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        boolean images = false;
        for (int i = 0; i < files.size(); i++) {
            SubmissionInputs.UploadFile f = files.get(i);
            String p = "files[" + i + "]";
            if (f == null) {
                errors.add(new OpenApiException.FieldError(p, "required", "File entry is empty."));
                continue;
            }
            String name = f.getFilename() == null ? "" : f.getFilename().trim();
            if (name.isEmpty()) {
                errors.add(new OpenApiException.FieldError(p + ".filename", "required", "filename is required."));
            } else if (name.length() > MAX_FILENAME || name.chars().anyMatch(c -> c < 0x20 || c == 0x7F)) {
                errors.add(new OpenApiException.FieldError(p + ".filename", "invalid",
                        "filename must be at most " + MAX_FILENAME + " printable characters."));
            }
            String type = f.getContentType() == null ? "" : f.getContentType().trim().toLowerCase(Locale.ROOT);
            if (IMAGE_TYPES.contains(type)) {
                images = true;
            } else if (!PDF.equals(type)) {
                errors.add(new OpenApiException.FieldError(p + ".content_type", "unsupported",
                        "content_type must be application/pdf."));
            }
            if (f.getSizeBytes() == null || f.getSizeBytes() < 1) {
                errors.add(new OpenApiException.FieldError(p + ".size_bytes", "required",
                        "size_bytes is required (the exact file size)."));
            } else if (PDF.equals(type) && f.getSizeBytes() > MAX_PDF_BYTES) {
                errors.add(new OpenApiException.FieldError(p + ".size_bytes", REJECT_FILE_TOO_LARGE,
                        "A PDF may be at most 50 MB."));
            }
            if (f.getSha256() != null && !f.getSha256().isBlank()
                    && !SHA256.matcher(f.getSha256().trim().toLowerCase(Locale.ROOT)).matches()) {
                errors.add(new OpenApiException.FieldError(p + ".sha256", "invalid",
                        "sha256 must be 64 hexadecimal characters."));
            }
        }
        if (images) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.FEATURE_NOT_AVAILABLE,
                    "Image uploads (phone photos) are not available yet; upload one PDF per answer sheet.");
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
    }

    // ------------------------------------------------------------------ GET /uploads/{id}

    /** The upload; a pending one is checked first (HEAD + page count). */
    public Map<String, Object> get(ApiKeyPrincipal key, String uploadId) {
        EvalApiUploadStore.UploadRow row = require(key, uploadId);
        if (row.isPending()) {
            row = check(row);
        }
        return view(row);
    }

    /**
     * The upload a submission is about to use (spec 7.6 step 2): ready, unconsumed and
     * checked after its presigned PUT stopped working (an earlier check is redone, because
     * the object could have been overwritten). Call outside the accept transaction; the
     * transaction re-reads the row under a lock.
     */
    public EvalApiUploadStore.UploadRow requireUsable(ApiKeyPrincipal key, String uploadId) {
        EvalApiUploadStore.UploadRow row = require(key, uploadId);
        refuseUnusable(row);
        if (row.isPending() || row.needsRecheck()) {
            row = check(row);
        }
        refuseUnusable(row);
        if (row.isPending()) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.UPLOAD_REJECTED,
                    "The file has not been uploaded yet: PUT it to upload_url first.",
                    Map.of("upload_id", row.id(), "reason", "not_uploaded"));
        }
        return row;
    }

    /** 422 upload_rejected / 409 upload_already_used for a row that cannot be used. */
    public static void refuseUnusable(EvalApiUploadStore.UploadRow row) {
        if (row.isConsumed()) {
            throw OpenApiException.conflict(ApiErrorCode.UPLOAD_ALREADY_USED,
                    "This upload is already used by another submission; upload the file again.",
                    Map.of("upload_id", row.id(), "submission_id", row.consumedBySubmissionId()));
        }
        if (row.isRejected()) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("upload_id", row.id());
            details.put("reason", row.rejectReason());
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.UPLOAD_REJECTED,
                    "The upload was rejected (" + row.rejectReason() + ").", details);
        }
    }

    public EvalApiUploadStore.UploadRow require(ApiKeyPrincipal key, String uploadId) {
        return store.find(key.getInstituteId(), uploadId).orElseThrow(OpenUploadService::uploadNotFound);
    }

    public static OpenApiException uploadNotFound() {
        return OpenApiException.notFound(ApiErrorCode.UPLOAD_NOT_FOUND, "No upload with this id.");
    }

    /**
     * HEAD the object, then read its page count. Returns the row as stored afterwards; a
     * missing object whose PUT URL still works stays pending.
     */
    EvalApiUploadStore.UploadRow check(EvalApiUploadStore.UploadRow row) {
        Outcome outcome = inspect(row);
        if (outcome.rejectReason() != null) {
            store.markRejected(row.id(), outcome.rejectReason());
            log.info("[open-api] upload {} rejected: {}", row.id(), outcome.rejectReason());
        } else if (outcome.pages() != null) {
            store.markReady(row.id(), outcome.pages(), outcome.sizeBytes());
        }
        return store.find(row.instituteId(), row.id()).orElse(row);
    }

    /** What a check found: pages (ready), a reject reason, or neither (still pending). */
    record Outcome(Integer pages, Long sizeBytes, String rejectReason) {
        static Outcome pending() {
            return new Outcome(null, null, null);
        }

        static Outcome rejected(String reason) {
            return new Outcome(null, null, reason);
        }
    }

    Outcome inspect(EvalApiUploadStore.UploadRow row) {
        EvalApiStorageClient.FileHead head;
        try {
            head = storage.head(row.fileId());
        } catch (EvalApiStorageClient.NotFound e) {
            return Outcome.rejected(REJECT_MISSING_OBJECT);
        } catch (EvalApiStorageClient.Refused | EvalApiStorageClient.Unavailable e) {
            throw OpenApiErrors.engineUnavailable(30);
        }
        // Never accept a file recorded for anyone else (it cannot happen through this API).
        if (!EVAL_API_SOURCE.equals(head.source()) || !row.instituteId().equals(head.sourceId())) {
            log.error("[open-api] upload {} points at a file not recorded for its institute", row.id());
            return Outcome.rejected(REJECT_MISSING_OBJECT);
        }
        if (!head.exists()) {
            Instant expires = row.uploadExpiresAt() != null ? row.uploadExpiresAt()
                    : row.createdAt() == null ? clock.instant() : row.createdAt().plusSeconds(UPLOAD_URL_SECONDS);
            return clock.instant().isAfter(expires) ? Outcome.rejected(REJECT_MISSING_OBJECT) : Outcome.pending();
        }
        if (head.sizeBytes() != null && head.sizeBytes() > MAX_PDF_BYTES) {
            return Outcome.rejected(REJECT_FILE_TOO_LARGE);
        }
        String type = head.contentType() == null ? "" : head.contentType().toLowerCase(Locale.ROOT);
        if (!type.startsWith(PDF)) {
            return Outcome.rejected(REJECT_NOT_A_PDF);
        }
        AiServiceCopyCheckClient.InspectResult inspected;
        try {
            String url = storage.signedUrl(row.fileId(), INSPECT_URL_SECONDS).url();
            inspected = copyCheck.inspect(url);
        } catch (EvalApiStorageClient.NotFound e) {
            return Outcome.rejected(REJECT_MISSING_OBJECT);
        } catch (RuntimeException e) {
            log.warn("[open-api] could not inspect upload {}: {}", row.id(), e.getMessage());
            throw OpenApiErrors.engineUnavailable(30);
        }
        if (inspected.error() != null) {
            switch (inspected.error()) {
                case "too_many_pages":
                    return Outcome.rejected(REJECT_TOO_MANY_PAGES);
                case "unparseable":
                    return Outcome.rejected(REJECT_UNPARSEABLE);
                default:
                    // fetch_failed (or a code this build does not know): try again later.
                    log.warn("[open-api] inspect of upload {} failed: {}", row.id(), inspected.error());
                    throw OpenApiErrors.engineUnavailable(30);
            }
        }
        if (inspected.encrypted() || inspected.pages() == null || inspected.pages() < 1) {
            return Outcome.rejected(REJECT_UNPARSEABLE);
        }
        if (inspected.pages() > INSPECT_MAX_PAGES) {
            return Outcome.rejected(REJECT_TOO_MANY_PAGES);
        }
        return new Outcome(inspected.pages(), head.sizeBytes(), null);
    }

    public static Map<String, Object> view(EvalApiUploadStore.UploadRow row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", row.id());
        out.put("filename", row.filename());
        out.put("content_type", row.contentType());
        out.put("size_bytes", row.sizeBytes());
        if (row.sha256() != null) {
            out.put("sha256", row.sha256());
        }
        out.put("status", row.status());
        out.put("pages", row.pages());
        out.put("reject_reason", row.rejectReason());
        out.put("submission_id", row.consumedBySubmissionId());
        out.put("expires_at", row.uploadExpiresAt() == null ? null : row.uploadExpiresAt().toString());
        out.put("created_at", row.createdAt() == null ? null : row.createdAt().toString());
        return out;
    }

    private static String sha(String value) {
        return value == null || value.isBlank() ? null : value.trim().toLowerCase(Locale.ROOT);
    }

    private static Instant parseInstant(String value, Instant fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            return fallback;
        }
    }
}
