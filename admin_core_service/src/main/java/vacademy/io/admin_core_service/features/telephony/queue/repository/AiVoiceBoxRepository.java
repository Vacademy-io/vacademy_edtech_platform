package vacademy.io.admin_core_service.features.telephony.queue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiVoiceBox;

import java.util.List;
import java.util.Optional;

@Repository
public interface AiVoiceBoxRepository extends JpaRepository<AiVoiceBox, String> {

    Optional<AiVoiceBox> findBySlug(String slug);

    boolean existsBySlug(String slug);

    List<AiVoiceBox> findAllByOrderByPriorityAscSlugAsc();

    List<AiVoiceBox> findByEnabledTrue();
}
