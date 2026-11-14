package vacademy.io.admin_core_service.features.common.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.common.entity.SystemFieldCustomFieldMapping;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface SystemFieldCustomFieldMappingRepository extends JpaRepository<SystemFieldCustomFieldMapping, String> {

    /**
     * Find all active mappings for an institute and entity type.
     */
    List<SystemFieldCustomFieldMapping> findByInstituteIdAndEntityTypeAndStatus(
            String instituteId, String entityType, String status);

    /**
     * Find mapping by custom field ID to determine what system field to update.
     */
    List<SystemFieldCustomFieldMapping> findByCustomFieldIdAndStatus(
            String customFieldId, String status);

    /**
     * Find mapping by system field to determine what custom field to update.
     */
    List<SystemFieldCustomFieldMapping> findByInstituteIdAndEntityTypeAndSystemFieldNameAndStatus(
            String instituteId, String entityType, String systemFieldName, String status);

    /**
     * Check if a mapping already exists for a specific combination.
     */
    Optional<SystemFieldCustomFieldMapping> findByInstituteIdAndEntityTypeAndSystemFieldNameAndCustomFieldIdAndStatus(
            String instituteId, String entityType, String systemFieldName, String customFieldId, String status);

    /**
     * Find all mappings that should sync when a custom field changes.
     * Returns mappings where sync direction allows custom → system sync.
     */
    @Query("SELECT m FROM SystemFieldCustomFieldMapping m " +
           "WHERE m.customFieldId = :customFieldId " +
           "AND m.status = 'ACTIVE' " +
           "AND m.syncDirection IN ('BIDIRECTIONAL', 'TO_SYSTEM')")
    List<SystemFieldCustomFieldMapping> findMappingsForCustomFieldSync(
            @Param("customFieldId") String customFieldId);

    /**
     * Ids among the given custom fields that have at least one mapping syncing custom → system.
     * Lets a batch of saved values skip the per-value lookup for unmapped fields.
     */
    @Query("SELECT DISTINCT m.customFieldId FROM SystemFieldCustomFieldMapping m " +
           "WHERE m.customFieldId IN :customFieldIds " +
           "AND m.status = 'ACTIVE' " +
           "AND m.syncDirection IN ('BIDIRECTIONAL', 'TO_SYSTEM')")
    List<String> findCustomFieldIdsWithSystemSync(
            @Param("customFieldIds") Collection<String> customFieldIds);

    /**
     * Find all mappings that should sync when a system field changes.
     * Returns mappings where sync direction allows system → custom sync.
     */
    @Query("SELECT m FROM SystemFieldCustomFieldMapping m " +
           "WHERE m.instituteId = :instituteId " +
           "AND m.entityType = :entityType " +
           "AND m.systemFieldName = :systemFieldName " +
           "AND m.status = 'ACTIVE' " +
           "AND m.syncDirection IN ('BIDIRECTIONAL', 'TO_CUSTOM')")
    List<SystemFieldCustomFieldMapping> findMappingsForSystemFieldSync(
            @Param("instituteId") String instituteId,
            @Param("entityType") String entityType,
            @Param("systemFieldName") String systemFieldName);

    /**
     * Find all mappings for an entity type to get all system fields that need custom field values.
     */
    @Query("SELECT m FROM SystemFieldCustomFieldMapping m " +
           "WHERE m.instituteId = :instituteId " +
           "AND m.entityType = :entityType " +
           "AND m.status = 'ACTIVE'")
    List<SystemFieldCustomFieldMapping> findAllMappingsForEntityType(
            @Param("instituteId") String instituteId,
            @Param("entityType") String entityType);
}
