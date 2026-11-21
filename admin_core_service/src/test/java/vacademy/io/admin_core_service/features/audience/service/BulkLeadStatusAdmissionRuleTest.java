package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.dto.BulkLeadStatusRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.BulkLeadStatusResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A bulk move to CONVERTED under BLOCK leaves the people without a course alone and moves the rest. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BulkLeadStatusAdmissionRuleTest {

    @Mock private LeadStatusService leadStatusService;
    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private LeadStatusRepository leadStatusRepository;
    @Mock private AdmissionCourseRuleService admissionCourseRuleService;
    @InjectMocks private BulkLeadStatusService service;

    private static AudienceResponse lead(String id, String statusId) {
        return AudienceResponse.builder().id(id).leadStatusId(statusId).build();
    }

    @Test
    void leadsWithoutACourseAreCountedApartAndNeverMoved() {
        when(leadStatusRepository.existsById("st-won")).thenReturn(true);
        when(audienceResponseRepository.findAllById(any())).thenReturn(List.of(
                lead("r-1", "st-new"), lead("r-2", "st-new"), lead("r-3", "st-won")));
        when(admissionCourseRuleService.refusedForStaff(eq("st-won"), anyCollection())).thenReturn(Set.of("r-2"));
        when(admissionCourseRuleService.refusalMessageFor("st-won"))
                .thenReturn("This person has no course or fee plan here yet.");

        BulkLeadStatusResponseDTO out = service.changeStatusBulk(BulkLeadStatusRequestDTO.builder()
                .responseIds(List.of("r-1", "r-2", "r-3")).statusId("st-won").instituteId("inst-1").build(), null);

        assertThat(out.getUpdated()).isEqualTo(1);
        assertThat(out.getUnchanged()).isEqualTo(1);
        assertThat(out.getFailed()).isEqualTo(1);
        assertThat(out.getBlocked()).isEqualTo(1);
        assertThat(out.getErrors()).containsExactly("This person has no course or fee plan here yet.");
        verify(leadStatusService).changeLeadStatus(eq("r-1"), eq("st-won"), any(), eq("BULK_MANUAL"));
        verify(leadStatusService, never()).changeLeadStatus(eq("r-2"), anyString(), any(), anyString());
    }

    @Test
    void withNothingRefusedEveryLeadMoves() {
        when(leadStatusRepository.existsById("st-int")).thenReturn(true);
        when(audienceResponseRepository.findAllById(any())).thenReturn(List.of(lead("r-1", "st-new")));
        when(admissionCourseRuleService.refusedForStaff(eq("st-int"), anyCollection())).thenReturn(Set.of());

        BulkLeadStatusResponseDTO out = service.changeStatusBulk(BulkLeadStatusRequestDTO.builder()
                .responseIds(List.of("r-1")).statusId("st-int").build(), null);

        assertThat(out.getUpdated()).isEqualTo(1);
        assertThat(out.getBlocked()).isZero();
        assertThat(out.getErrors()).isEmpty();
    }
}
