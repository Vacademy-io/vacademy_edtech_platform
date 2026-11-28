package vacademy.io.admin_core_service.features.telephony.publicapi.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Same rule as {@link AiCallApiCallRepository}: after the insert nothing saves a whole
 * {@code HumanCallApiCall} again. The request thread, a GET and the scheduled passes each
 * change their own columns with a targeted UPDATE, so none can write a stale copy back
 * over another's change.
 */
public interface HumanCallApiCallRepository extends JpaRepository<HumanCallApiCall, String> {

    Optional<HumanCallApiCall> findByIdAndInstituteId(String id, String instituteId);

    Optional<HumanCallApiCall> findByInstituteIdAndIdempotencyKey(String instituteId, String idempotencyKey);

    /**
     * The public status of a row, in SQL — the same rule as HumanCallViews.state(): no call
     * log yet → queued within the creating grace, else failed; a terminal call-log status
     * maps directly; a running one past its stuck limit (Airtel's is longer) → failed;
     * otherwise the live mapping, defaulting to queued. telephony_call_log.created_at is
     * naive UTC, so its cut-offs come in as naive timestamps. HumanCallViewsTest checks
     * these WHEN branches against HumanCallViews.LIVE_STATUS / TERMINAL_STATUS.
     */
    String PUBLIC_STATUS_SQL = """
            CASE
              WHEN l.id IS NULL THEN CASE WHEN h.created_at >= CAST(:creatingSince AS timestamptz)
                                          THEN 'queued' ELSE 'failed' END
              WHEN l.status = 'COMPLETED' THEN 'completed'
              WHEN l.status = 'NO_ANSWER' THEN 'no_answer'
              WHEN l.status = 'BUSY' THEN 'busy'
              WHEN l.status = 'FAILED' THEN 'failed'
              WHEN l.status = 'CANCELLED' THEN 'canceled'
              WHEN l.created_at < CASE WHEN l.provider_type = 'AIRTEL' THEN CAST(:airtelStuckBefore AS timestamp)
                                       ELSE CAST(:stuckBefore AS timestamp) END THEN 'failed'
              WHEN l.status = 'COUNSELLOR_RINGING' THEN 'ringing_counsellor'
              WHEN l.status = 'COUNSELLOR_ANSWERED' THEN 'connecting'
              WHEN l.status = 'IN_PROGRESS' THEN 'in_progress'
              ELSE 'queued'
            END""";

    /**
     * Newest first, keyset-paginated on (created_at, id). {@code status} filters on the
     * public status the object reports ({@link #PUBLIC_STATUS_SQL}).
     */
    @Query(value = """
            SELECT h.* FROM human_call_api_call h
              LEFT JOIN telephony_call_log l ON l.id = h.call_log_id
             WHERE h.institute_id = :instituteId
               AND (CAST(:counsellorId AS text) IS NULL OR h.counsellor_user_id = CAST(:counsellorId AS text))
               AND (CAST(:phone AS text) IS NULL OR h.phone_number = CAST(:phone AS text))
               AND (CAST(:externalId AS text) IS NULL OR h.external_id = CAST(:externalId AS text))
               AND (CAST(:after AS timestamptz) IS NULL OR h.created_at >= CAST(:after AS timestamptz))
               AND (CAST(:before AS timestamptz) IS NULL OR h.created_at < CAST(:before AS timestamptz))
               AND (CAST(:status AS text) IS NULL OR (""" + PUBLIC_STATUS_SQL + """
            ) = CAST(:status AS text))
               AND (CAST(:beforeTs AS timestamptz) IS NULL
                    OR h.created_at < CAST(:beforeTs AS timestamptz)
                    OR (h.created_at = CAST(:beforeTs AS timestamptz) AND h.id < :beforeId))
             ORDER BY h.created_at DESC, h.id DESC
             LIMIT :lim
            """, nativeQuery = true)
    List<HumanCallApiCall> page(@Param("instituteId") String instituteId,
                                @Param("counsellorId") String counsellorId,
                                @Param("phone") String phone,
                                @Param("externalId") String externalId,
                                @Param("after") Instant createdAfter,
                                @Param("before") Instant createdBefore,
                                @Param("status") String status,
                                @Param("creatingSince") Instant creatingSince,
                                @Param("stuckBefore") java.sql.Timestamp stuckBefore,
                                @Param("airtelStuckBefore") java.sql.Timestamp airtelStuckBefore,
                                @Param("beforeTs") Instant beforeTs,
                                @Param("beforeId") String beforeId,
                                @Param("lim") int limit);

    /**
     * Calls (or their requested analysis) that may still change, least recently checked
     * first, so one institute's backlog cannot fill every pass.
     */
    @Query(value = """
            SELECT * FROM human_call_api_call h
             WHERE (h.finalized_at IS NULL OR (h.analysis_requested AND h.analysis_finalized_at IS NULL))
               AND h.created_at >= :since
             ORDER BY h.checked_at ASC NULLS FIRST, h.created_at ASC
             LIMIT :lim
            """, nativeQuery = true)
    List<HumanCallApiCall> findOpen(@Param("since") Instant since, @Param("lim") int limit);

    /** Call events due, at most {@code perInstitute} per institute (as for AI calls). */
    @Query(value = """
            SELECT c.* FROM human_call_api_call c
              JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY institute_id ORDER BY webhook_next_at) AS rn
                      FROM human_call_api_call
                     WHERE webhook_status = 'PENDING' AND webhook_next_at <= :now) d ON d.id = c.id
             WHERE d.rn <= :perInstitute
             ORDER BY c.webhook_next_at ASC
             LIMIT :lim
            """, nativeQuery = true)
    List<HumanCallApiCall> findWebhooksDue(@Param("now") Instant now, @Param("perInstitute") int perInstitute,
                                           @Param("lim") int limit);

    /** analysis_ready events due, with the same per-institute bound. */
    @Query(value = """
            SELECT c.* FROM human_call_api_call c
              JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY institute_id ORDER BY analysis_webhook_next_at) AS rn
                      FROM human_call_api_call
                     WHERE analysis_webhook_status = 'PENDING' AND analysis_webhook_next_at <= :now) d ON d.id = c.id
             WHERE d.rn <= :perInstitute
             ORDER BY c.analysis_webhook_next_at ASC
             LIMIT :lim
            """, nativeQuery = true)
    List<HumanCallApiCall> findAnalysisWebhooksDue(@Param("now") Instant now, @Param("perInstitute") int perInstitute,
                                                   @Param("lim") int limit);

    /**
     * A transaction-scoped Postgres advisory lock on {@code key}: blocks until no other
     * transaction holds it, released at commit or rollback (works through PgBouncer's
     * transaction pooling, unlike a session lock). Must run inside a transaction.
     */
    @Query(value = "SELECT 1 FROM pg_advisory_xact_lock(hashtext(:key))", nativeQuery = true)
    Integer advisoryXactLock(@Param("key") String key);

    // ── Targeted writes ──────────────────────────────────────────────────────────

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call
               SET call_log_id = :callLogId, provider_type = :providerType, response_id = :responseId,
                   updated_at = now()
             WHERE id = :id AND call_log_id IS NULL
            """, nativeQuery = true)
    int setDialed(@Param("id") String id, @Param("callLogId") String callLogId,
                  @Param("providerType") String providerType, @Param("responseId") String responseId);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call SET terminal_seen_at = :at
             WHERE id = :id AND terminal_seen_at IS NULL
            """, nativeQuery = true)
    int setTerminalSeenAtIfNull(@Param("id") String id, @Param("at") Instant at);

    @Modifying
    @Transactional
    @Query(value = "UPDATE human_call_api_call SET checked_at = now() WHERE id = :id", nativeQuery = true)
    int markChecked(@Param("id") String id);

    /** Finalise the call once: 0 rows when another pass (or pod) already did. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call
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
            UPDATE human_call_api_call SET analysis_triggered_at = :at, updated_at = now()
             WHERE id = :id AND analysis_triggered_at IS NULL
            """, nativeQuery = true)
    int markAnalysisTriggered(@Param("id") String id, @Param("at") Instant at);

    /** Close the analysis outbox once (webhookStatus NONE: nothing to send). */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call
               SET analysis_finalized_at = :at, analysis_webhook_status = :webhookStatus,
                   analysis_webhook_next_at = CAST(:webhookNextAt AS timestamptz), updated_at = now()
             WHERE id = :id AND analysis_finalized_at IS NULL
            """, nativeQuery = true)
    int finalizeAnalysisIfOpen(@Param("id") String id, @Param("at") Instant at,
                               @Param("webhookStatus") String webhookStatus,
                               @Param("webhookNextAt") Instant webhookNextAt);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call
               SET webhook_status = :status, webhook_attempts = :attempts,
                   webhook_next_at = CAST(:nextAt AS timestamptz), webhook_last_code = :code,
                   webhook_last_error = :error, webhook_delivered_at = CAST(:deliveredAt AS timestamptz),
                   updated_at = now()
             WHERE id = :id
            """, nativeQuery = true)
    int recordDelivery(@Param("id") String id, @Param("status") String status, @Param("attempts") int attempts,
                       @Param("nextAt") Instant nextAt, @Param("code") Integer code, @Param("error") String error,
                       @Param("deliveredAt") Instant deliveredAt);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call
               SET analysis_webhook_status = :status, analysis_webhook_attempts = :attempts,
                   analysis_webhook_next_at = CAST(:nextAt AS timestamptz), analysis_webhook_last_code = :code,
                   analysis_webhook_last_error = :error,
                   analysis_webhook_delivered_at = CAST(:deliveredAt AS timestamptz), updated_at = now()
             WHERE id = :id
            """, nativeQuery = true)
    int recordAnalysisDelivery(@Param("id") String id, @Param("status") String status,
                               @Param("attempts") int attempts, @Param("nextAt") Instant nextAt,
                               @Param("code") Integer code, @Param("error") String error,
                               @Param("deliveredAt") Instant deliveredAt);

    /** Idempotency keys are honoured for 24 hours; after that the key may be used again. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE human_call_api_call SET idempotency_key = NULL
             WHERE idempotency_key IS NOT NULL AND created_at < :before
            """, nativeQuery = true)
    int clearIdempotencyKeysBefore(@Param("before") Instant before);
}
