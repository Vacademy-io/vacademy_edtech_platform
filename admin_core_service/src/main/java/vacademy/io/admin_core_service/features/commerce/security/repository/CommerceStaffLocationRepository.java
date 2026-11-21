package vacademy.io.admin_core_service.features.commerce.security.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;

import java.util.List;

public interface CommerceStaffLocationRepository extends JpaRepository<CommerceStaffLocation, String> {

    boolean existsByInstituteIdAndUserIdAndLocationId(String instituteId, String userId, String locationId);

    List<CommerceStaffLocation> findByInstituteIdAndUserId(String instituteId, String userId);
}
