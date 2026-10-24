package vacademy.io.admin_core_service.features.capabilities.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlementLog;

public interface InstituteModuleEntitlementLogRepository extends JpaRepository<InstituteModuleEntitlementLog, String> {

    Page<InstituteModuleEntitlementLog> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);
}
