package vacademy.io.admin_core_service.features.commerce.security.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffScope;

import java.util.Optional;

public interface CommerceStaffScopeRepository extends JpaRepository<CommerceStaffScope, String> {

    boolean existsByInstituteIdAndUserIdAndAllLocationsTrue(String instituteId, String userId);

    Optional<CommerceStaffScope> findByInstituteIdAndUserId(String instituteId, String userId);

    /**
     * Sets the scope of one staff member in one statement (insert or update), so two concurrent
     * writes for the same user never collide on the unique key. Needs a transaction. {@code id} is
     * used only when the row is new.
     */
    @Modifying
    @Query(value = """
            INSERT INTO commerce_staff_scope (id, institute_id, user_id, all_locations, set_by)
            VALUES (:id, :instituteId, :userId, :allLocations, :setBy)
            ON CONFLICT (institute_id, user_id)
            DO UPDATE SET all_locations = EXCLUDED.all_locations, set_by = EXCLUDED.set_by,
                updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    int upsert(@Param("id") String id,
               @Param("instituteId") String instituteId,
               @Param("userId") String userId,
               @Param("allLocations") boolean allLocations,
               @Param("setBy") String setBy);
}
