package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;

import java.util.List;
import java.util.Optional;

@Repository
public interface TelephonyCallLogRepository extends JpaRepository<TelephonyCallLog, String> {

    Optional<TelephonyCallLog> findByProviderTypeAndProviderCallId(
            String providerType, String providerCallId);

    /** Targeted single-column write for the IVR selection during a live call — avoids a
     *  full-entity merge that could clobber a concurrent status webhook on the same row. */
    @Modifying
    @Transactional
    @Query("UPDATE TelephonyCallLog t SET t.ivrSelection = :selection WHERE t.id = :id")
    void updateIvrSelection(@Param("id") String id, @Param("selection") String selection);

    /** Stamp a successful voice-minutes charge — guarded so it never un-stamps. */
    @Modifying
    @Transactional
    @Query("UPDATE TelephonyCallLog t SET t.creditsBilledAt = :at WHERE t.id = :id AND t.creditsBilledAt IS NULL")
    int markCreditsBilled(@Param("id") String id, @Param("at") java.time.Instant at);

    /**
     * Dispositioned calls for a batch of lead users — the CSV export's lead
     * journey merges these in, because a counsellor's quick disposition only
     * lives on the call row (CallDispositionService writes no timeline event).
     */
    List<TelephonyCallLog> findByUserIdInAndDispositionKeyIsNotNull(List<String> userIds);

    /**
     * Dedup guard for AI dispatch: has an AI call for this (institute, user, provider)
     * been placed within the last {@code since} window? Aavtaar doesn't echo our
     * correlation id, so a duplicated dispatch (workflow entered twice / bulk + node)
     * becomes two real dials — one connects, the other gets BUSY — and two call-log
     * rows. {@code AiCallService.placeCall} calls this under a per-lead lock to collapse
     * the duplicate. {@code created_at} is DB-stamped at insert, so the first row is
     * visible to the second caller once its insert commits.
     */
    @Query("""
            SELECT (COUNT(t) > 0) FROM TelephonyCallLog t
            WHERE t.instituteId = :instituteId AND t.userId = :userId
              AND t.providerType = :providerType AND t.createdAt >= :since
            """)
    boolean existsRecentByInstituteUserProvider(@Param("instituteId") String instituteId,
                                                @Param("userId") String userId,
                                                @Param("providerType") String providerType,
                                                @Param("since") java.sql.Timestamp since);

    /**
     * Bulk-campaign cooldown guard: every lead in this institute that already had an AI
     * call placed since {@code since}. The caller intersects this against its own lead
     * list in memory — deliberately institute-wide rather than an {@code IN (:userIds)}
     * over the audience, because the window is minutes (so this returns a handful of
     * rows) while a big audience would bind thousands of parameters.
     *
     * <p>Complements {@link #existsRecentByInstituteUserProvider}, which collapses
     * near-simultaneous duplicates over a ~30s window; this one covers the far longer
     * "don't re-dial the list you just dialled" campaign window.
     */
    @Query("""
            SELECT DISTINCT t.userId FROM TelephonyCallLog t
            WHERE t.instituteId = :instituteId
              AND t.createdAt >= :since
              AND t.providerType IN :aiProviders
            """)
    List<String> findAiCalledUserIdsSince(@Param("instituteId") String instituteId,
                                          @Param("since") java.sql.Timestamp since,
                                          @Param("aiProviders") List<String> aiProviders);

    /**
     * Prior VACADEMY_AI dial attempts to the same lead in a recent window,
     * excluding the current call. Feeds the bot's {@code callRetry} (the
     * classifier's exhaustion counter — Aavtaar sends its own, our bot can't
     * know it). Window-bounded so an old exhausted sequence doesn't poison a
     * fresh campaign months later.
     */
    @Query("""
            SELECT COUNT(t) FROM TelephonyCallLog t
            WHERE t.instituteId = :instituteId AND t.userId = :userId
              AND t.providerType = :providerType AND t.direction = 'OUTBOUND'
              AND t.createdAt >= :since AND t.id <> :excludeId
            """)
    long countRecentOutboundAttempts(@Param("instituteId") String instituteId,
                                     @Param("userId") String userId,
                                     @Param("providerType") String providerType,
                                     @Param("since") java.sql.Timestamp since,
                                     @Param("excludeId") String excludeId);

    /**
     * Outbound dials to ONE lead in a rolling window.
     *
     * <p>Backs the per-lead daily cap. The bulk campaign's own cooldown only looks back
     * a few minutes, which was enough when a run finished in minutes; a queued run
     * spans hours, so re-firing it mid-flight re-enqueued every lead that had already
     * been called and dialled them a second time. Unlike
     * {@link #countRecentOutboundAttempts} this excludes nothing — it is a ceiling, not
     * an attempt counter.
     */
    @Query("""
            SELECT COUNT(t) FROM TelephonyCallLog t
            WHERE t.instituteId = :instituteId AND t.userId = :userId
              AND t.providerType = :providerType AND t.direction = 'OUTBOUND'
              AND t.createdAt >= :since
            """)
    long countOutboundToLeadSince(@Param("instituteId") String instituteId,
                                  @Param("userId") String userId,
                                  @Param("providerType") String providerType,
                                  @Param("since") java.sql.Timestamp since);

    /**
     * All outbound dials this institute placed on a provider since {@code since}
     * (rolling-window daily-cap guardrail — see {@code AiCallingSettingsPojo.maxCallsPerDay}).
     * Provider-scoped so an institute's Exotel/Airtel human calls never count
     * against its AI-call budget.
     */
    @Query("""
            SELECT COUNT(t) FROM TelephonyCallLog t
            WHERE t.instituteId = :instituteId AND t.providerType = :providerType
              AND t.direction = 'OUTBOUND' AND t.createdAt >= :since
            """)
    long countOutboundSince(@Param("instituteId") String instituteId,
                            @Param("providerType") String providerType,
                            @Param("since") java.sql.Timestamp since);

    /**
     * Link an AI-voice end-of-call report to the call we placed, for providers that
     * neither echo our correlationId nor return a provider call id at placement
     * (Aavtaar): the most-recent OUTBOUND call to this phone in this institute.
     * Last-10-digit match tolerates country-code/format variance (same approach as
     * {@link #findRecentOutboundAttributionByLeadPhone}).
     */
    @Query(value = """
            SELECT * FROM telephony_call_log t
            WHERE t.institute_id = :instituteId
              AND t.direction = 'OUTBOUND'
              AND t.provider_type = :providerType
              AND RIGHT(regexp_replace(t.to_number, '[^0-9]', '', 'g'), 10)
                = RIGHT(regexp_replace(:phone, '[^0-9]', '', 'g'), 10)
              AND NOT EXISTS (SELECT 1 FROM ai_call_result r WHERE r.call_log_id = t.id)
            ORDER BY t.created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<TelephonyCallLog> findMostRecentOutboundByPhone(
            @Param("instituteId") String instituteId,
            @Param("providerType") String providerType,
            @Param("phone") String phone);

    /**
     * Same as {@link #findMostRecentOutboundByPhone} but binds to the OUTBOUND call
     * whose {@code created_at} is CLOSEST to the report's dial time ({@code anchor}).
     * A late end-of-call webhook (it can arrive after the next retry dial) must bind
     * to the attempt it actually describes, not whichever dial is most recent.
     */
    @Query(value = """
            SELECT * FROM telephony_call_log t
            WHERE t.institute_id = :instituteId
              AND t.direction = 'OUTBOUND'
              AND t.provider_type = :providerType
              AND RIGHT(regexp_replace(t.to_number, '[^0-9]', '', 'g'), 10)
                = RIGHT(regexp_replace(:phone, '[^0-9]', '', 'g'), 10)
              AND NOT EXISTS (SELECT 1 FROM ai_call_result r WHERE r.call_log_id = t.id)
            ORDER BY ABS(EXTRACT(EPOCH FROM (t.created_at - :anchor)))
            LIMIT 1
            """, nativeQuery = true)
    Optional<TelephonyCallLog> findOutboundByPhoneNearest(
            @Param("instituteId") String instituteId,
            @Param("providerType") String providerType,
            @Param("phone") String phone,
            @Param("anchor") java.sql.Timestamp anchor);

    /**
     * Most-recent provider_number_id this lead saw — powers STICKY_PER_LEAD via
     * idx_tcl_sticky. Returns one row max.
     */
    @Query(value = """
            SELECT provider_number_id FROM telephony_call_log
            WHERE user_id = :userId AND provider_number_id IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    Optional<String> findMostRecentNumberIdForLead(@Param("userId") String userId);

    Page<TelephonyCallLog> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    Page<TelephonyCallLog> findByUserIdAndInstituteIdOrderByCreatedAtDesc(
            String userId, String instituteId, Pageable pageable);

    /**
     * Real AI-call attempt rank per call log for a lead (1 = first dial, 2 = first
     * retry, …) — our own re-dial sequence. The provider-reported {@code call_retry}
     * resets to 0 on every fresh click-to-call, so it can't be used. Returns rows of
     * {@code [id, attempt]}.
     */
    @Query(value = "SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS attempt " +
            "FROM telephony_call_log " +
            "WHERE user_id = :userId AND institute_id = :instituteId " +
            "AND direction = 'OUTBOUND' AND provider_type = 'AAVTAAR'",
            nativeQuery = true)
    java.util.List<Object[]> aiCallAttemptRanks(@Param("userId") String userId,
                                                @Param("instituteId") String instituteId);

    /**
     * All calls placed/received by one counsellor in an institute — powers the
     * manager's "Calls" coaching tab in the counsellor workbench drawer.
     * Served by idx_tcl_counsellor (counsellor_user_id, created_at DESC).
     */
    Page<TelephonyCallLog> findByCounsellorUserIdAndInstituteIdOrderByCreatedAtDesc(
            String counsellorUserId, String instituteId, Pageable pageable);

    Page<TelephonyCallLog> findByResponseIdOrderByCreatedAtDesc(String responseId, Pageable pageable);

    /**
     * "Last counsellor" routing for inbound lead callbacks: the most recent
     * OUTBOUND call to this lead's phone whose counsellor_user_id was set.
     * Suffix-matches on the last 10 digits to tolerate country-code variance
     * between what Exotel sends on inbound ({@code CallFrom}) and what we
     * stored on the outbound row ({@code to_number}). Returns the counsellor
     * and lead user id together so the caller can attribute the call without
     * a second lookup.
     *
     * <p>AI-placed rows are excluded. counsellor_user_id on those is the person who
     * <i>started</i> the AI campaign, not someone who ever spoke to the lead, so
     * counting them would ring the campaign starter for every lead on a bulk list —
     * overriding the human the lead actually talked to, which is the whole point of
     * this strategy. "Last counsellor" here means last HUMAN conversation.
     */
    @Query(value = """
            SELECT counsellor_user_id, user_id, response_id
            FROM telephony_call_log
            WHERE institute_id = :instituteId
              AND direction = 'OUTBOUND'
              AND counsellor_user_id IS NOT NULL
              AND provider_type NOT IN ('AAVTAAR', 'VACADEMY_AI', 'MOCK')
              AND RIGHT(regexp_replace(to_number, '[^0-9]', '', 'g'), 10)
                = RIGHT(regexp_replace(:leadPhone, '[^0-9]', '', 'g'), 10)
            ORDER BY created_at DESC
            LIMIT 1
            """, nativeQuery = true)
    List<Object[]> findRecentOutboundAttributionByLeadPhone(
            @Param("instituteId") String instituteId,
            @Param("leadPhone") String leadPhone);

    /**
     * Airtel promoter — find OUR click2dial row to enrich with the CDR: an AIRTEL
     * OUTBOUND row for this counsellor + lead (last-10 match) that hasn't been
     * tied to a provider call id yet, placed at/after the CDR's start window.
     */
    @Query(value = """
            SELECT * FROM telephony_call_log
            WHERE provider_type = 'AIRTEL' AND direction = 'OUTBOUND'
              AND counsellor_user_id = :counsellor
              AND provider_call_id IS NULL
              AND RIGHT(regexp_replace(to_number, '[^0-9]', '', 'g'), 10) = :msisdn10
              AND created_at >= :since AND created_at <= :until
            ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - :anchor)))
            LIMIT 1
            """, nativeQuery = true)
    Optional<TelephonyCallLog> findAirtelUnmatchedOutbound(
            @Param("counsellor") String counsellorUserId,
            @Param("msisdn10") String msisdn10,
            @Param("since") java.sql.Timestamp since,
            @Param("until") java.sql.Timestamp until,
            @Param("anchor") java.sql.Timestamp anchor);

    /**
     * Airtel promoter — a call row to attach a recording to: an AIRTEL row for
     * this counsellor + counterparty (last-10 on either leg) with no recording
     * yet, recent. Either direction (lead is to_number outbound / from_number inbound).
     */
    @Query(value = """
            SELECT * FROM telephony_call_log
            WHERE provider_type = 'AIRTEL'
              AND counsellor_user_id = :counsellor
              AND recording_logged = FALSE
              AND ( RIGHT(regexp_replace(to_number,   '[^0-9]', '', 'g'), 10) = :msisdn10
                 OR RIGHT(regexp_replace(from_number, '[^0-9]', '', 'g'), 10) = :msisdn10 )
              AND created_at >= :since AND created_at <= :until
            ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - :anchor)))
            LIMIT 1
            """, nativeQuery = true)
    Optional<TelephonyCallLog> findAirtelCallForRecording(
            @Param("counsellor") String counsellorUserId,
            @Param("msisdn10") String msisdn10,
            @Param("since") java.sql.Timestamp since,
            @Param("until") java.sql.Timestamp until,
            @Param("anchor") java.sql.Timestamp anchor);

    /**
     * Live state of a batch of calls, as {@code [id, status, durationSeconds, toNumber]}.
     *
     * <p>The queue's own row stops at DIALED — that means "handed to the provider" and
     * never changes again, so a call ringing right now and one that ended three hours ago
     * look identical on the queue row alone. This is what tells them apart, resolved in
     * one query per page rather than per row.
     *
     * <p>{@code toNumber} rides along because a queued row often has no phone of its
     * own: the manual click and the CALL_AI node pass only a lead id, and the number is
     * resolved downstream at dial time. Without this the queue table would show a raw
     * user UUID where the lead's number belongs.
     */
    @Query("""
            SELECT t.id, t.status, t.durationSeconds, t.toNumber FROM TelephonyCallLog t
            WHERE t.id IN :ids
            """)
    List<Object[]> findStatusByIds(@Param("ids") java.util.Collection<String> ids);

    /**
     * Occupied AI-call slots right now, as {@code [instituteId, providerType, count]}.
     *
     * <p>The AI call queue counts capacity from THIS — the call log — rather than from
     * a counter it maintains itself. Two reasons. A counter leaks: a call whose final
     * webhook never lands would hold its slot forever, and lost AI webhooks are a
     * documented failure mode. And a counter is blind: calls placed outside the queue
     * (the legacy path under the kill switch, a MOCK, an inbound IVR hand-off to the
     * bot) really do occupy the box, and a derived count sees them for free.
     *
     * <p>{@code since} is the stuck-call grace — a non-terminal row older than that
     * has lost its webhook and stops holding a slot. The terminal statuses are
     * enumerated inline rather than negated so this matches the partial index added in
     * V472 ({@code idx_tcl_ai_in_flight}).
     */
    @Query(value = """
            SELECT t.institute_id, t.provider_type, COUNT(*)
              FROM telephony_call_log t
             WHERE t.provider_type IN (:providers)
               AND t.direction = 'OUTBOUND'
               AND t.status IN ('INITIATED', 'QUEUED', 'COUNSELLOR_RINGING',
                                'COUNSELLOR_ANSWERED', 'IN_PROGRESS')
               AND t.created_at >= :since
             GROUP BY t.institute_id, t.provider_type
            """, nativeQuery = true)
    List<Object[]> countAiCallsInFlight(@Param("providers") List<String> providers,
                                        @Param("since") java.sql.Timestamp since);
}
