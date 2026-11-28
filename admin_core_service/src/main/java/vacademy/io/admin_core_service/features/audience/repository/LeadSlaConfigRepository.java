package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.audience.entity.LeadSlaConfig;

import java.util.List;
import java.util.Optional;

@Repository
public interface LeadSlaConfigRepository extends JpaRepository<LeadSlaConfig, String> {
    Optional<LeadSlaConfig> findByInstituteId(String instituteId);

    /** Institutes with TAT switched on — what the 1-minute TAT scan walks. */
    List<LeadSlaConfig> findByTatEnabledTrue();
}
