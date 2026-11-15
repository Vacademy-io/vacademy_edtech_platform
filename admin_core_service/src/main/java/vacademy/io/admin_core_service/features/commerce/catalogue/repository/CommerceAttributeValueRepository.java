package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttributeValue;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceAttributeValueRepository extends JpaRepository<CommerceAttributeValue, String> {

    Optional<CommerceAttributeValue> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceAttributeValue> findByAttributeIdAndCode(String attributeId, String code);

    List<CommerceAttributeValue> findByInstituteIdAndIdIn(String instituteId, Collection<String> ids);

    List<CommerceAttributeValue> findByInstituteIdAndAttributeIdInOrderByPositionAsc(String instituteId,
                                                                                      Collection<String> attributeIds);

    boolean existsByInstituteIdAndAttributeId(String instituteId, String attributeId);
}
