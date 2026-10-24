package vacademy.io.admin_core_service.features.points_ledger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsSummaryDTO;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService.StreakState;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * One streak for every learner surface: consecutive institute-local days with activity,
 * a completed task or earned points. The four displays used to disagree (0, 1-day,
 * "start a streak") and one added +1 on top of a server count that already had today.
 */
class PointsLedgerStreakTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 25);

    private static Set<LocalDate> days(int... daysAgo) {
        java.util.Set<LocalDate> out = new java.util.HashSet<>();
        for (int d : daysAgo) out.add(TODAY.minusDays(d));
        return out;
    }

    @Test
    @DisplayName("No activity: 0 / 0, not kept, seven inactive days")
    void empty() {
        StreakState s = PointsLedgerService.computeStreak(Set.of(), TODAY);
        assertEquals(0, s.currentStreak());
        assertEquals(0, s.longestStreak());
        assertFalse(s.keptToday());
        assertEquals(7, s.last7Days().size());
        assertTrue(s.last7Days().stream().noneMatch(PointsSummaryDTO.StreakDay::isActive));
    }

    @Test
    @DisplayName("Active today and the two days before: 3, kept, no +1 on top")
    void keptToday() {
        StreakState s = PointsLedgerService.computeStreak(days(0, 1, 2), TODAY);
        assertEquals(3, s.currentStreak());
        assertTrue(s.keptToday());
        assertEquals(3, s.longestStreak());
    }

    @Test
    @DisplayName("Nothing yet today: the streak through yesterday still stands, at risk")
    void atRiskToday() {
        StreakState s = PointsLedgerService.computeStreak(days(1, 2, 3, 4), TODAY);
        assertEquals(4, s.currentStreak());
        assertFalse(s.keptToday());
    }

    @Test
    @DisplayName("A gap yesterday breaks the streak even with older activity")
    void brokenYesterday() {
        StreakState s = PointsLedgerService.computeStreak(days(2, 3, 4, 5, 6), TODAY);
        assertEquals(0, s.currentStreak());
        assertEquals(5, s.longestStreak());
        assertFalse(s.keptToday());
    }

    @Test
    @DisplayName("Longest run is found anywhere in the window and never below current")
    void longestAnywhere() {
        StreakState s = PointsLedgerService.computeStreak(days(0, 10, 11, 12, 13, 14, 15, 30), TODAY);
        assertEquals(1, s.currentStreak());
        assertEquals(6, s.longestStreak());
    }

    @Test
    @DisplayName("Future days (clock skew) are ignored")
    void futureIgnored() {
        StreakState s = PointsLedgerService.computeStreak(Set.of(TODAY.plusDays(1), TODAY), TODAY);
        assertEquals(1, s.currentStreak());
        assertEquals(1, s.longestStreak());
    }

    @Test
    @DisplayName("last7Days runs oldest first and ends on today")
    void lastSevenDays() {
        StreakState s = PointsLedgerService.computeStreak(days(0, 2, 6, 7), TODAY);
        List<PointsSummaryDTO.StreakDay> strip = s.last7Days();
        assertEquals("2026-09-19", strip.get(0).getDate());
        assertTrue(strip.get(0).isActive());
        assertFalse(strip.get(1).isActive());
        assertTrue(strip.get(4).isActive());
        assertEquals("2026-09-25", strip.get(6).getDate());
        assertTrue(strip.get(6).isActive());
    }

    private static PointsLedgerService serviceWith(Set<LocalDate> activeDays) {
        PointsLedgerRepository repo = mock(PointsLedgerRepository.class);
        when(repo.sumForUser("inst", "u")).thenReturn(620L);
        when(repo.sumForUserSince(any(), any(), any())).thenReturn(40L);
        when(repo.breakdownForUser("inst", "u")).thenReturn(List.<Object[]>of(new Object[] {"ENGAGEMENT_ITEM", 620L}));
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone("inst")).thenReturn(ZoneId.of("Asia/Kolkata"));
        return new PointsLedgerService(repo, tz) {
            @Override
            protected Set<LocalDate> loadActiveDays(String instituteId, String userId, ZoneId zone, LocalDate today) {
                if (activeDays == null) return null;
                Set<LocalDate> shifted = new java.util.HashSet<>();
                // Fixture days are relative to TODAY; re-anchor them on the real "today".
                for (LocalDate d : activeDays) shifted.add(today.minusDays(TODAY.toEpochDay() - d.toEpochDay()));
                return shifted;
            }
        };
    }

    @Test
    @DisplayName("getSummary keeps its original fields and adds the streak")
    void summaryCarriesStreak() throws Exception {
        PointsSummaryDTO dto = serviceWith(days(0, 1)).getSummary("inst", "u");
        assertEquals(620L, dto.getTotalPoints());
        assertEquals(40L, dto.getTodayPoints());
        assertEquals(2, dto.getLevel());
        assertEquals(380, dto.getPointsToNextLevel());
        assertEquals(1, dto.getBreakdown().size());
        assertEquals(2, dto.getCurrentStreak());
        assertTrue(dto.getKeptToday());
        assertEquals(7, dto.getLast7Days().size());
        assertEquals("Asia/Kolkata", dto.getTimezone());
        assertEquals(LocalDate.now(ZoneId.of("Asia/Kolkata")).toString(), dto.getToday());

        JsonNode json = new ObjectMapper().valueToTree(dto);
        assertEquals(2, json.get("currentStreak").asInt());
        assertTrue(json.get("keptToday").asBoolean());
        assertTrue(json.get("last7Days").get(6).get("active").asBoolean());
        assertTrue(json.get("last7Days").get(6).has("date"));
    }

    @Test
    @DisplayName("When no streak source can be read, the streak is null rather than a false 0")
    void unavailableStreakIsNull() {
        PointsSummaryDTO dto = serviceWith(null).getSummary("inst", "u");
        assertEquals(620L, dto.getTotalPoints());
        assertNull(dto.getCurrentStreak());
        assertNull(dto.getKeptToday());
        assertNull(dto.getLast7Days());
    }

    @Test
    @DisplayName("Inside a caller's transaction (engagement submit) the streak SQL is not run at all")
    void noStreakInsideCallerTransaction() {
        java.util.concurrent.atomic.AtomicInteger loads = new java.util.concurrent.atomic.AtomicInteger();
        PointsLedgerRepository repo = mock(PointsLedgerRepository.class);
        when(repo.sumForUser("inst", "u")).thenReturn(620L);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone("inst")).thenReturn(ZoneId.of("UTC"));
        PointsLedgerService service = new PointsLedgerService(repo, tz) {
            @Override
            protected Set<LocalDate> loadActiveDays(String instituteId, String userId, ZoneId zone, LocalDate today) {
                loads.incrementAndGet();
                return Set.of(today);
            }
        };
        org.springframework.transaction.support.TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            PointsSummaryDTO dto = service.getSummary("inst", "u");
            assertEquals(620L, dto.getTotalPoints());
            assertNull(dto.getCurrentStreak());
            assertEquals(0, loads.get());
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.setActualTransactionActive(false);
        }
        assertEquals(1, service.getSummary("inst", "u").getCurrentStreak());
        assertEquals(1, loads.get());
    }

    @Test
    @DisplayName("Without a database the default loader degrades to no streak, never an error")
    void noEntityManager() {
        PointsLedgerRepository repo = mock(PointsLedgerRepository.class);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone("inst")).thenReturn(ZoneId.of("UTC"));
        PointsSummaryDTO dto = new PointsLedgerService(repo, tz).getSummary("inst", "u");
        assertNull(dto.getCurrentStreak());
        assertEquals(1, dto.getLevel());
    }
}
