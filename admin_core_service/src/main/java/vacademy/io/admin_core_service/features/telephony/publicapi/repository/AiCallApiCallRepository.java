package vacademy.io.admin_core_service.features.telephony.publicapi.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * After the insert, nothing saves a whole {@link AiCallApiCall} again: the request thread,
 * a GET and the two scheduled passes each change their own columns with a targeted UPDATE,
 * so one can never write back a stale copy over another's change (a finaliser snapshot
 * taken before queue_item_id was set used to wipe it and mark a live call failed).
 */
public interface AiCallApiCallRepository extends JpaRepository<AiCallApiCall, String> {

    Optional<AiCallApiCall> findByIdAndInstituteId(String id, String instituteId);

    Optional<AiCallApiCall> findByInstituteIdAndIdempotencyKey(String instituteId, String idempotencyKey);

    /** The rows of a batch created with an Idempotency-Key (each row keyed "key#index"). */
    List<AiCallApiCall> findByInstituteIdAndIdempotencyKeyStartingWithOrderByCreatedAtAsc(
            String instituteId, String idempotencyKeyPrefix);

    Optional<AiCallApiCall> findFirstByCallLogId(String callLogId);

    List<AiCallApiCall> findByBatchIdAndInstituteIdOrderByCreatedAtAsc(String batchId, String instituteId);

    /** Newest first, keyset-paginated on (created_at, id). */
    @Query(value = """
            SELECT * FROM ai_call_api_call c
             WHERE c.institute_id = :instituteId
               AND (:batchId IS NULL OR c.batch_id = :batchId)
               AND (:externalId IS NULL OR c.external_id = :externalId)
               AND (CAST(:since AS timestamptz) IS NULL OR c.created_at >= CAST(:since AS timestamptz))
               AND (CAST(:beforeTs AS timestamptz) IS NULL
                    OR c.created_at < CAST(:beforeTs AS timestamptz)
                    OR (c.created_at = CAST(:beforeTs AS timestamptz) AND c.id < :beforeId))
             ORDER BY c.created_at DESC, c.id DESC
             LIMIT :lim
            """, nativeQuery = true)
    List<AiCallApiCall> page(@Param("instituteId") String instituteId,
                             @Param("batchId") String batchId,
                             @Param("externalId") String externalId,
                             @Param("since") Instant since,
                             @Param("beforeTs") Instant beforeTs,
                             @Param("beforeId") String beforeId,
                             @Param("lim") int limit);

    /**
     * Calls that may still change, least recently checked first. Ordering by the last check
     * (not by age) makes the scan round-robin: a backlog of one institute's waiting calls
     * gets looked at in turn with everyone else's instead of filling every pass.
     */
    @Query(value = """
            SELECT * FROM ai_call_api_call c
             WHERE c.finalized_at IS NULL AND c.created_at >= :since
             ORDER BY c.checked_at ASC NULLS FIRST, c.created_at ASC
             LIMIT :lim
            """, nativeQuery = true)
    List<AiCallApiCall> findOpen(@Param("since") Instant since, @Param("lim") int limit);

    /**
     * Finished calls whose webhook is due, at most {@code perInstitute} per institute, so a
     * client whose endpoint is down cannot fill the pass and delay everyone else.
     */
    @Query(value = """
            SELECT c.* FROM ai_call_api_call c
              JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY institute_id ORDER BY webhook_next_at) AS rn
                      FROM ai_call_api_call
                     WHERE webhook_status = 'PENDING' AND webhook_next_at <= :now) d ON d.id = c.id
             WHERE d.rn <= :perInstitute
             ORDER BY c.webhook_next_at ASC
             LIMIT :lim
            """, nativeQuery = true)
    List<AiCallApiCall> findWebhooksDue(@Param("now") Instant now, @Param("perInstitute") int perInstitute,
                                        @Param("lim") int limit);

    @Query(value = """
            SELECT COUNT(*) FROM ai_call_api_call
             WHERE institute_id = :instituteId AND test_mode AND created_at >= :since
            """, nativeQuery = true)
    long countTestCallsSince(@Param("instituteId") String instituteId, @Param("since") Instant since);

    // ── Targeted writes ──────────────────────────────────────────────────────────

    @Modifying
    @Transactional
    @Query(value = "UPDATE ai_call_api_call SET queue_item_id = :queueItemId, updated_at = now() WHERE id = :id",
            nativeQuery = true)
    int setQueueItemId(@Param("id") String id, @Param("queueItemId") String queueItemId);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ai_call_api_call SET call_log_id = :callLogId, updated_at = now()
             WHERE id = :id AND call_log_id IS NULL
            """, nativeQuery = true)
    int setCallLogIdIfNull(@Param("id") String id, @Param("callLogId") String callLogId);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ai_call_api_call SET terminal_seen_at = :at
             WHERE id = :id AND terminal_seen_at IS NULL
            """, nativeQuery = true)
    int setTerminalSeenAtIfNull(@Param("id") String id, @Param("at") Instant at);

    @Modifying
    @Transactional
    @Query(value = "UPDATE ai_call_api_call SET checked_at = now() WHERE id = :id", nativeQuery = true)
    int markChecked(@Param("id") String id);

    /** Finalise once: 0 rows when another pass (or pod) already did. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ai_call_api_call
               SET final_status = :status, final_event = :event, finalized_at = :at,
                   webhook_status = :webhookStatus, webhook_next_at = CAST(:webhookNextAt AS timestamptz),
                   updated_at = now()
             WHERE id = :id AND finalized_at IS NULL
            """, nativeQuery = true)
    int finalizeIfOpen(@Param("id") String id, @Param("status") String status, @Param("event") String event,
                       @Param("at") Instant at, @Param("webhookStatus") String webhookStatus,
                       @Param("webhookNextAt") Instant webhookNextAt);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ai_call_api_call
               SET webhook_status = :status, webhook_attempts = :attempts,
                   webhook_next_at = CAST(:nextAt AS timestamptz), webhook_last_code = :code,
                   webhook_last_error = :error, webhook_delivered_at = CAST(:deliveredAt AS timestamptz),
                   updated_at = now()
             WHERE id = :id
            """, nativeQuery = true)
    int recordDelivery(@Param("id") String id, @Param("status") String status, @Param("attempts") int attempts,
                       @Param("nextAt") Instant nextAt, @Param("code") Integer code, @Param("error") String error,
                       @Param("deliveredAt") Instant deliveredAt);

    /** Idempotency keys are honoured for 24 hours; after that the key may be used again. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ai_call_api_call SET idempotency_key = NULL
             WHERE idempotency_key IS NOT NULL AND created_at < :before
            """, nativeQuery = true)
    int clearIdempotencyKeysBefore(@Param("before") Instant before);
}
