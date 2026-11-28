package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductOption;

import java.util.List;

public interface CommerceProductOptionRepository extends JpaRepository<CommerceProductOption, String> {

    List<CommerceProductOption> findByInstituteIdAndPackageIdOrderByPositionAsc(String instituteId, String packageId);

    boolean existsByInstituteIdAndAttributeId(String instituteId, String attributeId);
}
