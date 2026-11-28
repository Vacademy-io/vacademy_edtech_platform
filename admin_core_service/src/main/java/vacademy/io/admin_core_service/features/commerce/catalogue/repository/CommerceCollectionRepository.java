package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCollection;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceCollectionRepository extends JpaRepository<CommerceCollection, String> {

    Optional<CommerceCollection> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceCollection> findByInstituteIdAndSlug(String instituteId, String slug);

    List<CommerceCollection> findByInstituteIdAndIdIn(String instituteId, Collection<String> ids);

    List<CommerceCollection> findByInstituteIdOrderByPositionAsc(String instituteId);

    Page<CommerceCollection> findByInstituteId(String instituteId, Pageable pageable);
}
