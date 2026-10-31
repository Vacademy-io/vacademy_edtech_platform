package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgentTestCall;

import java.util.Optional;

@Repository
public interface AiAgentTestCallRepository extends JpaRepository<AiAgentTestCall, String> {

    Optional<AiAgentTestCall> findByIdAndInstituteId(String id, String instituteId);
}
