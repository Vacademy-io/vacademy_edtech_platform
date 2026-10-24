package vacademy.io.admin_core_service.features.super_admin.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * The dashboard SQL is glued from text blocks, and a text block drops the trailing
 * space of every line: "SELECT """ + ENGINE_SQL became SELECTCASE and took the
 * whole calls summary down. Check the SQL each endpoint actually sends.
 */
class SuperAdminCallSqlShapeTest {

    private static final Pattern GLUED = Pattern.compile("(?i)(SELECT|FROM|WHERE|JOIN|END|AND|OR|ON)(CASE|SELECT|COUNT|AS\\b|r\\.)");

    private static final Pattern BIND = Pattern.compile(
            ":(instituteId|fromTs|toTs|health|disposition|agentId|lim|off|pulse|inst|frm|to|agt)\\b");

    @Test
    void everyQueryKeepsItsWordsApart() {
        EntityManager em = mock(EntityManager.class);
        Query q = mock(Query.class, RETURNS_SELF);
        when(em.createNativeQuery(anyString())).thenReturn(q);
        when(q.getResultList()).thenReturn(List.of());
        when(q.getSingleResult()).thenReturn(0L);
        SuperAdminCallService svc = new SuperAdminCallService();
        ReflectionTestUtils.setField(svc, "em", em);

        try { svc.summary(null, null, null, null, null, null); } catch (RuntimeException ignored) { }
        try { svc.list(null, null, null, null, null, null, 0, 5); } catch (RuntimeException ignored) { }
        try { svc.ttsCacheSummary(null, null, null, null); } catch (RuntimeException ignored) { }

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(em, atLeastOnce()).createNativeQuery(sql.capture());
        List<String> calls = sql.getAllValues().stream().filter(s -> s.contains("ai_call_result")).toList();
        assertTrue(calls.size() >= 3, "summary, list and tts-cache queries were captured");
        for (String s : calls) {
            assertFalse(GLUED.matcher(s).find(), () -> "glued keywords in: " + s);
            assertTrue(s.contains("IS DISTINCT FROM 'MOCK'"), "mock calls stay out, NULL providers stay in");
            // Hibernate reads any ':' as a parameter marker: only real binds may carry one.
            String unbound = BIND.matcher(s).replaceAll("");
            assertFalse(unbound.contains(":"), () -> "bare ':' (use chr(58) or CAST) in: " + s);
        }
        // The list and the summary decide "which legs are still estimated" with the SAME
        // predicates, or a row and the total it rolls into disagree.
        List<String> ledgered = calls.stream().filter(s -> s.contains("credit_transactions")).toList();
        assertTrue(ledgered.size() >= 2, "list and summary both join the ledger");
        for (String s : ledgered) {
            assertTrue(s.contains(SuperAdminCallService.VOICE_PENDING_SQL), "voice-leg predicate shared");
            assertTrue(s.contains(SuperAdminCallService.AI_PENDING_SQL), "AI-leg predicate shared");
        }
    }
}
