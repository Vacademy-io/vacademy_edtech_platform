package vacademy.io.admin_core_service.features.capabilities.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;

import java.util.Collection;
import java.util.List;

public interface InstituteModulePolicyRepository extends JpaRepository<InstituteModulePolicy, String> {

    List<InstituteModulePolicy> findByInstituteIdIn(Collection<String> instituteIds);
}
