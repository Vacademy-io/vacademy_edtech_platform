package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
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
 * The plan pre-check on CreditClient: no HTTP call without a LIVE plan, covered only on
 * explicit evidence, "not covered" (= today's wallet rule) on every failure; and the roll call.
 */
class CreditClientPlanCoverTest {

    private static final String AI = "http://ai.test";
    private static final String CHECK = AI + "/ai-service/credits/v1/check";
    private static final String ROLL = AI + "/ai-service/internal/plans/v1/roll";

    private final RestTemplate shared = new RestTemplate();
    private final RestTemplate limits = new RestTemplate();
    private final RestTemplate rebuild = new RestTemplate();
    private final MockRestServiceServer sharedServer = MockRestServiceServer.bindTo(shared).build();
    private final MockRestServiceServer limitsServer = MockRestServiceServer.bindTo(limits).build();
    private final MockRestServiceServer rebuildServer = MockRestServiceServer.bindTo(rebuild).build();
    private final CreditClient client = new CreditClient(shared, AI, "s3cret", limits, rebuild);

    private void livePlanFor(String institute) {
        AiPlanSubscriptionIndex index = mock(AiPlanSubscriptionIndex.class);
        when(index.mayHaveLivePlan(institute)).thenReturn(true);
        client.setPlanSubscriptionIndex(index);
    }

    private boolean ask() {
        return client.planCovers("inst-1", "chatbot", null, 900, "u-1",
                MeteringFields.builder().useCase("chatbot_flow").actorKind("USER").actorRoleClass("LEARNER").build());
    }

    @Test
    void withoutALivePlanThereIsNoHttpCallAndNoCover() {
        limitsServer.expect(never(), anything());
        assertFalse(ask(), "no index wired (plain tests) = never covered");

        AiPlanSubscriptionIndex index = mock(AiPlanSubscriptionIndex.class);
        when(index.mayHaveLivePlan("inst-1")).thenReturn(false);
        client.setPlanSubscriptionIndex(index);
        assertFalse(ask());
        assertFalse(client.planCovers(null, "chatbot", null, 1, null, null));
        assertFalse(client.planCovers("inst-1", " ", null, 1, null, null));
        limitsServer.verify();
        sharedServer.verify();
    }

    @Test
    void asksThePlanAwareCheckWithTheTokenOnTheShortTimeoutTemplate() {
        livePlanFor("inst-1");
        limitsServer.expect(requestTo(CHECK))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"","estimated_tokens":1,
                         "user_id":"admin-1","subject_user_id":"learner-9","use_case":"student_report",
                         "actor_kind":"USER","surface":"ADMIN_APP"}"""))
                .andRespond(withSuccess("""
                        {"has_sufficient_credits":true,"current_balance":0,"estimated_cost":0.4,
                         "balance_after":0,"message":"Sufficient credits available (included in the AI plan)."}""",
                        MediaType.APPLICATION_JSON));
        assertTrue(client.planCovers("inst-1", "analytics", null, 0, "admin-1",
                MeteringFields.user("student_report", MeteringFields.SURFACE_ADMIN_APP)
                        .subjectUserId("learner-9").build()));
        limitsServer.verify();
        sharedServer.verify(); // nothing on the shared (no-timeout) template
    }

    @Test
    void coveredOnlyOnExplicitEvidence() {
        assertTrue(CreditClient.isPlanCovered(resp(true, 0, 0.4, "INCLUDED", null)));
        assertTrue(CreditClient.isPlanCovered(resp(true, -5, 2, "allowance", null)));
        assertTrue(CreditClient.isPlanCovered(resp(true, 0, 0, null, true)), "plan_covered flag");
        assertTrue(CreditClient.isPlanCovered(resp(true, 0, 0.4, null, null)),
                "sufficient with balance < cost: today's comparison can never say that");

        Map<String, Object> coveredShape = resp(true, 50, 0.4, null, null);
        coveredShape.put("balance_after", 50);
        assertTrue(CreditClient.isPlanCovered(coveredShape),
                "ai_service's covered answer leaves balance_after = balance");
        Map<String, Object> todayShape = resp(true, 50, 0.4, null, null);
        todayShape.put("balance_after", 49.6);
        assertFalse(CreditClient.isPlanCovered(todayShape), "today's answer: the wallet pays");

        assertFalse(CreditClient.isPlanCovered(resp(true, 0, 0, null, null)), "0 >= 0 is today's answer");
        Map<String, Object> zeroCost = resp(true, 0, 0, null, null);
        zeroCost.put("balance_after", 0);
        assertFalse(CreditClient.isPlanCovered(zeroCost), "a free estimate proves nothing");
        assertFalse(CreditClient.isPlanCovered(resp(true, 10, 0.4, null, null)), "the wallet paid");
        assertFalse(CreditClient.isPlanCovered(resp(true, 0, 0.4, "CHARGED", null)));
        assertFalse(CreditClient.isPlanCovered(resp(true, 0, 0.4, "SPLIT", null)), "part of it is the wallet's");
        assertFalse(CreditClient.isPlanCovered(resp(false, 0, 0.4, "INCLUDED", null)), "insufficient wins");
        assertFalse(CreditClient.isPlanCovered(resp(null, 0, 0.4, null, null)));
        assertFalse(CreditClient.isPlanCovered(Map.of()));
        assertFalse(CreditClient.isPlanCovered(null));
        Map<String, Object> odd = resp(true, null, null, null, null);
        odd.put("current_balance", "abc");
        assertFalse(CreditClient.isPlanCovered(odd));
    }

    @Test
    void everyFailureIsNotCovered() {
        livePlanFor("inst-1");
        limitsServer.expect(requestTo(CHECK)).andRespond(withServerError());
        limitsServer.expect(requestTo(CHECK)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        limitsServer.expect(requestTo(CHECK)).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
                .contentType(MediaType.APPLICATION_JSON).body("{\"error\":\"AI_USAGE_LIMIT\"}"));
        limitsServer.expect(requestTo(CHECK)).andRespond(req -> {
            throw new ResourceAccessException("Read timed out");
        });
        limitsServer.expect(requestTo(CHECK)).andRespond(withSuccess("not json", MediaType.APPLICATION_JSON));
        limitsServer.expect(requestTo(CHECK)).andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        limitsServer.expect(requestTo(CHECK)).andRespond(withSuccess(
                "{\"has_sufficient_credits\":false,\"current_balance\":0,\"estimated_cost\":0.4}",
                MediaType.APPLICATION_JSON));
        for (int i = 0; i < 7; i++) {
            assertFalse(ask(), "attempt " + i);
        }
        limitsServer.verify();
    }

    @Test
    void rollPostsToTheInternalEndpointAndNeverThrows() {
        rebuildServer.expect(requestTo(ROLL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andRespond(withSuccess("{\"ok\":true,\"periods_created\":2}", MediaType.APPLICATION_JSON));
        rebuildServer.expect(requestTo(ROLL)).andRespond(withServerError());
        rebuildServer.expect(requestTo(ROLL)).andRespond(req -> {
            throw new ResourceAccessException("Connection refused");
        });
        Map<String, Object> report = client.rollAiPlans();
        assertEquals(2, report.get("periods_created"));
        assertNull(client.rollAiPlans());
        assertNull(client.rollAiPlans());
        rebuildServer.verify();
        limitsServer.verify();
    }

    private static Map<String, Object> resp(Boolean sufficient, Number balance, Number cost, String mode,
            Boolean planCovered) {
        Map<String, Object> m = new HashMap<>();
        if (sufficient != null) m.put("has_sufficient_credits", sufficient);
        if (balance != null) m.put("current_balance", balance);
        if (cost != null) m.put("estimated_cost", cost);
        if (mode != null) m.put("billing_mode", mode);
        if (planCovered != null) m.put("plan_covered", planCovered);
        return m;
    }
}
