package vacademy.io.admin_core_service.features.institute_learner.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupAction;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupField;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupScope;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupSettings;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The open assessment register page skips the "Self Sign-ups" lead only where the institute's
 * de-duplication would otherwise reject the test's own lead list entry.
 */
class OpenStudentSelfSignupLeadTest {

    private static DedupSettings settings(boolean enabled, DedupField field, DedupScope scope,
                                          List<String> audienceIds, DedupAction action) {
        return new DedupSettings(enabled, field, scope, audienceIds, action,
                LeadDedupSettingService.DEFAULT_REPEAT_LEAD);
    }

    @Test
    void institutePhoneDedupThatRejectsSkipsTheSelfSignupLead() {
        assertTrue(StudentRegistrationManager.blocksTestLead(
                settings(true, DedupField.PHONE, DedupScope.INSTITUTE, Collections.emptyList(), DedupAction.REJECT)));
    }

    @Test
    void instituteEmailDedupThatRejectsSkipsTheSelfSignupLead() {
        assertTrue(StudentRegistrationManager.blocksTestLead(
                settings(true, DedupField.EMAIL, DedupScope.INSTITUTE, Collections.emptyList(), DedupAction.REJECT)));
    }

    @Test
    void dedupSwitchedOffKeepsTheSelfSignupLead() {
        assertFalse(StudentRegistrationManager.blocksTestLead(LeadDedupSettingService.DEFAULTS));
        assertFalse(StudentRegistrationManager.blocksTestLead(
                settings(false, DedupField.PHONE, DedupScope.INSTITUTE, Collections.emptyList(), DedupAction.REJECT)));
    }

    @Test
    void reassignInsteadOfRejectKeepsTheSelfSignupLead() {
        assertFalse(StudentRegistrationManager.blocksTestLead(
                settings(true, DedupField.PHONE, DedupScope.INSTITUTE, Collections.emptyList(),
                        DedupAction.ALLOW_REASSIGN)));
    }

    @Test
    void dedupLimitedToOneListOrSelectedListsKeepsTheSelfSignupLead() {
        // CAMPAIGN only compares leads inside the test's own list, so the Self Sign-ups lead
        // never collides. SELECTED keeps the behaviour it had before this check existed.
        assertFalse(StudentRegistrationManager.blocksTestLead(
                settings(true, DedupField.PHONE, DedupScope.CAMPAIGN, Collections.emptyList(), DedupAction.REJECT)));
        assertFalse(StudentRegistrationManager.blocksTestLead(
                settings(true, DedupField.PHONE, DedupScope.SELECTED, List.of("some-list"), DedupAction.REJECT)));
    }

    @Test
    void missingSettingsKeepTheSelfSignupLead() {
        assertFalse(StudentRegistrationManager.blocksTestLead(null));
    }
}
