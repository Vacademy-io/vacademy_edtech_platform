package vacademy.io.admin_core_service.features.institute_learner.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.common.util.CustomFieldValueSql;
import vacademy.io.admin_core_service.features.institute_learner.dto.projection.StudentListV2Projection;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Custom repository implementation for dynamic student queries with custom field filters.
 * Builds SQL queries dynamically based on customFieldFilters map.
 */
@Repository
public class InstituteStudentRepositoryImpl implements InstituteStudentRepositoryCustom {

    @PersistenceContext
    private EntityManager entityManager;

    // Custom-field values: start from the rows this enrollment actually has (SSIGM- or
    // USER-scoped, non-null) and keep those whose field is mapped to the enrollment's
    // institute. Joining the institute's field definitions per learner first multiplied every
    // row by thousands of fields (mostly per-session / per-invite copies) and hit the statement
    // timeout. institute_custom_fields also carries duplicate mapping rows per
    // (institute_id, custom_field_id), so the mapping side is deduped. Null values are skipped;
    // parseCustomFields drops them anyway.
    private static final String BASE_SELECT = """
            SELECT
                s.full_name         AS fullName,
                s.email             AS email,
                s.username          AS username,
                s.mobile_number     AS phone,
                ssigm.package_session_id AS packageSessionId,
                CAST(GREATEST(0, COALESCE(EXTRACT(DAY FROM (ssigm.expiry_date - ssigm.enrolled_date)), 0)) AS int) AS accessDays,
                last_pl.payment_status AS paymentStatus,
                CAST(
                  COALESCE(
                    json_agg(
                      DISTINCT jsonb_build_object(
                        'custom_field_id', icf.custom_field_id,
                        'value', cfv.value
                      )
                    ) FILTER (WHERE icf.custom_field_id IS NOT NULL), '[]'
                  ) AS text
                ) AS customFieldsJson,
                s.user_id AS userId,
                s.id AS id,
                s.address_line AS addressLine,
                s.region AS region,
                s.city AS city,
                s.pin_code AS pinCode,
                s.date_of_birth AS dateOfBirth,
                s.gender AS gender,
                s.fathers_name AS fathersName,
                s.mothers_name AS mothersName,
                s.parents_mobile_number AS parentsMobileNumber,
                s.parents_email AS parentsEmail,
                s.linked_institute_name AS linkedInstituteName,
                s.created_at AS createdAt,
                s.updated_at AS updatedAt,
                s.face_file_id AS faceFileId,
                ssigm.expiry_date AS expiryDate,
                s.parents_to_mother_mobile_number AS parentsToMotherMobileNumber,
                s.parents_to_mother_email AS parentsToMotherEmail,
                s.billing_contact_name AS billingContactName,
                s.billing_contact_email AS billingContactEmail,
                s.billing_contact_role AS billingContactRole,
                ssigm.institute_enrollment_number AS instituteEnrollmentNumber,
                ssigm.institute_id AS instituteId,
                ssigm.group_id AS groupId,
                ssigm.status AS status,
                up.plan_json AS paymentPlanJson,
                up.payment_option_json AS paymentOptionJson,
                ssigm.destination_package_session_id AS destinationPackageSessionId,
                ssigm.user_plan_id AS userPlanId,
                up.enroll_invite_id AS enrollInviteId,
                ei.name AS enrollInviteName,
                ssigm.desired_level_id AS desiredLevelId,
                ssigm.sub_org_id AS subOrgId,
                sub_org.name AS subOrgName,
                ssigm.comma_separated_org_roles AS commaSeparatedOrgRoles,
                s.tnc_accepted AS tncAccepted,
                s.tnc_file_id AS tncFileId,
                s.tnc_accepted_date AS tncAcceptedDate
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
            LEFT JOIN enroll_invite ei
                ON ei.id = up.enroll_invite_id
            LEFT JOIN LATERAL (
                SELECT pl.payment_status
                FROM payment_log pl
                WHERE pl.user_plan_id = up.id
                ORDER BY pl.date DESC NULLS LAST
                LIMIT 1
            ) last_pl ON TRUE
            LEFT JOIN institutes sub_org
                ON sub_org.id = ssigm.sub_org_id
            """;

    private static final String BASE_COUNT = """
            SELECT COUNT(DISTINCT s.id)
            FROM student s
            JOIN student_session_institute_group_mapping ssigm
                ON s.user_id = ssigm.user_id
            LEFT JOIN user_plan up
                ON up.id = ssigm.user_plan_id
            LEFT JOIN LATERAL (
                SELECT pl.payment_status
                FROM payment_log pl
                WHERE pl.user_plan_id = up.id
                ORDER BY pl.date DESC NULLS LAST
                LIMIT 1
            ) last_pl ON TRUE
            """;

    private static final String GROUP_BY = """
            GROUP BY s.id, s.username, s.full_name, s.email, s.mobile_number,
                     ssigm.package_session_id, ssigm.enrolled_date, ssigm.expiry_date,
                     last_pl.payment_status, s.user_id, s.address_line, s.region, s.city,
                     s.pin_code, s.date_of_birth, s.gender, s.fathers_name, s.mothers_name,
                     s.parents_mobile_number, s.parents_email, s.linked_institute_name,
                     s.created_at, s.updated_at, s.face_file_id, s.parents_to_mother_mobile_number,
                     s.parents_to_mother_email, s.billing_contact_name, s.billing_contact_email,
                     s.billing_contact_role, ssigm.institute_enrollment_number,
                     ssigm.institute_id, ssigm.group_id, ssigm.status, up.plan_json, up.payment_option_json, 
                     ssigm.destination_package_session_id, ssigm.user_plan_id, up.enroll_invite_id, ei.name,
                     ssigm.desired_level_id, ssigm.sub_org_id, sub_org.name, ssigm.comma_separated_org_roles,
                     s.tnc_accepted, s.tnc_file_id, s.tnc_accepted_date
            """;

    /**
     * Appends the enroll invite filter clause to the WHERE clause.
     * Logic: For PS with invite access, only show learners enrolled via those invites.
     * For PS without invite access, show all learners.
     */
    private void addListFilter(StringBuilder whereClause, Map<String, Object> parameters,
            String paramName, String column, List<String> values) {
        if (values != null && !values.isEmpty()) {
            whereClause.append("AND ").append(column).append(" IN (:").append(paramName).append(") ");
            parameters.put(paramName, values);
        }
    }

    /**
     * Scopes the list to a sub-org using CANONICAL membership: a learner belongs
     * to a sub-org if they are tagged to it (ssigm.sub_org_id) OR they enrolled
     * through one of that sub-org's invites (up.enroll_invite_id -> an enroll
     * invite whose sub_org_id matches). SUBORG_LEARNER self-enrollees have a NULL
     * ssigm.sub_org_id but their user_plan points at the sub-org invite, so a plain
     * `ssigm.sub_org_id IN (:subOrgIds)` dropped them from the Students tab while
     * the dashboard / seat-count (which use this same union) counted them. This
     * aligns the two. Only emitted when subOrgIds is present (parent-admin lists,
     * which send none, are unchanged).
     */
    private void appendSubOrgMembershipFilter(StringBuilder whereClause, Map<String, Object> parameters,
            List<String> subOrgIds) {
        if (subOrgIds != null && !subOrgIds.isEmpty()) {
            whereClause.append("AND (ssigm.sub_org_id IN (:subOrgIds) ");
            whereClause.append("  OR up.enroll_invite_id IN (SELECT ei_so.id FROM enroll_invite ei_so WHERE ei_so.sub_org_id IN (:subOrgIds))) ");
            parameters.put("subOrgIds", subOrgIds);
        }
    }

    private void appendEnrollInviteFilter(StringBuilder whereClause, Map<String, Object> parameters,
            List<String> enrollInviteIds, List<String> enrollInvitePackageSessionIds,
            List<String> subOrgIds) {
        if (enrollInviteIds != null && !enrollInviteIds.isEmpty()
                && enrollInvitePackageSessionIds != null && !enrollInvitePackageSessionIds.isEmpty()) {
            whereClause.append("AND ( ");
            whereClause.append("  (ssigm.package_session_id IN (:enrollInvitePsIds) AND up.enroll_invite_id IN (:enrollInviteIds)) ");
            whereClause.append("  OR ssigm.package_session_id NOT IN (:enrollInvitePsIds) ");
            // Canonical sub-org membership arm: a learner tagged to the sub-org
            // (ssigm.sub_org_id) belongs to it even if they enrolled via a host/
            // DEFAULT invite — the same UNION the seat-count / finance-detail
            // queries use. Without this the sub-org admin's Students tab dropped
            // such learners while the dashboard counted them. :subOrgIds is
            // already bound by addListFilter when the FE sends sub_org_ids.
            if (subOrgIds != null && !subOrgIds.isEmpty()) {
                whereClause.append("  OR ssigm.sub_org_id IN (:subOrgIds) ");
            }
            whereClause.append(") ");
            parameters.put("enrollInviteIds", enrollInviteIds);
            parameters.put("enrollInvitePsIds", enrollInvitePackageSessionIds);
        }
    }

    /**
     * ORDER BY fragment for custom-field sorting: the learner's latest
     * USER-scoped answer for the field, numeric-aware (numeric-looking values
     * order numerically before the text fallback), rows without an answer
     * last. Direction is whitelisted to ASC/DESC — never interpolated raw.
     * The :sortCustomFieldId parameter is bound on the MAIN query only (the
     * count query has no ORDER BY).
     */
    private String buildCustomFieldSortOrderBy(String sortCustomFieldId, String direction) {
        if (sortCustomFieldId == null || sortCustomFieldId.isBlank()) {
            return "";
        }
        String dir = "ASC".equalsIgnoreCase(direction) ? "ASC" : "DESC";
        String sub = "(SELECT scf.value FROM custom_field_values scf"
                + " WHERE scf.source_type = 'USER' AND scf.source_id = s.user_id"
                + " AND scf.custom_field_id = :sortCustomFieldId"
                + " ORDER BY scf.updated_at DESC NULLS LAST LIMIT 1)";
        String numericKey = "(CASE WHEN " + sub + " ~ '^-?[0-9]+([.][0-9]+)?$'"
                + " THEN CAST(" + sub + " AS numeric) END)";
        return " ORDER BY " + numericKey + " " + dir + " NULLS LAST, "
                + sub + " " + dir + " NULLS LAST";
    }

    /** Applies the pre-resolved typed custom-field filter sets (matched → IN, excluded → NOT IN). */
    private void appendTypedCustomFieldFilter(StringBuilder whereClause, Map<String, Object> parameters,
            List<String> cfTypedMatchedUserIds, List<String> cfTypedExcludedUserIds) {
        // CSV + ANY(STRING_TO_ARRAY) keeps each set a single bind parameter —
        // a broad match (e.g. NOT_EMPTY on a common field) can exceed the
        // 32k JDBC bind limit as an expanded IN list.
        if (cfTypedMatchedUserIds != null && !cfTypedMatchedUserIds.isEmpty()) {
            whereClause.append("AND ssigm.user_id = ANY(STRING_TO_ARRAY(:cfTypedMatchedUserIdsCsv, ',')) ");
            parameters.put("cfTypedMatchedUserIdsCsv", String.join(",", cfTypedMatchedUserIds));
        }
        if (cfTypedExcludedUserIds != null && !cfTypedExcludedUserIds.isEmpty()) {
            whereClause.append("AND NOT (ssigm.user_id = ANY(STRING_TO_ARRAY(:cfTypedExcludedUserIdsCsv, ','))) ");
            parameters.put("cfTypedExcludedUserIdsCsv", String.join(",", cfTypedExcludedUserIds));
        }
    }

    @Override
    public Page<StudentListV2Projection> getAllStudentV2WithSearchAndCustomFieldFilters(
            String name,
            List<String> instituteIds,
            List<String> statuses,
            List<String> paymentStatuses,
            List<String> customFieldStatus,
            List<String> sources,
            List<String> types,
            List<String> typeIds,
            List<String> destinationPackageSessionIds,
            List<String> levelIds,
            List<String> subOrgUserTypes,
            List<String> subOrgIds,
            Map<String, List<String>> customFieldFilters,
            LocalDate startDate,
            LocalDate endDate,
            List<String> enrollInviteIds,
            List<String> enrollInvitePackageSessionIds,
            List<String> cfTypedMatchedUserIds,
            List<String> cfTypedExcludedUserIds,
            String sortCustomFieldId,
            String sortCustomFieldDirection,
            Pageable pageable) {

        StringBuilder whereClause = new StringBuilder(" WHERE (");
        
        // Search conditions
        whereClause.append("(s.full_name IS NOT NULL AND s.full_name != '' AND s.full_name ILIKE '%' || :name || '%') ");
        whereClause.append("OR (s.username IS NOT NULL AND s.username != '' AND s.username ILIKE '%' || :name || '%') ");
        whereClause.append("OR (s.email IS NOT NULL AND s.email != '' AND s.email ILIKE '%' || :name || '%') ");
        whereClause.append("OR (s.city IS NOT NULL AND s.city != '' AND s.city ILIKE '%' || :name || '%') ");
        whereClause.append("OR (ssigm.institute_enrollment_number IS NOT NULL AND ssigm.institute_enrollment_number != '' AND ssigm.institute_enrollment_number ILIKE '%' || :name || '%') ");
        whereClause.append("OR (s.user_id IS NOT NULL AND s.user_id != '' AND s.user_id ILIKE '%' || :name || '%') ");
        whereClause.append("OR (s.mobile_number IS NOT NULL AND s.mobile_number != '' AND s.mobile_number ILIKE '%' || :name || '%') ");
        whereClause.append("OR EXISTS (");
        whereClause.append("  SELECT 1 FROM custom_field_values cfv_inner ");
        whereClause.append("  WHERE cfv_inner.source_type = 'USER' ");
        whereClause.append("    AND cfv_inner.source_id = ssigm.user_id ");
        whereClause.append("    AND cfv_inner.value IS NOT NULL ");
        whereClause.append("    AND cfv_inner.value != '' ");
        whereClause.append("    AND LOWER(cfv_inner.value) LIKE LOWER('%' || :name || '%') ");
        whereClause.append(") ");
        whereClause.append(") ");

        // Standard filters — only add when non-null/non-empty to avoid PostgreSQL null type errors
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("name", name);
        addListFilter(whereClause, parameters, "instituteIds", "ssigm.institute_id", instituteIds);
        addListFilter(whereClause, parameters, "statuses", "ssigm.status", statuses);
        addListFilter(whereClause, parameters, "paymentStatuses", "last_pl.payment_status", paymentStatuses);
        addListFilter(whereClause, parameters, "sources", "ssigm.source", sources);
        addListFilter(whereClause, parameters, "types", "ssigm.type", types);
        addListFilter(whereClause, parameters, "typeIds", "ssigm.type_id", typeIds);
        addListFilter(whereClause, parameters, "destinationPackageSessionIds", "ssigm.destination_package_session_id", destinationPackageSessionIds);
        addListFilter(whereClause, parameters, "levelIds", "ssigm.desired_level_id", levelIds);
        appendSubOrgMembershipFilter(whereClause, parameters, subOrgIds);

        // Date range filter
        if (startDate != null && endDate != null) {
            whereClause.append("AND (ssigm.enrolled_date <= :endDate AND (ssigm.expiry_date >= :startDate OR ssigm.expiry_date IS NULL)) ");
            parameters.put("startDate", startDate);
            parameters.put("endDate", endDate);
        }

        // Sub org user types filter
        if (subOrgUserTypes != null && !subOrgUserTypes.isEmpty()) {
            whereClause.append("AND (ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != '' ");
            whereClause.append("AND EXISTS (SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role ");
            whereClause.append("WHERE TRIM(role) IN (:subOrgUserTypes))) ");
            parameters.put("subOrgUserTypes", subOrgUserTypes);
        }

        if (customFieldFilters != null && !customFieldFilters.isEmpty()) {
            int filterIndex = 0;
            for (Map.Entry<String, List<String>> entry : customFieldFilters.entrySet()) {
                String fieldId = entry.getKey();
                List<String> values = entry.getValue();
                
                String paramFieldId = "customFieldId" + filterIndex;
                String paramValues = "customFieldValues" + filterIndex;
                
                whereClause.append("AND EXISTS ( ");
                whereClause.append("  SELECT 1 FROM custom_field_values cfv_filter").append(filterIndex).append(" ");
                whereClause.append("  WHERE cfv_filter").append(filterIndex).append(".source_type = 'USER' ");
                whereClause.append("    AND cfv_filter").append(filterIndex).append(".source_id = ssigm.user_id ");
                whereClause.append("    AND cfv_filter").append(filterIndex).append(".custom_field_id = :").append(paramFieldId).append(" ");
                whereClause.append("    AND ")
                        .append(CustomFieldValueSql.matchesAnyOf("cfv_filter" + filterIndex + ".value", paramValues))
                        .append(" ");
                whereClause.append(") ");
                
                parameters.put(paramFieldId, fieldId);
                parameters.put(paramValues, values);
                filterIndex++;
            }
        }

        // Typed custom-field filters (operator-aware: CONTAINS / IS_EMPTY / ranges),
        // pre-resolved by CustomFieldListFilterResolver into user-id sets — one
        // indexed lookup per field upstream, plain IN/NOT IN predicates here.
        appendTypedCustomFieldFilter(whereClause, parameters, cfTypedMatchedUserIds, cfTypedExcludedUserIds);

        // Enroll invite filter
        appendEnrollInviteFilter(whereClause, parameters, enrollInviteIds, enrollInvitePackageSessionIds, subOrgIds);

        // Build main query
        String mainQuery = BASE_SELECT + whereClause.toString() + GROUP_BY
                + buildCustomFieldSortOrderBy(sortCustomFieldId, sortCustomFieldDirection);
        String countQuery = BASE_COUNT + whereClause.toString();

        // Execute count query
        Query nativeCountQuery = entityManager.createNativeQuery(countQuery);
        setParameters(nativeCountQuery, parameters);
        long total = ((Number) nativeCountQuery.getSingleResult()).longValue();

        // Execute main query with pagination (includes customFieldStatus for the JOIN)
        Query nativeQuery = entityManager.createNativeQuery(mainQuery, jakarta.persistence.Tuple.class);
        setParameters(nativeQuery, parameters);
        nativeQuery.setParameter("customFieldStatus", customFieldStatus);
        if (sortCustomFieldId != null && !sortCustomFieldId.isBlank()) {
            nativeQuery.setParameter("sortCustomFieldId", sortCustomFieldId);
        }
        nativeQuery.setFirstResult((int) pageable.getOffset());
        nativeQuery.setMaxResults(pageable.getPageSize());

        List<StudentListV2Projection> content = mapTuplesToProjections(nativeQuery);

        return new PageImpl<>(content, pageable, total);
    }

    @Override
    public Page<StudentListV2Projection> getAllStudentV2WithFilterAndCustomFieldFilters(
            List<String> statuses,
            List<String> gender,
            List<String> instituteIds,
            List<String> groupIds,
            List<String> packageSessionIds,
            List<String> paymentStatuses,
            List<String> customFieldStatus,
            List<String> sources,
            List<String> types,
            List<String> typeIds,
            List<String> destinationPackageSessionIds,
            List<String> levelIds,
            List<String> subOrgUserTypes,
            List<String> subOrgIds,
            Map<String, List<String>> customFieldFilters,
            LocalDate startDate,
            LocalDate endDate,
            List<String> enrollInviteIds,
            List<String> enrollInvitePackageSessionIds,
            List<String> cfTypedMatchedUserIds,
            List<String> cfTypedExcludedUserIds,
            String sortCustomFieldId,
            String sortCustomFieldDirection,
            Pageable pageable) {

        StringBuilder whereClause = new StringBuilder(" WHERE 1=1 ");
        Map<String, Object> parameters = new HashMap<>();

        // Only add WHERE conditions when the list is non-null and non-empty (avoids PostgreSQL null type errors)
        addListFilter(whereClause, parameters, "statuses", "ssigm.status", statuses);
        addListFilter(whereClause, parameters, "gender", "s.gender", gender);
        addListFilter(whereClause, parameters, "instituteIds", "ssigm.institute_id", instituteIds);
        addListFilter(whereClause, parameters, "groupIds", "ssigm.group_id", groupIds);
        addListFilter(whereClause, parameters, "packageSessionIds", "ssigm.package_session_id", packageSessionIds);
        addListFilter(whereClause, parameters, "paymentStatuses", "last_pl.payment_status", paymentStatuses);
        addListFilter(whereClause, parameters, "sources", "ssigm.source", sources);
        addListFilter(whereClause, parameters, "types", "ssigm.type", types);
        addListFilter(whereClause, parameters, "typeIds", "ssigm.type_id", typeIds);
        addListFilter(whereClause, parameters, "destinationPackageSessionIds", "ssigm.destination_package_session_id", destinationPackageSessionIds);
        addListFilter(whereClause, parameters, "levelIds", "ssigm.desired_level_id", levelIds);
        appendSubOrgMembershipFilter(whereClause, parameters, subOrgIds);

        // Date range filter
        if (startDate != null && endDate != null) {
            whereClause.append("AND (ssigm.enrolled_date <= :endDate AND (ssigm.expiry_date >= :startDate OR ssigm.expiry_date IS NULL)) ");
            parameters.put("startDate", startDate);
            parameters.put("endDate", endDate);
        }

        // Sub org user types filter
        if (subOrgUserTypes != null && !subOrgUserTypes.isEmpty()) {
            whereClause.append("AND (ssigm.comma_separated_org_roles IS NOT NULL AND ssigm.comma_separated_org_roles != '' ");
            whereClause.append("AND EXISTS (SELECT 1 FROM unnest(string_to_array(ssigm.comma_separated_org_roles, ',')) AS role ");
            whereClause.append("WHERE TRIM(role) IN (:subOrgUserTypes))) ");
            parameters.put("subOrgUserTypes", subOrgUserTypes);
        }

        if (customFieldFilters != null && !customFieldFilters.isEmpty()) {
            int filterIndex = 0;
            for (Map.Entry<String, List<String>> entry : customFieldFilters.entrySet()) {
                String fieldId = entry.getKey();
                List<String> values = entry.getValue();
                
                String paramFieldId = "customFieldId" + filterIndex;
                String paramValues = "customFieldValues" + filterIndex;
                
                whereClause.append("AND EXISTS ( ");
                whereClause.append("  SELECT 1 FROM custom_field_values cfv_filter").append(filterIndex).append(" ");
                whereClause.append("  WHERE cfv_filter").append(filterIndex).append(".source_type = 'USER' ");
                whereClause.append("    AND cfv_filter").append(filterIndex).append(".source_id = ssigm.user_id ");
                whereClause.append("    AND cfv_filter").append(filterIndex).append(".custom_field_id = :").append(paramFieldId).append(" ");
                whereClause.append("    AND ")
                        .append(CustomFieldValueSql.matchesAnyOf("cfv_filter" + filterIndex + ".value", paramValues))
                        .append(" ");
                whereClause.append(") ");
                
                parameters.put(paramFieldId, fieldId);
                parameters.put(paramValues, values);
                filterIndex++;
            }
        }

        // Typed custom-field filters (operator-aware: CONTAINS / IS_EMPTY / ranges),
        // pre-resolved by CustomFieldListFilterResolver into user-id sets — one
        // indexed lookup per field upstream, plain IN/NOT IN predicates here.
        appendTypedCustomFieldFilter(whereClause, parameters, cfTypedMatchedUserIds, cfTypedExcludedUserIds);

        // Enroll invite filter
        appendEnrollInviteFilter(whereClause, parameters, enrollInviteIds, enrollInvitePackageSessionIds, subOrgIds);

        // Build main query
        String mainQuery = BASE_SELECT + whereClause.toString() + GROUP_BY
                + buildCustomFieldSortOrderBy(sortCustomFieldId, sortCustomFieldDirection);
        String countQuery = BASE_COUNT + whereClause.toString();

        // Execute count query
        Query nativeCountQuery = entityManager.createNativeQuery(countQuery);
        setParameters(nativeCountQuery, parameters);
        long total = ((Number) nativeCountQuery.getSingleResult()).longValue();

        // Execute main query with pagination (includes customFieldStatus for the JOIN)
        Query nativeQuery = entityManager.createNativeQuery(mainQuery, jakarta.persistence.Tuple.class);
        setParameters(nativeQuery, parameters);
        nativeQuery.setParameter("customFieldStatus", customFieldStatus);
        if (sortCustomFieldId != null && !sortCustomFieldId.isBlank()) {
            nativeQuery.setParameter("sortCustomFieldId", sortCustomFieldId);
        }
        nativeQuery.setFirstResult((int) pageable.getOffset());
        nativeQuery.setMaxResults(pageable.getPageSize());

        List<StudentListV2Projection> content = mapTuplesToProjections(nativeQuery);

        return new PageImpl<>(content, pageable, total);
    }

    @SuppressWarnings("unchecked")
    private List<StudentListV2Projection> mapTuplesToProjections(Query nativeQuery) {
        List<jakarta.persistence.Tuple> tuples = nativeQuery.getResultList();
        return tuples.stream().map(t -> new StudentListV2Projection() {
            private String str(String col) { try { return t.get(col, String.class); } catch (Exception e) { return null; } }
            private Integer intVal(String col) { try { Object v = t.get(col); return v == null ? null : ((Number) v).intValue(); } catch (Exception e) { return null; } }
            private Double dblVal(String col) { try { Object v = t.get(col); return v == null ? null : ((Number) v).doubleValue(); } catch (Exception e) { return null; } }
            public String getFullName() { return str("fullname"); }
            public String getEmail() { return str("email"); }
            public String getUsername() { return str("username"); }
            public String getPhone() { return str("phone"); }
            public String getPackageSessionId() { return str("packagesessionid"); }
            public Integer getAccessDays() { return intVal("accessdays"); }
            public String getPaymentStatus() { return str("paymentstatus"); }
            public String getCustomFieldsJson() { return str("customfieldsjson"); }
            public String getUserId() { return str("userid"); }
            public String getId() { return str("id"); }
            public String getAddressLine() { return str("addressline"); }
            public String getRegion() { return str("region"); }
            public String getCity() { return str("city"); }
            public String getPinCode() { return str("pincode"); }
            public String getDateOfBirth() { return str("dateofbirth"); }
            public String getGender() { return str("gender"); }
            public String getFathersName() { return str("fathersname"); }
            public String getMothersName() { return str("mothersname"); }
            public String getParentsMobileNumber() { return str("parentsmobilenumber"); }
            public String getParentsEmail() { return str("parentsemail"); }
            public String getLinkedInstituteName() { return str("linkedinstitutename"); }
            public String getCreatedAt() { return str("createdat"); }
            public String getUpdatedAt() { return str("updatedat"); }
            public String getFaceFileId() { return str("facefileid"); }
            public String getExpiryDate() { return str("expirydate"); }
            public String getEnrolledDate() { return str("enrolleddate"); }
            public String getPlanEndDate() { return str("planenddate"); }
            public Boolean getIsTrial() { try { Object v = t.get("istrial"); return v == null ? null : (Boolean) v; } catch (Exception e) { return null; } }
            public String getParentsToMotherMobileNumber() { return str("parentstomothermobilenumber"); }
            public String getParentsToMotherEmail() { return str("parentstomotheremail"); }
            public String getBillingContactName() { return str("billingcontactname"); }
            public String getBillingContactEmail() { return str("billingcontactemail"); }
            public String getBillingContactRole() { return str("billingcontactrole"); }
            public String getInstituteEnrollmentNumber() { return str("instituteenrollmentnumber"); }
            public String getInstituteId() { return str("instituteid"); }
            public String getGroupId() { return str("groupid"); }
            public String getStatus() { return str("status"); }
            public String getPaymentPlanJson() { return str("paymentplanjson"); }
            public String getPaymentOptionJson() { return str("paymentoptionjson"); }
            public String getDestinationPackageSessionId() { return str("destinationpackagesessionid"); }
            public String getEnrollInviteId() { return str("enrollinviteid"); }
            public String getEnrollInviteName() { return str("enrollinvitename"); }
            public Double getPaymentAmount() { return dblVal("paymentamount"); }
            public String getSource() { return str("source"); }
            public String getType() { return str("type"); }
            public String getTypeId() { return str("typeid"); }
            public String getDesiredLevelId() { return str("desiredlevelid"); }
            public String getSubOrgId() { return str("suborgid"); }
            public String getSubOrgName() { return str("suborgname"); }
            public String getCommaSeparatedOrgRoles() { return str("commaseparatedorgroles"); }
            public Boolean getTncAccepted() { try { Object v = t.get("tncaccepted"); return v == null ? null : (Boolean) v; } catch (Exception e) { return null; } }
            public String getTncFileId() { return str("tncfileid"); }
            public java.util.Date getTncAcceptedDate() { try { return t.get("tncaccepteddate", java.util.Date.class); } catch (Exception e) { return null; } }
            // Custom-repo paths (heavy filter combinations) still inner-join ssigm, so audience-only
            // rows never reach this mapper. Return false rather than null to keep the flag well-typed.
            public Boolean getIsAudienceOnly() { try { Object v = t.get("isaudienceonly"); return v == null ? Boolean.FALSE : (Boolean) v; } catch (Exception e) { return Boolean.FALSE; } }
        }).collect(java.util.stream.Collectors.toList());
    }

    private void setParameters(Query query, Map<String, Object> parameters) {
        for (Map.Entry<String, Object> entry : parameters.entrySet()) {
            query.setParameter(entry.getKey(), entry.getValue());
        }
    }
}