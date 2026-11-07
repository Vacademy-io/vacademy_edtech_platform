package vacademy.io.assessment_service.features.open_evaluation.submission;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.queue.QueueEtaService;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SubmissionViewsTest {

    private static final QueueEtaService.Estimate ETA =
            new QueueEtaService.Estimate(3L, Instant.parse("2026-10-01T11:40:00Z"));

    @Test
    void queued_copy_shows_position_and_eta_and_no_charge_yet() {
        Map<String, Object> out = SubmissionViews.status(SubmissionFixtures.view().build(), ETA);

        assertThat(out.get("status")).isEqualTo("queued");
        assertThat(out.get("lane")).isEqualTo("copy");
        assertThat(out.get("queue")).isEqualTo(Map.of("position", 3L, "estimated_ready_at", "2026-10-01T11:40:00Z"));
        assertThat(out.get("credits_charged")).isNull();
        assertThat(out.get("error")).isNull();
        assertThat(out.get("finalized")).isEqualTo(false);
        assertThat(out.get("state")).isEqualTo("live");
        assertThat(out).doesNotContainKey("email");
    }

    @Test
    void graded_copy_is_charged_its_quote_and_has_no_queue() {
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.processStatus = "COMPLETED";
        Map<String, Object> out = SubmissionViews.status(v.build(), ETA);

        assertThat(out.get("status")).isEqualTo("graded");
        assertThat(out.get("queue")).isNull();
        assertThat(out.get("credits_charged")).isEqualTo(12L);
    }

    @Test
    void failed_copy_is_free_and_carries_the_code() {
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.processStatus = "FAILED";
        v.error = "copy_unreadable: low OCR confidence";
        Map<String, Object> out = SubmissionViews.status(v.build(), null);

        assertThat(out.get("credits_charged")).isNull();
        assertThat(((Map<?, ?>) out.get("error")).get("code")).isEqualTo("copy_unreadable");
    }

    @Test
    void typed_without_ai_is_graded_at_zero_cost() {
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.processId = null;
        v.processStatus = null;
        v.mode = "typed";
        v.lane = null;
        Map<String, Object> out = SubmissionViews.status(v.build(), null);

        assertThat(out.get("status")).isEqualTo("graded");
        assertThat(out.get("credits_charged")).isEqualTo(0);
        assertThat(out.get("lane")).isEqualTo("typed");
        assertThat(out.get("progress")).isNull();
    }

    @Test
    void long_copy_needs_review_until_approved() {
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.reviewReasons = "[\"pages_beyond_vision_limit\"]";
        assertThat(SubmissionViews.needsReview(v.build())).isTrue();
        assertThat(SubmissionViews.submissionReasons(v.build())).containsExactly("pages_beyond_vision_limit");

        v.approvedAt = Instant.now();
        assertThat(SubmissionViews.needsReview(v.build())).isFalse();
    }

    @Test
    void running_copy_shows_eta_in_progress() {
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.processStatus = "EVALUATING";
        v.done = 3;
        v.total = 10;
        Map<String, Object> out = SubmissionViews.status(v.build(), new QueueEtaService.Estimate(null, ETA.estimatedReadyAt()));

        assertThat(out.get("status")).isEqualTo("grading");
        @SuppressWarnings("unchecked")
        Map<String, Object> progress = (Map<String, Object>) out.get("progress");
        assertThat(progress).containsEntry("questions_done", 3).containsEntry("questions_total", 10)
                .containsEntry("estimated_ready_at", "2026-10-01T11:40:00Z");
        assertThat(out.get("queue")).isNull();
    }

    @Test
    void rate_sources_hide_the_override_id() {
        assertThat(RateSources.publicName("override:abc-123")).isEqualTo("contract");
        assertThat(RateSources.publicName("partner:p1")).isEqualTo("contract");
        assertThat(RateSources.publicName("global")).isEqualTo("standard");
        assertThat(RateSources.publicName(null)).isEqualTo("standard");
    }
}
