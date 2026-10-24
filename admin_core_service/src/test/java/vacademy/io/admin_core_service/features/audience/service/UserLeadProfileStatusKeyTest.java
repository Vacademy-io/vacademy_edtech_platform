package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * A conversion status given as a label or in another spelling is stored as the institute's status
 * key, so reports do not show "Call Back" and "CALL_BACK" as two stages.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UserLeadProfileStatusKeyTest {

    private static final String INST = "inst-1";

    @Mock private LeadStatusRepository leadStatusRepository;
    @InjectMocks private UserLeadProfileService service;

    private void catalog(LeadStatus... statuses) {
        when(leadStatusRepository.findByInstituteIdOrderByDisplayOrderAsc(INST)).thenReturn(List.of(statuses));
    }

    private static LeadStatus status(String key, String label) {
        return LeadStatus.builder().statusKey(key).label(label).instituteId(INST).build();
    }

    @Test
    void keysLabelsAndOtherSpellingsBecomeTheKey() {
        catalog(status("CALL_BACK", "Call Back"), status("CONVERTED", "Admission Taken"),
                status("FOLLOW-UP_REQUIRED", "Follow-up Required"));
        assertThat(service.canonicalStatusKey(INST, "CALL_BACK")).isEqualTo("CALL_BACK");
        assertThat(service.canonicalStatusKey(INST, "Call Back")).isEqualTo("CALL_BACK");
        assertThat(service.canonicalStatusKey(INST, " call-back ")).isEqualTo("CALL_BACK");
        assertThat(service.canonicalStatusKey(INST, "Admission Taken")).isEqualTo("CONVERTED");
        assertThat(service.canonicalStatusKey(INST, "follow up required")).isEqualTo("FOLLOW-UP_REQUIRED");
    }

    @Test
    void unknownValuesAreKeptAndCoreKeysAreUpperCased() {
        catalog(status("CALL_BACK", "Call Back"));
        assertThat(service.canonicalStatusKey(INST, "Something Else")).isEqualTo("Something Else");
        assertThat(service.canonicalStatusKey(INST, "converted")).isEqualTo("CONVERTED");
        assertThat(service.canonicalStatusKey(INST, null)).isNull();
    }
}
