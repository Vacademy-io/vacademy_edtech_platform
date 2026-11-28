package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.telephony.core.AiCallService;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

class AiCallingApiServiceTest {

    private final AiCallingApiService service = new AiCallingApiService(null, null, null, null, null, null, null);
    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal("inst-1", "key-1", List.of("calls:write"));

    private static AiAgent agent() {
        AiAgent a = new AiAgent();
        a.setId("agent-1");
        a.setEnabled(true);
        a.setDirection("OUTBOUND");
        return a;
    }

    @Test
    void phoneNumbersMustBeE164AfterRemovingFormatting() {
        assertEquals("+919876543210", AiCallingApiService.normalisePhone("+91 98765-43210"));
        assertEquals("+919876543210", AiCallingApiService.normalisePhone("+91 (98765) 43210"));
        assertEquals("+14155552671", AiCallingApiService.normalisePhone("0014155552671"));
        assertNull(AiCallingApiService.normalisePhone("9876543210"));       // no country code
        assertNull(AiCallingApiService.normalisePhone("+0123456789"));      // country code cannot start with 0
        assertNull(AiCallingApiService.normalisePhone("+12"));              // too short
        assertNull(AiCallingApiService.normalisePhone("+9198765432101234")); // too long
        assertNull(AiCallingApiService.normalisePhone(null));
    }

    @Test
    void theContactUserIdIsStablePerInstituteAndNumber() {
        String a = AiCallingApiService.contactUserId("inst-1", "+919876543210");
        assertEquals(a, AiCallingApiService.contactUserId("inst-1", "+919876543210"));
        assertNotEquals(a, AiCallingApiService.contactUserId("inst-2", "+919876543210"));
        assertNotEquals(a, AiCallingApiService.contactUserId("inst-1", "+919876543211"));
    }

    @Test
    void placeholdersAreFoundInOpeningAndPrompt() {
        Set<String> found = AiCallingApiService.placeholders("Hi {{name}}, about {{ Course }}", "City: {{city}} {{course}}");
        assertEquals(Set.of("name", "course", "city"), found);
    }

    @Test
    void aValidCallPasses() {
        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("course", "NEET");
        vars.put("seats left", 12);
        vars.put("paid", true);
        AiCallingApiService.Validated v = service.validate("inst-1", new AiCallingApiService.CallInput(
                "agent-1", "+91 98765 43210", "  Ravi Kumar ", "ravi@example.com", "crm-42", vars,
                Map.of("deal", "D-9")), agent());
        assertTrue(v.errors().isEmpty(), v.errors().toString());
        assertEquals("+919876543210", v.phone());
        assertEquals("Ravi Kumar", v.name());
        assertEquals(Map.of("course", "NEET", "seats left", "12", "paid", "true"), v.variables());
        assertEquals(Map.of("deal", "D-9"), v.metadata());
    }

    @Test
    void badFieldsAreAllReportedWithTheirNames() {
        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("9lives", "x");                 // must start with a letter
        vars.put("nested", Map.of("a", "b"));    // values are scalars
        vars.put("long", "x".repeat(501));       // too long
        AiCallingApiService.Validated v = service.validate("inst-1", new AiCallingApiService.CallInput(
                "agent-1", "12345", null, "not-an-email", null, vars, null), agent());
        List<String> fields = v.errors().stream().map(e -> e.get("field")).toList();
        assertTrue(fields.contains("phone_number"), fields.toString());
        assertTrue(fields.contains("contact.email"), fields.toString());
        assertTrue(fields.contains("variables.9lives"), fields.toString());
        assertTrue(fields.contains("variables.nested"), fields.toString());
        assertTrue(fields.contains("variables.long"), fields.toString());
    }

    @Test
    void oversizedMetadataIsRefused() {
        AiCallingApiService.Validated v = service.validate("inst-1", new AiCallingApiService.CallInput(
                "agent-1", "+919876543210", null, null, null, null, Map.of("blob", "x".repeat(9000))), agent());
        assertEquals("metadata", v.errors().get(0).get("field"));
    }

    @Test
    void idsCarryTheirPrefix() {
        assertTrue(AiCallingApiService.newId("call_").matches("^call_[0-9a-f]{24}$"));
        assertTrue(AiCallingApiService.newId("batch_").matches("^batch_[0-9a-f]{24}$"));
    }

    @Test
    void idempotencyKeysAreTrimmedAndBounded() {
        assertNull(AiCallingApiService.normaliseIdempotencyKey("  "));
        assertEquals("abc", AiCallingApiService.normaliseIdempotencyKey(" abc "));
        assertThrows(AiCallingApiException.class, () -> AiCallingApiService.normaliseIdempotencyKey("k".repeat(256)));
    }

    @Test
    void aTestCallThatCannotBePlacedLeavesNoRowBehind() {
        AiAgentRepository agents = mock(AiAgentRepository.class);
        AiCallApiCallRepository calls = mock(AiCallApiCallRepository.class);
        AiCallService aiCalls = mock(AiCallService.class);
        when(agents.findByIdAndInstituteId("agent-1", "inst-1")).thenReturn(Optional.of(agent()));
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1")).thenReturn(Optional.empty());
        when(calls.saveAndFlush(any(AiCallApiCall.class))).thenAnswer(i -> i.getArgument(0));
        when(aiCalls.placeCall(any(), isNull(), eq(CallTrigger.API))).thenThrow(new ConflictException("out of credits"));
        AiCallingApiService svc = new AiCallingApiService(agents, calls, null, null, null, aiCalls, null);

        assertThrows(ConflictException.class, () -> svc.createCall(
                new AiCallingApiAuth.Principal("inst-1", "key-1", List.of("calls:write")),
                new AiCallingApiService.CallInput("agent-1", "+919876543210", "Asha", null, null, null, null),
                true, "k-1"));
        // Without the delete, a retry with Idempotency-Key k-1 would replay a call that never happened.
        verify(calls).delete(any(AiCallApiCall.class));
    }

    @Test
    void overLongContactFieldsAreRejected() {
        AiCallingApiService.Validated v = service.validate("inst-1", new AiCallingApiService.CallInput(
                "agent-1", "+919876543210", "x".repeat(121), null, "e".repeat(256), null, null), agent());
        List<String> fields = v.errors().stream().map(e -> e.get("field")).toList();
        assertTrue(fields.contains("contact.name"), fields.toString());
        assertTrue(fields.contains("contact.external_id"), fields.toString());
    }

    @Test
    void reservedVariableNamesAreAcceptedWithAWarning() {
        // Rejecting them (c7ff69b207) broke CRM integrations live since 10-13 that forward
        // fields such as "date" or "Name"; they are kept, and never fill the built-in placeholder.
        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("date", "2026-10-20");
        vars.put("Name", "Ravi");
        vars.put("institute_name", "Shiksha Academy");
        AiCallingApiService.Validated v = service.validate("inst-1", new AiCallingApiService.CallInput(
                "agent-1", "+919876543210", "Asha", null, null, vars, null), agent());
        assertTrue(v.errors().isEmpty(), v.errors().toString());
        assertEquals(Map.of("date", "2026-10-20", "Name", "Ravi", "institute_name", "Shiksha Academy"), v.variables());
        List<String> warned = v.warnings().stream().map(w -> w.get("field")).toList();
        assertEquals(List.of("variables.date", "variables.Name"), warned);
        assertEquals("reserved_variable", v.warnings().get(0).get("code"));
        assertTrue(v.warnings().get(1).get("message").contains("contact.name"), v.warnings().get(1).toString());
    }

    @Test
    void anIdempotencyKeyReusedWithADifferentBodyIsRefused() {
        AiAgentRepository agents = mock(AiAgentRepository.class);
        AiCallApiCallRepository calls = mock(AiCallApiCallRepository.class);
        AiCallApiCall prior = AiCallApiCall.builder().id("call_1").instituteId("inst-1").agentId("agent-1")
                .phoneNumber("+919876543210").contactName("Asha").testMode(true)
                .createdAt(java.time.Instant.now()).build();
        when(calls.findByInstituteIdAndIdempotencyKey("inst-1", "k-1")).thenReturn(Optional.of(prior));
        AiCallingApiService svc = new AiCallingApiService(agents, calls, null, null, null, null, null);
        AiCallingApiAuth.Principal p = new AiCallingApiAuth.Principal("inst-1", "key-1", List.of("calls:write"));
        // Same contact, but live instead of test: a different request.
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> svc.createCall(p,
                new AiCallingApiService.CallInput("agent-1", "+91 98765 43210", "Asha", null, null, null, null),
                false, "k-1"));
        assertEquals("idempotency_key_reused", e.getCode());
        // A different name is a different request too.
        e = assertThrows(AiCallingApiException.class, () -> svc.createCall(p,
                new AiCallingApiService.CallInput("agent-1", "+919876543210", "Ravi", null, null, null, null),
                true, "k-1"));
        assertEquals("idempotency_key_reused", e.getCode());
    }

    // ── Batch Idempotency-Key ──────────────────────────────────────────────────

    private static AiCallingApiService.CallInput row(String phone, String name) {
        return new AiCallingApiService.CallInput("agent-1", phone, name, null, null, null, null);
    }

    private static AiCallApiCall storedRow(String key, int index, String phone, String name, boolean test, Instant at) {
        return AiCallApiCall.builder().id("call_" + index).instituteId("inst-1").batchId("batch_1").agentId("agent-1")
                .phoneNumber(phone).contactName(name).testMode(test).idempotencyKey(key + "#" + index)
                .createdAt(at).build();
    }

    private AiCallingApiService batchService(AiCallApiCallRepository calls, AiCallApiCall... stored) {
        AiAgentRepository agents = mock(AiAgentRepository.class);
        when(agents.findByIdAndInstituteId("agent-1", "inst-1")).thenReturn(Optional.of(agent()));
        when(calls.findByInstituteIdAndIdempotencyKeyStartingWithOrderByCreatedAtAsc("inst-1", "camp#"))
                .thenReturn(List.of(stored));
        return new AiCallingApiService(agents, calls, null, null, null, null, null);
    }

    @Test
    void aBatchKeyLeavesRoomForTheRowIndex() {
        // key#999 must fit idempotency_key VARCHAR(255); a 252+ character key used to 500 on the INSERT.
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> service.createBatch(P, "agent-1",
                List.of(row("+919876543210", null)), false, "k".repeat(252)));
        assertEquals("invalid_request", e.getCode());
        assertEquals(251, AiCallingApiService.MAX_BATCH_IDEMPOTENCY_KEY);
    }

    @Test
    void aBatchKeyReusedForALiveBatchAfterATestOneIsRefused() {
        Instant at = Instant.now().minus(Duration.ofMinutes(30));
        AiCallingApiService svc = batchService(mock(AiCallApiCallRepository.class),
                storedRow("camp", 0, "+919876543210", "Asha", true, at));
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> svc.createBatch(P, "agent-1",
                List.of(row("+919876543210", "Asha")), false, "camp"));
        assertEquals("idempotency_key_reused", e.getCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
    }

    @Test
    void aBatchKeyReusedWithDifferentRowsIsRefused() {
        Instant at = Instant.now().minus(Duration.ofMinutes(30));
        AiCallingApiService svc = batchService(mock(AiCallApiCallRepository.class),
                storedRow("camp", 0, "+919876543210", "Asha", false, at),
                storedRow("camp", 1, "+919812345678", "Ravi", false, at));
        // A different number at index 1.
        assertEquals("idempotency_key_reused", assertThrows(AiCallingApiException.class, () -> svc.createBatch(P,
                "agent-1", List.of(row("+919876543210", "Asha"), row("+919800000000", "Ravi")), false, "camp")).getCode());
        // Fewer rows than were stored.
        assertEquals("idempotency_key_reused", assertThrows(AiCallingApiException.class, () -> svc.createBatch(P,
                "agent-1", List.of(row("+919876543210", "Asha")), false, "camp")).getCode());
    }

    @Test
    void aMatchingBatchReplayReturnsTheSameAcceptedAndRejectedRows() {
        Instant at = Instant.now().minus(Duration.ofMinutes(30));
        AiCallApiCallRepository calls = mock(AiCallApiCallRepository.class);
        AiCallingApiService svc = batchService(calls,
                storedRow("camp", 0, "+919876543210", "Asha", false, at),
                storedRow("camp", 3, "+919811111111", null, false, at));
        Map<String, Object> out = svc.createBatch(P, "agent-1", List.of(
                row("+91 98765 43210", "Asha"),   // 0: stored
                row("12345", null),               // 1: invalid then, invalid now
                row("+919876543210", null),       // 2: duplicate of row 0
                row("+919811111111", null),       // 3: stored
                row("+919822222222", null)),      // 4: valid but never stored (call_failed the first time)
                false, "camp");
        assertEquals(true, out.get("idempotent_replay"));
        assertEquals("batch_1", out.get("id"));
        assertEquals(2, out.get("accepted_count"));
        assertEquals(3, out.get("rejected_count"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rejected = (List<Map<String, Object>>) out.get("rejected");
        assertEquals(List.of(1, 2, 4), rejected.stream().map(r -> r.get("index")).toList());
        assertEquals(List.of("invalid_request", "duplicate_in_batch", "call_not_placed"),
                rejected.stream().map(r -> r.get("code")).toList());
        // A replay never places anything.
        verify(calls, never()).save(any());
        verify(calls, never()).saveAndFlush(any());
    }

    @Test
    void aBatchReplayWhileTheFirstRequestIsStillWritingIsNotAPartialAnswer() {
        AiCallingApiService svc = batchService(mock(AiCallApiCallRepository.class),
                storedRow("camp", 0, "+919876543210", null, false, Instant.now().minusSeconds(3)));
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> svc.createBatch(P, "agent-1",
                List.of(row("+919876543210", null), row("+919822222222", null)), false, "camp"));
        assertEquals("request_in_progress", e.getCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertNotNull(e.getRetryAfterSeconds());
    }

    @Test
    void aBatchFullyStoredReplaysEvenWhileFresh() {
        AiCallingApiService svc = batchService(mock(AiCallApiCallRepository.class),
                storedRow("camp", 0, "+919876543210", null, false, Instant.now().minusSeconds(3)));
        Map<String, Object> out = svc.createBatch(P, "agent-1", List.of(row("+919876543210", null)), false, "camp");
        assertEquals(1, out.get("accepted_count"));
        assertEquals(0, out.get("rejected_count"));
    }
}
