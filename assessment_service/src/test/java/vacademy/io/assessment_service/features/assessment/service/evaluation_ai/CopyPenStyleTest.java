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
        assertThat(CopyPenStyle.clean(Map.of("ink", "RED", "font", "KALAM", "size", "MEDIUM"))).isNull();
        assertThat(CopyPenStyle.clean(Map.of("ink", "pink", "font", "Comic", "size", "HUGE"))).isNull();
        assertThat(CopyPenStyle.clean(Map.of("ink", "1f3fa0", "font", "patrick_hand", "size", "small")))
                .isEqualTo(Map.of("ink", "#1f3fa0", "font", "PATRICK_HAND", "size", "SMALL"));
    }
}
