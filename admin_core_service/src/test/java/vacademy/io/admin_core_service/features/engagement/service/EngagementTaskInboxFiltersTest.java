package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import vacademy.io.admin_core_service.features.engagement.controller.EngagementTaskController;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService.ActionOutcome;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.Query;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.TaskRow;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryService.TaskFilter;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The inbox as the daily report's drill-down (GET /tasks with filters, GET /tasks/outcomes): no
 * filter keeps the old query, filters are validated, and an outcome filter pages what matched.
 */
class EngagementTaskInboxFiltersTest {

    private static final String INST = "inst-1";

    private EngagementActionRepository actions;
    private EngagementEngineRepository engines;
    private EngagementTaskQueryDao dao;
    private EngagementActionOutcomeService outcomes;
    private EngagementTaskQueryService service;

    @BeforeEach
    void setUp() {
        actions = mock(EngagementActionRepository.class);
        engines = mock(EngagementEngineRepository.class);
        dao = mock(EngagementTaskQueryDao.class);
        outcomes = mock(EngagementActionOutcomeService.class);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getTimezoneId(INST)).thenReturn("Asia/Kolkata");
        service = new EngagementTaskQueryService(actions, engines, dao, outcomes, tz);
        when(engines.findByInstituteIdOrderByCreatedAtDesc(INST))
                .thenReturn(List.of(engine("e1", INST), engine("e2", INST)));
        // findAllById returns rows in no particular order: reversed here, so the order must be restored.
        when(actions.findAllById(any())).thenAnswer(inv -> {
            List<EngagementAction> out = new ArrayList<>();
            for (Object id : (Iterable<?>) inv.getArgument(0)) out.add(0, action(id.toString(), INST));
            return out;
        });
    }

    private static EngagementEngine engine(String id, String institute) {
        EngagementEngine e = new EngagementEngine();
        e.setId(id);
        e.setInstituteId(institute);
        e.setStatus("ACTIVE");
        return e;
    }

    private static EngagementAction action(String id, String institute) {
        EngagementAction a = new EngagementAction();
        a.setId(id);
        a.setInstituteId(institute);
        a.setKind("SEND");
        a.setChannel("EMAIL");
        a.setStatus("SENT");
        return a;
    }

    private static TaskFilter filter(String engineId, String channel, String kind, String date, String template,
                                     String outcome) {
        return new TaskFilter(engineId, channel, kind, date, null, null, template, outcome);
    }

    private static TaskFilter period(String from, String to, String date, String outcome) {
        return new TaskFilter(null, null, null, date, from, to, null, outcome);
    }

    private static LocalDate daysAgo(int n) {
        return LocalDate.now(ZoneId.of("Asia/Kolkata")).minusDays(n);
    }

    private static List<String> ids(Page<EngagementAction> page) {
        return page.getContent().stream().map(EngagementAction::getId).toList();
    }

    @Nested
    class Controller {

        private final EngagementAccessGuard guard = mock(EngagementAccessGuard.class);
        private final EngagementTaskQueryService query = mock(EngagementTaskQueryService.class);
        private final CustomUserDetails user = mock(CustomUserDetails.class);
        private EngagementTaskController controller;

        @BeforeEach
        void build() {
            controller = new EngagementTaskController(actions, guard, mock(EngagementDispatcher.class),
                    mock(EngagementMemberRepository.class), mock(ContactResolver.class), query);
        }

        @Test
        @DisplayName("no filter: exactly the old findInbox call")
        void noFilterKeepsTheOldQuery() {
            Page<EngagementAction> old = new PageImpl<>(List.of());
            when(actions.findInbox(eq(INST), eq(List.of("OPEN", "ACKED")), any(Pageable.class))).thenReturn(old);

            Page<EngagementAction> out = controller.inbox(INST, "OPEN,ACKED", 0, 500,
                    null, " ", "", null, null, " ", null, null, user).getBody();

            assertSame(old, out);
            verify(actions).findInbox(INST, List.of("OPEN", "ACKED"), PageRequest.of(0, 200));
            verifyNoInteractions(query);
        }

        @Test
        @DisplayName("a filter goes to the query service, size still capped at 200")
        void aFilterUsesTheQueryService() {
            controller.inbox(INST, "SENT", 1, 999, "e1", null, null, null, null, null, null, null, user);

            verify(query).inbox(INST, List.of("SENT"), filter("e1", null, null, null, null, null), 1, 200);
            verify(actions, never()).findInbox(anyString(), anyList(), any(Pageable.class));
        }

        @Test
        @DisplayName("from + to alone are a filter too")
        void aPeriodAloneUsesTheQueryService() {
            controller.inbox(INST, "SENT", 0, 50, null, null, null, null, "2026-10-27", "2026-10-29", null, null,
                    user);

            verify(query).inbox(INST, List.of("SENT"),
                    new TaskFilter(null, null, null, null, "2026-10-27", "2026-10-29", null, null), 0, 50);
            verify(actions, never()).findInbox(anyString(), anyList(), any(Pageable.class));
        }

        @Test
        @DisplayName("outcomes: a refused admin check is 403")
        void outcomesRefusalIs403() {
            doThrow(new VacademyException("no")).when(guard).requireAdmin(user, INST);

            assertThrows(ForbiddenException.class, () -> controller.outcomes(INST, "a", user));
            verifyNoInteractions(query);
        }
    }

    @Nested
    class Validation {

        @Test
        void outcomeNeedsADate() {
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    filter(null, null, null, null, null, "delivered"), 0, 50));
        }

        @Test
        void aPeriodFollowsTheReportsRules() {
            String today = daysAgo(0).toString();
            // only one of from / to; from after to; a day in the future; a day before today - 89
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    period(daysAgo(3).toString(), null, null, "delivered"), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    period(null, today, null, null), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    period(today, daysAgo(2).toString(), null, null), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    period(today, daysAgo(-1).toString(), null, null), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    period(daysAgo(90).toString(), today, null, null), 0, 50));
            verifyNoInteractions(dao);
        }

        @Test
        void unknownChannelKindOutcomeOrDateAre400() {
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    filter(null, "SMS", null, null, null, null), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    filter(null, null, "WAIT", null, null, null), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    filter(null, null, null, "2026-10-30", null, "opened_twice"), 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.inbox(INST, List.of("SENT"),
                    filter(null, null, null, "30/10/2026", null, null), 0, 50));
        }

        @Test
        void anotherInstitutesEngineIs404() {
            when(engines.findById("x")).thenReturn(java.util.Optional.of(engine("x", "other")));

            assertThrows(ResourceNotFoundException.class, () -> service.inbox(INST, List.of("SENT"),
                    filter("x", null, null, null, null, null), 0, 50));
        }
    }

    @Nested
    class Filters {

        @Test
        void filtersBecomeTheQueryAndTheDayIsTheInstitutesDay() {
            when(dao.pageIds(any(), anyInt(), anyLong())).thenReturn(List.of("a1", "a2", "a3"));
            when(dao.count(any())).thenReturn(103L);

            Page<EngagementAction> page = service.inbox(INST, List.of(" SENT", "FAILED", ""),
                    filter(null, "email", "crm", "2026-10-28", " Welcome ", null), 2, 50);

            ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
            verify(dao).pageIds(q.capture(), eq(50), eq(100L));
            Query query = q.getValue();
            assertEquals(List.of("SENT", "FAILED"), query.statuses());
            assertEquals(List.of("e1", "e2"), query.engineIds());
            assertEquals(List.of("EMAIL"), query.channels());
            assertEquals("CRM", query.kind());
            assertEquals("Welcome", query.template());
            // 2026-10-28 in Asia/Kolkata is [27th 18:30, 28th 18:30) UTC.
            assertEquals(LocalDateTime.of(2026, 10, 27, 18, 30), query.from());
            assertEquals(LocalDateTime.of(2026, 10, 28, 18, 30), query.to());
            assertEquals(List.of("a1", "a2", "a3"), ids(page));
            assertEquals(103, page.getTotalElements());
        }

        @Test
        void aPeriodWinsOverDateAndSpansWholeInstituteDays() {
            when(dao.pageIds(any(), anyInt(), anyLong())).thenReturn(List.of());

            service.inbox(INST, List.of("SENT"), period(daysAgo(29).toString(), daysAgo(1).toString(),
                    "2026-01-01", null), 0, 50);

            ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
            verify(dao).pageIds(q.capture(), eq(50), eq(0L));
            // IST: [first 00:00, last + 1 00:00) is [first - 1 18:30, last 18:30) UTC.
            assertEquals(daysAgo(30).atTime(18, 30), q.getValue().from());
            assertEquals(daysAgo(1).atTime(18, 30), q.getValue().to());
            assertEquals(daysAgo(30).atTime(18, 30).minusDays(15), q.getValue().scanFrom());
        }

        @Test
        void aLoneDateKeepsTheInboxsOwnRuleAnyDay() {
            when(dao.pageIds(any(), anyInt(), anyLong())).thenReturn(List.of());

            service.inbox(INST, List.of("SENT"), filter(null, null, null, "2025-01-01", null, null), 0, 50);

            ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
            verify(dao).pageIds(q.capture(), eq(50), eq(0L));
            assertEquals(LocalDateTime.of(2024, 12, 31, 18, 30), q.getValue().from());
        }

        @Test
        void anOutcomeWithAPeriodReadsItsRows() {
            when(dao.rows(any(), eq(5000))).thenReturn(List.of());

            Page<EngagementAction> page = service.inbox(INST, List.of("SENT"),
                    period(daysAgo(6).toString(), daysAgo(0).toString(), null, "bounced"), 0, 50);

            ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
            verify(dao).rows(q.capture(), eq(5000));
            assertEquals(daysAgo(7).atTime(18, 30), q.getValue().from());
            assertEquals(daysAgo(0).atTime(18, 30), q.getValue().to());
            assertEquals(0, page.getTotalElements());
        }

        @Test
        void anOutcomeOnAChannelItCannotOccurOnIsEmpty() {
            Page<EngagementAction> page = service.inbox(INST, List.of("SENT"),
                    filter(null, "WHATSAPP", null, "2026-10-28", null, "opened"), 0, 50);

            assertEquals(0, page.getTotalElements());
            verifyNoInteractions(dao, outcomes);
        }

        @Test
        void anOutcomeReadsTheDaysRowsFiltersThenPages() {
            List<TaskRow> rows = IntStream.range(0, 7)
                    .mapToObj(i -> new TaskRow("r" + i, "e1", "m" + i, "SEND", null, "EMAIL", "SENT"))
                    .toList();
            when(dao.rows(any(), eq(5000))).thenReturn(rows);
            when(engines.findById("e1")).thenReturn(java.util.Optional.of(engine("e1", INST)));
            // r0, r2, r4, r6 were opened.
            Map<String, ActionOutcome> out = rows.stream().collect(Collectors.toMap(TaskRow::id, r -> {
                boolean opened = Integer.parseInt(r.id().substring(1)) % 2 == 0;
                return new ActionOutcome(r.id(), "EMAIL", true, "SENT", true, opened, false, false, false,
                        null, null, null, null);
            }));
            when(outcomes.outcomes(eq(INST), eq(rows))).thenReturn(out);

            Page<EngagementAction> page = service.inbox(INST, List.of("SENT"),
                    filter("e1", null, null, "2026-10-28", null, "OPENED"), 1, 3);

            ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
            verify(dao).rows(q.capture(), eq(5000));
            assertEquals(List.of("EMAIL"), q.getValue().channels());   // narrowed to where an open can happen
            assertEquals(List.of("e1"), q.getValue().engineIds());
            assertEquals(4, page.getTotalElements());
            assertEquals(List.of("r6"), ids(page));                    // page 1 of 3: the 4th match
            verify(dao, never()).count(any());
        }
    }

    @Nested
    class Outcomes {

        @Test
        void onlyThisInstitutesActionsInTheOrderAsked() {
            doReturn(List.of(action("b", INST), action("a", INST), action("z", "other")))
                    .when(actions).findAllById(any());
            when(outcomes.outcomes(eq(INST), anyList())).thenAnswer(inv -> {
                List<TaskRow> rows = inv.getArgument(1);
                return rows.stream().collect(Collectors.toMap(TaskRow::id, r -> new ActionOutcome(r.id(),
                        r.channel(), false, null, false, false, false, false, false, null, null, null, null)));
            });

            List<ActionOutcome> out = service.outcomes(INST, " a,z,b,a ,,");

            assertEquals(List.of("a", "b"), out.stream().map(ActionOutcome::actionId).toList());
        }

        @Test
        void moreThan200IdsIs400() {
            String csv = IntStream.range(0, 201).mapToObj(i -> "id" + i).collect(Collectors.joining(","));

            assertThrows(InvalidRequestException.class, () -> service.outcomes(INST, csv));
            verifyNoInteractions(outcomes);
        }

        @Test
        void noIdsNoLookup() {
            assertTrue(service.outcomes(INST, " , ").isEmpty());
            verify(actions, never()).findAllById(any(Collection.class));
        }
    }

    @Nested
    class Sql {

        private Query query(String kind, List<String> channels, boolean dated) {
            LocalDateTime t = LocalDateTime.of(2026, 10, 28, 0, 0);
            return new Query(INST, List.of("SENT"), List.of("e1"), channels, kind,
                    dated ? t : null, dated ? t.plusDays(1) : null, dated ? t.minusDays(15) : null, null);
        }

        @Test
        void withoutAKindTheInboxRuleStaysAndWaitingIsLeftOut() {
            String where = EngagementTaskQueryDao.where(query(null, null, false));

            assertTrue(where.contains(EngagementTaskQueryDao.DEFAULT_KINDS));
            assertFalse(where.contains("NO_OP"));
            assertTrue(EngagementTaskQueryDao.orderBy(query(null, null, false)).contains("priority DESC"));
        }

        @Test
        void crmIsATaskWithACrmActionAndNoOpOnlyWhenAsked() {
            assertEquals("a.kind = 'TASK' AND a.action_type IN (:crmTypes)", EngagementTaskQueryDao.kindClause("CRM"));
            assertEquals("a.kind = :kind", EngagementTaskQueryDao.kindClause("NO_OP"));
        }

        @Test
        void aDayFiltersOnWhenItWentOutNewestFirst() {
            String where = EngagementTaskQueryDao.where(query("SEND", null, true));

            assertTrue(where.contains("COALESCE(a.dispatched_at, a.created_at) >= :from"));
            assertTrue(where.contains("a.created_at >= :scanFrom"));
            assertTrue(EngagementTaskQueryDao.orderBy(query("SEND", null, true))
                    .contains("COALESCE(a.dispatched_at, a.created_at) DESC"));
        }

        @Test
        void aiCallIncludesScheduledCallTasksAndOtherChannelsLeaveThemOut() {
            assertEquals(EngagementTaskQueryDao.CALL_ROW, EngagementTaskQueryDao.channelClause(List.of("AI_CALL")));
            String email = EngagementTaskQueryDao.channelClause(List.of("EMAIL"));
            assertTrue(email.contains("<> 'SCHEDULE_AI_CALL'"));
            String both = EngagementTaskQueryDao.channelClause(List.of("AI_CALL", "EMAIL"));
            assertTrue(both.contains(EngagementTaskQueryDao.CALL_ROW) && both.contains("a.channel IN (:channels)"));
            assertNull(query(null, null, false).channels());
        }
    }
}
