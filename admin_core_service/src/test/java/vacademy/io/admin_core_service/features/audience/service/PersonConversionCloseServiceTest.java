package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatusHistory;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusHistoryRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTimelineWakeHook;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWakeService;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityCounsellorRecorder;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityRecorder;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * When a person converts, their other enquiries in the institute have their open follow-ups
 * closed and move to Converted, quietly: a timeline note per enquiry and nothing else.
 */
class PersonConversionCloseServiceTest {

    private static final String INST = "inst-1";
    private static final String OTHER_INST = "inst-2";
    private static final String PERSON = "user-1";
    private static final String PARENT = "parent-1";
    private static final String CHILD_A = "child-a";
    private static final String CHILD_B = "child-b";

    private final AudienceResponseRepository responses = mock(AudienceResponseRepository.class);
    private final AudienceRepository audiences = mock(AudienceRepository.class);
    private final LeadFollowupRepository followups = mock(LeadFollowupRepository.class);
    private final LeadStatusRepository statuses = mock(LeadStatusRepository.class);
    private final LeadStatusHistoryRepository history = mock(LeadStatusHistoryRepository.class);
    private final UserLeadProfileRepository profiles = mock(UserLeadProfileRepository.class);
    private final TimelineEventService timeline = mock(TimelineEventService.class);
    private final LeadFollowupSettingService settings = mock(LeadFollowupSettingService.class);

    private final PersonConversionCloseService service = new PersonConversionCloseService(
            responses, audiences, followups, statuses, history, profiles, timeline, settings,
            mock(PlatformTransactionManager.class), Runnable::run);

    private final LeadStatus converted = status("st-conv", "CONVERTED", "Converted");
    private final LeadStatus callBack = status("st-cb", "CALL_BACK", "Call Back");
    private final LeadStatus lost = status("st-lost", "LOST", "Lost");

    private final List<AudienceResponse> rows = new ArrayList<>();
    private final List<LeadFollowup> open = new ArrayList<>();

    @BeforeEach
    void setUp() {
        when(settings.closeOtherEnquiriesOnConversion(INST)).thenReturn(true);
        when(responses.findAllByInstituteAndUserOrStudent(INST, PERSON)).thenReturn(rows);
        when(audiences.findAllById(any())).thenReturn(List.of(
                audience("list-1", INST, "WEBSITE"),
                audience("list-optout", INST, "OPT_OUT"),
                audience("list-other", OTHER_INST, "WEBSITE")));
        when(statuses.findByInstituteIdAndStatusKey(INST, "CONVERTED")).thenReturn(Optional.of(converted));
        when(statuses.findAllById(any())).thenReturn(List.of(converted, callBack, lost));
        when(profiles.findByUserIdAndInstituteId(PERSON, INST)).thenReturn(Optional.of(
                UserLeadProfile.builder().userId(PERSON).instituteId(INST).conversionStatus("CONVERTED").build()));
        when(profiles.findByUserIdAndInstituteId(PARENT, INST)).thenReturn(Optional.empty());
        when(followups.findByAudienceResponseIdInAndIsClosedFalse(anyCollection())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            return open.stream().filter(f -> ids.contains(f.getAudienceResponseId())).toList();
        });
        // The conditional status writes, against the rows as the database holds them.
        when(responses.moveLeadStatusIfStill(anyString(), anyString(), anyString())).thenAnswer(inv ->
                moveIf(inv.getArgument(0), inv.getArgument(1), inv.getArgument(2)));
        when(responses.moveLeadStatusIfUnset(anyString(), anyString())).thenAnswer(inv ->
                moveIf(inv.getArgument(0), null, inv.getArgument(1)));
    }

    private int moveIf(String id, String from, String to) {
        for (AudienceResponse r : rows) {
            if (r.getId().equals(id) && java.util.Objects.equals(r.getLeadStatusId(), from)) {
                r.setLeadStatusId(to);
                return 1;
            }
        }
        return 0;
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    @DisplayName("enquiries held as the user: follow-ups closed, the open one moved to Converted")
    void closesEnquiriesHeldAsUser() {
        AudienceResponse a = row("ar-a", PERSON, null, "list-1", null);          // converted via the profile
        AudienceResponse b = row("ar-b", PERSON, null, "list-1", "st-cb");       // Call Back, 3 overdue
        rows.addAll(List.of(a, b));
        LeadFollowup f1 = followup("f1", "ar-b", INST), f2 = followup("f2", "ar-b", INST),
                f3 = followup("f3", "ar-b", INST), fa = followup("fa", "ar-a", INST);
        open.addAll(List.of(f1, f2, f3, fa));

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(out.followupsClosed()).isEqualTo(4);
        assertThat(out.enquiriesMoved()).isEqualTo(1);
        for (LeadFollowup f : List.of(f1, f2, f3, fa)) {
            assertThat(f.getIsClosed()).isTrue();
            assertThat(f.getStatus()).isEqualTo("COMPLETED");
            assertThat(f.getCloserReason()).isEqualTo(PersonConversionCloseService.CLOSER_REASON);
            assertThat(f.getClosedAt()).isNotNull();
            assertThat(f.getClosedBy()).isNull();
        }
        assertThat(b.getLeadStatusId()).isEqualTo("st-conv");
        assertThat(a.getLeadStatusId()).isNull(); // already Converted through the profile
        LeadStatusHistory h = savedHistory().get(0);
        assertThat(savedHistory()).hasSize(1);
        assertThat(h.getAudienceResponseId()).isEqualTo("ar-b");
        assertThat(h.getFromStatusId()).isEqualTo("st-cb");
        assertThat(h.getToStatusId()).isEqualTo("st-conv");
        assertThat(h.getSource()).isEqualTo("PERSON_CONVERTED");
        assertThat(h.getChangedByUserId()).isNull();
        assertThat(out.notes()).extracting(PersonConversionCloseService.Note::responseId)
                .containsExactly("ar-a", "ar-b");
    }

    @Test
    @DisplayName("an enquiry made for the person as the linked student is closed too")
    void closesEnquiryHeldAsLinkedStudent() {
        AudienceResponse c = row("ar-c", PARENT, PERSON, "list-1", null);
        rows.add(c);
        LeadFollowup f = followup("fc", "ar-c", INST);
        open.add(f);

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(f.getIsClosed()).isTrue();
        assertThat(c.getLeadStatusId()).isEqualTo("st-conv");
        assertThat(out.enquiriesMoved()).isEqualTo(1);
        assertThat(out.notes().get(0).studentUserId()).isEqualTo(PARENT);
    }

    @Test
    @DisplayName("opt-out list rows, deleted rows and rows of other institutes are left alone")
    void leavesOptOutDeletedAndOtherInstituteRowsAlone() {
        AudienceResponse optOutSource = row("ar-o1", PERSON, null, "list-1", "st-cb");
        optOutSource.setSourceType("OPT_OUT");
        AudienceResponse optOutList = row("ar-o2", PERSON, null, "list-optout", "st-cb");
        AudienceResponse deleted = row("ar-d", PERSON, null, "list-1", "st-cb");
        deleted.setAudienceStatus("INACTIVE");
        AudienceResponse otherInstitute = row("ar-x", PERSON, null, "list-other", "st-cb");
        AudienceResponse live = row("ar-live", PERSON, null, "list-1", "st-cb");
        rows.addAll(List.of(optOutSource, optOutList, deleted, otherInstitute, live));
        LeadFollowup onOptOut = followup("fo", "ar-o1", INST);
        LeadFollowup onDeleted = followup("fd", "ar-d", INST);
        LeadFollowup onOther = followup("fx", "ar-x", OTHER_INST);
        LeadFollowup otherInstituteOnLive = followup("fy", "ar-live", OTHER_INST);
        LeadFollowup onLive = followup("fl", "ar-live", INST);
        open.addAll(List.of(onOptOut, onDeleted, onOther, otherInstituteOnLive, onLive));

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(out.followupsClosed()).isEqualTo(1);
        assertThat(onLive.getIsClosed()).isTrue();
        for (LeadFollowup f : List.of(onOptOut, onDeleted, onOther, otherInstituteOnLive)) {
            assertThat(f.getIsClosed()).as(f.getId()).isFalse();
        }
        for (AudienceResponse r : List.of(optOutSource, optOutList, deleted, otherInstitute)) {
            assertThat(r.getLeadStatusId()).as(r.getId()).isEqualTo("st-cb");
        }
        assertThat(live.getLeadStatusId()).isEqualTo("st-conv");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<String>> asked = ArgumentCaptor.forClass(Collection.class);
        verify(followups).findByAudienceResponseIdInAndIsClosedFalse(asked.capture());
        assertThat(asked.getValue()).containsExactly("ar-live");
    }

    @Test
    @DisplayName("a Lost enquiry keeps its status; its follow-ups still close")
    void lostEnquiryKeepsItsStatus() {
        AudienceResponse l = row("ar-l", PERSON, null, "list-1", "st-lost");
        rows.add(l);
        LeadFollowup f = followup("fl", "ar-l", INST);
        open.add(f);

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(l.getLeadStatusId()).isEqualTo("st-lost");
        assertThat(f.getIsClosed()).isTrue();
        assertThat(out.enquiriesMoved()).isZero();
        verify(history, never()).saveAll(any());
    }

    @Test
    @DisplayName("an institute that switched it off is not touched")
    void settingOffTouchesNothing() {
        when(settings.closeOtherEnquiriesOnConversion(INST)).thenReturn(false);
        AudienceResponse b = row("ar-b", PERSON, null, "list-1", "st-cb");
        rows.add(b);
        LeadFollowup f = followup("f1", "ar-b", INST);
        open.add(f);

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(out.isEmpty()).isTrue();
        assertThat(f.getIsClosed()).isFalse();
        assertThat(b.getLeadStatusId()).isEqualTo("st-cb");
        verify(followups, never()).saveAll(any());
        verify(responses, never()).moveLeadStatusIfStill(anyString(), anyString(), anyString());
        verify(responses, never()).moveLeadStatusIfUnset(anyString(), anyString());
    }

    @Test
    @DisplayName("converting one child leaves the parent's enquiry for another child alone")
    void convertingOneChildLeavesTheSiblingsEnquiryAlone() {
        AudienceResponse forA = row("ar-pa", PARENT, CHILD_A, "list-1", "st-conv");
        AudienceResponse forB = row("ar-pb", PARENT, CHILD_B, "list-1", "st-cb");
        AudienceResponse aOwn = row("ar-a", CHILD_A, null, "list-1", "st-cb");
        when(responses.findAllByInstituteAndUserOrStudent(INST, CHILD_A)).thenReturn(List.of(forA, aOwn));
        when(responses.findAllByInstituteAndUserOrStudent(INST, PARENT)).thenReturn(List.of(forA, forB));
        rows.addAll(List.of(forA, forB, aOwn));
        LeadFollowup onA = followup("f-pa", "ar-pa", INST), onB = followup("f-pb", "ar-pb", INST),
                onAOwn = followup("f-a", "ar-a", INST);
        open.addAll(List.of(onA, onB, onAOwn));

        PersonConversionCloseService.Outcome out = service.close(CHILD_A, INST);

        assertThat(onA.getIsClosed()).isTrue();
        assertThat(onAOwn.getIsClosed()).isTrue();
        assertThat(aOwn.getLeadStatusId()).isEqualTo("st-conv");
        assertThat(onB.getIsClosed()).isFalse();
        assertThat(forB.getLeadStatusId()).isEqualTo("st-cb");
        assertThat(out.notes()).extracting(PersonConversionCloseService.Note::responseId)
                .containsExactly("ar-pa", "ar-a");

        // Converting the parent themself touches neither child's enquiry.
        PersonConversionCloseService.Outcome parent = service.close(PARENT, INST);
        assertThat(parent.isEmpty()).isTrue();
        assertThat(onB.getIsClosed()).isFalse();
        assertThat(forB.getLeadStatusId()).isEqualTo("st-cb");
    }

    @Test
    @DisplayName("converting the parent closes their own enquiry, not the ones made for their children")
    void convertingTheParentLeavesTheChildrensEnquiriesAlone() {
        AudienceResponse own = row("ar-p", PARENT, null, "list-1", "st-cb");
        AudienceResponse self = row("ar-pp", PARENT, PARENT, "list-1", "st-cb");
        AudienceResponse forA = row("ar-pa", PARENT, CHILD_A, "list-1", "st-cb");
        when(responses.findAllByInstituteAndUserOrStudent(INST, PARENT)).thenReturn(List.of(own, self, forA));
        rows.addAll(List.of(own, self, forA));
        LeadFollowup onOwn = followup("f-p", "ar-p", INST), onA = followup("f-pa", "ar-pa", INST);
        open.addAll(List.of(onOwn, onA));

        PersonConversionCloseService.Outcome out = service.close(PARENT, INST);

        assertThat(out.enquiriesMoved()).isEqualTo(2);
        assertThat(own.getLeadStatusId()).isEqualTo("st-conv");
        assertThat(self.getLeadStatusId()).isEqualTo("st-conv");
        assertThat(onOwn.getIsClosed()).isTrue();
        assertThat(forA.getLeadStatusId()).isEqualTo("st-cb");
        assertThat(onA.getIsClosed()).isFalse();
    }

    @Test
    @DisplayName("the person an enquiry converts is its linked student, else its submitter")
    void convertedPerson() {
        assertThat(PersonConversionCloseService.convertedPerson(row("r", PARENT, CHILD_A, "l", null)))
                .isEqualTo(CHILD_A);
        assertThat(PersonConversionCloseService.convertedPerson(row("r", PARENT, PARENT, "l", null)))
                .isEqualTo(PARENT);
        assertThat(PersonConversionCloseService.convertedPerson(row("r", PARENT, null, "l", null)))
                .isEqualTo(PARENT);
        assertThat(PersonConversionCloseService.convertedPerson(row("r", PARENT, " ", "l", null)))
                .isEqualTo(PARENT);
        assertThat(PersonConversionCloseService.convertedPerson(row("r", null, CHILD_A, "l", null)))
                .isEqualTo(CHILD_A);
        assertThat(PersonConversionCloseService.convertedPerson(row("r", null, null, "l", null))).isNull();
    }

    @Test
    @DisplayName("a status set after the read is kept, with no history row")
    void aStatusSetMeanwhileIsKept() {
        AudienceResponse b = row("ar-b", PERSON, null, "list-1", "st-cb");
        AudienceResponse c = row("ar-c", PERSON, null, "list-1", "st-cb");
        rows.addAll(List.of(b, c));
        // ar-b was moved by someone else after it was read: the database row now says Lost.
        when(responses.moveLeadStatusIfStill(eq("ar-b"), anyString(), anyString())).thenReturn(0);

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(out.enquiriesMoved()).isEqualTo(1);
        assertThat(savedHistory()).extracting(LeadStatusHistory::getAudienceResponseId).containsExactly("ar-c");
        assertThat(out.notes()).extracting(PersonConversionCloseService.Note::responseId).containsExactly("ar-c");
        verify(responses, never()).saveAll(any());
    }

    @Test
    @DisplayName("an enquiry already moved to Converted is not moved or recorded again")
    void alreadyMovedIsNotRecordedAgain() {
        AudienceResponse b = row("ar-b", PERSON, null, "list-1", "st-cb");
        rows.add(b);
        when(responses.moveLeadStatusIfStill(eq("ar-b"), eq("st-cb"), eq("st-conv"))).thenReturn(0);

        PersonConversionCloseService.Outcome out = service.close(PERSON, INST);

        assertThat(out.isEmpty()).isTrue();
        verify(history, never()).saveAll(any());
    }

    @Test
    @DisplayName("the timeline note is a journey entry with no actor that wakes no engagement")
    void noteWakesNothing() throws Exception {
        AudienceResponse b = row("ar-b", PERSON, null, "list-1", "st-cb");
        AudienceResponse a = row("ar-a", PERSON, null, "list-1", null);
        rows.addAll(List.of(a, b));
        open.addAll(List.of(followup("f1", "ar-b", INST), followup("f2", "ar-b", INST), followup("fa", "ar-a", INST)));

        service.run(PERSON, INST);

        ArgumentCaptor<LeadJourneyActionType> type = ArgumentCaptor.forClass(LeadJourneyActionType.class);
        ArgumentCaptor<String> description = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> meta = ArgumentCaptor.forClass(Object.class);
        verify(timeline, times(2)).logJourneyEvent(eq("LEAD"), anyString(), type.capture(),
                eq("SYSTEM"), isNull(), isNull(), anyString(), description.capture(), meta.capture(), anyString());
        verify(timeline, never()).logEvent(any(), any(), any(), any(), any(), any(), any(), any(), any());
        verify(timeline, never()).logEvent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        assertThat(type.getAllValues()).containsExactly(LeadJourneyActionType.FOLLOWUP, LeadJourneyActionType.LEAD_CONVERTED);
        assertThat(description.getAllValues()).containsExactly(
                "This person has converted, so 1 open follow-up on this enquiry was closed.",
                "This person has converted, so 2 open follow-ups on this enquiry were closed and this enquiry was moved to Converted.");

        EngagementWakeService wake = mock(EngagementWakeService.class);
        EngagementTimelineWakeHook hook = new EngagementTimelineWakeHook(wake);
        ObjectMapper json = new ObjectMapper();
        for (int i = 0; i < 2; i++) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) meta.getAllValues().get(i);
            assertThat(m.get("source")).isEqualTo("PERSON_CONVERTED");
            TimelineEvent written = TimelineEvent.builder()
                    .type("LEAD").typeId("ar-b").actionType(type.getAllValues().get(i).name())
                    .actorType("SYSTEM").category(TimelineCategory.JOURNEY).instituteId(INST)
                    .studentUserId(PERSON).metadataJson(json.writeValueAsString(m)).build();
            hook.onEventSaved(written);
            // Even if a later change made these types wake the engine, the source keeps them out.
            TimelineEvent asStatus = TimelineEvent.builder()
                    .type("LEAD").typeId("ar-b").actionType("STATUS_CHANGED").actorType("SYSTEM")
                    .instituteId(INST).metadataJson(json.writeValueAsString(m)).build();
            hook.onEventSaved(asStatus);
        }
        verify(wake, never()).request(any());
        // Control: the same status entry from a person does wake the engine.
        hook.onEventSaved(TimelineEvent.builder().type("LEAD").typeId("ar-b").actionType("STATUS_CHANGED")
                .actorType("ADMIN").actorId("c1").instituteId(INST).metadataJson("{\"source\":\"MANUAL\"}").build());
        verify(wake).request(any());
    }

    @Test
    @DisplayName("nothing it depends on can publish an automation, a notification or a feed event")
    void hasNoPathToAutomation() {
        Set<Class<?>> forbidden = Set.of(WorkflowTriggerService.class, LeadStatusService.class,
                UserLeadProfileService.class, ApplicationEventPublisher.class, LiveActivityRecorder.class,
                LiveActivityCounsellorRecorder.class, LeadTriggerContextBuilder.class);
        for (Field f : PersonConversionCloseService.class.getDeclaredFields()) {
            assertThat(forbidden).as(f.getName()).doesNotContain(f.getType());
        }
    }

    @Test
    @DisplayName("converting twice in one transaction closes once, after the commit")
    void runsOnceAfterCommit() {
        rows.add(row("ar-b", PERSON, null, "list-1", "st-cb"));
        TransactionSynchronizationManager.initSynchronization();

        service.onPersonConverted(PERSON, INST);
        service.onPersonConverted(PERSON, INST);
        verify(responses, never()).findAllByInstituteAndUserOrStudent(anyString(), anyString());

        List<TransactionSynchronization> syncs = TransactionSynchronizationManager.getSynchronizations();
        assertThat(syncs).hasSize(1);
        syncs.forEach(TransactionSynchronization::afterCommit);
        syncs.forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));

        verify(responses, times(1)).findAllByInstituteAndUserOrStudent(INST, PERSON);
    }

    @Test
    @DisplayName("a rolled-back conversion closes nothing")
    void rolledBackConversionClosesNothing() {
        TransactionSynchronizationManager.initSynchronization();
        service.onPersonConverted(PERSON, INST);
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        verify(responses, never()).findAllByInstituteAndUserOrStudent(anyString(), anyString());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private List<LeadStatusHistory> savedHistory() {
        ArgumentCaptor<List<LeadStatusHistory>> c = ArgumentCaptor.forClass(List.class);
        verify(history).saveAll(c.capture());
        return c.getValue();
    }

    private static LeadStatus status(String id, String key, String label) {
        return LeadStatus.builder().id(id).instituteId(INST).statusKey(key).label(label).build();
    }

    private static Audience audience(String id, String institute, String campaignType) {
        Audience a = new Audience();
        a.setId(id);
        a.setInstituteId(institute);
        a.setCampaignType(campaignType);
        return a;
    }

    private static AudienceResponse row(String id, String userId, String studentUserId, String audienceId,
                                        String leadStatusId) {
        return AudienceResponse.builder().id(id).userId(userId).studentUserId(studentUserId)
                .audienceId(audienceId).leadStatusId(leadStatusId).sourceType("WEBSITE").build();
    }

    private static LeadFollowup followup(String id, String responseId, String institute) {
        return LeadFollowup.builder().id(id).audienceResponseId(responseId).instituteId(institute)
                .status("OVERDUE").isClosed(false).build();
    }
}
