package vacademy.io.assessment_service.features.open_evaluation.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.auth.AdminCoreApiKeyClient;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiGateFilter;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenEvaluationExceptionHandler;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenEvaluationRoutingErrorAdvice;
import vacademy.io.assessment_service.features.open_evaluation.quota.ApiQuotaService;
import vacademy.io.assessment_service.features.open_evaluation.ratelimit.ApiRateLimiter;
import vacademy.io.assessment_service.features.open_evaluation.ratelimit.OpenApiRateLimitInterceptor;
import vacademy.io.common.auth.apikey.ApiKeyAuthFilter;
import vacademy.io.common.auth.apikey.ApiKeyFormat;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.apikey.ApiKeyVerifier;
import vacademy.io.common.auth.apikey.ApiKeyVerifierUnavailableException;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The partner stack end to end, minus Spring Boot: kill switch → key filter (common) →
 * rate-limit interceptor → GET /me → error envelope.
 */
class OpenEvaluationStackTest {

    private static final String KEY = "vak_eval_" + "0123456789abcdef".repeat(3);
    private static final String ME = OpenApiPaths.BASE + "/me";

    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final Map<String, ApiKeyPrincipal> keys = new java.util.HashMap<>();
    private final AtomicBoolean keyStoreDown = new AtomicBoolean(false);
    private ApiQuotaService quota;
    private AdminCoreApiKeyClient adminCore;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        quota = mock(ApiQuotaService.class);
        adminCore = mock(AdminCoreApiKeyClient.class);
        when(quota.usageToday("inst-1")).thenReturn(new ApiQuotaService.Usage(LocalDate.of(2026, 10, 1), 42, 0, 0, 0, 0));
        when(quota.resetsAt()).thenReturn(Instant.parse("2026-10-02T00:00:00Z"));
        when(adminCore.instituteName("inst-1")).thenReturn("Delhi Public School");

        keys.put(ApiKeyFormat.sha256Hex(KEY), principal("standard", true));

        ApiKeyVerifier verifier = hash -> {
            if (keyStoreDown.get()) {
                throw new ApiKeyVerifierUnavailableException("down");
            }
            return Optional.ofNullable(keys.get(hash));
        };
        ApiKeyAuthFilter keyFilter = new ApiKeyAuthFilter(verifier, ApiKeyAuthFilter.Settings.builder()
                .pathPrefixes(List.of(OpenApiPaths.OPEN_PREFIX))
                .requiredKeyPathPrefixes(List.of(OpenApiPaths.PREFIX))
                .exemptPaths(Set.of(OpenApiPaths.OPENAPI_JSON))
                .requiredProduct(OpenApiPaths.PRODUCT)
                .build());

        mvc = MockMvcBuilders.standaloneSetup(new OpenEvaluationMeController(quota, adminCore),
                        new DashboardStub())
                .setControllerAdvice(new OpenEvaluationExceptionHandler(), new OpenEvaluationRoutingErrorAdvice())
                .addInterceptors(new OpenApiRateLimitInterceptor(new ApiRateLimiter(
                        java.time.Clock.fixed(Instant.parse("2026-10-01T10:00:00Z"), java.time.ZoneOffset.UTC), 2)))
                .addFilters(new OpenApiGateFilter(enabled::get), keyFilter)
                .build();
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static ApiKeyPrincipal principal(String tier, boolean accessEnabled) {
        return ApiKeyPrincipal.builder()
                .keyId("k1").instituteId("inst-1").name("ERP prod")
                .products(List.of("evaluation")).scopes(List.of("evaluation:write", "evaluation:read"))
                .status("ACTIVE").rateTier(tier).dailyCopyQuota(3000).dailyCopyCap(500)
                .accessEnabled(accessEnabled).build();
    }

    @Test
    void me_returns_the_key_institute_and_todays_usage() throws Exception {
        mvc.perform(get(ME).header("X-API-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.key_id").value("k1"))
                .andExpect(jsonPath("$.name").value("ERP prod"))
                .andExpect(jsonPath("$.institute_id").value("inst-1"))
                .andExpect(jsonPath("$.institute_name").value("Delhi Public School"))
                .andExpect(jsonPath("$.scopes", containsInAnyOrder("evaluation:read", "evaluation:write")))
                .andExpect(jsonPath("$.rate_tier").value("standard"))
                .andExpect(jsonPath("$.daily_copy_quota").value(3000))
                .andExpect(jsonPath("$.daily_copy_cap").value(500))
                .andExpect(jsonPath("$.quota_used_today").value(42))
                .andExpect(header().string("RateLimit-Limit", notNullValue()))
                .andExpect(header().string("RateLimit-Remaining", notNullValue()))
                .andExpect(header().string("RateLimit-Reset", notNullValue()))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void no_key_is_401_missing_api_key_in_the_envelope() throws Exception {
        mvc.perform(get(ME))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("missing_api_key"))
                .andExpect(jsonPath("$.error.request_id", startsWith("req_")))
                .andExpect(header().exists("X-Request-Id"));
    }

    @Test
    void a_dashboard_jwt_alone_is_refused() throws Exception {
        mvc.perform(get(ME).header("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("missing_api_key"));
    }

    @Test
    void unknown_and_malformed_keys_get_the_same_401() throws Exception {
        mvc.perform(get(ME).header("X-API-Key", "vak_eval_" + "f".repeat(48)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("invalid_api_key"));
        mvc.perform(get(ME).header("X-API-Key", "not-a-key"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("invalid_api_key"));
    }

    @Test
    void product_not_enabled_is_403() throws Exception {
        keys.put(ApiKeyFormat.sha256Hex(KEY), principal("standard", false));
        mvc.perform(get(ME).header("X-API-Key", KEY))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("product_not_enabled"));
    }

    @Test
    void key_store_outage_is_503_auth_unavailable() throws Exception {
        keyStoreDown.set(true);
        mvc.perform(get(ME).header("X-API-Key", KEY))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("auth_unavailable"))
                .andExpect(header().exists("Retry-After"));
    }

    @Test
    void kill_switch_off_hides_the_api_as_404() throws Exception {
        enabled.set(false);
        mvc.perform(get(ME).header("X-API-Key", KEY))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    void reads_beyond_the_per_pod_share_are_429_with_retry_after() throws Exception {
        // standard: 20 reads/s per key, 2 pods → 10 per pod per second (clock is frozen).
        for (int i = 0; i < 10; i++) {
            mvc.perform(get(ME).header("X-API-Key", KEY)).andExpect(status().isOk());
        }
        mvc.perform(get(ME).header("X-API-Key", KEY))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("rate_limited"))
                .andExpect(header().exists("Retry-After"))
                .andExpect(header().string("RateLimit-Remaining", "0"));
    }

    /** Stands in for a dashboard controller outside the partner base path. */
    @org.springframework.web.bind.annotation.RestController
    static class DashboardStub {
        @org.springframework.web.bind.annotation.GetMapping("/assessment-service/admin/stub")
        String stub() {
            return "ok";
        }
    }

    @Test
    void unknown_partner_route_is_404_endpoint_not_found_in_the_envelope() throws Exception {
        mvc.perform(get(OpenApiPaths.BASE + "/no-such-thing").header("X-API-Key", KEY))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("endpoint_not_found"))
                .andExpect(jsonPath("$.error.request_id", notNullValue()))
                .andExpect(header().string("X-Request-Id", notNullValue()));
    }

    @Test
    void wrong_method_on_a_partner_route_is_405_in_the_envelope_with_allow() throws Exception {
        mvc.perform(post(ME).header("X-API-Key", KEY))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("method_not_allowed"))
                .andExpect(header().string("Allow", org.hamcrest.Matchers.containsString("GET")));
    }

    @Test
    void dashboard_routing_errors_keep_springs_default_handling() throws Exception {
        mvc.perform(post("/assessment-service/admin/stub"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                        .string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("request_id"))));
        mvc.perform(get("/assessment-service/admin/nothing-here"))
                .andExpect(status().isNotFound())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                        .string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("request_id"))));
    }
}
