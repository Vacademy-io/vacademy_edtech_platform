package vacademy.io.admin_core_service.features.telephony.publicapi.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallWebhook;

public interface AiCallWebhookRepository extends JpaRepository<AiCallWebhook, String> {
}
