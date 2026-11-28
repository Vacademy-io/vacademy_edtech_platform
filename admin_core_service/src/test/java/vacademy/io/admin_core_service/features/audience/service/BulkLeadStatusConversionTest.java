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

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A bulk move counts a lead that an earlier lead of the same batch already moved as unchanged. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BulkLeadStatusConversionTest {

    @Mock private LeadStatusService leadStatusService;
    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private LeadStatusRepository leadStatusRepository;
    @Mock private AdmissionCourseRuleService admissionCourseRuleService;
    @InjectMocks private BulkLeadStatusService service;

    /** Statuses as the database holds them; the batch read sees them as they were at the start. */
    private final Map<String, String> current = new HashMap<>();

    private static AudienceResponse lead(String id, String statusId) {
        return AudienceResponse.builder().id(id).userId("person-1").leadStatusId(statusId).build();
    }

    private BulkLeadStatusResponseDTO convert(String... ids) {
        return service.changeStatusBulk(BulkLeadStatusRequestDTO.builder()
                .responseIds(List.of(ids)).statusId("st-conv").instituteId("inst-1").build(), null);
    }

    private void given(AudienceResponse... leads) {
        when(leadStatusRepository.existsById("st-conv")).thenReturn(true);
        when(audienceResponseRepository.findAllById(any())).thenReturn(List.of(leads));
        for (AudienceResponse l : leads) current.put(l.getId(), l.getLeadStatusId());
        when(audienceResponseRepository.findCurrentLeadStatusId(anyString()))
                .thenAnswer(inv -> Optional.ofNullable(current.get(inv.<String>getArgument(0))));
        when(admissionCourseRuleService.refusedForStaff(eq("st-conv"), anyCollection())).thenReturn(Set.of());
    }

    @Test
    void aLeadMovedByTheFirstConversionIsUnchangedAndNotMovedAgain() {
        given(lead("r-1", "st-new"), lead("r-2", "st-cb"));
        // Converting r-1 converts the person, and their other enquiry r-2 moves to Converted too.
        when(leadStatusService.changeLeadStatus(eq("r-1"), eq("st-conv"), any(), anyString())).thenAnswer(inv -> {
            current.put("r-1", "st-conv");
            current.put("r-2", "st-conv");
            return null;
        });

        BulkLeadStatusResponseDTO out = convert("r-1", "r-2");

        assertThat(out.getUpdated()).isEqualTo(1);
        assertThat(out.getUnchanged()).isEqualTo(1);
        assertThat(out.getFailed()).isZero();
        verify(leadStatusService, times(1)).changeLeadStatus(eq("r-1"), eq("st-conv"), any(), anyString());
        verify(leadStatusService, never()).changeLeadStatus(eq("r-2"), anyString(), any(), anyString());
    }

    @Test
    void leadsStillOnTheirOldStatusAllMove() {
        given(lead("r-1", "st-new"), lead("r-2", "st-cb"));

        BulkLeadStatusResponseDTO out = convert("r-1", "r-2");

        assertThat(out.getUpdated()).isEqualTo(2);
        assertThat(out.getUnchanged()).isZero();
        verify(leadStatusService).changeLeadStatus(eq("r-2"), eq("st-conv"), any(), anyString());
    }

    @Test
    void aLeadThatCannotBeReadAgainStillGoesThroughTheSinglePath() {
        given(lead("r-1", "st-new"));
        when(audienceResponseRepository.findCurrentLeadStatusId("r-1")).thenThrow(new RuntimeException("timeout"));

        BulkLeadStatusResponseDTO out = convert("r-1");

        assertThat(out.getUpdated()).isEqualTo(1);
        verify(leadStatusService).changeLeadStatus(eq("r-1"), eq("st-conv"), any(), anyString());
    }
}
