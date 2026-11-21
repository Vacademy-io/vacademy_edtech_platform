package vacademy.io.admin_core_service.features.commerce.media;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CommerceRenditionClientTest {

    private InternalClientUtils http;
    private CommerceRenditionClient client;

    @BeforeEach
    void setUp() {
        http = mock(InternalClientUtils.class);
        client = new CommerceRenditionClient(http, new ObjectMapper(), "admin_core_service", "http://media:8075");
    }

    private void answer(String body) {
        when(http.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(ResponseEntity.ok(body));
    }

    @Test
    void onlyTheFileIdIsSentAndTheUrlsComeBackByWidth() throws Exception {
        answer("""
                {"file_id":"file-1","width":800,"height":1000,"pipeline_version":1,"renditions":[
                 {"width":320,"height":400,"url":"https://cdn/v1/file-1/w320.webp","bytes":9000,"created":true},
                 {"width":640,"height":800,"url":"https://cdn/v1/file-1/w640.webp","bytes":30000,"created":true},
                 {"width":800,"height":1000,"url":"https://cdn/v1/file-1/w800.webp","bytes":41000,"created":true}]}
                """);

        CommerceRenditionClient.Result result = client.generate("file-1", List.of("inst-1", "pkg-1"));

        assertEquals(800, result.width());
        assertEquals(1000, result.height());
        assertEquals(List.of(320, 640, 800), List.copyOf(result.urls().keySet()));
        assertEquals(1, result.pipelineVersion());
        ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
        verify(http).makeHmacRequest(eq("admin_core_service"), eq("POST"), eq("http://media:8075"),
                eq("/media-service/internal/image-renditions"), body.capture());
        assertEquals(Map.of("file_id", "file-1", "owner_ids", List.of("inst-1", "pkg-1")), body.getValue());
    }

    @Test
    void aRefusedFileIsNotRetried() {
        when(http.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(HttpClientErrorException.create(HttpStatus.UNPROCESSABLE_ENTITY, "Unprocessable", null,
                        "{\"code\":\"NOT_AN_IMAGE\",\"retryable\":false,\"message\":\"not an image\"}"
                                .getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8));

        CommerceRenditionException e = assertThrows(CommerceRenditionException.class, () -> client.generate("file-1", List.of("inst-1", "pkg-1")));

        assertEquals("NOT_AN_IMAGE", e.getCode());
        assertFalse(e.isRetryable());
    }

    @Test
    void aBusyOrBrokenMediaServiceIsRetried() {
        when(http.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(HttpClientErrorException.create(HttpStatus.TOO_MANY_REQUESTS, "Too Many", null,
                        "{\"code\":\"BUSY\",\"retryable\":true}".getBytes(StandardCharsets.UTF_8),
                        StandardCharsets.UTF_8))
                .thenThrow(HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "Bad Gateway", null,
                        "<html>".getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8))
                .thenThrow(new ResourceAccessException("Read timed out"));

        CommerceRenditionException busy = assertThrows(CommerceRenditionException.class, () -> client.generate("f", List.of("inst-1")));
        CommerceRenditionException gateway = assertThrows(CommerceRenditionException.class, () -> client.generate("f", List.of("inst-1")));
        CommerceRenditionException timeout = assertThrows(CommerceRenditionException.class, () -> client.generate("f", List.of("inst-1")));

        assertEquals("BUSY", busy.getCode());
        assertTrue(busy.isRetryable());
        assertEquals("MEDIA_SERVICE_502", gateway.getCode());
        assertTrue(gateway.isRetryable());
        assertEquals("MEDIA_SERVICE_UNREACHABLE", timeout.getCode());
        assertTrue(timeout.isRetryable());
    }

    @Test
    void anAnswerThatIsNotARenditionListIsNotStored() {
        for (String body : new String[] {
                "",
                "{}",
                "{\"width\":800,\"height\":1000,\"renditions\":[]}",
                "{\"width\":800,\"height\":1000,\"renditions\":[{\"width\":320,\"url\":\"javascript:alert(1)\"}]}",
                "{\"width\":800,\"height\":1000,\"renditions\":[{\"width\":3200,\"url\":\"https://cdn/x.webp\"}]}",
                "{\"width\":300,\"height\":300,\"renditions\":[{\"width\":320,\"url\":\"https://cdn/x.webp\"}]}"}) {
            CommerceRenditionException e = assertThrows(CommerceRenditionException.class, () -> client.parse(body),
                    body);
            assertEquals("BAD_RESPONSE", e.getCode());
        }
    }
}
