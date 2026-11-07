package vacademy.io.admin_core_service.features.catalog_api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogApiService;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogLeadService;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Routing, auth calls, headers and the error envelope of the public catalogue API. */
class PublicCatalogApiControllerTest {

    static final CatalogApiAuth.Principal READER = new CatalogApiAuth.Principal("inst-1", "key-1",
            List.of(CatalogApiAuth.SCOPE_READ, CatalogApiAuth.SCOPE_LEADS_WRITE));

    CatalogApiAuth auth;
    CatalogApiService service;
    CatalogLeadService leads;
    MockMvc mvc;

    @BeforeEach
    void setUp() {
        auth = mock(CatalogApiAuth.class);
        service = mock(CatalogApiService.class);
        leads = mock(CatalogLeadService.class);
        mvc = MockMvcBuilders.standaloneSetup(new PublicCatalogApiController(auth, service, leads))
                .setControllerAdvice(new CatalogApiErrorAdvice()).build();
    }

    @Test
    void readsAuthenticateWithTheReadScopeAndAreCacheable() throws Exception {
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        when(service.courses(eq("inst-1"), any())).thenReturn(Map.of("data", List.of(), "total", 0));
        mvc.perform(get("/admin-core-service/open/catalog/v1/courses").param("page", "2").param("page_size", "10")
                        .param("stream", "dharma"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(header().string("Vary", "Origin, X-API-Key, Authorization"))
                .andExpect(jsonPath("$.total").value(0));
        verify(service).courses(eq("inst-1"), argThat(q -> q.page() == 2 && q.pageSize() == 10
                && "dharma".equals(q.stream())));
        verify(auth).authenticate(any(), eq(CatalogApiAuth.SCOPE_READ));
    }

    @Test
    void passesTheDiscoveryParametersThrough() throws Exception {
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        when(service.courses(eq("inst-1"), any())).thenReturn(Map.of("data", List.of(), "total", 0));
        mvc.perform(get("/admin-core-service/open/catalog/v1/courses").param("stream", "dharma,shastra")
                        .param("level", "eBook").param("instructor", "Abhishek").param("session", "s-1")
                        .param("badge", "new,free").param("price", "paid").param("price_min", "100")
                        .param("price_max", "500").param("custom", "for:parents").param("facets", "true")
                        .param("sort", "popular"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"));
        verify(service).courses(eq("inst-1"), argThat(q -> "dharma,shastra".equals(q.stream())
                && "eBook".equals(q.level()) && "Abhishek".equals(q.instructor()) && "s-1".equals(q.session())
                && "new,free".equals(q.badge()) && "paid".equals(q.price()) && "100".equals(q.priceMin())
                && "500".equals(q.priceMax()) && "for:parents".equals(q.custom()) && q.facets()
                && "popular".equals(q.sort())));
    }

    @Test
    void facetsDefaultsOffAndRejectsNonBooleans() throws Exception {
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        when(service.courses(eq("inst-1"), any())).thenReturn(Map.of("data", List.of(), "total", 0));
        mvc.perform(get("/admin-core-service/open/catalog/v1/courses")).andExpect(status().isOk());
        verify(service).courses(eq("inst-1"), argThat(q -> !q.facets() && q.level() == null && q.custom() == null));
        mvc.perform(get("/admin-core-service/open/catalog/v1/courses").param("facets", "yes"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"))
                .andExpect(jsonPath("$.error.details.param").value("facets"));
    }

    @Test
    void authErrorsUseTheEnvelope() throws Exception {
        when(auth.authenticate(any(), any())).thenThrow(new CatalogApiException(HttpStatus.UNAUTHORIZED,
                "missing_api_key", "Send your catalogue API key in X-API-Key."));
        mvc.perform(get("/admin-core-service/open/catalog/v1/site"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value("missing_api_key"))
                .andExpect(jsonPath("$.error.request_id").exists());
        verifyNoInteractions(service);
    }

    @Test
    void rateLimitsCarryRetryAfter() throws Exception {
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_LEADS_WRITE))).thenReturn(READER);
        doThrow(new CatalogApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", "Slow down.", null, 42))
                .when(auth).rateLimitLead(any(), any());
        mvc.perform(post("/admin-core-service/open/catalog/v1/leads").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"full_name\":\"A\",\"email\":\"a@b.co\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "42"))
                .andExpect(jsonPath("$.error.code").value("rate_limited"));
        verifyNoInteractions(leads);
    }

    @Test
    void leadsAre201ThenDuplicate200() throws Exception {
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_LEADS_WRITE))).thenReturn(READER);
        when(leads.submit(eq("inst-1"), any())).thenReturn(new CatalogLeadService.Outcome("received"),
                new CatalogLeadService.Outcome("duplicate"));
        String body = "{\"full_name\":\"Asha\",\"email\":\"asha@example.com\"}";
        mvc.perform(post("/admin-core-service/open/catalog/v1/leads").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("received"));
        mvc.perform(post("/admin-core-service/open/catalog/v1/leads").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("duplicate"));
        verify(auth, times(2)).rateLimitLead(eq(READER), any());
    }

    @Test
    void anInvalidLeadIs400() throws Exception {
        when(auth.authenticate(any(), any())).thenReturn(READER);
        mvc.perform(post("/admin-core-service/open/catalog/v1/leads").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"full_name\":\"A\",\"email\":\"nope\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"))
                .andExpect(jsonPath("$.error.details.param").value("email"));
    }

    @Test
    void badNumbersUnknownPathsAndWrongMethods() throws Exception {
        when(auth.authenticate(any(), any())).thenReturn(READER);
        mvc.perform(get("/admin-core-service/open/catalog/v1/courses").param("page", "two"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.details.param").value("page"));
        mvc.perform(get("/admin-core-service/open/catalog/v1/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
        mvc.perform(delete("/admin-core-service/open/catalog/v1/courses/abc"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("method_not_allowed"));
    }

    @Test
    void notFoundFromTheServiceIsTheEnvelopesNotFound() throws Exception {
        when(auth.authenticate(any(), any())).thenReturn(READER);
        when(service.course("inst-1", "x", null)).thenThrow(
                new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", "Course not found."));
        mvc.perform(get("/admin-core-service/open/catalog/v1/courses/x"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.message").value("Course not found."));
    }
}
