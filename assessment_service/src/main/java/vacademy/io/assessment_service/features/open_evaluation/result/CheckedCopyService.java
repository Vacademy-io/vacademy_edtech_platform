package vacademy.io.assessment_service.features.open_evaluation.result;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.client.EvalApiStorageClient;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiErrors;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.media.service.FileService;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;

/**
 * {@code GET /submissions/{id}/checked-copy} (spec 7.8): the annotated PDF, streamed through
 * this service and authenticated by the API key, so a partner never needs to mirror it.
 *
 * <ul>
 *   <li>The copy is read through a short signed GET from media's private eval-api storage
 *       (C3). A checked copy stored elsewhere (copies rendered before ai_service wrote API
 *       copies to the private prefix) is read through media's internal URL route instead —
 *       still streamed, never handed out.</li>
 *   <li>{@code ?redirect=true} answers 302 to a private-CDN signed URL (60–3,600 s, default
 *       900) only when the private distribution is configured
 *       ({@code assessment.open-api.private-cdn-host}) and media's URL is on it. Otherwise the
 *       copy is streamed: a raw S3 presign is never given out (G12).</li>
 *   <li>No checked copy (render failed, or not graded yet) → 404 {@code checked_copy_not_found}.</li>
 * </ul>
 */
@Slf4j
@Service
public class CheckedCopyService {

    public static final int DEFAULT_EXPIRES_IN = 900;
    static final int STREAM_URL_SECONDS = 300;

    /** Opens the upstream PDF; a seam for tests. */
    public interface PdfFetcher {
        /** The body of a 200 answer; {@link UpstreamMissing} for 403/404; IOException otherwise. */
        InputStream open(String url) throws IOException;
    }

    public static class UpstreamMissing extends IOException {
        public UpstreamMissing(String message) {
            super(message);
        }
    }

    /** What to answer: a redirect target, or a stream to copy. */
    public record CheckedCopy(String redirectUrl, InputStream body, String filename) {
    }

    private final OpenSubmissionService submissions;
    private final EvalApiStorageClient storage;
    private final FileService fileService;
    private final OpenApiProperties properties;
    private final PdfFetcher fetcher;

    @Autowired
    public CheckedCopyService(OpenSubmissionService submissions, EvalApiStorageClient storage, FileService fileService,
            OpenApiProperties properties) {
        this(submissions, storage, fileService, properties, httpFetcher());
    }

    CheckedCopyService(OpenSubmissionService submissions, EvalApiStorageClient storage, FileService fileService,
            OpenApiProperties properties, PdfFetcher fetcher) {
        this.submissions = submissions;
        this.storage = storage;
        this.fileService = fileService;
        this.properties = properties;
        this.fetcher = fetcher;
    }

    public CheckedCopy open(ApiKeyPrincipal key, String submissionId, boolean redirect, Integer expiresIn) {
        int seconds = expiresIn == null ? DEFAULT_EXPIRES_IN : expiresIn;
        if (seconds < EvalApiStorageClient.MIN_EXPIRY_SECONDS || seconds > EvalApiStorageClient.MAX_EXPIRY_SECONDS) {
            throw OpenApiException.validation("expires_in", "out_of_range", "expires_in must be between 60 and 3600.");
        }
        ApiSubmissionStore.SubmissionView v = submissions.requireView(key, submissionId);
        if (ApiSubmissionStore.DELETED.equals(v.state())) {
            throw OpenSubmissionService.submissionNotFound();
        }
        String fileId = v.evaluatedFileId();
        if (fileId == null || fileId.isBlank()) {
            throw notFound();
        }
        String filename = "checked-copy-" + v.attemptId() + ".pdf";
        String url;
        boolean privateStore = true;
        try {
            url = storage.signedUrl(fileId, redirect ? seconds : STREAM_URL_SECONDS).url();
        } catch (EvalApiStorageClient.NotFound e) {
            privateStore = false;
            url = legacyUrl(fileId);
        } catch (EvalApiStorageClient.Refused | EvalApiStorageClient.Unavailable e) {
            throw OpenApiErrors.engineUnavailable(30);
        }
        if (redirect && privateStore && onPrivateCdn(url)) {
            return new CheckedCopy(url, null, filename);
        }
        try {
            return new CheckedCopy(null, fetcher.open(url), filename);
        } catch (UpstreamMissing e) {
            throw notFound();
        } catch (IOException e) {
            log.warn("[open-api] checked copy of {} could not be read: {}", v.attemptId(), e.getMessage());
            throw OpenApiErrors.engineUnavailable(30);
        }
    }

    /** True only for an https URL whose host is the configured private CDN host. */
    boolean onPrivateCdn(String url) {
        String host = properties == null ? null : properties.getPrivateCdnHost();
        if (host == null || host.isBlank() || url == null) {
            return false;
        }
        try {
            URI uri = URI.create(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getHost().toLowerCase(Locale.ROOT).equals(host.trim().toLowerCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private String legacyUrl(String fileId) {
        try {
            String url = fileService == null ? null : fileService.getPublicUrlForFileId(fileId);
            if (url == null || url.isBlank()) {
                throw notFound();
            }
            return url;
        } catch (OpenApiException e) {
            throw e;
        } catch (Exception e) {
            log.warn("[open-api] media has no URL for checked copy file: {}", e.getMessage());
            throw notFound();
        }
    }

    static OpenApiException notFound() {
        return OpenApiException.notFound(ApiErrorCode.CHECKED_COPY_NOT_FOUND,
                "No checked copy for this submission (not graded yet, or the copy could not be rendered).");
    }

    static PdfFetcher httpFetcher() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        return url -> {
            URI uri = URI.create(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("https") && !scheme.equals("http")) {
                throw new IOException("unsupported URL scheme");
            }
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(120)).GET().build();
            HttpResponse<InputStream> response;
            try {
                response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("interrupted", e);
            }
            int status = response.statusCode();
            if (status == 200) {
                return response.body();
            }
            response.body().close();
            if (status == 403 || status == 404) {
                throw new UpstreamMissing("storage answered " + status);
            }
            throw new IOException("storage answered " + status);
        };
    }
}
