package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAttempt;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

@Repository
public interface EngagementAttemptRepository extends JpaRepository<EngagementAttempt, String> {

    Optional<EngagementAttempt> findByItemIdAndUserId(String itemId, String userId);

    @Query("SELECT a FROM EngagementAttempt a WHERE a.userId = :userId AND a.itemId IN :itemIds")
    List<EngagementAttempt> findByUserAndItems(@Param("userId") String userId,
                                               @Param("itemIds") List<String> itemIds);

    /** All attempts on one item — used by the CSV export, which is not paged. */
    @Query("SELECT a FROM EngagementAttempt a WHERE a.itemId = :itemId ORDER BY a.createdAt DESC")
    List<EngagementAttempt> findByItem(@Param("itemId") String itemId);

    /** One page of attempts for the tracking table. */
    @Query("SELECT a FROM EngagementAttempt a WHERE a.itemId = :itemId ORDER BY a.createdAt DESC")
    Page<EngagementAttempt> findPageByItem(@Param("itemId") String itemId, Pageable pageable);

    /** Backs the "N people have attempted this" social-proof counter. */
    @Query("SELECT COUNT(a) FROM EngagementAttempt a WHERE a.itemId = :itemId AND a.status = 'COMPLETED'")
    long countCompletedForItem(@Param("itemId") String itemId);

    @Query("SELECT COUNT(a) FROM EngagementAttempt a WHERE a.itemId = :itemId " +
            "AND a.status = 'COMPLETED' AND a.isCorrect = true")
    long countCorrectForItem(@Param("itemId") String itemId);

    /** Rows: [itemId, completedCount] for a set of items, in one query. */
    @Query("SELECT a.itemId, COUNT(a) FROM EngagementAttempt a WHERE a.itemId IN :itemIds " +
            "AND a.status = 'COMPLETED' GROUP BY a.itemId")
    List<Object[]> countCompletedForItems(@Param("itemIds") List<String> itemIds);

    /** One page of attempts in one status (DONE = COMPLETED, STARTED), newest first. */
    @Query("SELECT a FROM EngagementAttempt a WHERE a.itemId = :itemId AND a.status = :status " +
            "ORDER BY a.createdAt DESC")
    Page<EngagementAttempt> findPageByItemAndStatus(@Param("itemId") String itemId,
                                                    @Param("status") String status,
                                                    Pageable pageable);

    /** One page of completions made under catch-up, newest first. */
    @Query("SELECT a FROM EngagementAttempt a WHERE a.itemId = :itemId AND a.status = 'COMPLETED' " +
            "AND a.isLate = true ORDER BY a.createdAt DESC")
    Page<EngagementAttempt> findPageLateByItem(@Param("itemId") String itemId, Pageable pageable);

    /**
     * Rows: [userId, status, isLate, isCorrect] for every attempt on one item. Scalars, not
     * entities: the tracking counters and the not-done list need only these four.
     */
    @Query("SELECT a.userId, a.status, a.isLate, a.isCorrect FROM EngagementAttempt a " +
            "WHERE a.itemId = :itemId")
    List<Object[]> findUserStatusesByItem(@Param("itemId") String itemId);

    /**
     * Rows: [optionId, count] of COMPLETED attempts on one item, grouped on the stored
     * selectedOptionId. One grouped query for the whole item, so a poll distribution
     * never depends on which page of learners is on screen.
     */
    @Query(value = "SELECT a.response_json ->> 'selectedOptionId' AS option_id, COUNT(*) AS picks " +
            "FROM engagement_attempt a " +
            "WHERE a.item_id = :itemId AND a.status = 'COMPLETED' " +
            "AND a.response_json ->> 'selectedOptionId' IS NOT NULL " +
            "GROUP BY a.response_json ->> 'selectedOptionId'", nativeQuery = true)
    List<Object[]> countByOption(@Param("itemId") String itemId);

    /**
     * Rows: [cardId, studied, gotIt] over the flashcards outcomes of every COMPLETED
     * attempt on one item, across versions. The CASE guards jsonb_array_elements from a
     * response that has no outcomes array (a legacy or non-flashcards row), which would
     * otherwise raise an error for the whole query.
     */
    @Query(value = "SELECT o.elem ->> 'cardId' AS card_id, COUNT(*) AS studied, " +
            "COUNT(*) FILTER (WHERE o.elem ->> 'result' = 'KNOWN') AS got_it " +
            "FROM engagement_attempt a " +
            "CROSS JOIN LATERAL jsonb_array_elements(" +
            "CASE WHEN jsonb_typeof(a.response_json -> 'flashcards' -> 'outcomes') = 'array' " +
            "THEN a.response_json -> 'flashcards' -> 'outcomes' " +
            "ELSE CAST('[]' AS jsonb) END) AS o(elem) " +
            "WHERE a.item_id = :itemId AND a.status = 'COMPLETED' " +
            "AND o.elem ->> 'cardId' IS NOT NULL " +
            "GROUP BY o.elem ->> 'cardId'", nativeQuery = true)
    List<Object[]> countFlashcardOutcomes(@Param("itemId") String itemId);

    /**
     * Rows: [itemId, userId, status, isLate, isCorrect, pointsAwarded, completedAt] for
     * every attempt on a set of items: the plan overview's single aggregate read (callers
     * chunk the id list). Scalars rather than entities keep a 500-learner plan light.
     */
    @Query("SELECT a.itemId, a.userId, a.status, a.isLate, a.isCorrect, a.pointsAwarded, a.completedAt " +
            "FROM EngagementAttempt a WHERE a.itemId IN :itemIds")
    List<Object[]> findProgressRowsForItems(@Param("itemIds") List<String> itemIds);

    /** Completed attempts for a learner in an instant range — streak and history. */
    @Query("SELECT a FROM EngagementAttempt a WHERE a.userId = :userId AND a.instituteId = :instituteId " +
            "AND a.status = 'COMPLETED' AND a.completedAt >= :from AND a.completedAt < :to " +
            "ORDER BY a.completedAt DESC")
    List<EngagementAttempt> findCompletedBetween(@Param("userId") String userId,
                                                 @Param("instituteId") String instituteId,
                                                 @Param("from") Timestamp from,
                                                 @Param("to") Timestamp to);

    /**
     * Record that a learner opened an item, once. The server's own clock then measures
     * dwell and play time — the client's timeSpentMs is advisory and easy to forge.
     *
     * ON CONFLICT DO NOTHING because this runs inside the item read: a second open
     * (or a race with submit) must not fail the request or reset startedAt.
     */
    @Modifying
    @Query(value = "INSERT INTO engagement_attempt (id, item_id, item_version, user_id, institute_id, " +
            "package_session_id, status, started_at, created_at, updated_at) " +
            "VALUES (:id, :itemId, :itemVersion, :userId, :instituteId, :packageSessionId, 'STARTED', " +
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) " +
            "ON CONFLICT (item_id, user_id) DO NOTHING", nativeQuery = true)
    int insertStartedIfAbsent(@Param("id") String id,
                              @Param("itemId") String itemId,
                              @Param("itemVersion") int itemVersion,
                              @Param("userId") String userId,
                              @Param("instituteId") String instituteId,
                              @Param("packageSessionId") String packageSessionId);
}
