package vacademy.io.admin_core_service.features.learner_tracking.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AssessmentAnalysisStateTest {

    @Test
    void a_made_analysis_is_ready() {
        assertThat(AssessmentAnalysisState.of("processed", 1)).isEqualTo(AssessmentAnalysisState.READY);
    }

    @Test
    void queued_or_in_flight_or_retryable_is_pending() {
        assertThat(AssessmentAnalysisState.of("raw", 0)).isEqualTo(AssessmentAnalysisState.PENDING);
        assertThat(AssessmentAnalysisState.of("processing", 1)).isEqualTo(AssessmentAnalysisState.PENDING);
        assertThat(AssessmentAnalysisState.of("failed", 2)).isEqualTo(AssessmentAnalysisState.PENDING);
    }

    @Test
    void what_the_scheduler_will_not_take_again_gave_up() {
        assertThat(AssessmentAnalysisState.of("failed", 3)).isEqualTo(AssessmentAnalysisState.GAVE_UP);
        assertThat(AssessmentAnalysisState.of("skipped_no_credits", 1)).isEqualTo(AssessmentAnalysisState.GAVE_UP);
        assertThat(AssessmentAnalysisState.of("skipped_usage_limit", 0)).isEqualTo(AssessmentAnalysisState.GAVE_UP);
        assertThat(AssessmentAnalysisState.of("on_demand", 0)).isEqualTo(AssessmentAnalysisState.GAVE_UP);
    }

    @Test
    void no_row_is_none_and_an_unknown_status_keeps_waiting() {
        assertThat(AssessmentAnalysisState.of(null, 0)).isEqualTo(AssessmentAnalysisState.NONE);
        assertThat(AssessmentAnalysisState.of("something_new", 0)).isEqualTo(AssessmentAnalysisState.PENDING);
    }

    @Test
    void the_retry_limit_matches_the_scheduler() throws Exception {
        java.lang.reflect.Field f = ActivityLogProcessorService.class.getDeclaredField("MAX_PROCESSING_ATTEMPTS");
        f.setAccessible(true);
        assertThat(f.getInt(null)).isEqualTo(AssessmentAnalysisState.MAX_PROCESSING_ATTEMPTS);
    }
}
