package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;

import static org.assertj.core.api.Assertions.assertThat;

/** Lane caps per AI_EVALUATION_PUBLIC_API.md 11.2. */
class AiEvaluationLaneCapsTest {

    @Test
    void copyLaneDefaultsToThreeWithTheWholeLaneForOneInstitute() {
        AiEvaluationLaneCaps caps = new AiEvaluationLaneCaps(3, -1, -1, 12, 6, -1);
        assertThat(caps.laneCap(AiEvaluationLane.COPY)).isEqualTo(3);
        assertThat(caps.perInstituteCap(AiEvaluationLane.COPY)).isEqualTo(3);
        assertThat(caps.batch(AiEvaluationLane.COPY)).isEqualTo(3);
    }

    @Test
    void onceTheCopyLaneHasFourSlotsOneIsKeptForSomebodyElse() {
        assertThat(AiEvaluationLaneCaps.derivedInstituteCap(3)).isEqualTo(3);
        assertThat(AiEvaluationLaneCaps.derivedInstituteCap(4)).isEqualTo(3);
        assertThat(AiEvaluationLaneCaps.derivedInstituteCap(9)).isEqualTo(8);
        AiEvaluationLaneCaps caps = new AiEvaluationLaneCaps(6, -1, -1, 12, 6, -1);
        assertThat(caps.perInstituteCap(AiEvaluationLane.COPY)).isEqualTo(5);
    }

    @Test
    void typedLaneIsTwelveWithSixPerInstitute() {
        AiEvaluationLaneCaps caps = new AiEvaluationLaneCaps(3, -1, -1, 12, 6, -1);
        assertThat(caps.laneCap(AiEvaluationLane.TYPED)).isEqualTo(12);
        assertThat(caps.perInstituteCap(AiEvaluationLane.TYPED)).isEqualTo(6);
        assertThat(caps.batch(AiEvaluationLane.TYPED)).isEqualTo(12);
    }

    @Test
    void aConfiguredBatchIsACeilingNeverAboveTheLaneCap() {
        AiEvaluationLaneCaps caps = new AiEvaluationLaneCaps(3, -1, 5, 12, 6, 4);
        assertThat(caps.batch(AiEvaluationLane.COPY)).isEqualTo(3);
        assertThat(caps.batch(AiEvaluationLane.TYPED)).isEqualTo(4);
    }

    @Test
    void aPerInstituteCapNeverExceedsTheLane() {
        AiEvaluationLaneCaps caps = new AiEvaluationLaneCaps(3, 10, -1, 12, 20, -1);
        assertThat(caps.perInstituteCap(AiEvaluationLane.COPY)).isEqualTo(3);
        assertThat(caps.perInstituteCap(AiEvaluationLane.TYPED)).isEqualTo(12);
    }

    @Test
    void overridesAreSetPerLaneAndCleared() {
        AiEvaluationLaneCaps caps = new AiEvaluationLaneCaps(3, -1, -1, 12, 6, -1);
        caps.setOverride(AiEvaluationLane.TYPED, "inst-1", 10);
        assertThat(caps.overrides(AiEvaluationLane.TYPED)).containsEntry("inst-1", 10);
        assertThat(caps.overrides(AiEvaluationLane.COPY)).isEmpty();
        caps.setOverride(AiEvaluationLane.TYPED, "inst-1", null);
        assertThat(caps.overrides(AiEvaluationLane.TYPED)).isEmpty();
    }
}
