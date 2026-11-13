package vacademy.io.assessment_service.features.assessment.service.creation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.exam_interface.service.ExamInterfaceService;
import vacademy.io.assessment_service.features.proctoring.service.ProctoringConfigService;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** Step-1 read-back carries saved_data.exam_interface for the admin edit form. */
class AssessmentBasicDetailExamInterfaceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static AssessmentBasicDetail step() {
        AssessmentBasicDetail step = new AssessmentBasicDetail();
        ReflectionTestUtils.setField(step, "proctoringConfigService", new ProctoringConfigService());
        ReflectionTestUtils.setField(step, "examInterfaceService", new ExamInterfaceService(null));
        step.fillStepKeysBasedOnAssessmentType("EXAM", "inst-1");
        return step;
    }

    private static Assessment assessment(String examInterface) {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setPlayMode("EXAM");
        a.setInstructions(new AssessmentRichTextData(null, "HTML", "<p>x</p>"));
        a.setExamInterface(examInterface);
        return a;
    }

    @Test
    void savedDataCarriesTheStoredObject() throws Exception {
        AssessmentBasicDetail step = step();
        step.checkStatusAndFetchData(Optional.of(assessment("{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"nta-mock\",\"strict\":true,\"x\":1}")));
        Object value = step.getSavedData().get("exam_interface");
        JsonNode wire = MAPPER.readTree(MAPPER.writeValueAsString(step.getSavedData())).path("exam_interface");
        assertThat(value).isInstanceOf(JsonNode.class);
        assertThat(wire.path("preset").asText()).isEqualTo("jee-main");
        assertThat(wire.path("layout").asText()).isEqualTo("nta-mock");
        assertThat(wire.path("x").asInt()).isEqualTo(1);
    }

    @Test
    void unsetIsAnExplicitNull() throws Exception {
        AssessmentBasicDetail step = step();
        step.checkStatusAndFetchData(Optional.of(assessment(null)));
        assertThat(step.getSavedData()).containsKey("exam_interface");
        JsonNode wire = MAPPER.readTree(MAPPER.writeValueAsString(step.getSavedData()));
        assertThat(wire.get("exam_interface").isNull()).isTrue();
    }
}
