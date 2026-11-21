package vacademy.io.assessment_service.features.open_evaluation.queue;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class QueueEtaServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");

    @Test
    void queued_eta_follows_the_spec_formula() {
        // lane cap 3, per-institute 3, 1 active institute: s = 3; pos 0 -> 1 round
        assertThat(QueueEtaService.queuedReadyAt(NOW, 0, 3, 3, 1, 270, 270)).isEqualTo(NOW.plusSeconds(540));
        // pos 5 -> ceil(6/3) = 2 rounds
        assertThat(QueueEtaService.queuedReadyAt(NOW, 5, 3, 3, 1, 270, 270)).isEqualTo(NOW.plusSeconds(810));
        // 3 active institutes share a cap of 3: s = 1, pos 2 -> 3 rounds
        assertThat(QueueEtaService.queuedReadyAt(NOW, 2, 3, 2, 3, 100, 60)).isEqualTo(NOW.plusSeconds(360));
        // more institutes than slots still gives s = 1
        assertThat(QueueEtaService.queuedReadyAt(NOW, 0, 3, 2, 10, 100, 60)).isEqualTo(NOW.plusSeconds(160));
    }

    @Test
    void running_eta_uses_the_pace_so_far_and_never_less_than_thirty_seconds() {
        Instant started = NOW.minusSeconds(60);
        // 3 of 10 done in 60 s -> 7 left at 20 s each
        assertThat(QueueEtaService.runningReadyAt(NOW, started, 270, 3, 10)).isEqualTo(NOW.plusSeconds(140));
        // no progress yet: started + T(bucket)
        assertThat(QueueEtaService.runningReadyAt(NOW, started, 270, 0, 10)).isEqualTo(started.plusSeconds(270));
        // overdue: floor of now + 30 s
        assertThat(QueueEtaService.runningReadyAt(NOW, NOW.minusSeconds(1000), 270, null, null))
                .isEqualTo(NOW.plusSeconds(30));
    }

    @Test
    void page_buckets_follow_section_11_4() {
        assertThat(QueueEtaService.bucket(3)).isZero();
        assertThat(QueueEtaService.bucket(6)).isEqualTo(1);
        assertThat(QueueEtaService.bucket(15)).isEqualTo(1);
        assertThat(QueueEtaService.bucket(40)).isEqualTo(2);
        assertThat(QueueEtaService.bucket(41)).isEqualTo(3);
    }

    @Test
    void medians_by_bucket_with_estimates_where_there_is_no_history() {
        List<long[]> history = new ArrayList<>();
        history.add(new long[]{3, 70});
        history.add(new long[]{4, 90});
        history.add(new long[]{2, 80});
        history.add(new long[]{12, 300});
        history.add(new long[]{-1, 1000});
        history.add(new long[]{12, 0}); // ignored

        QueueEtaService.Snapshot s = QueueEtaService.fromHistory(AiEvaluationLane.COPY, NOW, 2, 3, 3, history);

        assertThat(s.bucketMedianSeconds()[0]).isEqualTo(80);
        assertThat(s.bucketMedianSeconds()[1]).isEqualTo(300);
        assertThat(s.bucketMedianSeconds()[2]).isEqualTo(QueueEtaService.COPY_DEFAULT_SECONDS[2]);
        assertThat(s.laneMedianSeconds()).isEqualTo(90);
        assertThat(s.activeInstitutes()).isEqualTo(2);

        QueueEtaService.Snapshot typed = QueueEtaService.fromHistory(AiEvaluationLane.TYPED, NOW, 1, 12, 6, List.of());
        assertThat(typed.laneMedianSeconds()).isEqualTo(QueueEtaService.TYPED_DEFAULT_SECONDS);
    }
}
