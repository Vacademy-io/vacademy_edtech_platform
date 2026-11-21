package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Closing a converted person's other enquiries is on unless the institute switched it off. */
class LeadConversionCloseSettingTest {

    private final InstituteRepository institutes = mock(InstituteRepository.class);
    private final LeadFollowupSettingService settings = new LeadFollowupSettingService(institutes, new ObjectMapper());

    private void setting(String json) {
        Institute institute = new Institute();
        institute.setSetting(json);
        when(institutes.findById("inst-1")).thenReturn(Optional.of(institute));
    }

    @Test
    @DisplayName("on when nothing is saved, or the lead settings do not mention it")
    void onByDefault() {
        setting(null);
        assertThat(settings.closeOtherEnquiriesOnConversion("inst-1")).isTrue();
        setting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"followUpFields\":{\"allowEditing\":true}}}}}");
        assertThat(settings.closeOtherEnquiriesOnConversion("inst-1")).isTrue();
    }

    @Test
    @DisplayName("off only when the institute set it to false")
    void offWhenSwitchedOff() {
        setting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"closeOtherEnquiriesOnConversion\":false}}}}");
        assertThat(settings.closeOtherEnquiriesOnConversion("inst-1")).isFalse();
        setting("{\"setting\":{\"LEAD_SETTING\":{\"data\":{\"closeOtherEnquiriesOnConversion\":true}}}}");
        assertThat(settings.closeOtherEnquiriesOnConversion("inst-1")).isTrue();
    }
}
