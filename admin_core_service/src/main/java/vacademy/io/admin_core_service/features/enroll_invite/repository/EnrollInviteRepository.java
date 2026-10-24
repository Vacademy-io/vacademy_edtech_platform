package vacademy.io.admin_core_service.features.enroll_invite.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteWithSessionsProjection;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;

import java.util.Date;
import java.util.List;
import java.util.Optional;

@Repository
public interface EnrollInviteRepository extends JpaRepository<EnrollInvite, String> {

    Optional<EnrollInvite> findByInviteCode(String inviteCode);

    /**
     * setting_json of the institute's live invites that mention a trial at all. A cheap LIKE
     * prefilter; the JSON is parsed in Java because a jsonb cast inside a native query trips
     * over Hibernate's ":" parameter parsing, and one malformed invite must not fail the query.
     */
    @Query(value = """
            SELECT ei.setting_json FROM enroll_invite ei
            WHERE ei.institute_id = :instituteId
              AND ei.status <> 'DELETED'
              AND ei.setting_json LIKE '%TRIAL_DAYS%'
            """, nativeQuery = true)
    List<String> findTrialBearingSettingJson(@Param("instituteId") String instituteId);

    // Sub-org registration templates (tag=SUB_ORG_REGISTRATION) for the builder list.
    List<EnrollInvite> findByInstituteIdAndTagAndStatusInOrderByCreatedAtDesc(
            String instituteId, String tag, List<String> statuses);

    @Modifying
    @Transactional
    @Query("UPDATE EnrollInvite ei SET ei.status = :status WHERE ei.id IN :enrollInviteIds")
    void updateStatusByIds(@Param("enrollInviteIds") List<String> enrollInviteIds, @Param("status") String status);

    /**
     * The invite list behind the Invite page and the course-details "Invite Links"
     * dialog. Every filter is optional; {@code searchName} matches name or invite
     * code and is applied ON TOP of the package-session scope, so a search inside
     * one course's dialog never leaks invites from the rest of the institute.
     *
     * <p>Carries no ORDER BY of its own — the caller's {@link Pageable} sort is
     * appended by Spring Data (qualified to the {@code ei} alias), and
     * {@code EnrollInviteService} defaults it to {@code created_at DESC}.
     */
    @Query(value = """
    SELECT
        ei.id AS id,
        ei.name AS name,
        ei.start_date AS startDate,
        ei.end_date AS endDate,
        ei.invite_code AS inviteCode,
        ei.status AS status,
        ei.institute_id AS instituteId,
        ei.vendor AS vendor,
        ei.vendor_id AS vendorId,
        ei.currency AS currency,
        ei.tag AS tag,
        ei.web_page_meta_data_json AS webPageMetaDataJson,
        ei.created_at AS createdAt,
        ei.updated_at AS updatedAt,
        ei.created_by_user_id AS createdByUserId,
        ei.updated_by_user_id AS updatedByUserId,
        ei.short_url AS shortUrl,
        (
            SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT ps.id), NULL)
            FROM package_session_learner_invitation_to_payment_option psl
            JOIN package_session ps ON ps.id = psl.package_session_id
            WHERE psl.enroll_invite_id = ei.id
              AND psl.status != 'DELETED'
              AND (:#{#packageSessionStatuses == null || #packageSessionStatuses.isEmpty()} = true OR ps.status IN (:packageSessionStatuses))
              AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ps.id IN (:packageSessionIds))
        ) AS "packageSessionIds"
    FROM enroll_invite ei
    WHERE ei.institute_id = :instituteId
      AND (:#{#tags == null || #tags.isEmpty()} = true OR ei.tag IN (:tags))
      AND (:#{#tags == null || #tags.isEmpty()} = false OR (ei.tag IS NULL OR ei.tag NOT IN ('SUB_ORG_REGISTRATION', 'ACCESS_PASS')))
      AND (:#{#enrollInviteStatus == null || #enrollInviteStatus.isEmpty()} = true OR ei.status IN (:enrollInviteStatus))
      AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR EXISTS (
          SELECT 1 FROM package_session_learner_invitation_to_payment_option psl
          WHERE psl.enroll_invite_id = ei.id AND psl.package_session_id IN (:packageSessionIds) AND psl.status != 'DELETED'
      ))
      AND (:#{#paymentOptionIds == null || #paymentOptionIds.isEmpty()} = true OR EXISTS (
          SELECT 1 FROM package_session_learner_invitation_to_payment_option psl
          WHERE psl.enroll_invite_id = ei.id AND psl.payment_option_id IN (:paymentOptionIds) AND psl.status != 'DELETED'
      ))
      AND (:#{#searchName == null || #searchName.isBlank()} = true
           OR LOWER(ei.name) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%'))
           OR LOWER(ei.invite_code) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%')))
    """,
            countQuery = """
    SELECT COUNT(*)
    FROM enroll_invite ei
    WHERE ei.institute_id = :instituteId
      AND (:#{#tags == null || #tags.isEmpty()} = true OR ei.tag IN (:tags))
      AND (:#{#tags == null || #tags.isEmpty()} = false OR (ei.tag IS NULL OR ei.tag NOT IN ('SUB_ORG_REGISTRATION', 'ACCESS_PASS')))
      AND (:#{#enrollInviteStatus == null || #enrollInviteStatus.isEmpty()} = true OR ei.status IN (:enrollInviteStatus))
      AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR EXISTS (
          SELECT 1 FROM package_session_learner_invitation_to_payment_option psl
          WHERE psl.enroll_invite_id = ei.id AND psl.package_session_id IN (:packageSessionIds) AND psl.status != 'DELETED'
      ))
      AND (:#{#paymentOptionIds == null || #paymentOptionIds.isEmpty()} = true OR EXISTS (
          SELECT 1 FROM package_session_learner_invitation_to_payment_option psl
          WHERE psl.enroll_invite_id = ei.id AND psl.payment_option_id IN (:paymentOptionIds) AND psl.status != 'DELETED'
      ))
      AND (:#{#searchName == null || #searchName.isBlank()} = true
           OR LOWER(ei.name) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%'))
           OR LOWER(ei.invite_code) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%')))
    """,
            nativeQuery = true)
    Page<EnrollInviteWithSessionsProjection> getEnrollInvitesWithFilters(
            @Param("instituteId") String instituteId,
            @Param("packageSessionIds") List<String> packageSessionIds,
            @Param("paymentOptionIds") List<String> paymentOptionIds,
            @Param("tags") List<String> tags,
            @Param("enrollInviteStatus") List<String> enrollInviteStatus,
            @Param("packageSessionStatuses") List<String> packageSessionStatuses,
            @Param("searchName") String searchName,
            Pageable pageable
    );

    @Query(value = "SELECT " +
            "ei.id as \"id\", ei.name as \"name\", ei.end_date as \"endDate\", ei.start_date as \"startDate\", ei.invite_code as \"inviteCode\", " +
            "ei.status as \"status\", ei.institute_id as \"instituteId\", ei.vendor as \"vendor\", ei.vendor_id as \"vendorId\", " +
            "ei.currency as \"currency\", ei.tag as \"tag\", ei.web_page_meta_data_json as \"webPageMetaDataJson\", " +
            "ei.created_at as \"createdAt\", ei.updated_at as \"updatedAt\", ei.short_url as \"shortUrl\", " +
            "ei.created_by_user_id as \"createdByUserId\", ei.updated_by_user_id as \"updatedByUserId\", " +
            "ARRAY_REMOVE(ARRAY_AGG(DISTINCT ps.id), NULL) as \"packageSessionIds\" " +
            "FROM enroll_invite ei " +
            "LEFT JOIN package_session_learner_invitation_to_payment_option psl ON ei.id = psl.enroll_invite_id " +
            "LEFT JOIN package_session ps ON psl.package_session_id = ps.id " +
            "WHERE ei.institute_id = :instituteId " +
            "AND (ei.tag IS NULL OR ei.tag NOT IN ('SUB_ORG_REGISTRATION', 'ACCESS_PASS')) " +
            "AND (COALESCE(:enrollInviteStatus, NULL) IS NULL OR ei.status IN (:enrollInviteStatus)) " +
            "AND (CAST(:searchName AS text) IS NULL OR CAST(:searchName AS text) = '' OR " +
            "     LOWER(ei.name) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%')) OR " +
            "     LOWER(ei.invite_code) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%'))) " +
            "AND (COALESCE(:packageSessionStatuses, NULL) IS NULL OR ps.status IN (:packageSessionStatuses)) " +
            "GROUP BY ei.id",
            countQuery = "SELECT COUNT(DISTINCT ei.id) FROM enroll_invite ei " +
                    "LEFT JOIN package_session_learner_invitation_to_payment_option psl ON ei.id = psl.enroll_invite_id " +
                    "LEFT JOIN package_session ps ON psl.package_session_id = ps.id " +
                    "WHERE ei.institute_id = :instituteId " +
                    "AND (ei.tag IS NULL OR ei.tag NOT IN ('SUB_ORG_REGISTRATION', 'ACCESS_PASS')) " +
                    "AND (COALESCE(:enrollInviteStatus, NULL) IS NULL OR ei.status IN (:enrollInviteStatus)) " +
                    "AND (CAST(:searchName AS text) IS NULL OR CAST(:searchName AS text) = '' OR " +
                    "     LOWER(ei.name) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%')) OR " +
                    "     LOWER(ei.invite_code) LIKE LOWER(CONCAT('%', CAST(:searchName AS text), '%'))) " +
                    "AND (COALESCE(:packageSessionStatuses, NULL) IS NULL OR ps.status IN (:packageSessionStatuses))",
            nativeQuery = true)
    Page<EnrollInviteWithSessionsProjection> getEnrollInvitesByInstituteIdAndSearchName(
            @Param("instituteId") String instituteId,
            @Param("searchName") String searchName,
            @Param("enrollInviteStatus") List<String> enrollInviteStatus,
            @Param("packageSessionStatuses") List<String> packageSessionStatuses,
            Pageable pageable
    );

    @Query(value = """
        SELECT ei.*
        FROM enroll_invite ei
        INNER JOIN package_session_learner_invitation_to_payment_option m
            ON m.enroll_invite_id = ei.id
        WHERE m.package_session_id = :packageSessionId
          AND ei.status IN (:enrollInviteStatusList)
          AND ei.tag IN (:tagList)
          AND m.status IN (:mappingStatusList)
        ORDER BY ei.created_at DESC
        LIMIT 1
    """, nativeQuery = true)
    Optional<EnrollInvite> findLatestForPackageSessionWithFilters(
            @Param("packageSessionId") String packageSessionId,
            @Param("enrollInviteStatusList") List<String> enrollInviteStatusList,
            @Param("tagList") List<String> tagList,
            @Param("mappingStatusList") List<String> mappingStatusList
    );

    @Query("SELECT ei FROM EnrollInvite ei " +
            "WHERE ei.status IN :statusList " +
            "AND ei.instituteId = :instituteId " +
            "AND ei.inviteCode = :inviteCode")
    Optional<EnrollInvite> findValidEnrollInvite(
            @Param("statusList") List<String> statusList,
            @Param("instituteId") String instituteId,
            @Param("inviteCode") String inviteCode);

    @Query(value = """
    SELECT DISTINCT ei.*
    FROM enroll_invite ei
    INNER JOIN package_session_learner_invitation_to_payment_option pslipo
        ON pslipo.enroll_invite_id = ei.id
    INNER JOIN student_session_institute_group_mapping ssigm
        ON ssigm.package_session_id = pslipo.package_session_id
    WHERE ssigm.user_id = :userId
      AND ssigm.institute_id = :instituteId
      AND ssigm.status IN (:ssigmActiveStatuses)
      AND pslipo.status IN (:packageSessionMappingActiveStatuses)
      AND ei.status IN (:enrollInviteActiveStatuses)
      AND ei.tag = 'DEFAULT'
    ORDER BY ei.created_at DESC
""", nativeQuery = true)
    List<EnrollInvite> findDefaultEnrollInvitesForStudent(
            @Param("userId") String userId,
            @Param("instituteId") String instituteId,
            @Param("ssigmActiveStatuses") List<String> ssigmActiveStatuses,
            @Param("enrollInviteActiveStatuses") List<String> enrollInviteActiveStatuses,
            @Param("packageSessionMappingActiveStatuses") List<String> packageSessionMappingActiveStatuses
    );

    @Query(value = """
        SELECT ei.* FROM enroll_invite ei
        WHERE ei.sub_org_id = :subOrgId
        AND ei.tag = 'SUB_ORG'
        AND ei.status IN (:statuses)
        AND ei.institute_id = :instituteId
        ORDER BY ei.created_at DESC
    """, nativeQuery = true)
    List<EnrollInvite> findBySubOrgIdAndInstituteId(
            @Param("subOrgId") String subOrgId,
            @Param("instituteId") String instituteId,
            @Param("statuses") List<String> statuses);

    /**
     * Every invite a sub-org owns, across the given tags. Unlike
     * {@link #findBySubOrgIdAndInstituteId} this is not pinned to tag='SUB_ORG', so the
     * re-sync backfill can reach SUBORG_LEARNER mirrors too when re-applying the
     * institute's current Naming Settings terminology to already-created invite names.
     */
    @Query(value = """
        SELECT ei.* FROM enroll_invite ei
        WHERE ei.sub_org_id = :subOrgId
        AND ei.institute_id = :instituteId
        AND ei.tag IN (:tags)
        AND ei.status IN (:statuses)
        ORDER BY ei.created_at DESC
    """, nativeQuery = true)
    List<EnrollInvite> findBySubOrgIdAndInstituteIdAndTags(
            @Param("subOrgId") String subOrgId,
            @Param("instituteId") String instituteId,
            @Param("tags") List<String> tags,
            @Param("statuses") List<String> statuses);

    @Query(value = """
        SELECT ei.* FROM enroll_invite ei
        JOIN package_session_learner_invitation_to_payment_option pslipo
          ON pslipo.enroll_invite_id = ei.id
        WHERE ei.sub_org_id = :subOrgId
        AND ei.tag = 'SUB_ORG'
        AND pslipo.package_session_id = :packageSessionId
        AND ei.status = 'ACTIVE'
        ORDER BY ei.created_at DESC LIMIT 1
    """, nativeQuery = true)
    Optional<EnrollInvite> findScopedInviteForSubOrgAndPackageSession(
            @Param("subOrgId") String subOrgId,
            @Param("packageSessionId") String packageSessionId);

    @Query(value = """
        SELECT DISTINCT ei.id FROM enroll_invite ei
        JOIN package_session_learner_invitation_to_payment_option pslipo
          ON pslipo.enroll_invite_id = ei.id
        WHERE ei.sub_org_id = :subOrgId
        AND pslipo.package_session_id = :packageSessionId
        AND ei.status = 'ACTIVE'
    """, nativeQuery = true)
    List<String> findInviteIdsForSubOrgAndPackageSession(
            @Param("subOrgId") String subOrgId,
            @Param("packageSessionId") String packageSessionId);

    @Query("SELECT ei FROM EnrollInvite ei WHERE ei.instituteId = :instituteId AND ei.status = :status")
    List<EnrollInvite> findByInstituteIdAndStatus(
            @Param("instituteId") String instituteId,
            @Param("status") String status);

    @Query("SELECT ei FROM EnrollInvite ei WHERE ei.instituteId = :instituteId")
    List<EnrollInvite> findByInstituteId(@Param("instituteId") String instituteId);
}
