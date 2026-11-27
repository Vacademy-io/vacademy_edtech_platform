package vacademy.io.admin_core_service.features.one_off_due.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.one_off_due.entity.OneOffDue;

import java.util.List;

@Repository
public interface OneOffDueRepository extends JpaRepository<OneOffDue, String> {

    List<OneOffDue> findByUserIdAndInstituteIdOrderByCreatedAtDesc(String userId, String instituteId);

    List<OneOffDue> findByInstituteIdAndSourceTypeAndSourceId(String instituteId, String sourceType, String sourceId);
}
