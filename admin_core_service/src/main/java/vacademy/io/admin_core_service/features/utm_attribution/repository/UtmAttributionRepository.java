package vacademy.io.admin_core_service.features.utm_attribution.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.utm_attribution.entity.UtmAttribution;

import java.sql.Timestamp;
import java.util.List;

@Repository
public interface UtmAttributionRepository extends JpaRepository<UtmAttribution, String> {

    /**
     * Latest UTM row per user for a page of leads, so the leads table can show where a
     * lead was tagged from without a query per row. DISTINCT ON keeps the most recent
     * row when a user was tagged more than once.
     */
    @Query(value = """
                SELECT DISTINCT ON (u.user_id)
                       u.user_id, u.utm_source, u.utm_campaign
                  FROM utm_attribution u
                 WHERE u.institute_id = :instituteId
                   AND u.user_id IN (:userIds)
                 ORDER BY u.user_id, u.created_at DESC
            """, nativeQuery = true)
    List<Object[]> findLatestForUsers(@Param("instituteId") String instituteId,
                                      @Param("userIds") java.util.Collection<String> userIds);


    /**
     * Every touch for one person, oldest first.
     *
     * Matches on user_id OR the contact details, because three of the six
     * capture surfaces (audience form, live session, catalogue) never learn an
     * auth user id at submit time — they only have the email/mobile the visitor
     * typed. Keying the read on user_id alone made those rows unreachable
     * forever, which meant the learner side-view was permanently empty for
     * exactly the lead-generation surfaces the feature exists to measure.
     *
     * The contact fallback deliberately applies ONLY to rows that have no
     * user_id yet. A row already claimed by a user belongs to that user, and
     * matching it by shared contact details would hand one learner another's
     * history — families routinely register siblings on ONE parent mobile, so
     * that is the normal case here, not an edge case.
     *
     * NOTE ON LOWER(): the function is applied to the COLUMN only, never to the
     * bound parameter. Hibernate cannot infer a type for a null parameter that
     * sits inside a function call, binds it as untyped, and PostgreSQL then
     * resolves lower(untyped-null) to lower(bytea) — which does not exist, so
     * the whole statement fails. Callers pass an already-lowercased email.
     */
    @Query("""
            SELECT u FROM UtmAttribution u
            WHERE u.instituteId = :instituteId
              AND ((:userId IS NOT NULL AND u.userId = :userId)
                   OR (u.userId IS NULL AND :email IS NOT NULL AND LOWER(u.email) = :email)
                   OR (u.userId IS NULL AND :mobileNumber IS NOT NULL
                       AND u.mobileNumber = :mobileNumber))
            ORDER BY u.createdAt ASC
            """)
    List<UtmAttribution> findForLearner(@Param("instituteId") String instituteId,
                                        @Param("userId") String userId,
                                        @Param("email") String email,
                                        @Param("mobileNumber") String mobileNumber);

    /**
     * Guard against the same submission being recorded twice — a double-clicked
     * form, or a retry after a network blip. Keyed on the campaign tuple rather
     * than on time alone, so a genuine second touch from a DIFFERENT campaign is
     * still recorded.
     *
     * The identity disjunction covers all three shapes a caller can have:
     * a user id, an email, or (phone-identity institutes) a mobile number only.
     * Omitting the mobile branch made the whole predicate false for phone-only
     * leads, so they were never de-duplicated at all.
     */
    @Query("""
            SELECT COUNT(u) FROM UtmAttribution u
            WHERE u.instituteId = :instituteId
              AND u.sourceType = :sourceType
              AND u.createdAt > :since
              AND ((:userId IS NOT NULL AND u.userId = :userId)
                   OR (:userId IS NULL AND :email IS NOT NULL AND LOWER(u.email) = :email)
                   OR (:userId IS NULL AND :email IS NULL AND :mobileNumber IS NOT NULL
                       AND u.mobileNumber = :mobileNumber))
              AND (:sourceId IS NULL OR u.sourceId = :sourceId)
              AND (:utmCampaign IS NULL OR u.utmCampaign = :utmCampaign)
              AND (:utmSource IS NULL OR u.utmSource = :utmSource)
            """)
    long countRecentDuplicates(@Param("instituteId") String instituteId,
                               @Param("userId") String userId,
                               @Param("email") String email,
                               @Param("mobileNumber") String mobileNumber,
                               @Param("sourceType") String sourceType,
                               @Param("sourceId") String sourceId,
                               @Param("utmCampaign") String utmCampaign,
                               @Param("utmSource") String utmSource,
                               @Param("since") Timestamp since);

    /** Campaign roll-up for the reporting endpoint. */
    @Query("""
            SELECT u.utmSource, u.utmMedium, u.utmCampaign, u.sourceType, COUNT(u)
            FROM UtmAttribution u
            WHERE u.instituteId = :instituteId
              AND u.createdAt >= :from
              AND u.createdAt < :to
            GROUP BY u.utmSource, u.utmMedium, u.utmCampaign, u.sourceType
            ORDER BY COUNT(u) DESC
            """)
    List<Object[]> summarise(@Param("instituteId") String instituteId,
                             @Param("from") Timestamp from,
                             @Param("to") Timestamp to);
}
