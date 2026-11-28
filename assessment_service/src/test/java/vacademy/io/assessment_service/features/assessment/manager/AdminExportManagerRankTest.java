package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The exported sheet must show the same rank as the learner's report: equal marks are split by
 * time taken (faster first), not by whatever order the database returned the rows in.
 */
class AdminExportManagerRankTest {

    @Test
    void equalMarksAreRankedByTimeTakenFastestFirst() {
        // UnlockX Class 12 JEE: nine learners on 100/100; the sheet had 6 min 26 s at rank 7.
        List<Double> marks = List.of(100.0, 100.0, 100.0, 100.0, 96.0);
        List<Long> seconds = List.of(461L, 636L, 386L, 1972L, 493L);

        assertThat(AdminExportManager.platformRanks(marks, seconds)).containsExactly(2, 3, 1, 4, 5);
    }

    @Test
    void anExactTieOnMarksAndTimeSharesARankAndTheNextRankFollowsOn() {
        List<Double> marks = List.of(80.0, 80.0, 70.0);
        List<Long> seconds = List.of(600L, 600L, 300L);

        assertThat(AdminExportManager.platformRanks(marks, seconds)).containsExactly(1, 1, 2);
    }

    @Test
    void missingMarksOrTimeRankLast() {
        List<Double> marks = Arrays.asList(null, 50.0, 50.0);
        List<Long> seconds = Arrays.asList(100L, null, 900L);

        assertThat(AdminExportManager.platformRanks(marks, seconds)).containsExactly(3, 2, 1);
    }

    @Test
    void rowsListedByNameStillGetTheirScoreRank() {
        // The older export lists learners alphabetically; the rank must not be the row number.
        List<Double> marks = List.of(40.0, 90.0, 65.0);
        List<Long> seconds = List.of(100L, 100L, 100L);

        assertThat(AdminExportManager.platformRanks(marks, seconds)).containsExactly(3, 1, 2);
    }
}
