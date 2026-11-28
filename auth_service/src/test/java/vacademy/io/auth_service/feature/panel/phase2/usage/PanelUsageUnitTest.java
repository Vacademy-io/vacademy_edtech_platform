package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import vacademy.io.auth_service.feature.institute_oauth.service.InstituteOAuthClientAccessGuard;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ActivityEvent;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SessionEndRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.SyncRequest;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.UsageRoom;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.ContentFact;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.LivePanel;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.NewEvent;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.SessionFact;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelProperties;
import vacademy.io.auth_service.feature.panel.service.PanelTx;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Usage service and activity recorder rules with a mocked repository: no database. */
class PanelUsageUnitTest {

    private static final long MIN = 60_000L;
    private static final long HOUR = 60 * MIN;

    private static String code(Runnable call) {
        try {
            call.run();
        } catch (PanelApiException e) {
            return e.getCode();
        } catch (VacademyException e) {
            return "HTTP_" + e.getStatus().value();
        }
        return "OK";
    }

    private static CustomUserDetails principal(String userId) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(userId);
        return user;
    }

    @SuppressWarnings("unchecked")
    private static PanelTx directTx() {
        PanelTx tx = mock(PanelTx.class);
        when(tx.run(any())).thenAnswer(call -> ((Supplier<Object>) call.getArgument(0)).get());
        return tx;
    }

    private static PanelProperties panelProperties() {
        return new PanelProperties(true, true, 1, 4, false, 9999, 30, 4, 1, "https://classroom.example", "", "");
    }

    // ============================================================= service ===

    @Nested
    class Service {

        private PanelUsageRepository repository;
        private InstituteOAuthClientAccessGuard guard;
        private PanelTx tx;
        private final CustomUserDetails admin = principal("admin-1");

        @BeforeEach
        void setUp() {
            repository = mock(PanelUsageRepository.class);
            guard = mock(InstituteOAuthClientAccessGuard.class);
            tx = directTx();
            when(repository.nowMs()).thenReturn(Instant.parse("2026-11-07T10:00:00Z").toEpochMilli());
        }

        private PanelUsageService service(Map<String, String> props) {
            return new PanelUsageService(repository, guard, tx, PanelPhase2Properties.of(props), panelProperties());
        }

        private PanelUsageService on() {
            return service(Map.of("panel.usage.enabled", "true"));
        }

        @Test
        void switchedOffAnswersFeatureOffBeforeReadingAnything() {
            PanelUsageService off = service(Map.of());
            assertThat(code(() -> off.usage(admin, "i1", "2026-11-01", "2026-11-07", "Asia/Kolkata")))
                    .isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.usage(admin, null, null, null, null))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.sessions(admin, "i1", "2026-11-01", "2026-11-07", null, null, null, 0, 50)))
                    .isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.multi(admin, "i1,i2", "2026-11-01", "2026-11-07", null)))
                    .isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.summary("i1", "2026-11-01", "2026-11-07", null))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.institutes(0))).isEqualTo("FEATURE_OFF");
            assertThat(code(() -> off.hasPanels("i1"))).isEqualTo("FEATURE_OFF");
            verifyNoInteractions(repository, guard, tx);
        }

        @Test
        void featureOffIsA404() {
            try {
                service(Map.of()).usage(admin, "i1", "2026-11-01", "2026-11-07", null);
            } catch (PanelApiException e) {
                assertThat(e.getHttpStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                return;
            }
            throw new AssertionError("expected FEATURE_OFF");
        }

        @Test
        void internalListingsOpenWithFleetAlone() {
            PanelUsageService fleetOnly = service(Map.of("panel.fleet.enabled", "true"));
            when(repository.hasLivePanels("i1")).thenReturn(true);
            assertThat(fleetOnly.hasPanels("i1").hasPanels()).isTrue();
            assertThat(code(() -> fleetOnly.summary("i1", "2026-11-01", "2026-11-07", null)))
                    .isEqualTo("FEATURE_OFF");
        }

        @Test
        void aNonAdminReadsNothing() {
            doThrow(new VacademyException(HttpStatus.FORBIDDEN, "no")).when(guard)
                    .requireInstituteAdmin(any(), eq("other"));
            PanelUsageService usage = on();
            assertThat(code(() -> usage.usage(admin, "other", "2026-11-01", "2026-11-07", null)))
                    .isEqualTo("HTTP_403");
            assertThat(code(() -> usage.sessions(admin, "other", "2026-11-01", "2026-11-07", null, null, null, 0,
                    50))).isEqualTo("HTTP_403");
            verify(repository, never()).sessions(anyString(), anyLong(), anyLong());
            verify(repository, never()).sessionPage(anyString(), anyLong(), anyLong(), any(), any(), anyInt(),
                    anyLong());
            verify(repository, never()).countSessions(anyString(), anyLong(), anyLong(), any(), any());
        }

        @Test
        void multiRefusesWhenAnyInstituteIsNotAdministeredAndReadsNothing() {
            doThrow(new VacademyException(HttpStatus.FORBIDDEN, "no")).when(guard)
                    .requireInstituteAdmin(any(), eq("b"));
            PanelUsageService usage = on();
            assertThat(code(() -> usage.multi(admin, "a, b ,c", "2026-11-01", "2026-11-07", null)))
                    .isEqualTo("HTTP_403");
            verify(repository, never()).nowMs();
            verify(repository, never()).sessions(anyString(), anyLong(), anyLong());
        }

        @Test
        void multiIsCappedAndNeedsIds() {
            PanelUsageService usage = on();
            String fiftyOne = String.join(",", IntStream.range(0, 51).mapToObj(i -> "i" + i).toList());
            assertThat(code(() -> usage.multi(admin, fiftyOne, "2026-11-01", "2026-11-07", null)))
                    .isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.multi(admin, " , ", "2026-11-01", "2026-11-07", null)))
                    .isEqualTo("BAD_REQUEST");
            verifyNoInteractions(guard);
        }

        @Test
        void multiAnswersTotalsPerInstitute() {
            PanelUsageService usage = on();
            var rows = usage.multi(admin, "a,b,a", "2026-11-01", "2026-11-07", null);
            assertThat(rows).extracting(r -> r.instituteId()).containsExactly("a", "b");
            verify(guard).requireInstituteAdmin(admin, "a");
            verify(guard).requireInstituteAdmin(admin, "b");
        }

        @Test
        void datesAreValidated() {
            PanelUsageService usage = on();
            assertThat(code(() -> usage.usage(admin, "i1", null, "2026-11-07", null))).isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.usage(admin, "i1", "07/11/2026", "2026-11-07", null)))
                    .isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.usage(admin, "i1", "2026-11-08", "2026-11-07", null)))
                    .isEqualTo("BAD_REQUEST");
            // 93 days is one too many; 92 is fine.
            assertThat(code(() -> usage.usage(admin, "i1", "2026-08-07", "2026-11-07", null)))
                    .isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.usage(admin, "i1", "2026-08-08", "2026-11-07", null))).isEqualTo("OK");
        }

        @Test
        void pagingIsValidated() {
            PanelUsageService usage = on();
            assertThat(code(() -> usage.sessions(admin, "i1", "2026-11-01", "2026-11-07", null, null, null, -1, 50)))
                    .isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.sessions(admin, "i1", "2026-11-01", "2026-11-07", null, null, null, 0, 201)))
                    .isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.sessions(admin, "i1", "2026-11-01", "2026-11-07", null, "r\n1", null, 0,
                    50))).isEqualTo("BAD_REQUEST");
            assertThat(code(() -> usage.sessions(admin, "i1", "2026-11-01", "2026-11-07", null, null, null, null,
                    null))).isEqualTo("OK");
            verify(repository).sessionPage(eq("i1"), anyLong(), anyLong(), eq(null), eq(null), eq(50), eq(0L));
        }

        @Test
        void aReportStatementPastItsTimeLimitAnswersBusyNotAnError() {
            java.sql.SQLException cancelled = new java.sql.SQLException(
                    "canceling statement due to statement timeout", "57014");
            when(repository.sessions(eq("i1"), anyLong(), anyLong()))
                    .thenThrow(new org.springframework.jdbc.UncategorizedSQLException("report", "SELECT", cancelled));
            when(repository.countSessions(anyString(), anyLong(), anyLong(), any(), any()))
                    .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("x", cancelled));
            PanelUsageService usage = on();
            for (Runnable call : List.<Runnable>of(
                    () -> usage.usage(admin, "i1", "2026-11-01", "2026-11-07", null),
                    () -> usage.summary("i1", "2026-11-01", "2026-11-07", null),
                    () -> usage.sessions(admin, "i1", "2026-11-01", "2026-11-07", null, null, null, 0, 50))) {
                try {
                    call.run();
                    throw new AssertionError("expected BUSY");
                } catch (PanelApiException e) {
                    assertThat(e.getCode()).isEqualTo("BUSY");
                    assertThat(e.getHttpStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                }
            }
            assertThat(PanelUsageService.statementTimedOut(new QueryTimeoutException("t"))).isTrue();
            assertThat(PanelUsageService.statementTimedOut(new IllegalStateException("x",
                    new java.sql.SQLException("other", "23505")))).isFalse();

            // Any other failure is not dressed up as BUSY.
            when(repository.sessions(eq("i2"), anyLong(), anyLong())).thenThrow(new IllegalStateException("bug"));
            assertThatThrownBy(() -> usage.usage(admin, "i2", "2026-11-01", "2026-11-07", null))
                    .isInstanceOf(IllegalStateException.class);
        }

        @Test
        void reportIsCachedPerWindowButAuthorisedEveryTime() {
            PanelUsageService usage = on();
            usage.usage(admin, "i1", "2026-11-01", "2026-11-07", "Asia/Kolkata");
            usage.usage(admin, "i1", "2026-11-01", "2026-11-07", "Asia/Kolkata");
            usage.usage(admin, "i1", "2026-11-01", "2026-11-07", "Europe/Paris");
            verify(guard, times(3)).requireInstituteAdmin(admin, "i1");
            verify(repository, times(2)).sessions(eq("i1"), anyLong(), anyLong());
        }

        @Test
        void unknownZoneIsReportedAsKolkata() {
            when(repository.contentRecordedFromMs("i1")).thenReturn(null);
            UsageResponse report = on().usage(admin, "i1", "2026-11-01", "2026-11-07", "Nowhere/Land");
            assertThat(report.tz()).isEqualTo("Asia/Kolkata");
            assertThat(report.byDay()).hasSize(7);
            assertThat(report.totals().coveragePct()).isNull();
            assertThat(report.notes().contentRecordedFrom()).isNull();
        }

        @Test
        void summaryKeepsShortListsWithLeastUsedRoomsFirst() {
            PanelUsageService usage = on();
            long start = Instant.parse("2026-11-02T04:00:00Z").toEpochMilli();
            List<SessionFact> sessions = new ArrayList<>();
            for (int i = 0; i < 20; i++) {
                long created = start + i * MIN;
                long ended = created + (i + 1) * MIN * 3;
                sessions.add(new SessionFact("s" + i, "r" + i, "Room " + i, "u" + i, "T" + i, "QR", "SIGN_OUT",
                        created, ended, ended, null, created + 4 * HOUR, false));
            }
            when(repository.sessions(eq("i1"), anyLong(), anyLong())).thenReturn(sessions);
            UsageResponse summary = usage.summary("i1", "2026-11-01", "2026-11-07", null);
            assertThat(summary.byRoom()).hasSize(15);
            assertThat(summary.byRoom().get(0).room().id()).isEqualTo("r0");
            assertThat(summary.byRoom()).extracting(UsageRoom::panelHours).isSorted();
            assertThat(summary.byTeacher()).hasSize(10);
            assertThat(summary.byTeacher().get(0).user().id()).isEqualTo("u19");
        }
    }

    // ============================================================ assemble ===

    @Nested
    class Assemble {

        private final PanelUsageService service = new PanelUsageService(mock(PanelUsageRepository.class),
                mock(InstituteOAuthClientAccessGuard.class), directTx(),
                PanelPhase2Properties.of(Map.of("panel.usage.enabled", "true")), panelProperties());
        private final PanelUsageService.Window window = service.window("2026-11-03", "2026-11-04", "Asia/Kolkata");
        private final long day1 = Instant.parse("2026-11-03T04:00:00Z").toEpochMilli(); // 09:30 IST
        private final long day2 = Instant.parse("2026-11-04T04:00:00Z").toEpochMilli();
        private final long now = Instant.parse("2026-11-04T06:00:00Z").toEpochMilli();

        private SessionFact session(String id, String room, String user, long created, long minutes,
                boolean events) {
            long end = created + minutes * MIN;
            return new SessionFact(id, room, "Name " + room, user, "Teacher " + user, "QR", "SIGN_OUT", created, end,
                    end, null, created + 4 * HOUR, events);
        }

        @Test
        void totalsDaysRoomsTeachersIdleAndContent() {
            List<SessionFact> sessions = List.of(session("a", "r1", "u1", day1, 60, true),
                    session("b", "r1", "u2", day1 + 2 * HOUR, 30, false),
                    session("c", "r2", "u1", day2, 90, true),
                    // still open: runs to now, bounded by the last sighting
                    new SessionFact("d", "r2", "Name r2", "u2", "Teacher u2", "PASSWORD", null, now - 20 * MIN, null,
                            now - 10_000, null, now + 3 * HOUR, false));
            List<ContentFact> content = List.of(
                    new ContentFact("u1", "LESSON", "slide-1", "Leaves", 40 * MIN, 1, 2, day1 + MIN),
                    new ContentFact("u2", "LESSON", "slide-1", "Leaves (new)", 20 * MIN, 1, 1, day1 + 3 * HOUR),
                    new ContentFact("u1", "CLASS", "sch-1", "Maths", 30 * MIN, 1, 1, day2),
                    new ContentFact("u1", "WHITEBOARD", null, null, 5 * MIN, 1, 1, day2));
            List<LivePanel> panels = List.of(new LivePanel("d1", "r1", "Name r1", now - HOUR, day1),
                    new LivePanel("d3", "r3", "Name r3", now - MIN, null));

            UsageResponse report = PanelUsageService.assemble("i1", window, now, sessions, content, panels, day1);

            // 60 + 30 + 90 + 20 minutes = 200 minutes = 3.3 h
            assertThat(report.totals().panelHours()).isEqualTo(3.3);
            assertThat(report.totals().sessions()).isEqualTo(4);
            assertThat(report.totals().teachers()).isEqualTo(2);
            assertThat(report.totals().roomsUsed()).isEqualTo(2);
            assertThat(report.totals().roomsWithPanel()).isEqualTo(2);
            assertThat(report.totals().idleRooms()).isEqualTo(1);
            assertThat(report.totals().classesStarted()).isEqualTo(1);
            assertThat(report.totals().coveragePct()).isEqualTo(50);

            assertThat(report.byDay()).extracting(d -> d.date()).containsExactly("2026-11-03", "2026-11-04");
            assertThat(report.byDay()).extracting(d -> d.sessions()).containsExactly(2, 2);
            assertThat(report.byDay().get(0).panelHours()).isEqualTo(1.5);

            assertThat(report.byRoom()).extracting(r -> r.room().id()).containsExactly("r2", "r1");
            assertThat(report.byRoom().get(1).teachers()).isEqualTo(2);
            assertThat(report.byRoom().get(1).daysUsed()).isEqualTo(1);

            assertThat(report.byTeacher().get(0).user().id()).isEqualTo("u1");
            assertThat(report.byTeacher().get(0).daysActive()).isEqualTo(2);
            assertThat(report.byTeacher().get(0).topContent()).extracting(c -> c.title())
                    .containsExactly("Leaves", "Maths", null);
            assertThat(report.byTeacher().get(0).topContent().get(0).refId()).isNull();

            assertThat(report.idleRooms()).singleElement().satisfies(idle -> {
                assertThat(idle.room().id()).isEqualTo("r3");
                assertThat(idle.lastUsedAt()).isNull();
                assertThat(idle.online()).isTrue();
            });

            assertThat(report.content().get(0).refId()).isEqualTo("slide-1");
            assertThat(report.content().get(0).minutes()).isEqualTo(60);
            assertThat(report.content().get(0).sessions()).isEqualTo(2);
            assertThat(report.content().get(0).teachers()).isEqualTo(2);
            assertThat(report.content().get(0).title()).isEqualTo("Leaves (new)");
            assertThat(report.notes().contentRecordedFrom()).isEqualTo("2026-11-03");
        }

        @Test
        void contentListIsTheTopTwenty() {
            List<ContentFact> content = new ArrayList<>();
            for (int i = 0; i < 30; i++) {
                content.add(new ContentFact("u1", "DECK", "d" + i, "Deck " + i, (i + 1) * MIN, 1, 1, day1));
            }
            UsageResponse report = PanelUsageService.assemble("i1", window, now, List.of(), content, List.of(), null);
            assertThat(report.content()).hasSize(20);
            assertThat(report.content().get(0).refId()).isEqualTo("d29");
        }
    }

    // ============================================================ recorder ===

    @Nested
    class Recorder {

        private final PanelUsageRepository repository = mock(PanelUsageRepository.class);
        private final PanelActivityRecorder recorder = new PanelActivityRecorder(repository);
        private final Timestamp t = Timestamp.from(Instant.parse("2026-11-03T04:00:00Z"));
        private final DeviceRow device = new DeviceRow("dev-1", "i1", "r1", "Room", "hash", "ACTIVE", "Inst", null,
                null, null, false, null, null, null, null, 3, t, null, null, t, t);
        private final SessionRow session = new SessionRow("s-1", "dev-1", "i1", "u1", "QR", "h", "ACTIVE",
                Timestamp.from(t.toInstant().plusSeconds(14_400)), t, t, null, 0, 0, null, null, t, null, null, null,
                t);

        @SuppressWarnings("unchecked")
        private List<NewEvent> stored() {
            org.mockito.ArgumentCaptor<List<NewEvent>> captor = org.mockito.ArgumentCaptor.forClass(List.class);
            verify(repository).insertEvents(eq("s-1"), eq("dev-1"), captor.capture(), eq(100), eq(600));
            return captor.getValue();
        }

        private static ActivityEvent ev(Integer seq, String kind) {
            return new ActivityEvent(seq, kind, "ref-" + seq, "parent", "Title " + seq, 1_762_500_000_000L);
        }

        @Test
        void ackIsTheLargestSeqReceivedIncludingDroppedEvents() {
            Integer ack = recorder.ingestSync(device, session,
                    List.of(ev(3, "LESSON"), ev(9, "NOT_A_KIND"), ev(5, "HOME"), ev(null, "DECK")));
            assertThat(ack).isEqualTo(9);
            assertThat(stored()).extracting(NewEvent::seq).containsExactly(3, 5);
        }

        @Test
        void nothingWithASeqMeansNoAck() {
            assertThat(recorder.ingestSync(device, session, List.of(ev(null, "LESSON"), ev(-1, "LESSON")))).isNull();
            verifyNoInteractions(repository);
        }

        @Test
        void onlyKindsDroppedStillAcks() {
            assertThat(recorder.ingestSync(device, session, List.of(ev(4, "lesson")))).isEqualTo(4);
            verifyNoInteractions(repository);
        }

        @Test
        void atMostTwentyAPerRequestButTheAckCoversAll() {
            List<ActivityEvent> events = IntStream.rangeClosed(1, 25).mapToObj(i -> ev(i, "DECK")).toList();
            assertThat(recorder.ingestSync(device, session, events)).isEqualTo(25);
            assertThat(stored()).hasSize(20).extracting(NewEvent::seq).startsWith(1).endsWith(20);
        }

        @Test
        void aRepeatedSeqInOneRequestIsStoredOnce() {
            recorder.ingestSync(device, session, List.of(ev(2, "DECK"), ev(2, "LESSON")));
            assertThat(stored()).singleElement().extracting(NewEvent::kind).isEqualTo("DECK");
        }

        @Test
        void anotherDevicesSessionIsIgnored() {
            SessionRow foreign = new SessionRow("s-2", "dev-2", "i1", "u1", "QR", "h", "ACTIVE", t, t, t, null, 0, 0,
                    null, null, t, null, null, null, t);
            assertThat(recorder.ingestSync(device, foreign, List.of(ev(1, "DECK")))).isNull();
            recorder.ingestEnd(device, foreign, List.of(ev(1, "DECK")));
            verifyNoInteractions(repository);
        }

        @Test
        void fieldsAreCleaned() {
            String longId = "x".repeat(65);
            String longTitle = "  " + "t".repeat(250);
            recorder.ingestSync(device, session, List.of(
                    new ActivityEvent(1, "LESSON", longId, "p\u0001", "Line\none\t", -5L),
                    new ActivityEvent(2, "DECK", "ok", null, longTitle, 9_000_000_000_000L),
                    new ActivityEvent(3, "CLASS", "", "p", "   ", 1_762_500_000_000L)));
            List<NewEvent> stored = stored();
            assertThat(stored.get(0).refId()).isNull();
            assertThat(stored.get(0).parentId()).isNull();
            assertThat(stored.get(0).title()).isEqualTo("Line one");
            assertThat(stored.get(0).atMs()).isNull();
            assertThat(stored.get(1).title()).hasSize(200);
            assertThat(stored.get(1).atMs()).isNull();
            assertThat(stored.get(2).refId()).isNull();
            assertThat(stored.get(2).title()).isNull();
            assertThat(stored.get(2).atMs()).isEqualTo(1_762_500_000_000L);
        }

        @Test
        void aStorageFailureKeepsThePanelsQueueAndDoesNotThrow() {
            doThrow(new QueryTimeoutException("slow")).when(repository).insertEvents(anyString(), anyString(), any(),
                    anyInt(), anyInt());
            assertThat(recorder.ingestSync(device, session, List.of(ev(1, "DECK")))).isNull();
            recorder.ingestEnd(device, session, List.of(ev(2, "DECK")));
        }

        @Test
        void requestLogsCarryCountsNotTitles() {
            List<ActivityEvent> events = List.of(new ActivityEvent(1, "LESSON", "r", "p", "Secret title", 1L));
            assertThat(events.get(0).toString()).doesNotContain("Secret title");
            assertThat(new SyncRequest("d", "s", "sid", "tok", 3, 66, false, null, false, events, "PLAY").toString())
                    .doesNotContain("Secret title").doesNotContain("tok");
            assertThat(new SessionEndRequest("d", "s", "tok", "IDLE", events).toString())
                    .doesNotContain("Secret title");
        }
    }
}
