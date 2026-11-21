package vacademy.io.notification_service.features.external_communication_log.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import vacademy.io.notification_service.features.external_communication_log.entity.ExternalCommunicationLog;

public interface ExternalCommunicationLogRepository extends JpaRepository<ExternalCommunicationLog, String>,
        JpaSpecificationExecutor<ExternalCommunicationLog> {
}
