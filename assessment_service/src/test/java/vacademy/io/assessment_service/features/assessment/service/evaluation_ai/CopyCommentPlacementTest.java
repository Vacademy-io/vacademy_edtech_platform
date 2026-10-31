package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;

/**
 * The checked-copy template resolution. The usual copy (null on the request) must
 * stay the answer for every institute and assessment that never chose otherwise,
 * and for every failure on the way.
 */
class CopyCommentPlacementTest {

    @Test
    void nothing_chosen_anywhere_is_the_usual_copy() {
        assertThat(CopyCommentPlacement.effective(null, null)).isNull();
        assertThat(CopyCommentPlacement.effective(null, () -> "")).isNull();
        assertThat(CopyCommentPlacement.effective(null, () -> null)).isNull();
        assertThat(CopyCommentPlacement.effective(null, () -> "garbage")).isNull();
    }

    @Test
    void a_failed_institute_lookup_is_the_usual_copy() {
        assertThat(CopyCommentPlacement.effective(null, () -> {
            throw new IllegalStateException("admin-core down");
        })).isNull();
    }

    @Test
    void institute_default_applies_only_when_the_assessment_has_no_choice() {
        assertThat(CopyCommentPlacement.effective(null, () -> "OUTSIDE")).isEqualTo("OUTSIDE");
        assertThat(CopyCommentPlacement.effective(null, () -> "outside")).isEqualTo("OUTSIDE");
        // The assessment's own choice wins, both ways.
        assertThat(CopyCommentPlacement.effective("INSIDE", () -> "OUTSIDE")).isNull();
        assertThat(CopyCommentPlacement.effective("OUTSIDE", () -> "INSIDE")).isEqualTo("OUTSIDE");
    }

    @Test
    void the_institute_is_not_asked_when_the_assessment_already_chose() {
        AtomicInteger asked = new AtomicInteger();
        CopyCommentPlacement.effective("INSIDE", () -> {
            asked.incrementAndGet();
            return "OUTSIDE";
        });
        assertThat(asked.get()).isZero();
    }

    @Test
    void a_batch_choice_is_stored_only_when_it_changes_the_assessment() {
        Assessment fresh = new Assessment();
        assertThat(CopyCommentPlacement.changed(fresh, null)).isNull();
        assertThat(CopyCommentPlacement.changed(fresh, "nonsense")).isNull();
        // An explicit INSIDE is stored too: it must beat an institute default of OUTSIDE.
        assertThat(CopyCommentPlacement.changed(fresh, "INSIDE")).isEqualTo("INSIDE");
        assertThat(CopyCommentPlacement.changed(fresh, "OUTSIDE")).isEqualTo("OUTSIDE");

        Assessment outside = new Assessment();
        outside.setCopyCommentPlacement("OUTSIDE");
        assertThat(CopyCommentPlacement.changed(outside, "OUTSIDE")).isNull();
        assertThat(CopyCommentPlacement.changed(outside, "INSIDE")).isEqualTo("INSIDE");
    }
}
