package vacademy.io.admin_core_service.features.commerce.audit;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommerceAuditRepository extends JpaRepository<CommerceAudit, String> {

    Page<CommerceAudit> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);
}
