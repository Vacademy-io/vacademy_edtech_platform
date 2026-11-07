package vacademy.io.notification_service.features.email_sending_controls.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.notification_service.features.email_sending_controls.entity.EmailUnsubscribe;

import java.util.Optional;

@Repository
public interface EmailUnsubscribeRepository extends JpaRepository<EmailUnsubscribe, String> {
    boolean existsByEmailAndInstituteIdAndIsActiveTrue(String email, String instituteId);
    Optional<EmailUnsubscribe> findByEmailAndInstituteId(String email, String instituteId);
    Page<EmailUnsubscribe> findByInstituteIdAndIsActiveTrueOrderByCreatedAtDesc(String instituteId, Pageable pageable);
    long countByInstituteIdAndIsActiveTrue(String instituteId);
}
