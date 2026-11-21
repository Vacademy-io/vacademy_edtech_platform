package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

@Repository
public interface EngagementSlotRepository extends JpaRepository<EngagementSlot, String> {

    @Query("SELECT s FROM EngagementSlot s WHERE s.planId = :planId AND s.status = 'ACTIVE' " +
            "ORDER BY s.startDate, s.startTime, s.sortOrder")
    List<EngagementSlot> findActiveByPlan(@Param("planId") String planId);

    /**
     * Slots of the given plans whose date range covers {@code date}. Day-of-week masking
     * and time-of-day state are resolved in EngagementScheduleResolver, not in SQL —
     * the mask is a bitmask and the times need the plan's timezone.
     */
    @Query("SELECT s FROM EngagementSlot s WHERE s.planId IN :planIds AND s.status = 'ACTIVE' " +
            "AND s.startDate <= :date AND (s.endDate IS NULL OR s.endDate >= :date) " +
            "ORDER BY s.startTime, s.sortOrder")
    List<EngagementSlot> findRunningOn(@Param("planIds") List<String> planIds,
                                       @Param("date") LocalDate date);

    /** Slots covering any date in a range — backs the upcoming strip and the calendar. */
    @Query("SELECT s FROM EngagementSlot s WHERE s.planId IN :planIds AND s.status = 'ACTIVE' " +
            "AND s.startDate <= :to AND (s.endDate IS NULL OR s.endDate >= :from) " +
            "ORDER BY s.startDate, s.startTime, s.sortOrder")
    List<EngagementSlot> findInRange(@Param("planIds") List<String> planIds,
                                     @Param("from") LocalDate from,
                                     @Param("to") LocalDate to);

    /**
     * Slots whose reveal falls inside a window on a date. reveal_time NULL means
     * "reveal at end_time", so both columns are consulted.
     */
    @Query("SELECT s FROM EngagementSlot s WHERE s.status = 'ACTIVE' " +
            "AND s.startDate <= :date AND (s.endDate IS NULL OR s.endDate >= :date) " +
            "AND COALESCE(s.revealTime, s.endTime) >= :fromTime " +
            "AND COALESCE(s.revealTime, s.endTime) < :toTime")
    List<EngagementSlot> findDueForReveal(@Param("date") LocalDate date,
                                          @Param("fromTime") LocalTime fromTime,
                                          @Param("toTime") LocalTime toTime);

    /** Slots whose notify_time falls inside a window on a date — the push job's query. */
    @Query("SELECT s FROM EngagementSlot s WHERE s.status = 'ACTIVE' AND s.notifyTime IS NOT NULL " +
            "AND s.startDate <= :date AND (s.endDate IS NULL OR s.endDate >= :date) " +
            "AND s.notifyTime >= :fromTime AND s.notifyTime < :toTime")
    List<EngagementSlot> findDueForNotification(@Param("date") LocalDate date,
                                                @Param("fromTime") LocalTime fromTime,
                                                @Param("toTime") LocalTime toTime);
}
