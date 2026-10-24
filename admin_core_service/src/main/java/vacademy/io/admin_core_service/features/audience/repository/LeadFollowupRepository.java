package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;

import java.sql.Timestamp;
import java.util.List;

@Repository
public interface LeadFollowupRepository extends JpaRepository<LeadFollowup, String> {

    List<LeadFollowup> findByAudienceResponseIdOrderByScheduleTimeAsc(String audienceResponseId);

    /** True when the lead already has an open priority follow-up (one per reattempt burst). */
    boolean existsByAudienceResponseIdAndIsClosedFalseAndIsPriorityTrue(String audienceResponseId);

    /** Check Lead's follow-up history: every follow-up across one person's enquiries. */
    List<LeadFollowup> findByAudienceResponseIdInOrderByScheduleTimeDesc(List<String> audienceResponseIds);

    List<LeadFollowup> findByCreatedByAndIsClosedFalseOrderByScheduleTimeAsc(String createdBy);

    List<LeadFollowup> findByInstituteIdAndIsClosedFalseOrderByScheduleTimeAsc(String instituteId);

    /** Manager view: pending follow-ups owned by anyone in the caller's hierarchy scope. */
    List<LeadFollowup> findByInstituteIdAndCreatedByInAndIsClosedFalseOrderByScheduleTimeAsc(
            String instituteId, List<String> createdBy);

    /*
     * Completed follow-ups. Paged, unlike their pending counterparts above: the
     * closed set only ever grows, so an institute a year in would otherwise be
     * handing the browser every follow-up it has ever finished.
     *
     * Scoped on created_by to match the pending queries exactly. Who CLOSED a
     * follow-up is a different question from whose follow-up it is, and only
     * the latter decides who may see it; closed_by rides along on the DTO for
     * display.
     */
    Page<LeadFollowup> findByCreatedByAndIsClosedTrue(String createdBy, Pageable pageable);

    /*
     * Completed follow-ups for the Completed tile, with the two controls that
     * list needs: a closed_at window and a lead search.
     *
     * The search mirrors the leads query exactly, auth-service user ids
     * included. A lead whose identity lives on its auth user carries nothing in
     * ar.parent_name, so name search without searchUserIdsCsv finds nothing for
     * it, which is a bug this codebase has already been bitten by.
     *
     * leadStatusCsv / leadStatusExcludeCsv are lead status keys, read the same
     * way the leads query reads them (lead_status first, then the profile
     * conversion status), so a sidebar tab that leaves LOST leads out of the
     * open buckets can leave them out of this one too.
     *
     * No semicolon anywhere in the string: Hibernate appends its own limit
     * clause to a paged native query and a stray one makes it a runtime error.
     */
    @Query(value = """
            SELECT f.* FROM lead_followup f
            LEFT JOIN audience_response ar ON ar.id = f.audience_response_id
            LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
            LEFT JOIN user_lead_profile ulp
                   ON ulp.user_id = ar.user_id AND ulp.institute_id = f.institute_id
            WHERE f.institute_id = :instituteId
              AND f.is_closed = TRUE
              AND (COALESCE(:createdByCsv, '') = ''
                   OR f.created_by = ANY(STRING_TO_ARRAY(:createdByCsv, ',')))
              AND (CAST(:closedFrom AS timestamp) IS NULL
                   OR f.closed_at >= CAST(:closedFrom AS timestamp))
              AND (CAST(:closedTo AS timestamp) IS NULL
                   OR f.closed_at < CAST(:closedTo AS timestamp))
              AND (COALESCE(:searchQuery, '') = ''
                   OR LOWER(ar.parent_name) LIKE LOWER(CONCAT('%', :searchQuery, '%'))
                   OR LOWER(ar.parent_email) LIKE LOWER(CONCAT('%', :searchQuery, '%'))
                   OR ar.parent_mobile LIKE CONCAT('%', :searchQuery, '%')
                   OR (COALESCE(:searchUserIdsCsv, '') <> ''
                       AND ar.user_id = ANY(STRING_TO_ARRAY(:searchUserIdsCsv, ','))))
              AND (COALESCE(:leadStatusCsv, '') = ''
                   OR COALESCE(ls.status_key, ulp.conversion_status)
                      = ANY(STRING_TO_ARRAY(:leadStatusCsv, ',')))
              AND (COALESCE(:leadStatusExcludeCsv, '') = ''
                   OR COALESCE(ls.status_key, ulp.conversion_status) IS NULL
                   OR NOT (COALESCE(ls.status_key, ulp.conversion_status)
                           = ANY(STRING_TO_ARRAY(:leadStatusExcludeCsv, ','))))
              AND (COALESCE(:audienceIdsCsv, '') = ''
                   OR ar.audience_id = ANY(STRING_TO_ARRAY(:audienceIdsCsv, ',')))
              AND (COALESCE(:matchedResponseIdsCsv, '') = ''
                   OR f.audience_response_id = ANY(STRING_TO_ARRAY(:matchedResponseIdsCsv, ',')))
              AND (COALESCE(:excludedResponseIdsCsv, '') = ''
                   OR NOT (f.audience_response_id = ANY(STRING_TO_ARRAY(:excludedResponseIdsCsv, ','))))
              AND (COALESCE(:interestLevels, '') = ''
                   OR f.interest_level = ANY(STRING_TO_ARRAY(:interestLevels, CHR(31))))
            ORDER BY f.closed_at DESC
            """,
            countQuery = """
            SELECT COUNT(*) FROM lead_followup f
            LEFT JOIN audience_response ar ON ar.id = f.audience_response_id
            LEFT JOIN lead_status ls ON ls.id = ar.lead_status_id
            LEFT JOIN user_lead_profile ulp
                   ON ulp.user_id = ar.user_id AND ulp.institute_id = f.institute_id
            WHERE f.institute_id = :instituteId
              AND f.is_closed = TRUE
              AND (COALESCE(:createdByCsv, '') = ''
                   OR f.created_by = ANY(STRING_TO_ARRAY(:createdByCsv, ',')))
              AND (CAST(:closedFrom AS timestamp) IS NULL
                   OR f.closed_at >= CAST(:closedFrom AS timestamp))
              AND (CAST(:closedTo AS timestamp) IS NULL
                   OR f.closed_at < CAST(:closedTo AS timestamp))
              AND (COALESCE(:searchQuery, '') = ''
                   OR LOWER(ar.parent_name) LIKE LOWER(CONCAT('%', :searchQuery, '%'))
                   OR LOWER(ar.parent_email) LIKE LOWER(CONCAT('%', :searchQuery, '%'))
                   OR ar.parent_mobile LIKE CONCAT('%', :searchQuery, '%')
                   OR (COALESCE(:searchUserIdsCsv, '') <> ''
                       AND ar.user_id = ANY(STRING_TO_ARRAY(:searchUserIdsCsv, ','))))
              AND (COALESCE(:leadStatusCsv, '') = ''
                   OR COALESCE(ls.status_key, ulp.conversion_status)
                      = ANY(STRING_TO_ARRAY(:leadStatusCsv, ',')))
              AND (COALESCE(:leadStatusExcludeCsv, '') = ''
                   OR COALESCE(ls.status_key, ulp.conversion_status) IS NULL
                   OR NOT (COALESCE(ls.status_key, ulp.conversion_status)
                           = ANY(STRING_TO_ARRAY(:leadStatusExcludeCsv, ','))))
              AND (COALESCE(:audienceIdsCsv, '') = ''
                   OR ar.audience_id = ANY(STRING_TO_ARRAY(:audienceIdsCsv, ',')))
              AND (COALESCE(:matchedResponseIdsCsv, '') = ''
                   OR f.audience_response_id = ANY(STRING_TO_ARRAY(:matchedResponseIdsCsv, ',')))
              AND (COALESCE(:excludedResponseIdsCsv, '') = ''
                   OR NOT (f.audience_response_id = ANY(STRING_TO_ARRAY(:excludedResponseIdsCsv, ','))))
              AND (COALESCE(:interestLevels, '') = ''
                   OR f.interest_level = ANY(STRING_TO_ARRAY(:interestLevels, CHR(31))))
            """,
            nativeQuery = true)
    Page<LeadFollowup> findCompleted(@Param("instituteId") String instituteId,
                                     @Param("createdByCsv") String createdByCsv,
                                     @Param("closedFrom") Timestamp closedFrom,
                                     @Param("closedTo") Timestamp closedTo,
                                     @Param("searchQuery") String searchQuery,
                                     @Param("searchUserIdsCsv") String searchUserIdsCsv,
                                     @Param("leadStatusCsv") String leadStatusCsv,
                                     @Param("leadStatusExcludeCsv") String leadStatusExcludeCsv,
                                     @Param("audienceIdsCsv") String audienceIdsCsv,
                                     @Param("matchedResponseIdsCsv") String matchedResponseIdsCsv,
                                     @Param("excludedResponseIdsCsv") String excludedResponseIdsCsv,
                                     @Param("interestLevels") String interestLevels,
                                     Pageable pageable);

    /**
     * Leads (audience_response ids) with an OPEN follow-up whose recorded interest
     * level is one of the given values. interestLevels is joined with the ASCII
     * unit separator CHR(31), not a comma, because the levels are labels an
     * institute writes itself and may contain commas. Feeds the Follow-ups page
     * interest filter through the leads query matched-id channel, so that query
     * itself is unchanged.
     */
    @Query(value = """
            SELECT DISTINCT lf.audience_response_id FROM lead_followup lf
            WHERE lf.is_closed = FALSE
              AND (COALESCE(:instituteId, '') = '' OR lf.institute_id = :instituteId)
              AND lf.interest_level = ANY(STRING_TO_ARRAY(:interestLevels, CHR(31)))
            """, nativeQuery = true)
    List<String> findOpenResponseIdsByInterestLevels(@Param("instituteId") String instituteId,
                                                     @Param("interestLevels") String interestLevels);

    /**
     * Batch fetch of every OPEN scheduled follow-up for the given leads, oldest schedule_time first.
     * Used by the leads-list to populate the "Follow up at" column with the counsellor-scheduled
     * callback time (preferred over the SLA-derived fallback). Caller groups by audience_response_id
     * and keeps the earliest row.
     */
    @Query("SELECT lf FROM LeadFollowup lf " +
           "WHERE lf.audienceResponseId IN :ids " +
           "  AND lf.isClosed = false " +
           "  AND lf.scheduleTime IS NOT NULL " +
           "ORDER BY lf.scheduleTime ASC")
    List<LeadFollowup> findOpenByAudienceResponseIds(@Param("ids") List<String> ids);

    // ─── Scheduler scans (LeadAutomationScheduler.scanScheduledFollowups) ───

    /** PENDING follow-ups whose scheduled time has arrived (or is just past). */
    @Query("SELECT lf FROM LeadFollowup lf " +
           "WHERE lf.status = 'PENDING' AND lf.isClosed = false AND lf.scheduleTime <= :now")
    List<LeadFollowup> findDueCandidates(@Param("now") Timestamp now);

    /** ONGOING (already-due) follow-ups that have crossed the overdue threshold. */
    @Query("SELECT lf FROM LeadFollowup lf " +
           "WHERE lf.status = 'ONGOING' AND lf.isClosed = false AND lf.scheduleTime <= :overdueAt")
    List<LeadFollowup> findOverdueCandidates(@Param("overdueAt") Timestamp overdueAt);

    /**
     * Atomic PENDING → ONGOING transition. Returns 1 only for the replica that wins the
     * race, so FOLLOW_UP_DUE fires exactly once per follow-up row across replicas.
     */
    @Modifying
    @Transactional
    @Query("UPDATE LeadFollowup lf SET lf.status = 'ONGOING' " +
           "WHERE lf.id = :id AND lf.status = 'PENDING' AND lf.isClosed = false")
    int claimDueTransition(@Param("id") String id);

    /**
     * Atomic ONGOING → OVERDUE transition. Returns 1 only for the winning replica.
     */
    @Modifying
    @Transactional
    @Query("UPDATE LeadFollowup lf SET lf.status = 'OVERDUE' " +
           "WHERE lf.id = :id AND lf.status = 'ONGOING' AND lf.isClosed = false")
    int claimOverdueTransition(@Param("id") String id);

    /**
     * Undo a claim whose emission then failed, so the next scan retries it.
     *
     * <p>The claim has to happen BEFORE the emit (it is what makes the one-fire guarantee
     * hold across replicas), which means a failed emit would otherwise leave the row
     * advanced with nothing sent — and since the status only ever moves forward, that
     * follow-up's reminder would be lost permanently rather than retried. One transient
     * auth-service or workflow blip silently costs a counsellor their reminder.</p>
     *
     * <p>Retrying is safe: the workflow emission is idempotent per follow-up id
     * (eventId = the row id under EVENT_BASED dedup), so a re-run cannot double-fire the
     * workflow. Only the baseline bell alert can repeat, which is the right trade against
     * dropping it entirely.</p>
     *
     * <p>Guarded on the expected current status so a release can never drag a row
     * backwards past a transition another replica legitimately made in the meantime.</p>
     */
    @Modifying
    @Transactional
    @Query("UPDATE LeadFollowup lf SET lf.status = 'PENDING' " +
           "WHERE lf.id = :id AND lf.status = 'ONGOING' AND lf.isClosed = false")
    int releaseDueTransition(@Param("id") String id);

    /** Overdue twin of {@link #releaseDueTransition}. */
    @Modifying
    @Transactional
    @Query("UPDATE LeadFollowup lf SET lf.status = 'ONGOING' " +
           "WHERE lf.id = :id AND lf.status = 'OVERDUE' AND lf.isClosed = false")
    int releaseOverdueTransition(@Param("id") String id);
}
