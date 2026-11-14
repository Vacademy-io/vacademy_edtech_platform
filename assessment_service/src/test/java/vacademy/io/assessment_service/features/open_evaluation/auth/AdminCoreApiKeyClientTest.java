package vacademy.io.assessment_service.features.open_evaluation.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.apikey.ApiKeyVerifierUnavailableException;
import vacademy.io.common.core.internal_api_wrapper.HmacUtils;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** The C2 call: HMAC headers, hash-only body, and which answers mean "unknown" vs "outage". */
class AdminCoreApiKeyClientTest {

    private static final String BASE = "http://admin-core:8072";
    private static final String URL = BASE + AdminCoreApiKeyClient.VERIFY_ROUTE;
    private static final String HASH = "b".repeat(64);

    private MockRestServiceServer server;
    private AdminCoreApiKeyClient client;
    private HmacUtils hmac;

    @BeforeEach
    void setUp() {
        RestTemplate restTemplate = new RestTemplate();
        server = MockRestServiceServer.bindTo(restTemplate).build();
        hmac = mock(HmacUtils.class);
        when(hmac.retrieveSecretKeyFromDatabase("assessment_service")).thenReturn("s3cret");
        client = new AdminCoreApiKeyClient(hmac, restTemplate);
        ReflectionTestUtils.setField(client, "adminCoreBaseUrl", BASE);
        ReflectionTestUtils.setField(client, "clientName", "assessment_service");
    }

    @Test
    void sends_only_the_hash_with_internal_headers_and_maps_the_response() {
        server.expect(requestTo(URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("clientName", "assessment_service"))
                .andExpect(header("Signature", "s3cret"))
                .andExpect(content().json("{\"key_hash\":\"" + HASH + "\"}", true))
                .andRespond(withSuccess("""
                        {"key_id":"k1","institute_id":"inst-1","name":"ERP","products":["evaluation"],
                         "scopes":["evaluation:read"],"status":"ACTIVE","expires_at":"2027-03-31T00:00:00Z",
                         "daily_copy_cap":100,"segment":"school","rate_tier":"high","daily_copy_quota":3000,
                         "daily_identify_pages":5000,"daily_rubric_generations":200,"copy_lane_cap":null,
                         "typed_lane_cap":4,"credit_limit":250.50,"fire_workflow_events":true,
                         "access_enabled":true,"future_field":"ignored"}""", MediaType.APPLICATION_JSON));

        Optional<ApiKeyVerifyResponse> result = client.verify(HASH);

        server.verify();
        assertThat(result).isPresent();
        ApiKeyPrincipal p = result.get().toPrincipal();
        assertThat(p.getKeyId()).isEqualTo("k1");
        assertThat(p.getInstituteId()).isEqualTo("inst-1");
        assertThat(p.hasProduct("evaluation")).isTrue();
        assertThat(p.hasScope("evaluation:read")).isTrue();
        assertThat(p.getExpiresAt()).isEqualTo(Instant.parse("2027-03-31T00:00:00Z"));
        assertThat(p.getDailyCopyCap()).isEqualTo(100);
        assertThat(p.getRateTier()).isEqualTo("high");
        assertThat(p.getTypedLaneCap()).isEqualTo(4);
        assertThat(p.getCopyLaneCap()).isNull();
        assertThat(p.getCreditLimit()).isEqualByComparingTo("250.50");
        assertThat(p.isFireWorkflowEvents()).isTrue();
        assertThat(p.isAccessEnabled()).isTrue();
    }

    @Test
    void not_found_means_unknown_revoked_or_expired() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertThat(client.verify(HASH)).isEmpty();
    }

    @Test
    void bad_request_means_unknown() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST));
        assertThat(client.verify(HASH)).isEmpty();
    }

    @Test
    void server_error_is_an_outage() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        assertThatThrownBy(() -> client.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void refused_hmac_is_an_outage_not_an_unknown_key() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        assertThatThrownBy(() -> client.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void timeout_is_an_outage() {
        server.expect(requestTo(URL)).andRespond(request -> {
            throw new ResourceAccessException("Read timed out");
        });
        assertThatThrownBy(() -> client.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void garbage_body_is_an_outage() {
        server.expect(requestTo(URL)).andRespond(withSuccess("not json", MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> client.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void missing_client_secret_is_an_outage() {
        when(hmac.retrieveSecretKeyFromDatabase("assessment_service")).thenReturn(null);
        assertThatThrownBy(() -> client.verify(HASH)).isInstanceOf(ApiKeyVerifierUnavailableException.class);
    }

    @Test
    void expiry_parsing_accepts_offsets_and_local_times_and_never_makes_garbage_immortal() {
        assertThat(ApiKeyVerifyResponse.parseInstant(null)).isNull();
        assertThat(ApiKeyVerifyResponse.parseInstant("2027-01-01T05:30:00+05:30"))
                .isEqualTo(Instant.parse("2027-01-01T00:00:00Z"));
        assertThat(ApiKeyVerifyResponse.parseInstant("2027-01-01T00:00:00"))
                .isEqualTo(Instant.parse("2027-01-01T00:00:00Z"));
        assertThat(ApiKeyVerifyResponse.parseInstant("tomorrow")).isEqualTo(Instant.EPOCH);
    }

    @Test
    void institute_name_uses_the_short_client_caches_hits_and_never_throws() {
        String url = BASE + AdminCoreApiKeyClient.INSTITUTE_ROUTE + "inst-1";
        server.expect(requestTo(url))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("clientName", "assessment_service"))
                .andExpect(header("Signature", "s3cret"))
                .andRespond(withSuccess("{\"institute_name\":\"Delhi Public School\"}", MediaType.APPLICATION_JSON));

        assertThat(client.instituteName("inst-1")).isEqualTo("Delhi Public School");
        assertThat(client.instituteName("inst-1")).isEqualTo("Delhi Public School"); // cached, no 2nd call
        server.verify();
    }

    @Test
    void institute_name_is_null_when_admin_core_fails_and_the_failure_is_not_cached() {
        String url = BASE + AdminCoreApiKeyClient.INSTITUTE_ROUTE + "inst-2";
        server.expect(requestTo(url)).andRespond(request -> {
            throw new ResourceAccessException("read timed out");
        });
        server.expect(requestTo(url)).andRespond(withSuccess("{\"instituteName\":\"Camel Case School\"}",
                MediaType.APPLICATION_JSON));

        assertThat(client.instituteName("inst-2")).isNull();
        assertThat(client.instituteName("inst-2")).isEqualTo("Camel Case School");
        assertThat(client.instituteName(" ")).isNull();
        server.verify();
    }
}
