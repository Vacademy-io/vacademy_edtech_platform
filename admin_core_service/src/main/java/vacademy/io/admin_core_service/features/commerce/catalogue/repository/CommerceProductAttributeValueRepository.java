package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductAttributeValue;

import java.util.List;

public interface CommerceProductAttributeValueRepository extends JpaRepository<CommerceProductAttributeValue, String> {

    List<CommerceProductAttributeValue> findByInstituteIdAndPackageId(String instituteId, String packageId);

    boolean existsByInstituteIdAndAttributeValueId(String instituteId, String attributeValueId);
}
