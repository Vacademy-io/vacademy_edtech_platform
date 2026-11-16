package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariantOptionValue;

import java.util.Collection;
import java.util.List;

public interface CommerceVariantOptionValueRepository extends JpaRepository<CommerceVariantOptionValue, String> {

    List<CommerceVariantOptionValue> findByInstituteIdAndPackageSessionIdIn(String instituteId,
                                                                           Collection<String> packageSessionIds);

    boolean existsByInstituteIdAndAttributeId(String instituteId, String attributeId);

    boolean existsByInstituteIdAndAttributeValueId(String instituteId, String attributeValueId);
}
