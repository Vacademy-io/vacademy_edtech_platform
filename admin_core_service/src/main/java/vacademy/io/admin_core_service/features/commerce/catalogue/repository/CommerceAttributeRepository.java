package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttribute;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceAttributeRepository extends JpaRepository<CommerceAttribute, String> {

    Optional<CommerceAttribute> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceAttribute> findByInstituteIdAndCode(String instituteId, String code);

    List<CommerceAttribute> findByInstituteIdAndIdIn(String instituteId, Collection<String> ids);

    Page<CommerceAttribute> findByInstituteId(String instituteId, Pageable pageable);
}
