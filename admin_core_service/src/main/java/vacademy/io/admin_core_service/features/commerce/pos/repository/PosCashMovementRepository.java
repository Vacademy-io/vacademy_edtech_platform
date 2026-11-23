package vacademy.io.admin_core_service.features.commerce.pos.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosCashMovement;

import java.util.List;
import java.util.Optional;

public interface PosCashMovementRepository extends JpaRepository<PosCashMovement, String> {

    List<PosCashMovement> findByInstituteIdAndSessionIdOrderByCreatedAtAscIdAsc(String instituteId, String sessionId);

    Optional<PosCashMovement> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);
}
