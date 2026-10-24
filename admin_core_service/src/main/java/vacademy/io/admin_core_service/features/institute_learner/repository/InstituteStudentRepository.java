package vacademy.io.admin_core_service.features.institute_learner.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute_learner.dto.projection.StudentListV2Projection;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public interface InstituteStudentRepository extends CrudRepository<Student, String>, InstituteStudentRepositoryCustom {

  /**
   * Find all distinct user IDs for a specific institute
   */
  @Query(value = "SELECT DISTINCT ssigm.user_id FROM student_session_institute_group_mapping ssigm " +
      "WHERE ssigm.institute_id = :instituteId", nativeQuery = true)
  List<String> findDistinctUserIdsByInstituteId(@Param("instituteId") String instituteId);

  List<Student> findByUserIdIn(List<String> userIds);

  /** Guardian-linking backfill preview: students in this set with no guardian linked yet. */
  List<Student> findByUserIdInAndGuardianUserIdIsNull(List<String> userIds);

  /**
   * Guardian-linking eligibility pre-filter: candidates in this set PROVEN to
   * already have a guardian locally — i.e. an exclude-list, never an
   * allow-list. Candidates with no local {@code student} row at all (leads
   * that were never enrolled have none) must NOT be inferred as "already
   * linked" just because they're absent here; only use this to subtract
   * known-linked ids from a candidate set, never to replace it.
   */
  List<Student> findByUserIdInAndGuardianUserIdIsNotNull(List<String> userIds);

  /**
   * Stamps the denormalized guardian pointer once a link succeeds (assignment-time
   * link, link-new-guardian, or backfill). Bulk-by-userId since a user can have more
   * than one student row (findByUserId returns a List, not Optional) — every row for
   * this user gets the same guardian.
   */
  @Modifying
  @Transactional
  @Query("UPDATE Student s SET s.guardianUserId = :guardianUserId WHERE s.userId = :userId")
  void updateGuardianUserId(@Param("userId") String userId, @Param("guardianUserId") String guardianUserId);

  /**
   * Re-points the denormalized username after auth_service changed
   * {@code users.username}. Bulk-by-userId for the same reason as
   * {@link #updateGuardianUserId}: one user can own several student rows, and
   * every one of them carries its own copy. The older profile-edit path
   * ({@code LearnerService.updateLearnerDetail}) uses {@code findTopByUserId}
   * and so only ever fixed the most recent row — a rename that went through
   * that path alone left the other rows showing a username that can no longer
   * log in.
   *
   * <p>Indexed by {@code student_unique UNIQUE (user_id, username)}, whose
   * leading column is user_id, so this stays an index scan.
   *
   * @return number of student rows updated
   */
  @Modifying
  @Transactional
  @Query("UPDATE Student s SET s.username = :username WHERE s.userId = :userId")
  int updateUsernameByUserId(@Param("userId") String userId, @Param("username") String username);

  @Query(value = "SELECT DISTINCT s.* FROM student s LEFT JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id "
      +
      "WHERE (:statuses IS NULL OR ssigm.status IN (:statuses)) " +
      "AND (:gender IS NULL OR s.gender IN (:gender)) " +
      "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds)) " +
      "AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds)) " +
      "AND (:packageSessionIds IS NULL OR ssigm.package_session_id IN (:packageSessionIds))", countQuery = "SELECT COUNT(DISTINCT s.id) FROM student s LEFT JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id "
          +
          "WHERE (:statuses IS NULL OR ssigm.status IN (:statuses)) " +
          "AND (:gender IS NULL OR s.gender IN (:gender)) " +
          "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds)) " +
          "AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds)) " +
          "AND (:packageSessionIds IS NULL OR ssigm.package_session_id IN (:packageSessionIds))", nativeQuery = true)
  Page<Student> getAllStudentWithFilter(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      Pageable pageable);

  @Query(nativeQuery = true, value = "SELECT DISTINCT s.* " +
      "FROM student s " +
      "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id " +
      "WHERE ( " +
      "to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name) "
      +
      "OR s.full_name LIKE :name || '%' " +
      "OR s.username LIKE :name || '%' " +
      "OR ssigm.institute_enrollment_number LIKE :name || '%' " +
      "OR s.user_id LIKE :name || '%' " +
      "OR s.mobile_number LIKE :name || '%' " +
      ") " +
      "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))", countQuery = "SELECT COUNT(DISTINCT s.id) "
          +
          "FROM student s " +
          "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id "
          +
          "WHERE ( " +
          "to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name) "
          +
          "OR s.full_name LIKE :name || '%' " +
          "OR s.username LIKE :name || '%' " +
          "OR ssigm.institute_enrollment_number LIKE :name || '%' " +
          "OR s.user_id LIKE :name || '%' " +
          "OR s.mobile_number LIKE :name || '%' " +
          ") " +
          "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))")
  Page<Student> getAllStudentWithSearch(
      @Param("name") String name,
      @Param("instituteIds") List<String> instituteIds,
      Pageable pageable);

  @Query(value = "SELECT DISTINCT s.id, s.username, s.user_id, s.email, s.full_name, s.address_line, s.region, " +
      "s.city, s.pin_code, s.mobile_number, s.date_of_birth, s.gender, s.fathers_name, " +
      "s.mothers_name, s.parents_mobile_number, s.parents_email, s.linked_institute_name, " +
      "s.created_at, s.updated_at, ssigm.package_session_id, ssigm.institute_enrollment_number, ssigm.status, ssigm.institute_id, ssigm.expiry_date, s.face_file_id, s.parents_to_mother_mobile_number, s.parents_to_mother_email "
      +
      "FROM student s " +
      "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id " +
      "WHERE (:statuses IS NULL OR ssigm.status IN (:statuses)) " +
      "AND (:gender IS NULL OR s.gender IN (:gender)) " +
      "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds)) " +
      "AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds)) " +
      "AND (ssigm.package_session_id IN (:packageSessionIds))", // Ensures that the session ID matches
      countQuery = "SELECT COUNT(DISTINCT s.id) " +
          "FROM student s " +
          "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id "
          +
          "WHERE (:statuses IS NULL OR ssigm.status IN (:statuses)) " +
          "AND (:gender IS NULL OR s.gender IN (:gender)) " +
          "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds)) " +
          "AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds)) " +
          "AND (ssigm.package_session_id IN (:packageSessionIds))", // Ensures that the
      // session ID matches
      nativeQuery = true)
  Page<Object[]> getAllStudentWithFilterRaw(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      Pageable pageable);

  @Query(nativeQuery = true, value = "SELECT DISTINCT s.id, s.username, s.user_id, s.email, s.full_name, s.address_line, s.region, "
      +
      "s.city, s.pin_code, s.mobile_number, s.date_of_birth, s.gender, s.fathers_name, " +
      "s.mothers_name, s.parents_mobile_number, s.parents_email, s.linked_institute_name, " +
      "s.created_at, s.updated_at, ssigm.package_session_id, ssigm.institute_enrollment_number, ssigm.status, ssigm.institute_id, ssigm.expiry_date, s.face_file_id,s.parents_to_mother_mobile_number, s.parents_to_mother_email  "
      +
      "FROM student s " +
      "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id " +
      "WHERE ( " +
      "to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name) "
      +
      "OR s.full_name LIKE :name || '%' " +
      "OR s.username LIKE :name || '%' " +
      "OR ssigm.institute_enrollment_number LIKE :name || '%' " +
      "OR s.user_id LIKE :name || '%' " +
      "OR s.mobile_number LIKE :name || '%' " +
      ") " +
      "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))", countQuery = "SELECT COUNT(DISTINCT s.id) "
          +
          "FROM student s " +
          "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id "
          +
          "WHERE ( " +
          "to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name) "
          +
          "OR s.full_name LIKE :name || '%' " +
          "OR s.username LIKE :name || '%' " +
          "OR ssigm.institute_enrollment_number LIKE :name || '%' " +
          "OR s.user_id LIKE :name || '%' " +
          "OR s.mobile_number LIKE :name || '%' " +
          ") " +
          "AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))")
  Page<Object[]> getAllStudentWithSearchRaw(
      @Param("name") String name,
      @Param("instituteIds") List<String> instituteIds,
      Pageable pageable);

  // get the recent one if more than pne institute_learner exist
  @Query(value = "SELECT * FROM student where username = :username ORDER BY created_at DESC LIMIT 1", nativeQuery = true)
  Optional<Student> getRecentStudentByUsername(@Param("username") String username);

  Optional<Student> findTopByUserIdOrderByCreatedAtDesc(String userId);

  Optional<Student> findTopByUserId(String userId);

  @Query(value = "SELECT * FROM student WHERE parents_mobile_number = :parentMobile AND full_name = :childFullName ORDER BY created_at DESC LIMIT 1", nativeQuery = true)
  Optional<Student> findByParentMobileAndChildFullName(
      @Param("parentMobile") String parentMobile,
      @Param("childFullName") String childFullName);

  @Query(nativeQuery = true, value = "SELECT DISTINCT s.id, s.username, s.user_id, s.email, s.full_name, s.address_line, s.region, "
      +
      "s.city, s.pin_code, s.mobile_number, s.date_of_birth, s.gender, s.fathers_name, " +
      "s.mothers_name, s.parents_mobile_number, s.parents_email, s.linked_institute_name, " +
      "s.created_at, s.updated_at, ssigm.package_session_id, ssigm.institute_enrollment_number, ssigm.status, "
      +
      "ssigm.institute_id, ssigm.expiry_date, s.face_file_id, s.parents_to_mother_mobile_number, s.parents_to_mother_email, ssigm.user_plan_id, "
      +
      "NULL, p.package_name, l.level_name, ses.session_name "
      +
      "FROM student s " +
      "JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id " +
      "JOIN package_session ps ON ssigm.package_session_id = ps.id " +
      "JOIN package p ON ps.package_id = p.id " +
      "JOIN level l ON ps.level_id = l.id " +
      "JOIN session ses ON ps.session_id = ses.id " +
      "WHERE ssigm.institute_id = :instituteId " +
      "AND s.user_id = :userId " +
      "AND ps.status != 'DELETED' " +
      "AND ssigm.status != 'INACTIVE' " +
      "ORDER BY s.created_at DESC")
  List<Object[]> getStudentWithInstituteAndUserId(
      @Param("userId") String userId,
      @Param("instituteId") String instituteId);

  @Query("""
          SELECT DISTINCT st FROM Student st
          JOIN StudentSessionInstituteGroupMapping s ON st.userId = s.userId
          JOIN PackageSession ps ON s.packageSession.id = ps.id
          JOIN ChapterPackageSessionMapping cpsm ON ps.id = cpsm.packageSession.id
          JOIN Chapter c ON cpsm.chapter.id = c.id AND s.status = 'ACTIVE'
          WHERE c.id = :chapterId
      """)
  List<Student> findStudentsByChapterId(@Param("chapterId") String chapterId);

  @Query("SELECT s FROM Student s " +
      "JOIN StudentSessionInstituteGroupMapping m ON s.userId = m.userId " +
      "WHERE m.packageSession.id = :packageSessionId " +
      "AND m.institute.id = :instituteId " +
      "AND m.status IN :statuses " +
      "ORDER BY s.fullName ASC")
  List<Student> findStudentsByPackageSessionIdAndInstituteIdAndStatus(
      @Param("packageSessionId") String packageSessionId,
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses);

  @Query("""
          SELECT s
          FROM StudentSessionInstituteGroupMapping mapping
          JOIN Student s ON s.userId = mapping.userId
          WHERE s.email = :email
            AND mapping.institute.id = :instituteId
          ORDER BY mapping.createdAt DESC
      """)
  Optional<Student> findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(
      @Param("email") String email,
      @Param("instituteId") String instituteId);

  @Query(nativeQuery = true, value = """
      SELECT
          s.full_name         AS "fullName",
          s.email             AS "email",
          s.username          AS "username",
          s.mobile_number     AS "phone",
          ssigm.package_session_id AS "packageSessionId",
          CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS "accessDays",
          last_pl.payment_status AS "paymentStatus",
          CAST(
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'custom_field_id', cf.id,
                  'value', cfv.value
                )
              ) FILTER (WHERE cf.id IS NOT NULL), '[]'
            ) AS text
          ) AS "customFieldsJson",
          s.user_id AS "userId",
          s.id AS "id",
          s.address_line AS "addressLine",
          s.region AS "region",
          s.city AS "city",
          s.pin_code AS "pinCode",
          s.date_of_birth AS "dateOfBirth",
          s.gender AS "gender",
          s.fathers_name AS "fathersName",
          s.mothers_name AS "mothersName",
          s.parents_mobile_number AS "parentsMobileNumber",
          s.parents_email AS "parentsEmail",
          s.linked_institute_name AS "linkedInstituteName",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.face_file_id AS "faceFileId",
          ssigm.expiry_date AS "expiryDate",
          s.parents_to_mother_mobile_number AS "parentsToMotherMobileNumber",
          s.parents_to_mother_email AS "parentsToMotherEmail",
          s.billing_contact_name AS "billingContactName",
          s.billing_contact_email AS "billingContactEmail",
          s.billing_contact_role AS "billingContactRole",
          ssigm.institute_enrollment_number AS "instituteEnrollmentNumber",
          ssigm.institute_id AS "instituteId",
          ssigm.group_id AS "groupId",
          ssigm.status AS "status",
          up.plan_json AS "paymentPlanJson",
          up.payment_option_json AS "paymentOptionJson",
          ssigm.destination_package_session_id AS "destinationPackageSessionId",
          ssigm.user_plan_id AS "userPlanId",
          up.enroll_invite_id AS "enrollInviteId",
          ei.name AS "enrollInviteName",
          ssigm.sub_org_id AS "subOrgId",
          sub_org.name AS "subOrgName",
          ssigm.comma_separated_org_roles AS "commaSeparatedOrgRoles",
          s.tnc_accepted AS "tncAccepted",
          s.tnc_file_id AS "tncFileId",
          s.tnc_accepted_date AS "tncAcceptedDate",
          ssigm.source AS "source",
          ssigm.type AS "type",
          ssigm.type_id AS "typeId"
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN institute_custom_fields icf
          ON icf.institute_id = ssigm.institute_id
          AND (:#{#customFieldStatus == null || #customFieldStatus.isEmpty()} = true OR icf.status IN (:customFieldStatus))
      LEFT JOIN custom_fields cf
          ON cf.id = icf.custom_field_id
      LEFT JOIN custom_field_values cfv
          ON cfv.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING')
          AND cfv.source_id = ssigm.id
          AND cfv.custom_field_id = cf.id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei
          ON ei.id = up.enroll_invite_id
      LEFT JOIN institutes sub_org
          ON sub_org.id = ssigm.sub_org_id
      WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
               ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
               last_pl.payment_status, s.user_id, s.address_line, s.region, s.city,
               s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
               s.billing_contact_role, ssigm.institute_enrollment_number,
               ssigm.institute_id, ssigm.group_id, ssigm.status, up.plan_json, up.payment_option_json, ssigm.destination_package_session_id, ssigm.user_plan_id, up.enroll_invite_id, ei.name,
               ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
               s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date,
               ssigm.source, ssigm.type, ssigm.type_id
      """, countQuery = """
      SELECT COUNT(DISTINCT s.id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      """)
  Page<StudentListV2Projection> getAllStudentV2WithFilterRaw(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("customFieldStatus") List<String> customFieldStatus,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      Pageable pageable);

  @Query(nativeQuery = true, value = """
      SELECT
          s.full_name         AS "fullName",
          s.email             AS "email",
          s.username          AS "username",
          s.mobile_number     AS "phone",
          ssigm.package_session_id AS "packageSessionId",
          CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS "accessDays",
          last_pl.payment_status AS "paymentStatus",
          CAST(
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'custom_field_id', cf.id,
                  'value', cfv.value
                )
              ) FILTER (WHERE cf.id IS NOT NULL), '[]'
            ) AS text
          ) AS "customFieldsJson",
          s.user_id AS "userId",
          s.id AS "id",
          s.address_line AS "addressLine",
          s.region AS "region",
          s.city AS "city",
          s.pin_code AS "pinCode",
          s.date_of_birth AS "dateOfBirth",
          s.gender AS "gender",
          s.fathers_name AS "fathersName",
          s.mothers_name AS "mothersName",
          s.parents_mobile_number AS "parentsMobileNumber",
          s.parents_email AS "parentsEmail",
          s.linked_institute_name AS "linkedInstituteName",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.face_file_id AS "faceFileId",
          ssigm.expiry_date AS "expiryDate",
          s.parents_to_mother_mobile_number AS "parentsToMotherMobileNumber",
          s.parents_to_mother_email AS "parentsToMotherEmail",
          s.billing_contact_name AS "billingContactName",
          s.billing_contact_email AS "billingContactEmail",
          s.billing_contact_role AS "billingContactRole",
          ssigm.institute_enrollment_number AS "instituteEnrollmentNumber",
          ssigm.institute_id AS "instituteId",
          ssigm.group_id AS "groupId",
          ssigm.status AS "status",
          up.plan_json AS "paymentPlanJson",
          up.payment_option_json AS "paymentOptionJson",
          ssigm.destination_package_session_id AS "destinationPackageSessionId",
          ssigm.user_plan_id AS "userPlanId",
          up.enroll_invite_id AS "enrollInviteId",
          ei.name AS "enrollInviteName",
          ssigm.sub_org_id AS "subOrgId",
          sub_org.name AS "subOrgName",
          ssigm.comma_separated_org_roles AS "commaSeparatedOrgRoles",
          s.tnc_accepted AS "tncAccepted",
          s.tnc_file_id AS "tncFileId",
          s.tnc_accepted_date AS "tncAcceptedDate",
          ssigm.source AS "source",
          ssigm.type AS "type",
          ssigm.type_id AS "typeId"
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN institute_custom_fields icf
          ON icf.institute_id = ssigm.institute_id
          AND (:customFieldStatus IS NULL OR icf.status IN :customFieldStatus)
      LEFT JOIN custom_fields cf
          ON cf.id = icf.custom_field_id
      LEFT JOIN custom_field_values cfv
          ON cfv.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING')
          AND cfv.source_id = ssigm.id
          AND cfv.custom_field_id = cf.id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei
          ON ei.id = up.enroll_invite_id
      LEFT JOIN institutes sub_org
          ON sub_org.id = ssigm.sub_org_id
      WHERE (
          s.full_name ILIKE '%' || :name || '%'
          OR s.username ILIKE '%' || :name || '%'
          OR s.email ILIKE '%' || :name || '%'
          OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%'
          OR s.user_id ILIKE '%' || :name || '%'
          OR (
              :name ~ '^[0-9+() -]+$'
              AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
          )
      )
        AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))
        AND (:statuses IS NULL OR ssigm.status IN (:statuses))
        AND (:paymentStatuses IS NULL OR last_pl.payment_status IN (:paymentStatuses))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
               ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
               last_pl.payment_status, s.user_id, s.address_line, s.region, s.city,
               s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
               s.billing_contact_role, ssigm.institute_enrollment_number,
               ssigm.institute_id, ssigm.group_id, ssigm.status, up.plan_json, up.payment_option_json, ssigm.destination_package_session_id, ssigm.user_plan_id, up.enroll_invite_id, ei.name,
               ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
               s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date,
               ssigm.source, ssigm.type, ssigm.type_id
      """, countQuery = """
      SELECT COUNT(DISTINCT s.id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      WHERE (
          s.full_name ILIKE '%' || :name || '%'
          OR s.username ILIKE '%' || :name || '%'
          OR s.email ILIKE '%' || :name || '%'
          OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%'
          OR s.user_id ILIKE '%' || :name || '%'
          OR (
              :name ~ '^[0-9+() -]+$'
              AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
          )
      )
        AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))
        AND (:statuses IS NULL OR ssigm.status IN (:statuses))
        AND (:paymentStatuses IS NULL OR last_pl.payment_status IN (:paymentStatuses))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
      """)
  Page<StudentListV2Projection> getAllStudentV2WithSearchRaw(
      @Param("name") String name,
      @Param("instituteIds") List<String> instituteIds,
      @Param("statuses") List<String> statuses,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("customFieldStatus") List<String> customFieldStatus,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      Pageable pageable);

  // Get student details by user IDs for tag management
  @Query(value = """
      SELECT
          s.user_id AS "userId",
          s.full_name AS "fullName",
          s.username AS "username",
          s.email AS "email",
          s.mobile_number AS "phoneNumber",
          (SELECT ssigm.institute_enrollment_number
           FROM student_session_institute_group_mapping ssigm
           WHERE ssigm.user_id = s.user_id
           LIMIT 1) AS "enrollmentId"
      FROM student s
      WHERE s.user_id IN (:userIds)
      ORDER BY s.full_name
      """, nativeQuery = true)
  List<Map<String, Object>> findStudentDetailsByUserIds(@Param("userIds") List<String> userIds);

  // Get user IDs by usernames for CSV bulk operations
  @Query(value = """
      SELECT s.user_id
      FROM student s
      WHERE s.username IN (:usernames)
      """, nativeQuery = true)
  List<String> findUserIdsByUsernames(@Param("usernames") List<String> usernames);

  @Query(value = """
      SELECT DISTINCT s.id, s.username, s.user_id, s.email, s.full_name,
             s.address_line, s.region, s.city, s.pin_code, s.mobile_number,
             s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
             s.parents_mobile_number, s.parents_email, s.linked_institute_name,
             s.created_at, s.updated_at, ssigm.package_session_id,
             ssigm.institute_enrollment_number, ssigm.status, ssigm.institute_id,
             ssigm.expiry_date, s.face_file_id, s.parents_to_mother_mobile_number,
             s.parents_to_mother_email,
             -- This subquery calculates the active referral count for each student
             (SELECT COUNT(*) FROM referral_mapping rm WHERE rm.referrer_user_id = s.user_id AND rm.status IN ('ACTIVE')) as referral_count
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
        ON s.user_id = ssigm.user_id
      LEFT JOIN custom_field_values cfv
        ON (cfv.source_id = s.user_id
       AND (:customFieldIds IS NULL OR cfv.custom_field_id IN (:customFieldIds)))
      WHERE (:statuses IS NULL OR ssigm.status IN (:statuses))
        AND (:gender IS NULL OR s.gender IN (:gender))
        AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))
        AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds))
        AND (:packageSessionIds IS NULL OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:subOrgIds IS NULL OR ssigm.sub_org_id IN (:subOrgIds))
      GROUP BY s.id, s.username, s.user_id, s.email, s.full_name,
               s.address_line, s.region, s.city, s.pin_code, s.mobile_number,
               s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, ssigm.package_session_id,
               ssigm.institute_enrollment_number, ssigm.status, ssigm.institute_id,
               ssigm.expiry_date, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email
      """, countQuery = """
      SELECT COUNT(DISTINCT s.id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
        ON s.user_id = ssigm.user_id
      WHERE (:statuses IS NULL OR ssigm.status IN (:statuses))
        AND (:gender IS NULL OR s.gender IN (:gender))
        AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))
        AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds))
        AND (:packageSessionIds IS NULL OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:subOrgIds IS NULL OR ssigm.sub_org_id IN (:subOrgIds))
      """, nativeQuery = true)
  Page<Object[]> findAllStudentsWithFiltersAndCustomFields(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("subOrgIds") List<String> subOrgIds,
      @Param("customFieldIds") List<String> customFieldIds,
      Pageable pageable);

  @Query(value = """
      SELECT DISTINCT s.id, s.username, s.user_id, s.email, s.full_name,
             s.address_line, s.region, s.city, s.pin_code, s.mobile_number,
             s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
             s.parents_mobile_number, s.parents_email, s.linked_institute_name,
             s.created_at, s.updated_at, ssigm.package_session_id,
             ssigm.institute_enrollment_number, ssigm.status, ssigm.institute_id,
             ssigm.expiry_date, s.face_file_id, s.parents_to_mother_mobile_number,
             s.parents_to_mother_email,
             -- This subquery calculates the active referral count for each student
             (SELECT COUNT(*) FROM referral_mapping rm WHERE rm.referrer_user_id = s.user_id AND rm.status IN ('ACTIVE')) as referral_count
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
        ON s.user_id = ssigm.user_id
      LEFT JOIN custom_field_values cfv
        ON (cfv.source_id = s.user_id
       AND (:customFieldIds IS NULL OR cfv.custom_field_id IN (:customFieldIds)))
      WHERE (:statuses IS NULL OR ssigm.status IN (:statuses))
        AND (to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name)
            OR (s.full_name ILIKE :name || '%') -- Changed LIKE to ILIKE for case-insensitivity
             OR (s.username ILIKE :name || '%')
             OR (ssigm.institute_enrollment_number ILIKE :name || '%')
             OR (s.user_id ILIKE :name || '%')
             OR (s.mobile_number ILIKE :name || '%'))
        AND (:gender IS NULL OR s.gender IN (:gender))
        AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))
        AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds))
        AND (:packageSessionIds IS NULL OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:subOrgIds IS NULL OR ssigm.sub_org_id IN (:subOrgIds))
      GROUP BY s.id, s.username, s.user_id, s.email, s.full_name,
               s.address_line, s.region, s.city, s.pin_code, s.mobile_number,
               s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, ssigm.package_session_id,
               ssigm.institute_enrollment_number, ssigm.status, ssigm.institute_id,
               ssigm.expiry_date, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email
      """, countQuery = """
      SELECT COUNT(DISTINCT s.id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
        ON s.user_id = ssigm.user_id
      WHERE (:statuses IS NULL OR ssigm.status IN (:statuses))
        AND (:gender IS NULL OR s.gender IN (:gender))
        AND (:instituteIds IS NULL OR ssigm.institute_id IN (:instituteIds))
        AND (:groupIds IS NULL OR ssigm.group_id IN (:groupIds))
        AND (:packageSessionIds IS NULL OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:subOrgIds IS NULL OR ssigm.sub_org_id IN (:subOrgIds))
        AND (to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name)
            OR (s.full_name ILIKE :name || '%')
             OR (s.username ILIKE :name || '%')
             OR (ssigm.institute_enrollment_number ILIKE :name || '%')
             OR (s.user_id ILIKE :name || '%')
             OR (s.mobile_number ILIKE :name || '%'))
      """, nativeQuery = true)
  Page<Object[]> findAllStudentsWithFilterAndSearchAndCustomFields(
      @Param("name") String name,
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("subOrgIds") List<String> subOrgIds,
      @Param("customFieldIds") List<String> customFieldIds,
      Pageable pageable);

  // Custom-field values: start from the rows this enrollment actually has (SSIGM- or
  // USER-scoped, non-null) and keep those whose field is mapped to the enrollment's
  // institute. Joining every institute_custom_fields row per learner first multiplied each
  // row by thousands of definitions (mostly per-session / per-invite copies) and hit the
  // statement timeout. Null values are skipped; parseCustomFields drops them anyway.
  // Keep prose out of the SQL text: Spring Data does not understand -- comments, so a quote
  // there breaks repository startup.
  @Query(nativeQuery = true, value = """
      SELECT
          s.full_name         AS "fullName",
          s.email             AS "email",
          s.username          AS "username",
          s.mobile_number     AS "phone",
          ssigm.package_session_id AS "packageSessionId",
          CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS "accessDays",
          last_pl.payment_status AS "paymentStatus",
          CAST(
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'custom_field_id', icf.custom_field_id,
                  'value', cfv.value
                )
              ) FILTER (WHERE icf.custom_field_id IS NOT NULL), '[]'
            ) AS text
          ) AS "customFieldsJson",
          s.user_id AS "userId",
          s.id AS "id",
          s.address_line AS "addressLine",
          s.region AS "region",
          s.city AS "city",
          s.pin_code AS "pinCode",
          s.date_of_birth AS "dateOfBirth",
          s.gender AS "gender",
          s.fathers_name AS "fathersName",
          s.mothers_name AS "mothersName",
          s.parents_mobile_number AS "parentsMobileNumber",
          s.parents_email AS "parentsEmail",
          s.linked_institute_name AS "linkedInstituteName",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.face_file_id AS "faceFileId",
          ssigm.expiry_date AS "expiryDate",
          s.parents_to_mother_mobile_number AS "parentsToMotherMobileNumber",
          s.parents_to_mother_email AS "parentsToMotherEmail",
          s.billing_contact_name AS "billingContactName",
          s.billing_contact_email AS "billingContactEmail",
          s.billing_contact_role AS "billingContactRole",
          ssigm.institute_enrollment_number AS "instituteEnrollmentNumber",
          ssigm.institute_id AS "instituteId",
          ssigm.group_id AS "groupId",
          ssigm.status AS "status",
          up.plan_json AS "paymentPlanJson",
          up.payment_option_json AS "paymentOptionJson",
          ssigm.destination_package_session_id AS "destinationPackageSessionId",
          ssigm.user_plan_id AS "userPlanId",
          up.enroll_invite_id AS "enrollInviteId",
          ei.name AS "enrollInviteName",
          ssigm.desired_level_id AS "desiredLevelId",
          ssigm.sub_org_id AS "subOrgId",
          sub_org.name AS "subOrgName",
          ssigm.comma_separated_org_roles AS "commaSeparatedOrgRoles",
          s.tnc_accepted AS "tncAccepted",
          s.tnc_file_id AS "tncFileId",
          s.tnc_accepted_date AS "tncAcceptedDate",
          ssigm.source AS "source",
          ssigm.type AS "type",
          ssigm.type_id AS "typeId"
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN custom_field_values cfv
          ON cfv.value IS NOT NULL
          AND (
              (cfv.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING') AND cfv.source_id = ssigm.id)
              OR (cfv.source_type = 'USER' AND cfv.source_id = ssigm.user_id)
          )
      LEFT JOIN (
          SELECT DISTINCT icf.institute_id, icf.custom_field_id
          FROM institute_custom_fields icf
          JOIN custom_fields cf ON cf.id = icf.custom_field_id
          WHERE (:#{#customFieldStatus == null || #customFieldStatus.isEmpty()} = true OR icf.status IN (:customFieldStatus))
      ) icf
          ON icf.institute_id = ssigm.institute_id
          AND icf.custom_field_id = cfv.custom_field_id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei
          ON ei.id = up.enroll_invite_id
      LEFT JOIN institutes sub_org
          ON sub_org.id = ssigm.sub_org_id
      WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
        AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
        AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
        AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
        AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
               ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
               last_pl.payment_status, s.user_id, s.address_line, s.region, s.city,
               s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
               s.billing_contact_role, ssigm.institute_enrollment_number,
               ssigm.institute_id, ssigm.group_id, ssigm.status, up.plan_json, up.payment_option_json, ssigm.destination_package_session_id, ssigm.user_plan_id, up.enroll_invite_id, ei.name, ssigm.desired_level_id,
               ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
               s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date,
               ssigm.source, ssigm.type, ssigm.type_id
      """, countQuery = """
      SELECT COUNT(DISTINCT s.id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
        AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
        AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
        AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
        AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      """)
  Page<StudentListV2Projection> getAllStudentV2WithFilterRaw(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("customFieldStatus") List<String> customFieldStatus,
      @Param("sources") List<String> sources,
      @Param("types") List<String> types,
      @Param("typeIds") List<String> typeIds,
      @Param("destinationPackageSessionIds") List<String> destinationPackageSessionIds,
      @Param("levelIds") List<String> levelIds,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      Pageable pageable);

  // Custom-field values: start from the rows this enrollment actually has (SSIGM- or
  // USER-scoped, non-null) and keep those whose field is mapped to the enrollment's
  // institute. Joining every institute_custom_fields row per learner first multiplied each
  // row by thousands of definitions (mostly per-session / per-invite copies) and hit the
  // statement timeout. Null values are skipped; parseCustomFields drops them anyway.
  // Keep prose out of the SQL text: Spring Data does not understand -- comments, so a quote
  // there breaks repository startup.
  @Query(nativeQuery = true, value = """
      SELECT
          s.full_name         AS "fullName",
          s.email             AS "email",
          s.username          AS "username",
          s.mobile_number     AS "phone",
          ssigm.package_session_id AS "packageSessionId",
          CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS "accessDays",
          last_pl.payment_status AS "paymentStatus",
          CAST(
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object(
                  'custom_field_id', icf.custom_field_id,
                  'value', cfv.value
                )
              ) FILTER (WHERE icf.custom_field_id IS NOT NULL), '[]'
            ) AS text
          ) AS "customFieldsJson",
          s.user_id AS "userId",
          s.id AS "id",
          s.address_line AS "addressLine",
          s.region AS "region",
          s.city AS "city",
          s.pin_code AS "pinCode",
          s.date_of_birth AS "dateOfBirth",
          s.gender AS "gender",
          s.fathers_name AS "fathersName",
          s.mothers_name AS "mothersName",
          s.parents_mobile_number AS "parentsMobileNumber",
          s.parents_email AS "parentsEmail",
          s.linked_institute_name AS "linkedInstituteName",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.face_file_id AS "faceFileId",
          ssigm.expiry_date AS "expiryDate",
          s.parents_to_mother_mobile_number AS "parentsToMotherMobileNumber",
          s.parents_to_mother_email AS "parentsToMotherEmail",
          s.billing_contact_name AS "billingContactName",
          s.billing_contact_email AS "billingContactEmail",
          s.billing_contact_role AS "billingContactRole",
          ssigm.institute_enrollment_number AS "instituteEnrollmentNumber",
          ssigm.institute_id AS "instituteId",
          ssigm.group_id AS "groupId",
          ssigm.status AS "status",
          up.plan_json AS "paymentPlanJson",
          up.payment_option_json AS "paymentOptionJson",
          ssigm.destination_package_session_id AS "destinationPackageSessionId",
          ssigm.user_plan_id AS "userPlanId",
          up.enroll_invite_id AS "enrollInviteId",
          ei.name AS "enrollInviteName",
          ssigm.desired_level_id AS "desiredLevelId",
          ssigm.sub_org_id AS "subOrgId",
          sub_org.name AS "subOrgName",
          ssigm.comma_separated_org_roles AS "commaSeparatedOrgRoles",
          s.tnc_accepted AS "tncAccepted",
          s.tnc_file_id AS "tncFileId",
          s.tnc_accepted_date AS "tncAcceptedDate",
          ssigm.source AS "source",
          ssigm.type AS "type",
          ssigm.type_id AS "typeId"
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN custom_field_values cfv
          ON cfv.value IS NOT NULL
          AND (
              (cfv.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING') AND cfv.source_id = ssigm.id)
              OR (cfv.source_type = 'USER' AND cfv.source_id = ssigm.user_id)
          )
      LEFT JOIN (
          SELECT DISTINCT icf.institute_id, icf.custom_field_id
          FROM institute_custom_fields icf
          JOIN custom_fields cf ON cf.id = icf.custom_field_id
          WHERE (:customFieldStatus IS NULL OR icf.status IN :customFieldStatus)
      ) icf
          ON icf.institute_id = ssigm.institute_id
          AND icf.custom_field_id = cfv.custom_field_id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei
          ON ei.id = up.enroll_invite_id
      LEFT JOIN institutes sub_org
          ON sub_org.id = ssigm.sub_org_id
      WHERE (
          (s.full_name IS NOT NULL AND s.full_name != '' AND s.full_name ILIKE '%' || :name || '%')
          OR (s.username IS NOT NULL AND s.username != '' AND s.username ILIKE '%' || :name || '%')
          OR (s.email IS NOT NULL AND s.email != '' AND s.email ILIKE '%' || :name || '%')
          OR (s.city IS NOT NULL AND s.city != '' AND s.city ILIKE '%' || :name || '%')
          OR (ssigm.institute_enrollment_number IS NOT NULL AND ssigm.institute_enrollment_number != '' AND ssigm.institute_enrollment_number ILIKE '%' || :name || '%')
          OR (s.user_id IS NOT NULL AND s.user_id != '' AND s.user_id ILIKE '%' || :name || '%')
          OR (s.mobile_number IS NOT NULL AND s.mobile_number != '' AND s.mobile_number ILIKE '%' || :name || '%')
          OR EXISTS (
              SELECT 1
              FROM custom_field_values cfv_inner
              WHERE (
                  (cfv_inner.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING') AND cfv_inner.source_id = ssigm.id)
                  OR (cfv_inner.source_type = 'USER' AND cfv_inner.source_id = ssigm.user_id)
              )
                AND cfv_inner.value IS NOT NULL
                AND cfv_inner.value != ''
                AND LOWER(cfv_inner.value) LIKE LOWER('%' || :name || '%')
          )
      )
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
        AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
        AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
        AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
        AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
               ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
               last_pl.payment_status, s.user_id, s.address_line, s.region, s.city,
               s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
               s.billing_contact_role, ssigm.institute_enrollment_number,
               ssigm.institute_id, ssigm.group_id, ssigm.status, up.plan_json, up.payment_option_json, ssigm.destination_package_session_id, ssigm.user_plan_id, up.enroll_invite_id, ei.name, ssigm.desired_level_id,
               ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
               s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date,
               ssigm.source, ssigm.type, ssigm.type_id
      """, countQuery = """
      SELECT COUNT(DISTINCT s.id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
      LEFT JOIN user_plan up
          ON up.id = ssigm.user_plan_id
      LEFT JOIN (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm2.institute_id IN (:instituteIds))
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      ) last_pl ON last_pl.user_plan_id = up.id
      WHERE (
          (s.full_name IS NOT NULL AND s.full_name != '' AND s.full_name ILIKE '%' || :name || '%')
          OR (s.username IS NOT NULL AND s.username != '' AND s.username ILIKE '%' || :name || '%')
          OR (s.email IS NOT NULL AND s.email != '' AND s.email ILIKE '%' || :name || '%')
          OR (s.city IS NOT NULL AND s.city != '' AND s.city ILIKE '%' || :name || '%')
          OR (ssigm.institute_enrollment_number IS NOT NULL AND ssigm.institute_enrollment_number != '' AND ssigm.institute_enrollment_number ILIKE '%' || :name || '%')
          OR (s.user_id IS NOT NULL AND s.user_id != '' AND s.user_id ILIKE '%' || :name || '%')
          OR (s.mobile_number IS NOT NULL AND s.mobile_number != '' AND s.mobile_number ILIKE '%' || :name || '%')
          OR EXISTS (
              SELECT 1
              FROM custom_field_values cfv_inner
              WHERE (
                  (cfv_inner.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING') AND cfv_inner.source_id = ssigm.id)
                  OR (cfv_inner.source_type = 'USER' AND cfv_inner.source_id = ssigm.user_id)
              )
                AND cfv_inner.value IS NOT NULL
                AND cfv_inner.value != ''
                AND LOWER(cfv_inner.value) LIKE LOWER('%' || :name || '%')
          )
      )
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
        AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
        AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
        AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
        AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
        AND (
          CAST(:startDate AS DATE) IS NULL
          OR CAST(:endDate AS DATE) IS NULL
          OR (
            ssigm.enrolled_date >= CAST(:startDate AS DATE)
            AND ssigm.enrolled_date <= CAST(:endDate AS DATE)
          )
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL
            AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
      """)
  Page<StudentListV2Projection> getAllStudentV2WithSearchRaw(
      @Param("name") String name,
      @Param("instituteIds") List<String> instituteIds,
      @Param("statuses") List<String> statuses,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("customFieldStatus") List<String> customFieldStatus,
      @Param("sources") List<String> sources,
      @Param("types") List<String> types,
      @Param("typeIds") List<String> typeIds,
      @Param("destinationPackageSessionIds") List<String> destinationPackageSessionIds,
      @Param("levelIds") List<String> levelIds,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      Pageable pageable);

  @Query(value = """
      SELECT
          ssigm.id,
          ssigm.user_id,
          ssigm.institute_enrollment_number,
          ssigm.enrolled_date,
          ssigm.expiry_date,
          ssigm.status,
          ssigm.package_session_id,
          ssigm.institute_id,
          ssigm.group_id,
          ssigm.sub_org_id,
          ssigm.user_plan_id,
          ssigm.destination_package_session_id
      FROM student_session_institute_group_mapping ssigm
      WHERE ssigm.package_session_id = :packageSessionId
        AND ssigm.sub_org_id = :subOrgId
        AND ssigm.status = 'ACTIVE'
      ORDER BY ssigm.enrolled_date DESC
      """, nativeQuery = true)
  List<Object[]> findMappingsByPackageSessionAndSubOrg(
      @Param("packageSessionId") String packageSessionId,
      @Param("subOrgId") String subOrgId);

  /**
   * Find all student records for a specific user ID
   */
  List<Student> findByUserId(String userId);

  /**
   * Find student records for a user scoped to a single institute (via SSIGM).
   * Used by the billing-contact resolver so that a user enrolled in multiple
   * institutes does not leak one institute's billing contact into another
   * institute's outbound emails.
   */
  @Query(value = "SELECT DISTINCT s.* FROM student s " +
                 "JOIN student_session_institute_group_mapping ssigm ON ssigm.user_id = s.user_id " +
                 "WHERE s.user_id = :userId AND ssigm.institute_id = :instituteId",
         nativeQuery = true)
  List<Student> findByUserIdAndInstituteId(@Param("userId") String userId,
                                           @Param("instituteId") String instituteId);

  // ── Lightweight paginated student user IDs (no payment_log/custom-field JOIN) ──
  // Only used when paymentStatuses filter is NOT active. The join to payment_log was
  // identified as the bottleneck (full scan per ssigm row when user_plan_id index is missing).

  @Query(nativeQuery = true, value = """
      SELECT user_id
      FROM (
          SELECT ssigm.user_id, MAX(ssigm.enrolled_date) AS last_enrolled
          FROM student s
          JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
          WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
            AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
            AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
            AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
            AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
            AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
            AND (
              CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
              OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
            )
            AND (
              :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
              OR (
                ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                AND EXISTS (
                  SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                  WHERE TRIM(role) IN (:subOrgUserTypes)
                )
              )
            )
            AND (
              :#{#audienceIds == null || #audienceIds.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM audience_response ar
                WHERE ar.user_id = s.user_id
                  AND ar.audience_id IN (:audienceIds)
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND ar.audience_status = 'ACTIVE'
              )
            )
          GROUP BY ssigm.user_id
      ) t
      ORDER BY last_enrolled DESC NULLS LAST
      """,
      countQuery = """
      SELECT COUNT(DISTINCT ssigm.user_id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
      WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
        AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
        AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
        AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
        AND (
          CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
          OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
        AND (
          :#{#audienceIds == null || #audienceIds.isEmpty()} = true
          OR EXISTS (
            SELECT 1 FROM audience_response ar
            WHERE ar.user_id = s.user_id
              AND ar.audience_id IN (:audienceIds)
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND ar.audience_status = 'ACTIVE'
          )
        )
      """)
  Page<String> findPagedStudentIdsForV2Filter(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("sources") List<String> sources,
      @Param("types") List<String> types,
      @Param("typeIds") List<String> typeIds,
      @Param("destinationPackageSessionIds") List<String> destinationPackageSessionIds,
      @Param("levelIds") List<String> levelIds,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      @Param("audienceIds") List<String> audienceIds,
      Pageable pageable);

  // ── Lightweight name-search variant: returns only user IDs, no aggregation JOINs ──

  @Query(nativeQuery = true, value = """
      SELECT user_id
      FROM (
          SELECT ssigm.user_id, MAX(ssigm.enrolled_date) AS last_enrolled
          FROM student s
          JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
          WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
            AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
            AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
            AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
            AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
            AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
            AND (
              CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
              OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
            )
            AND (
              :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
              OR (
                ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                AND EXISTS (
                  SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                  WHERE TRIM(role) IN (:subOrgUserTypes)
                )
              )
            )
            AND (
              :#{#audienceIds == null || #audienceIds.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM audience_response ar
                WHERE ar.user_id = s.user_id
                  AND ar.audience_id IN (:audienceIds)
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND ar.audience_status = 'ACTIVE'
              )
            )
            AND (
              to_tsvector('simple', concat(s.full_name, ' ', s.username)) @@ plainto_tsquery('simple', :name)
              OR s.full_name ILIKE '%' || :name || '%'
              OR s.username ILIKE '%' || :name || '%'
              OR s.email ILIKE '%' || :name || '%'
              OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%'
              OR s.user_id ILIKE '%' || :name || '%'
              OR (
                  :name ~ '^[0-9+() -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
              )
            )
          GROUP BY ssigm.user_id
      ) t
      ORDER BY last_enrolled DESC NULLS LAST
      """,
      countQuery = """
      SELECT COUNT(DISTINCT ssigm.user_id)
      FROM student s
      JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
      WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
        AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
        AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
        AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
        AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
        AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
        AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
        AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
        AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
        AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
        AND (
          CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
          OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
        )
        AND (
          :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
          OR (
            ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
            AND EXISTS (
              SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
              WHERE TRIM(role) IN (:subOrgUserTypes)
            )
          )
        )
        AND (
          :#{#audienceIds == null || #audienceIds.isEmpty()} = true
          OR EXISTS (
            SELECT 1 FROM audience_response ar
            WHERE ar.user_id = s.user_id
              AND ar.audience_id IN (:audienceIds)
              AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
              AND ar.audience_status = 'ACTIVE'
          )
        )
        AND (
          s.full_name ILIKE '%' || :name || '%'
          OR s.username ILIKE '%' || :name || '%'
          OR s.email ILIKE '%' || :name || '%'
          OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%'
          OR s.user_id ILIKE '%' || :name || '%'
          OR (
              :name ~ '^[0-9+() -]+$'
              AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
          )
        )
      """)
  Page<String> findPagedStudentIdsWithNameSearch(
      @Param("name") String name,
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("sources") List<String> sources,
      @Param("types") List<String> types,
      @Param("typeIds") List<String> typeIds,
      @Param("destinationPackageSessionIds") List<String> destinationPackageSessionIds,
      @Param("levelIds") List<String> levelIds,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      @Param("audienceIds") List<String> audienceIds,
      Pageable pageable);

  // ── Learner-list COMBINED id page, no name search (StudentListManager picks it) ──
  // Same rows, totals and key order as findPagedCombinedUserIdsForLearnerList below, plus a
  // user_id tie-break. Name and phone searches keep using that query: here a name search
  // aggregates every enrolled user before matching (no parallel workers past the MATERIALIZED
  // CTE) and measured slower, 452 -> 570 ms for a 58k-learner institute. Without a name it is
  // faster: 839 -> 268 ms for Shiksha Nation, small institutes unchanged (custom plans,
  // primary, 2026-10-23).
  // The default learner-list landing shows everyone (institute + audience-only). Enrollment-scoped
  // filters (statuses, batches, sources, types, dates, sub_org_user_types, levels, groups,
  // destPSIDs) only apply to the ssigm side. Audience-only respondents survive only when
  // includeAudienceOnly=true (caller sets this to false when any enrollment filter is active).
  // Audience-only candidates must NOT have any ssigm row for this institute.
  //
  // Shape (the SQL text itself carries no comments, see UserPlanRepository for why):
  //  - r: the institute's ssigm rows, one pass. f = "row passes the enrollment filters",
  //    n = "name is null or matches this row's enrollment number". When includeAudienceOnly is
  //    true every institute row is kept (f decides which count), so g doubles as the exclusion set.
  //  - g (MATERIALIZED): one row per user, MAX(enrolled_date) over passing rows (m_all) and over
  //    passing rows whose enrollment number matches the name (m_n). With a gender filter the rows
  //    are reached through the matching students instead (second UNION ALL branch, gated by the
  //    SpEL flag, so exactly one branch runs).
  //  - resp / b: audience responses grouped per user BEFORE any per-row probe, then anti-joined
  //    against g (a hash, not one index probe per response).
  //  - c: both candidate sets. They are disjoint (b excludes every institute user), so the old
  //    outer GROUP BY / MAX and the count's cross-side UNION dedup are not needed.
  //  - One student check for both sides (hash semi-join). Without a name the sort key is m_all.
  //    With a name a user matching on a student column sorts by m_all, one matching only on an
  //    enrollment number by m_n, exactly as the old row-level filter did.
  //  - ORDER BY ends with user_id: the old query had no tie-break and most learners share a key,
  //    so pages could skip or repeat learners. The row set and the key order are unchanged.
  // The guards on g.any_f and on the name-null branch fold to constants in custom plans so the
  // planner keeps real row estimates (a bad estimate there chose a merge join with a text sort).

  @Query(nativeQuery = true, value = """
      WITH r AS NOT MATERIALIZED (
          SELECT ssigm.user_id, ssigm.enrolled_date,
              (:includeAudienceOnly = FALSE OR (
                    (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
                    AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
                    AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
                    AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
                    AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
                    AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
                    AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
                    AND (:#{#subOrgIds == null || #subOrgIds.isEmpty()} = true OR ssigm.sub_org_id IN (:subOrgIds))
                    AND (
                      CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
                      OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
                    )
                    AND (
                      :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
                      OR EXISTS (
                        SELECT 1 FROM user_plan up
                        WHERE up.id = ssigm.user_plan_id
                          AND (CASE
                                 WHEN NOT up.is_trial THEN 'PAID'
                                 WHEN up.end_date IS NOT NULL AND up.end_date <= now() THEN 'TRIAL_ENDED'
                                 ELSE 'TRIAL'
                               END) IN (:membershipTypes)
                      )
                    )
                    AND (
                      :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
                      OR (
                        ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                        AND EXISTS (
                          SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                          WHERE TRIM(role) IN (:subOrgUserTypes)
                        )
                      )
                    )
              )) AS f,
              (CAST(:name AS TEXT) IS NULL OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%') AS n
          FROM student_session_institute_group_mapping ssigm
          WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
            AND (:includeAudienceOnly = TRUE OR (
                    (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
                    AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
                    AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
                    AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
                    AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
                    AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
                    AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
                    AND (:#{#subOrgIds == null || #subOrgIds.isEmpty()} = true OR ssigm.sub_org_id IN (:subOrgIds))
                    AND (
                      CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
                      OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
                    )
                    AND (
                      :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
                      OR EXISTS (
                        SELECT 1 FROM user_plan up
                        WHERE up.id = ssigm.user_plan_id
                          AND (CASE
                                 WHEN NOT up.is_trial THEN 'PAID'
                                 WHEN up.end_date IS NOT NULL AND up.end_date <= now() THEN 'TRIAL_ENDED'
                                 ELSE 'TRIAL'
                               END) IN (:membershipTypes)
                      )
                    )
                    AND (
                      :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
                      OR (
                        ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                        AND EXISTS (
                          SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                          WHERE TRIM(role) IN (:subOrgUserTypes)
                        )
                      )
                    )
            ))
      ),
      g AS MATERIALIZED (
          SELECT x.user_id,
                 BOOL_OR(x.f) AS any_f,
                 MAX(x.enrolled_date) FILTER (WHERE x.f) AS m_all,
                 BOOL_OR(x.f AND x.n) AS any_n,
                 MAX(x.enrolled_date) FILTER (WHERE x.f AND x.n) AS m_n
          FROM r x
          WHERE :#{#gender == null || #gender.isEmpty()} = true
          GROUP BY x.user_id
          UNION ALL
          SELECT x.user_id,
                 BOOL_OR(x.f) AS any_f,
                 MAX(x.enrolled_date) FILTER (WHERE x.f) AS m_all,
                 BOOL_OR(x.f AND x.n) AS any_n,
                 MAX(x.enrolled_date) FILTER (WHERE x.f AND x.n) AS m_n
          FROM student sg
          JOIN r x ON x.user_id = sg.user_id
          WHERE :#{#gender == null || #gender.isEmpty()} = false
            AND sg.gender IN (:gender)
          GROUP BY x.user_id
      ),
      resp AS NOT MATERIALIZED (
          SELECT ar.user_id, ar.created_at
          FROM audience_response ar
          JOIN audience a ON a.id = ar.audience_id
              WHERE :includeAudienceOnly = TRUE
                AND a.institute_id IN (:instituteIds)
                AND ar.user_id IS NOT NULL
                AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                AND ar.audience_status = 'ACTIVE'
                AND (:#{#audienceIds == null || #audienceIds.isEmpty()} = true OR ar.audience_id IN (:audienceIds))
      ),
      c (user_id, m_all, m_n, any_n) AS NOT MATERIALIZED (
          SELECT g.user_id, g.m_all, g.m_n, g.any_n
          FROM g
          WHERE (
              :includeAudienceOnly = FALSE
              OR (
                  :#{#statuses == null || #statuses.isEmpty()} = true
                  AND :#{#groupIds == null || #groupIds.isEmpty()} = true
                  AND :#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true
                  AND :#{#sources == null || #sources.isEmpty()} = true
                  AND :#{#types == null || #types.isEmpty()} = true
                  AND :#{#typeIds == null || #typeIds.isEmpty()} = true
                  AND :#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true
                  AND :#{#levelIds == null || #levelIds.isEmpty()} = true
                  AND :#{#subOrgIds == null || #subOrgIds.isEmpty()} = true
                  AND :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
                  AND :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
                  AND (CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL)
                )
              OR g.any_f
            )
            AND (
              :#{#audienceIds == null || #audienceIds.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM audience_response ar
                WHERE ar.user_id = g.user_id
                  AND ar.audience_id IN (:audienceIds)
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND ar.audience_status = 'ACTIVE'
              )
            )

          UNION ALL

          SELECT b.user_id, b.last_sort, b.last_sort, CAST(:name AS TEXT) IS NULL
          FROM (
              SELECT p.user_id, MAX(p.created_at) AS last_sort
              FROM resp p
              WHERE :#{#gender == null || #gender.isEmpty()} = true
              GROUP BY p.user_id
              UNION ALL
              SELECT p.user_id, MAX(p.created_at) AS last_sort
              FROM student sg
              JOIN resp p ON p.user_id = sg.user_id
              WHERE :#{#gender == null || #gender.isEmpty()} = false
                AND sg.gender IN (:gender)
              GROUP BY p.user_id
          ) b
          WHERE NOT EXISTS (SELECT 1 FROM g WHERE g.user_id = b.user_id)
      )
      SELECT t.user_id
      FROM (
          SELECT c.user_id, c.m_all AS sort_key
          FROM c
          WHERE CAST(:name AS TEXT) IS NULL
            AND EXISTS (
              SELECT 1 FROM student s
              WHERE s.user_id = c.user_id
                AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            )

          UNION ALL

          SELECT c.user_id,
                 CASE WHEN BOOL_OR(s.full_name ILIKE '%' || :name || '%'
                OR s.username ILIKE '%' || :name || '%'
                OR s.email ILIKE '%' || :name || '%'
                OR s.user_id ILIKE '%' || :name || '%'
                OR (
                    :name ~ '^[0-9+() -]+$'
                    AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
                )) THEN c.m_all ELSE c.m_n END
          FROM c
          JOIN student s ON s.user_id = c.user_id
          WHERE CAST(:name AS TEXT) IS NOT NULL
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
          GROUP BY c.user_id, c.m_all, c.m_n, c.any_n
          HAVING c.any_n OR BOOL_OR(s.full_name ILIKE '%' || :name || '%'
                OR s.username ILIKE '%' || :name || '%'
                OR s.email ILIKE '%' || :name || '%'
                OR s.user_id ILIKE '%' || :name || '%'
                OR (
                    :name ~ '^[0-9+() -]+$'
                    AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
                ))
      ) t
      ORDER BY t.sort_key DESC NULLS LAST, t.user_id
      """,
      countQuery = """
      WITH r AS NOT MATERIALIZED (
          SELECT ssigm.user_id, ssigm.enrolled_date,
              (:includeAudienceOnly = FALSE OR (
                    (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
                    AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
                    AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
                    AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
                    AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
                    AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
                    AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
                    AND (:#{#subOrgIds == null || #subOrgIds.isEmpty()} = true OR ssigm.sub_org_id IN (:subOrgIds))
                    AND (
                      CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
                      OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
                    )
                    AND (
                      :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
                      OR EXISTS (
                        SELECT 1 FROM user_plan up
                        WHERE up.id = ssigm.user_plan_id
                          AND (CASE
                                 WHEN NOT up.is_trial THEN 'PAID'
                                 WHEN up.end_date IS NOT NULL AND up.end_date <= now() THEN 'TRIAL_ENDED'
                                 ELSE 'TRIAL'
                               END) IN (:membershipTypes)
                      )
                    )
                    AND (
                      :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
                      OR (
                        ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                        AND EXISTS (
                          SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                          WHERE TRIM(role) IN (:subOrgUserTypes)
                        )
                      )
                    )
              )) AS f,
              (CAST(:name AS TEXT) IS NULL OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%') AS n
          FROM student_session_institute_group_mapping ssigm
          WHERE (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
            AND (:includeAudienceOnly = TRUE OR (
                    (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
                    AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
                    AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
                    AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
                    AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
                    AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
                    AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
                    AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
                    AND (:#{#subOrgIds == null || #subOrgIds.isEmpty()} = true OR ssigm.sub_org_id IN (:subOrgIds))
                    AND (
                      CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
                      OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
                    )
                    AND (
                      :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
                      OR EXISTS (
                        SELECT 1 FROM user_plan up
                        WHERE up.id = ssigm.user_plan_id
                          AND (CASE
                                 WHEN NOT up.is_trial THEN 'PAID'
                                 WHEN up.end_date IS NOT NULL AND up.end_date <= now() THEN 'TRIAL_ENDED'
                                 ELSE 'TRIAL'
                               END) IN (:membershipTypes)
                      )
                    )
                    AND (
                      :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
                      OR (
                        ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                        AND EXISTS (
                          SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                          WHERE TRIM(role) IN (:subOrgUserTypes)
                        )
                      )
                    )
            ))
      ),
      g AS MATERIALIZED (
          SELECT x.user_id,
                 BOOL_OR(x.f) AS any_f,
                 MAX(x.enrolled_date) FILTER (WHERE x.f) AS m_all,
                 BOOL_OR(x.f AND x.n) AS any_n,
                 MAX(x.enrolled_date) FILTER (WHERE x.f AND x.n) AS m_n
          FROM r x
          WHERE :#{#gender == null || #gender.isEmpty()} = true
          GROUP BY x.user_id
          UNION ALL
          SELECT x.user_id,
                 BOOL_OR(x.f) AS any_f,
                 MAX(x.enrolled_date) FILTER (WHERE x.f) AS m_all,
                 BOOL_OR(x.f AND x.n) AS any_n,
                 MAX(x.enrolled_date) FILTER (WHERE x.f AND x.n) AS m_n
          FROM student sg
          JOIN r x ON x.user_id = sg.user_id
          WHERE :#{#gender == null || #gender.isEmpty()} = false
            AND sg.gender IN (:gender)
          GROUP BY x.user_id
      ),
      resp AS NOT MATERIALIZED (
          SELECT ar.user_id, ar.created_at
          FROM audience_response ar
          JOIN audience a ON a.id = ar.audience_id
              WHERE :includeAudienceOnly = TRUE
                AND a.institute_id IN (:instituteIds)
                AND ar.user_id IS NOT NULL
                AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                AND ar.audience_status = 'ACTIVE'
                AND (:#{#audienceIds == null || #audienceIds.isEmpty()} = true OR ar.audience_id IN (:audienceIds))
      ),
      c (user_id, m_all, m_n, any_n) AS NOT MATERIALIZED (
          SELECT g.user_id, g.m_all, g.m_n, g.any_n
          FROM g
          WHERE (
              :includeAudienceOnly = FALSE
              OR (
                  :#{#statuses == null || #statuses.isEmpty()} = true
                  AND :#{#groupIds == null || #groupIds.isEmpty()} = true
                  AND :#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true
                  AND :#{#sources == null || #sources.isEmpty()} = true
                  AND :#{#types == null || #types.isEmpty()} = true
                  AND :#{#typeIds == null || #typeIds.isEmpty()} = true
                  AND :#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true
                  AND :#{#levelIds == null || #levelIds.isEmpty()} = true
                  AND :#{#subOrgIds == null || #subOrgIds.isEmpty()} = true
                  AND :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
                  AND :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
                  AND (CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL)
                )
              OR g.any_f
            )
            AND (
              :#{#audienceIds == null || #audienceIds.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM audience_response ar
                WHERE ar.user_id = g.user_id
                  AND ar.audience_id IN (:audienceIds)
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND ar.audience_status = 'ACTIVE'
              )
            )

          UNION ALL

          SELECT b.user_id, b.last_sort, b.last_sort, CAST(:name AS TEXT) IS NULL
          FROM (
              SELECT p.user_id, MAX(p.created_at) AS last_sort
              FROM resp p
              WHERE :#{#gender == null || #gender.isEmpty()} = true
              GROUP BY p.user_id
              UNION ALL
              SELECT p.user_id, MAX(p.created_at) AS last_sort
              FROM student sg
              JOIN resp p ON p.user_id = sg.user_id
              WHERE :#{#gender == null || #gender.isEmpty()} = false
                AND sg.gender IN (:gender)
              GROUP BY p.user_id
          ) b
          WHERE NOT EXISTS (SELECT 1 FROM g WHERE g.user_id = b.user_id)
      )
      SELECT COUNT(*)
      FROM c
      WHERE EXISTS (
          SELECT 1 FROM student s
          WHERE s.user_id = c.user_id
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (CAST(:name AS TEXT) IS NULL OR c.any_n OR s.full_name ILIKE '%' || :name || '%'
                OR s.username ILIKE '%' || :name || '%'
                OR s.email ILIKE '%' || :name || '%'
                OR s.user_id ILIKE '%' || :name || '%'
                OR (
                    :name ~ '^[0-9+() -]+$'
                    AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
                ))
      )
      """)
  Page<String> findPagedCombinedUserIdsForLearnerListNoName(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("sources") List<String> sources,
      @Param("types") List<String> types,
      @Param("typeIds") List<String> typeIds,
      @Param("destinationPackageSessionIds") List<String> destinationPackageSessionIds,
      @Param("levelIds") List<String> levelIds,
      @Param("subOrgIds") List<String> subOrgIds,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      /** TRIAL and/or PAID, from user_plan.is_trial. Empty = no filter. An EXISTS rather
       *  than a join, so the default list pays nothing for a filter it is not using. */
      @Param("membershipTypes") List<String> membershipTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      @Param("audienceIds") List<String> audienceIds,
      @Param("name") String name,
      @Param("includeAudienceOnly") boolean includeAudienceOnly,
      Pageable pageable);

  // ── Learner-list COMBINED id page: institute users UNION audience-only respondents ──
  // The default learner-list landing shows everyone (institute + audience-only). Enrollment-scoped
  // filters (statuses, batches, sources, types, dates, sub_org_user_types, levels, groups,
  // destPSIDs) only apply to the ssigm side. Audience-only respondents survive only when
  // includeAudienceOnly=true (caller sets this to false when any enrollment filter is active).
  // Audience-only candidates must NOT have any ssigm row for this institute.

  @Query(nativeQuery = true, value = """
      SELECT user_id
      FROM (
          SELECT ssigm.user_id, MAX(ssigm.enrolled_date) AS last_sort
          FROM student s
          JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
          WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
            AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
            AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
            AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
            AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
            AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
            AND (:#{#subOrgIds == null || #subOrgIds.isEmpty()} = true OR ssigm.sub_org_id IN (:subOrgIds))
            AND (
              CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
              OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
            )
            AND (
              :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM user_plan up
                WHERE up.id = ssigm.user_plan_id
                  AND (CASE
                         WHEN NOT up.is_trial THEN 'PAID'
                         WHEN up.end_date IS NOT NULL AND up.end_date <= now() THEN 'TRIAL_ENDED'
                         ELSE 'TRIAL'
                       END) IN (:membershipTypes)
              )
            )
            AND (
              :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
              OR (
                ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                AND EXISTS (
                  SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                  WHERE TRIM(role) IN (:subOrgUserTypes)
                )
              )
            )
            AND (
              :#{#audienceIds == null || #audienceIds.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM audience_response ar
                WHERE ar.user_id = s.user_id
                  AND ar.audience_id IN (:audienceIds)
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND ar.audience_status = 'ACTIVE'
              )
            )
            AND (
              CAST(:name AS TEXT) IS NULL
              OR s.full_name ILIKE '%' || :name || '%'
              OR s.username ILIKE '%' || :name || '%'
              OR s.email ILIKE '%' || :name || '%'
              OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%'
              OR s.user_id ILIKE '%' || :name || '%'
              OR (
                  :name ~ '^[0-9+() -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
              )
            )
          GROUP BY ssigm.user_id

          UNION ALL

          SELECT ar.user_id, MAX(ar.created_at) AS last_sort
          FROM audience_response ar
          JOIN audience a ON a.id = ar.audience_id
          JOIN student s ON s.user_id = ar.user_id
          WHERE :includeAudienceOnly = TRUE
            AND a.institute_id IN (:instituteIds)
            AND ar.user_id IS NOT NULL
            AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
            AND ar.audience_status = 'ACTIVE'
            AND (:#{#audienceIds == null || #audienceIds.isEmpty()} = true OR ar.audience_id IN (:audienceIds))
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (
              CAST(:name AS TEXT) IS NULL
              OR s.full_name ILIKE '%' || :name || '%'
              OR s.username ILIKE '%' || :name || '%'
              OR s.email ILIKE '%' || :name || '%'
              OR s.user_id ILIKE '%' || :name || '%'
              OR (
                  :name ~ '^[0-9+() -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM student_session_institute_group_mapping ssigm2
              WHERE ssigm2.user_id = ar.user_id
                AND ssigm2.institute_id IN (:instituteIds)
            )
          GROUP BY ar.user_id
      ) combined
      GROUP BY user_id
      ORDER BY MAX(last_sort) DESC NULLS LAST
      """,
      countQuery = """
      SELECT COUNT(*) FROM (
          SELECT DISTINCT ssigm.user_id
          FROM student s
          JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
          WHERE (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (:#{#instituteIds == null || #instituteIds.isEmpty()} = true OR ssigm.institute_id IN (:instituteIds))
            AND (:#{#groupIds == null || #groupIds.isEmpty()} = true OR ssigm.group_id IN (:groupIds))
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
            AND (:#{#sources == null || #sources.isEmpty()} = true OR ssigm.source IN (:sources))
            AND (:#{#types == null || #types.isEmpty()} = true OR ssigm.type IN (:types))
            AND (:#{#typeIds == null || #typeIds.isEmpty()} = true OR ssigm.type_id IN (:typeIds))
            AND (:#{#destinationPackageSessionIds == null || #destinationPackageSessionIds.isEmpty()} = true OR ssigm.destination_package_session_id IN (:destinationPackageSessionIds))
            AND (:#{#levelIds == null || #levelIds.isEmpty()} = true OR ssigm.desired_level_id IN (:levelIds))
            AND (:#{#subOrgIds == null || #subOrgIds.isEmpty()} = true OR ssigm.sub_org_id IN (:subOrgIds))
            AND (
              CAST(:startDate AS DATE) IS NULL OR CAST(:endDate AS DATE) IS NULL
              OR (ssigm.enrolled_date >= CAST(:startDate AS DATE) AND ssigm.enrolled_date <= CAST(:endDate AS DATE))
            )
            AND (
              :#{#membershipTypes == null || #membershipTypes.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM user_plan up
                WHERE up.id = ssigm.user_plan_id
                  AND (CASE
                         WHEN NOT up.is_trial THEN 'PAID'
                         WHEN up.end_date IS NOT NULL AND up.end_date <= now() THEN 'TRIAL_ENDED'
                         ELSE 'TRIAL'
                       END) IN (:membershipTypes)
              )
            )
            AND (
              :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
              OR (
                ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                AND EXISTS (
                  SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                  WHERE TRIM(role) IN (:subOrgUserTypes)
                )
              )
            )
            AND (
              :#{#audienceIds == null || #audienceIds.isEmpty()} = true
              OR EXISTS (
                SELECT 1 FROM audience_response ar
                WHERE ar.user_id = s.user_id
                  AND ar.audience_id IN (:audienceIds)
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  AND ar.audience_status = 'ACTIVE'
              )
            )
            AND (
              CAST(:name AS TEXT) IS NULL
              OR s.full_name ILIKE '%' || :name || '%'
              OR s.username ILIKE '%' || :name || '%'
              OR s.email ILIKE '%' || :name || '%'
              OR ssigm.institute_enrollment_number ILIKE '%' || :name || '%'
              OR s.user_id ILIKE '%' || :name || '%'
              OR (
                  :name ~ '^[0-9+() -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
              )
            )

          UNION

          SELECT DISTINCT ar.user_id
          FROM audience_response ar
          JOIN audience a ON a.id = ar.audience_id
          JOIN student s ON s.user_id = ar.user_id
          WHERE :includeAudienceOnly = TRUE
            AND a.institute_id IN (:instituteIds)
            AND ar.user_id IS NOT NULL
            AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
            AND ar.audience_status = 'ACTIVE'
            AND (:#{#audienceIds == null || #audienceIds.isEmpty()} = true OR ar.audience_id IN (:audienceIds))
            AND (:#{#gender == null || #gender.isEmpty()} = true OR s.gender IN (:gender))
            AND (
              CAST(:name AS TEXT) IS NULL
              OR s.full_name ILIKE '%' || :name || '%'
              OR s.username ILIKE '%' || :name || '%'
              OR s.email ILIKE '%' || :name || '%'
              OR s.user_id ILIKE '%' || :name || '%'
              OR (
                  :name ~ '^[0-9+() -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:name, '[^0-9]', '', 'g') || '%'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM student_session_institute_group_mapping ssigm2
              WHERE ssigm2.user_id = ar.user_id
                AND ssigm2.institute_id IN (:instituteIds)
            )
      ) total
      """)
  Page<String> findPagedCombinedUserIdsForLearnerList(
      @Param("statuses") List<String> statuses,
      @Param("gender") List<String> gender,
      @Param("instituteIds") List<String> instituteIds,
      @Param("groupIds") List<String> groupIds,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("sources") List<String> sources,
      @Param("types") List<String> types,
      @Param("typeIds") List<String> typeIds,
      @Param("destinationPackageSessionIds") List<String> destinationPackageSessionIds,
      @Param("levelIds") List<String> levelIds,
      @Param("subOrgIds") List<String> subOrgIds,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      /** TRIAL and/or PAID, from user_plan.is_trial. Empty = no filter. An EXISTS rather
       *  than a join, so the default list pays nothing for a filter it is not using. */
      @Param("membershipTypes") List<String> membershipTypes,
      @Param("startDate") LocalDate startDate,
      @Param("endDate") LocalDate endDate,
      @Param("audienceIds") List<String> audienceIds,
      @Param("name") String name,
      @Param("includeAudienceOnly") boolean includeAudienceOnly,
      Pageable pageable);

  // ── Paginated combined user IDs (institute users UNION audience respondents) ──

  @Query(nativeQuery = true, value = """
      SELECT user_id
      FROM (
          SELECT ssigm.user_id, MIN(ssigm.created_at) AS sort_date
          FROM student_session_institute_group_mapping ssigm
          JOIN student s ON s.user_id = ssigm.user_id
          LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
          LEFT JOIN (
              SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
              FROM payment_log pl
              WHERE pl.user_plan_id IN (
                  SELECT ssigm2.user_plan_id
                  FROM student_session_institute_group_mapping ssigm2
                  WHERE ssigm2.institute_id = :instituteId
                    AND ssigm2.user_plan_id IS NOT NULL
              )
              ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
          ) last_pl ON last_pl.user_plan_id = up.id
          WHERE ssigm.institute_id = :instituteId
            AND (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
            AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
            AND (:#{#genders == null || #genders.isEmpty()} = true OR s.gender IN (:genders))
            AND (COALESCE(:cfMatchedUserIdsCsv, '') = ''
                 OR ssigm.user_id = ANY(STRING_TO_ARRAY(:cfMatchedUserIdsCsv, ',')))
            AND (COALESCE(:cfExcludedUserIdsCsv, '') = ''
                 OR NOT (ssigm.user_id = ANY(STRING_TO_ARRAY(:cfExcludedUserIdsCsv, ','))))
            AND (
              :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
              OR (
                ssigm.comma_separated_org_roles IS NOT NULL
                AND ssigm.comma_separated_org_roles != ''
                AND EXISTS (
                  SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                  WHERE TRIM(role) IN (:subOrgUserTypes)
                )
              )
            )
            AND (
              CAST(:nameSearch AS TEXT) IS NULL
              OR (COALESCE(:searchTokensCsv, '') <> ''
                  AND LOWER(CONCAT_WS(' ', s.full_name, s.email))
                      LIKE ALL (STRING_TO_ARRAY(:searchTokensCsv, '|')))
              OR (
                  :nameSearch ~ '^[0-9+()./ -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:nameSearch, '[^0-9]', '', 'g') || '%'
              )
            )
          GROUP BY ssigm.user_id

          UNION ALL

          SELECT ar.user_id, MIN(ar.created_at) AS sort_date
          FROM audience_response ar
          JOIN audience a ON a.id = ar.audience_id
          LEFT JOIN student sg ON sg.user_id = ar.user_id
          WHERE a.institute_id = :instituteId
            AND ar.user_id IS NOT NULL
            AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
            AND ar.audience_status = 'ACTIVE'
            AND (:#{#audienceIds == null || #audienceIds.isEmpty()} = true OR ar.audience_id IN (:audienceIds))
            AND (:#{#genders == null || #genders.isEmpty()} = true OR sg.gender IN (:genders))
            AND (COALESCE(:cfMatchedUserIdsCsv, '') = ''
                 OR ar.user_id = ANY(STRING_TO_ARRAY(:cfMatchedUserIdsCsv, ',')))
            AND (COALESCE(:cfExcludedUserIdsCsv, '') = ''
                 OR NOT (ar.user_id = ANY(STRING_TO_ARRAY(:cfExcludedUserIdsCsv, ','))))
            AND (
              CAST(:nameSearch AS TEXT) IS NULL
              OR (COALESCE(:searchTokensCsv, '') <> ''
                  AND LOWER(CONCAT_WS(' ', sg.full_name, sg.email, ar.parent_name, ar.parent_email))
                      LIKE ALL (STRING_TO_ARRAY(:searchTokensCsv, '|')))
              -- A lead who never enrolled has NO student row, so the LEFT JOIN leaves
              -- sg.* entirely NULL and the three clauses above can never match it --
              -- searching an institute whose contacts are all leads returned nothing
              -- at all. Their identity lives on audience_response, and on the auth
              -- User for the paths that store the name only there (pre-resolved into
              -- :searchUserIdsCsv by the caller). This mirrors the four-way match the
              -- leads list already does in AudienceResponseRepository.
              OR (COALESCE(:searchUserIdsCsv, '') != ''
                  AND ar.user_id = ANY(STRING_TO_ARRAY(:searchUserIdsCsv, ',')))
              OR (
                  :nameSearch ~ '^[0-9+()./ -]+$'
                  AND (
                      REGEXP_REPLACE(sg.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:nameSearch, '[^0-9]', '', 'g') || '%'
                      OR REGEXP_REPLACE(ar.parent_mobile, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:nameSearch, '[^0-9]', '', 'g') || '%'
                  )
              )
            )
          GROUP BY ar.user_id
      ) all_sources
      GROUP BY user_id
      ORDER BY
        CASE WHEN CAST(:sortCustomFieldId AS TEXT) IS NOT NULL AND :cfSortDirection = 'ASC'
             THEN CASE WHEN COALESCE((SELECT scf.value FROM custom_field_values scf WHERE scf.source_type = 'USER' AND scf.source_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1), (SELECT scf.value FROM custom_field_values scf JOIN audience_response sar ON sar.id = scf.source_id WHERE scf.source_type = 'AUDIENCE_RESPONSE' AND sar.user_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)) ~ '^-?[0-9]+([.][0-9]+)?$' THEN CAST(COALESCE((SELECT scf.value FROM custom_field_values scf WHERE scf.source_type = 'USER' AND scf.source_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1), (SELECT scf.value FROM custom_field_values scf JOIN audience_response sar ON sar.id = scf.source_id WHERE scf.source_type = 'AUDIENCE_RESPONSE' AND sar.user_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)) AS numeric) END END ASC NULLS LAST,
        CASE WHEN CAST(:sortCustomFieldId AS TEXT) IS NOT NULL AND (CAST(:cfSortDirection AS TEXT) IS NULL OR :cfSortDirection = 'DESC')
             THEN CASE WHEN COALESCE((SELECT scf.value FROM custom_field_values scf WHERE scf.source_type = 'USER' AND scf.source_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1), (SELECT scf.value FROM custom_field_values scf JOIN audience_response sar ON sar.id = scf.source_id WHERE scf.source_type = 'AUDIENCE_RESPONSE' AND sar.user_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)) ~ '^-?[0-9]+([.][0-9]+)?$' THEN CAST(COALESCE((SELECT scf.value FROM custom_field_values scf WHERE scf.source_type = 'USER' AND scf.source_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1), (SELECT scf.value FROM custom_field_values scf JOIN audience_response sar ON sar.id = scf.source_id WHERE scf.source_type = 'AUDIENCE_RESPONSE' AND sar.user_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)) AS numeric) END END DESC NULLS LAST,
        CASE WHEN CAST(:sortCustomFieldId AS TEXT) IS NOT NULL AND :cfSortDirection = 'ASC'
             THEN COALESCE((SELECT scf.value FROM custom_field_values scf WHERE scf.source_type = 'USER' AND scf.source_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1), (SELECT scf.value FROM custom_field_values scf JOIN audience_response sar ON sar.id = scf.source_id WHERE scf.source_type = 'AUDIENCE_RESPONSE' AND sar.user_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)) END ASC NULLS LAST,
        CASE WHEN CAST(:sortCustomFieldId AS TEXT) IS NOT NULL AND (CAST(:cfSortDirection AS TEXT) IS NULL OR :cfSortDirection = 'DESC')
             THEN COALESCE((SELECT scf.value FROM custom_field_values scf WHERE scf.source_type = 'USER' AND scf.source_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1), (SELECT scf.value FROM custom_field_values scf JOIN audience_response sar ON sar.id = scf.source_id WHERE scf.source_type = 'AUDIENCE_RESPONSE' AND sar.user_id = all_sources.user_id AND scf.custom_field_id = :sortCustomFieldId ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)) END DESC NULLS LAST,
        MIN(sort_date) DESC NULLS LAST
      """,
      countQuery = """
      SELECT COUNT(*) FROM (
          SELECT DISTINCT ssigm.user_id
          FROM student_session_institute_group_mapping ssigm
          JOIN student s ON s.user_id = ssigm.user_id
          LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
          LEFT JOIN (
              SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
              FROM payment_log pl
              WHERE pl.user_plan_id IN (
                  SELECT ssigm2.user_plan_id
                  FROM student_session_institute_group_mapping ssigm2
                  WHERE ssigm2.institute_id = :instituteId
                    AND ssigm2.user_plan_id IS NOT NULL
              )
              ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
          ) last_pl ON last_pl.user_plan_id = up.id
          WHERE ssigm.institute_id = :instituteId
            AND (:#{#statuses == null || #statuses.isEmpty()} = true OR ssigm.status IN (:statuses))
            AND (:#{#packageSessionIds == null || #packageSessionIds.isEmpty()} = true OR ssigm.package_session_id IN (:packageSessionIds))
            AND (:#{#paymentStatuses == null || #paymentStatuses.isEmpty()} = true OR last_pl.payment_status IN (:paymentStatuses))
            AND (:#{#genders == null || #genders.isEmpty()} = true OR s.gender IN (:genders))
            AND (COALESCE(:cfMatchedUserIdsCsv, '') = ''
                 OR ssigm.user_id = ANY(STRING_TO_ARRAY(:cfMatchedUserIdsCsv, ',')))
            AND (COALESCE(:cfExcludedUserIdsCsv, '') = ''
                 OR NOT (ssigm.user_id = ANY(STRING_TO_ARRAY(:cfExcludedUserIdsCsv, ','))))
            AND (
              :#{#subOrgUserTypes == null || #subOrgUserTypes.isEmpty()} = true
              OR (
                ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != ''
                AND EXISTS (
                  SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role
                  WHERE TRIM(role) IN (:subOrgUserTypes)
                )
              )
            )
            AND (
              CAST(:nameSearch AS TEXT) IS NULL
              OR (COALESCE(:searchTokensCsv, '') <> ''
                  AND LOWER(CONCAT_WS(' ', s.full_name, s.email))
                      LIKE ALL (STRING_TO_ARRAY(:searchTokensCsv, '|')))
              OR (
                  :nameSearch ~ '^[0-9+()./ -]+$'
                  AND REGEXP_REPLACE(s.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:nameSearch, '[^0-9]', '', 'g') || '%'
              )
            )

          UNION

          SELECT DISTINCT ar.user_id
          FROM audience_response ar
          JOIN audience a ON a.id = ar.audience_id
          LEFT JOIN student sg ON sg.user_id = ar.user_id
          WHERE a.institute_id = :instituteId
            AND ar.user_id IS NOT NULL
            AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
            AND ar.audience_status = 'ACTIVE'
            AND (:#{#audienceIds == null || #audienceIds.isEmpty()} = true OR ar.audience_id IN (:audienceIds))
            AND (:#{#genders == null || #genders.isEmpty()} = true OR sg.gender IN (:genders))
            AND (COALESCE(:cfMatchedUserIdsCsv, '') = ''
                 OR ar.user_id = ANY(STRING_TO_ARRAY(:cfMatchedUserIdsCsv, ',')))
            AND (COALESCE(:cfExcludedUserIdsCsv, '') = ''
                 OR NOT (ar.user_id = ANY(STRING_TO_ARRAY(:cfExcludedUserIdsCsv, ','))))
            AND (
              CAST(:nameSearch AS TEXT) IS NULL
              OR (COALESCE(:searchTokensCsv, '') <> ''
                  AND LOWER(CONCAT_WS(' ', sg.full_name, sg.email, ar.parent_name, ar.parent_email))
                      LIKE ALL (STRING_TO_ARRAY(:searchTokensCsv, '|')))
              -- A lead who never enrolled has NO student row, so the LEFT JOIN leaves
              -- sg.* entirely NULL and the three clauses above can never match it --
              -- searching an institute whose contacts are all leads returned nothing
              -- at all. Their identity lives on audience_response, and on the auth
              -- User for the paths that store the name only there (pre-resolved into
              -- :searchUserIdsCsv by the caller). This mirrors the four-way match the
              -- leads list already does in AudienceResponseRepository.
              OR (COALESCE(:searchUserIdsCsv, '') != ''
                  AND ar.user_id = ANY(STRING_TO_ARRAY(:searchUserIdsCsv, ',')))
              OR (
                  :nameSearch ~ '^[0-9+()./ -]+$'
                  AND (
                      REGEXP_REPLACE(sg.mobile_number, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:nameSearch, '[^0-9]', '', 'g') || '%'
                      OR REGEXP_REPLACE(ar.parent_mobile, '[^0-9]', '', 'g') LIKE '%' || REGEXP_REPLACE(:nameSearch, '[^0-9]', '', 'g') || '%'
                  )
              )
            )
      ) total
      """)
  Page<String> findPagedCombinedUserIds(
      @Param("instituteId") String instituteId,
      @Param("statuses") List<String> statuses,
      @Param("packageSessionIds") List<String> packageSessionIds,
      @Param("paymentStatuses") List<String> paymentStatuses,
      @Param("subOrgUserTypes") List<String> subOrgUserTypes,
      @Param("nameSearch") String nameSearch,
      /** The search split into lowercased %token% patterns, pipe-separated. Every token
       *  must appear somewhere in the name+email text, so "rajput bhagyshri" finds
       *  DrBhagyshriRajput and "Manish Bachhav" finds a name and an email that each hold
       *  one of the words. Blank = no text match (the phone branch may still fire). */
      @Param("searchTokensCsv") String searchTokensCsv,
      @Param("genders") List<String> genders,
      @Param("audienceIds") List<String> audienceIds,
      @Param("cfMatchedUserIdsCsv") String cfMatchedUserIdsCsv,
      @Param("cfExcludedUserIdsCsv") String cfExcludedUserIdsCsv,
      /** Auth-service user ids matching the free-text search; lets a lead whose name
       *  lives only on the auth User still be found. Null/blank = no id match. */
      @Param("searchUserIdsCsv") String searchUserIdsCsv,
      @Param("sortCustomFieldId") String sortCustomFieldId,
      @Param("cfSortDirection") String cfSortDirection,
      Pageable pageable);

  // ── V2 enrichment for a specific set of user IDs (used after pagination) ──

  // Custom-field values: start from the rows this learner actually has instead of joining
  // every institute_custom_fields row per learner (thousands of definitions per institute,
  // mostly per-session / per-invite copies; that fan-out hit the statement timeout). Null
  // values are skipped; callers drop them anyway. Per field it yields the same candidates as the
  // old COALESCE(user-scoped, SSIGM-scoped) join: every USER-scoped value, plus the SSIGM-scoped
  // values only when the learner has no USER-scoped row for that field or one with a NULL value.
  // Keep prose out of the SQL text: Spring Data does not understand -- comments, so a quote
  // there breaks repository startup.
  @Query(nativeQuery = true, value = """
      WITH last_payments AS (
          SELECT DISTINCT ON (pl.user_plan_id) pl.user_plan_id, pl.payment_status
          FROM payment_log pl
          WHERE pl.user_plan_id IN (
              SELECT ssigm2.user_plan_id
              FROM student_session_institute_group_mapping ssigm2
              WHERE ssigm2.user_id IN (:userIds)
                AND ssigm2.institute_id IN (:instituteIds)
                AND ssigm2.user_plan_id IS NOT NULL
          )
          ORDER BY pl.user_plan_id, pl.date DESC NULLS LAST
      )
      SELECT
          s.full_name         AS "fullName",
          s.email             AS "email",
          s.username          AS "username",
          s.mobile_number     AS "phone",
          ssigm.package_session_id AS "packageSessionId",
          CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS "accessDays",
          last_pl.payment_status AS "paymentStatus",
          CAST(
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object('custom_field_id', icf.custom_field_id, 'value', cfv.value)
              ) FILTER (WHERE icf.custom_field_id IS NOT NULL), '[]'
            ) AS text
          ) AS "customFieldsJson",
          s.user_id AS "userId",
          s.id AS "id",
          s.address_line AS "addressLine",
          s.region AS "region",
          s.city AS "city",
          s.pin_code AS "pinCode",
          s.date_of_birth AS "dateOfBirth",
          s.gender AS "gender",
          s.fathers_name AS "fathersName",
          s.mothers_name AS "mothersName",
          s.parents_mobile_number AS "parentsMobileNumber",
          s.parents_email AS "parentsEmail",
          s.linked_institute_name AS "linkedInstituteName",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.face_file_id AS "faceFileId",
          ssigm.expiry_date AS "expiryDate",
          s.parents_to_mother_mobile_number AS "parentsToMotherMobileNumber",
          s.parents_to_mother_email AS "parentsToMotherEmail",
          s.billing_contact_name AS "billingContactName",
          s.billing_contact_email AS "billingContactEmail",
          s.billing_contact_role AS "billingContactRole",
          ssigm.institute_enrollment_number AS "instituteEnrollmentNumber",
          ssigm.institute_id AS "instituteId",
          ssigm.group_id AS "groupId",
          ssigm.status AS "status",
          up.plan_json AS "paymentPlanJson",
          up.payment_option_json AS "paymentOptionJson",
          ssigm.destination_package_session_id AS "destinationPackageSessionId",
          ssigm.user_plan_id AS "userPlanId",
          up.enroll_invite_id AS "enrollInviteId",
          ei.name AS "enrollInviteName",
          ssigm.source AS "source",
          ssigm.type AS "type",
          ssigm.type_id AS "typeId",
          ssigm.desired_level_id AS "desiredLevelId",
          ssigm.sub_org_id AS "subOrgId",
          sub_org.name AS "subOrgName",
          ssigm.comma_separated_org_roles AS "commaSeparatedOrgRoles",
          s.tnc_accepted AS "tncAccepted",
          s.tnc_file_id AS "tncFileId",
          s.tnc_accepted_date AS "tncAcceptedDate"
      FROM student s
      JOIN student_session_institute_group_mapping ssigm ON s.user_id = ssigm.user_id
      LEFT JOIN LATERAL (
          SELECT v.custom_field_id, v.value
          FROM (
              SELECT cfv_user.custom_field_id, cfv_user.value
              FROM custom_field_values cfv_user
              WHERE cfv_user.source_type = 'USER'
                AND cfv_user.source_id = s.user_id
              UNION ALL
              SELECT cfv_ssigm.custom_field_id, cfv_ssigm.value
              FROM custom_field_values cfv_ssigm
              WHERE cfv_ssigm.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING')
                AND cfv_ssigm.source_id = ssigm.id
                AND (
                    NOT EXISTS (
                        SELECT 1 FROM custom_field_values cfv_u
                        WHERE cfv_u.source_type = 'USER'
                          AND cfv_u.source_id = s.user_id
                          AND cfv_u.custom_field_id = cfv_ssigm.custom_field_id)
                    OR EXISTS (
                        SELECT 1 FROM custom_field_values cfv_u
                        WHERE cfv_u.source_type = 'USER'
                          AND cfv_u.source_id = s.user_id
                          AND cfv_u.custom_field_id = cfv_ssigm.custom_field_id
                          AND cfv_u.value IS NULL)
                )
          ) v
          WHERE v.value IS NOT NULL
      ) cfv ON TRUE
      LEFT JOIN (
          SELECT DISTINCT icf.institute_id, icf.custom_field_id
          FROM institute_custom_fields icf
          JOIN custom_fields cf ON cf.id = icf.custom_field_id
          WHERE (:#{#customFieldStatus == null || #customFieldStatus.isEmpty()} = true OR icf.status IN (:customFieldStatus))
      ) icf
          ON icf.institute_id = ssigm.institute_id
          AND icf.custom_field_id = cfv.custom_field_id
      LEFT JOIN user_plan up ON up.id = ssigm.user_plan_id
      LEFT JOIN last_payments last_pl ON last_pl.user_plan_id = up.id
      LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
      LEFT JOIN institutes sub_org ON sub_org.id = ssigm.sub_org_id
      WHERE ssigm.user_id IN (:userIds)
        AND ssigm.institute_id IN (:instituteIds)
      GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
               ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
               last_pl.payment_status, s.user_id, s.address_line, s.region, s.city,
               s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
               s.billing_contact_role, ssigm.institute_enrollment_number,
               ssigm.institute_id, ssigm.group_id, ssigm.status, up.plan_json,
               up.payment_option_json, ssigm.destination_package_session_id,
               ssigm.user_plan_id, up.enroll_invite_id, ei.name,
               ssigm.source, ssigm.type, ssigm.type_id, ssigm.desired_level_id,
               ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
               s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date
      """)
  List<StudentListV2Projection> getStudentV2DataForUserIds(
      @Param("userIds") List<String> userIds,
      @Param("instituteIds") List<String> instituteIds,
      @Param("customFieldStatus") List<String> customFieldStatus);

  // ── SLIM enrichment for the manage-students list ──
  // isTrial is a correlated PK lookup on user_plan rather than another join: this query
  // deliberately avoids user_plan/payment_log joins, and one indexed probe per visible row
  // is cheaper than widening the join shape. Keep it out of the SQL as a comment — prose in
  // the query text breaks repository startup (see the note below).
  // Returns only what the table + side-view header read directly. Side-view tabs
  // hydrate their own data, so we skip user_plan/payment_log/enroll_invite joins
  // and the per-row paymentPlan/paymentOption JSON parsing.
  // Payment/plan/source/type columns are aliased as NULL so StudentListV2Projection
  // still maps cleanly without needing a separate projection.
  // Custom-field values: start from the rows this learner actually has instead of joining
  // every institute_custom_fields row per learner (thousands of definitions per institute,
  // mostly per-session / per-invite copies; that fan-out hit the statement timeout). Null
  // values are skipped; callers drop them anyway. Per field it yields the same candidates as the
  // old COALESCE(user-scoped, SSIGM-scoped) join: every USER-scoped value, plus the SSIGM-scoped
  // values only when the learner has no USER-scoped row for that field or one with a NULL value.
  // The institute field filter sits in the json_agg FILTER, not inside the LATERAL: there it is
  // uncorrelated, so Postgres hashes the institute's field ids once per call. Inside the LATERAL
  // it was re-planned per learner-enrolment row (a merge join over all custom_fields each time,
  // 18-84 ms for a 20-learner page). IS NOT NULL first keeps that hash unbuilt when the page has
  // no values at all.
  // Keep prose out of the SQL text: Spring Data does not understand -- comments, so a quote
  // there breaks repository startup.
  @Query(nativeQuery = true, value = """
      SELECT
          s.full_name         AS "fullName",
          s.email             AS "email",
          s.username          AS "username",
          s.mobile_number     AS "phone",
          ssigm.package_session_id AS "packageSessionId",
          CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS "accessDays",
          ssigm.enrolled_date AS "enrolledDate",
          (SELECT up.is_trial FROM user_plan up WHERE up.id = ssigm.user_plan_id) AS "isTrial",
          (SELECT up.end_date FROM user_plan up WHERE up.id = ssigm.user_plan_id) AS "planEndDate",
          (SELECT up.end_date FROM user_plan up WHERE up.id = ssigm.user_plan_id) AS "planEndDate",
          CAST(NULL AS text)  AS "paymentStatus",
          CAST(
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object('custom_field_id', cfv.custom_field_id, 'value', cfv.value)
              ) FILTER (WHERE cfv.custom_field_id IS NOT NULL AND cfv.custom_field_id IN (
                  SELECT icf.custom_field_id
                  FROM institute_custom_fields icf
                  WHERE icf.institute_id IN (:instituteIds)
                    AND (:#{#customFieldStatus == null || #customFieldStatus.isEmpty()} = true OR icf.status IN (:customFieldStatus))
              )), '[]'
            ) AS text
          ) AS "customFieldsJson",
          s.user_id AS "userId",
          s.id AS "id",
          s.address_line AS "addressLine",
          s.region AS "region",
          s.city AS "city",
          s.pin_code AS "pinCode",
          s.date_of_birth AS "dateOfBirth",
          s.gender AS "gender",
          s.fathers_name AS "fathersName",
          s.mothers_name AS "mothersName",
          s.parents_mobile_number AS "parentsMobileNumber",
          s.parents_email AS "parentsEmail",
          s.linked_institute_name AS "linkedInstituteName",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt",
          s.face_file_id AS "faceFileId",
          ssigm.expiry_date AS "expiryDate",
          s.parents_to_mother_mobile_number AS "parentsToMotherMobileNumber",
          s.parents_to_mother_email AS "parentsToMotherEmail",
          s.billing_contact_name AS "billingContactName",
          s.billing_contact_email AS "billingContactEmail",
          s.billing_contact_role AS "billingContactRole",
          ssigm.institute_enrollment_number AS "instituteEnrollmentNumber",
          ssigm.institute_id AS "instituteId",
          ssigm.group_id AS "groupId",
          ssigm.status AS "status",
          CAST(NULL AS text)  AS "paymentPlanJson",
          CAST(NULL AS text)  AS "paymentOptionJson",
          ssigm.destination_package_session_id AS "destinationPackageSessionId",
          ssigm.user_plan_id AS "userPlanId",
          CAST(NULL AS text)  AS "enrollInviteId",
          CAST(NULL AS text)  AS "enrollInviteName",
          CAST(NULL AS numeric) AS "paymentAmount",
          ssigm.source AS "source",
          ssigm.type AS "type",
          ssigm.type_id AS "typeId",
          ssigm.desired_level_id AS "desiredLevelId",
          ssigm.sub_org_id AS "subOrgId",
          sub_org.name AS "subOrgName",
          ssigm.comma_separated_org_roles AS "commaSeparatedOrgRoles",
          s.tnc_accepted AS "tncAccepted",
          s.tnc_file_id AS "tncFileId",
          s.tnc_accepted_date AS "tncAcceptedDate",
          CASE WHEN MAX(ssigm.id) IS NULL THEN TRUE ELSE FALSE END AS "isAudienceOnly"
      FROM student s
      -- LEFT JOIN so audience-only respondents (no ssigm row for this institute) still come back
      -- with null ssigm-derived columns.
      LEFT JOIN student_session_institute_group_mapping ssigm
          ON s.user_id = ssigm.user_id
          AND ssigm.institute_id IN (:instituteIds)
      LEFT JOIN LATERAL (
          SELECT v.custom_field_id, v.value
          FROM (
              SELECT cfv_user.custom_field_id, cfv_user.value
              FROM custom_field_values cfv_user
              WHERE cfv_user.source_type = 'USER'
                AND cfv_user.source_id = s.user_id
              UNION ALL
              SELECT cfv_ssigm.custom_field_id, cfv_ssigm.value
              FROM custom_field_values cfv_ssigm
              WHERE cfv_ssigm.source_type IN ('STUDENT_SESSION_INSTITUTE_GROUP_MAPPING', 'STUDENT_SESSION_MAPPING')
                AND cfv_ssigm.source_id = ssigm.id
                AND (
                    NOT EXISTS (
                        SELECT 1 FROM custom_field_values cfv_u
                        WHERE cfv_u.source_type = 'USER'
                          AND cfv_u.source_id = s.user_id
                          AND cfv_u.custom_field_id = cfv_ssigm.custom_field_id)
                    OR EXISTS (
                        SELECT 1 FROM custom_field_values cfv_u
                        WHERE cfv_u.source_type = 'USER'
                          AND cfv_u.source_id = s.user_id
                          AND cfv_u.custom_field_id = cfv_ssigm.custom_field_id
                          AND cfv_u.value IS NULL)
                )
          ) v
          WHERE v.value IS NOT NULL
      ) cfv ON TRUE
      LEFT JOIN institutes sub_org ON sub_org.id = ssigm.sub_org_id
      WHERE s.user_id IN (:userIds)
      GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
               ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
               s.user_id, s.address_line, s.region, s.city,
               s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
               s.parents_mobile_number, s.parents_email, s.linked_institute_name,
               s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
               s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
               s.billing_contact_role, ssigm.institute_enrollment_number,
               ssigm.institute_id, ssigm.group_id, ssigm.status,
               ssigm.destination_package_session_id, ssigm.user_plan_id,
               ssigm.source, ssigm.type, ssigm.type_id, ssigm.desired_level_id,
               ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
               s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date
      ORDER BY s.user_id,
               CASE
                   WHEN ssigm.status = 'ACTIVE' THEN 0
                   WHEN ssigm.status = 'INACTIVE' THEN 1
                   ELSE 2
               END,
               ssigm.enrolled_date DESC NULLS LAST
      """)
  List<StudentListV2Projection> getStudentSlimDataForUserIds(
      @Param("userIds") List<String> userIds,
      @Param("instituteIds") List<String> instituteIds,
      @Param("customFieldStatus") List<String> customFieldStatus);
}