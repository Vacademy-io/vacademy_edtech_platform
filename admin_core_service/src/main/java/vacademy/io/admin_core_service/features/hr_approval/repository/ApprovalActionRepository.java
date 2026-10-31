package vacademy.io.admin_core_service.features.hr_approval.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_approval.entity.ApprovalAction;

import java.util.List;

@Repository
public interface ApprovalActionRepository extends JpaRepository<ApprovalAction, String> {

    List<ApprovalAction> findByRequestIdOrderByLevelAsc(String requestId);

    List<ApprovalAction> findByRequestIdAndActorId(String requestId, String actorId);
}
