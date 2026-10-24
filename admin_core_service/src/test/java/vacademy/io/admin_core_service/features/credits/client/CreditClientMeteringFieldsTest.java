package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * Usage-metering fields on the credit calls. The legacy signatures must send exactly the
 * body they always sent (strict JSON: no new keys, no nulls), and the metering overloads
 * must only ADD keys, never change a ledger field.
 */
class CreditClientMeteringFieldsTest {

    private static final String AI = "http://ai.test";
    private static final String DEDUCT = AI + "/ai-service/credits/v1/deduct";
    private static final String CHECK = AI + "/ai-service/credits/v1/check";
    private static final String OK = "{\"success\": true, \"credits_deducted\": 1, \"new_balance\": 9, \"message\": \"ok\"}";

    private final RestTemplate restTemplate = new RestTemplate();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
    private final CreditClient client = new CreditClient(restTemplate, AI, "s3cret");

    // ── legacy signatures: byte-for-byte the old body ───────────────────────

    @Test
    void legacyTokenDeductSendsExactlyTheOldBody() {
        server.expect(requestTo(DEDUCT))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"m",
                         "prompt_tokens":10,"completion_tokens":5,"usage_log_id":""}""", true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        client.deductCredits("inst-1", "analytics", "m", 10, 5, null);
        server.verify();
    }

    @Test
    void legacyPrecomputedDeductSendsExactlyTheOldBody() {
        server.expect(requestTo(DEDUCT))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"report","model":"system",
                         "precomputed_credits":2.5,"description":"Weekly report",
                         "idempotency_key":"report:r-1","allow_negative":true,"user_role":"SYSTEM"}""", true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        assertTrue(client.deductPrecomputed("inst-1", "report", "Weekly report", new BigDecimal("2.5"), "report:r-1"));
        server.verify();
    }

    @Test
    void legacyAttributedDeductSendsExactlyTheOldBody() {
        server.expect(requestTo(DEDUCT))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"chatbot","model":"m",
                         "prompt_tokens":1,"completion_tokens":2,"allow_negative":true,
                         "usage_log_id":"u-1","user_id":"user-1","user_role":"LEARNER",
                         "subject_user_id":"user-1","description":"d","batch_id":"flow-1"}""", true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        assertTrue(client.deductAttributedTokenUsage("inst-1", "chatbot", "m", 1, 2,
                "u-1", "user-1", "LEARNER", "user-1", "d", "flow-1"));
        server.verify();
    }

    @Test
    void legacyCheckSendsExactlyTheOldBody() {
        server.expect(requestTo(CHECK))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"m","estimated_tokens":100}""",
                        true))
                .andRespond(withSuccess("{\"has_sufficient_credits\": true}", MediaType.APPLICATION_JSON));

        assertTrue(client.checkCredits("inst-1", "analytics", "m", 100));
        server.verify();
    }

    @Test
    void aNullMeteringArgumentIsTheLegacyBody() {
        server.expect(requestTo(DEDUCT))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"m",
                         "prompt_tokens":10,"completion_tokens":5,"usage_log_id":""}""", true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        client.deductCredits("inst-1", "analytics", "m", 10, 5, null, null);
        server.verify();
    }

    // ── metering overloads: additive only ───────────────────────────────────

    @Test
    void systemJobMeteringAddsFieldsAndKeepsTheLedgerSubjectOut() {
        server.expect(requestTo(DEDUCT))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"m",
                         "prompt_tokens":10,"completion_tokens":5,"usage_log_id":"",
                         "use_case":"learner_analytics","actor_kind":"SYSTEM","actor_role_class":"SYSTEM",
                         "surface":"SCHEDULED","source_service":"admin_core",
                         "usage_context":{"subject_user_id":"learner-1"}}""", true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        client.deductCredits("inst-1", "analytics", "m", 10, 5, null,
                MeteringFields.system("learner_analytics").subjectUserId("learner-1").build());
        server.verify();
    }

    @Test
    void meteringNeverOverridesALedgerField() {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("flow_id", "flow-1");
        ctx.put("blank", " ");
        server.expect(requestTo(DEDUCT))
                .andExpect(jsonPath("$.user_id").value("user-1"))
                .andExpect(jsonPath("$.user_role").value("LEARNER"))
                .andExpect(jsonPath("$.subject_user_id").value("user-1"))
                .andExpect(jsonPath("$.batch_id").value("flow-1"))
                .andExpect(jsonPath("$.allow_negative").value(true))
                .andExpect(jsonPath("$.idempotency_key").doesNotExist())
                .andExpect(jsonPath("$.use_case").value("chatbot_flow"))
                .andExpect(jsonPath("$.surface").value("WHATSAPP"))
                .andExpect(jsonPath("$.actor_roles_raw[0]").value("STUDENT"))
                .andExpect(jsonPath("$.usage_context.flow_id").value("flow-1"))
                .andExpect(jsonPath("$.usage_context.subject_user_id").value("someone-else"))
                .andExpect(jsonPath("$.usage_context.blank").doesNotExist())
                .andExpect(jsonPath("$.router").doesNotExist())
                .andExpect(jsonPath("$.byo_key").doesNotExist())
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        MeteringFields m = MeteringFields.builder()
                .useCase("chatbot_flow")
                .surface("WHATSAPP")
                .actorRolesRaw(List.of("STUDENT"))
                .subjectUserId("someone-else")
                .router(" ")
                .usageContext(ctx)
                .build();
        assertTrue(client.deductAttributedTokenUsage("inst-1", "chatbot", "m", 1, 2,
                "u-1", "user-1", "LEARNER", "user-1", "d", "flow-1", null, true, m));
        server.verify();
    }

    @Test
    void precomputedMeteringKeepsUserRoleSystem() {
        server.expect(requestTo(DEDUCT))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"ai_call_out","model":"system",
                         "precomputed_credits":4,"description":"AI call minutes",
                         "idempotency_key":"ai_call:1","allow_negative":true,"user_role":"SYSTEM",
                         "use_case":"ai_calling","actor_kind":"SYSTEM","actor_role_class":"SYSTEM",
                         "surface":"PHONE","source_service":"admin_core",
                         "usage_context":{"ai_call_result_id":"r-1"}}""", true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        assertTrue(client.deductPrecomputed("inst-1", "ai_call_out", "AI call minutes", new BigDecimal("4"),
                "ai_call:1", MeteringFields.system("ai_calling").surface("PHONE")
                        .usageContext(Map.of("ai_call_result_id", "r-1")).build()));
        server.verify();
    }

    @Test
    void checkWithMeteringAddsOnlyMeteringKeys() {
        server.expect(requestTo(CHECK))
                .andExpect(content().json("""
                        {"institute_id":"inst-1","request_type":"analytics","model":"m","estimated_tokens":100,
                         "use_case":"learner_analytics","actor_kind":"SYSTEM","actor_role_class":"SYSTEM",
                         "surface":"SCHEDULED","source_service":"admin_core"}""", true))
                .andRespond(withSuccess("{\"has_sufficient_credits\": false}", MediaType.APPLICATION_JSON));

        assertFalse(client.checkCredits("inst-1", "analytics", "m", 100,
                MeteringFields.system("learner_analytics").build()));
        server.verify();
    }

    @Test
    void applyToWithNullFieldsLeavesTheBodyAlone() {
        Map<String, Object> body = new HashMap<>(Map.of("institute_id", "i"));
        MeteringFields.applyTo(null, body);
        MeteringFields.applyTo(MeteringFields.builder().build(), body);
        assertEquals(Map.of("institute_id", "i"), body);
    }

    @Test
    void displayNamesAreClampedToTheColumnWidth() {
        Map<String, Object> body = new HashMap<>();
        MeteringFields.applyTo(MeteringFields.builder().actorDisplayName("x".repeat(300)).build(), body);
        assertEquals(255, ((String) body.get("actor_display_name")).length());
    }
}
