package vacademy.io.admin_core_service.features.group_dashboard.service;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GroupDashboardServiceTest {

    @Test
    void windowCoversLastNDaysInUserZoneTodayIncluded() {
        // 2026-10-16 20:00 UTC = 2026-10-17 01:30 IST, so "today" is the 17th in India.
        GroupDashboardService.Window w = GroupDashboardService.window(7, "Asia/Kolkata",
                Instant.parse("2026-10-16T20:00:00Z"));
        assertEquals(LocalDate.of(2026, 10, 17), w.toDay());
        assertEquals(LocalDate.of(2026, 10, 11), w.fromDay());
        assertEquals(LocalDateTime.of(2026, 10, 10, 18, 30), w.from());
        assertEquals(LocalDateTime.of(2026, 10, 17, 18, 30), w.to());
        assertEquals(LocalDateTime.of(2026, 10, 3, 18, 30), w.prevFrom());
    }

    @Test
    void unknownRangeAndZoneFallBackToDefaults() {
        GroupDashboardService.Window w = GroupDashboardService.window(45, "Not/AZone",
                Instant.parse("2026-10-16T06:00:00Z"));
        assertEquals(30, w.days());
        assertEquals("Asia/Kolkata", w.tz().getId());
    }

    @Test
    void everyGroupHasSections() {
        assertEquals(3, GroupDashboardService.sectionsOf("contacts").size());
        assertEquals(3, GroupDashboardService.sectionsOf("automations").size());
        assertEquals(3, GroupDashboardService.sectionsOf("engagement").size());
    }

    @Test
    void rejectsUnknownGroup() {
        GroupDashboardService s = new GroupDashboardService(null, new org.springframework.transaction.support.AbstractPlatformTransactionManager() {
            @Override protected Object doGetTransaction() { return new Object(); }
            @Override protected void doBegin(Object t, org.springframework.transaction.TransactionDefinition d) { }
            @Override protected void doCommit(org.springframework.transaction.support.DefaultTransactionStatus st) { }
            @Override protected void doRollback(org.springframework.transaction.support.DefaultTransactionStatus st) { }
        });
        assertThrows(RuntimeException.class, () -> s.getDashboard("payroll", "inst", 30, null));
    }
}
