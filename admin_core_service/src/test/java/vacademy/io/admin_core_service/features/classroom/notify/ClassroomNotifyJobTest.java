package vacademy.io.admin_core_service.features.classroom.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.reporting.client.ClassroomPanelReportClient;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ClassroomNotifyJobTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** 04:05 UTC on Monday 9 Nov 2026 is 09:35 in India and 23:05 (Sunday) in New York. */
    private static final Instant MON_0405Z = Instant.parse("2026-11-09T04:05:00Z");

    private ClassroomNotifySettingReader reader;
    private ClassroomPanelReportClient panels;
    private FakeNoticeLog noticeLog;
    private AuthService auth;
    private NotificationService mail;
    private ClassroomWhatsAppClient whatsApp;

    /** In-memory ledger with the table's unique key. */
    static final class FakeNoticeLog implements ClassroomNoticeLog {
        final Set<String> keys = new HashSet<>();
        final Map<String, Boolean> sent = new HashMap<>();
        final Map<String, String> keyOf = new HashMap<>();
        int claims;

        private static String key(String instituteId, String kind, String subjectId, String incidentKey) {
            return instituteId + "|" + kind + "|" + ClassroomNoticeLog.fit(subjectId, SUBJECT_MAX, "none")
                    + "|" + ClassroomNoticeLog.fit(incidentKey, INCIDENT_MAX, "none");
        }

        @Override
        public String claim(String instituteId, String kind, String subjectId, String incidentKey) {
            claims++;
            String key = key(instituteId, kind, subjectId, incidentKey);
            if (!keys.add(key)) return null;
            String id = UUID.randomUUID().toString();
            sent.put(id, null);
            keyOf.put(id, key);
            return id;
        }

        @Override
        public void markSent(Collection<String> ids, boolean ok) {
            ids.forEach(id -> sent.put(id, ok));
        }

        @Override
        public boolean isClaimed(String instituteId, String kind, String subjectId, String incidentKey) {
            return keys.contains(key(instituteId, kind, subjectId, incidentKey));
        }

        @Override
        public void release(Collection<String> ids) {
            for (String id : ids) {
                keys.remove(keyOf.remove(id));
                sent.remove(id);
            }
        }

        /** sent_ok of the incident rows, without the per-day digest rows. */
        List<Boolean> incidentResults() {
            List<Boolean> out = new ArrayList<>();
            sent.forEach((id, ok) -> {
                if (!keyOf.get(id).contains("|" + ClassroomNotifyService.KIND_ALERT_DAY + "|")) out.add(ok);
            });
            return out;
        }

        boolean hasIncident(String fragment) {
            return keys.stream().anyMatch(k -> k.contains(fragment)
                    && !k.contains("|" + ClassroomNotifyService.KIND_ALERT_DAY + "|"));
        }
    }

    @BeforeEach
    void setUp() {
        reader = mock(ClassroomNotifySettingReader.class);
        panels = mock(ClassroomPanelReportClient.class);
        noticeLog = new FakeNoticeLog();
        auth = mock(AuthService.class);
        mail = mock(NotificationService.class);
        whatsApp = mock(ClassroomWhatsAppClient.class);
    }

    private ClassroomNotifyService service(boolean whatsappEnabled) {
        return new ClassroomNotifyService(reader, panels, noticeLog, auth, mail, new ClassroomDigestRenderer(),
                whatsApp, whatsappEnabled, "ADMIN", "https://console.example.test", 200);
    }

    private static ClassroomNotifySetting setting(boolean email, boolean wa, boolean weekly, int hour, ZoneId zone,
                                                  List<String> roles, List<String> userIds) {
        return new ClassroomNotifySetting(email, wa, weekly, hour, zone, DayOfWeek.MONDAY, roles, userIds);
    }

    private static ClassroomNotifySettingReader.OptedIn opted(String id, ClassroomNotifySetting s) {
        return new ClassroomNotifySettingReader.OptedIn(id, "School " + id, null, s, null);
    }

    private static UserDTO user(String id, String email, String phone) {
        UserDTO u = new UserDTO();
        u.setId(id);
        u.setEmail(email);
        u.setMobileNumber(phone);
        return u;
    }

    private static ObjectNode institutes(String... ids) {
        ObjectNode n = M.createObjectNode();
        ArrayNode arr = n.putArray("institutes");
        for (String id : ids) arr.addObject().put("institute_id", id).put("rooms_with_panel", 1).put("devices", 1);
        n.put("page", 0);
        n.put("has_more", false);
        return n;
    }

    private static ObjectNode fleet(String... deviceAndKind) {
        ObjectNode n = M.createObjectNode();
        ArrayNode arr = n.putArray("alerts");
        for (int i = 0; i < deviceAndKind.length; i += 2) {
            ObjectNode a = arr.addObject();
            a.put("kind", deviceAndKind[i + 1]);
            a.put("severity", "warn");
            a.put("device_id", deviceAndKind[i]);
            a.putObject("room").put("id", "room-" + deviceAndKind[i]).put("name", "5A <b>");
            a.put("since", "2026-11-07T05:00:00Z");
            a.put("incident_key", "k-" + deviceAndKind[i]);
        }
        return n;
    }

    // ── job switch ─────────────────────────────────────────────────────────────

    @Test
    void theJobIsOffByDefaultAndTouchesNothingWhileOff() throws Exception {
        var ctor = ClassroomNotifyJob.class.getConstructor(ClassroomNotifyService.class, boolean.class);
        Value v = (Value) ctor.getParameters()[1].getAnnotation(Value.class);
        assertEquals("${classroom.notify.enabled:false}", v.value());

        ClassroomNotifyService svc = mock(ClassroomNotifyService.class);
        ClassroomNotifyJob off = new ClassroomNotifyJob(svc, false, Clock.fixed(MON_0405Z, ZoneOffset.UTC));
        off.tick();
        verifyNoInteractions(svc);

        ClassroomNotifyJob on = new ClassroomNotifyJob(svc, true, Clock.fixed(MON_0405Z, ZoneOffset.UTC));
        on.tick();
        verify(svc).runTick(MON_0405Z);
    }

    @Test
    void theTickIsLockedAndRunsHourlyAtFivePast() throws Exception {
        var m = ClassroomNotifyJob.class.getMethod("tick");
        assertEquals("0 5 * * * ?", m.getAnnotation(Scheduled.class).cron());
        SchedulerLock lock = m.getAnnotation(SchedulerLock.class);
        assertEquals("ClassroomNotifyTick", lock.name());
        assertEquals("PT50M", lock.lockAtMostFor());
    }

    @Test
    void anExceptionInTheTickIsContained() {
        ClassroomNotifyService svc = mock(ClassroomNotifyService.class);
        when(svc.runTick(any())).thenThrow(new RuntimeException("boom"));
        new ClassroomNotifyJob(svc, true, Clock.fixed(MON_0405Z, ZoneOffset.UTC)).tick();
    }

    // ── due hour ───────────────────────────────────────────────────────────────

    @Test
    void dueHourIsTheInstitutesOwnLocalHourWithTheJvmInUtc() {
        TimeZone before = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
            ClassroomNotifySetting nineIst = setting(true, false, false, 9, IST, List.of("ADMIN"), List.of());
            assertTrue(ClassroomNotifyService.isDue(nineIst, MON_0405Z));                          // 09:35 IST
            assertFalse(ClassroomNotifyService.isDue(nineIst, Instant.parse("2026-11-09T03:05:00Z"))); // 08:35 IST
            assertFalse(ClassroomNotifyService.isDue(nineIst, Instant.parse("2026-11-09T09:05:00Z"))); // 14:35 IST

            ClassroomNotifySetting elevenNy = setting(true, false, false, 23, ZoneId.of("America/New_York"),
                    List.of("ADMIN"), List.of());
            assertTrue(ClassroomNotifyService.isDue(elevenNy, MON_0405Z));                          // 23:05 EST
            ClassroomNotifySetting nineUtc = setting(true, false, false, 9, ZoneOffset.UTC, List.of("ADMIN"), List.of());
            assertFalse(ClassroomNotifyService.isDue(nineUtc, MON_0405Z));
        } finally {
            TimeZone.setDefault(before);
        }
    }

    @Test
    void nobodyDueMeansNoCallToAnyService() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 15, IST, List.of("ADMIN"), List.of()))));
        ClassroomNotifyService.TickResult r = service(false).runTick(MON_0405Z);
        assertEquals(0, r.due());
        verifyNoInteractions(panels, auth, mail, whatsApp);
    }

    // ── alerts ─────────────────────────────────────────────────────────────────

    @Test
    void newIncidentsAreEmailedOnceAndTheSecondRunSendsNothing() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE", "d2", "AWAITING_APPROVAL", "d3", "UNUSED"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN")))
                .thenReturn(List.of(user("u1", "admin@example.test", null)));

        ClassroomNotifyService svc = service(false);
        ClassroomNotifyService.TickResult first = svc.runTick(MON_0405Z);
        assertEquals(2, first.alertsClaimed()); // UNUSED is not a notify kind
        verify(mail, times(1)).sendHtmlEmailViaUnified(eq("admin@example.test"),
                eq("2 new classroom panel alerts for School a"), anyString(), eq("a"), eq(null), eq(null),
                eq("UTILITY_EMAIL"));
        assertTrue(noticeLog.sent.values().stream().allMatch(Boolean.TRUE::equals));

        ClassroomNotifyService.TickResult second = svc.runTick(MON_0405Z.plusSeconds(86_400));
        assertEquals(0, second.alertsClaimed());
        verify(mail, times(1)).sendHtmlEmailViaUnified(anyString(), anyString(), anyString(), anyString(),
                any(), any(), anyString());
    }

    @Test
    void aNewIncidentKeyOnTheSameDeviceIsNotifiedAgain() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        ObjectNode f1 = fleet("d1", "OFFLINE");
        ObjectNode f2 = fleet("d1", "OFFLINE");
        ((ObjectNode) f2.path("alerts").get(0)).put("incident_key", "k-later");
        when(panels.fetchFleet("a")).thenReturn(f1, f2);
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN")))
                .thenReturn(List.of(user("u1", "admin@example.test", null)));

        ClassroomNotifyService svc = service(false);
        assertEquals(1, svc.runTick(MON_0405Z).alertsClaimed());
        assertEquals(1, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
    }

    @Test
    void namedRecipientsAreIntersectedWithTheInstitutesAdmins() {
        when(reader.loadOptedIn()).thenReturn(List.of(opted("a",
                setting(true, false, false, 9, IST, List.of("ADMIN"), List.of("u1", "outsider")))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN"))).thenReturn(List.of(
                user("u1", "one@example.test", null), user("u2", "two@example.test", null)));

        service(false).runTick(MON_0405Z);

        verify(mail).sendHtmlEmailViaUnified(eq("one@example.test"), anyString(), anyString(), eq("a"),
                any(), any(), anyString());
        verify(mail, never()).sendHtmlEmailViaUnified(eq("two@example.test"), anyString(), anyString(),
                anyString(), any(), any(), anyString());
        verify(auth, never()).requireUsersByInstituteAndRoles(eq("a"), eq(List.of("TEACHER")));
    }

    @Test
    void rolesOutsideTheAllowlistFallBackToAdmin() {
        when(reader.loadOptedIn()).thenReturn(List.of(opted("a",
                setting(true, false, false, 9, IST, List.of("TEACHER"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN")))
                .thenReturn(List.of(user("u1", "one@example.test", null)));

        service(false).runTick(MON_0405Z);

        verify(auth).requireUsersByInstituteAndRoles("a", List.of("ADMIN"));
        verify(auth, never()).requireUsersByInstituteAndRoles("a", List.of("TEACHER"));
    }

    @Test
    void oneFailingInstituteDoesNotStopTheNext() {
        ClassroomNotifySetting s = setting(true, false, false, 9, IST, List.of("ADMIN"), List.of());
        when(reader.loadOptedIn()).thenReturn(List.of(opted("bad", s), opted("good", s)));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("bad", "good"));
        when(panels.fetchFleet("bad")).thenThrow(new RuntimeException("boom"));
        when(panels.fetchFleet("good")).thenReturn(fleet("d1", "UPDATE_REQUIRED"));
        when(auth.requireUsersByInstituteAndRoles("good", List.of("ADMIN")))
                .thenReturn(List.of(user("u1", "good@example.test", null)));

        ClassroomNotifyService.TickResult r = service(false).runTick(MON_0405Z);

        assertEquals(1, r.failed());
        assertEquals(1, r.processed());
        verify(mail).sendHtmlEmailViaUnified(eq("good@example.test"), anyString(), anyString(), eq("good"),
                any(), any(), anyString());
    }

    @Test
    void aFailedRecipientLookupClaimsNothingSoTheIncidentIsOfferedAgain() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN")))
                .thenThrow(new VacademyException("auth down"))
                .thenReturn(List.of(user("u1", "admin@example.test", null)));

        ClassroomNotifyService svc = service(false);
        ClassroomNotifyService.TickResult first = svc.runTick(MON_0405Z);
        assertEquals(1, first.failed());
        assertTrue(noticeLog.keys.isEmpty());

        assertEquals(1, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
    }

    @Test
    void aSendFailureMarksTheClaimedRowsAndDoesNotRetry() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN")))
                .thenReturn(List.of(user("u1", "admin@example.test", null)));
        doThrow(new VacademyException("mail down")).when(mail).sendHtmlEmailViaUnified(
                anyString(), anyString(), anyString(), anyString(), any(), any(), anyString());

        ClassroomNotifyService svc = service(false);
        assertEquals(1, svc.runTick(MON_0405Z).alertsClaimed());
        assertEquals(List.of(Boolean.FALSE), noticeLog.incidentResults());
        assertEquals(0, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
    }

    @Test
    void anInstituteWithoutPanelsIsNotAskedForAlerts() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("other"));
        service(false).runTick(MON_0405Z);
        verify(panels, never()).fetchFleet(anyString());
    }

    @Test
    void anUnreadableInstituteListSkipsTheTick() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(anyInt())).thenReturn(null);
        ClassroomNotifyService.TickResult r = service(false).runTick(MON_0405Z);
        assertEquals(1, r.failed());
        verify(panels, never()).fetchFleet(anyString());
    }

    @Test
    void institutePagesAreFollowedUntilHasMoreIsFalse() {
        ObjectNode p0 = institutes("x");
        p0.put("has_more", true);
        when(panels.fetchInstitutesPage(0)).thenReturn(p0);
        when(panels.fetchInstitutesPage(1)).thenReturn(institutes("y"));
        assertEquals(Set.of("x", "y"), service(false).institutesWithPanels());
    }

    @Test
    void alertWhatsAppNeedsThePlatformSwitch() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(false, true, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN")))
                .thenReturn(List.of(user("u1", "admin@example.test", "+911234567890")));

        service(false).runTick(MON_0405Z);
        verify(panels, never()).fetchFleet(anyString());
        verifyNoInteractions(whatsApp);

        when(whatsApp.send(anyString(), anyString(), anyString(), anyMap())).thenReturn(ClassroomWhatsAppClient.Outcome.SENT);
        service(true).runTick(MON_0405Z);
        verify(whatsApp).send(eq(ClassroomWhatsAppClient.KIND_ALERTS), eq("911234567890"), eq("School a"),
                eq(Map.of("alert_count", "1",
                        "link", "https://console.example.test/settings?selectedTab=classroomPanels&view=alerts")));
        verify(mail, never()).sendHtmlEmailViaUnified(anyString(), anyString(), anyString(), anyString(),
                any(), any(), anyString());
    }

    // ── weekly WhatsApp ────────────────────────────────────────────────────────

    private static ObjectNode usage(int sessions, int idle) {
        ObjectNode s = M.createObjectNode();
        ObjectNode t = s.putObject("totals");
        t.put("panel_hours", 31.25);
        t.put("sessions", sessions);
        t.put("rooms_used", 17);
        t.put("rooms_with_panel", 20);
        t.put("idle_rooms", idle);
        return s;
    }

    @Test
    void weeklySummaryGoesOnceOnTheConfiguredDayForThePreviousWeek() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(false, false, true, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchUsageSummary(eq("a"), any(), any(), anyString())).thenReturn(usage(52, 3));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN"))).thenReturn(List.of(
                user("u1", "admin@example.test", "+911234567890"), user("u2", "nophone@example.test", null)));
        when(whatsApp.send(anyString(), anyString(), anyString(), anyMap())).thenReturn(ClassroomWhatsAppClient.Outcome.SENT);

        ClassroomNotifyService svc = service(true);
        assertEquals(1, svc.runTick(MON_0405Z).weeklyClaimed());
        verify(panels).fetchUsageSummary("a", LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 8), "Asia/Kolkata");
        verify(whatsApp).send(ClassroomWhatsAppClient.KIND_WEEKLY_SUMMARY, "911234567890", "School a",
                Map.of("hours", "31.3", "rooms_used", "17", "rooms_total", "20", "idle_rooms", "3",
                        "link", "https://console.example.test/settings?selectedTab=classroomPanels&view=usage"));
        assertTrue(noticeLog.keys.contains("a|WEEKLY_WA|week|2026-11-02"));

        // Same day again (e.g. an overlapping tick): already claimed.
        assertEquals(0, svc.runTick(MON_0405Z.plusSeconds(60)).weeklyClaimed());
        // Tuesday: not the configured day.
        assertEquals(0, svc.runTick(MON_0405Z.plusSeconds(86_400)).weeklyClaimed());
        verify(whatsApp, times(1)).send(anyString(), anyString(), anyString(), anyMap());
    }

    @Test
    void weeklySummaryNeedsThePlatformSwitchAndSkipsAnEmptyWeek() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(false, false, true, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        service(false).runTick(MON_0405Z);
        verify(panels, never()).fetchUsageSummary(anyString(), any(), any(), anyString());

        when(panels.fetchUsageSummary(eq("a"), any(), any(), anyString())).thenReturn(usage(0, 0));
        assertEquals(0, service(true).runTick(MON_0405Z).weeklyClaimed());
        assertTrue(noticeLog.keys.isEmpty());
        verifyNoInteractions(whatsApp);
    }

    // ── catch-up, deliverability, phone numbers ─────────────────────────────────

    private static final Instant MON_1005_IST = Instant.parse("2026-11-09T04:35:00Z");

    private void oneAdmin(String email, String phone) {
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN"))).thenReturn(List.of(user("u1", email, phone)));
    }

    @Test
    void aMissedTickIsMadeUpByTheNextHourAndSentOnlyOnceThatDay() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        // The 09:05 tick could not read the institute list (auth restarting).
        when(panels.fetchInstitutesPage(0)).thenReturn(null, institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"), fleet("d1", "OFFLINE", "d2", "OFFLINE"));
        oneAdmin("admin@example.test", null);

        ClassroomNotifyService svc = service(false);
        assertEquals(1, svc.runTick(Instant.parse("2026-11-09T03:35:00Z")).failed()); // 09:05 IST
        assertEquals(1, svc.runTick(MON_1005_IST).alertsClaimed());                   // 10:05 IST
        // A later tick the same day sends nothing, even for an incident that appeared since.
        assertEquals(0, svc.runTick(MON_1005_IST.plusSeconds(1800)).alertsClaimed());
        verify(panels, times(1)).fetchFleet("a");
        verify(mail, times(1)).sendHtmlEmailViaUnified(anyString(), anyString(), anyString(), anyString(),
                any(), any(), anyString());
        // Past the catch-up hours nothing is due.
        assertFalse(ClassroomNotifyService.isDue(
                setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()), Instant.parse("2026-11-09T06:35:00Z")));

        // The next day the new incident goes out.
        assertEquals(1, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
    }

    @Test
    void aDayWithoutAlertsIsDoneSoALaterIncidentWaitsForTomorrow() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet(), fleet("d1", "OFFLINE"));
        oneAdmin("admin@example.test", null);

        ClassroomNotifyService svc = service(false);
        assertEquals(0, svc.runTick(MON_0405Z).alertsClaimed());
        assertEquals(0, svc.runTick(MON_1005_IST).alertsClaimed());
        verify(panels, times(1)).fetchFleet("a");
        assertEquals(1, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
    }

    @Test
    void theWeeklySummaryIsMadeUpWhenTheConfiguredHourWasMissed() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(false, false, true, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchUsageSummary(eq("a"), any(), any(), anyString())).thenReturn(usage(52, 3));
        oneAdmin("admin@example.test", "9876543210");
        when(whatsApp.send(anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(ClassroomWhatsAppClient.Outcome.SENT);

        ClassroomNotifyService svc = service(true);
        assertEquals(1, svc.runTick(MON_1005_IST).weeklyClaimed());
        assertEquals(0, svc.runTick(MON_1005_IST.plusSeconds(3600)).weeklyClaimed());
        verify(panels, times(1)).fetchUsageSummary(eq("a"), any(), any(), anyString());
        assertTrue(noticeLog.keys.contains("a|WEEKLY_WA|week|2026-11-02"));
    }

    @Test
    void nobodyToReachMeansNothingIsClaimed() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(true, false, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        when(auth.requireUsersByInstituteAndRoles("a", List.of("ADMIN"))).thenReturn(List.of(), 
                List.of(user("u1", " ", "9876543210")), List.of(user("u1", "admin@example.test", null)));

        ClassroomNotifyService svc = service(false);
        assertEquals(0, svc.runTick(MON_0405Z).alertsClaimed());   // no recipient at all
        assertEquals(0, svc.runTick(MON_1005_IST).alertsClaimed()); // recipients without an email
        assertTrue(noticeLog.keys.isEmpty());
        verifyNoInteractions(mail);
        // Once someone can be reached, the same incident goes out.
        assertEquals(1, svc.runTick(MON_1005_IST.plusSeconds(3600)).alertsClaimed());
    }

    @Test
    void anUnavailableChannelReleasesTheClaimsSoALaterRunOffersThemAgain() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(false, true, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        oneAdmin(null, "9876543210");
        when(whatsApp.send(anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(ClassroomWhatsAppClient.Outcome.UNAVAILABLE, ClassroomWhatsAppClient.Outcome.SENT);

        ClassroomNotifyService svc = service(true);
        assertEquals(0, svc.runTick(MON_0405Z).alertsClaimed());
        assertFalse(noticeLog.hasIncident("|OFFLINE|d1|"));
        assertEquals(1, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
        assertEquals(List.of(Boolean.TRUE), noticeLog.incidentResults());
    }

    @Test
    void aGenuineSendFailureIsMarkedAndNeverClaimedAgain() {
        when(reader.loadOptedIn()).thenReturn(List.of(
                opted("a", setting(false, true, false, 9, IST, List.of("ADMIN"), List.of()))));
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        oneAdmin(null, "9876543210");
        when(whatsApp.send(anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(ClassroomWhatsAppClient.Outcome.FAILED);

        ClassroomNotifyService svc = service(true);
        assertEquals(1, svc.runTick(MON_0405Z).alertsClaimed());
        assertEquals(List.of(Boolean.FALSE), noticeLog.incidentResults());
        assertEquals(0, svc.runTick(MON_0405Z.plusSeconds(86_400)).alertsClaimed());
    }

    @Test
    void aBareNationalNumberGetsTheCountryCodeOnlyForAnIndiaOrUnsetInstitute() {
        ClassroomNotifySetting s = setting(false, true, false, 9, IST, List.of("ADMIN"), List.of());
        when(panels.fetchInstitutesPage(0)).thenReturn(institutes("a"));
        when(panels.fetchFleet("a")).thenReturn(fleet("d1", "OFFLINE"));
        oneAdmin(null, "9876543210");
        when(whatsApp.send(anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(ClassroomWhatsAppClient.Outcome.SENT);

        when(reader.loadOptedIn()).thenReturn(List.of(opted("a", s)));
        service(true).runTick(MON_0405Z);
        verify(whatsApp).send(eq(ClassroomWhatsAppClient.KIND_ALERTS), eq("919876543210"), anyString(), anyMap());

        noticeLog = new FakeNoticeLog();
        when(reader.loadOptedIn()).thenReturn(List.of(
                new ClassroomNotifySettingReader.OptedIn("a", "School a", null, s, "United States")));
        service(true).runTick(MON_0405Z);
        verify(whatsApp).send(eq(ClassroomWhatsAppClient.KIND_ALERTS), eq("9876543210"), anyString(), anyMap());
    }

    @Test
    void theDigestCountsEveryNewAlertAndSaysHowManyAreNotListed() {
        List<ClassroomDigestRenderer.Item> items = new ArrayList<>();
        for (int i = 0; i < ClassroomNotifyService.MAX_DIGEST_ITEMS; i++) {
            items.add(new ClassroomDigestRenderer.Item("OFFLINE", "warn", "Room " + i, null));
        }
        String html = new ClassroomDigestRenderer().render("School", items, 73, IST, null);
        assertTrue(html.contains("73 new classroom panel alerts"));
        assertTrue(html.contains("and 23 more"));
        String all = new ClassroomDigestRenderer().render("School", items.subList(0, 2), 2, IST, null);
        assertFalse(all.contains("more. Open"));
    }

    // ── small pieces ───────────────────────────────────────────────────────────

    @Test
    void subjectFallsBackFromDeviceToRoomToInstitute() {
        ObjectNode a = M.createObjectNode();
        assertEquals("institute", ClassroomNotifyService.subjectOf(a));
        a.putObject("room").put("id", "r1");
        assertEquals("r1", ClassroomNotifyService.subjectOf(a));
        a.put("device_id", "d1");
        assertEquals("d1", ClassroomNotifyService.subjectOf(a));
    }

    @Test
    void ledgerValuesAreCutToTheColumnWidths() {
        String longKey = "x".repeat(200);
        assertEquals(64, ClassroomNoticeLog.fit(longKey, ClassroomNoticeLog.INCIDENT_MAX, "none").length());
        assertEquals("none", ClassroomNoticeLog.fit(null, ClassroomNoticeLog.INCIDENT_MAX, "none"));
        assertNotNull(noticeLog.claim("a", "OFFLINE", "d", longKey));
        assertNull(noticeLog.claim("a", "OFFLINE", "d", longKey + "different-tail"));
    }

    @Test
    void theDigestEscapesDataAndCarriesTheLink() {
        String html = new ClassroomDigestRenderer().render("A & B <School>",
                List.of(new ClassroomDigestRenderer.Item("OFFLINE", "warn", "5A <b>", "2026-11-07T05:00:00Z")), 1,
                IST, "https://console.example.test/settings?selectedTab=classroomPanels&view=alerts");
        assertTrue(html.contains("A &amp; B &lt;School&gt;"));
        assertTrue(html.contains("5A &lt;b&gt;"));
        assertFalse(html.contains("<School>"));
        assertTrue(html.contains("7 Nov, 10:30"));
        assertTrue(html.contains("Check the panel is switched on"));
        assertTrue(html.contains("view=alerts"));
    }

    @Test
    void settingParsesWithSafeDefaults() throws Exception {
        ClassroomNotifySetting d = ClassroomNotifySetting.from(M.readTree("{}"));
        assertFalse(d.anyChannelOn());
        assertEquals(9, d.hour());
        assertEquals(IST, d.zone());
        assertEquals(DayOfWeek.MONDAY, d.weeklyDay());
        assertEquals(List.of("ADMIN"), d.recipientRoles());

        ClassroomNotifySetting s = ClassroomNotifySetting.from(M.readTree(
                "{\"alerts_email\":true,\"hour\":42,\"timezone\":\"Mars/Base\",\"weekly_day\":\"friday\","
                        + "\"recipient_roles\":[\"admin\",7],\"recipient_user_ids\":[\"u1\",\"u1\"]}"));
        assertTrue(s.alertsEmail());
        assertEquals(9, s.hour());
        assertEquals(IST, s.zone());
        assertEquals(DayOfWeek.FRIDAY, s.weeklyDay());
        assertEquals(List.of("ADMIN"), s.recipientRoles());
        assertEquals(List.of("u1"), s.recipientUserIds());
    }

    @Test
    void theSettingReaderSkipsBadBlobsAndInstitutesWithEveryChannelOff() {
        ClassroomNotifySettingReader r = new ClassroomNotifySettingReader(null, M);
        assertNull(r.parse("a", "A", null, null, "{not json"));
        assertNull(r.parse("a", "A", null, null,
                "{\"setting\":{\"CLASSROOM_NOTIFY_SETTING\":{\"data\":{\"alerts_email\":false}}}}"));
        ClassroomNotifySettingReader.OptedIn ok = r.parse("a", "A", "blue", "India",
                "{\"setting\":{\"CLASSROOM_NOTIFY_SETTING\":{\"data\":{\"whatsapp_weekly\":true}}}}");
        assertNotNull(ok);
        assertTrue(ok.setting().whatsappWeekly());
        assertEquals("India", ok.country());
    }
}
