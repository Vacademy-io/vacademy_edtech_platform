package vacademy.io.admin_core_service.features.common.repository;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;

import java.util.List;
import java.util.Optional;

@Repository
public interface InstituteCustomFieldRepository extends JpaRepository<InstituteCustomField, String> {

        @Transactional
        void deleteByCustomFieldId(String customFieldId);

        /**
         * Per-feature field list, ordered the way the admin arranged it on THAT form.
         *
         * <p>{@code icf.individualOrder} is the per-mapping position the feature's form
         * builder writes on every drag; {@code cf.formOrder} is the master catalog order
         * shared by every form that reuses the same custom field. Ordering by the master
         * order made a reordered form render in whatever sequence the field was first
         * created in — the arrangement saved in the builder was simply ignored. Fall back
         * to the master order only for legacy mappings that never got an individual order.
         */
        @Query("SELECT icf, cf FROM InstituteCustomField icf, CustomFields cf " +
                        "WHERE cf.id = icf.customFieldId " +
                        "AND icf.instituteId = :instituteId " +
                        "AND icf.type = :type " +
                        "AND icf.typeId = :typeId " +
                        "ORDER BY COALESCE(icf.individualOrder, cf.formOrder) ASC, cf.formOrder ASC")
        List<Object[]> findInstituteCustomFieldsWithDetails(
                        @Param("instituteId") String instituteId,
                        @Param("type") String type,
                        @Param("typeId") String typeId);

        @Query("SELECT icf, cf FROM InstituteCustomField icf, CustomFields cf " +
                        "WHERE cf.id = icf.customFieldId " +
                        "AND icf.instituteId = :instituteId " +
                        "AND icf.typeId IS NULL " +
                        "AND icf.status = :status " +
                        "ORDER BY cf.formOrder ASC")
        List<Object[]> findActiveInstituteCustomFieldsWithNullTypeId(
                        @Param("instituteId") String instituteId,
                        @Param("status") String status);

        @Modifying
        @Transactional
        @Query("UPDATE InstituteCustomField icf SET icf.status = :status WHERE icf.instituteId = :instituteId AND icf.type = :type AND icf.customFieldId = :customFieldId")
        int updateStatusByInstituteIdAndTypeAndCustomFieldId(
                        @Param("instituteId") String instituteId,
                        @Param("type") String type,
                        @Param("customFieldId") String customFieldId,
                        @Param("status") String status);

        @Query("""
                            SELECT icf, cf
                            FROM InstituteCustomField icf
                            JOIN CustomFields cf ON cf.id = icf.customFieldId
                            WHERE icf.instituteId = :instituteId
                              AND icf.status = :status
                              AND icf.id IN (
                                    SELECT MIN(icf2.id)
                                    FROM InstituteCustomField icf2
                                    JOIN CustomFields cf2 ON cf2.id = icf2.customFieldId
                                    WHERE icf2.instituteId = :instituteId
                                      AND icf2.status = :status
                                    GROUP BY cf2.fieldKey
                              )
                            ORDER BY cf.formOrder ASC
                        """)
        List<Object[]> findUniqueActiveCustomFieldsByInstituteId(
                        @Param("instituteId") String instituteId,
                        @Param("status") String status);

        @Query(value = """
                        SELECT icf.* FROM institute_custom_fields icf
                        JOIN custom_fields cf ON cf.id = icf.custom_field_id
                        WHERE icf.institute_id = :instituteId
                        AND cf.field_name = :fieldName
                        AND icf.status = 'ACTIVE'
                        """, nativeQuery = true)
        Optional<InstituteCustomField> findByInstituteIdAndFieldName(@Param("instituteId") String instituteId,
                        @Param("fieldName") String fieldName);

        Optional<InstituteCustomField> findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                        String instituteId,
                        String fieldId,
                        String type,
                        String typeId,
                        String status);

        List<InstituteCustomField> findByInstituteIdAndTypeAndTypeIdAndStatusIn(String instituteId, String type,
                        String typeId, List<String> status);

        List<InstituteCustomField> findByInstituteIdAndCustomFieldIdInAndStatusIn(String instituteId, List<String> list,
                        List<String> status);

        @Query("SELECT icf, cf FROM InstituteCustomField icf " +
                        "JOIN CustomFields cf ON cf.id = icf.customFieldId " +
                        "WHERE icf.instituteId = :instituteId " +
                        "AND icf.status = 'ACTIVE' " +
                        "ORDER BY cf.formOrder ASC")
        List<Object[]> findAllActiveCustomFieldsWithDetailsByInstituteId(@Param("instituteId") String instituteId);

        @Query("SELECT cf, icf.type, COUNT(icf.id) " +
                        "FROM InstituteCustomField icf " +
                        "JOIN CustomFields cf ON cf.id = icf.customFieldId " +
                        "WHERE icf.instituteId = :instituteId " +
                        "AND icf.status = 'ACTIVE' " +
                        "GROUP BY cf.id, cf.fieldName, cf.fieldType, cf.fieldKey, cf.defaultValue, cf.config, cf.formOrder, cf.isMandatory, cf.isFilter, cf.isSortable, cf.isHidden, cf.createdAt, cf.updatedAt, cf.status, icf.type")
        List<Object[]> findCustomFieldUsageAggregation(@Param("instituteId") String instituteId);

        /**
         * Check if a custom field is linked to an institute with a specific status
         */
        boolean existsByInstituteIdAndCustomFieldIdAndStatus(String instituteId, String customFieldId, String status);

        /** Ids among the given custom fields that are actively mapped to the institute. */
        @Query("SELECT DISTINCT icf.customFieldId FROM InstituteCustomField icf " +
                        "WHERE icf.instituteId = :instituteId " +
                        "AND icf.customFieldId IN :customFieldIds " +
                        "AND icf.status = 'ACTIVE'")
        List<String> findActiveCustomFieldIdsForInstitute(
                        @Param("instituteId") String instituteId,
                        @Param("customFieldIds") java.util.Collection<String> customFieldIds);
}
