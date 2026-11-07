package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgentAssistJob;

import java.util.Optional;

@Repository
public interface AiAgentAssistJobRepository extends JpaRepository<AiAgentAssistJob, String> {

    Optional<AiAgentAssistJob> findByIdAndInstituteId(String id, String instituteId);
}
