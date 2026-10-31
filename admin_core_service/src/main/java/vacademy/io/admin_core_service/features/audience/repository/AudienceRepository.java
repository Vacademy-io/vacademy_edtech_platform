package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.Audience;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

/**
 * Repository for Audience (Campaign) entities
 */
@Repository
public interface AudienceRepository extends JpaRepository<Audience, String> {

    /** Lists of an institute with this exact name (case-insensitive), any status. */
    List<Audience> findByInstituteIdAndCampaignNameIgnoreCase(String instituteId, String campaignName);

    /**
     * Bulk id -> campaign name, for screens that show which campaign a row came from
     * without needing the audience itself. Two-column projection: the queue resolves
     * these for a whole page at once and has no use for the rest of the row.
     */
    @Query(value = "SELECT a.id, a.campaign_name FROM audience a WHERE a.id IN (:ids)",
            nativeQuery = true)
    List<Object[]> findIdAndCampaignNameByIds(@Param("ids") java.util.Collection<String> ids);


    /**
     * Atomically claim the right to start a bulk AI-call campaign for this audience:
     * stamps {@code last_ai_campaign_started_at = now()} only if no run was started
     * within {@code cooldownSec}. Returns 1 when claimed (proceed), 0 when a run was
     * started recently (reject) — a single conditional UPDATE, so it's race-safe
     * across pods and doubles as the "don't re-dial the whole list twice" guard.
     * Own transaction so the marker commits before the async dispatch begins.
     */
    @Transactional
    @Modifying
    @Query(value = "UPDATE audience SET last_ai_campaign_started_at = now() "
            + "WHERE id = :audienceId AND (last_ai_campaign_started_at IS NULL "
            + "OR last_ai_campaign_started_at < now() - (:cooldownSec * interval '1 second'))",
            nativeQuery = true)
    int tryClaimAiCampaign(@Param("audienceId") String audienceId,
                           @Param("cooldownSec") long cooldownSec);

    /**
     * Release a claim taken by {@link #tryClaimAiCampaign} when the run never actually
     * started (the dispatch pool refused the submission). Without this the audience
     * stays locked for the whole cooldown window having placed ZERO calls, and the
     * rejection message wrongly tells the user a bulk run is already in progress.
     *
     * <p>Clearing to NULL rather than restoring the prior value is equivalent for
     * gating — the previous value was either NULL or already older than the cooldown,
     * so both allow an immediate re-claim — and nothing else reads this column.
     */
    @Transactional
    @Modifying
    @Query(value = "UPDATE audience SET last_ai_campaign_started_at = NULL WHERE id = :audienceId",
            nativeQuery = true)
    void releaseAiCampaignClaim(@Param("audienceId") String audienceId);

    /**
     * Find all campaigns for a specific institute
     */
    List<Audience> findByInstituteId(String instituteId);

    /**
     * (id, tags_json) of every non-deleted list in the institute that has tags, for the
     * tag autocomplete summary. Two columns only: the summary needs nothing else.
     */
    @Query("SELECT a.id, a.tagsJson FROM Audience a "
            + "WHERE a.instituteId = :instituteId AND a.tagsJson IS NOT NULL "
            + "AND (a.status IS NULL OR a.status <> 'DELETED')")
    List<Object[]> findIdAndTagsJsonByInstituteId(@Param("instituteId") String instituteId);

    /**
     * Writes only the tags column, so saving tags never overwrites a concurrent edit of the
     * rest of the list. Scoped to the institute; returns the number of rows updated.
     */
    @Modifying
    @Query("UPDATE Audience a SET a.tagsJson = :tagsJson "
            + "WHERE a.id = :audienceId AND a.instituteId = :instituteId")
    int updateTagsJson(@Param("audienceId") String audienceId,
                       @Param("instituteId") String instituteId,
                       @Param("tagsJson") String tagsJson);

    /**
     * Find all campaigns for a specific institute with status filter
     */
    List<Audience> findByInstituteIdAndStatus(String instituteId, String status);

    /**
     * Find campaign by ID and institute ID (for security/isolation)
     */
    Optional<Audience> findByIdAndInstituteId(String id, String instituteId);

    /**
     * Find campaign by institute ID and session ID (for manual applications)
     */
    Optional<Audience> findByInstituteIdAndSessionId(String instituteId, String sessionId);

    /**
     * Find the (first) campaign for an institute by exact campaign name. Used to
     * resolve the auto-provisioned "Course Catalogue Leads" audience so public
     * catalogue lead submissions all land on a single per-institute campaign.
     */
    Optional<Audience> findFirstByInstituteIdAndCampaignName(String instituteId, String campaignName);

    /**
     * The oldest campaign of a given type and status for an institute. Used to resolve the
     * auto-provisioned "WhatsApp Leads" list by its type rather than its name, so an admin
     * renaming the list does not make the next chatbot lead create a second one.
     */
    Optional<Audience> findFirstByInstituteIdAndCampaignTypeAndStatusOrderByCreatedAtAsc(
            String instituteId, String campaignType, String status);

    /**
     * Find active campaigns for an institute
     */
    @Query("SELECT a FROM Audience a " +
            "WHERE a.instituteId = :instituteId " +
            "AND a.status = 'ACTIVE' " +
            "AND (a.startDate IS NULL OR a.startDate <= :currentTime) " +
            "AND (a.endDate IS NULL OR a.endDate >= :currentTime)")
    List<Audience> findActiveAudiencesForInstitute(
            @Param("instituteId") String instituteId,
            @Param("currentTime") Timestamp currentTime);

    /**
     * Find campaigns with filters and pagination.
     *
     * <p>{@code allowedAudienceIds} narrows the result to a subset of campaigns
     * — used by the AUDIENCE_LIST role-access mode. {@code restrictByAllowedIds}
     * is the on/off flag (JPQL doesn't gracefully handle null collections).
     */
    @Query("""
                SELECT a FROM Audience a
                WHERE a.instituteId = :instituteId
                  AND (a.status IS NULL OR a.status <> 'DELETED')
                  AND (:status IS NULL OR a.status = :status)
                  AND (COALESCE(:campaignType, '') = '' OR
                       LOWER(a.campaignType) LIKE LOWER(CONCAT('%', :campaignType, '%')))
                  AND (COALESCE(:searchName, '') = '' OR
                       LOWER(a.campaignName) LIKE LOWER(CONCAT('%', :searchName, '%')))
                  AND (COALESCE(:subOrgId, '') = '' OR a.subOrgId = :subOrgId)
                  AND (:startDateFromProvided = false OR a.startDate IS NULL OR a.startDate >= :startDateFrom)
                  AND (:startDateToProvided = false OR a.startDate IS NULL OR a.startDate <= :startDateTo)
                  AND (:restrictByAllowedIds = false OR a.id IN :allowedAudienceIds)
                ORDER BY a.createdAt DESC
            """)
    Page<Audience> findAudiencesWithFilters(
            @Param("instituteId") String instituteId,
            @Param("status") String status,
            @Param("campaignType") String campaignType,
            @Param("searchName") String searchName,
            @Param("subOrgId") String subOrgId,
            @Param("startDateFrom") Timestamp startDateFrom,
            @Param("startDateFromProvided") boolean startDateFromProvided,
            @Param("startDateTo") Timestamp startDateTo,
            @Param("startDateToProvided") boolean startDateToProvided,
            @Param("allowedAudienceIds") List<String> allowedAudienceIds,
            @Param("restrictByAllowedIds") boolean restrictByAllowedIds,
            Pageable pageable);

    /**
     * Count campaigns by institute and status
     */
    Long countByInstituteIdAndStatus(String instituteId, String status);

    /**
     * Find all audience IDs for a specific institute
     */
    @Query("SELECT a.id FROM Audience a WHERE a.instituteId = :instituteId")
    List<String> findAllAudienceIdsByInstituteId(@Param("instituteId") String instituteId);

    /**
     * Find audience IDs with filters for combined users API
     */
    @Query("""
                SELECT a.id FROM Audience a
                WHERE a.instituteId = :instituteId
                  AND (COALESCE(:campaignName, '') = '' OR
                       LOWER(a.campaignName) LIKE LOWER(CONCAT('%', :campaignName, '%')))
                  AND (COALESCE(:status, '') = '' OR a.status = :status)
                  AND (COALESCE(:campaignType, '') = '' OR a.campaignType = :campaignType)
                  AND (:startDateFromProvided = false OR a.startDate IS NULL OR a.startDate >= :startDateFrom)
                  AND (:startDateToProvided = false OR a.startDate IS NULL OR a.startDate <= :startDateTo)
            """)
    List<String> findAudienceIdsWithFilters(
            @Param("instituteId") String instituteId,
            @Param("campaignName") String campaignName,
            @Param("status") String status,
            @Param("campaignType") String campaignType,
            @Param("startDateFrom") Timestamp startDateFrom,
            @Param("startDateFromProvided") boolean startDateFromProvided,
            @Param("startDateTo") Timestamp startDateTo,
            @Param("startDateToProvided") boolean startDateToProvided);

    /**
     * Get center heatmap data by fetching audience campaigns and their response counts,
     * including opt-out user count per center (users who appeared in any OPT_OUT campaign
     * AND had a response in this center's audience).
     *
     * @param instituteId Institute ID to filter audiences
     * @param startDate   Optional start date filter (empty string for no filter)
     * @param endDate     Optional end date filter (empty string for no filter)
     * @param status      Optional status filter (empty string for all statuses)
     * @return List of Object arrays containing:
     *         [0] audience_id (String)
     *         [1] campaign_name (String)
     *         [2] campaign_type (String)
     *         [3] description (String)
     *         [4] campaign_objective (String)
     *         [5] status (String)
     *         [6] start_date (Timestamp)
     *         [7] end_date (Timestamp)
     *         [8] unique_users (Long)
     *         [9] total_responses (Long)
     *         [10] opted_out_users (Long)
     */
    @Query(value = """
            SELECT
                a.id,
                a.campaign_name,
                a.campaign_type,
                a.description,
                a.campaign_objective,
                a.status,
                a.start_date,
                a.end_date,
                COUNT(DISTINCT ar.user_id) as unique_users,
                COUNT(ar.id) as total_responses,
                COUNT(DISTINCT CASE WHEN opt_users.user_id IS NOT NULL THEN ar.user_id END) as opted_out_users
            FROM audience a
            LEFT JOIN audience_response ar ON ar.audience_id = a.id
                AND (COALESCE(:startDate, '') = '' OR ar.created_at >= CAST(:startDate AS TIMESTAMP))
                AND (COALESCE(:endDate, '') = '' OR ar.created_at <= CAST(:endDate AS TIMESTAMP))
            LEFT JOIN (
                SELECT DISTINCT opt_ar.user_id
                FROM audience_response opt_ar
                JOIN audience opt_a ON opt_a.id = opt_ar.audience_id
                    AND opt_a.campaign_type LIKE '%OPT_OUT%'
                    AND opt_a.institute_id = :instituteId
            ) opt_users ON opt_users.user_id = ar.user_id
            WHERE a.institute_id = :instituteId
                AND (COALESCE(:status, '') = '' OR a.status = :status)
                -- Exclude centers an admin has switched off (INACTIVE) or removed
                -- (DELETED) so they drop out of the heatmap and center dropdowns.
                -- Status is the explicit on/off switch: a live center with zero
                -- leads in the selected window still shows because it stays ACTIVE.
                AND UPPER(TRIM(a.status)) NOT IN ('INACTIVE', 'DELETED')
            GROUP BY a.id, a.campaign_name, a.campaign_type, a.description,
                     a.campaign_objective, a.status, a.start_date, a.end_date
            ORDER BY COUNT(ar.id) DESC
            """, nativeQuery = true)
    List<Object[]> getCenterHeatmapByInstitute(
            @Param("instituteId") String instituteId,
            @Param("startDate") String startDate,
            @Param("endDate") String endDate,
            @Param("status") String status);

    /**
     * Find the dedicated opt-out audience for an institute.
     * The opt-out audience must have campaign_type containing 'OPT_OUT'.
     */
    @Query("SELECT a FROM Audience a WHERE a.instituteId = :instituteId AND a.campaignType LIKE '%OPT_OUT%'")
    Optional<Audience> findOptOutAudienceByInstituteId(@Param("instituteId") String instituteId);
}
