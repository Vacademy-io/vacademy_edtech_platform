package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusHistoryRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.util.HashMap;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Every path that marks a person CONVERTED hands them to PersonConversionCloseService; others do not. */
class PersonConversionHooksTest {

    private static final String INST = "inst-1";
    private static final String PERSON = "user-1";

    @ExtendWith(MockitoExtension.class)
    @MockitoSettings(strictness = Strictness.LENIENT)
    @org.junit.jupiter.api.Nested
    class ProfilePaths {
        @Mock UserLeadProfileRepository userLeadProfileRepository;
        @Mock AudienceResponseRepository audienceResponseRepository;
        @Mock LeadStatusRepository leadStatusRepository;
        @Mock LeadStatusMirrorService leadStatusMirrorService;
        @Mock LeadTriggerContextBuilder leadTriggerContextBuilder;
        @Mock WorkflowTriggerService workflowTriggerService;
        @Mock LeadSlaConfigService leadSlaConfigService;
        @InjectMocks UserLeadProfileService service;
        final PersonConversionCloseService closer = mock(PersonConversionCloseService.class);

        @BeforeEach
        void setUp() {
            ReflectionTestUtils.setField(service, "personConversionCloseService", closer);
            UserLeadProfile profile = UserLeadProfile.builder().id("p-1").userId(PERSON).instituteId(INST).build();
            when(userLeadProfileRepository.findByUserIdAndInstituteId(PERSON, INST)).thenReturn(Optional.of(profile));
            when(userLeadProfileRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(userLeadProfileRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
            when(leadStatusRepository.findByInstituteIdOrderByDisplayOrderAsc(INST)).thenReturn(List.of());
            when(leadTriggerContextBuilder.forUser(any(), any(), any(), any())).thenReturn(new HashMap<>());
        }

        @Test
        @DisplayName("enrolment (markConvertedIfExists) closes the person's other enquiries")
        void enrolment() {
            service.markConvertedIfExists(PERSON, INST);
            verify(closer).onPersonConverted(PERSON, INST);
        }

        @Test
        @DisplayName("mark-converted closes the person's other enquiries")
        void markConverted() {
            service.markConverted(PERSON, INST);
            verify(closer).onPersonConverted(PERSON, INST);
        }

        @Test
        @DisplayName("a side-view status change to Converted closes them; to Lost it does not")
        void sideViewStatus() {
            service.updateConversionStatus(PERSON, INST, "LOST", "admin-1");
            verify(closer, never()).onPersonConverted(anyString(), anyString());
            service.updateConversionStatus(PERSON, INST, "converted", "admin-1");
            verify(closer).onPersonConverted(PERSON, INST);
        }
    }

    @ExtendWith(MockitoExtension.class)
    @MockitoSettings(strictness = Strictness.LENIENT)
    @org.junit.jupiter.api.Nested
    class EnquiryStatusPath {
        @Mock LeadStatusRepository leadStatusRepository;
        @Mock LeadStatusHistoryRepository leadStatusHistoryRepository;
        @Mock AudienceResponseRepository audienceResponseRepository;
        @Mock AudienceRepository audienceRepository;
        @Mock WorkflowTriggerService workflowTriggerService;
        @Mock LeadTriggerContextBuilder leadTriggerContextBuilder;
        @Mock TimelineEventService timelineEventService;
        @InjectMocks LeadStatusService service;
        final PersonConversionCloseService closer = mock(PersonConversionCloseService.class);

        @BeforeEach
        void setUp() {
            ReflectionTestUtils.setField(service, "personConversionCloseService", closer);
            ReflectionTestUtils.setField(service, "userLeadProfileService", mock(UserLeadProfileService.class));
            AudienceResponse lead = AudienceResponse.builder().id("ar-1").audienceId("list-1")
                    .userId(PERSON).leadStatusId("st-cb").build();
            when(audienceResponseRepository.findById("ar-1")).thenReturn(Optional.of(lead));
            when(audienceResponseRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            Audience list = new Audience();
            list.setId("list-1");
            list.setInstituteId(INST);
            when(audienceRepository.findById("list-1")).thenReturn(Optional.of(list));
            when(leadStatusRepository.findById("st-conv")).thenReturn(Optional.of(
                    LeadStatus.builder().id("st-conv").instituteId(INST).statusKey("CONVERTED").label("Converted").build()));
            when(leadStatusRepository.findById("st-fu")).thenReturn(Optional.of(
                    LeadStatus.builder().id("st-fu").instituteId(INST).statusKey("FOLLOW_UP").label("Follow Up").build()));
            when(leadTriggerContextBuilder.forLead(any(), any(), any(), any(), any())).thenReturn(new HashMap<>());
        }

        @Test
        @DisplayName("moving an enquiry to Converted closes the person's other enquiries")
        void movedToConverted() {
            service.changeLeadStatus("ar-1", "st-conv", "admin-1", "MANUAL");
            verify(closer).onPersonConverted(PERSON, INST);
        }

        @Test
        @DisplayName("moving an enquiry to any other status does not")
        void movedElsewhere() {
            service.changeLeadStatus("ar-1", "st-fu", "admin-1", "MANUAL");
            verify(closer, never()).onPersonConverted(anyString(), anyString());
        }
    }
}
