package vacademy.io.admin_core_service.features.site_assistant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogApiService;
import vacademy.io.admin_core_service.features.live_session.service.PublicLiveSessionService;
import vacademy.io.admin_core_service.features.site_assistant.controller.SiteAssistantErrorAdvice;
import vacademy.io.admin_core_service.features.site_assistant.controller.SiteAssistantInternalController;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantLeadService;
import vacademy.io.admin_core_service.features.site_assistant.service.SiteAssistantSiteService;
import vacademy.io.common.auth.filter.InternalAuthFilter;
import vacademy.io.common.auth.service.ClientAuthenticationService;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Routing, internal auth, institute scoping and the error envelope of the Site Assistant internal API. */
class SiteAssistantInternalControllerTest {

    static final String BASE = "/admin-core-service/internal/site-assistant/v1";

    CatalogApiService catalog;
    SiteAssistantLeadService leads;
    SiteAssistantSiteService sites;
    PublicLiveSessionService live;
    ClientAuthenticationService clients;
    MockMvc mvc;

    @BeforeEach
    void setUp() {
        catalog = mock(CatalogApiService.class);
        leads = mock(SiteAssistantLeadService.class);
        sites = mock(SiteAssistantSiteService.class);
        live = mock(PublicLiveSessionService.class);
        clients = mock(ClientAuthenticationService.class);
        when(clients.validateClient("ai_service", "good-signature")).thenReturn(true);
        InternalAuthFilter filter = new InternalAuthFilter();
        ReflectionTestUtils.setField(filter, "clientAuthenticationService", clients);
        mvc = MockMvcBuilders.standaloneSetup(new SiteAssistantInternalController(catalog, leads, sites, live))
                .setControllerAdvice(new SiteAssistantErrorAdvice())
                .addFilters(filter)
                .build();
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    static MockHttpServletRequestBuilder signed(MockHttpServletRequestBuilder b) {
        return b.header("clientName", "ai_service").header("Signature", "good-signature");
    }

    @Test
    void everyRouteIsUnderTheHmacGuardedInternalPrefix() throws Exception {
        String base = SiteAssistantInternalController.class.getAnnotation(RequestMapping.class).value()[0];
        assertTrue(base.startsWith("/admin-core-service/internal/"), base);
        for (String path : List.of("/catalog/site?instituteId=i", "/catalog/courses?instituteId=i",
                "/catalog/courses/c1?instituteId=i", "/catalog/courses/c1/outline?instituteId=i",
                "/catalog/learning-paths?instituteId=i", "/catalog/learning-paths/p1?instituteId=i",
                "/catalog/streams?instituteId=i", "/live-sessions?instituteId=i",
                "/origin-check?instituteId=i&host=x.com", "/resolve-site?host=x.com")) {
            mvc.perform(get(BASE + path)).andExpect(status().isUnauthorized());
            mvc.perform(get(BASE + path).header("clientName", "ai_service").header("Signature", "forged"))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post(BASE + "/leads").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(catalog, leads, sites, live);
    }

    @Test
    void catalogueProxiesUseTheInstituteParamAndTheCatalogueApiQueryRules() throws Exception {
        when(catalog.courses(eq("inst-1"), any())).thenReturn(Map.of("data", List.of(), "total", 0));
        mvc.perform(signed(get(BASE + "/catalog/courses")).param("instituteId", "inst-1")
                        .param("stream", "dharma").param("language", "hi").param("price_max", "500")
                        .param("badge", "free").param("page_size", "4").param("sort", "popular"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
        verify(catalog).courses(eq("inst-1"), argThat(q -> "dharma".equals(q.stream()) && "hi".equals(q.language())
                && "500".equals(q.priceMax()) && "free".equals(q.badge()) && q.pageSize() == 4 && q.page() == 1
                && "popular".equals(q.sort()) && !q.facets()));

        mvc.perform(signed(get(BASE + "/catalog/courses")).param("instituteId", "inst-1").param("page", "two"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"));

        when(catalog.course("inst-1", "c1", "hi")).thenReturn(Map.of("id", "c1"));
        mvc.perform(signed(get(BASE + "/catalog/courses/c1")).param("instituteId", "inst-1").param("language", "hi"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value("c1"));
        when(catalog.outline("inst-1", "c1", null)).thenReturn(Map.of("modules", List.of()));
        mvc.perform(signed(get(BASE + "/catalog/courses/c1/outline")).param("instituteId", "inst-1"))
                .andExpect(status().isOk());
        when(catalog.site("inst-1")).thenReturn(Map.of("name", "Brahm Varchas"));
        mvc.perform(signed(get(BASE + "/catalog/site")).param("instituteId", "inst-1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Brahm Varchas"));
        when(catalog.streams("inst-1")).thenReturn(Map.of("data", List.of()));
        mvc.perform(signed(get(BASE + "/catalog/streams")).param("instituteId", "inst-1")).andExpect(status().isOk());
        when(catalog.learningPaths("inst-1", null)).thenReturn(Map.of("data", List.of()));
        mvc.perform(signed(get(BASE + "/catalog/learning-paths")).param("instituteId", "inst-1")).andExpect(status().isOk());
        when(catalog.learningPath("inst-1", "forbvy")).thenReturn(Map.of("code", "forbvy"));
        mvc.perform(signed(get(BASE + "/catalog/learning-paths/forbvy")).param("instituteId", "inst-1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("forbvy"));

        when(catalog.course("inst-1", "missing", null)).thenThrow(
                new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", "No such course."));
        mvc.perform(signed(get(BASE + "/catalog/courses/missing")).param("instituteId", "inst-1"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    void theInstituteIsRequired() throws Exception {
        for (String path : List.of("/catalog/site", "/catalog/courses", "/catalog/streams", "/origin-check?host=x.com")) {
            mvc.perform(signed(get(BASE + path)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("invalid_request"));
        }
        mvc.perform(signed(get(BASE + "/catalog/site")).param("instituteId", "a b"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(catalog);
    }

    @Test
    void liveSessionsMirrorTheOpenEndpoint() throws Exception {
        PublicLiveSessionService.Query q = new PublicLiveSessionService.Query("inst-1", Instant.now(), 7, 20);
        when(live.parse("inst-1", null, "7", null)).thenReturn(q);
        when(live.list(q)).thenReturn(Map.of("data", List.of(Map.of("session_id", "s-1"))));
        mvc.perform(signed(get(BASE + "/live-sessions")).param("instituteId", "inst-1").param("days", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].session_id").value("s-1"));
        when(live.parse(eq("inst-1"), any(), eq("999"), any())).thenThrow(new IllegalArgumentException("days must be between 1 and 90."));
        mvc.perform(signed(get(BASE + "/live-sessions")).param("instituteId", "inst-1").param("days", "999"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message").value("days must be between 1 and 90."));
    }

    @Test
    void leadsAnswerReceivedOrDuplicate() throws Exception {
        String body = """
                {"institute_id":"inst-1","kind":"SALES","full_name":"Asha","phone":"+91 98765 43210"}
                """;
        when(leads.submit(any())).thenReturn(new SiteAssistantLeadService.Outcome("received", "resp-1"));
        mvc.perform(signed(post(BASE + "/leads")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("received"))
                .andExpect(jsonPath("$.lead_ref").value("resp-1"));
        when(leads.submit(any())).thenReturn(new SiteAssistantLeadService.Outcome("duplicate", null));
        mvc.perform(signed(post(BASE + "/leads")).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("duplicate"))
                .andExpect(jsonPath("$.lead_ref").doesNotExist());
        mvc.perform(signed(post(BASE + "/leads")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"institute_id\":\"inst-1\",\"kind\":\"SALES\",\"full_name\":\"Asha\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.details.param").value("phone"));
    }

    @Test
    void originCheckAndResolveSite() throws Exception {
        when(sites.originAllowed("inst-1", "www.x.com")).thenReturn(true);
        mvc.perform(signed(get(BASE + "/origin-check")).param("instituteId", "inst-1").param("host", "www.x.com"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(true));
        mvc.perform(signed(get(BASE + "/origin-check")).param("instituteId", "inst-1").param("host", "evilx.com"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(false));

        when(sites.resolveSite("learning.brahmvarchas.org", null)).thenReturn(Optional.of(
                new SiteAssistantSiteService.ResolvedSite("2719d8d1-43fd-4f9f-97af-a5b067d770a6", "store")));
        mvc.perform(signed(get(BASE + "/resolve-site")).param("host", "learning.brahmvarchas.org"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.institute_id").value("2719d8d1-43fd-4f9f-97af-a5b067d770a6"))
                .andExpect(jsonPath("$.site_tag").value("store"));
        when(sites.resolveSite(eq("unknown.example.com"), any())).thenReturn(Optional.empty());
        mvc.perform(signed(get(BASE + "/resolve-site")).param("host", "unknown.example.com"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
        mvc.perform(signed(get(BASE + "/resolve-site"))).andExpect(status().isBadRequest());
    }
}
