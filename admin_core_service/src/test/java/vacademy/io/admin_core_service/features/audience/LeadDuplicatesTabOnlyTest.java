package vacademy.io.admin_core_service.features.audience;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupAction;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupField;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupScope;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.DedupSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDedupSettingService.ReattemptSettings;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * "Show duplicates only in Duplicate Leads" is off unless set, and only counts while dedup
 * is on with "Allow & reassign", so every other institute keeps its lead lists as they are.
 */
class LeadDuplicatesTabOnlyTest {

    private LeadDeduplicationService service;
    private LeadDedupSettingService settings;

    @BeforeEach
    void setUp() throws Exception {
        service = new LeadDeduplicationService();
        for (Field f : LeadDeduplicationService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class)) {
                f.setAccessible(true);
                f.set(service, mock(f.getType()));
            }
        }
        Field f = LeadDeduplicationService.class.getDeclaredField("leadDedupSettingService");
        f.setAccessible(true);
        settings = (LeadDedupSettingService) f.get(service);
    }

    private static ReattemptSettings parse(String reattemptJson) {
        InstituteRepository institutes = mock(InstituteRepository.class);
        Institute institute = new Institute();
        institute.setSetting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"dedup\":{\"enabled\":true,"
                + "\"action\":\"ALLOW_REASSIGN\",\"repeatLead\":{\"reattempt\":" + reattemptJson + "}}}}}}");
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
        return new LeadDedupSettingService(institutes, new ObjectMapper()).get("inst-1").repeatLead().reattempt();
    }

    private void withSettings(boolean enabled, DedupAction action, boolean duplicatesTabOnly) {
        ReattemptSettings reattempt = new ReattemptSettings(true, false, false, true, false, null, true,
                duplicatesTabOnly);
        when(settings.get("inst-1")).thenReturn(new DedupSettings(enabled, DedupField.PHONE, DedupScope.INSTITUTE,
                List.of(), action, new LeadDedupSettingService.RepeatLeadSettings(
                        LeadDedupSettingService.CounsellorMode.SAME_AS_PREVIOUS, null, null,
                        LeadDedupSettingService.StatusMode.KEEP_EXISTING, false, false, reattempt, false)));
    }

    @Test
    void switchIsReadAndDefaultsOff() {
        assertFalse(parse("{\"markDuplicate\":true,\"showBadge\":true}").duplicatesTabOnly());
        assertFalse(parse("{\"duplicatesTabOnly\":\"yes\"}").duplicatesTabOnly());
        assertTrue(parse("{\"duplicatesTabOnly\":true}").duplicatesTabOnly());
        assertFalse(ReattemptSettings.OFF.duplicatesTabOnly());
        // The older constructors keep it off, so existing settings compare equal as before.
        assertEquals(new ReattemptSettings(true, false, false, true, false, null),
                parse("{\"markDuplicate\":true,\"showBadge\":true}"));
    }

    @Test
    void appliesOnlyWithDedupOnAndAllowReassign() {
        withSettings(true, DedupAction.ALLOW_REASSIGN, true);
        assertTrue(service.duplicatesTabOnly("inst-1"));

        withSettings(true, DedupAction.ALLOW_REASSIGN, false);
        assertFalse(service.duplicatesTabOnly("inst-1"));

        withSettings(false, DedupAction.ALLOW_REASSIGN, true);
        assertFalse(service.duplicatesTabOnly("inst-1"));

        withSettings(true, DedupAction.REJECT, true);
        assertFalse(service.duplicatesTabOnly("inst-1"));

        when(settings.get("inst-2")).thenReturn(LeadDedupSettingService.DEFAULTS);
        assertFalse(service.duplicatesTabOnly("inst-2"));
    }
}
