package vacademy.io.admin_core_service.features.live_session.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.features.catalogue_analytics.service.CatalogueAnalyticsRateLimiter;
import vacademy.io.admin_core_service.features.live_session.service.PublicLiveSessionService;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PublicLiveSessionControllerTest {

    static final String URL = "/admin-core-service/open/v1/live-sessions/public";

    PublicLiveSessionService service;
    CatalogueAnalyticsRateLimiter limiter;
    MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(PublicLiveSessionService.class);
        limiter = mock(CatalogueAnalyticsRateLimiter.class);
        mvc = MockMvcBuilders.standaloneSetup(new PublicLiveSessionController(service, limiter)).build();
    }

    @Test
    void answersCacheablePublicClassesForTheInstitute() throws Exception {
        PublicLiveSessionService.Query q = new PublicLiveSessionService.Query("inst-1", Instant.now(), 30, 20);
        when(service.parse("inst-1", null, "30", null)).thenReturn(q);
        when(limiter.tryAcquire("203.0.113.9", "inst-1")).thenReturn(true);
        when(service.list(q)).thenReturn(Map.of("data", List.of(Map.of("session_id", "s-1",
                "registration_url", "https://x.io/register/live-class?sessionId=s-1"))));
        mvc.perform(get(URL).param("instituteId", "inst-1").param("days", "30")
                        .header("X-Forwarded-For", "203.0.113.9, 10.0.0.1"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(jsonPath("$.data[0].session_id").value("s-1"));
    }

    @Test
    void limitsByCloudflareConnectingIpBeforeTheForwardedChain() throws Exception {
        // Behind Cloudflare the first X-Forwarded-For hop can be the edge, shared by many visitors.
        PublicLiveSessionService.Query q = new PublicLiveSessionService.Query("inst-1", Instant.now(), 30, 20);
        when(service.parse(eq("inst-1"), any(), any(), any())).thenReturn(q);
        when(limiter.tryAcquire(anyString(), eq("inst-1"))).thenReturn(true);
        when(service.list(q)).thenReturn(Map.of("data", List.of()));
        mvc.perform(get(URL).param("instituteId", "inst-1")
                        .header("CF-Connecting-IP", "198.51.100.23")
                        .header("X-Forwarded-For", "172.70.1.1, 10.0.0.1"))
                .andExpect(status().isOk());
        verify(limiter).tryAcquire("198.51.100.23", "inst-1");
    }

    @Test
    void fallsBackToTheSocketPeerWithoutForwardingHeaders() throws Exception {
        PublicLiveSessionService.Query q = new PublicLiveSessionService.Query("inst-1", Instant.now(), 30, 20);
        when(service.parse(eq("inst-1"), any(), any(), any())).thenReturn(q);
        when(limiter.tryAcquire(anyString(), eq("inst-1"))).thenReturn(true);
        when(service.list(q)).thenReturn(Map.of("data", List.of()));
        mvc.perform(get(URL).param("instituteId", "inst-1").with(r -> {
                    r.setRemoteAddr("192.0.2.44");
                    return r;
                }))
                .andExpect(status().isOk());
        verify(limiter).tryAcquire("192.0.2.44", "inst-1");
    }

    @Test
    void badQueryIs400AndNotCounted() throws Exception {
        when(service.parse(isNull(), any(), any(), any())).thenThrow(new IllegalArgumentException("instituteId is required."));
        mvc.perform(get(URL))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("instituteId is required."));
        verifyNoInteractions(limiter);
        verify(service, never()).list(any());
    }

    @Test
    void overTheLimitIs429() throws Exception {
        PublicLiveSessionService.Query q = new PublicLiveSessionService.Query("inst-1", Instant.now(), 30, 20);
        when(service.parse(eq("inst-1"), any(), any(), any())).thenReturn(q);
        when(limiter.tryAcquire(anyString(), eq("inst-1"))).thenReturn(false);
        mvc.perform(get(URL).param("instituteId", "inst-1"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "60"));
        verify(service, never()).list(any());
    }
}
