package vacademy.io.admin_core_service.features.credits.service;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SelfSignupTrialGateTest {

    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private final CreditClient credits = mock(CreditClient.class);
    private final SelfSignupTrialGate gate = new SelfSignupTrialGate(jdbc, credits);

    private void pastTrialDate(int count) {
        when(jdbc.queryForObject(eq(SelfSignupTrialGate.SELECT_PAST_TRIAL_DATE), any(SqlParameterSource.class),
                eq(Integer.class))).thenReturn(count);
    }

    @Test
    void notASelfSignupTrial_neverAsksAiService() {
        pastTrialDate(0);
        assertFalse(gate.trialEnded("inst-1"));
        verify(credits, never()).getTrialStatus(anyString());
    }

    @Test
    void trialDatePassed_andNothingBought_isEnded() {
        pastTrialDate(1);
        when(credits.getTrialStatus("inst-1")).thenReturn(Map.of("is_trial", true, "expired", true));
        assertTrue(gate.trialEnded("inst-1"));
    }

    @Test
    void trialDatePassed_butCreditsBought_isNotEnded() {
        pastTrialDate(1);
        when(credits.getTrialStatus("inst-1")).thenReturn(Map.of("is_trial", false, "expired", false));
        assertFalse(gate.trialEnded("inst-1"));
    }

    @Test
    void anyFault_allowsTheCall() {
        pastTrialDate(1);
        when(credits.getTrialStatus("inst-1")).thenReturn(null);
        assertFalse(gate.trialEnded("inst-1"));

        when(jdbc.queryForObject(anyString(), any(SqlParameterSource.class), eq(Integer.class)))
                .thenThrow(new RuntimeException("db down"));
        assertFalse(gate.trialEnded("inst-1"));
        assertFalse(gate.trialEnded(null));
    }
}
