package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.audience.entity.LeadContactHistory;

@Repository
public interface LeadContactHistoryRepository extends JpaRepository<LeadContactHistory, String> {
}
