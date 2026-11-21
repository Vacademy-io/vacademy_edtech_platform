package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;

import java.util.List;
import java.util.Optional;

@Repository
public interface AiAgentRepository extends JpaRepository<AiAgent, String> {

    List<AiAgent> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    Optional<AiAgent> findByIdAndInstituteId(String id, String instituteId);

    /**
     * id, name, enabled of every agent of an institute, without the prompts: the queue's
     * pre-dial check resolves an item's agent by id or by name on every dispatch.
     */
    @org.springframework.data.jpa.repository.Query(
            "SELECT a.id, a.name, a.enabled FROM AiAgent a WHERE a.instituteId = :instituteId")
    List<Object[]> findIdNameEnabledByInstituteId(
            @org.springframework.data.repository.query.Param("instituteId") String instituteId);

    boolean existsByInstituteIdAndNameIgnoreCase(String instituteId, String name);

    /**
     * ai_agent.updated_at has no trigger and the entity maps it read-only, so without this an
     * edited agent kept its creation time as "updated".
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Query(value =
            "UPDATE ai_agent SET updated_at = CURRENT_TIMESTAMP WHERE id = :id", nativeQuery = true)
    int touchUpdatedAt(@org.springframework.data.repository.query.Param("id") String id);

    /**
     * Optimistic-concurrency claim for the public API's PATCH: bumps updated_at only when it
     * still equals the version the client read. 0 = someone saved the agent since.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Query(value =
            "UPDATE ai_agent SET updated_at = CURRENT_TIMESTAMP WHERE id = :id AND updated_at = :expected",
            nativeQuery = true)
    int claimVersion(@org.springframework.data.repository.query.Param("id") String id,
                     @org.springframework.data.repository.query.Param("expected") java.sql.Timestamp expected);

    /**
     * Bulk id -> agent name. Saving an agent auto-registers it as a VACADEMY_AI campaign
     * with {@code campaignId = agent id}, so this resolves the agent behind a queued or
     * placed call without loading the prompts, send rules and voice config with it.
     */
    @org.springframework.data.jpa.repository.Query("SELECT a.id, a.name FROM AiAgent a WHERE a.id IN :ids")
    List<Object[]> findIdAndNameByIds(@org.springframework.data.repository.query.Param("ids") java.util.Collection<String> ids);
}
