package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** AI decisions pause only on a balance read as used up; an unreadable balance never pauses. */
class EngagementCreditGateTest {

    private EngagementCreditGate gate(Optional<Double> balance, boolean enabled) {
        CreditClient credits = mock(CreditClient.class);
        when(credits.readBalance("i1")).thenReturn(balance);
        EngagementCreditGate gate = new EngagementCreditGate(credits);
        ReflectionTestUtils.setField(gate, "pauseDecisionsWhenEmpty", enabled);
        return gate;
    }

    @Test
    void pausesAtZeroOrBelow() {
        assertTrue(gate(Optional.of(0.0), true).decisionsPaused("i1"));
        assertTrue(gate(Optional.of(-3.5), true).decisionsPaused("i1"));
        assertFalse(gate(Optional.of(0.01), true).decisionsPaused("i1"));
    }

    @Test
    void unreadableBalanceOrSwitchedOffNeverPauses() {
        assertFalse(gate(Optional.empty(), true).decisionsPaused("i1"));
        assertFalse(gate(Optional.of(0.0), false).decisionsPaused("i1"));
        CreditClient broken = mock(CreditClient.class);
        when(broken.readBalance(any())).thenThrow(new RuntimeException("down"));
        EngagementCreditGate g = new EngagementCreditGate(broken);
        ReflectionTestUtils.setField(g, "pauseDecisionsWhenEmpty", true);
        assertFalse(g.decisionsPaused("i1"));
        assertTrue(g.balance("i1").isEmpty());
    }
}
