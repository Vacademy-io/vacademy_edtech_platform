package vacademy.io.media_service.service;

import com.amazonaws.HttpMethod;
import com.amazonaws.SdkClientException;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.GeneratePresignedUrlRequest;
import com.amazonaws.services.s3.model.ObjectMetadata;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.media_service.dto.eval_api.EvalApiFileHeadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadRequest;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiSignedUrlResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiStoredFileResponse;
import vacademy.io.media_service.entity.FileMetadata;
import vacademy.io.media_service.repository.FileMetadataRepository;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Storage for the AI Evaluation partner API (spec docs/AI_EVALUATION_PUBLIC_API.md
 * sections 7.5, 7.8, gate G12, task T1.37).
 *
 * <h2>Where the objects live</h2>
 * Every object is written under {@code eval-api/{institute_id}/} in the PRIVATE
 * media bucket ({@code aws.bucket.name}, the bucket {@code upload-file-private}
 * and class recordings already use), never in the public bucket. The private
 * bucket is the only private location that exists today: it has Block Public
 * Access, and its own CloudFront distribution ({@code cdn.private-*}) only serves
 * URLs signed with the trusted key pair ({@link CloudFrontSignerService}).
 *
 * <p>One caveat the code cannot close on its own: per the comment in
 * {@link FileServiceImpl#getPublicUrl}, the PUBLIC distribution has an origin
 * group that fails over from the public bucket to this private bucket, so an
 * object key that leaks (a signed URL shows it) could be fetched unsigned via the
 * public CDN host. Two operational fixes, either one is enough:
 * <ol>
 *   <li>a bucket-policy Deny on {@code eval-api/*} for the public distribution's
 *       OAC principal (or a public-distribution cache behaviour for
 *       {@code eval-api/*} that refuses), or</li>
 *   <li>set {@code EVAL_API_S3_BUCKET} to a dedicated private bucket that no
 *       public distribution fronts (signed GETs are then S3 presigns, since the
 *       private distribution only fronts the main private bucket).</li>
 * </ol>
 *
 * <h2>Ownership</h2>
 * Rows carry {@code source=AI_EVAL_API} (partner uploads) or
 * {@code AI_EVAL_API_CHECKED_COPY} (graded copies) and {@code source_id=institute_id}.
 * Those source values are reserved: the user-facing presign endpoints refuse them
 * and the anonymous/user URL endpoints treat such files as not found
 * ({@link #isReservedSource}), so a partner's answer sheet is only ever reachable
 * through the HMAC-authenticated endpoints below.
 */
@Service
@Slf4j
public class EvalApiFileService {

    public static final String SOURCE_UPLOAD = "AI_EVAL_API";
    public static final String SOURCE_CHECKED_COPY = "AI_EVAL_API_CHECKED_COPY";
    public static final String KEY_PREFIX = "eval-api/";

    public static final String KIND_CHECKED_COPY = "checked_copy";
    public static final String KIND_ANSWER_SHEET = "answer_sheet";

    static final long MB = 1024L * 1024L;
    /** Spec 7.5: application/pdf up to 50 MB, images up to 10 MB each. */
    static final Map<String, Long> PRESIGN_MAX_BYTES = Map.of(
            "application/pdf", 50 * MB,
            "image/jpeg", 10 * MB,
            "image/png", 10 * MB,
            "image/heic", 10 * MB);
    /** Server-side uploads (checked copies, stitched PDFs) are PDFs; annotated copies run larger. */
    static final long SERVER_UPLOAD_MAX_BYTES = 150 * MB;

    static final long UPLOAD_URL_TTL_SECONDS = 3600;
    public static final int MIN_SIGNED_URL_SECONDS = 60;
    public static final int MAX_SIGNED_URL_SECONDS = 3600;
    public static final int DEFAULT_SIGNED_URL_SECONDS = 900;

    /** Institute ids are UUIDs today; this also keeps '/' and '..' out of the object key. */
    private static final Pattern INSTITUTE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private static final int MAX_KEY_FILE_NAME = 100;
    private static final int MAX_STORED_FILE_NAME = 255;

    private static final Set<String> RESERVED_SOURCES = Set.of(SOURCE_UPLOAD, SOURCE_CHECKED_COPY);

    private final AmazonS3 s3Client;
    private final FileMetadataRepository fileMetadataRepository;
    private final CloudFrontSignerService cloudFrontSignerService;
    private final String mainPrivateBucket;
    private final String evalBucket;
    private Clock clock = Clock.systemUTC();

    public EvalApiFileService(AmazonS3 s3Client,
                              FileMetadataRepository fileMetadataRepository,
                              CloudFrontSignerService cloudFrontSignerService,
                              @Value("${aws.bucket.name}") String mainPrivateBucket,
                              @Value("${eval-api.s3.bucket:}") String evalBucketOverride) {
        this.s3Client = s3Client;
        this.fileMetadataRepository = fileMetadataRepository;
        this.cloudFrontSignerService = cloudFrontSignerService;
        this.mainPrivateBucket = mainPrivateBucket;
        this.evalBucket = StringUtils.hasText(evalBucketOverride) ? evalBucketOverride.trim() : mainPrivateBucket;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    String getEvalBucket() {
        return evalBucket;
    }

    /**
     * True for source values that belong to the AI Evaluation API, including any
     * source a user-facing presign would turn into an {@code eval-api/...} key
     * (generateFileKey uses the source as the first key segment).
     */
    public static boolean isReservedSource(String source) {
        if (source == null) {
            return false;
        }
        String trimmed = source.trim();
        if (RESERVED_SOURCES.contains(trimmed.toUpperCase(Locale.ROOT))) {
            return true;
        }
        return trimmed.toLowerCase(Locale.ROOT).startsWith(KEY_PREFIX.substring(0, KEY_PREFIX.length() - 1));
    }

    // ------------------------------------------------------------------ presign

    public EvalApiPresignUploadResponse presignUpload(EvalApiPresignUploadRequest request) {
        if (request == null) {
            throw badRequest("invalid_request", "Request body is required.");
        }
        String instituteId = requireInstituteId(request.getInstituteId());
        String contentType = normalizeContentType(request.getContentType());
        Long maxBytes = contentType == null ? null : PRESIGN_MAX_BYTES.get(contentType);
        if (maxBytes == null) {
            throw badRequest("unsupported_content_type",
                    "content_type must be one of " + PRESIGN_MAX_BYTES.keySet() + ".");
        }
        Long sizeBytes = request.getSizeBytes();
        if (sizeBytes == null || sizeBytes <= 0) {
            throw badRequest("invalid_size", "size_bytes must be a positive integer.");
        }
        if (sizeBytes > maxBytes) {
            throw new EvalApiFileException(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large",
                    contentType + " uploads are limited to " + (maxBytes / MB) + " MB.");
        }
        String fileName = requireFileName(request.getFileName());

        String key = KEY_PREFIX + instituteId + "/" + UUID.randomUUID() + "-" + keySafeFileName(fileName);
        Instant expiresAt = clock.instant().plusSeconds(UPLOAD_URL_TTL_SECONDS).truncatedTo(ChronoUnit.SECONDS);

        GeneratePresignedUrlRequest presign = new GeneratePresignedUrlRequest(evalBucket, key)
                .withMethod(HttpMethod.PUT)
                .withExpiration(Date.from(expiresAt))
                .withContentType(contentType);
        // Signed header: S3 rejects the PUT unless the body is exactly the declared size.
        presign.putCustomRequestHeader("Content-Length", String.valueOf(sizeBytes));
        URL url = s3Client.generatePresignedUrl(presign);

        FileMetadata metadata = new FileMetadata(truncate(fileName, MAX_STORED_FILE_NAME), contentType, key,
                SOURCE_UPLOAD, instituteId);
        metadata.setFileSize(sizeBytes);
        metadata = fileMetadataRepository.save(metadata);

        return EvalApiPresignUploadResponse.builder()
                .fileId(metadata.getId())
                .uploadUrl(url.toString())
                .method("PUT")
                .headers(Map.of("Content-Type", contentType))
                .expiresAt(expiresAt.toString())
                .build();
    }

    // --------------------------------------------------------------------- head

    public EvalApiFileHeadResponse head(String fileId) {
        FileMetadata fm = requireEvalFile(fileId);
        EvalApiFileHeadResponse.EvalApiFileHeadResponseBuilder out = EvalApiFileHeadResponse.builder()
                .fileId(fm.getId())
                .source(fm.getSource())
                .sourceId(fm.getSourceId());
        try {
            ObjectMetadata om = s3Client.getObjectMetadata(evalBucket, fm.getKey());
            return out.exists(true)
                    .sizeBytes(om.getContentLength())
                    .contentType(om.getContentType())
                    .build();
        } catch (AmazonS3Exception e) {
            if (e.getStatusCode() == 404) {
                return out.exists(false).build();
            }
            log.warn("eval-api head: S3 error for file {}: {} {}", fm.getId(), e.getStatusCode(), e.getErrorCode());
            throw storageError();
        } catch (SdkClientException e) {
            log.warn("eval-api head: storage unreachable for file {}: {}", fm.getId(), e.getMessage());
            throw storageError();
        }
    }

    // --------------------------------------------------------------- signed GET

    public EvalApiSignedUrlResponse signedUrl(String fileId, Integer expirySeconds) {
        int seconds = expirySeconds == null ? DEFAULT_SIGNED_URL_SECONDS : expirySeconds;
        if (seconds < MIN_SIGNED_URL_SECONDS || seconds > MAX_SIGNED_URL_SECONDS) {
            throw badRequest("invalid_expiry", "expirySeconds must be between " + MIN_SIGNED_URL_SECONDS
                    + " and " + MAX_SIGNED_URL_SECONDS + ".");
        }
        FileMetadata fm = requireEvalFile(fileId);
        Instant expiresAt = clock.instant().plusSeconds(seconds).truncatedTo(ChronoUnit.SECONDS);
        Date expiry = Date.from(expiresAt);

        String url = null;
        // The private distribution fronts the main private bucket only.
        if (evalBucket.equals(mainPrivateBucket) && cloudFrontSignerService.isEnabled()) {
            try {
                url = cloudFrontSignerService.signedUrl(fm.getKey(), expiry);
            } catch (Exception e) {
                log.warn("eval-api signed-url: private-CDN signing failed for file {}, using S3 presign: {}",
                        fm.getId(), e.getMessage());
            }
        }
        if (url == null) {
            try {
                url = s3Client.generatePresignedUrl(new GeneratePresignedUrlRequest(evalBucket, fm.getKey())
                        .withMethod(HttpMethod.GET)
                        .withExpiration(expiry)).toString();
            } catch (SdkClientException e) {
                log.warn("eval-api signed-url: presign failed for file {}: {}", fm.getId(), e.getMessage());
                throw storageError();
            }
        }
        return new EvalApiSignedUrlResponse(url, expiresAt.toString());
    }

    // ------------------------------------------------------ server-side upload

    /**
     * Server-side upload into the private prefix (ai_service render worker:
     * checked copies; Phase 2 image stitching: answer sheets). PDF only.
     */
    public EvalApiStoredFileResponse storeServerFile(MultipartFile file, String instituteIdRaw, String kindRaw)
            throws IOException {
        String instituteId = requireInstituteId(instituteIdRaw);
        String kind = StringUtils.hasText(kindRaw) ? kindRaw.trim().toLowerCase(Locale.ROOT) : KIND_CHECKED_COPY;
        String source;
        String subPath;
        if (KIND_CHECKED_COPY.equals(kind)) {
            source = SOURCE_CHECKED_COPY;
            subPath = "checked/";
        } else if (KIND_ANSWER_SHEET.equals(kind)) {
            source = SOURCE_UPLOAD;
            subPath = "";
        } else {
            throw badRequest("invalid_kind", "kind must be checked_copy or answer_sheet.");
        }
        if (file == null || file.isEmpty()) {
            throw badRequest("invalid_size", "file is required and must not be empty.");
        }
        String contentType = normalizeContentType(file.getContentType());
        if (!"application/pdf".equals(contentType)) {
            throw badRequest("unsupported_content_type", "Only application/pdf is accepted.");
        }
        if (file.getSize() > SERVER_UPLOAD_MAX_BYTES) {
            throw new EvalApiFileException(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large",
                    "Server uploads are limited to " + (SERVER_UPLOAD_MAX_BYTES / MB) + " MB.");
        }
        String fileName = StringUtils.hasText(file.getOriginalFilename()) ? file.getOriginalFilename().trim()
                : (KIND_CHECKED_COPY.equals(kind) ? "checked_copy.pdf" : "answer_sheet.pdf");
        String key = KEY_PREFIX + instituteId + "/" + subPath + UUID.randomUUID() + "-" + keySafeFileName(fileName);

        ObjectMetadata om = new ObjectMetadata();
        om.setContentType(contentType);
        om.setContentLength(file.getSize());
        om.setSSEAlgorithm(ObjectMetadata.AES_256_SERVER_SIDE_ENCRYPTION);
        try (InputStream in = file.getInputStream()) {
            s3Client.putObject(evalBucket, key, in, om);
        } catch (SdkClientException e) {
            log.warn("eval-api upload: S3 put failed for institute {}: {}", instituteId, e.getMessage());
            throw storageError();
        }

        FileMetadata metadata = new FileMetadata(truncate(fileName, MAX_STORED_FILE_NAME), contentType, key,
                source, instituteId);
        metadata.setFileSize(file.getSize());
        metadata = fileMetadataRepository.save(metadata);
        return EvalApiStoredFileResponse.builder()
                .fileId(metadata.getId())
                .sizeBytes(file.getSize())
                .contentType(contentType)
                .source(source)
                .sourceId(instituteId)
                .build();
    }

    // ----------------------------------------------------------------- helpers

    /**
     * The file row, only if it really is an eval-api object: reserved source AND
     * key under {@code eval-api/{source_id}/}. Anything else is reported as not
     * found, so these endpoints never sign or describe an unrelated file.
     */
    FileMetadata requireEvalFile(String fileId) {
        if (!StringUtils.hasText(fileId)) {
            throw notFound();
        }
        Optional<FileMetadata> found = fileMetadataRepository.findById(fileId.trim());
        if (found.isEmpty()) {
            throw notFound();
        }
        FileMetadata fm = found.get();
        if (!RESERVED_SOURCES.contains(fm.getSource()) || !StringUtils.hasText(fm.getSourceId())
                || fm.getKey() == null || !fm.getKey().startsWith(KEY_PREFIX + fm.getSourceId() + "/")) {
            throw notFound();
        }
        return fm;
    }

    static String requireInstituteId(String raw) {
        String id = raw == null ? "" : raw.trim();
        if (!INSTITUTE_ID.matcher(id).matches()) {
            throw badRequest("invalid_institute_id", "institute_id is missing or malformed.");
        }
        return id;
    }

    static String requireFileName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) {
            throw badRequest("invalid_file_name", "file_name is required.");
        }
        return name;
    }

    /** Lower-cased media type without parameters ("application/PDF; x=y" -> "application/pdf"). */
    static String normalizeContentType(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String ct = raw.trim();
        int semi = ct.indexOf(';');
        if (semi >= 0) {
            ct = ct.substring(0, semi).trim();
        }
        return ct.toLowerCase(Locale.ROOT);
    }

    /** Only [A-Za-z0-9._-] survive in the object key; the original name stays in file_metadata. */
    static String keySafeFileName(String fileName) {
        String base = fileName.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        String safe = base.replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("^\\.+", "");
        if (safe.length() > MAX_KEY_FILE_NAME) {
            safe = safe.substring(safe.length() - MAX_KEY_FILE_NAME);
        }
        return safe.isEmpty() ? "file" : safe;
    }

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static EvalApiFileException badRequest(String code, String message) {
        return new EvalApiFileException(HttpStatus.BAD_REQUEST, code, message);
    }

    private static EvalApiFileException notFound() {
        return new EvalApiFileException(HttpStatus.NOT_FOUND, "file_not_found", "File not found.");
    }

    private static EvalApiFileException storageError() {
        return new EvalApiFileException(HttpStatus.BAD_GATEWAY, "storage_error",
                "Storage is unavailable, retry later.");
    }
}
