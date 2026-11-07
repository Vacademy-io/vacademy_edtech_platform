package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * One checkout, one credentials email.
 *
 * A multi-course order activates a UserPlan per course inside a single webhook
 * transaction, and each activation reached the credential mail — so a learner who
 * bought four subjects got four identical "Course Enrollment" emails seconds
 * apart. Identical is the point: that body takes no course argument, so the
 * copies carried nothing the first did not.
 *
 * The claim is transaction-scoped because a transaction is exactly one checkout,
 * and it must be released on completion — the thread is pooled, and a resource
 * left bound would swallow the NEXT learner's credentials.
 */
class CredentialEmailClaimTest {

    private final UserPlanService service = new UserPlanService();

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    /** Runs the synchronizations the way Spring does when a transaction ends. */
    private static void endTransaction() {
        for (TransactionSynchronization sync : TransactionSynchronizationManager.getSynchronizations()) {
            sync.afterCompletion(TransactionSynchronization.STATUS_COMMITTED);
        }
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    @DisplayName("the first course of an order sends; its siblings do not")
    void oneSendPerOrder() {
        TransactionSynchronizationManager.initSynchronization();
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"), "first course sends");
        assertFalse(service.claimCredentialEmail("learner-1", "inst-1"), "second course must not");
        assertFalse(service.claimCredentialEmail("learner-1", "inst-1"));
        assertFalse(service.claimCredentialEmail("learner-1", "inst-1"), "four courses, one email");
        endTransaction();
    }

    @Test
    @DisplayName("a bulk enrolment still emails every learner in it")
    void oneClaimPerLearner() {
        TransactionSynchronizationManager.initSynchronization();
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"));
        assertTrue(service.claimCredentialEmail("learner-2", "inst-1"), "a different learner is a different claim");
        assertTrue(service.claimCredentialEmail("learner-3", "inst-1"));
        assertFalse(service.claimCredentialEmail("learner-2", "inst-1"));
        endTransaction();
    }

    @Test
    @DisplayName("the same learner in a different institute is a different claim")
    void scopedByInstitute() {
        TransactionSynchronizationManager.initSynchronization();
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"));
        assertTrue(service.claimCredentialEmail("learner-1", "inst-2"));
        endTransaction();
    }

    @Test
    @DisplayName("the claim is released, so the next checkout on this thread still sends")
    void releasedOnCompletion() {
        TransactionSynchronizationManager.initSynchronization();
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"));
        assertFalse(service.claimCredentialEmail("learner-1", "inst-1"));
        endTransaction();

        // Same pooled thread, next webhook. A leaked resource would silently
        // swallow this learner's credentials.
        TransactionSynchronizationManager.initSynchronization();
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"),
                "a new transaction must be able to send again");
        endTransaction();
    }

    @Test
    @DisplayName("with no transaction there is nothing to coalesce, so it always sends")
    void noTransactionAlwaysSends() {
        assertFalse(TransactionSynchronizationManager.isSynchronizationActive());
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"));
        assertTrue(service.claimCredentialEmail("learner-1", "inst-1"),
                "outside a transaction the old behaviour stands");
    }
}
