package vacademy.io.assessment_service.features.open_evaluation.result;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.client.EvalApiStorageClient;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.SubmissionFixtures;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.media.service.FileService;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CheckedCopyServiceTest {

    private OpenSubmissionService submissions;
    private EvalApiStorageClient storage;
    private FileService fileService;
    private OpenApiProperties properties;
    private final List<String> fetched = new ArrayList<>();
    private CheckedCopyService service;
    private SubmissionFixtures.View view;
    private final ApiKeyPrincipal key = OpenFixtures.key();

    @BeforeEach
    void setUp() {
        submissions = mock(OpenSubmissionService.class);
        storage = mock(EvalApiStorageClient.class);
        fileService = mock(FileService.class);
        properties = mock(OpenApiProperties.class);
        service = new CheckedCopyService(submissions, storage, fileService, properties, url -> {
            fetched.add(url);
            if (url.contains("missing")) {
                throw new CheckedCopyService.UpstreamMissing("404");
            }
            return new ByteArrayInputStream("%PDF".getBytes());
        });
        view = SubmissionFixtures.view();
        view.evaluatedFileId = "checked-1";
        when(submissions.requireView(key, "sub-1")).thenAnswer(i -> view.build());
    }

    @Test
    void streams_the_private_copy_through_the_service() throws Exception {
        when(storage.signedUrl("checked-1", 300)).thenReturn(new EvalApiStorageClient.SignedUrl("https://s3/x?sig", "t"));

        CheckedCopyService.CheckedCopy copy = service.open(key, "sub-1", false, null);

        assertThat(copy.redirectUrl()).isNull();
        assertThat(new String(copy.body().readAllBytes())).isEqualTo("%PDF");
        assertThat(copy.filename()).isEqualTo("checked-copy-sub-1.pdf");
    }

    @Test
    void redirects_only_to_the_configured_private_cdn() {
        when(storage.signedUrl("checked-1", 900)).thenReturn(new EvalApiStorageClient.SignedUrl(
                "https://private-cdn.vacademy.io/eval-api/inst-1/x.pdf?Signature=1", "t"));
        when(properties.getPrivateCdnHost()).thenReturn("private-cdn.vacademy.io");
        assertThat(service.open(key, "sub-1", true, null).redirectUrl()).startsWith("https://private-cdn.vacademy.io/");

        // an S3 presign is never handed out: streamed instead
        when(storage.signedUrl("checked-1", 600)).thenReturn(new EvalApiStorageClient.SignedUrl(
                "https://bucket.s3.amazonaws.com/eval-api/x.pdf?X-Amz-Signature=1", "t"));
        assertThat(service.open(key, "sub-1", true, 600).redirectUrl()).isNull();

        when(properties.getPrivateCdnHost()).thenReturn("");
        assertThat(service.open(key, "sub-1", true, null).redirectUrl()).isNull();
    }

    @Test
    void a_copy_outside_the_private_prefix_is_streamed_from_media_never_redirected() {
        when(storage.signedUrl(anyString(), anyInt())).thenThrow(new EvalApiStorageClient.NotFound("not eval-api"));
        when(fileService.getPublicUrlForFileId("checked-1")).thenReturn("https://cdn/legacy.pdf");
        when(properties.getPrivateCdnHost()).thenReturn("cdn");

        CheckedCopyService.CheckedCopy copy = service.open(key, "sub-1", true, null);

        assertThat(copy.redirectUrl()).isNull();
        assertThat(fetched).containsExactly("https://cdn/legacy.pdf");
    }

    @Test
    void no_copy_or_a_missing_object_is_404_and_expiry_is_bounded() {
        view.evaluatedFileId = null;
        assertThatThrownBy(() -> service.open(key, "sub-1", false, null))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.CHECKED_COPY_NOT_FOUND));

        view.evaluatedFileId = "checked-1";
        when(storage.signedUrl("checked-1", 300)).thenReturn(new EvalApiStorageClient.SignedUrl("https://s3/missing", "t"));
        assertThatThrownBy(() -> service.open(key, "sub-1", false, null))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.CHECKED_COPY_NOT_FOUND));

        assertThatThrownBy(() -> service.open(key, "sub-1", true, 30)).isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> service.open(key, "sub-1", true, 3601)).isInstanceOf(OpenApiException.class);

        view.state = "DELETED";
        assertThatThrownBy(() -> service.open(key, "sub-1", false, null))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.SUBMISSION_NOT_FOUND));
        verify(fileService, never()).getPublicUrlForFileId(anyString());
    }
}
