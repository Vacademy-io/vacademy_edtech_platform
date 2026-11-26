package vacademy.io.assessment_service.features.assessment.service.creation;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.SectionDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.Section;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Step 2 hands the wizard its sections in section_order. The wizard shows them in the
 * order it gets and saves each one's on-screen position back as section_order, so any
 * other order (the entity's HashSet) reordered the paper on a plain "Update".
 */
class AssessmentAddQuestionDetailSectionOrderTest {

    private static Section section(String name, Integer order, String status) {
        Section s = new Section();
        s.setId(UUID.randomUUID().toString());
        s.setName(name);
        s.setSectionOrder(order);
        s.setStatus(status);
        return s;
    }

    @Test
    @SuppressWarnings("unchecked")
    void sectionsComeInSectionOrderWithoutDeletedOnes() {
        Set<Section> sections = new HashSet<>();
        for (int i = 10; i >= 1; i--) sections.add(section("S" + i, i, "ACTIVE"));
        sections.add(section("Gone", 0, "DELETED"));
        sections.add(section("No order", null, "ACTIVE"));
        Assessment assessment = new Assessment();
        assessment.setSections(sections);

        AssessmentAddQuestionDetail step = new AssessmentAddQuestionDetail();
        step.checkStatusAndFetchData(Optional.of(assessment));

        List<SectionDto> out = (List<SectionDto>) step.getSavedData().get("sections");
        assertThat(out).extracting(SectionDto::getName)
                .containsExactly("S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "No order");
    }
}
