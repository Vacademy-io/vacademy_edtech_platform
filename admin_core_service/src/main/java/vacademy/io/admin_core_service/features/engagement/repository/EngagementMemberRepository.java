package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;

import java.time.Instant;
import java.util.List;

public interface EngagementMemberRepository extends JpaRepository<EngagementMember, String> {

    /**
     * Due scan (no lock). Safety comes from the per-row lease CAS below — the pattern this
     * codebase has proven in prod three times (WorkflowResumeJob.claimForResume,
     * LeadFollowupRepository.claimDueTransition, AudienceRepository.tryClaimAiCampaign).
     * Ordered by tier so HOT members (fresh replies) are decided first within the engine.
     */
    @Query(value = """
            SELECT * FROM engagement_member
            WHERE engine_id = :engineId AND status = 'ACTIVE' AND next_action_at <= :now
            ORDER BY tier ASC, next_action_at ASC
            LIMIT :batch
            """, nativeQuery = true)
    List<EngagementMember> findDueMembers(@Param("engineId") String engineId,
                                          @Param("now") Instant now,
                                          @Param("batch") int batch);

    /**
     * THE claim: a LEASE, not a status flip. Pushes next_action_at +15min; returns 1 only for
     * the winning replica (the loser sees next_action_at > now and gets 0 rows). A pod that
     * dies mid-decision simply has its rows come due again when the lease expires — a CLAIMED
     * status would be a terminal state on pod death (the row leaves the due scan forever,
     * invisibly, which is the worst failure class for an autonomous system).
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET next_action_at = :leaseUntil, updated_at = :now
             WHERE id = :id AND status = 'ACTIVE' AND next_action_at <= :now
            """, nativeQuery = true)
    int claimLease(@Param("id") String id, @Param("now") Instant now, @Param("leaseUntil") Instant leaseUntil);

    /**
     * Idempotent enrolment with a SWEEP STAMP. Inserts if absent; if present, stamps the row
     * with the current reconcile run id AND resurrects it if it was EXITED (a learner who left
     * and re-enrolled next term must not stay invisible) — but NOT if OPTED_OUT (consent sticks).
     * ON CONFLICT target matches ux_em_subject token-for-token. Rows-affected is 1 on BOTH the
     * insert and the update path (Postgres counts an ON-CONFLICT update as affected), so the
     * caller measures "newly enrolled" by a before/after ACTIVE count, not this return value.
     */
    // is_holdout is assigned ONCE at insert from a STABLE hash of the subject key (so re-reconciles
    // never flip a member's cohort) against holdoutPct — and is deliberately NOT in DO UPDATE, so an
    // existing member's cohort is immutable. holdoutPct=0 → hashtext(...)%100 in [0,99] is never < 0
    // → nobody is a holdout.
    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO engagement_member
                (id, engine_id, institute_id, user_id, audience_response_id, status, tier,
                 next_action_at, memory_json, is_holdout)
            VALUES (:id, :engineId, :instituteId, :userId, :audienceResponseId, 'ACTIVE', 2,
                    :nextActionAt, jsonb_build_object('reconcileRun', CAST(:runId AS text)),
                    -- non-negative 0..99 WITHOUT abs() — abs(hashtext) can hit abs(INT_MIN) which
                    -- Postgres throws on (integer out of range), crashing the enrol for that member.
                    (((hashtext(:engineId || '|' || COALESCE(:userId, :audienceResponseId, :id)) % 100) + 100) % 100) < :holdoutPct)
            ON CONFLICT (engine_id, COALESCE(user_id, ''), COALESCE(audience_response_id, ''))
            DO UPDATE SET
                status = CASE WHEN engagement_member.status = 'EXITED' THEN 'ACTIVE'
                              ELSE engagement_member.status END,
                next_action_at = CASE WHEN engagement_member.status = 'EXITED' THEN EXCLUDED.next_action_at
                                      ELSE engagement_member.next_action_at END,
                memory_json = jsonb_set(COALESCE(engagement_member.memory_json, cast('{}' as jsonb)),
                                        '{reconcileRun}', to_jsonb(CAST(:runId AS text))),
                updated_at = now()
            """, nativeQuery = true)
    int enrollOrStamp(@Param("id") String id,
                      @Param("engineId") String engineId,
                      @Param("instituteId") String instituteId,
                      @Param("userId") String userId,
                      @Param("audienceResponseId") String audienceResponseId,
                      @Param("nextActionAt") Instant nextActionAt,
                      @Param("runId") String runId,
                      @Param("holdoutPct") int holdoutPct);

    /**
     * Reconciliation: EXIT active members NOT stamped by this reconcile run — no giant IN-list
     * (which would blow pgJDBC's 32,767-param cap on a large audience). Runs unconditionally,
     * so an audience that resolved to zero subjects correctly exits everyone.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET status = 'EXITED', updated_at = now()
             WHERE engine_id = :engineId AND status = 'ACTIVE'
               AND COALESCE(memory_json->>'reconcileRun', '') <> :runId
            """, nativeQuery = true)
    int exitNotStampedBy(@Param("engineId") String engineId, @Param("runId") String runId);

    long countByEngineIdAndStatus(String engineId, String status);

    List<EngagementMember> findByEngineIdAndStatus(String engineId, String status);

    /**
     * Reply ingestion: an inbound reply PULLS its member forward — tier 0, due now, 24h window
     * open — so the copilot surfaces a reply-response task fast instead of at the next natural
     * cadence (which for a dormant member could be days away). Matched by last-10 phone digits
     * against the resolved contact; we don't store phone on the member, so this joins to the
     * lead's contact fields and the student table. Returns the number of members promoted.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member m
               SET tier = CASE WHEN (m.window_open_until IS NULL OR m.window_open_until < :now)
                               THEN 0 ELSE m.tier END,
                   next_action_at = CASE WHEN (m.window_open_until IS NULL OR m.window_open_until < :now)
                                              AND NOT EXISTS (
                                                  SELECT 1 FROM engagement_engine e
                                                  WHERE e.id = m.engine_id AND e.status = 'ACTIVE'
                                                    AND e.auto_send_killed = false
                                                    AND e.channels -> 'WHATSAPP' ->> 'enabled' = 'true'
                                                    AND e.channels -> 'WHATSAPP' ->> 'autoReply' = 'true')
                               THEN :now ELSE m.next_action_at END,
                   -- Meta resets the 24h free-form window on EVERY inbound message, so the window is
                   -- ALWAYS extended (GREATEST = monotonic). Only the scheduling pull-forward (tier /
                   -- next_action_at) keeps the idempotency guard — re-running the overlapping sweep
                   -- must not repeatedly reset the cadence or stomp a fresh in-flight lease, but it
                   -- MUST keep the window honest, else a human answering an escalation hours later is
                   -- falsely rejected while the real Meta window is still open. (CASE/SET expressions
                   -- all read the OLD row values, so the guard sees pre-update window_open_until.)
                   window_open_until = GREATEST(COALESCE(m.window_open_until, :windowUntil), :windowUntil),
                   updated_at = :now
             WHERE m.institute_id = :instituteId AND m.status = 'ACTIVE'
               -- Holdout members are the control group: enrolled but NEVER messaged. Do not open
               -- their reply window (which would let the auto-reply answer/escalate them and
               -- contaminate the lift measurement) or pull them forward.
               AND m.is_holdout = false
               AND (
                    m.user_id IN (
                        SELECT s.user_id FROM student s
                        WHERE RIGHT(regexp_replace(COALESCE(s.mobile_number,''),'[^0-9]','','g'),10) IN (:phones10))
                 OR m.audience_response_id IN (
                        SELECT ar.id FROM audience_response ar
                        WHERE RIGHT(regexp_replace(COALESCE(ar.parent_mobile,''),'[^0-9]','','g'),10) IN (:phones10))
               )
            """, nativeQuery = true)
    int promoteByPhones(@Param("instituteId") String instituteId,
                        @Param("phones10") List<String> phones10,
                        @Param("now") Instant now,
                        @Param("windowUntil") Instant windowUntil);

    /** Distinct institute ids that have a live (ACTIVE/DRY_RUN) engine — the reply sweep's scope. */
    @Query(value = """
            SELECT DISTINCT institute_id FROM engagement_engine
            WHERE status IN ('ACTIVE', 'DRY_RUN')
            """, nativeQuery = true)
    List<String> institutesWithLiveEngines();

    /** Projection for the auto-reply candidate lookup. */
    interface AutoReplyCandidate {
        String getMemberId();
        String getEngineId();
        String getLastReplyWamid();
    }

    /**
     * Members whose engine wants to AUTO-REPLY to this phone right now: a live (ACTIVE, not DRY_RUN —
     * a dry run must never send a real reply) engine with WhatsApp enabled AND autoReply on, whose 24h
     * window is still open, matched by last-10 phone digits. Ordered most-recently-engaged first so a
     * person in several engines is answered by ONE — the engine that last reached out (the one they're
     * most plausibly replying to) — not spammed by all of them.
     *
     * The kill switch (auto_send_killed) is honored HERE too: an auto-reply is the ONLY continuously
     * autonomous send in the system, so a killed engine must stop answering — otherwise the emergency
     * brake that stops proactive sends would leave the reply path sending unstoppably. A killed engine
     * returns no candidate; the inbound reply still surfaces as a human copilot task via the promotion
     * pass (promoteByPhones) that runs before this, so nothing is dropped — it just is not auto-sent.
     */
    @Query(value = """
            SELECT m.id AS memberId, m.engine_id AS engineId, m.last_reply_wamid AS lastReplyWamid
            FROM engagement_member m
            JOIN engagement_engine e ON e.id = m.engine_id
            WHERE m.institute_id = :instituteId AND m.status = 'ACTIVE'
              AND m.is_holdout = false
              AND e.status = 'ACTIVE'
              AND e.auto_send_killed = false
              AND e.channels -> 'WHATSAPP' ->> 'enabled' = 'true'
              AND e.channels -> 'WHATSAPP' ->> 'autoReply' = 'true'
              AND m.window_open_until IS NOT NULL AND m.window_open_until > :now
              AND (
                   m.user_id IN (
                       SELECT s.user_id FROM student s
                       WHERE RIGHT(regexp_replace(COALESCE(s.mobile_number,''),'[^0-9]','','g'),10) = :phone10)
                OR m.audience_response_id IN (
                       SELECT ar.id FROM audience_response ar
                       WHERE RIGHT(regexp_replace(COALESCE(ar.parent_mobile,''),'[^0-9]','','g'),10) = :phone10)
              )
            ORDER BY m.last_decided_at DESC NULLS LAST
            """, nativeQuery = true)
    List<AutoReplyCandidate> findAutoReplyCandidates(@Param("instituteId") String instituteId,
                                                     @Param("phone10") String phone10,
                                                     @Param("now") Instant now);

    /**
     * At-most-once claim on an inbound reply, scoped to the SUBJECT (institute + phone), not one
     * member row: stamps last_reply_wamid on EVERY active member matching the phone in one atomic
     * UPDATE. Returns >0 only for the single winning call — a second sweep (overlap/replica) matches
     * zero rows because every candidate already carries the wamid. Claiming ALL matching members is
     * what makes "one reply → ONE engine" hold even when the candidate ORDERING flips between sweeps
     * (the normal sweep bumps last_decided_at on a co-enrolled member, which would otherwise promote
     * a different, unstamped member to candidates[0] and double-answer the same message).
     */
    /**
     * A decision outcome, written without the columns other writers own: status (opt-out, nightly
     * reconcile), the reply window, tier and the reply stamp. A full-row save from the snapshot read
     * before the LLM call put back whatever changed while the model was thinking. next_action_at:
     * the decision value while the lease taken for it is still in place; if a reply pulled the
     * member forward meanwhile, the earlier time wins.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET last_decided_at = :decidedAt, wake_fingerprint = :fingerprint,
                   consecutive_no_ops = :noOps, consecutive_failures = 0,
                   next_action_at = CASE WHEN next_action_at = :heldLease THEN :nextActionAt
                                         ELSE LEAST(next_action_at, :nextActionAt) END,
                   updated_at = :decidedAt
             WHERE id = :id
            """, nativeQuery = true)
    int recordDecision(@Param("id") String id, @Param("decidedAt") Instant decidedAt,
                       @Param("fingerprint") String fingerprint, @Param("noOps") short noOps,
                       @Param("heldLease") Instant heldLease, @Param("nextActionAt") Instant nextActionAt);

    /** Failure backoff after a decision threw: only the retry clock and the failure count. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET consecutive_failures = :failures, next_action_at = :retryAt, updated_at = now()
             WHERE id = :id
            """, nativeQuery = true)
    int recordDecisionFailure(@Param("id") String id, @Param("failures") short failures,
                              @Param("retryAt") Instant retryAt);

    /**
     * Hold a member for the auto-reply LLM window: push next_action_at to at least the hold end, so
     * the sweep cannot claim them meanwhile. Fails (0 rows) when a lease is already running, i.e.
     * next_action_at falls inside (now, holdUntil]: a proactive decision holds them right now.
     * The auto-reply engine is not pulled due on a reply (promoteByPhones), so a member that is not
     * leased has a later next_action_at, which GREATEST keeps.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET next_action_at = GREATEST(next_action_at, :holdUntil), updated_at = :now
             WHERE id = :id AND status = 'ACTIVE'
               AND NOT (next_action_at > :now AND next_action_at <= :holdUntil)
            """, nativeQuery = true)
    int holdForReply(@Param("id") String id, @Param("now") Instant now, @Param("holdUntil") Instant holdUntil);

    /**
     * Opt a person out of every engine of the institute that reaches this phone (learner or
     * lead): they asked us to stop. OPTED_OUT survives reconciliation (the enrol upsert only
     * revives EXITED), so no engine messages them again.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member m
               SET status = 'OPTED_OUT', updated_at = :now
             WHERE m.institute_id = :instituteId AND m.status IN ('ACTIVE', 'PAUSED')
               AND (
                    m.user_id IN (
                        SELECT s.user_id FROM student s
                        WHERE RIGHT(regexp_replace(COALESCE(s.mobile_number,''),'[^0-9]','','g'),10) = :phone10)
                 OR m.audience_response_id IN (
                        SELECT ar.id FROM audience_response ar
                        WHERE RIGHT(regexp_replace(COALESCE(ar.parent_mobile,''),'[^0-9]','','g'),10) = :phone10)
               )
            """, nativeQuery = true)
    int optOutByPhone(@Param("instituteId") String instituteId, @Param("phone10") String phone10,
                      @Param("now") Instant now);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member m
               SET last_reply_wamid = :wamid, updated_at = :now
             WHERE m.institute_id = :instituteId AND m.status = 'ACTIVE'
               AND (m.last_reply_wamid IS NULL OR m.last_reply_wamid <> :wamid)
               AND (
                    m.user_id IN (
                        SELECT s.user_id FROM student s
                        WHERE RIGHT(regexp_replace(COALESCE(s.mobile_number,''),'[^0-9]','','g'),10) = :phone10)
                 OR m.audience_response_id IN (
                        SELECT ar.id FROM audience_response ar
                        WHERE RIGHT(regexp_replace(COALESCE(ar.parent_mobile,''),'[^0-9]','','g'),10) = :phone10)
               )
            """, nativeQuery = true)
    int claimReplyWamidForPhone(@Param("instituteId") String instituteId,
                                @Param("phone10") String phone10,
                                @Param("wamid") String wamid,
                                @Param("now") Instant now);

    /**
     * Mark a member as handled by the auto-reply so the NORMAL decision sweep doesn't ALSO wake it
     * for the same reply and create a duplicate reply-response task: last_decided_at moves past the
     * reply time (so hasUnansweredReply is false) and next_action_at is pushed to the next cadence.
     * consecutive_no_ops resets — a reply IS engagement.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET last_decided_at = :now, next_action_at = :nextActionAt,
                   consecutive_no_ops = 0, updated_at = :now
             WHERE id = :id
            """, nativeQuery = true)
    int markReplyHandled(@Param("id") String id, @Param("now") Instant now,
                         @Param("nextActionAt") Instant nextActionAt);

    /**
     * The reply did NOT settle (send failed, dispatch claim lost, engine vanished): pull the member
     * due soon WITHOUT advancing last_decided_at, so the normal sweep's unanswered-reply wake
     * surfaces a HUMAN task shortly — even when the member's next_action_at was days out (a
     * follow-up reply inside an open window doesn't re-promote, so without this nudge the person's
     * message would sit dark until cadence elapsed). LEAST keeps an earlier due time.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_member
               SET next_action_at = LEAST(COALESCE(next_action_at, :retryAt), :retryAt), updated_at = :now
             WHERE id = :id
            """, nativeQuery = true)
    int markReplyUnhandled(@Param("id") String id, @Param("retryAt") Instant retryAt, @Param("now") Instant now);

    /**
     * THE at-most-once gate for auto-answering an inbound message: exactly one caller ever inserts a
     * given (institute, wamid) — overlapping sweeps, replicas, interleaved overruns, and late-arriving
     * member rows all lose on the primary-key conflict. The per-member last_reply_wamid stamp remains
     * as a secondary marker, but THIS is the gate.
     */
    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO engagement_handled_reply (institute_id, wamid, claimed_at)
            VALUES (:instituteId, :wamid, :now)
            ON CONFLICT (institute_id, wamid) DO NOTHING
            """, nativeQuery = true)
    int claimHandledReply(@Param("instituteId") String instituteId, @Param("wamid") String wamid,
                          @Param("now") Instant now);

    /** Prune the handled-reply set (rows older than the reply window are dead weight). */
    @Modifying
    @Transactional
    @Query(value = "DELETE FROM engagement_handled_reply WHERE claimed_at < :before", nativeQuery = true)
    int pruneHandledReplies(@Param("before") Instant before);

    /**
     * Subject lookup for AiCallEngagementProvisioner's get-or-create. Deliberately
     * findFirst rather than a unique lookup: ux_em_subject already guarantees at most one
     * per (engine, subject), and findFirst cannot throw if that ever ceases to hold.
     */
    java.util.Optional<EngagementMember> findFirstByEngineIdAndUserId(String engineId, String userId);

    java.util.Optional<EngagementMember> findFirstByEngineIdAndAudienceResponseId(
            String engineId, String audienceResponseId);
}
