package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.dto.CreateEngineRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The engine's send window and days, the channel readiness check, and the save-time validation. */
class EngagementSendScheduleTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final ObjectMapper OM = new ObjectMapper();

    /** 2026-11-02 is a Monday; 2026-11-01 a Sunday. */
    private static Instant ist(int day, int hour, int minute) {
        return ZonedDateTime.of(2026, 11, day, hour, minute, 0, 0, IST).toInstant();
    }

    private static EngagementEngine engine(String quietHours) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setQuietHours(quietHours);
        e.setChannels("{}");
        e.setCadenceHours(48);
        return e;
    }

    private static final String MON_SAT_11 =
            "{\"startHour\":21,\"endHour\":8,\"timezone\":\"Asia/Kolkata\",\"sendHour\":11,\"sendMinute\":0,\"days\":[1,2,3,4,5,6]}";

    @Nested
    @DisplayName("send window")
    class Window {

        @Test
        @DisplayName("no send time set: behaves as before (every day, no window)")
        void unsetIsNone() {
            EngagementSendSchedule s = EngagementSendSchedule.of("{\"startHour\":21,\"endHour\":8}", OM);
            assertFalse(s.hasSendTime());
            assertTrue(s.firstTouchImmediate());
            Instant t = ist(1, 15, 0);
            assertEquals(t, s.nextSendTime(t));
        }

        @Test
        @DisplayName("before the window: its start; inside: unchanged; after: tomorrow's start")
        void snapsToWindow() {
            EngagementSendSchedule s = EngagementSendSchedule.of(MON_SAT_11, OM);
            assertEquals(ist(2, 11, 0), s.nextSendTime(ist(2, 9, 30)));
            assertEquals(ist(2, 11, 40), s.nextSendTime(ist(2, 11, 40)));
            assertEquals(ist(3, 11, 0), s.nextSendTime(ist(2, 12, 0)));
        }

        @Test
        @DisplayName("a day the engine doesn't send on is skipped (Sunday → Monday)")
        void skipsOffDays() {
            EngagementSendSchedule s = EngagementSendSchedule.of(MON_SAT_11, OM);
            assertEquals(ist(2, 11, 0), s.nextSendTime(ist(1, 10, 0)));
            assertEquals(ist(2, 0, 0), s.startOfNextAllowedDay(ist(1, 10, 0)));
        }

        @Test
        @DisplayName("a group's first look lands inside the next window")
        void firstWakeInsideWindow() {
            EngagementSendSchedule s = EngagementSendSchedule.of(MON_SAT_11, OM);
            for (int i = 0; i < 50; i++) {
                Instant wake = s.firstWake(48, ist(2, 9, 0));
                assertFalse(wake.isBefore(ist(2, 11, 0)), wake.toString());
                assertTrue(wake.isBefore(ist(2, 12, 0)), wake.toString());
                Instant late = s.firstWake(48, ist(2, 11, 50));
                assertEquals(late, s.nextSendTime(late), "stays inside the window: " + late);
            }
        }

        @Test
        @DisplayName("'reach them right away' looks at people added together within the hour")
        void enrolNow() {
            EngagementSendSchedule s = EngagementSendSchedule.of(MON_SAT_11.replace("}", ",\"firstTouch\":\"IMMEDIATE\"}"), OM);
            Instant now = ist(2, 15, 0);
            for (int i = 0; i < 50; i++) {
                Instant wake = s.enrolWake(48, now);
                assertTrue(wake.isAfter(now) && !wake.isAfter(now.plusSeconds(3600)), wake.toString());
            }
        }

        @Test
        @DisplayName("'wait for the send time' (and engines saved before the choice) keep the window/cadence spread")
        void enrolWaitOrLegacy() {
            EngagementSendSchedule wait = EngagementSendSchedule.of(MON_SAT_11.replace("}", ",\"firstTouch\":\"SCHEDULED\"}"), OM);
            Instant w = wait.enrolWake(48, ist(2, 15, 0));
            assertFalse(w.isBefore(ist(3, 11, 0)), w.toString());
            EngagementSendSchedule legacy = EngagementSendSchedule.of(MON_SAT_11, OM);
            Instant l = legacy.enrolWake(48, ist(2, 15, 0));
            assertFalse(l.isBefore(ist(3, 11, 0)), "no firstTouch saved: window, not right away " + l);
        }

        @Test
        @DisplayName("firstTouch SCHEDULED is read")
        void firstTouchScheduled() {
            assertFalse(EngagementSendSchedule.of("{\"firstTouch\":\"SCHEDULED\"}", OM).firstTouchImmediate());
        }
    }

    @Nested
    @DisplayName("PolicyGate.scheduleSend")
    class Gate {
        private PolicyGate gate;

        @BeforeEach
        void setUp() {
            gate = new PolicyGate(mock(EngagementReadDao.class), mock(EngagementActionRepository.class));
            ReflectionTestUtils.setField(gate, "quietStartHour", 21);
            ReflectionTestUtils.setField(gate, "quietEndHour", 8);
            ReflectionTestUtils.setField(gate, "quietTimezone", "Asia/Kolkata");
        }

        @Test
        @DisplayName("planned outreach waits for the send window")
        void plannedWaits() {
            assertEquals(ist(3, 11, 0), gate.scheduleSend(engine(MON_SAT_11), ist(2, 15, 0), PolicyGate.SendTiming.PLANNED));
        }

        @Test
        @DisplayName("a first touch goes now, but not on a day off (Sunday → Monday 08:00)")
        void firstTouchHonoursDays() {
            EngagementEngine e = engine(MON_SAT_11);
            assertEquals(ist(2, 15, 0), gate.scheduleSend(e, ist(2, 15, 0), PolicyGate.SendTiming.ANYTIME));
            assertEquals(ist(2, 8, 0), gate.scheduleSend(e, ist(1, 15, 0), PolicyGate.SendTiming.ANYTIME));
        }

        @Test
        @DisplayName("a reply goes on any day, quiet hours only")
        void replyAnyDay() {
            EngagementEngine e = engine(MON_SAT_11);
            assertEquals(ist(1, 15, 0), gate.scheduleSend(e, ist(1, 15, 0), PolicyGate.SendTiming.REPLY));
            assertEquals(ist(2, 8, 0), gate.scheduleSend(e, ist(1, 23, 0), PolicyGate.SendTiming.REPLY));
        }

        @Test
        @DisplayName("an engine with no schedule keeps the old behaviour")
        void noSchedule() {
            EngagementEngine e = engine("{}");
            assertEquals(ist(1, 15, 0), gate.scheduleSend(e, ist(1, 15, 0), PolicyGate.SendTiming.PLANNED));
        }
    }

    @Nested
    @DisplayName("channel readiness")
    class Readiness {
        private InstituteRepository institutes;
        private EngagementChannelReadiness readiness;

        @BeforeEach
        void setUp() {
            institutes = mock(InstituteRepository.class);
            readiness = new EngagementChannelReadiness(institutes);
        }

        private void settings(String json) {
            Institute i = new Institute();
            i.setSetting(json);
            when(institutes.findById("i1")).thenReturn(Optional.of(i));
        }

        @Test
        @DisplayName("nothing set up: WhatsApp, Email and AI call not ready; in-app ready")
        void nothingSetUp() {
            settings("{\"setting\":{}}");
            Map<String, EngagementChannelReadiness.Readiness> r = readiness.check("i1");
            assertFalse(r.get("WHATSAPP").ready());
            assertEquals(EngagementChannelReadiness.NOT_SET_UP, r.get("EMAIL").reason());
            assertFalse(r.get("AI_CALL").ready());
            assertTrue(r.get("IN_APP").ready());
        }

        @Test
        @DisplayName("everything set up: all ready; a missing chosen sender is SENDER_MISSING")
        void allSetUp() {
            settings("""
                    {"setting":{
                      "WHATSAPP_SETTING":{"data":{"UTILITY_WHATSAPP":{"provider":"WATI","wati":{"apiKey":"k"}}}},
                      "EMAIL_SETTING":{"data":{"UTILITY_EMAIL":{"email":"a@b.c"}}},
                      "AI_CALLING_SETTING":{"data":{"campaigns":[{"id":"c1"}]}}}}
                    """);
            Map<String, EngagementChannelReadiness.Readiness> r = readiness.check("i1");
            assertTrue(r.values().stream().allMatch(EngagementChannelReadiness.Readiness::ready), r.toString());
            assertEquals(EngagementChannelReadiness.SENDER_MISSING,
                    readiness.check("i1", "OUTREACH_EMAIL").get("EMAIL").reason());
        }

        @Test
        @DisplayName("turning on an unconfigured channel is refused with a clear message")
        void refusesNewChannel() {
            settings("{\"setting\":{}}");
            VacademyException ex = assertThrows(VacademyException.class, () -> readiness.requireReady("i1",
                    "{\"WHATSAPP\":{\"enabled\":true},\"IN_APP\":{\"enabled\":true}}", null));
            assertTrue(ex.getMessage().contains("WhatsApp is not set up"), ex.getMessage());
        }

        @Test
        @DisplayName("a channel the engine already had is not re-checked, so old engines stay editable")
        void oldChannelNotRechecked() {
            settings("{\"setting\":{}}");
            String channels = "{\"WHATSAPP\":{\"enabled\":true}}";
            assertDoesNotThrow(() -> readiness.requireReady("i1", channels, channels));
        }

        @Test
        @DisplayName("email senders: every EMAIL_SETTING node, name parsed from \"Name <email>\", unverified flagged")
        void emailSenders() {
            settings("""
                    {"setting":{"EMAIL_SETTING":{"data":{
                      "UTILITY_EMAIL":{"from":"Acme Academy <hello@acme.in>","verified":true},
                      "OUTREACH_EMAIL":{"from":"sales@acme.in","verified":false},
                      "LEGACY_EMAIL":{"email":"old@acme.in"}}}}}
                    """);
            var senders = readiness.emailSenders("i1");
            assertEquals(3, senders.size());
            assertEquals(new EngagementChannelReadiness.EmailSender("UTILITY_EMAIL", "hello@acme.in", "Acme Academy", true),
                    senders.get(0));
            assertEquals(new EngagementChannelReadiness.EmailSender("OUTREACH_EMAIL", "sales@acme.in", null, false),
                    senders.get(1));
            // No verified flag (legacy): notification_service sends from it, so it counts as verified.
            assertTrue(senders.get(2).verified());
        }

        @Test
        @DisplayName("no senders, or unreadable settings: empty list (the platform default is not offered)")
        void emailSendersEmpty() {
            settings("{\"setting\":{}}");
            assertTrue(readiness.emailSenders("i1").isEmpty());
            settings("{not json");
            assertTrue(readiness.emailSenders("i1").isEmpty());
        }

        @Test
        @DisplayName("an unverified chosen sender is SENDER_NOT_VERIFIED and refused on save")
        void unverifiedSenderRefused() {
            settings("""
                    {"setting":{"EMAIL_SETTING":{"data":{
                      "UTILITY_EMAIL":{"from":"hello@acme.in","verified":true},
                      "OUTREACH_EMAIL":{"from":"sales@acme.in","verified":false}}}}}
                    """);
            assertEquals(EngagementChannelReadiness.SENDER_NOT_VERIFIED,
                    readiness.check("i1", "OUTREACH_EMAIL").get("EMAIL").reason());
            assertTrue(readiness.check("i1", "UTILITY_EMAIL").get("EMAIL").ready());
            VacademyException ex = assertThrows(VacademyException.class, () -> readiness.requireReady("i1",
                    "{\"EMAIL\":{\"enabled\":true,\"emailType\":\"OUTREACH_EMAIL\"}}", null));
            assertTrue(ex.getMessage().contains("isn't verified"), ex.getMessage());
            assertDoesNotThrow(() -> readiness.requireReady("i1",
                    "{\"EMAIL\":{\"enabled\":true,\"emailType\":\"UTILITY_EMAIL\"}}", null));
        }

        @Test
        @DisplayName("no emailType = UTILITY_EMAIL: refused when the institute has only another sender")
        void unsetSenderMeansUtility() {
            settings("{\"setting\":{\"EMAIL_SETTING\":{\"data\":{\"OUTREACH_EMAIL\":{\"from\":\"sales@acme.in\"}}}}}");
            VacademyException ex = assertThrows(VacademyException.class,
                    () -> readiness.requireReady("i1", "{\"EMAIL\":{\"enabled\":true}}", null));
            assertTrue(ex.getMessage().contains("doesn't exist"), ex.getMessage());
            assertDoesNotThrow(() -> readiness.requireReady("i1",
                    "{\"EMAIL\":{\"enabled\":true,\"emailType\":\"OUTREACH_EMAIL\"}}", null));
        }

        @Test
        @DisplayName("an old engine with no emailType picking UTILITY_EMAIL explicitly is not a sender change")
        void explicitUtilityIsNoChange() {
            settings("{\"setting\":{\"EMAIL_SETTING\":{\"data\":{\"UTILITY_EMAIL\":{\"from\":\"a@b.c\",\"verified\":false}}}}}");
            assertDoesNotThrow(() -> readiness.requireReady("i1",
                    "{\"EMAIL\":{\"enabled\":true,\"emailType\":\"UTILITY_EMAIL\"}}",
                    "{\"EMAIL\":{\"enabled\":true}}"));
        }

        @Test
        @DisplayName("unreadable settings never block")
        void unreadableNeverBlocks() {
            settings("{not json");
            assertDoesNotThrow(() -> readiness.requireReady("i1", "{\"EMAIL\":{\"enabled\":true}}", null));
        }
    }

    @Nested
    @DisplayName("save-time validation")
    class Validation {
        private EngagementEngineService service;

        @BeforeEach
        void setUp() {
            service = new EngagementEngineService(mock(EngagementEngineRepository.class),
                    mock(EngagementMemberRepository.class), mock(EngagementPromptVersionRepository.class),
                    mock(EngagementTemplateProposalRepository.class), mock(EngagementReadDao.class));
        }

        private CreateEngineRequest req(String quietHours) {
            CreateEngineRequest r = new CreateEngineRequest();
            r.setName("Demo follow-up");
            r.setBrief("Get the lead to book a demo.");
            r.setQuietHours(quietHours);
            return r;
        }

        @Test
        @DisplayName("a send time inside the quiet hours is refused")
        void sendTimeInQuietHours() {
            VacademyException ex = assertThrows(VacademyException.class, () -> service.create(
                    req("{\"startHour\":21,\"endHour\":8,\"sendHour\":22}"), "i1", "u1"));
            assertTrue(ex.getMessage().contains("22:00"), ex.getMessage());
        }

        @Test
        @DisplayName("an empty day list is refused")
        void noDays() {
            assertThrows(VacademyException.class, () -> service.create(req("{\"days\":[]}"), "i1", "u1"));
        }
    }
}
