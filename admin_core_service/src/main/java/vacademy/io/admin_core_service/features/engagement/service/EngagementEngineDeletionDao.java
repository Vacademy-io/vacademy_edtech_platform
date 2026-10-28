package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

/**
 * Checks and deletes for removing an engine permanently. Only an engine that never reached anyone
 * (no message sent or attempted, no template sent to Meta) may be deleted; everything else is
 * archived so its record stays.
 */
@Repository
public class EngagementEngineDeletionDao {

    @PersistenceContext
    private EntityManager em;

    /** Messages this engine sent, is sending, or may have sent (FAILED = unknown outcome). */
    public long countReachedPeople(String engineId) {
        Number n = (Number) em.createNativeQuery("""
                SELECT count(*) FROM engagement_action
                 WHERE engine_id = :engineId AND status IN ('SENT', 'DISPATCHING', 'FAILED', 'UNKNOWN')
                """).setParameter("engineId", engineId).getSingleResult();
        return n.longValue();
    }

    /** WhatsApp templates of this engine that reached Meta (a notification template exists). */
    public long countTemplatesAtMeta(String engineId) {
        Number n = (Number) em.createNativeQuery("""
                SELECT count(*) FROM engagement_template_proposal
                 WHERE engine_id = :engineId AND notification_template_id IS NOT NULL
                """).setParameter("engineId", engineId).getSingleResult();
        return n.longValue();
    }

    /** Remove the engine and everything that belongs only to it. Call inside a transaction. */
    public void deleteEngineRows(String engineId, String instituteId) {
        for (String table : new String[]{"engagement_action", "engagement_member", "engagement_prompt_version",
                "engagement_template_proposal", "engagement_email_template"}) {
            em.createNativeQuery("DELETE FROM " + table + " WHERE engine_id = :engineId AND institute_id = :instituteId")
                    .setParameter("engineId", engineId).setParameter("instituteId", instituteId).executeUpdate();
        }
        em.createNativeQuery("DELETE FROM engagement_engine WHERE id = :engineId AND institute_id = :instituteId")
                .setParameter("engineId", engineId).setParameter("instituteId", instituteId).executeUpdate();
    }
}
