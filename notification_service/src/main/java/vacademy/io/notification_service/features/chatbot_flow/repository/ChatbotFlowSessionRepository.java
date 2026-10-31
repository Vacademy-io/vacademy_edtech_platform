package vacademy.io.notification_service.features.chatbot_flow.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;

import java.util.List;
import java.util.Optional;

@Repository
public interface ChatbotFlowSessionRepository extends JpaRepository<ChatbotFlowSession, String> {

    Optional<ChatbotFlowSession> findFirstByInstituteIdAndUserPhoneAndStatusOrderByLastActivityAtDesc(
            String instituteId, String userPhone, String status);

    List<ChatbotFlowSession> findByFlowIdAndStatus(String flowId, String status);

    List<ChatbotFlowSession> findByFlowIdOrderByStartedAtDesc(String flowId);

    /** Every bot session a phone has had with an institute — to tell which flow sent an old message. */
    List<ChatbotFlowSession> findByInstituteIdAndUserPhone(String instituteId, String userPhone);
}
