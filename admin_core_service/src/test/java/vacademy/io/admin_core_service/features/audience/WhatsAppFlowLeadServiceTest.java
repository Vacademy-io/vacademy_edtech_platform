package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.dto.WhatsAppFlowLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.WhatsAppFlowLeadResultDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.audience.service.WhatsAppFlowLeadService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * WhatsApp chatbot → CRM lead rules: one lead per phone per institute (any list), repeat contacts
 * recorded on the existing lead, answers written without overwriting a known lead's data, and
 * status/workflows only for a lead the conversation created.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class WhatsAppFlowLeadServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "447911123456";
    private static final String LAST10 = "7911123456";

    @Mock private AudienceService audienceService;
    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private AudienceRepository audienceRepository;
    @Mock private CustomFieldValuesRepository customFieldValuesRepository;
    @Mock private CustomFieldRepository customFieldRepository;
    @Mock private TimelineEventService timelineEventService;
    @Mock private LeadStatusService leadStatusService;
    @Mock private LeadStatusRepository leadStatusRepository;
    @Mock private PlaceholderEmailService placeholderEmailService;
    @Mock private AuthService authService;

    @InjectMocks
    private WhatsAppFlowLeadService service;

    private final List<CustomFieldValues> savedValues = new ArrayList<>();

    @BeforeEach
    void setUp() {
        when(audienceResponseRepository.findChatbotLeadMatchByInstituteAndPhoneLast10(anyString(), anyString()))
                .thenReturn(List.of());
        when(audienceResponseRepository.findResponseIdByInstituteAndUser(anyString(), anyString()))
                .thenReturn(List.of());
        when(placeholderEmailService.synthesize(isNull(), anyString(), isNull())).thenReturn("lead447911123456@leads.test");
        when(authService.createUserFromAuthService(any(UserDTO.class), eq(INSTITUTE), eq(false)))
                .thenReturn(UserDTO.builder().id("user-new").build());
        when(audienceRepository.findById("aud-1"))
                .thenReturn(Optional.of(Audience.builder().id("aud-1").instituteId(INSTITUTE)
                        .campaignType("WHATSAPP_FLOW").build()));
        when(audienceRepository.findById("aud-web"))
                .thenReturn(Optional.of(Audience.builder().id("aud-web").instituteId(INSTITUTE)
                        .campaignType("WEBSITE").build()));
        when(customFieldRepository.existsById(anyString())).thenReturn(true);
        when(customFieldValuesRepository.save(any(CustomFieldValues.class))).thenAnswer(inv -> {
            savedValues.add(inv.getArgument(0));
            return inv.getArgument(0);
        });
    }

    private static WhatsAppFlowLeadRequestDTO.WhatsAppFlowLeadRequestDTOBuilder request() {
        return WhatsAppFlowLeadRequestDTO.builder()
                .instituteId(INSTITUTE).phone(PHONE).name("Asha").flowId("flow-1").flowName("Enquiry")
                .messageText("Hi, enquiry");
    }

    private AudienceResponse lead(String id, String status) {
        AudienceResponse lead = AudienceResponse.builder().id(id).audienceId("aud-1").userId("user-" + id)
                .parentName("Asha Patel").parentMobile(PHONE).audienceStatus(status).build();
        when(audienceResponseRepository.findById(id)).thenReturn(Optional.of(lead));
        return lead;
    }

    private void phoneMatches(AudienceResponse lead) {
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[]{lead.getId(), lead.getUserId(), lead.getAudienceStatus()});
        when(audienceResponseRepository.findChatbotLeadMatchByInstituteAndPhoneLast10(INSTITUTE, LAST10))
                .thenReturn(rows);
    }

    // ==================== check ====================

    @Test
    @DisplayName("Phone already a lead in any list → EXISTING, repeat contact on the timeline, nothing created")
    void existingByPhone() {
        AudienceResponse existing = lead("resp-1", "ACTIVE");
        phoneMatches(existing);

        WhatsAppFlowLeadResultDTO result = service.checkOrCreate(request().build());

        assertThat(result.getResult()).isEqualTo("EXISTING");
        assertThat(result.getResponseId()).isEqualTo("resp-1");
        assertThat(result.isRevived()).isFalse();
        verify(audienceResponseRepository).acquireTransactionLock("whatsapp-flow-lead:" + INSTITUTE + ":" + LAST10);
        verify(audienceService, never()).createWhatsAppFlowLead(any(), any(), any(), any(), any());
        verify(authService, never()).createUserFromAuthService(any(), any(), eq(false));
        verify(timelineEventService).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("resp-1"),
                eq(LeadJourneyActionType.RE_ENQUIRY), eq("SYSTEM"), isNull(), anyString(),
                eq("Contacted again on WhatsApp"), anyString(), any(), eq("user-resp-1"));
    }

    @Test
    @DisplayName("A soft-deleted match is brought back, not duplicated")
    void softDeletedMatchIsRevived() {
        AudienceResponse deleted = lead("resp-1", "INACTIVE");
        phoneMatches(deleted);

        WhatsAppFlowLeadResultDTO result = service.checkOrCreate(request().build());

        assertThat(result.getResult()).isEqualTo("EXISTING");
        assertThat(result.isRevived()).isTrue();
        assertThat(deleted.getAudienceStatus()).isEqualTo("ACTIVE");
        verify(audienceResponseRepository).save(deleted);
        verify(audienceService, never()).createWhatsAppFlowLead(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("Lead found through the phone's user (parent_mobile empty) → EXISTING")
    void existingByUser() {
        when(authService.createUserFromAuthService(any(UserDTO.class), eq(INSTITUTE), eq(false)))
                .thenReturn(UserDTO.builder().id("user-resp-2").build());
        lead("resp-2", "ACTIVE");
        when(audienceResponseRepository.findResponseIdByInstituteAndUser(INSTITUTE, "user-resp-2"))
                .thenReturn(List.of("resp-2"));

        WhatsAppFlowLeadResultDTO result = service.checkOrCreate(request().build());

        assertThat(result.getResult()).isEqualTo("EXISTING");
        assertThat(result.getResponseId()).isEqualTo("resp-2");
        verify(audienceService, never()).createWhatsAppFlowLead(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("New phone → lead created in WhatsApp Leads; user keyed on the phone, not the name")
    void newLead() {
        when(audienceService.createWhatsAppFlowLead(INSTITUTE, "user-new", PHONE, "Asha", "flow-1"))
                .thenReturn(new AudienceService.InboundCallLeadRef("resp-new", "user-new", "aud-wa"));

        WhatsAppFlowLeadResultDTO result = service.checkOrCreate(request().build());

        assertThat(result.getResult()).isEqualTo("NEW");
        assertThat(result.getResponseId()).isEqualTo("resp-new");
        assertThat(result.getAudienceId()).isEqualTo("aud-wa");
        ArgumentCaptor<UserDTO> user = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).createUserFromAuthService(user.capture(), eq(INSTITUTE), eq(false));
        assertThat(user.getValue().getEmail()).isEqualTo("lead447911123456@leads.test");
        assertThat(user.getValue().getMobileNumber()).isEqualTo(PHONE);
        assertThat(user.getValue().getFullName()).isEqualTo("Asha");
        verify(timelineEventService, never()).logJourneyEvent(any(), any(), eq(LeadJourneyActionType.RE_ENQUIRY),
                any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("+44 / 07… / 447… formats all match on the same last 10 digits")
    void phoneFormatsMatchOnLastTen() {
        AudienceResponse existing = lead("resp-1", "ACTIVE");
        phoneMatches(existing);

        for (String phone : List.of("+44 7911 123456", "07911 123456", "447911123456")) {
            WhatsAppFlowLeadResultDTO result = service.checkOrCreate(request().phone(phone).build());
            assertThat(result.getResult()).as(phone).isEqualTo("EXISTING");
        }
    }

    @Test
    @DisplayName("Missing institute or a non-phone → rejected")
    void invalidRequest() {
        assertThatThrownBy(() -> service.checkOrCreate(request().phone("abc").build()))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.checkOrCreate(request().instituteId(null).build()))
                .isInstanceOf(VacademyException.class);
    }

    // ==================== save ====================

    @Test
    @DisplayName("Lead this chat created → answers replace earlier ones and new fields are attached to the list")
    void saveOverwritesForNewLead() {
        lead("resp-1", "ACTIVE");
        CustomFieldValues year = CustomFieldValues.builder().customFieldId("cf-year").sourceType("AUDIENCE_RESPONSE")
                .sourceId("resp-1").value("YEAR_4").build();
        when(customFieldValuesRepository.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                "cf-year", "AUDIENCE_RESPONSE", "resp-1")).thenReturn(Optional.of(year));

        WhatsAppFlowLeadResultDTO result = service.save(request().responseId("resp-1").overwrite(true)
                .fieldValues(Map.of("cf-year", "YEAR_5")).build());

        assertThat(result.getSavedFields()).isEqualTo(1);
        assertThat(year.getValue()).isEqualTo("YEAR_5");
        verify(audienceService).attachFieldToLeadList(INSTITUTE, "aud-1", "cf-year", 10);
        verify(audienceResponseRepository, never()).acquireTransactionLock(anyString());
    }

    @Test
    @DisplayName("Lead that already existed → only empty fields are filled, recorded values stay")
    void saveFillsBlanksOnlyForExistingLead() {
        lead("resp-1", "ACTIVE");
        CustomFieldValues year = CustomFieldValues.builder().customFieldId("cf-year").sourceType("AUDIENCE_RESPONSE")
                .sourceId("resp-1").value("YEAR_4").build();
        when(customFieldValuesRepository.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                "cf-year", "AUDIENCE_RESPONSE", "resp-1")).thenReturn(Optional.of(year));
        when(customFieldValuesRepository.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                "cf-postcode", "AUDIENCE_RESPONSE", "resp-1")).thenReturn(Optional.empty());

        WhatsAppFlowLeadResultDTO result = service.save(request().responseId("resp-1").overwrite(false)
                .fieldValues(Map.of("cf-year", "YEAR_6", "cf-postcode", "CM1 1AA")).build());

        assertThat(year.getValue()).isEqualTo("YEAR_4");
        assertThat(result.getSavedFields()).isEqualTo(1);
        assertThat(savedValues).extracting(CustomFieldValues::getCustomFieldId).containsExactly("cf-postcode");
    }

    @Test
    @DisplayName("Existing lead in another list → value stored, but that campaign's form is NOT given a new field")
    void existingLeadInOtherListDoesNotChangeItsForm() {
        AudienceResponse webLead = AudienceResponse.builder().id("resp-web").audienceId("aud-web")
                .userId("user-web").parentName("Asha").parentMobile(PHONE).audienceStatus("ACTIVE").build();
        when(audienceResponseRepository.findById("resp-web")).thenReturn(Optional.of(webLead));
        when(customFieldValuesRepository.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                "cf-postcode", "AUDIENCE_RESPONSE", "resp-web")).thenReturn(Optional.empty());

        WhatsAppFlowLeadResultDTO result = service.save(request().responseId("resp-web").overwrite(false)
                .fieldValues(Map.of("cf-postcode", "CM1 1AA")).build());

        assertThat(result.getSavedFields()).isEqualTo(1);
        assertThat(savedValues).extracting(CustomFieldValues::getValue).containsExactly("CM1 1AA");
        verify(audienceService, never()).attachFieldToLeadList(any(), any(), any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    @DisplayName("Completing a new lead sets the configured status and fires the lead workflows")
    void completeNewLeadSetsStatusAndFiresWorkflow() {
        lead("resp-1", "ACTIVE");
        when(leadStatusRepository.findByInstituteIdAndStatusKey(INSTITUTE, "DIAGNOSTIC_PENDING"))
                .thenReturn(Optional.of(LeadStatus.builder().id("st-2").statusKey("DIAGNOSTIC_PENDING").build()));

        service.save(request().responseId("resp-1").overwrite(true).complete(true).fireWorkflow(true)
                .statusKey("DIAGNOSTIC_PENDING").build());

        verify(leadStatusService).changeLeadStatus("resp-1", "st-2", null, "WHATSAPP_FLOW");
        verify(audienceService).fireLeadSubmissionWorkflow("resp-1");
    }

    @Test
    @DisplayName("Completing on an existing lead changes no status and fires nothing — the answers go on the timeline")
    void completeExistingLeadOnlyRecords() {
        lead("resp-1", "ACTIVE");
        when(customFieldValuesRepository.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                anyString(), anyString(), anyString())).thenReturn(Optional.empty());

        service.save(request().responseId("resp-1").overwrite(false).complete(true).fireWorkflow(true)
                .statusKey("DIAGNOSTIC_PENDING").fieldValues(Map.of("cf-year", "YEAR_6")).build());

        verify(leadStatusService, never()).changeLeadStatus(any(), any(), any(), any());
        verify(audienceService, never()).fireLeadSubmissionWorkflow(any());
        ArgumentCaptor<Object> metadata = ArgumentCaptor.forClass(Object.class);
        verify(timelineEventService).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("resp-1"),
                eq(LeadJourneyActionType.RE_ENQUIRY), any(), any(), any(), any(), anyString(),
                metadata.capture(), any());
        assertThat(((Map<?, ?>) metadata.getValue()).containsKey("answers")).isTrue();
    }

    @Test
    @DisplayName("No lead id (the check failed earlier) → resolved by phone under the lock, created, then completed")
    void saveWithoutLeadIdResolvesFirst() {
        when(audienceService.createWhatsAppFlowLead(INSTITUTE, "user-new", PHONE, "Asha", "flow-1"))
                .thenReturn(new AudienceService.InboundCallLeadRef("resp-new", "user-new", "aud-1"));
        lead("resp-new", "ACTIVE");
        when(customFieldValuesRepository.findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                anyString(), anyString(), anyString())).thenReturn(Optional.empty());

        WhatsAppFlowLeadResultDTO result = service.save(request().complete(true).fireWorkflow(true)
                .fieldValues(Map.of("cf-year", "YEAR_5")).build());

        assertThat(result.getResult()).isEqualTo("NEW");
        verify(audienceResponseRepository).acquireTransactionLock("whatsapp-flow-lead:" + INSTITUTE + ":" + LAST10);
        assertThat(savedValues).extracting(CustomFieldValues::getValue).containsExactly("YEAR_5");
        verify(audienceService).fireLeadSubmissionWorkflow("resp-new");
    }

    @Test
    @DisplayName("A lead id from another institute is ignored and the phone is resolved instead")
    void foreignLeadIdIsIgnored() {
        AudienceResponse foreign = AudienceResponse.builder().id("resp-x").audienceId("aud-other").build();
        when(audienceResponseRepository.findById("resp-x")).thenReturn(Optional.of(foreign));
        when(audienceRepository.findById("aud-other"))
                .thenReturn(Optional.of(Audience.builder().id("aud-other").instituteId("inst-2").build()));
        AudienceResponse mine = lead("resp-1", "ACTIVE");
        phoneMatches(mine);

        WhatsAppFlowLeadResultDTO result = service.save(request().responseId("resp-x").overwrite(true)
                .fieldValues(Map.of("cf-year", "YEAR_5")).build());

        assertThat(result.getResponseId()).isEqualTo("resp-1");
        assertThat(result.getResult()).isEqualTo("EXISTING");
    }

    @Test
    @DisplayName("Name: replaces a phone-number placeholder on a known lead, never a real name")
    void nameOnlyReplacesPlaceholder() {
        AudienceResponse placeholder = lead("resp-1", "ACTIVE");
        placeholder.setParentName("+44 7911 123456");
        service.save(request().responseId("resp-1").overwrite(false).fullName("Asha Patel").build());
        assertThat(placeholder.getParentName()).isEqualTo("Asha Patel");

        AudienceResponse named = lead("resp-2", "ACTIVE");
        named.setParentName("Asha P.");
        service.save(request().responseId("resp-2").overwrite(false).fullName("Someone Else").build());
        assertThat(named.getParentName()).isEqualTo("Asha P.");
    }
}
