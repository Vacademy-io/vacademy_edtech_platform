package vacademy.io.assessment_service.features.assessment.service.assessment_get;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.AdminBasicAssessmentListItemDto;

import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;

/** The assessment list carries a.source for the Source: API badge (spec 12, C8). */
class AssessmentMapperSourceTest {

    private static Object[] row(int length, String source) {
        Object[] r = new Object[length];
        r[0] = "a1";
        r[1] = "Science";
        r[5] = 60;
        r[12] = new Date();
        r[16] = 3L;
        if (length > 20) {
            r[20] = source;
        }
        return r;
    }

    @Test
    void source_is_mapped_when_projected() {
        AdminBasicAssessmentListItemDto api = AssessmentMapper.toDto(row(21, "API"));
        AdminBasicAssessmentListItemDto dashboard = AssessmentMapper.toDto(row(21, null));
        assertThat(api.getSource()).isEqualTo("API");
        assertThat(dashboard.getSource()).isNull();
        assertThat(api.getAssessmentId()).isEqualTo("a1");
        assertThat(api.getUserRegistrations()).isEqualTo(3L);
    }

    @Test
    void older_projections_without_the_column_still_map() {
        assertThat(AssessmentMapper.toDto(row(20, null)).getSource()).isNull();
    }
}
