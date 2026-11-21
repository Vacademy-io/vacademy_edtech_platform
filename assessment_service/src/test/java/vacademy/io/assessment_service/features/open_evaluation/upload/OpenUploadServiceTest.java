package vacademy.io.assessment_service.features.open_evaluation.upload;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.client.EvalApiStorageClient;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.ratelimit.ApiRateLimiter;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OpenUploadServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");

    private EvalApiUploadStore store;
    private EvalApiStorageClient storage;
    private AiServiceCopyCheckClient copyCheck;
    private ApiRateLimiter limiter;
    private OpenUploadService service;

    @BeforeEach
    void setUp() {
        store = mock(EvalApiUploadStore.class);
        storage = mock(EvalApiStorageClient.class);
        copyCheck = mock(AiServiceCopyCheckClient.class);
        limiter = mock(ApiRateLimiter.class);
        when(limiter.acquire(any(), eq(ApiRateLimiter.Kind.UPLOAD), anyInt()))
                .thenReturn(new ApiRateLimiter.Decision(true, 100, 99, 60));
        service = new OpenUploadService(store, storage, copyCheck, limiter);
        service.setClock(Clock.fixed(NOW, ZoneOffset.UTC));
    }

    static SubmissionInputs.UploadFile pdf(String name, long size) {
        return new SubmissionInputs.UploadFile(name, "application/pdf", size, null);
    }

    static EvalApiUploadStore.UploadRow row(String status, Integer pages, Instant expires, Instant validated, String consumed) {
        return new EvalApiUploadStore.UploadRow("up-1", OpenFixtures.INSTITUTE, OpenFixtures.KEY_ID, "file-1", "a.pdf",
                "application/pdf", 1000, null, pages, status, "rejected".equals(status) ? "not_a_pdf" : null, consumed,
                expires, validated, NOW.minusSeconds(600), NOW.minusSeconds(600));
    }

    @Test
    void create_presigns_every_file_then_records_them() {
        when(storage.presignUpload(eq(OpenFixtures.INSTITUTE), anyString(), eq("application/pdf"), anyLong()))
                .thenReturn(new EvalApiStorageClient.PresignedUpload("f1", "https://s3/put?sig", "PUT",
                        Map.of("Content-Type", "application/pdf"), "2026-10-01T11:00:00Z"));
        SubmissionInputs.CreateUploads body = new SubmissionInputs.CreateUploads();
        body.setFiles(List.of(pdf("10A07.pdf", 8_421_337), pdf("10A08.pdf", 7_990_112)));

        List<Map<String, Object>> out = service.create(OpenFixtures.key(), body);

        assertThat(out).hasSize(2);
        assertThat(out.get(0)).containsEntry("upload_url", "https://s3/put?sig").containsEntry("method", "PUT")
                .containsEntry("status", "pending").containsEntry("expires_at", "2026-10-01T11:00:00Z");
        verify(store).insert(anyString(), eq(OpenFixtures.INSTITUTE), eq(OpenFixtures.KEY_ID), eq("f1"), eq("10A07.pdf"),
                eq("application/pdf"), eq(8_421_337L), eq(null), eq(Instant.parse("2026-10-01T11:00:00Z")));
        verify(limiter).acquire(any(), eq(ApiRateLimiter.Kind.UPLOAD), eq(2));
    }

    @Test
    void a_storage_failure_records_nothing() {
        when(storage.presignUpload(anyString(), anyString(), anyString(), anyLong()))
                .thenThrow(new EvalApiStorageClient.Unavailable("down", null));
        SubmissionInputs.CreateUploads body = new SubmissionInputs.CreateUploads();
        body.setFilename("a.pdf");
        body.setContentType("application/pdf");
        body.setSizeBytes(10L);

        assertThatThrownBy(() -> service.create(OpenFixtures.key(), body))
                .isInstanceOfSatisfying(OpenApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.ENGINE_UNAVAILABLE));
        verify(store, never()).insert(any(), any(), any(), any(), any(), any(), anyLong(), any(), any());
    }

    @Test
    void validation_refuses_images_big_pdfs_bad_hashes_and_too_many_files() {
        assertThatThrownBy(() -> OpenUploadService.validate(List.of(
                new SubmissionInputs.UploadFile("a.jpg", "image/jpeg", 10L, null))))
                .isInstanceOfSatisfying(OpenApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE));
        assertThatThrownBy(() -> OpenUploadService.validate(List.of(pdf("a.pdf", 50L * 1024 * 1024 + 1))))
                .isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> OpenUploadService.validate(List.of(
                new SubmissionInputs.UploadFile("a.pdf", "application/pdf", 10L, "xyz"))))
                .isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> OpenUploadService.validate(List.of(
                new SubmissionInputs.UploadFile("a.doc", "application/msword", 10L, null))))
                .isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> OpenUploadService.validate(java.util.Collections.nCopies(101, pdf("a.pdf", 1))))
                .isInstanceOf(OpenApiException.class);
        OpenUploadService.validate(List.of(new SubmissionInputs.UploadFile("a.pdf", "Application/PDF", 10L,
                "9f2c" + "0".repeat(60))));
    }

    @Test
    void rate_limited_presigns_are_429() {
        when(limiter.acquire(any(), eq(ApiRateLimiter.Kind.UPLOAD), anyInt()))
                .thenReturn(new ApiRateLimiter.Decision(false, 100, 0, 12));
        SubmissionInputs.CreateUploads body = new SubmissionInputs.CreateUploads();
        body.setFiles(List.of(pdf("a.pdf", 10)));

        assertThatThrownBy(() -> service.create(OpenFixtures.key(), body))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(ApiErrorCode.RATE_LIMITED);
                    assertThat(e.getHeaders()).containsEntry("Retry-After", "12");
                });
        verifyNoInteractions(storage);
    }

    private void head(boolean exists, long size, String type) {
        org.mockito.Mockito.doReturn(new EvalApiStorageClient.FileHead("file-1", exists, exists ? size : null,
                exists ? type : null, "AI_EVAL_API", OpenFixtures.INSTITUTE)).when(storage).head("file-1");
    }


    @Test
    void a_good_pdf_becomes_ready_with_its_page_count() {
        head(true, 1000, "application/pdf");
        when(storage.signedUrl("file-1", 300)).thenReturn(new EvalApiStorageClient.SignedUrl("https://get", "x"));
        when(copyCheck.inspect("https://get")).thenReturn(new AiServiceCopyCheckClient.InspectResult(28, false, null));

        OpenUploadService.Outcome outcome = service.inspect(row("pending", null, NOW.plusSeconds(600), null, null));

        assertThat(outcome.pages()).isEqualTo(28);
        assertThat(outcome.rejectReason()).isNull();
    }

    @Test
    void a_missing_object_stays_pending_until_its_put_url_expires() {
        head(false, 0, null);
        assertThat(service.inspect(row("pending", null, NOW.plusSeconds(600), null, null))).isEqualTo(OpenUploadService.Outcome.pending());
        assertThat(service.inspect(row("pending", null, NOW.minusSeconds(1), null, null)).rejectReason())
                .isEqualTo(OpenUploadService.REJECT_MISSING_OBJECT);
    }

    @Test
    void wrong_type_unreadable_encrypted_and_long_pdfs_are_rejected() {
        head(true, 1000, "image/png");
        assertThat(service.inspect(row("pending", null, null, null, null)).rejectReason()).isEqualTo("not_a_pdf");

        head(true, 1000, "application/pdf");
        when(storage.signedUrl("file-1", 300)).thenReturn(new EvalApiStorageClient.SignedUrl("https://get", "x"));
        when(copyCheck.inspect("https://get")).thenReturn(new AiServiceCopyCheckClient.InspectResult(null, false, "unparseable"));
        assertThat(service.inspect(row("pending", null, null, null, null)).rejectReason()).isEqualTo("unparseable");

        when(copyCheck.inspect("https://get")).thenReturn(new AiServiceCopyCheckClient.InspectResult(3, true, null));
        assertThat(service.inspect(row("pending", null, null, null, null)).rejectReason()).isEqualTo("unparseable");

        when(copyCheck.inspect("https://get")).thenReturn(new AiServiceCopyCheckClient.InspectResult(null, false, "too_many_pages"));
        assertThat(service.inspect(row("pending", null, null, null, null)).rejectReason()).isEqualTo("too_many_pages");
    }

    @Test
    void a_file_recorded_for_another_institute_is_never_accepted() {
        when(storage.head("file-1")).thenReturn(new EvalApiStorageClient.FileHead("file-1", true, 10L,
                "application/pdf", "AI_EVAL_API", "other-inst"));
        assertThat(service.inspect(row("pending", null, null, null, null)).rejectReason()).isEqualTo("missing_object");
        verifyNoInteractions(copyCheck);
    }

    @Test
    void checks_that_cannot_be_made_are_503_and_change_nothing() {
        when(storage.head("file-1")).thenThrow(new EvalApiStorageClient.Unavailable("down", null));
        assertThatThrownBy(() -> service.inspect(row("pending", null, null, null, null)))
                .isInstanceOfSatisfying(OpenApiException.class,
                        e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.ENGINE_UNAVAILABLE));

        head(true, 1000, "application/pdf");
        when(storage.signedUrl("file-1", 300)).thenReturn(new EvalApiStorageClient.SignedUrl("https://get", "x"));
        when(copyCheck.inspect("https://get")).thenReturn(new AiServiceCopyCheckClient.InspectResult(null, false, "fetch_failed"));
        assertThatThrownBy(() -> service.inspect(row("pending", null, null, null, null))).isInstanceOf(OpenApiException.class);
    }

    @Test
    void submission_refuses_rejected_used_and_not_uploaded_files() {
        when(store.find(OpenFixtures.INSTITUTE, "up-1")).thenReturn(Optional.of(row("rejected", null, null, NOW, null)));
        assertThatThrownBy(() -> service.requireUsable(OpenFixtures.key(), "up-1"))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.UPLOAD_REJECTED));

        when(store.find(OpenFixtures.INSTITUTE, "up-1")).thenReturn(Optional.of(row("ready", 5, NOW.minusSeconds(1),
                NOW, "sub-9")));
        assertThatThrownBy(() -> service.requireUsable(OpenFixtures.key(), "up-1"))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.UPLOAD_ALREADY_USED));

        when(store.find(OpenFixtures.INSTITUTE, "nope")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.requireUsable(OpenFixtures.key(), "nope"))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.UPLOAD_NOT_FOUND));
    }

    @Test
    void a_ready_upload_checked_after_its_url_expired_is_not_checked_again() {
        EvalApiUploadStore.UploadRow ready = row("ready", 5, NOW.minusSeconds(100), NOW.minusSeconds(50), null);
        when(store.find(OpenFixtures.INSTITUTE, "up-1")).thenReturn(Optional.of(ready));

        assertThat(service.requireUsable(OpenFixtures.key(), "up-1").pages()).isEqualTo(5);
        verifyNoInteractions(storage);
        assertThat(ready.needsRecheck()).isFalse();
        assertThat(row("ready", 5, NOW.plusSeconds(100), NOW, null).needsRecheck()).isTrue();
    }
}
