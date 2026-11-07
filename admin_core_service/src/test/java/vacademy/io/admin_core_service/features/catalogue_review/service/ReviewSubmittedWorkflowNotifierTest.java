package vacademy.io.admin_core_service.features.catalogue_review.service;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewAnswer;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.TriggerContextKeyRegistry;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * REVIEW_SUBMITTED: the context a workflow sees, its keys matching what the
 * workflow catalog advertises, and a failing workflow never escaping.
 */
class ReviewSubmittedWorkflowNotifierTest {

    private static CatalogueReview review() {
        return CatalogueReview.builder().id("r1").instituteId("inst-1").rating(4).reviewerName("Asha")
                .reviewText("Clear teaching").city("Ajmer").catalogueTag("parcham-classes").pageRoute("home")
                .status("PENDING").createdAt(Timestamp.from(Instant.parse("2026-10-29T10:00:00Z"))).build();
    }

    @Test
    void context_carriesTheReview_withEmptyStringsForMissingFields() {
        Map<String, Object> ctx = ReviewSubmittedWorkflowNotifier.context(review(),
                List.of(new ReviewAnswer("f_exam", "Exam", "SSC"), new ReviewAnswer("f_goal", "Goal", "Clerk")));
        assertEquals(4, ctx.get("rating"));
        assertEquals("★★★★☆", ctx.get("ratingStars"));
        assertEquals("Asha", ctx.get("reviewerName"));
        assertEquals("", ctx.get("courseName"));
        assertEquals("Exam: SSC\nGoal: Clerk", ctx.get("answersText"));
        assertEquals("2026-10-29T10:00:00Z", ctx.get("submittedAt"));
        assertEquals("parcham-classes", ctx.get("siteTag"));
    }

    @Test
    void context_keys_areExactlyTheAuditedOnes() {
        Map<String, Object> ctx = ReviewSubmittedWorkflowNotifier.context(review(), null);
        var audited = new TriggerContextKeyRegistry(null).emittedKeys(WorkflowTriggerEvent.REVIEW_SUBMITTED.name());
        assertEquals(new java.util.TreeSet<>(audited), new java.util.TreeSet<>(ctx.keySet()));
    }

    @Test
    void fire_callsTheWorkflow_andSwallowsItsFailure() {
        ReviewSubmittedWorkflowNotifier notifier = new ReviewSubmittedWorkflowNotifier();
        WorkflowTriggerService trigger = mock(WorkflowTriggerService.class);
        ReflectionTestUtils.setField(notifier, "workflowTriggerService", trigger);
        notifier.fire(review(), List.of());
        verify(trigger).handleTriggerEvents(eq("REVIEW_SUBMITTED"), eq("r1"), eq("inst-1"), anyMap());

        when(trigger.handleTriggerEvents(any(), any(), any(), any())).thenThrow(new RuntimeException("boom"));
        assertDoesNotThrow(() -> notifier.fire(review(), List.of()));
        notifier.fire(null, null); // nothing to fire
        verify(trigger, times(2)).handleTriggerEvents(any(), any(), any(), any());
    }
}
