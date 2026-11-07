package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class EvalApiStorageClientTest {

    private InternalClientUtils internal;
    private EvalApiStorageClient client;

    @BeforeEach
    void setUp() {
        internal = mock(InternalClientUtils.class);
        client = new EvalApiStorageClient(internal, new ObjectMapper(), "http://media:8075", "assessment_service");
    }

    @Test
    void presign_sends_the_c3_body_and_reads_the_answer() {
        when(internal.makeHmacRequest(eq("assessment_service"), eq("POST"), eq("http://media:8075"),
                eq("/media-service/internal/eval-api/v1/presign-upload"), any()))
                .thenReturn(ResponseEntity.ok("{\"file_id\":\"f1\",\"upload_url\":\"https://put\",\"method\":\"PUT\","
                        + "\"headers\":{\"Content-Type\":\"application/pdf\"},\"expires_at\":\"2026-10-01T11:00:00Z\"}"));

        EvalApiStorageClient.PresignedUpload p = client.presignUpload("inst-1", "a.pdf", "application/pdf", 10L);

        assertThat(p.fileId()).isEqualTo("f1");
        assertThat(p.headers()).containsEntry("Content-Type", "application/pdf");
        verify(internal).makeHmacRequest(eq("assessment_service"), eq("POST"), eq("http://media:8075"),
                eq("/media-service/internal/eval-api/v1/presign-upload"),
                eq(Map.of("institute_id", "inst-1", "file_name", "a.pdf", "content_type", "application/pdf", "size_bytes", 10L)));
    }

    @Test
    void errors_map_to_not_found_refused_and_unavailable() {
        when(internal.makeHmacRequest(any(), eq("GET"), any(), eq("/media-service/internal/eval-api/v1/files/f1/head"), any()))
                .thenThrow(HttpClientErrorException.create(HttpStatus.NOT_FOUND, "nf", null, null, StandardCharsets.UTF_8));
        assertThatThrownBy(() -> client.head("f1")).isInstanceOf(EvalApiStorageClient.NotFound.class);

        when(internal.makeHmacRequest(any(), eq("POST"), any(), any(), any()))
                .thenThrow(HttpClientErrorException.create(HttpStatus.PAYLOAD_TOO_LARGE, "big", null,
                        "{\"error\":\"file_too_large\",\"message\":\"too big\"}".getBytes(), StandardCharsets.UTF_8));
        assertThatThrownBy(() -> client.presignUpload("inst-1", "a.pdf", "application/pdf", 10L))
                .isInstanceOfSatisfying(EvalApiStorageClient.Refused.class, e -> assertThat(e.getCode()).isEqualTo("file_too_large"));

        when(internal.makeHmacRequest(any(), eq("GET"), any(), eq("/media-service/internal/eval-api/v1/files/f2/signed-url?expirySeconds=3600"), any()))
                .thenThrow(HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "x", null, null, StandardCharsets.UTF_8));
        assertThatThrownBy(() -> client.signedUrl("f2", 99999)).isInstanceOf(EvalApiStorageClient.Unavailable.class);
    }

    @Test
    void ids_that_are_not_media_ids_never_reach_a_url() {
        assertThatThrownBy(() -> client.head("../etc")).isInstanceOf(EvalApiStorageClient.NotFound.class);
        assertThatThrownBy(() -> client.signedUrl("a?b=c", 60)).isInstanceOf(EvalApiStorageClient.NotFound.class);
        verifyNoInteractions(internal);
    }

    @Test
    void inspect_answer_is_read_leniently() {
        assertThat(AiServiceCopyCheckClient.toInspectResult(Map.of("pages", 28, "encrypted", false)))
                .isEqualTo(new AiServiceCopyCheckClient.InspectResult(28, false, null));
        java.util.HashMap<String, Object> bad = new java.util.HashMap<>();
        bad.put("pages", null);
        bad.put("encrypted", true);
        bad.put("error", "unparseable");
        assertThat(AiServiceCopyCheckClient.toInspectResult(bad))
                .isEqualTo(new AiServiceCopyCheckClient.InspectResult(null, true, "unparseable"));
    }
}
