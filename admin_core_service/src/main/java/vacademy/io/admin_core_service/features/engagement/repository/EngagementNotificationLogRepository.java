package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementNotificationLog;

import java.time.LocalDate;

@Repository
public interface EngagementNotificationLogRepository
        extends JpaRepository<EngagementNotificationLog, String> {

    boolean existsBySlotIdAndRunDate(String slotId, LocalDate runDate);

    boolean existsBySlotIdAndRunDateAndKind(String slotId, LocalDate runDate, String kind);
}
