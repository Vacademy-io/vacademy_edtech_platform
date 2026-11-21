package vacademy.io.notification_service.features.email_billing;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static vacademy.io.notification_service.features.email_billing.EmailBillingClass.*;

class EmailBillingClassifierTest {

    private static final String INST = "inst-1";

    @Test
    void mailWithoutAnInstituteIsPlatformMail() {
        assertEquals(EXCLUDED, EmailBillingClassifier.classify(null, BILLABLE, "unified-send"));
        assertEquals(EXCLUDED, EmailBillingClassifier.classify(" ", null, "OTP_SERVICE"));
    }

    @Test
    void anExplicitClassWins() {
        assertEquals(ESSENTIAL, EmailBillingClassifier.classify(INST, ESSENTIAL, "unified-send"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, FREE, "ENGAGEMENT_ENGINE"));
    }

    @Test
    void engagementEngineMailIsAlreadyChargedElsewhere() {
        assertEquals(EXCLUDED, EmailBillingClassifier.classify(INST, null, "ENGAGEMENT_ENGINE"));
    }

    @Test
    void accountAccessIsFree() {
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "OTP_SERVICE"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "auth-service"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "AI_CREDIT_PACK_CONFIRMATION"));
    }

    @Test
    void proofOfPaymentIsEssential() {
        assertEquals(ESSENTIAL, EmailBillingClassifier.classify(INST, null, "INVOICE"));
        assertEquals(ESSENTIAL, EmailBillingClassifier.classify(INST, null, "SCHOOL_FEE_RECEIPT"));
        assertEquals(ESSENTIAL, EmailBillingClassifier.classify(INST, null, "application_fee_receipt"));
    }

    @Test
    void aTemplateCarryingLoginDetailsIsFree() {
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "announcement-service",
                "Your login", "<p>Username {{username}}, password {{password}}</p>"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "WORKFLOW",
                "Reset", "<a href='{{ reset_password_link }}'>reset</a>"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, null, "{{PASSWORD}}", null));
    }

    @Test
    void adminCoreEventSourcesAreRecognised() {
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "event:LEARNER_PASSWORD_RESET"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "event:LEARNER_CREDENTIALS_SHARED"));
        assertEquals(FREE, EmailBillingClassifier.classify(INST, null, "event:TEAM_INVITE"));
        assertEquals(ESSENTIAL, EmailBillingClassifier.classify(INST, null, "event:PAYMENT_SUCCESS"));
        assertEquals(ESSENTIAL, EmailBillingClassifier.classify(INST, null, "event:SCHOOL_FEE_RECEIPT"));
        assertEquals(BILLABLE, EmailBillingClassifier.classify(INST, null, "event:LIVE_CLASS_ON_LIVE"));
        assertEquals(BILLABLE, EmailBillingClassifier.classify(INST, null, "event:PAYMENT_FAILED"));
    }

    @Test
    void everythingElseIsBillable() {
        assertEquals(BILLABLE, EmailBillingClassifier.classify(INST, null, "unified-send"));
        assertEquals(BILLABLE, EmailBillingClassifier.classify(INST, null, null, "Webinar today",
                "<p>Join at 6 pm. Forgot your password? Ask us.</p>"));
        assertEquals(BILLABLE, EmailBillingClassifier.classify(INST, EmailBillingClass.parse("nonsense"), "AUDIENCE"));
    }

    @Test
    void unitsCountEveryCopyAndEveryFullMegabyte() {
        assertEquals(1, EmailUnits.of(null, 0));
        assertEquals(3, EmailUnits.of(List.of("a@x.com", " a@x.com ", "b@x.com", ""), 0));
        assertEquals(1, EmailUnits.of(List.of(), EmailUnits.MIB - 1));      // a small PDF costs nothing extra
        assertEquals(2, EmailUnits.of(List.of(), EmailUnits.MIB));
        assertEquals(6, EmailUnits.of(List.of("a@x.com"), 2 * EmailUnits.MIB + 5)); // 2 copies x (1 + 2 MiB)
        assertEquals(3, EmailUnits.ofCount(2, 0));
        assertEquals(10, EmailUnits.attachmentBytes(Map.of("a.pdf", new byte[4], "b.pdf", new byte[6])));
    }
}
