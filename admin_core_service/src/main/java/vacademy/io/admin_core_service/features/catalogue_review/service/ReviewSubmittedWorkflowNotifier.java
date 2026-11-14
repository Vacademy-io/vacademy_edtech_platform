package vacademy.io.admin_core_service.features.catalogue_review.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewAnswer;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Fires the {@code REVIEW_SUBMITTED} workflow trigger for a new site review, off
 * the request thread: whatever the admin built on it (email the team, WhatsApp
 * a role, an in-app message ...) never slows down or fails the visitor's submit.
 * Errors are logged and swallowed.
 */
@Slf4j
@Component
public class ReviewSubmittedWorkflowNotifier {

    /** Lazy: the workflow service graph is wide; keeps a back-reference from ever forming a startup cycle. */
    @Autowired
    @Lazy
    private WorkflowTriggerService workflowTriggerService;

    @Async
    public void fire(CatalogueReview review, List<ReviewAnswer> answers) {
        if (review == null || review.getId() == null || review.getInstituteId() == null) return;
        try {
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.REVIEW_SUBMITTED.name(),
                    review.getId(),
                    review.getInstituteId(),
                    context(review, answers));
        } catch (Exception e) {
            log.warn("REVIEW_SUBMITTED workflow failed for review {}: {}", review.getId(), e.getMessage());
        }
    }

    /** The keys a workflow can use; kept in step with WorkflowCatalogController and TriggerContextKeyRegistry. */
    static Map<String, Object> context(CatalogueReview r, List<ReviewAnswer> answers) {
        int rating = r.getRating() == null ? 0 : r.getRating();
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("reviewId", r.getId());
        ctx.put("rating", rating);
        ctx.put("ratingStars", "★".repeat(Math.max(0, Math.min(5, rating))) + "☆".repeat(Math.max(0, 5 - rating)));
        ctx.put("reviewerName", nz(r.getReviewerName()));
        ctx.put("reviewText", nz(r.getReviewText()));
        ctx.put("courseName", nz(r.getCourseName()));
        ctx.put("city", nz(r.getCity()));
        ctx.put("designation", nz(r.getDesignation()));
        ctx.put("siteTag", nz(r.getCatalogueTag()));
        ctx.put("pageRoute", nz(r.getPageRoute()));
        ctx.put("reviewStatus", nz(r.getStatus()));
        ctx.put("submittedAt", r.getCreatedAt() == null ? "" : r.getCreatedAt().toInstant().toString());
        List<Map<String, String>> list = new ArrayList<>();
        StringBuilder text = new StringBuilder();
        if (answers != null) {
            for (ReviewAnswer a : answers) {
                if (a == null || a.getValue() == null) continue;
                list.add(Map.of("key", nz(a.getKey()), "label", nz(a.getLabel()), "value", a.getValue()));
                if (text.length() > 0) text.append('\n');
                text.append(nz(a.getLabel())).append(": ").append(a.getValue());
            }
        }
        ctx.put("answers", list);
        ctx.put("answersText", text.toString());
        return ctx;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
