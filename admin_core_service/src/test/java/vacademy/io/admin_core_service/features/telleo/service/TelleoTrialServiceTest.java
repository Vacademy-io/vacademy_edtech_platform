package vacademy.io.admin_core_service.features.telleo.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telleo.service.TelleoTrialService.TrialInfo;
import vacademy.io.admin_core_service.features.telleo.service.TelleoTrialService.Verdict;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The one-number trial rule (TELLEO_SELF_SIGNUP_PLAN.md section 7). */
class TelleoTrialServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-11T10:00:00Z");
    private static final Instant NEXT_WEEK = NOW.plus(7, ChronoUnit.DAYS);

    private static TrialInfo trial(String phone, Instant ends) {
        return new TrialInfo("inst-1", TelleoTrialService.TRIAL, phone, ends);
    }

    @Test
    void trialMayCallItsVerifiedNumberInAnyFormat() {
        TrialInfo info = trial("+919876543210", NEXT_WEEK);
        assertEquals(Verdict.ALLOW, TelleoTrialService.verdictFor(info, "+919876543210", NOW));
        assertEquals(Verdict.ALLOW, TelleoTrialService.verdictFor(info, "9876543210", NOW));
        assertEquals(Verdict.ALLOW, TelleoTrialService.verdictFor(info, "09876543210", NOW));
        assertEquals(Verdict.ALLOW, TelleoTrialService.verdictFor(info, "91 98765 43210", NOW));
    }

    @Test
    void trialMayNotCallAnyOtherNumber() {
        TrialInfo info = trial("+919876543210", NEXT_WEEK);
        assertEquals(Verdict.NUMBER_NOT_ALLOWED, TelleoTrialService.verdictFor(info, "+919876543211", NOW));
        assertEquals(Verdict.NUMBER_NOT_ALLOWED, TelleoTrialService.verdictFor(info, null, NOW));
        assertEquals(Verdict.NUMBER_NOT_ALLOWED, TelleoTrialService.verdictFor(info, "abc", NOW));
    }

    @Test
    void trialWithoutAVerifiedPhoneCallsNobody() {
        assertEquals(Verdict.NUMBER_NOT_ALLOWED,
                TelleoTrialService.verdictFor(trial(null, NEXT_WEEK), "+919876543210", NOW));
    }

    @Test
    void endedTrialCallsNobodyNotEvenItsOwnNumber() {
        TrialInfo info = trial("+919876543210", NOW.minusSeconds(1));
        assertEquals(Verdict.TRIAL_ENDED, TelleoTrialService.verdictFor(info, "+919876543210", NOW));
        assertTrue(Verdict.TRIAL_ENDED.blocksInstitute());
    }

    @Test
    void trialEndsExactlyAtItsEndTime() {
        assertEquals(Verdict.TRIAL_ENDED,
                TelleoTrialService.verdictFor(trial("+919876543210", NOW), "+919876543210", NOW));
    }

    @Test
    void liveAccountsCallAnyone() {
        TrialInfo live = new TrialInfo("inst-1", TelleoTrialService.LIVE, "+919876543210", NOW.minusSeconds(60));
        assertEquals(Verdict.ALLOW, TelleoTrialService.verdictFor(live, "+911234567890", NOW));
    }

    @Test
    void suspendedAccountsCallNobody() {
        TrialInfo suspended = new TrialInfo("inst-1", TelleoTrialService.SUSPENDED, "+919876543210", NEXT_WEEK);
        assertEquals(Verdict.SUSPENDED, TelleoTrialService.verdictFor(suspended, "+919876543210", NOW));
        assertTrue(Verdict.SUSPENDED.blocksInstitute());
    }

    @Test
    void wrongNumberHoldsOnlyThatCall() {
        assertFalse(Verdict.NUMBER_NOT_ALLOWED.blocksInstitute());
        assertEquals(TelleoTrialService.CODE_TRIAL_NUMBER, Verdict.NUMBER_NOT_ALLOWED.code);
    }
}
