package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;

import java.util.List;

@Repository
public interface EngagementPlanRepository extends JpaRepository<EngagementPlan, String> {

    @Query("SELECT p FROM EngagementPlan p WHERE p.packageSessionId = :packageSessionId " +
            "AND p.status <> 'DELETED' ORDER BY p.createdAt DESC")
    List<EngagementPlan> findByPackageSession(@Param("packageSessionId") String packageSessionId);

    @Query("SELECT p FROM EngagementPlan p WHERE p.instituteId = :instituteId " +
            "AND p.status <> 'DELETED' ORDER BY p.createdAt DESC")
    List<EngagementPlan> findByInstitute(@Param("instituteId") String instituteId);

    /** Every published plan — the notify tick's starting point. */
    @Query("SELECT p FROM EngagementPlan p WHERE p.status = 'PUBLISHED'")
    List<EngagementPlan> findAllPublished();

    /**
     * Published plans for the batches a learner is enrolled in — the feed entry point.
     *
     * Scoped by institute as well as by batch. Without the institute predicate a plan
     * created under institute A against a batch belonging to institute B was served to
     * B's learners, payload and all — while getItem/submit correctly refused it, so the
     * card could be read but never opened.
     */
    @Query("SELECT p FROM EngagementPlan p WHERE p.packageSessionId IN :packageSessionIds " +
            "AND p.instituteId = :instituteId AND p.status = 'PUBLISHED'")
    List<EngagementPlan> findPublishedForPackageSessions(
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("instituteId") String instituteId);

    // ── plan list summary ────────────────────────────────────────────────────
    // The list card needs dates, task counts, the batch name and the batch size for
    // every plan. Each query below takes the WHOLE page of plans (or their slots /
    // batches) at once, so a list costs a fixed handful of queries however many plans
    // it shows — never one per plan.

    /** Active slots of many plans in one query. */
    @Query("SELECT s FROM EngagementSlot s WHERE s.planId IN :planIds AND s.status = 'ACTIVE' " +
            "ORDER BY s.startDate, s.startTime, s.sortOrder")
    List<EngagementSlot> findActiveSlotsForPlans(@Param("planIds") List<String> planIds);

    /** [slotId, activeItemCount] for many slots; slots with no items are absent. */
    @Query("SELECT i.slotId, COUNT(i) FROM EngagementItem i WHERE i.slotId IN :slotIds " +
            "AND i.status = 'ACTIVE' GROUP BY i.slotId")
    List<Object[]> countActiveItemsBySlots(@Param("slotIds") List<String> slotIds);

    /**
     * [packageSessionId, name, packageName, sessionName, levelName] for many batches,
     * used to build a human batch label.
     */
    @Query(value = "SELECT ps.id, ps.name, p.package_name, s.session_name, l.level_name " +
            "FROM package_session ps " +
            "LEFT JOIN package p ON p.id = ps.package_id " +
            "LEFT JOIN session s ON s.id = ps.session_id " +
            "LEFT JOIN level l ON l.id = ps.level_id " +
            "WHERE ps.id IN (:packageSessionIds)", nativeQuery = true)
    List<Object[]> findPackageSessionLabelParts(@Param("packageSessionIds") List<String> packageSessionIds);

    /**
     * [packageSessionId, activeLearners] for many batches. Same population as
     * findDistinctUserIdsByPackageSessionAndStatus(ps, ["ACTIVE"]), which the tracking
     * overview uses, so the list and the overview agree on the denominator.
     */
    @Query(value = "SELECT package_session_id, COUNT(DISTINCT user_id) " +
            "FROM student_session_institute_group_mapping " +
            "WHERE package_session_id IN (:packageSessionIds) AND status = 'ACTIVE' " +
            "AND user_id IS NOT NULL GROUP BY package_session_id", nativeQuery = true)
    List<Object[]> countActiveLearnersByPackageSessions(
            @Param("packageSessionIds") List<String> packageSessionIds);

    /**
     * [planId, learnersWithAnyAttempt, learnersWithACompletion] over the active items
     * of the given slots (the slots running today). Attempts are one row per item and
     * learner (not per occurrence), so on a recurring slot an earlier day's completion
     * counts too.
     */
    @Query(value = "SELECT s.plan_id, COUNT(DISTINCT a.user_id), " +
            "COUNT(DISTINCT CASE WHEN a.status = 'COMPLETED' THEN a.user_id END) " +
            "FROM engagement_attempt a " +
            "JOIN engagement_item i ON i.id = a.item_id " +
            "JOIN engagement_slot s ON s.id = i.slot_id " +
            "WHERE i.slot_id IN (:slotIds) AND i.status = 'ACTIVE' " +
            "GROUP BY s.plan_id", nativeQuery = true)
    List<Object[]> countLearnersBySlotsGroupedByPlan(@Param("slotIds") List<String> slotIds);

    /**
     * When an enrollment started, as an instant a plan's zone turns into the right local day.
     * enrolled_date is a bare date (the server's UTC date at enrollment): read as midnight
     * UTC it lands on the previous evening west of UTC, so Day 1 came a day early in the
     * Americas. When the row was created on that same date, created_at is the real moment;
     * otherwise the date was set on purpose and noon UTC keeps it on that calendar day in
     * every zone from UTC-12 to UTC+11.
     */
    String JOINED_AT = "MIN(CASE WHEN m.enrolled_date IS NULL OR m.enrolled_date = CAST(m.created_at AS date) " +
            "THEN m.created_at ELSE CAST(m.enrolled_date AS timestamp) + INTERVAL '12 hours' END)";

    /**
     * A learner's join date per batch (enrollment date, else when the enrollment row was
     * created), for RELATIVE plans. Rows: [packageSessionId, Timestamp joinedAt].
     */
    @Query(value = "SELECT m.package_session_id, " + JOINED_AT + " " +
            "FROM student_session_institute_group_mapping m " +
            "WHERE m.user_id = :userId AND m.package_session_id IN (:packageSessionIds) " +
            "AND m.status = 'ACTIVE' GROUP BY m.package_session_id", nativeQuery = true)
    List<Object[]> findJoinDatesForUser(@Param("userId") String userId,
                                        @Param("packageSessionIds") List<String> packageSessionIds);

    /** Every active learner's join date in one batch. Rows: [userId, Timestamp joinedAt]. */
    @Query(value = "SELECT m.user_id, " + JOINED_AT + " " +
            "FROM student_session_institute_group_mapping m " +
            "WHERE m.package_session_id = :packageSessionId AND m.status = 'ACTIVE' " +
            "AND m.user_id IS NOT NULL GROUP BY m.user_id", nativeQuery = true)
    List<Object[]> findJoinDatesForBatch(@Param("packageSessionId") String packageSessionId);

    @Query("SELECT p FROM EngagementPlan p WHERE p.status = 'PUBLISHED' AND p.scheduleMode = 'RELATIVE'")
    List<EngagementPlan> findAllPublishedRelative();

    /**
     * Non-zero when the batch's course is linked to the institute. A plan's roster, tracking
     * and pushes all key off the batch alone, so a plan must never be created on a batch
     * of another institute.
     */
    @Query(value = "SELECT COUNT(*) FROM package_session ps " +
            "JOIN package_institute pi ON pi.package_id = ps.package_id " +
            "WHERE ps.id = :packageSessionId AND pi.institute_id = :instituteId", nativeQuery = true)
    long countBatchInInstitute(@Param("packageSessionId") String packageSessionId,
                               @Param("instituteId") String instituteId);
}
