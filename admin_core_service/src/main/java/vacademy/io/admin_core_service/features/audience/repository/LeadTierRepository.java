package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;

import java.util.List;
import java.util.Optional;

@Repository
public interface LeadTierRepository extends JpaRepository<LeadTier, String> {

    List<LeadTier> findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(String instituteId);

    List<LeadTier> findByInstituteIdOrderByDisplayOrderAsc(String instituteId);

    Optional<LeadTier> findByInstituteIdAndTierKey(String instituteId, String tierKey);

    long countByInstituteId(String instituteId);
}
