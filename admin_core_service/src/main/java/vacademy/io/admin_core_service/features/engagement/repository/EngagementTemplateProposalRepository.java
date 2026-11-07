package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface EngagementTemplateProposalRepository extends JpaRepository<EngagementTemplateProposal, String> {

    /** The review list for an engine — newest round first, then newest within a round. */
    List<EngagementTemplateProposal> findByEngineIdAndInstituteIdOrderByRoundDescCreatedAtDesc(
            String engineId, String instituteId);

    /** Ownership-scoped fetch — never load a proposal by id without pinning the institute. */
    Optional<EngagementTemplateProposal> findByIdAndInstituteId(String id, String instituteId);

    /** The activation gate: does this engine have at least one usable (Meta-approved) template? */
    long countByEngineIdAndStatusIn(String engineId, List<String> statuses);

    /** The Meta poll's per-institute work list: proposals awaiting a verdict. */
    List<EngagementTemplateProposal> findByInstituteIdAndStatusIn(String instituteId, List<String> statuses);

    /** The Meta poll's institute scan — only institutes with something actually pending. */
    @Query(value = """
            SELECT DISTINCT institute_id FROM engagement_template_proposal
             WHERE status IN ('SUBMITTED', 'META_PENDING')
            """, nativeQuery = true)
    List<String> institutesWithPendingProposals();

    /** Institutes with templates Meta approved (or later disabled) — the hourly W12 re-check. */
    @Query(value = """
            SELECT DISTINCT institute_id FROM engagement_template_proposal
             WHERE status IN ('META_APPROVED', 'META_RECATEGORISED', 'META_DISABLED')
            """, nativeQuery = true)
    List<String> institutesWithApprovedProposals();

    /** W12 CAS: an approved template disabled by Meta (or re-approved). Never touches review states. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = :toStatus, rejection_reason = :reason, updated_at = :now
             WHERE id = :id AND status IN ('META_APPROVED', 'META_RECATEGORISED', 'META_DISABLED')
            """, nativeQuery = true)
    int reconcileApprovedFromMeta(@Param("id") String id, @Param("toStatus") String toStatus,
                                  @Param("reason") String reason, @Param("now") Instant now);

    /** Approved-and-usable templates for an engine (for the sender/brain to reference by name). */
    @Query(value = """
            SELECT * FROM engagement_template_proposal
             WHERE engine_id = :engineId AND institute_id = :instituteId
               AND status IN ('META_APPROVED', 'META_RECATEGORISED')
             ORDER BY updated_at DESC
            """, nativeQuery = true)
    List<EngagementTemplateProposal> findApproved(@Param("engineId") String engineId,
                                                  @Param("instituteId") String instituteId);

    /** Human approves a draft: AI_PROPOSED/USER_REVIEW → USER_APPROVED. CAS so a stale UI can't skip states. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'USER_APPROVED', updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status IN ('AI_PROPOSED', 'USER_REVIEW')
            """, nativeQuery = true)
    int approve(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now);

    /**
     * Claim for submission: USER_APPROVED → SUBMITTED. Returns 1 for the single winner so a
     * double-click (or two admins) can't submit the same template to Meta twice. The caller then
     * re-reads the row (now SUBMITTED) and stamps the notification_template FK with
     * {@link #stampSubmittedTemplateId} — kept as a separate commit because the FK isn't known until
     * notification_service creates the draft, and that draft (an HTTP side effect) must survive even
     * if admin_core's later steps fail.
     *
     * <p>Every CAS in this repository clears the persistence context: the caller re-reads the row in
     * the same request, and under open-session-in-view that re-read otherwise returns the managed
     * entity as it was BEFORE the update. A full save of that stale copy is what flipped every first
     * "Submit to Meta" back to USER_APPROVED, so the proposal was never polled.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'SUBMITTED', submitted_at = :now, updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status = 'USER_APPROVED'
            """, nativeQuery = true)
    int claimForSubmit(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now);

    /** W10 — templates sent to Meta by this institute since a time (Meta limits creations per hour). */
    @Query(value = """
            SELECT count(*) FROM engagement_template_proposal
             WHERE institute_id = :instituteId AND submitted_at IS NOT NULL AND submitted_at >= :since
            """, nativeQuery = true)
    long countSubmittedSince(@Param("instituteId") String instituteId, @Param("since") Instant since);

    /** W10 — park an approved proposal until the institute is under Meta's hourly limit again. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'QUEUED', updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status = 'USER_APPROVED'
            """, nativeQuery = true)
    int queueForMeta(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now);

    /** W10 — take a queued proposal back to USER_APPROVED so it can be submitted now. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'USER_APPROVED', updated_at = :now
             WHERE id = :id AND status = 'QUEUED'
            """, nativeQuery = true)
    int unqueue(@Param("id") String id, @Param("now") Instant now);

    /** Queued proposals of an institute, oldest first. */
    @Query(value = """
            SELECT * FROM engagement_template_proposal
             WHERE institute_id = :instituteId AND status = 'QUEUED'
             ORDER BY updated_at ASC
            """, nativeQuery = true)
    List<EngagementTemplateProposal> findQueued(@Param("instituteId") String instituteId);

    /** Institutes with templates waiting for Meta capacity. */
    @Query(value = """
            SELECT DISTINCT institute_id FROM engagement_template_proposal WHERE status = 'QUEUED'
            """, nativeQuery = true)
    List<String> institutesWithQueuedProposals();

    /** W15 — the newest edited version of an approved template (any state), if one exists. */
    Optional<EngagementTemplateProposal> findFirstByReplacesIdOrderByCreatedAtDesc(String replacesId);

    /** W15 — retire the approved template an edited version replaces, once the new one is approved. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'SUPERSEDED', updated_at = :now
             WHERE id = :id AND status IN ('META_APPROVED', 'META_RECATEGORISED', 'META_DISABLED')
            """, nativeQuery = true)
    int supersedeReplaced(@Param("id") String id, @Param("now") Instant now);

    /**
     * Stamp the notification_template FK on a row this submit claimed. Targeted on purpose: a full
     * save of the entity would also write back whatever status the in-memory copy holds.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET notification_template_id = COALESCE(notification_template_id, :fk), updated_at = :now
             WHERE id = :id AND institute_id = :instituteId AND status = 'SUBMITTED'
            """, nativeQuery = true)
    int stampSubmittedTemplateId(@Param("id") String id, @Param("instituteId") String instituteId,
                                 @Param("fk") String fk, @Param("now") Instant now);

    /**
     * Reconcile from a Meta poll: only a SUBMITTED/META_PENDING row moves (an already-adjudicated or
     * human-touched row is never silently overwritten by a lagging poll). meta_category/rejection are
     * set alongside so the reviewer sees why.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = :toStatus, meta_category = :metaCategory,
                   rejection_reason = :rejectionReason, updated_at = :now
             WHERE id = :id AND status IN ('SUBMITTED', 'META_PENDING')
            """, nativeQuery = true)
    int reconcileFromMeta(@Param("id") String id, @Param("toStatus") String toStatus,
                          @Param("metaCategory") String metaCategory,
                          @Param("rejectionReason") String rejectionReason, @Param("now") Instant now);

    /**
     * Roll a SUBMITTED proposal back to USER_APPROVED (retryable), keeping any FK we stamped and
     * adopting {@code fkToAdopt} if we didn't have one (COALESCE). Status-guarded on SUBMITTED so a
     * concurrent poll that already advanced the row to META_APPROVED/etc. is NEVER clobbered — the
     * update affects 0 rows and the winning state stands. Used by submit()'s failure path and by
     * the stranded-submission reaper.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'USER_APPROVED',
                   notification_template_id = COALESCE(notification_template_id, :fkToAdopt),
                   rejection_reason = :reason, updated_at = :now
             WHERE id = :id AND status = 'SUBMITTED'
            """, nativeQuery = true)
    int rollbackSubmit(@Param("id") String id, @Param("fkToAdopt") String fkToAdopt,
                       @Param("reason") String reason, @Param("now") Instant now);

    /** Human abandons a proposal. Only non-terminal, not-yet-live rows. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE engagement_template_proposal
               SET status = 'WITHDRAWN', updated_at = :now
             WHERE id = :id AND institute_id = :instituteId
               AND status IN ('AI_PROPOSED', 'USER_REVIEW', 'USER_APPROVED', 'QUEUED', 'META_REJECTED', 'META_RECATEGORISED')
            """, nativeQuery = true)
    int withdraw(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now);

    /** Highest round used for an engine so far (0 if none) — the next batch is round+1. */
    @Query(value = "SELECT COALESCE(MAX(round), 0) FROM engagement_template_proposal WHERE engine_id = :engineId",
            nativeQuery = true)
    int maxRound(@Param("engineId") String engineId);

    /**
     * Approved WhatsApp templates of the institute's OTHER engines that this engine could take over:
     * same language, not from an archived or system engine, and not already present on this engine.
     * One row per template name (the most recently updated).
     */
    @Query(value = """
            SELECT DISTINCT ON (p.name) p.* FROM engagement_template_proposal p
              JOIN engagement_engine e ON e.id = p.engine_id
             WHERE p.institute_id = :instituteId AND p.engine_id <> :engineId
               AND p.status IN ('META_APPROVED', 'META_RECATEGORISED')
               AND COALESCE(p.language, e.language) = :language
               AND e.status <> 'ARCHIVED' AND COALESCE(e.created_by, '') <> 'SYSTEM_AI_CALL'
               AND NOT EXISTS (SELECT 1 FROM engagement_template_proposal x
                                WHERE x.engine_id = :engineId AND x.name = p.name
                                  AND x.status NOT IN ('WITHDRAWN', 'SUPERSEDED', 'META_REJECTED'))
             ORDER BY p.name, p.updated_at DESC
            """, nativeQuery = true)
    List<EngagementTemplateProposal> findReusableFromOtherEngines(@Param("instituteId") String instituteId,
                                                                  @Param("engineId") String engineId,
                                                                  @Param("language") String language);

    /**
     * The institute's templates carrying a system purpose tag (SYS:...) in any engine, newest first:
     * approved ones to reuse, and ones still on their way to Meta so a second is never started.
     */
    @Query(value = """
            SELECT * FROM engagement_template_proposal
             WHERE institute_id = :instituteId AND purpose = :purpose
               AND COALESCE(language, 'en') = :language
               AND status NOT IN ('WITHDRAWN', 'SUPERSEDED', 'META_REJECTED', 'META_DISABLED')
             ORDER BY CASE WHEN status IN ('META_APPROVED', 'META_RECATEGORISED') THEN 0 ELSE 1 END, updated_at DESC
            """, nativeQuery = true)
    List<EngagementTemplateProposal> findSystemTemplates(@Param("instituteId") String instituteId,
                                                         @Param("purpose") String purpose,
                                                         @Param("language") String language);
}
