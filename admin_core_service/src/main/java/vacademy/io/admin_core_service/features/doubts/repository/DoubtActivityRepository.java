package vacademy.io.admin_core_service.features.doubts.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtActivity;

import java.util.List;

@Repository
public interface DoubtActivityRepository extends JpaRepository<DoubtActivity, String> {
    List<DoubtActivity> findByDoubtIdOrderByCreatedAtAsc(String doubtId);
}
