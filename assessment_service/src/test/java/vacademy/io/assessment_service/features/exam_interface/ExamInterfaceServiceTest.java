package vacademy.io.assessment_service.features.exam_interface;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.exam_interface.dto.ExamInterfaceResponse;
import vacademy.io.assessment_service.features.exam_interface.service.ExamInterfaceService;
import vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAssessmentStartPreviewResponse;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ExamInterfaceServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ExamInterfaceService service = new ExamInterfaceService(null);

    private static JsonNode json(String s) throws Exception {
        return MAPPER.readTree(s);
    }

    private String store(String s) throws Exception {
        return service.toStoredJson(json(s));
    }

    private static void assertBadRequest(Runnable r) {
        assertThatThrownBy(r::run)
                .isInstanceOf(VacademyException.class)
                .satisfies(e -> assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    // ------------------------------------------------------------ write validation

    @Test
    void validObjectIsStoredAsSent_unknownKeysKept() throws Exception {
        String stored = store("{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"nta-mock\",\"strict\":false,"
                + "\"options\":{\"early_submit\":\"allowed\"},\"future_key\":[1,2]}");
        JsonNode node = json(stored);
        assertThat(node.path("preset").asText()).isEqualTo("jee-main");
        assertThat(node.path("layout").asText()).isEqualTo("nta-mock");
        assertThat(node.path("strict").asBoolean(true)).isFalse();
        assertThat(node.path("v").asInt()).isEqualTo(1);
        assertThat(node.path("options").path("early_submit").asText()).isEqualTo("allowed");
        assertThat(node.path("future_key").size()).isEqualTo(2);
    }

    @Test
    void anyPresetIdMatchingThePatternIsAccepted_soNewPresetsNeedNoBackendChange() throws Exception {
        assertThat(store("{\"preset\":\"gate\"}")).isNotNull();
        assertThat(store("{\"preset\":\"rrb-je\"}")).isNotNull();
        assertThat(store("{\"preset\":\"some-future-exam-2027\"}")).isNotNull();
        assertThat(store("{\"preset\":\"" + "a".repeat(40) + "\"}")).isNotNull();
        // layout and strict are optional
        assertThat(json(store("{\"preset\":\"jee-advanced\"}")).has("strict")).isFalse();
    }

    @Test
    void nullMissingPresetOrDefaultPresetClear() throws Exception {
        assertThat(service.toStoredJson(null)).isNull();
        assertThat(service.toStoredJson(NullNode.getInstance())).isNull();
        assertThat(store("null")).isNull();
        assertThat(store("{}")).isNull();
        assertThat(store("{\"v\":1,\"strict\":true}")).isNull();
        assertThat(store("{\"preset\":null}")).isNull();
        assertThat(store("{\"v\":1,\"preset\":\"default\",\"strict\":false}")).isNull();
    }

    @Test
    void invalidValuesAreA400() {
        assertBadRequest(() -> service.toStoredJson(MAPPER.getNodeFactory().textNode("jee-main")));
        assertBadRequest(() -> service.toStoredJson(MAPPER.createArrayNode()));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"JEE_MAIN\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"" + "a".repeat(41) + "\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":5}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"Default\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"layout\":\"TCS Console\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"layout\":3}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"strict\":\"yes\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"v\":\"1\"}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"v\":1.5}"));
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"v\":0}"));
    }

    @Test
    void largerThan4KbIsA400() throws Exception {
        String pad = "x".repeat(ExamInterfaceService.MAX_BYTES);
        assertBadRequest(() -> uncheckedStore("{\"preset\":\"gate\",\"note\":\"" + pad + "\"}"));
        // Just under the limit is fine.
        String base = "{\"preset\":\"gate\",\"note\":\"\"}";
        String fits = "x".repeat(ExamInterfaceService.MAX_BYTES - base.length());
        assertThat(store("{\"preset\":\"gate\",\"note\":\"" + fits + "\"}")).hasSize(ExamInterfaceService.MAX_BYTES);
    }

    private void uncheckedStore(String s) {
        try {
            store(s);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------ read side

    @Test
    void readNeverThrows() {
        Assessment a = new Assessment();
        assertThat(service.read(a)).isNull();
        assertThat(service.read(null)).isNull();
        a.setExamInterface("{not json");
        assertThat(service.read(a)).isNull();
        a.setExamInterface("[1,2]");
        assertThat(service.read(a)).isNull();
        a.setExamInterface("{\"v\":1,\"preset\":\"gate\",\"strict\":true}");
        assertThat(service.read(a).path("preset").asText()).isEqualTo("gate");
    }

    @Test
    void roundTripThroughStorage() throws Exception {
        Assessment a = new Assessment();
        a.setExamInterface(store("{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"tcs-console\",\"strict\":true}"));
        JsonNode back = service.read(a);
        assertThat(back).isEqualTo(json("{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"tcs-console\",\"strict\":true}"));
    }

    @Test
    void forLearnerIsNullForUnknownBlankOrFailingIds() {
        AssessmentRepository repo = mock(AssessmentRepository.class);
        Assessment a = new Assessment();
        a.setExamInterface("{\"v\":1,\"preset\":\"gate\"}");
        when(repo.findById(anyString())).thenReturn(Optional.empty());
        when(repo.findById("known")).thenReturn(Optional.of(a));
        when(repo.findById("boom")).thenThrow(new IllegalStateException("db down"));
        ExamInterfaceService s = new ExamInterfaceService(repo);

        assertThat(s.forLearner("known").path("preset").asText()).isEqualTo("gate");
        assertThat(s.forLearner("unknown")).isNull();
        assertThat(s.forLearner("boom")).isNull();
        assertThat(s.forLearner("")).isNull();
        assertThat(s.forLearner(null)).isNull();
    }

    // ------------------------------------------------------------ wire format

    @Test
    void basicDetailsDto_absentFieldIsJavaNull_explicitNullIsNullNode() throws Exception {
        BasicAssessmentDetailsDTO absent = MAPPER.readValue("{\"status\":\"DRAFT\"}", BasicAssessmentDetailsDTO.class);
        assertThat(absent.getExamInterface()).isNull();

        BasicAssessmentDetailsDTO cleared = MAPPER.readValue("{\"exam_interface\":null}", BasicAssessmentDetailsDTO.class);
        assertThat(cleared.getExamInterface()).isNotNull();
        assertThat(cleared.getExamInterface().isNull()).isTrue();

        BasicAssessmentDetailsDTO set = MAPPER.readValue(
                "{\"exam_interface\":{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"nta-mock\",\"strict\":true}}",
                BasicAssessmentDetailsDTO.class);
        assertThat(set.getExamInterface().path("layout").asText()).isEqualTo("nta-mock");
    }

    @Test
    void learnerResponsesUseSnakeCaseAndAlwaysCarryTheKey() throws Exception {
        LearnerAssessmentStartPreviewResponse preview = new LearnerAssessmentStartPreviewResponse();
        JsonNode p = MAPPER.readTree(MAPPER.writeValueAsString(preview));
        assertThat(p.has("exam_interface")).isTrue();
        assertThat(p.get("exam_interface").isNull()).isTrue();

        preview.setExamInterface(json("{\"v\":1,\"preset\":\"gate\",\"strict\":false}"));
        p = MAPPER.readTree(MAPPER.writeValueAsString(preview));
        assertThat(p.path("exam_interface").path("preset").asText()).isEqualTo("gate");
        assertThat(p.path("exam_interface").path("strict").asBoolean(true)).isFalse();

        JsonNode r = MAPPER.readTree(MAPPER.writeValueAsString(new ExamInterfaceResponse("a1", null)));
        assertThat(r.path("assessment_id").asText()).isEqualTo("a1");
        assertThat(r.has("exam_interface")).isTrue();
        assertThat(r.get("exam_interface").isNull()).isTrue();
    }
}
