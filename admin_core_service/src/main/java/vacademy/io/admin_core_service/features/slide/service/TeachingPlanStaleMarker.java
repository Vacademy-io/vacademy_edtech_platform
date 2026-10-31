package vacademy.io.admin_core_service.features.slide.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;

/**
 * Live AI Tutor (docs/ai-tutor/LIVE_TUTOR_DESIGN.md §4.7): a slide's compiled
 * teaching plan is keyed on the published body, so publishing a slide again
 * must mark its READY plan STALE. The course page then offers "Prepare for
 * teaching" to recompile only the stale slides.
 *
 * <p>Deliberately a one-statement native update with no other coupling to the
 * plan tables (V494), and deliberately in its OWN transaction: a slide save
 * must never fail because of the tutor feature, and a failed native statement
 * inside the caller's transaction would mark it rollback-only even if caught.
 */
@Service
@Slf4j
public class TeachingPlanStaleMarker {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Marks the slide's READY teaching plans STALE when the save is a publish.
     * Draft and unsync saves change nothing learners see, so they leave the
     * plan alone. Never throws.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markStaleIfPublished(String slideId, String status) {
        if (!StringUtils.hasText(slideId) || status == null
                || !status.equalsIgnoreCase(SlideStatus.PUBLISHED.name())) {
            return;
        }
        try {
            int updated = entityManager.createNativeQuery(
                    "UPDATE teaching_plan SET status = 'STALE', updated_at = CURRENT_TIMESTAMP "
                            + "WHERE slide_id = :slideId AND status = 'READY'")
                    .setParameter("slideId", slideId)
                    .executeUpdate();
            if (updated > 0) {
                log.info("Teaching plan for slide {} marked STALE after publish ({} row(s))", slideId, updated);
            }
        } catch (Exception e) {
            log.warn("Could not mark teaching plan stale for slide {}: {}", slideId, e.getMessage());
        }
    }
}
