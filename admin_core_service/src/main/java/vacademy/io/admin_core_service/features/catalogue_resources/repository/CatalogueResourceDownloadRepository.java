package vacademy.io.admin_core_service.features.catalogue_resources.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.catalogue_resources.entity.CatalogueResourceDownload;

import java.sql.Timestamp;
import java.util.List;

/**
 * Freebie downloads: the lead lookup used when recording one, and the
 * aggregates behind the admin report.
 *
 * The audience filter on the report queries narrows to leads whose response
 * belongs to that list, so a list page shows only its own people.
 */
@Repository
public interface CatalogueResourceDownloadRepository extends JpaRepository<CatalogueResourceDownload, String> {

    /**
     * Newest lead in the institute with this email. A response in the gate list
     * itself wins over one in another list. Uses the lower-trim email index.
     */
    @Query(value = """
            SELECT ar.id, ar.user_id
              FROM audience_response ar
              JOIN audience a ON a.id = ar.audience_id
             WHERE LOWER(TRIM(ar.parent_email)) = LOWER(TRIM(CAST(:email AS text)))
               AND ar.parent_email IS NOT NULL
               AND a.institute_id = :instituteId
               AND (ar.is_duplicate IS NULL OR ar.is_duplicate = false)
             ORDER BY CASE WHEN ar.audience_id = CAST(:audienceId AS text) THEN 0 ELSE 1 END,
                      ar.created_at DESC
             LIMIT 1
            """, nativeQuery = true)
    List<Object[]> findLeadByEmail(@Param("instituteId") String instituteId,
                                   @Param("audienceId") String audienceId,
                                   @Param("email") String email);

    /**
     * Phone fallback, scoped to one list so it stays on the audience_id index
     * (phone numbers are stored in many formats, so this compares last 10 digits).
     */
    @Query(value = """
            SELECT ar.id, ar.user_id
              FROM audience_response ar
             WHERE ar.audience_id = :audienceId
               AND ar.parent_mobile IS NOT NULL
               AND RIGHT(regexp_replace(ar.parent_mobile, '[^0-9]', '', 'g'), 10) = :last10
               AND (ar.is_duplicate IS NULL OR ar.is_duplicate = false)
             ORDER BY ar.created_at DESC
             LIMIT 1
            """, nativeQuery = true)
    List<Object[]> findLeadByPhone(@Param("audienceId") String audienceId,
                                   @Param("last10") String last10);

    @Query(value = """
            SELECT a.id
              FROM audience a
             WHERE a.id = :audienceId
               AND a.institute_id = :instituteId
            """, nativeQuery = true)
    List<String> audienceInInstitute(@Param("audienceId") String audienceId,
                                     @Param("instituteId") String instituteId);

    /** Repeat-click guard: the same lead opening the same file again shortly after. */
    @Query(value = """
            SELECT COUNT(*)
              FROM catalogue_resource_download d
             WHERE d.audience_response_id = :responseId
               AND d.resource_url = :url
               AND d.created_at >= :since
            """, nativeQuery = true)
    long countRecent(@Param("responseId") String responseId,
                     @Param("url") String url,
                     @Param("since") Timestamp since);

    /** Every freebie one lead opened, newest first. */
    @Query(value = """
            SELECT d.resource_title, d.resource_url, d.created_at
              FROM catalogue_resource_download d
             WHERE d.user_id = :userId
               AND d.institute_id = :instituteId
             ORDER BY d.created_at DESC
             LIMIT 200
            """, nativeQuery = true)
    List<Object[]> forLead(@Param("instituteId") String instituteId,
                           @Param("userId") String userId);

    /** Total downloads and distinct leads. */
    @Query(value = """
            SELECT COUNT(*), COUNT(DISTINCT d.audience_response_id)
              FROM catalogue_resource_download d
             WHERE d.institute_id = :instituteId
               AND d.created_at >= :from
               AND (CAST(:audienceId AS text) IS NULL
                    OR d.audience_response_id IN (
                        SELECT ar.id FROM audience_response ar
                         WHERE ar.audience_id = CAST(:audienceId AS text)))
            """, nativeQuery = true)
    List<Object[]> totals(@Param("instituteId") String instituteId,
                          @Param("audienceId") String audienceId,
                          @Param("from") Timestamp from);

    /** Per file. The title shown is the newest one, since a card title can be edited. */
    @Query(value = """
            SELECT d.resource_url,
                   (ARRAY_AGG(d.resource_title ORDER BY d.created_at DESC))[1] AS title,
                   COUNT(*) AS downloads,
                   COUNT(DISTINCT d.audience_response_id) AS leads,
                   MAX(d.created_at) AS last_at
              FROM catalogue_resource_download d
             WHERE d.institute_id = :instituteId
               AND d.created_at >= :from
               AND (CAST(:audienceId AS text) IS NULL
                    OR d.audience_response_id IN (
                        SELECT ar.id FROM audience_response ar
                         WHERE ar.audience_id = CAST(:audienceId AS text)))
             GROUP BY d.resource_url
             ORDER BY downloads DESC, last_at DESC
             LIMIT 200
            """, nativeQuery = true)
    List<Object[]> byResource(@Param("instituteId") String instituteId,
                              @Param("audienceId") String audienceId,
                              @Param("from") Timestamp from);

    /**
     * Per lead, most downloads first. Titles come back joined by CHR(31) (unit
     * separator, never typed into a title) and newest first.
     */
    @Query(value = """
            SELECT d.audience_response_id,
                   MAX(ar.user_id) AS user_id,
                   MAX(ar.parent_name) AS parent_name,
                   MAX(ar.parent_email) AS parent_email,
                   MAX(ar.parent_mobile) AS parent_mobile,
                   MAX(a.campaign_name) AS campaign_name,
                   COUNT(*) AS downloads,
                   STRING_AGG(COALESCE(NULLIF(d.resource_title, ''), d.resource_url), CHR(31)
                              ORDER BY d.created_at DESC) AS titles,
                   MAX(d.created_at) AS last_at
              FROM catalogue_resource_download d
              JOIN audience_response ar ON ar.id = d.audience_response_id
              JOIN audience a ON a.id = ar.audience_id
             WHERE d.institute_id = :instituteId
               AND d.created_at >= :from
               AND (CAST(:audienceId AS text) IS NULL OR ar.audience_id = CAST(:audienceId AS text))
             GROUP BY d.audience_response_id
             ORDER BY downloads DESC, last_at DESC
             LIMIT 500
            """, nativeQuery = true)
    List<Object[]> byLead(@Param("instituteId") String instituteId,
                          @Param("audienceId") String audienceId,
                          @Param("from") Timestamp from);
}
