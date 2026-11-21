package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.actions.ScheduleAiCallActionHandler;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.engagement.templates.TemplateVariableSources;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 2026-11-21: most open inbox tasks were noise nobody could act on. Each cause is closed here:
 * automated email/WhatsApp replies, a second AI call while one waits, a template value the AI left
 * out, and a follow-up with no counsellor. Every example below is invented.
 */
class EngagementInboxNoiseTest {

    static final String SPAM_CHALLENGE = "Hello,\n\nThe message you sent requires that you verify that you are a real "
            + "live human being and not a spam source.\n\nTo complete this verification, click the link below.";
    static final String ERROR_PROCESSING = "Error processing email. The message could not be handled by the server.";
    static final String TICKET_CLOSED = "Dear Ravi,\n\nYour ticket \"100234 Following up on faster callbacks\" has been "
            + "Closed. We hope that we've helped you. If not, reply to reopen it.";
    static final String SIGNATURE_ONLY = "Regards,\nAnita Verma\nPrincipal\nSunrise Public School\n+91 90000 00001";

    // ── cause 1: the detector ───────────────────────────────────────────────

    @Nested
    @DisplayName("automated replies")
    class Detector {

        @Test
        @DisplayName("the three email examples are machines, each with its kind")
        void emailExamples() {
            assertEquals("spam-filter check",
                    EngagementAutomatedReply.automatedEmailKind("filter@school.test", "Re: Your offer", SPAM_CHALLENGE, false));
            assertEquals("bounce",
                    EngagementAutomatedReply.automatedEmailKind("ops@school.test", "Re: Your offer", ERROR_PROCESSING, false));
            assertEquals("helpdesk notice",
                    EngagementAutomatedReply.automatedEmailKind("help@school.test", "Re: Your offer", TICKET_CLOSED, false));
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "Your message could not be delivered to one or more recipients.",
                "Delivery has failed to these recipients or groups: a@school.test",
                "Address not found. Your message wasn't delivered because the address couldn't be found.",
                "This is the mail system at host mx.school.test. I'm sorry to have to inform you that your message could not be delivered",
                "Hi,\nThis mailbox is not monitored. Please write to our office instead.",
                "Hello. Please do not reply to this email."
        })
        void otherMachineNotices(String body) {
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("a@school.test", "Re: Your offer", body), body);
        }

        @Test
        @DisplayName("an auto-reply header marks the mail automated, unless the person opts out in it")
        void header() {
            assertEquals("auto-submitted",
                    EngagementAutomatedReply.automatedEmailKind("a@school.test", "Re: Your offer", "I am travelling", true));
            assertNull(EngagementAutomatedReply.automatedEmailKind("a@school.test", "Re: Your offer", "Unsubscribe me", true));
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "STOP",
                "Yes please call me tomorrow",
                "Please unsubscribe me",
                "This is spam, stop emailing us",
                "I could not verify the fee on your site, what is it?",
                "Your message was delivered to the right person, she will call you on Monday."
        })
        void peopleByEmail(String body) {
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("a@school.test", "Re: Your offer", body), body);
        }

        @Test
        @DisplayName("WhatsApp: a signature with nothing to answer is not a reply")
        void signatureOnly() {
            assertTrue(EngagementAutomatedReply.isAutomated(SIGNATURE_ONLY));
            assertTrue(EngagementAutomatedReply.isAutomated("Thanks & Regards\nRavi Kumar"));
            assertTrue(EngagementAutomatedReply.isAutomated("Anita Verma\nHead - Admissions\nanita@school.test"));
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "Yes please call me tomorrow",
                "STOP",
                "Regards,\nAnita Verma\nWhat are the fees?",
                "Thanks, I will check and revert\nRavi\n9000000001",
                "Yes Interested\n9000000001",
                "Call Me\n9000000001",
                "Regards\nplease send the brochure",
                "Anita Verma",
                "Hi"
        })
        void peopleOnWhatsApp(String text) {
            assertFalse(EngagementAutomatedReply.isAutomated(text), text);
        }
    }

    // ── cause 1: the responder and the sweep ────────────────────────────────

    @Nested
    @DisplayName("the responder")
    class Responder {
        private final EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        private final EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        private final EngagementActionRepository actions = mock(EngagementActionRepository.class);
        private final EngagementTeamAlertService alerts = mock(EngagementTeamAlertService.class);
        private final EngagementLeadOutcomeService outcomes = mock(EngagementLeadOutcomeService.class);
        private final EngagementReplyMemberQueries queries = mock(EngagementReplyMemberQueries.class);
        private final EngagementReplyResponder responder = new EngagementReplyResponder(members, engines,
                mock(EngagementPromptVersionRepository.class), actions, mock(EngagementReplyBrain.class),
                mock(EngagementDispatcher.class));

        Responder() {
            ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
            ReflectionTestUtils.setField(responder, "leaseMinutes", 15);
            ReflectionTestUtils.setField(responder, "teamAlertService", alerts);
            ReflectionTestUtils.setField(responder, "replyMemberQueries", queries);
            ReflectionTestUtils.setField(responder, "outcomeService", outcomes);
            EngagementEngine engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setCadenceHours(48);
            when(engines.findById("e1")).thenReturn(Optional.of(engine));
            EngagementMember member = new EngagementMember();
            member.setId("m1");
            when(members.findById("m1")).thenReturn(Optional.of(member));
            EngagementReplyMemberQueries.LiveMember live = mock(EngagementReplyMemberQueries.LiveMember.class);
            when(live.getMemberId()).thenReturn("m1");
            when(live.getEngineId()).thenReturn("e1");
            when(live.getCadenceHours()).thenReturn(48);
            when(queries.findLiveMembersByEmail("i1", "lead@school.test")).thenReturn(List.of(live));
            when(members.claimHandledReply(eq("i1"), anyString(), any())).thenReturn(1);
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
        }

        @ParameterizedTest
        @ValueSource(strings = {SPAM_CHALLENGE, ERROR_PROCESSING, TICKET_CLOSED})
        @DisplayName("an automated email: no task, no opt-out, no alert, a closed note, and the engine carries on")
        void automatedEmail(String body) {
            assertFalse(responder.handleEmailReply("i1", "lead@school.test", "Re: Faster callbacks", body, "<x@mail>"));

            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            assertEquals("NO_OP", saved.getValue().getKind());
            assertEquals("DONE", saved.getValue().getStatus());
            assertTrue(saved.getValue().getRationale().startsWith("Automated email ("), saved.getValue().getRationale());
            verify(members, never()).optOutMembers(any(), any());
            verify(members, never()).optOutByPhone(any(), any(), any());
            verifyNoInteractions(alerts, outcomes);
            verify(members).markReplyHandled(eq("m1"), any(), any());
        }

        @Test
        @DisplayName("STOP by email still opts the person out")
        void stopStillOptsOut() {
            assertTrue(responder.handleEmailReply("i1", "lead@school.test", "Re: Faster callbacks", "STOP", "<s@mail>"));
            verify(members).optOutMembers(eq(List.of("m1")), any());
        }

        @Test
        @DisplayName("a real reply by email is still a task for a person")
        void humanReplyIsATask() {
            assertTrue(responder.handleEmailReply("i1", "lead@school.test", "Re: Faster callbacks",
                    "Yes please call me tomorrow", "<h@mail>"));
            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            assertEquals("REPLY", saved.getValue().getKind());
            assertEquals("OPEN", saved.getValue().getStatus());
            verify(members, never()).optOutMembers(any(), any());
        }
    }

    @Test
    @DisplayName("the sweep drops a signature-only WhatsApp reply before anything wakes; a real one goes through")
    void sweepDropsSignature() throws Exception {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        EngagementReplyResponder responder = mock(EngagementReplyResponder.class);
        EngagementReplyJob job = new EngagementReplyJob(clients, members, responder);
        when(members.institutesWithLiveEngines()).thenReturn(List.of("i1"));
        ObjectMapper om = new ObjectMapper();
        var rows = om.createArrayNode();
        rows.addObject().put("channel", "WHATSAPP").put("phone", "919000000001").put("text", SIGNATURE_ONLY).put("wamid", "w1");
        rows.addObject().put("channel", "WHATSAPP").put("phone", "919000000002")
                .put("text", "Yes please call me tomorrow").put("wamid", "w2");
        when(clients.inboundSince(eq("i1"), anyLong())).thenReturn(rows);

        job.sweep();

        verify(responder, never()).handleReply(any(), eq("919000000001"), any(), any());
        verify(responder).handleReply("i1", "919000000002", "Yes please call me tomorrow", "w2");
        verify(members).promoteByPhones(eq("i1"), eq(List.of("9000000002")), any(), any());
    }

    // ── cause 2 and 4: CRM actions ──────────────────────────────────────────

    @Nested
    @DisplayName("CRM actions run on their own")
    class Crm {
        private EngagementActionRepository actions;
        private EngagementCoordinationDao coordination;
        private ScheduleAiCallActionHandler call;
        private EngagementActionHandler followup;
        private EngagementCrmActionService service;
        private EngagementEngine engine;
        private EngagementMember member;

        @BeforeEach
        void setUp() {
            actions = mock(EngagementActionRepository.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            call = mock(ScheduleAiCallActionHandler.class);
            when(call.type()).thenReturn(EngagementActionTypes.SCHEDULE_AI_CALL);
            when(call.callAt(any(), anyMap())).thenAnswer(inv -> Instant.now());
            followup = mock(EngagementActionHandler.class);
            when(followup.type()).thenReturn(EngagementActionTypes.CREATE_FOLLOWUP);
            when(followup.execute(any(), anyMap(), any())).thenReturn(Map.of("ref", "f-1"));
            ContactResolver contacts = mock(ContactResolver.class);
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").phone("9000000001").build()));
            service = new EngagementCrmActionService(List.of(call, followup), actions, members, engines, contacts);
            CreditClient credits = mock(CreditClient.class);
            when(credits.readBalance("i1")).thenReturn(Optional.of(100.0));
            coordination = mock(EngagementCoordinationDao.class);
            ReflectionTestUtils.setField(service, "creditClient", credits);
            ReflectionTestUtils.setField(service, "coordinationDao", coordination);
            engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setStatus("ACTIVE");
            engine.setAutoSendKilled(false);
            engine.setChannels("{\"actions\":[{\"type\":\"SCHEDULE_AI_CALL\",\"auto\":true},{\"type\":\"CREATE_FOLLOWUP\",\"auto\":true}]}");
            when(engines.findById("e1")).thenReturn(Optional.of(engine));
            member = new EngagementMember();
            member.setId("m1");
            member.setEngineId("e1");
            member.setInstituteId("i1");
            member.setAudienceResponseId("ar1");
            member.setStatus("ACTIVE");
            when(members.findById("m1")).thenReturn(Optional.of(member));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(actions.countApprovedCrmActions(eq("e1"), anyString())).thenReturn(5L);
        }

        private EngagementAction task(String type) {
            EngagementAction a = new EngagementAction();
            a.setId("t-" + type);
            a.setEngineId("e1");
            a.setMemberId("m1");
            a.setInstituteId("i1");
            a.setKind("TASK");
            a.setStatus("OPEN");
            a.setActionType(type);
            a.setVariablesJson(service.taskVariables(Map.of("note", "x")));
            when(actions.claimCrmAction(eq(a.getId()), eq("i1"), anyList(), any())).thenReturn(1);
            return a;
        }

        @Test
        @DisplayName("cause 2: a second AI call while one waits for a line is closed quietly, not left open")
        void duplicateCallSkipped() {
            when(call.execute(any(), anyMap(), any())).thenThrow(new ScheduleAiCallActionHandler.AlreadyQueuedException(
                    "This lead already has an AI call waiting for a line. 3 in line, roughly 6 min."));
            EngagementAction after = service.tryAutonomous(task(EngagementActionTypes.SCHEDULE_AI_CALL), engine, member,
                    "9000000001", null, false, false);
            assertEquals("DONE", after.getStatus());
            assertEquals(EngagementCrmActionService.OUTCOME_SKIPPED, after.getOutcome());
            assertTrue(after.getErrorMessage().startsWith("Skipped: This lead already has an AI call waiting"));
            assertNotNull(after.getCompletedAt());
        }

        @Test
        @DisplayName("cause 2: any other call failure still goes to a person")
        void otherCallFailureStaysOpen() {
            when(call.execute(any(), anyMap(), any())).thenThrow(new vacademy.io.common.exceptions.VacademyException("No line"));
            EngagementAction after = service.tryAutonomous(task(EngagementActionTypes.SCHEDULE_AI_CALL), engine, member,
                    "9000000001", null, false, false);
            assertEquals("OPEN", after.getStatus());
        }

        @Test
        @DisplayName("cause 4: no counsellor, so the follow-up goes to the first person on the engine's alert team")
        void followupFallsBackToAlertTeam() {
            engine.setNotifyUserIds("[\"\", \"alert-user-1\", \"alert-user-2\"]");
            when(coordination.leadOwnerUserId("i1", "ar1")).thenReturn(null);
            EngagementAction after = service.tryAutonomous(task(EngagementActionTypes.CREATE_FOLLOWUP), engine, member,
                    null, null, false, false);
            assertEquals("DONE", after.getStatus());
            verify(followup).execute(any(), anyMap(), argThat(a -> "alert-user-1".equals(a.userId()) && a.user() != null));
        }

        @Test
        @DisplayName("cause 4: the counsellor still wins; with neither, it stays for a person as before")
        void followupOwnerOrder() {
            engine.setNotifyUserIds("[\"alert-user-1\"]");
            when(coordination.leadOwnerUserId("i1", "ar1")).thenReturn("counsellor-1");
            service.tryAutonomous(task(EngagementActionTypes.CREATE_FOLLOWUP), engine, member, null, null, false, false);
            verify(followup).execute(any(), anyMap(), argThat(a -> "counsellor-1".equals(a.userId())));

            engine.setNotifyUserIds("[]");
            when(coordination.leadOwnerUserId("i1", "ar1")).thenReturn(null);
            EngagementAction left = service.tryAutonomous(task(EngagementActionTypes.CREATE_FOLLOWUP), engine, member,
                    null, null, false, false);
            assertEquals("OPEN", left.getStatus());
            assertTrue(left.getErrorMessage().contains("no counsellor"));
        }
    }

    @Test
    @DisplayName("cause 2: the AI call handler reports a call already waiting as AlreadyQueued")
    void handlerReportsAlreadyQueued() {
        AiCallQueueService queue = mock(AiCallQueueService.class);
        EngagementAiCallPool pool = mock(EngagementAiCallPool.class);
        when(pool.next(any())).thenReturn("agent-1");
        when(queue.enqueue(any(), any(), anyString(), any(), any())).thenReturn(AiCallQueueDTOs.EnqueueResult.builder()
                .queueItemId("q-old").queued(false)
                .message("This lead already has an AI call waiting for a line. 2 in line, roughly 4 min.").build());
        ScheduleAiCallActionHandler handler = new ScheduleAiCallActionHandler(queue, mock(EngagementCoordinationDao.class), pool);
        EngagementEngine engine = new EngagementEngine();
        engine.setInstituteId("i1");
        EngagementMember member = new EngagementMember();
        member.setId("m1");
        var ctx = new EngagementActionHandler.Context(engine, member, "ar1", "9000000001", "a1", Instant.now());
        var e = assertThrows(ScheduleAiCallActionHandler.AlreadyQueuedException.class,
                () -> handler.execute(ctx, Map.of(), new EngagementActionHandler.Approver(null, "AI", null)));
        assertTrue(e.getMessage().contains("2 in line"));
    }

    // ── cause 3: template values ────────────────────────────────────────────

    @Nested
    @DisplayName("template values from the lead's own data")
    class FromLeadData {
        private final ObjectMapper om = new ObjectMapper();

        private Map<String, JsonNode> profile(String json) throws Exception {
            return Map.of("profile", om.readTree(json));
        }

        @Test
        @DisplayName("institute name of a researched organisation, names, exact form fields, declared sources")
        void fills() throws Exception {
            var prospect = profile("{\"name\":\"Ravi Kumar\",\"subjectType\":\"ORGANISATION_PROSPECT\","
                    + "\"researchNotes\":{\"Organisation\":\"Bright Future Academy\",\"City\":\"Pune\"}}");
            assertEquals("Bright Future Academy", TemplateVariableSources.fromLeadData("institute_name", Map.of(), prospect, List.of()));
            assertEquals("Ravi Kumar", TemplateVariableSources.fromLeadData("name", Map.of(), prospect, List.of()));
            assertEquals("Ravi", TemplateVariableSources.fromLeadData("first_name", Map.of(), prospect, List.of()));
            assertEquals("Pune", TemplateVariableSources.fromLeadData("city", Map.of(), prospect, List.of()));
            assertEquals("Ravi", TemplateVariableSources.fromLeadData("greeting_name", Map.of("greeting_name", "profile.firstName"),
                    prospect, List.of()));
        }

        @Test
        @DisplayName("never invented: AI-only lines, a student's old institute, placeholder names and links stay empty")
        void doesNotInvent() throws Exception {
            var student = profile("{\"name\":\"unknown\",\"subjectType\":\"UNCONVERTED_LEAD\","
                    + "\"formAnswers\":{\"Institute Name\":\"Old Coaching Centre\",\"Website\":\"https://x.test\"}}");
            assertNull(TemplateVariableSources.fromLeadData("personalised_line", Map.of("personalised_line", "ai"), student, List.of()));
            assertNull(TemplateVariableSources.fromLeadData("institute_name", Map.of(), student, List.of()));
            assertNull(TemplateVariableSources.fromLeadData("name", Map.of(), student, List.of()));
            assertNull(TemplateVariableSources.fromLeadData("website", Map.of(), student, List.of()));
            assertNull(TemplateVariableSources.fromLeadData("name", Map.of(), Map.of(), List.of()));
        }
    }

    @Nested
    @DisplayName("the decision with a WhatsApp template")
    class Deciding {
        private EngagementBrainClient brain;
        private EngagementActionRepository actions;
        private EngagementDecisionService service;
        private EngagementEngine engine;
        private EngagementMember member;

        @BeforeEach
        void setUp() throws Exception {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            PolicyGate gate = mock(PolicyGate.class);
            brain = mock(EngagementBrainClient.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            actions = mock(EngagementActionRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            EngagementTemplateProposalRepository templates = mock(EngagementTemplateProposalRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts, templates);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("The brief");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));

            DataPointProvider profileProvider = mock(DataPointProvider.class);
            when(profileProvider.key()).thenReturn("profile");
            JsonNode profile = new ObjectMapper().readTree("{\"name\":\"Ravi Kumar\",\"subjectType\":\"ORGANISATION_PROSPECT\","
                    + "\"researchNotes\":{\"Organisation\":\"Bright Future Academy\"}}");
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(
                    List.of(profileProvider), Map.of("profile", Map.of("m1", profile))));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").phone("9000000001").name("Ravi Kumar").build()));

            EngagementTemplateProposal t = new EngagementTemplateProposal();
            t.setName("callback_offer");
            t.setProposedBody("Hi {{1}}, can {{2}} answer every enquiry in a minute? {{3}}");
            t.setVariableNames("[\"name\",\"institute_name\",\"personalised_line\"]");
            t.setVariableSources("{\"name\":\"profile.firstName\",\"institute_name\":\"ai\",\"personalised_line\":\"ai\"}");
            t.setLanguage("en");
            when(templates.findApproved("e1", "i1")).thenReturn(List.of(t));

            engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setStatus("ACTIVE");
            engine.setCadenceHours(72);
            engine.setChannels("{\"WHATSAPP\":{\"enabled\":true}}");
            member = new EngagementMember();
            member.setId("m1");
            member.setEngineId("e1");
            member.setInstituteId("i1");
            member.setStatus("ACTIVE");
            member.setNextActionAt(Instant.now());
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
        }

        private void brainPicks(Map<String, String> vars) {
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "WHATSAPP", "draft", "callback_offer", vars,
                            "first touch", 50, 0, null, null, null, null, null));
        }

        @Test
        @DisplayName("a left-out institute name is filled from the lead's research, and the task is sendable")
        void filledFromLeadData() {
            brainPicks(Map.of("personalised_line", "Most callbacks happen within an hour."));

            service.decideCohort(engine, List.of(member));

            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            EngagementAction a = saved.getValue();
            assertEquals("TASK", a.getKind());
            assertEquals("callback_offer", a.getTemplateName());
            assertNull(a.getErrorMessage());
            assertTrue(a.getVariablesJson().contains("\"institute_name\":\"Bright Future Academy\""), a.getVariablesJson());
            assertTrue(a.getDraftBody().startsWith("Hi Ravi, can Bright Future Academy answer"), a.getDraftBody());
        }

        @Test
        @DisplayName("a value nobody has: the touch is skipped as a closed no-op, never a task or a blank send")
        void unfillableSkipped() {
            brainPicks(Map.of("institute_name", "Bright Future Academy"));

            service.decideCohort(engine, List.of(member));

            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            EngagementAction a = saved.getValue();
            assertEquals("NO_OP", a.getKind());
            assertEquals("DONE", a.getStatus());
            assertTrue(a.getRationale().contains("'personalised_line'"), a.getRationale());
            assertNull(a.getErrorMessage());
            verify(actions, never()).save(argThat((EngagementAction x) -> "TASK".equals(x.getKind()) || "SEND".equals(x.getKind())));
        }
    }
}
