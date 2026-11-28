package vacademy.io.admin_core_service.features.classroom;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionVisibilityScope;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchRequest;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepositoryCustomImpl;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.RETURNS_SELF;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Checks the SQL the search actually sends. It is glued at runtime, so mocked service tests
 * would pass over a broken string, and the legacy branches must not move for existing callers.
 */
class LiveSessionSearchSqlTest {

    private static final String TODAY =
            "ss.meeting_date = CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)";
    private static final String STARTED =
            "CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) >= ss.start_time";
    private static final String NOT_ENDED =
            "CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS time) <= ss.last_entry_time";
    private static final String FROM_TODAY =
            "ss.meeting_date >= CAST((CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Kolkata')) AS date)";

    private static final Pattern GLUED = Pattern.compile(
            "(?i)(\\)|\\b(SELECT|FROM|WHERE|JOIN|AND|OR|ON|IN|EXISTS|NOT))(SELECT|FROM|WHERE|JOIN|AND|OR|ON|EXISTS|NOT|ORDER)\\b");

    private final List<String> sql = new ArrayList<>();
    private final Set<String> boundNames = new HashSet<>();
    private EntityManager em;
    private Query query;
    private LiveSessionRepositoryCustomImpl repository;

    @BeforeEach
    void setUp() {
        em = mock(EntityManager.class);
        query = mock(Query.class, RETURNS_SELF);
        when(em.createNativeQuery(anyString())).thenReturn(query);
        when(em.createNativeQuery(anyString(), anyString())).thenReturn(query);
        when(query.getSingleResult()).thenReturn(0L);
        when(query.getResultList()).thenReturn(List.of());
        repository = new LiveSessionRepositoryCustomImpl();
        ReflectionTestUtils.setField(repository, "entityManager", em);
    }

    private static SessionSearchRequest base() {
        SessionSearchRequest request = new SessionSearchRequest();
        request.setInstituteId("inst-a");
        return request;
    }

    /** Returns the WHERE clause, after checking the count and the data query agree on it. */
    private String run(SessionSearchRequest request, LiveSessionVisibilityScope scope) {
        repository.searchSessions(request, PageRequest.of(0, 50), scope);
        ArgumentCaptor<String> count = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> data = ArgumentCaptor.forClass(String.class);
        verify(em).createNativeQuery(count.capture());
        verify(em).createNativeQuery(data.capture(), anyString());
        ArgumentCaptor<String> names = ArgumentCaptor.forClass(String.class);
        verify(query, atLeast(2)).setParameter(names.capture(), any());
        boundNames.addAll(names.getAllValues());
        sql.add(count.getValue());
        sql.add(data.getValue());

        String countWhere = count.getValue().substring(count.getValue().indexOf(" WHERE "));
        String dataWhere = data.getValue().substring(data.getValue().indexOf(" WHERE "));
        dataWhere = dataWhere.substring(0, dataWhere.indexOf(" ORDER BY "));
        assertEquals(countWhere, dataWhere);
        return countWhere;
    }

    private String run(SessionSearchRequest request) {
        return run(request, null);
    }

    // ---- existing callers ----

    @Test
    void liveOnlyWithNoDatesStillMeansLiveRightNow() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        assertEquals(" WHERE s.institute_id = :instituteId"
                + " AND ss.status != 'DELETED'"
                + " AND s.status IN :statuses"
                + " AND " + TODAY
                + " AND " + STARTED
                + " AND " + NOT_ENDED,
                run(request));
        assertEquals(Set.of("instituteId", "statuses"), boundNames);
    }

    @Test
    void noStatusesWithNoDatesIsStillTheNextMonth() {
        assertEquals(" WHERE s.institute_id = :instituteId"
                + " AND ss.status != 'DELETED'"
                + " AND s.status IN ('LIVE', 'DRAFT')"
                + " AND " + FROM_TODAY
                + " AND ss.meeting_date <= :endDate",
                run(base()));
        assertEquals(Set.of("instituteId", "endDate"), boundNames);
    }

    @Test
    void explicitDatesAreStillUsedAsGiven() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        request.setStartDate(LocalDate.of(2026, 11, 1));
        request.setEndDate(LocalDate.of(2026, 11, 30));
        assertEquals(" WHERE s.institute_id = :instituteId"
                + " AND ss.status != 'DELETED'"
                + " AND s.status IN :statuses"
                + " AND ss.meeting_date >= :startDate"
                + " AND ss.meeting_date <= :endDate",
                run(request));
    }

    // ---- today ----

    @Test
    void todayIsTheWholeDayNotLiveRightNow() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        request.setTodayInSessionTimezone(Boolean.TRUE);
        assertEquals(" WHERE s.institute_id = :instituteId"
                + " AND ss.status != 'DELETED'"
                + " AND s.status IN :statuses"
                + " AND " + TODAY,
                run(request));
        assertEquals(Set.of("instituteId", "statuses"), boundNames);
    }

    @Test
    void todayWinsOverAnyDates() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        request.setStartDate(LocalDate.of(2026, 1, 1));
        request.setEndDate(LocalDate.of(2026, 1, 2));
        request.setTodayInSessionTimezone(Boolean.TRUE);
        String where = run(request);
        assertTrue(where.endsWith(" AND " + TODAY), where);
        assertFalse(boundNames.contains("startDate"));
        assertFalse(boundNames.contains("endDate"));
    }

    @Test
    void falseFlagBehavesAsAbsent() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        request.setTodayInSessionTimezone(Boolean.FALSE);
        String where = run(request);
        assertTrue(where.contains(STARTED), where);
        assertTrue(where.contains(NOT_ENDED), where);
    }

    // ---- instructor filter ----

    @Test
    void instructorFilterUsesTheEffectiveInstructorRule() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        request.setTodayInSessionTimezone(Boolean.TRUE);
        request.setInstructorUserIds(List.of("teacher-1"));
        String where = run(request).replaceAll("\\s+", " ");
        assertTrue(where.contains("( EXISTS ( SELECT 1 FROM live_session_instructors i"
                + " WHERE i.session_id = s.id AND i.status = 'ACTIVE' AND i.user_id IN :instructorUserIds )"
                + " OR ( s.created_by_user_id IN :instructorUserIds"
                + " AND NOT EXISTS ( SELECT 1 FROM live_session_instructors i2"
                + " WHERE i2.session_id = s.id AND i2.status = 'ACTIVE' ) ) )"), where);
        assertTrue(boundNames.contains("instructorUserIds"));
        verify(query, atLeast(2)).setParameter("instructorUserIds", List.of("teacher-1"));
    }

    @Test
    void noInstructorFilterByDefault() {
        String where = run(base());
        assertFalse(where.contains("live_session_instructors"), where);
        assertFalse(boundNames.contains("instructorUserIds"));
    }

    @Test
    void anEmptyInstructorListMatchesNobodyAndBindsNothing() {
        SessionSearchRequest request = base();
        request.setInstructorUserIds(List.of());
        String where = run(request);
        assertTrue(where.contains(" AND 1 = 0"), where);
        assertFalse(boundNames.contains("instructorUserIds"));
    }

    @Test
    void visibilityScopeStillApplies() {
        SessionSearchRequest request = base();
        request.setTodayInSessionTimezone(Boolean.TRUE);
        request.setInstructorUserIds(List.of("teacher-1"));
        String where = run(request, new LiveSessionVisibilityScope(true, "teacher-1", Set.of("teacher-1")));
        assertTrue(where.contains(":visibilityCallerId"), where);
        assertTrue(where.contains(":visibilityAllowedUserIds"), where);
        assertTrue(where.contains(":instructorUserIds"), where);
    }

    // ---- gluing ----

    @Test
    void wordsStayApartAndOnlyRealBindsCarryAColon() {
        SessionSearchRequest request = base();
        request.setStatuses(List.of("LIVE"));
        request.setTodayInSessionTimezone(Boolean.TRUE);
        request.setInstructorUserIds(List.of("teacher-1"));
        request.setSortBy("startTime");
        run(request, new LiveSessionVisibilityScope(true, "teacher-1", Set.of("teacher-1")));
        assertEquals(2, sql.size());
        for (String statement : sql) {
            assertFalse(GLUED.matcher(statement).find(), () -> "glued keywords in: " + statement);
            String unbound = statement.replaceAll(
                    ":(instituteId|statuses|instructorUserIds|visibilityCallerId|visibilityAllowedUserIds)\\b", "");
            assertFalse(unbound.contains(":"), () -> "unexpected ':' in: " + statement);
        }
        assertTrue(sql.get(1).endsWith(" ORDER BY ss.start_time ASC"), sql.get(1));
    }
}
