package vacademy.io.admin_core_service.features.capabilities.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlementId;

import java.util.Collection;
import java.util.List;

public interface InstituteModuleEntitlementRepository
        extends JpaRepository<InstituteModuleEntitlement, InstituteModuleEntitlementId> {

    List<InstituteModuleEntitlement> findByInstituteIdOrderByKeyAsc(String instituteId);

    List<InstituteModuleEntitlement> findByInstituteIdIn(Collection<String> instituteIds);
}
