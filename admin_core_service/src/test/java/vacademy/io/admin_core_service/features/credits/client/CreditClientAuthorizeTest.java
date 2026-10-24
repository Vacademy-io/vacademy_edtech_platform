package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.ExpectedCount.never;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.anything;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * The usage-limit gate on CreditClient: fail open everywhere, no HTTP call for an institute
 * without limits, and the snake_case body the ai_service endpoint reads.
 */
class CreditClientAuthorizeTest {

    private static final String AI = "http://ai.test";
    private static final String AUTHORIZE = AI + "/ai-service/internal/metering/v1/authorize";

    private final RestTemplate shared = new RestTemplate();
    private final RestTemplate limits = new RestTemplate();
    private final RestTemplate rebuild = new RestTemplate();
    private final MockRestServiceServer sharedServer = MockRestServiceServer.bindTo(shared).build();
    private final MockRestServiceServer limitsServer = MockRestServiceServer.bindTo(limits).build();
    private final MockRestServiceServer rebuildServer = MockRestServiceServer.bindTo(rebuild).build();
    private final CreditClient client = new CreditClient(shared, AI, "s3cret", limits, rebuild);

    private static final String BLOCK = """
            {"allow": false, "decision": "BLOCK", "warnings": [], "reservation_id": null,
             "block": {"error": "AI_USAGE_LIMIT", "use_case": "chatbot_flow", "use_case_label": "WhatsApp AI reply",
                       "scope": "USER", "period": "DAY", "limit": 20, "used": 20.4, "unit": "credits",
                       "resets_at": "2026-10-16T00:00:00+05:30", "set_by": "INSTITUTE",
                       "message": "You've reached today's limit for WhatsApp AI reply. It resets at midnight."}}""";

    @Test
    void anInstituteWithoutLimitsCostsNoHttpCall() {
        AiLimitsPolicyIndex index = mock(AiLimitsPolicyIndex.class);
        when(index.mayHaveLimits("inst-1")).thenReturn(false);
        client.setLimitsPolicyIndex(index);
        limitsServer.expect(never(), anything());

        AuthorizeResult r = client.authorize("inst-1", "chatbot_flow", "chatbot", null, "u-1");

        assertSame(AuthorizeResult.ALLOW_NONE, r);
        assertTrue(r.allow());
        assertEquals("NONE", r.decision());
        limitsServer.verify();
        sharedServer.verify(); // nothing on the shared template either
    }

    @Test
    void blankInstituteOrUseCaseIsNeverAsked() {
        limitsServer.expect(never(), anything());
        assertSame(AuthorizeResult.ALLOW_NONE, client.authorize(null, "chatbot_flow", null, null, null));
        assertSame(AuthorizeResult.ALLOW_NONE, client.authorize(" ", "chatbot_flow", null, null, null));
        assertSame(AuthorizeResult.ALLOW_NONE, client.authorize("inst-1", "", null, null, null));
        limitsServer.verify();
    }

    @Test
    void sendsTheSnakeCaseBodyWithTheInternalTokenOnTheLimitsTemplate() {
        AiLimitsPolicyIndex index = mock(AiLimitsPolicyIndex.class);
        when(index.mayHaveLimits("inst-1")).thenReturn(true);
        client.setLimitsPolicyIndex(index);
        limitsServer.expect(requestTo(AUTHORIZE))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","use_case":"learner_analytics","request_type":"analytics",
                         "subject_user_id":"learner-9","estimate_credits":2.5,"reserve":true,
                         "actor_kind":"SYSTEM","actor_role_class":"SYSTEM","surface":"SCHEDULED",
                         "source_service":"admin_core","usage_context":{"subject_user_id":"learner-9"}}""", true))
                .andRespond(withSuccess("{\"allow\":true,\"decision\":\"OK\",\"warnings\":[],\"block\":null}",
                        MediaType.APPLICATION_JSON));

        AuthorizeResult r = client.authorize("inst-1", "learner_analytics", "analytics",
                MeteringFields.system("learner_analytics").subjectUserId("learner-9").build(), null,
                new BigDecimal("2.5"), true);

        assertTrue(r.allow());
        assertEquals("OK", r.decision());
        assertNull(r.block());
        limitsServer.verify();
    }

    @Test
    void actorUserIdGoesTopLevel() {
        Map<String, Object> body = CreditClient.authorizeBody("inst-1", "admin_agent", "agent",
                MeteringFields.user("admin_agent", MeteringFields.SURFACE_ADMIN_APP).build(), "user-7", null, false);
        assertEquals("user-7", body.get("actor_user_id"));
        assertEquals("USER", body.get("actor_kind"));
        assertEquals("ADMIN_APP", body.get("surface"));
        assertEquals(false, body.get("reserve"));
        assertFalse(body.containsKey("estimate_credits"));
        assertFalse(body.containsKey("subject_user_id"));
    }

    @Test
    void aBlockCarriesTheBodyMessageAndReset() {
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withSuccess(BLOCK, MediaType.APPLICATION_JSON));

        AuthorizeResult r = client.authorize("inst-1", "chatbot_flow", "chatbot", null, "u-1");

        assertFalse(r.allow());
        assertTrue(AuthorizeResult.blocks(r));
        assertEquals("BLOCK", r.decision());
        assertEquals("AI_USAGE_LIMIT", r.block().get("error"));
        assertEquals("You've reached today's limit for WhatsApp AI reply. It resets at midnight.", r.message());
        assertEquals(Instant.parse("2026-10-15T18:30:00Z"), r.resetsAt());
    }

    @Test
    void shadowAndWarnAreAllowed() {
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withSuccess(
                "{\"allow\":true,\"decision\":\"WOULD_BLOCK\",\"block\":null}", MediaType.APPLICATION_JSON));
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withSuccess(
                "{\"allow\":true,\"decision\":\"WARN\",\"warnings\":[{\"pct\":85}]}", MediaType.APPLICATION_JSON));

        assertFalse(AuthorizeResult.blocks(client.authorize("inst-1", "chatbot_flow", null, null, null)));
        assertFalse(AuthorizeResult.blocks(client.authorize("inst-1", "chatbot_flow", null, null, null)));
    }

    @Test
    void everyFailureFailsOpen() {
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withServerError());
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withStatus(org.springframework.http.HttpStatus.NOT_FOUND));
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(req -> {
            throw new ResourceAccessException("Read timed out");
        });
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withSuccess("not json", MediaType.APPLICATION_JSON));
        limitsServer.expect(requestTo(AUTHORIZE)).andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        for (int i = 0; i < 5; i++) {
            AuthorizeResult r = client.authorize("inst-1", "chatbot_flow", null, null, null);
            assertTrue(r.allow(), "attempt " + i);
            assertFalse(AuthorizeResult.blocks(r));
        }
        limitsServer.verify();
    }

    @Test
    void aNullResultIsNotABlock() {
        assertFalse(AuthorizeResult.blocks(null));
        AuthorizeResult bare = new AuthorizeResult(false, "BLOCK", null);
        assertEquals(AuthorizeResult.DEFAULT_MESSAGE, bare.message());
        assertNull(bare.resetsAt());
    }

    @Test
    void allowFalseWithoutABlockBodyStillBlocks() {
        AuthorizeResult r = CreditClient.parseAuthorize(Map.of("allow", false, "decision", "BLOCK"));
        assertFalse(r.allow());
        assertEquals(Map.of(), r.block());
        assertEquals(AuthorizeResult.DEFAULT_MESSAGE, r.message());
    }

    @Test
    void theLimitsTemplateHasShortTimeouts() {
        assertTrue(CreditClient.LIMITS_CONNECT_TIMEOUT_MS + CreditClient.LIMITS_READ_TIMEOUT_MS <= 1500);
        // The Spring constructor builds its own short-timeout template, never the shared one.
        RestTemplate sharedOnly = new RestTemplate();
        MockRestServiceServer sharedOnlyServer = MockRestServiceServer.bindTo(sharedOnly).build();
        sharedOnlyServer.expect(never(), anything());
        CreditClient springShaped = new CreditClient(sharedOnly, "http://127.0.0.1:9", "t");
        assertTrue(springShaped.authorize("inst-1", "chatbot_flow", null, null, null).allow(),
                "connection refused = allowed");
        sharedOnlyServer.verify();
    }

    @Test
    void rebuildPostsDaysAndReturnsTheReport() {
        rebuildServer.expect(requestTo(AI + "/ai-service/internal/metering/v1/counters/rebuild?days=35"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andRespond(withSuccess("{\"counters_checked\":12,\"counters_fixed\":1}", MediaType.APPLICATION_JSON));
        rebuildServer.expect(requestTo(AI + "/ai-service/internal/metering/v1/counters/rebuild?days=35"))
                .andRespond(withServerError());

        Map<String, Object> report = client.rebuildUsageCounters(35);
        assertEquals(12, report.get("counters_checked"));
        assertNull(client.rebuildUsageCounters(35), "failure = null, never a throw");
        rebuildServer.verify();
    }

    @Test
    void theExistingCreditCheckIsUntouchedByTheGate() {
        AiLimitsPolicyIndex index = mock(AiLimitsPolicyIndex.class);
        when(index.mayHaveLimits("inst-1")).thenReturn(true);
        client.setLimitsPolicyIndex(index);
        limitsServer.expect(never(), anything());
        sharedServer.expect(requestTo(AI + "/ai-service/credits/v1/check"))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"m","estimated_tokens":10}""",
                        true))
                .andRespond(withSuccess("{\"has_sufficient_credits\":true}", MediaType.APPLICATION_JSON));

        assertTrue(client.checkCredits("inst-1", "analytics", "m", 10));
        sharedServer.verify();
        limitsServer.verify();
    }

    @Test
    void aUsageLimit429OnTheCreditCheckIsAQuietAllow() {
        // ai_service answers /credits/v1/check with 429 AI_USAGE_LIMIT when a limit refuses:
        // an intended refusal (the caller's authorize() decides), not an ERROR to log.
        sharedServer.expect(requestTo(AI + "/ai-service/credits/v1/check"))
                .andRespond(withStatus(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"error\": \"AI_USAGE_LIMIT\", \"scope\": \"USER\", \"message\": \"x\"}"));
        assertTrue(client.checkCredits("inst-1", "analytics", "m", 100));
        sharedServer.verify();
    }

    @Test
    void usageLimitRefusalIsRecognisedOnlyFromItsBody() {
        org.springframework.web.client.HttpClientErrorException limit =
                org.springframework.web.client.HttpClientErrorException.create(
                        org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too Many Requests", null,
                        "{\"error\":\"AI_USAGE_LIMIT\"}".getBytes(), null);
        org.springframework.web.client.HttpClientErrorException other429 =
                org.springframework.web.client.HttpClientErrorException.create(
                        org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too Many Requests", null,
                        "{\"detail\":\"slow down\"}".getBytes(), null);
        org.springframework.web.client.HttpClientErrorException forbidden =
                org.springframework.web.client.HttpClientErrorException.create(
                        org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", null,
                        "{\"error\":\"AI_USAGE_LIMIT\"}".getBytes(), null);
        assertTrue(CreditClient.isUsageLimitRefusal(limit));
        assertFalse(CreditClient.isUsageLimitRefusal(other429));
        assertFalse(CreditClient.isUsageLimitRefusal(forbidden));
    }
}
