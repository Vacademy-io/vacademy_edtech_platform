package vacademy.io.admin_core_service.features.live_activity.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_activity.entity.UserLiveEvent;

import java.sql.Timestamp;
import java.util.List;

/**
 * Grouped reads behind the dashboard.
 *
 * <p>Separate from {@code UserLiveEventRepository} so the hot write/tail path stays a small
 * interface and these aggregates can grow without cluttering it.
 *
 * <p>Every query is scoped by institute and a time range, so each one rides
 * {@code idx_ule_inst_time} or {@code idx_ule_inst_cat_time}. None of them touch another
 * service.
 *
 * <p><b>No semicolons anywhere in these comments or queries.</b> Hibernate splices its
 * generated fetch clause in at the first {@code ;} it finds -- even inside a comment -- which
 * produces column-index errors that look nothing like their cause.
 */
@Repository
public interface LiveActivityAnalyticsRepository extends JpaRepository<UserLiveEvent, String> {

    /** Counts per action. Feeds both the KPI tiles and the funnel stages. */
    @Query(value = """
            SELECT action, COUNT(*)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND occurred_at >= :from
               AND occurred_at < :to
             GROUP BY action
            """, nativeQuery = true)
    List<Object[]> countByAction(@Param("instituteId") String instituteId,
                                 @Param("from") Timestamp from,
                                 @Param("to") Timestamp to);

    /**
     * Revenue. The amount lives in the JSONB payload rather than a column because the feed
     * stores whatever each producer had in hand, so it is cast here rather than summed as a
     * typed column.
     *
     * <p><b>CAST(... AS numeric) rather than the Postgres {@code ::} shorthand.</b> Written
     * with {@code ::numeric} this query reached the driver as
     * {@code (payload->>'amount'):numeric} -- one colon eaten -- and Postgres rejected it
     * with a syntax error at the colon. JPA reserves a leading colon for named parameters,
     * and something in that interaction consumed it.
     *
     * <p>Other native queries in this service do use {@code ::} successfully, so the trigger
     * is narrower than "Hibernate always mangles it" and is not worth pinning down here. The
     * standard-SQL form has no colon to lose, which makes the question moot. Prefer it in
     * native queries -- this failure compiles, passes review, and only appears at runtime.
     *
     * <p>Also guarded with {@code jsonb_typeof(...) = 'number'} rather than a NOT NULL check.
     * Postgres has no TRY_CAST, so one row holding a non-numeric amount would fail the cast
     * and take the whole dashboard down with it. Asking the document what type it holds is
     * the only check that cannot throw.
     */
    @Query(value = """
            SELECT COALESCE(SUM(CAST(payload->>'amount' AS numeric)), 0)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND category = 'PAYMENT'
               AND action = 'PAYMENT_SUCCEEDED'
               AND occurred_at >= :from
               AND occurred_at < :to
               AND jsonb_typeof(payload->'amount') = 'number'
            """, nativeQuery = true)
    Double sumRevenue(@Param("instituteId") String instituteId,
                      @Param("from") Timestamp from,
                      @Param("to") Timestamp to);

    /** Most common currency in the window, so the revenue tile can label itself honestly. */
    @Query(value = """
            SELECT payload->>'currency'
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND category = 'PAYMENT'
               AND payload->>'currency' IS NOT NULL
               AND occurred_at >= :from
               AND occurred_at < :to
             GROUP BY payload->>'currency'
             ORDER BY COUNT(*) DESC
             LIMIT 1
            """, nativeQuery = true)
    String dominantCurrency(@Param("instituteId") String instituteId,
                            @Param("from") Timestamp from,
                            @Param("to") Timestamp to);

    /**
     * Prospects who filled the invite form and have not enrolled.
     *
     * <p>Joined to the live ABANDONED_CART status rather than inferred from the absence of a
     * later payment event. That status is written by the same enrolment path and flipped to
     * DELETED the moment the learner enrols, so this figure clears itself with no sweep job
     * and no guesswork about how long to wait before calling someone abandoned.
     */
    @Query(value = """
            SELECT COUNT(DISTINCT e.subject_id)
              FROM user_live_event e
             WHERE e.institute_id = :instituteId
               AND e.category = 'INVITE_FORM'
               AND e.subject_id IS NOT NULL
               AND e.occurred_at >= :from
               AND e.occurred_at < :to
               AND EXISTS (
                   SELECT 1
                     FROM student_session_institute_group_mapping m
                    WHERE m.user_id = e.subject_id
                      AND m.status = 'ABANDONED_CART'
               )
            """, nativeQuery = true)
    long countNeedsAttention(@Param("instituteId") String instituteId,
                             @Param("from") Timestamp from,
                             @Param("to") Timestamp to);

    /** Hourly activity. One row per hour that actually had events -- gaps filled in Java. */
    @Query(value = """
            SELECT date_trunc('hour', occurred_at) AS bucket, COUNT(*)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND occurred_at >= :from
               AND occurred_at < :to
             GROUP BY bucket
             ORDER BY bucket ASC
            """, nativeQuery = true)
    List<Object[]> countByHour(@Param("instituteId") String instituteId,
                               @Param("from") Timestamp from,
                               @Param("to") Timestamp to);

    /** Where leads came from. */
    @Query(value = """
            SELECT COALESCE(payload->>'sourceType', 'Unknown') AS source, COUNT(*)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND category = 'LEAD_FORM'
               AND occurred_at >= :from
               AND occurred_at < :to
             GROUP BY source
             ORDER BY COUNT(*) DESC
             LIMIT 10
            """, nativeQuery = true)
    List<Object[]> countLeadSources(@Param("instituteId") String instituteId,
                                    @Param("from") Timestamp from,
                                    @Param("to") Timestamp to);

    /**
     * Busiest counsellors. Falls back to the id when no name was captured, rather than
     * dropping the row -- an unnamed counsellor is still activity that happened.
     */
    @Query(value = """
            SELECT COALESCE(counsellor_name, counsellor_user_id) AS who, COUNT(*)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND counsellor_user_id IS NOT NULL
               AND occurred_at >= :from
               AND occurred_at < :to
             GROUP BY who
             ORDER BY COUNT(*) DESC
             LIMIT 10
            """, nativeQuery = true)
    List<Object[]> countByCounsellor(@Param("instituteId") String instituteId,
                                     @Param("from") Timestamp from,
                                     @Param("to") Timestamp to);

    /** Call dispositions, so the outcome mix is visible rather than just the volume. */
    @Query(value = """
            SELECT COALESCE(payload->>'dispositionLabel', payload->>'dispositionKey') AS outcome,
                   COUNT(*)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND action = 'NOTE_ADDED'
               AND occurred_at >= :from
               AND occurred_at < :to
               AND (payload->>'dispositionLabel' IS NOT NULL
                    OR payload->>'dispositionKey' IS NOT NULL)
             GROUP BY outcome
             ORDER BY COUNT(*) DESC
             LIMIT 8
            """, nativeQuery = true)
    List<Object[]> countCallOutcomes(@Param("instituteId") String instituteId,
                                     @Param("from") Timestamp from,
                                     @Param("to") Timestamp to);
}
