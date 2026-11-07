package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** The institute's pen for AI checked copies, as sent to ai_service. */
class CopyPenStyleTest {

    @Test
    void pen_style_keeps_only_known_values_and_drops_the_usual_pen() {
        assertThat(CopyPenStyle.clean(null)).isNull();
        assertThat(CopyPenStyle.clean("BLUE")).isNull();
        assertThat(CopyPenStyle.clean(Map.of("ink", "RED", "font", "DAWNING_OF_A_NEW_DAY", "size", "MEDIUM",
                "darkness", 50))).isNull();
        assertThat(CopyPenStyle.clean(Map.of("ink", "pink", "font", "Comic", "size", "HUGE"))).isNull();
        assertThat(CopyPenStyle.clean(Map.of("ink", "1f3fa0", "font", "patrick_hand", "size", "small")))
                .isEqualTo(Map.of("ink", "#1f3fa0", "font", "PATRICK_HAND", "size", "SMALL"));
    }

    @Test
    void the_old_hand_stays_a_choice_and_darkness_is_kept_within_range() {
        assertThat(CopyPenStyle.clean(Map.of("font", "KALAM"))).isEqualTo(Map.of("font", "KALAM"));
        assertThat(CopyPenStyle.clean(Map.of("darkness", 900))).isEqualTo(Map.of("darkness", 100));
        assertThat(CopyPenStyle.clean(Map.of("darkness", "dark"))).isNull();
    }
}
