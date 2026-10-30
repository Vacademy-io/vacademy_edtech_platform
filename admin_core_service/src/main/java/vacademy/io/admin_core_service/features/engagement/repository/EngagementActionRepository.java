package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;

import java.time.Instant;
import java.util.List;

public interface EngagementActionRepository extends JpaRepository<EngagementAction, String> {

    /**
     * When the engine's messages to this member went out, newest first. Answers to the person's own
     * messages (REPLY) are not outreach and do not count; callers pass PageRequest.of(0, n).
     */
    @Query("""
            SELECT a.dispatchedAt FROM EngagementAction a
             WHERE a.memberId = :memberId AND a.status = 'SENT' AND a.kind <> 'REPLY'
               AND a.dispatchedAt IS NOT NULL
             ORDER BY a.dispatchedAt DESC
            """)
    List<Instant> recentSendTimes(@Param("memberId") String memberId, Pageable pageable);

    /**
     * The institute-wide task inbox: unassigned by design in Phase 1, ranked by priority.
     * The caller passes the status filter; SIMULATED (DRY_RUN) rows are surfaced only when
     * the caller explicitly asks for that status, never mixed into the default OPEN/ACKED view.
     */
    // An autonomous SEND (kind=SEND) is surfaced once it has settled: FAILED so a human can
    // reconcile/reopen it, SENT so the Sent tab shows what the engine sent on its own. The default
    // view asks for OPEN/ACKED only, so a successful auto-send never clutters "needs action"; a
    // pending (OPEN, scheduled) auto-send stays the dispatch job's business.
    @Query(value = """
            SELECT * FROM engagement_action
            WHERE institute_id = :instituteId
              AND status IN (:statuses)
              AND (kind IN ('TASK', 'REPLY') OR (kind = 'SEND' AND status IN ('FAILED', 'SENT')))
              AND (CAST(:engineId AS text) IS NULL OR engine_id = CAST(:engineId AS text))
              AND (CAST(:channel AS text) IS NULL OR channel = CAST(:channel AS text))
              AND (CAST(:kind AS text) IS NULL
                   OR (CAST(:kind AS text) = 'CRM' AND action_type IN
                       ('ADD_NOTE', 'CREATE_FOLLOWUP', 'ESCALATE', 'UPDATE_STATUS', 'SCHEDULE_AI_CALL'))
                   OR (CAST(:kind AS text) <> 'CRM' AND kind = CAST(:kind AS text)))
            ORDER BY priority DESC NULLS LAST, scheduled_for ASC NULLS LAST, created_at DESC
            """,
            countQuery = """
            SELECT count(*) FROM engagement_action
            WHERE institute_id = :instituteId
              AND status IN (:statuses)
              AND (kind IN ('TASK', 'REPLY') OR (kind = 'SEND' AND status IN ('FAILED', 'SENT')))
              AND (CAST(:engineId AS text) IS NULL OR engine_id = CAST(:engineId AS text))
              AND (CAST(:channel AS text) IS NULL OR channel = CAST(:channel AS text))
              AND (CAST(:kind AS text) IS NULL
                   OR (CAST(:kind AS text) = 'CRM' AND action_type IN
                       ('ADD_NOTE', 'CREATE_FOLLOWUP', 'ESCALATE', 'UPDATE_STATUS', 'SCHEDULE_AI_CALL'))
                   OR (CAST(:kind AS text) <> 'CRM' AND kind = CAST(:kind AS text)))
            """, nativeQuery = true)
    Page<EngagementAction> findInbox(@Param("instituteId") String instituteId,
                                     @Param("statuses") List<String> statuses,
                                     @Param("engineId") String engineId,
                                     @Param("channel") String channel,
                                     @Param("kind") String kind,
                                     Pageable pageable);

    /**
     * Graduation reached on a channel: the drafts already waiting in the inbox as copilot tasks become
     * autonomous sends, due now (the dispatch job re-checks quiet hours, consent, holds and credits
     * before each one goes). Only untouched message drafts: an acknowledged task has a person on it, a
     * reply or CRM action is not a proactive send, and a WhatsApp draft needs its approved template
     * (an email in template-only mode too). Returns how many were promoted.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET kind = 'SEND', scheduled_for = :now, expires_at = :expiresAt, updated_at = :now
             WHERE engine_id = :engineId AND channel = :channel
               AND kind = 'TASK' AND status = 'OPEN'
               AND (action_type IS NULL OR action_type IN ('SEND_MESSAGE', 'SHARE_LINK'))
               AND (expires_at IS NULL OR expires_at > :now)
               AND (channel <> 'WHATSAPP' OR template_name IS NOT NULL)
               AND (channel <> 'EMAIL' OR :emailNeedsTemplate = FALSE OR template_name IS NOT NULL)
               AND (draft_body IS NOT NULL OR template_name IS NOT NULL)
            """, nativeQuery = true)
    int promoteTasksToAutoSends(@Param("engineId") String engineId, @Param("channel") String channel,
                                @Param("emailNeedsTemplate") boolean emailNeedsTemplate,
                                @Param("now") Instant now, @Param("expiresAt") Instant expiresAt);

    /**
     * Institute-wide CROSS-ENGINE per-member action count in a window — the only cadence
     * safety mechanism (the prompt decides cadence, so this cap must be hard and checked
     * BEFORE the LLM call). Counts by subject (user or lead), not by member row, so three
     * engines sharing a learner share the cap.
     */
    // Counts what reached (or is about to reach) the person, never an unsent draft (F4 / S8):
    // OPEN or ACKED copilot TASKs and REPLY escalations are drafts, and an unattended inbox used
    // to block new decisions for up to 7 days. Counted: SENT; DISPATCHING (in flight); FAILED (the
    // unknown-outcome status, the message may have landed); DONE (a human marked it handled, e.g.
    // called or messaged the person themselves); and an OPEN kind=SEND, which goes out
    // with no human step, so leaving it out would let the brain queue past the cap. SIMULATED is
    // never counted (a DRY_RUN never consumes the real cap). A row counts while either its draft or
    // its send time is in the window, so a draft sent days after it was written still counts for a
    // full window after it went out. NULL subject
    // params are CAST so Postgres can infer the type (an un-cast null bind → "could not determine
    // data type of parameter" at runtime — a compile-clean, run-fatal trap on this hot path).
    @Query(value = """
            SELECT count(*) FROM engagement_action a
            JOIN engagement_member m ON m.id = a.member_id
            WHERE a.institute_id = :instituteId
              AND a.kind IN ('TASK', 'SEND', 'REPLY')
              AND (a.status IN ('SENT', 'DISPATCHING', 'FAILED', 'DONE')
                   OR (a.kind = 'SEND' AND a.status = 'OPEN'))
              AND (a.created_at >= :since OR a.dispatched_at >= :since)
              AND ((CAST(:userId AS varchar) IS NOT NULL AND m.user_id = CAST(:userId AS varchar))
                   OR (CAST(:audienceResponseId AS varchar) IS NOT NULL
                       AND m.audience_response_id = CAST(:audienceResponseId AS varchar)))
            """, nativeQuery = true)
    long countRecentActionsForSubject(@Param("instituteId") String instituteId,
                                      @Param("userId") String userId,
                                      @Param("audienceResponseId") String audienceResponseId,
                                      @Param("since") Instant since);

    /** Human handles a task: OPEN → ACKED/DONE/DISMISSED. CAS so two admins can't double-handle. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = :toStatus, outcome = :outcome, completed_at = :now, updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status IN ('OPEN', 'ACKED')
            """, nativeQuery = true)
    int transitionTask(@Param("id") String id,
                       @Param("instituteId") String instituteId,
                       @Param("toStatus") String toStatus,
                       @Param("outcome") String outcome,
                       @Param("now") Instant now);

    /**
     * At-most-once dispatch claim: OPEN/ACKED → DISPATCHING. Returns 1 for the single winner
     * (two admins double-clicking "send", or a retry, get 0). This is THE guard that makes
     * send-on-behalf safe — the customer must not receive the draft twice.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'DISPATCHING', updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status IN ('OPEN', 'ACKED')
            """, nativeQuery = true)
    int claimForDispatch(@Param("id") String id,
                         @Param("instituteId") String instituteId,
                         @Param("now") Instant now);

    /**
     * Reaper: expire stale open tasks so the inbox never becomes wallpaper silently. Includes
     * pending autonomous SENDs (kind=SEND, OPEN) that went past their expiry without dispatching
     * (e.g. the institute ran out of credits for days) — a stale message must NOT auto-send later.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'EXPIRED', updated_at = now()
             WHERE kind IN ('TASK', 'REPLY', 'SEND') AND status IN ('OPEN', 'ACKED')
               AND expires_at IS NOT NULL AND expires_at < now()
            """, nativeQuery = true)
    int expireStaleTasks();

    /**
     * The graduation ramp (Phase 2): how many proactive drafts a human has actually SENT with
     * approval (ACCEPTED or EDITED) for this engine. Once this reaches first_n, the engine may
     * auto-send. DONE ('handled elsewhere') does NOT count — it's no proof our drafts send well.
     */
    @Query(value = """
            SELECT count(*) FROM engagement_action
             WHERE engine_id = :engineId AND kind = 'TASK' AND status = 'SENT'
               AND outcome IN ('ACCEPTED', 'EDITED')
            """, nativeQuery = true)
    long countApprovedSends(@Param("engineId") String engineId);

    /**
     * Approved human sends per channel. Graduation is per channel: five reviewed in-app notes are
     * no evidence the engine writes WhatsApp or email a human would send. Rows: [channel, count].
     */
    @Query(value = """
            SELECT channel, count(*) FROM engagement_action
             WHERE engine_id = :engineId AND kind = 'TASK' AND status = 'SENT'
               AND outcome IN ('ACCEPTED', 'EDITED') AND channel IS NOT NULL
             GROUP BY channel
            """, nativeQuery = true)
    List<Object[]> countApprovedSendsByChannel(@Param("engineId") String engineId);

    @Query(value = """
            SELECT count(*) FROM engagement_action
             WHERE engine_id = :engineId AND kind = 'TASK' AND status = 'SENT'
               AND outcome IN ('ACCEPTED', 'EDITED') AND channel = :channel
            """, nativeQuery = true)
    long countApprovedSendsForChannel(@Param("engineId") String engineId, @Param("channel") String channel);

    /** Every action the engine has made on a channel; the AI-call pool rotates on it. */
    long countByEngineIdAndChannel(String engineId, String channel);

    /**
     * Autonomous sends that are DUE: a proactive SEND the decision service scheduled, now ready to
     * dispatch. Ordered by scheduled time so the oldest-due goes first; the dispatch job bounds the
     * batch. expires_at guards against firing a message that sat too long (the reaper also expires it).
     *
     * Only sends of a live (ACTIVE) engine are selected. Without this, a paused/archived engine's due
     * SENDs stay OPEN by design (so they resume when the engine does) but keep getting selected every
     * tick; because this scan is GLOBAL and ordered by scheduled_for ASC, a paused engine sitting on a
     * pile of past-due sends fills the whole batch and starves every OTHER institute's legitimate sends
     * until 72h expiry. Filtering on engine status here removes that starvation AND preserves the
     * resume-friendliness (a paused engine's sends simply become selectable again the moment it goes
     * ACTIVE) — strictly better than demoting them to tasks on pause, which would lose them on resume.
     */
    @Query(value = """
            SELECT a.* FROM engagement_action a
             WHERE a.kind = 'SEND' AND a.status = 'OPEN'
               AND (a.scheduled_for IS NULL OR a.scheduled_for <= :now)
               AND (a.expires_at IS NULL OR a.expires_at > :now)
               AND EXISTS (SELECT 1 FROM engagement_engine e
                            WHERE e.id = a.engine_id AND e.status = 'ACTIVE')
             ORDER BY a.scheduled_for ASC NULLS FIRST
             LIMIT :limit
            """, nativeQuery = true)
    List<EngagementAction> findDueAutoSends(@Param("now") Instant now, @Param("limit") int limit);

    /** Convert an autonomous SEND back to a human copilot TASK (kill switch / out of credits). */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET kind = 'TASK', error_message = :reason, updated_at = :now
             WHERE id = :id AND kind = 'SEND' AND status = 'OPEN'
            """, nativeQuery = true)
    int demoteSendToTask(@Param("id") String id, @Param("reason") String reason, @Param("now") Instant now);

    /** Stamp a SENT autonomous send as billed (the per-message credit charge succeeded). */
    @Modifying
    @Transactional
    @Query(value = "UPDATE engagement_action SET credits_billed_at = :now WHERE id = :id",
            nativeQuery = true)
    int markBilled(@Param("id") String id, @Param("now") Instant now);

    /**
     * Reconciliation work list: SENT autonomous sends whose credit charge never stamped (the deduct
     * HTTP call was lost after the message went out). Windowed on dispatched_at (SEND time), NOT
     * created_at (decision time) — a send scheduled days ahead, or fired after a long pause, dispatches
     * far after it was created, so a created_at window would permanently miss it. The idempotency key
     * (action id) makes a re-charge exactly-once.
     */
    // NO dispatched_at lower bound: a SENT-but-unbilled row must never age out of reconciliation.
    // A sliding `dispatched_at >= now - N days` window would permanently abandon any row whose charge
    // path (ai_service /deduct) stayed broken longer than N days — the message went out, the credit is
    // never charged, and nothing surfaces it (a silent, permanent revenue leak — the exact failure this
    // reconciliation exists to prevent). The `credits_billed_at IS NULL` predicate already bounds this
    // to the tiny unbilled backlog (near-empty in steady state, since dispatch charges inline), and
    // ORDER BY dispatched_at ASC drains oldest-first, so an unbounded scan stays cheap. (A partial index
    // on (status, credits_billed_at) WHERE credits_billed_at IS NULL keeps it O(backlog) at scale.)
    @Query(value = """
            SELECT * FROM engagement_action
             WHERE kind = 'SEND' AND status = 'SENT' AND credits_billed_at IS NULL
             ORDER BY dispatched_at ASC
             LIMIT :limit
            """, nativeQuery = true)
    List<EngagementAction> findUnbilledSent(@Param("limit") int limit);

    /**
     * Circuit-breaker input: how many of an institute's SENT autonomous messages went out UNBILLED.
     * A rising count means the charge path (ai_service /deduct) is failing while the balance read still
     * passes — the one divergence the affordability gate can't see. Above a threshold the dispatch job
     * stops auto-sending for that institute (fail closed on CHARGE failure, not just on a balance-read
     * failure), bounding revenue leak + spam.
     *
     * NO dispatched_at window: the count must reflect the TRUE unbilled backlog so the breaker clears
     * only when reconciliation actually charges those rows (credits_billed_at set) — not when they age
     * past a window. A sliding window let the tripping rows age out after N hours while the /deduct
     * outage continued, so the breaker re-armed and leaked another ~maxUnbilled sends every window.
     * With allow_negative deducts, a row stays unbilled ONLY when /deduct is unreachable, so a standing
     * count is exactly the "keep autonomy off until the charge path is fixed" signal we want.
     */
    @Query(value = """
            SELECT count(*) FROM engagement_action
             WHERE institute_id = :instituteId AND kind = 'SEND' AND status = 'SENT'
               AND credits_billed_at IS NULL
            """, nativeQuery = true)
    long countUnbilledSentForInstitute(@Param("instituteId") String instituteId);

    /**
     * Reaper for rows stuck mid-dispatch: a pod that died between the claim and the settle would
     * otherwise leave the action in DISPATCHING forever (invisible to the inbox, unreapable).
     * After a grace window, settle to FAILED (visible + reopenable) — NEVER back to OPEN, because
     * the send may have landed (marking OPEN could double-send). The correlation_id lets a human
     * confirm delivery before reopening.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'FAILED', error_message = 'dispatch did not complete (reaped)', updated_at = now()
             WHERE status = 'DISPATCHING' AND updated_at < :staleBefore
            """, nativeQuery = true)
    int reapStuckDispatching(@Param("staleBefore") Instant staleBefore);

    /**
     * Human reopens a FAILED task after confirming it did NOT land (correlation lookup). A failed
     * autonomous SEND comes back as a copilot TASK: left as SEND/OPEN, the dispatch job re-sent it
     * within minutes with no review, a duplicate whenever the first attempt had in fact landed.
     * The expiry is pushed out so the reaper doesn't expire the reopened task straight away.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'OPEN', error_message = NULL, outcome = NULL, updated_at = :now,
                   kind = CASE WHEN kind = 'SEND' THEN 'TASK' ELSE kind END,
                   expires_at = CASE WHEN expires_at IS NULL OR expires_at < :expiresAt
                                     THEN :expiresAt ELSE expires_at END
             WHERE id = :id AND institute_id = :instituteId AND status = 'FAILED'
            """, nativeQuery = true)
    int reopenFailed(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now,
                     @Param("expiresAt") Instant expiresAt);

    /**
     * Undo a human Done / Dismiss: DONE or DISMISSED back to OPEN, outcome cleared so the label the
     * learning loop reads is not the one the admin took back. Expiry pushed out like reopenFailed.
     * Only TASK / REPLY rows: an OPEN autonomous SEND would be picked up by the dispatch job and go
     * out with no review.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'OPEN', outcome = NULL, completed_at = NULL, updated_at = :now,
                   expires_at = CASE WHEN expires_at IS NULL OR expires_at < :expiresAt
                                     THEN :expiresAt ELSE expires_at END
             WHERE id = :id AND institute_id = :instituteId AND status IN ('DONE', 'DISMISSED')
               AND kind IN ('TASK', 'REPLY')
            """, nativeQuery = true)
    int restoreHandled(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now,
                       @Param("expiresAt") Instant expiresAt);

    /**
     * Withdraw a due autonomous SEND that must not go out any more (the person opted out or left
     * the audience after the decision). EXPIRED, not a TASK: a human must not be invited to send it.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'EXPIRED', error_message = :reason, updated_at = :now
             WHERE id = :id AND kind = 'SEND' AND status = 'OPEN'
            """, nativeQuery = true)
    int withdrawDueSend(@Param("id") String id, @Param("reason") String reason, @Param("now") Instant now);

    /** Move a due autonomous SEND out of quiet hours instead of firing it now. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET scheduled_for = :scheduledFor, updated_at = :now
             WHERE id = :id AND kind = 'SEND' AND status = 'OPEN'
            """, nativeQuery = true)
    int rescheduleDueSend(@Param("id") String id, @Param("scheduledFor") Instant scheduledFor,
                          @Param("now") Instant now);

    /**
     * Everything the engine has done or proposed for one member (a no-op or a dry-run row is not a
     * touch). Zero means the next thing it does is the member's first touch.
     */
    @Query(value = """
            SELECT count(*) FROM engagement_action
             WHERE member_id = :memberId AND kind <> 'NO_OP' AND status <> 'SIMULATED'
            """, nativeQuery = true)
    long countTouches(@Param("memberId") String memberId);

    /** Messages actually sent to one member — the touch count channels.maxTouches limits. */
    long countByMemberIdAndStatus(String memberId, String status);

    /** Dismissal-rate alarm input (design §7): if this exceeds ~80%, the labels are worthless. */
    @Query(value = """
            SELECT count(*) FILTER (WHERE outcome = 'DISMISSED') AS dismissed, count(*) AS total
            FROM engagement_action
            WHERE engine_id = :engineId AND kind = 'TASK' AND completed_at >= :since
            """, nativeQuery = true)
    List<Object[]> dismissalStats(@Param("engineId") String engineId, @Param("since") Instant since);

    /**
     * What one AI call triggered - for the Call Log's health sheet.
     *
     * <p>source_ref is '<call_log_id>:<rule_id>', so a prefix LIKE finds every rule that
     * fired on that call. Uses ux_ea_source_ref (source, source_ref): the leading column is
     * an equality and the second a left-anchored prefix, which btree serves as a range scan
     * rather than a scan of the table.
     *
     * <p>Scoped by institute as well as by call id: the call id alone is a UUID, but a
     * cross-institute read must be impossible by construction and not merely unlikely.
     */
    @Query(value = """
            SELECT * FROM engagement_action
             WHERE source = 'AI_CALL'
               AND institute_id = :instituteId
               AND source_ref LIKE :refPrefix
             ORDER BY created_at DESC
            """, nativeQuery = true)
    List<EngagementAction> findByCallRefPrefix(@Param("instituteId") String instituteId,
                                               @Param("refPrefix") String refPrefix);

    /**
     * The AI-call send backlog for one institute, newest first.
     *
     * <p>Answers "what has the agent promised that has not gone out?" across every call,
     * which the per-call panel cannot: a person chasing a missed WhatsApp does not know
     * which call to open.
     */
    @Query(value = """
            SELECT * FROM engagement_action
             WHERE source = 'AI_CALL' AND institute_id = :instituteId
               AND status IN (:statuses)
             ORDER BY created_at DESC
             LIMIT :limit
            """, nativeQuery = true)
    List<EngagementAction> findAiCallActions(@Param("instituteId") String instituteId,
                                             @Param("statuses") List<String> statuses,
                                             @Param("limit") int limit);

    /** Counts per status for the same set — the number on the banner. */
    @Query(value = """
            SELECT status, count(*) FROM engagement_action
             WHERE source = 'AI_CALL' AND institute_id = :instituteId
             GROUP BY status
            """, nativeQuery = true)
    List<Object[]> countAiCallActionsByStatus(@Param("instituteId") String instituteId);

    List<EngagementAction> findTop20ByMemberIdOrderByCreatedAtDesc(String memberId);

    /**
     * Cancel what is still pending for members who just left their engine: every OPEN or ACKED
     * row (sends, drafts, tasks) becomes EXPIRED with the reason, so nothing goes out later and no
     * one is asked to act on a lead that is done. With keepAiCallPromises, a row an AI voice call
     * produced stays: the person asked for it on the call.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'EXPIRED', error_message = :reason, updated_at = :now
             WHERE member_id IN (:memberIds) AND status IN ('OPEN', 'ACKED')
               AND (:keepAiCallPromises = FALSE OR source IS NULL OR source <> 'AI_CALL')
            """, nativeQuery = true)
    int cancelOpenForMembers(@Param("memberIds") List<String> memberIds, @Param("reason") String reason,
                             @Param("now") Instant now, @Param("keepAiCallPromises") boolean keepAiCallPromises);

    /**
     * B6: at-most-once claim of a CRM action task for approval (OPEN/ACKED TASK → DISPATCHING), so
     * two admins clicking approve run it once. The handler then settles it to DONE, or back to OPEN
     * with the reason when it could not run.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'DISPATCHING', updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND kind = 'TASK'
               AND status IN ('OPEN', 'ACKED') AND action_type IN (:types)
            """, nativeQuery = true)
    int claimCrmAction(@Param("id") String id, @Param("instituteId") String instituteId,
                       @Param("types") List<String> types, @Param("now") Instant now);

    /** B6/B7: claim a done CRM action for undo (DONE, approved or run on its own → DISPATCHING), once. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'DISPATCHING', updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status = 'DONE'
               AND outcome IN ('ACCEPTED', 'AUTO') AND action_type IN (:types)
            """, nativeQuery = true)
    int claimCrmUndo(@Param("id") String id, @Param("instituteId") String instituteId,
                     @Param("types") List<String> types, @Param("now") Instant now);

    /**
     * B7 graduation per action type (S7): CRM actions of this type a PERSON approved and that ran
     * (DONE + ACCEPTED). Ones the engine ran on its own (AUTO) or that were undone never count, and
     * approvals of messages or of another type never unlock this one.
     */
    @Query(value = """
            SELECT count(*) FROM engagement_action
            WHERE engine_id = :engineId AND action_type = :actionType
              AND status = 'DONE' AND outcome = 'ACCEPTED'
            """, nativeQuery = true)
    long countApprovedCrmActions(@Param("engineId") String engineId, @Param("actionType") String actionType);

    /**
     * Meta accepted the send, then reported it undeliverable (e.g. 131049, the per-user marketing
     * cap). Moves a SENT row to FAILED with Meta's reason so the inbox, the cap and the brain stop
     * treating it as delivered. Only SENT rows move; a row a human already handled is left alone.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_action
               SET status = 'FAILED', error_message = :reason, updated_at = :now
             WHERE id = :id AND status = 'SENT'
            """, nativeQuery = true)
    int markDeliveryFailed(@Param("id") String id, @Param("reason") String reason, @Param("now") Instant now);

    /** SENT WhatsApp rows of this institute dispatched since the cursor: the ones a failure report can hit. */
    @Query(value = """
            SELECT id FROM engagement_action
             WHERE institute_id = :instituteId AND status = 'SENT' AND channel = 'WHATSAPP'
               AND dispatched_at >= :since
            """, nativeQuery = true)
    List<String> sentWhatsAppSince(@Param("instituteId") String instituteId, @Param("since") Instant since);
}
