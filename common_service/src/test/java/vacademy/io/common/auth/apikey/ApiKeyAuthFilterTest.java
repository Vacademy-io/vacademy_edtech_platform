package vacademy.io.common.auth.apikey;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import vacademy.io.common.testsupport.ServletFakes.FakeRequest;
import vacademy.io.common.testsupport.ServletFakes.FakeResponse;
import vacademy.io.common.testsupport.ServletFakes.RecordingChain;
import vacademy.io.common.tracing.RequestIds;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiKeyAuthFilterTest {

    private static final String KEY = "vak_eval_0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String EXAMS = "/assessment-service/open/evaluation/v1/exams";
    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Verifier double: answers from a fixed result and records the hashes it was asked about. */
    private static final class StubVerifier implements ApiKeyVerifier {
        final List<String> asked = new ArrayList<>();
        Optional<ApiKeyPrincipal> answer = Optional.empty();
        RuntimeException failure;

        @Override
        public Optional<ApiKeyPrincipal> verify(String keyHash) {
            asked.add(keyHash);
            if (failure != null) {
                throw failure;
            }
            return answer;
        }
    }

    private final StubVerifier verifier = new StubVerifier();
    private final ApiKeyAuthFilter filter = new ApiKeyAuthFilter(verifier, ApiKeyAuthFilter.Settings.builder()
            .pathPrefixes(List.of("/assessment-service/open/"))
            .requiredKeyPathPrefixes(List.of("/assessment-service/open/evaluation/v1/"))
            .exemptPaths(Set.of("/assessment-service/open/evaluation/v1/openapi.json"))
            .requiredProduct("evaluation")
            .clock(Clock.fixed(NOW, ZoneOffset.UTC))
            .build());

    private static ApiKeyPrincipal.ApiKeyPrincipalBuilder activeKey() {
        return ApiKeyPrincipal.builder()
                .keyId("key-1")
                .instituteId("inst-1")
                .name("ERP")
                .products(Set.of("evaluation"))
                .scopes(Set.of("evaluation:read", "evaluation:write"))
                .status("ACTIVE")
                .accessEnabled(true);
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
        MDC.clear();
    }

    private FakeResponse run(FakeRequest request, RecordingChain chain) throws Exception {
        FakeResponse response = new FakeResponse();
        filter.doFilter(request.proxy(), response.proxy(), chain);
        return response;
    }

    private static JsonNode error(FakeResponse response) throws Exception {
        assertTrue(response.contentType.startsWith("application/json"));
        return JSON.readTree(response.bodyText()).get("error");
    }

    @Test
    void pathsOutsideThePrefixAreUntouchedEvenWithAKey() throws Exception {
        RecordingChain chain = new RecordingChain();
        FakeResponse response = run(new FakeRequest("GET", "/assessment-service/assessment/v1/x").header("X-API-Key", "junk"), chain);
        assertTrue(chain.called);
        assertEquals(200, response.status);
        assertTrue(verifier.asked.isEmpty());
    }

    @Test
    void otherOpenPathsWithoutAKeyPassThrough() throws Exception {
        RecordingChain chain = new RecordingChain();
        run(new FakeRequest("GET", "/assessment-service/open/learner/assessment/v1/info"), chain);
        assertTrue(chain.called);
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void missingKeyOnTheEvaluationApiIs401() throws Exception {
        RecordingChain chain = new RecordingChain();
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header(RequestIds.HEADER, "req_partner_1"), chain);
        assertFalse(chain.called);
        assertEquals(401, response.status);
        JsonNode error = error(response);
        assertEquals("missing_api_key", error.get("code").asText());
        assertEquals("req_partner_1", error.get("request_id").asText());
        assertEquals("req_partner_1", response.headers.get(RequestIds.HEADER));
    }

    @Test
    void exemptPathIsUntouched() throws Exception {
        RecordingChain chain = new RecordingChain();
        run(new FakeRequest("GET", "/assessment-service/open/evaluation/v1/openapi.json"), chain);
        assertTrue(chain.called);
    }

    @Test
    void malformedKeyIs401WithoutCallingTheVerifier() throws Exception {
        RecordingChain chain = new RecordingChain();
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", "vak_eval_nothex"), chain);
        assertFalse(chain.called);
        assertEquals(401, response.status);
        assertEquals("invalid_api_key", error(response).get("code").asText());
        assertTrue(verifier.asked.isEmpty());
    }

    @Test
    void unknownKeyIs401AndVerifierIsAskedByHash() throws Exception {
        RecordingChain chain = new RecordingChain();
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", "  " + KEY + " "), chain);
        assertFalse(chain.called);
        assertEquals(401, response.status);
        assertEquals("invalid_api_key", error(response).get("code").asText());
        assertEquals(List.of(ApiKeyFormat.sha256Hex(KEY)), verifier.asked);
        assertFalse(response.bodyText().contains(KEY));
    }

    @Test
    void revokedKeyIs401() throws Exception {
        verifier.answer = Optional.of(activeKey().status("REVOKED").build());
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", KEY), new RecordingChain());
        assertEquals(401, response.status);
        assertEquals("invalid_api_key", error(response).get("code").asText());
    }

    @Test
    void expiredKeyIs401EvenWhenTheVerifierStillReturnsIt() throws Exception {
        verifier.answer = Optional.of(activeKey().expiresAt(NOW.minusSeconds(1)).build());
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", KEY), new RecordingChain());
        assertEquals(401, response.status);
        assertEquals("invalid_api_key", error(response).get("code").asText());
    }

    @Test
    void disabledProductAccessIs403() throws Exception {
        verifier.answer = Optional.of(activeKey().accessEnabled(false).build());
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", KEY), new RecordingChain());
        assertEquals(403, response.status);
        assertEquals("product_not_enabled", error(response).get("code").asText());
    }

    @Test
    void keyForAnotherProductIs403() throws Exception {
        verifier.answer = Optional.of(activeKey().products(Set.of("calling")).build());
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", KEY), new RecordingChain());
        assertEquals(403, response.status);
        assertEquals("product_not_enabled", error(response).get("code").asText());
    }

    @Test
    void verifierOutageIs503NotA401() throws Exception {
        verifier.failure = new ApiKeyVerifierUnavailableException("admin_core down");
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", KEY), new RecordingChain());
        assertEquals(503, response.status);
        assertEquals("auth_unavailable", error(response).get("code").asText());
        assertEquals("5", response.headers.get("Retry-After"));
    }

    @Test
    void unexpectedVerifierFailureIsAlso503() throws Exception {
        verifier.failure = new IllegalStateException("bug");
        FakeResponse response = run(new FakeRequest("GET", EXAMS).header("X-API-Key", KEY), new RecordingChain());
        assertEquals(503, response.status);
        assertEquals("auth_unavailable", error(response).get("code").asText());
    }

    @Test
    void validKeyAuthenticatesForTheChainOnlyAndCarriesNoAuthorities() throws Exception {
        ApiKeyPrincipal principal = activeKey().expiresAt(NOW.plusSeconds(60)).build();
        verifier.answer = Optional.of(principal);
        AtomicReference<Authentication> seen = new AtomicReference<>();
        AtomicReference<String> mdcKeyId = new AtomicReference<>();
        AtomicReference<Object> attribute = new AtomicReference<>();
        RecordingChain chain = new RecordingChain(req -> {
            seen.set(SecurityContextHolder.getContext().getAuthentication());
            mdcKeyId.set(MDC.get(ApiKeyAuthFilter.MDC_KEY_ID));
            attribute.set(req.getAttribute(ApiKeyAuthFilter.PRINCIPAL_ATTRIBUTE));
            assertSame(principal, ApiKeyAuthentication.current().orElseThrow());
        });

        FakeResponse response = run(new FakeRequest("POST", EXAMS).header("x-api-key", KEY), chain);

        assertTrue(chain.called);
        assertEquals(200, response.status);
        ApiKeyAuthentication auth = assertInstanceOf(ApiKeyAuthentication.class, seen.get());
        assertSame(principal, auth.getPrincipal());
        assertTrue(auth.getAuthorities().isEmpty());
        assertNull(auth.getCredentials());
        assertEquals("apikey:key-1", auth.getName());
        assertEquals("key-1", mdcKeyId.get());
        assertSame(principal, attribute.get());
        // Nothing left on the thread afterwards.
        assertNull(SecurityContextHolder.getContext().getAuthentication());
        assertNull(MDC.get(ApiKeyAuthFilter.MDC_KEY_ID));
    }

    @Test
    void percentEncodedPathIsStillCovered() throws Exception {
        RecordingChain chain = new RecordingChain();
        FakeResponse response = run(new FakeRequest("GET", "/assessment-service/%6Fpen/evaluation/v1/exams"), chain);
        assertFalse(chain.called);
        assertEquals(401, response.status);
        assertEquals("missing_api_key", error(response).get("code").asText());
    }

    @Test
    void productCheckCanBeSwitchedOff() throws Exception {
        ApiKeyAuthFilter anyProduct = new ApiKeyAuthFilter(verifier, ApiKeyAuthFilter.Settings.builder()
                .pathPrefixes(List.of("/x/open/"))
                .build());
        verifier.answer = Optional.of(activeKey().accessEnabled(false).products(Set.of()).build());
        RecordingChain chain = new RecordingChain();
        FakeResponse response = new FakeResponse();
        anyProduct.doFilter(new FakeRequest("GET", "/x/open/y").header("X-API-Key", KEY).proxy(), response.proxy(), chain);
        assertTrue(chain.called);
    }

    @Test
    void generatedRequestIdIsUsedWhenNoneArrives() throws Exception {
        FakeResponse response = run(new FakeRequest("GET", EXAMS), new RecordingChain());
        String id = response.headers.get(RequestIds.HEADER);
        assertTrue(id.startsWith("req_"));
        assertEquals(id, error(response).get("request_id").asText());
    }
}
