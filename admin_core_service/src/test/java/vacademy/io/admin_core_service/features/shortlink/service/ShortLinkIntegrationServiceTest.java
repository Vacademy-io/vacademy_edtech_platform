package vacademy.io.admin_core_service.features.shortlink.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Short URLs are built for every invite row in the invite list and detail
 * responses. An institute without a custom short-link domain used to miss the
 * host cache every time, so each row cost one media-service call.
 */
@ExtendWith(MockitoExtension.class)
class ShortLinkIntegrationServiceTest {

    private static final String DEFAULT_HOST = "https://u.vacademy.io";

    @Mock
    private InternalClientUtils internalClientUtils;

    @InjectMocks
    private ShortLinkIntegrationService service;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "shortLinkBaseUrl", DEFAULT_HOST);
        ReflectionTestUtils.setField(service, "mediaServiceBaseUrl", "http://media-service:8075");
        ReflectionTestUtils.setField(service, "clientName", "admin_core_service");
    }

    private void mediaServiceAnswers(ResponseEntity<String> response) {
        when(internalClientUtils.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(response);
    }

    @Test
    @DisplayName("default host from media-service is cached: one call for many short URLs")
    void cachesDefaultHost() {
        mediaServiceAnswers(ResponseEntity.ok(DEFAULT_HOST));

        for (int i = 0; i < 50; i++) {
            assertEquals(DEFAULT_HOST + "/s/code" + i, service.buildAbsoluteUrl("inst-1", "code" + i));
        }

        verify(internalClientUtils, times(1))
                .makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("custom domain is still cached")
    void cachesCustomDomain() {
        mediaServiceAnswers(ResponseEntity.ok("https://u.aanandham.uk"));

        assertEquals("https://u.aanandham.uk/s/a", service.buildAbsoluteUrl("inst-2", "a"));
        assertEquals("https://u.aanandham.uk/s/b", service.buildAbsoluteUrl("inst-2", "b"));

        verify(internalClientUtils, times(1))
                .makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("a failed lookup falls back to the default host and is NOT cached")
    void failureIsNotCached() {
        mediaServiceAnswers(ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(""));

        assertEquals(DEFAULT_HOST + "/s/a", service.buildAbsoluteUrl("inst-3", "a"));
        assertEquals(DEFAULT_HOST + "/s/b", service.buildAbsoluteUrl("inst-3", "b"));

        // retried on the second URL rather than pinning the fallback
        verify(internalClientUtils, times(2))
                .makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("an exception from media-service falls back to the default host and is NOT cached")
    void exceptionIsNotCached() {
        when(internalClientUtils.makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(new RuntimeException("connection refused"));

        assertEquals(DEFAULT_HOST + "/s/a", service.buildAbsoluteUrl("inst-4", "a"));
        assertEquals(DEFAULT_HOST + "/s/b", service.buildAbsoluteUrl("inst-4", "b"));

        verify(internalClientUtils, times(2))
                .makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("absolute and blank short codes never call media-service")
    void absoluteAndBlankCodesSkipLookup() {
        assertEquals("https://x.io/s/a", service.buildAbsoluteUrl("inst-5", "https://x.io/s/a"));
        assertEquals(null, service.buildAbsoluteUrl("inst-5", " "));

        verify(internalClientUtils, times(0))
                .makeHmacRequest(anyString(), anyString(), anyString(), anyString(), any());
    }
}
