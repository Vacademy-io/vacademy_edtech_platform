package vacademy.io.admin_core_service.features.live_activity.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_activity.entity.UserLiveEvent;

import java.sql.Timestamp;
import java.util.List;

@Repository
public interface UserLiveEventRepository
        extends JpaRepository<UserLiveEvent, String>, JpaSpecificationExecutor<UserLiveEvent> {

    /**
     * The idempotent insert. Returns 1 when this call actually wrote the row and 0 when
     * another replica, a retried webhook or a provider sibling event got there first.
     *
     * <p>The caller publishes only on a non-zero return, which is what makes the whole
     * pipeline exactly-once without a distributed lock -- Postgres is the arbiter.
     */
    @Modifying
    @Query(value = """
            INSERT INTO user_live_event (
                id, institute_id, occurred_at, category, action, actor_type, dedupe_key,
                subject_name, subject_email, subject_mobile, subject_id, entity_id,
                counsellor_user_id, counsellor_name, payload
            ) VALUES (
                :id, :instituteId, :occurredAt, :category, :action, :actorType, :dedupeKey,
                :subjectName, :subjectEmail, :subjectMobile, :subjectId, :entityId,
                :counsellorUserId, :counsellorName, CAST(:payload AS jsonb)
            )
            ON CONFLICT (dedupe_key) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") String id,
                       @Param("instituteId") String instituteId,
                       @Param("occurredAt") Timestamp occurredAt,
                       @Param("category") String category,
                       @Param("action") String action,
                       @Param("actorType") String actorType,
                       @Param("dedupeKey") String dedupeKey,
                       @Param("subjectName") String subjectName,
                       @Param("subjectEmail") String subjectEmail,
                       @Param("subjectMobile") String subjectMobile,
                       @Param("subjectId") String subjectId,
                       @Param("entityId") String entityId,
                       @Param("counsellorUserId") String counsellorUserId,
                       @Param("counsellorName") String counsellorName,
                       @Param("payload") String payload);

    /**
     * The poller's tail query. Reading forward from a cursor is the whole cross-replica
     * mechanism: an event produced on another pod reaches this one's subscribers here.
     *
     * <p>Capped deliberately. A burst -- a bulk lead import, a call storm -- would otherwise
     * have every replica re-reading thousands of rows several times a second. With the cap
     * the cursor simply advances over several ticks, and anything a viewer misses in the
     * meantime is still served by the backfill query when they load or reconnect.
     */
    List<UserLiveEvent> findTop200ByOccurredAtGreaterThanOrderByOccurredAtAsc(Timestamp since);

    /**
     * Per-category chunked retention delete. Loops until it returns 0.
     */
    @Modifying
    @Query(value = """
            DELETE FROM user_live_event
             WHERE id IN (
                 SELECT id FROM user_live_event
                  WHERE category = :category
                    AND occurred_at < :cutoff
                  LIMIT :batchSize
             )
            """, nativeQuery = true)
    int deleteByCategoryOlderThan(@Param("category") String category,
                                  @Param("cutoff") Timestamp cutoff,
                                  @Param("batchSize") int batchSize);

    /**
     * Counter strip. One indexed pass on idx_ule_inst_cat_time -- deliberately not an
     * Institute-Pulse-style aggregate endpoint per rail.
     */
    @Query(value = """
            SELECT category, COUNT(*)
              FROM user_live_event
             WHERE institute_id = :instituteId
               AND occurred_at >= :since
             GROUP BY category
            """, nativeQuery = true)
    List<Object[]> countByCategorySince(@Param("instituteId") String instituteId,
                                        @Param("since") Timestamp since);

    /** Unseen badge -- how many events landed since this user last opened the feed. */
    @Query(value = """
            SELECT COUNT(*) FROM user_live_event
             WHERE institute_id = :instituteId
               AND occurred_at > :since
               AND category IN (:categories)
            """, nativeQuery = true)
    long countSince(@Param("instituteId") String instituteId,
                    @Param("since") Timestamp since,
                    @Param("categories") List<String> categories);
}
