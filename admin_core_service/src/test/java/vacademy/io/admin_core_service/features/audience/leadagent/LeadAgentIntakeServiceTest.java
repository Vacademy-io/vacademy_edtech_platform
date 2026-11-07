package vacademy.io.admin_core_service.features.audience.leadagent;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeRequestDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeRequestDTO.Row;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeResponseDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeResponseDTO.Result;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentExistingContactsRequestDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentExistingContactsResponseDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.service.LeadAgentContactLookup;
import vacademy.io.admin_core_service.features.audience.leadagent.service.LeadAgentFieldProvisioner;
import vacademy.io.admin_core_service.features.audience.leadagent.service.LeadAgentIntakeService;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Lead Agent delivery: institute-wide duplicate check before submitLead, LEAD_AGENT source with
 * the organisation's domain, la_* values keyed by the provisioned field ids, evidence as a
 * JOURNEY note, and per-row isolation of failures.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LeadAgentIntakeServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String LIST = "aud-1";
    private static final String RID = "0b0e7c2a-1111-4c3d-9e8f-0123456789ab";

    @Mock private AudienceService audienceService;
    @Mock private AudienceRepository audienceRepository;
    @Mock private AudienceResponseRepository audienceResponseRepository;
    @Mock private TimelineEventService timelineEventService;
    @Mock private LeadAgentContactLookup lookup;
    @Mock private LeadAgentFieldProvisioner provisioner;
    @Mock private PlatformTransactionManager transactionManager;

    private LeadAgentIntakeService service;
    private final Set<String> knownPhones = new java.util.HashSet<>();
    private final Set<String> knownEmails = new java.util.HashSet<>();

    @BeforeEach
    void setUp() {
        service = new LeadAgentIntakeService(audienceService, audienceRepository, audienceResponseRepository,
                timelineEventService, lookup, provisioner, transactionManager);
        Audience list = new Audience();
        list.setId(LIST);
        list.setInstituteId(INSTITUTE);
        list.setStatus("ACTIVE");
        when(audienceRepository.findById(LIST)).thenReturn(Optional.of(list));
        Map<String, String> ids = new LinkedHashMap<>();
        LeadAgentFieldProvisioner.FIELDS.keySet().forEach(k -> ids.put(k, "cf-" + k));
        when(provisioner.ensureFields(INSTITUTE, LIST)).thenReturn(ids);
        when(lookup.existingPhones(eq(INSTITUTE), anyCollection())).thenAnswer(inv -> {
            Collection<String> asked = inv.getArgument(1);
            return asked.stream().filter(knownPhones::contains).collect(java.util.stream.Collectors.toSet());
        });
        when(lookup.existingEmails(eq(INSTITUTE), anyCollection())).thenAnswer(inv -> {
            Collection<String> asked = inv.getArgument(1);
            return asked.stream().filter(knownEmails::contains).collect(java.util.stream.Collectors.toSet());
        });
        AudienceResponse saved = new AudienceResponse();
        saved.setId(RID);
        saved.setUserId("lead-user");
        when(audienceResponseRepository.findById(RID)).thenReturn(Optional.of(saved));
    }

    private static Row winners() {
        Map<String, String> cf = new LinkedHashMap<>();
        cf.put("la_org_name", "WiNNERS Institute");
        cf.put("la_website", "https://www.winnersinstitute.in/about");
        cf.put("la_city", "Indore");
        cf.put("la_score", "82");
        cf.put("la_source_url", "https://winnersinstitute.in/contact");
        cf.put("not_a_field", "ignored");
        cf.put("la_why", "x".repeat(5000));
        return Row.builder().externalId("cand-1").fullName("Aditya Patel").mobile("+91 90093 35533")
                .customFields(cf).note("Evidence:\n- Admissions open (https://winnersinstitute.in)").build();
    }

    private static LeadAgentBulkIntakeRequestDTO req(Row... rows) {
        return LeadAgentBulkIntakeRequestDTO.builder().instituteId(INSTITUTE).audienceId(LIST)
                .rows(new ArrayList<>(List.of(rows))).build();
    }

    @Test
    void newLeadIsSubmittedWithLeadAgentSourceAndNoteOnTimeline() {
        when(audienceService.submitLead(any())).thenReturn(RID);

        LeadAgentBulkIntakeResponseDTO out = service.bulkIntake(req(winners()));

        Result r = out.getResults().get(0);
        assertThat(r.getStatus()).isEqualTo("CREATED");
        assertThat(r.getResponseId()).isEqualTo(RID);
        assertThat(r.getExternalId()).isEqualTo("cand-1");

        ArgumentCaptor<SubmitLeadRequestDTO> sub = ArgumentCaptor.forClass(SubmitLeadRequestDTO.class);
        verify(audienceService).submitLead(sub.capture());
        SubmitLeadRequestDTO s = sub.getValue();
        assertThat(s.getAudienceId()).isEqualTo(LIST);
        assertThat(s.getSourceType()).isEqualTo("LEAD_AGENT");
        assertThat(s.getSourceId()).isEqualTo("winnersinstitute.in");
        assertThat(s.getUserDTO().getFullName()).isEqualTo("Aditya Patel");
        assertThat(s.getUserDTO().getMobileNumber()).isEqualTo("+91 90093 35533");
        assertThat(s.getUserDTO().getEmail()).isNull();
        assertThat(s.isSuppressRespondentEmail()).isTrue();
        assertThat(s.getCustomFieldValues())
                .containsEntry("cf-la_org_name", "WiNNERS Institute")
                .containsEntry("cf-la_score", "82")
                .doesNotContainKey("not_a_field")
                .hasSize(6);
        assertThat(s.getCustomFieldValues().get("cf-la_why")).hasSize(1000);

        verify(lookup).lock("lead-agent-intake:" + INSTITUTE);
        verify(lookup).recordIntake(INSTITUTE, "cand-1", LIST, RID);
        verify(lookup).existingPhones(INSTITUTE, List.of("9009335533"));
        verify(timelineEventService).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq(RID),
                eq(LeadJourneyActionType.LEAD_AGENT_RESEARCH), eq("SYSTEM"), isNull(), eq("Lead Agent"),
                anyString(), eq("Evidence:\n- Admissions open (https://winnersinstitute.in)"), any(),
                eq("lead-user"));
    }

    @Test
    void repeatOfAnAlreadyCreatedCandidateReturnsTheSameLeadWithoutSubmitting() {
        // The first call committed the lead, but the caller timed out and sends the row again:
        // by now the phone is a lead too, yet the answer must be CREATED with the same id.
        when(lookup.findIntakeResponseId(INSTITUTE, "cand-1")).thenReturn(Optional.of(RID));
        knownPhones.add("9009335533");

        LeadAgentBulkIntakeResponseDTO out = service.bulkIntake(req(winners()));

        Result r = out.getResults().get(0);
        assertThat(r.getStatus()).isEqualTo("CREATED");
        assertThat(r.getResponseId()).isEqualTo(RID);
        assertThat(r.getMessage()).isEqualTo("already created");
        verify(audienceService, never()).submitLead(any());
        verify(lookup, never()).recordIntake(any(), any(), any(), any());
        verify(timelineEventService, never()).logJourneyEvent(any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any());
    }

    @Test
    void notCreatedRowsAreNotRecordedAndExternalIdIsRequired() {
        when(audienceService.submitLead(any())).thenReturn("Error in submitting the response");
        Row noId = Row.builder().fullName("N").mobile("9333333333").build();

        LeadAgentBulkIntakeResponseDTO out = service.bulkIntake(req(winners(), noId));

        assertThat(out.getResults()).extracting(Result::getStatus).containsExactly("FAILED", "FAILED");
        assertThat(out.getResults().get(1).getMessage()).contains("external_id");
        verify(audienceService, times(1)).submitLead(any());
        verify(lookup, never()).recordIntake(any(), any(), any(), any());
    }

    @Test
    void phoneOrEmailAlreadyALeadIsDuplicateAndNotSubmitted() {
        knownPhones.add("9009335533");
        knownEmails.add("owner@acme.in");
        Row byEmail = Row.builder().externalId("cand-2").fullName("A").email(" Owner@Acme.in ").build();
        when(lookup.findIntakeResponseId(anyString(), anyString())).thenReturn(Optional.empty());

        LeadAgentBulkIntakeResponseDTO out = service.bulkIntake(req(winners(), byEmail));

        assertThat(out.getResults()).extracting(Result::getStatus).containsExactly("DUPLICATE", "DUPLICATE");
        verify(audienceService, never()).submitLead(any());
        verify(timelineEventService, never()).logJourneyEvent(any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any());
    }

    @Test
    void oneRowFailingDoesNotFailTheOthers() {
        Row bad = Row.builder().externalId("cand-bad").fullName("X").mobile("9876500000").build();
        Row noContact = Row.builder().externalId("cand-none").fullName("Y").build();
        when(audienceService.submitLead(any())).thenAnswer(inv -> {
            SubmitLeadRequestDTO s = inv.getArgument(0);
            if ("9876500000".equals(s.getUserDTO().getMobileNumber())) throw new IllegalStateException("boom");
            return RID;
        });

        LeadAgentBulkIntakeResponseDTO out = service.bulkIntake(req(bad, noContact, winners()));

        assertThat(out.getResults()).extracting(Result::getStatus).containsExactly("FAILED", "FAILED", "CREATED");
        assertThat(out.getResults().get(0).getMessage()).contains("boom");
        assertThat(out.getResults().get(1).getMessage()).contains("mobile number or an email");
        verify(audienceService, times(2)).submitLead(any());
    }

    @Test
    void submitLeadMessagesAreClassified() {
        when(audienceService.submitLead(any())).thenReturn(
                "You have already submitted your response for this campaign",
                "Error in submitting the response");
        Row second = Row.builder().externalId("cand-3").fullName("Z").mobile("9123456780").build();

        LeadAgentBulkIntakeResponseDTO out = service.bulkIntake(req(winners(), second));

        assertThat(out.getResults()).extracting(Result::getStatus).containsExactly("DUPLICATE", "FAILED");
        assertThat(out.getResults().get(1).getResponseId()).isNull();
    }

    @Test
    void nameFallsBackToOrganisationAndSourceIdToExternalId() {
        when(audienceService.submitLead(any())).thenReturn(RID);
        Row orgOnly = Row.builder().externalId("cand-9").email("info@acme.in")
                .customFields(Map.of("la_org_name", "Acme Classes")).build();

        service.bulkIntake(req(orgOnly));

        ArgumentCaptor<SubmitLeadRequestDTO> sub = ArgumentCaptor.forClass(SubmitLeadRequestDTO.class);
        verify(audienceService).submitLead(sub.capture());
        assertThat(sub.getValue().getUserDTO().getFullName()).isEqualTo("Acme Classes");
        assertThat(sub.getValue().getUserDTO().getEmail()).isEqualTo("info@acme.in");
        assertThat(sub.getValue().getSourceId()).isEqualTo("cand-9");
    }

    @Test
    void listMustBelongToInstituteBeActiveAndRowsCapped() {
        Audience other = new Audience();
        other.setId("aud-x");
        other.setInstituteId("someone-else");
        other.setStatus("ACTIVE");
        when(audienceRepository.findById("aud-x")).thenReturn(Optional.of(other));
        assertThatThrownBy(() -> service.bulkIntake(LeadAgentBulkIntakeRequestDTO.builder()
                .instituteId(INSTITUTE).audienceId("aud-x").rows(List.of(winners())).build()))
                .isInstanceOf(VacademyException.class);

        Audience paused = new Audience();
        paused.setId("aud-p");
        paused.setInstituteId(INSTITUTE);
        paused.setStatus("PAUSED");
        when(audienceRepository.findById("aud-p")).thenReturn(Optional.of(paused));
        assertThatThrownBy(() -> service.bulkIntake(LeadAgentBulkIntakeRequestDTO.builder()
                .instituteId(INSTITUTE).audienceId("aud-p").rows(List.of(winners())).build()))
                .isInstanceOf(VacademyException.class);

        List<Row> many = new ArrayList<>();
        for (int i = 0; i < 51; i++) many.add(winners());
        assertThatThrownBy(() -> service.bulkIntake(LeadAgentBulkIntakeRequestDTO.builder()
                .instituteId(INSTITUTE).audienceId(LIST).rows(many).build()))
                .isInstanceOf(VacademyException.class);
        verify(audienceService, never()).submitLead(any());
        verify(provisioner, never()).ensureFields(anyString(), anyString());
    }

    @Test
    void existingContactsNormalisesPhonesAndEmails() {
        knownPhones.add("9876543210");
        knownEmails.add("a@b.com");

        LeadAgentExistingContactsResponseDTO out = service.existingContacts(LeadAgentExistingContactsRequestDTO
                .builder().instituteId(INSTITUTE)
                .phones(List.of("+91-98765 43210", "12", "9000000000"))
                .emails(List.of(" A@B.com ", "nope", "c@d.com")).build());

        assertThat(out.getPhones()).containsExactly("9876543210");
        assertThat(out.getEmails()).containsExactly("a@b.com");
    }
}
