package vacademy.io.admin_core_service.features.commerce.security.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceApproval;

import java.util.List;

public interface CommerceApprovalRepository extends JpaRepository<CommerceApproval, String> {

    List<CommerceApproval> findByInstituteIdAndReferenceTypeAndReferenceIdOrderByCreatedAtAsc(
            String instituteId, String referenceType, String referenceId);
}
