package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner_offline.controller.LearnerOfflineManifestController;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyResponseAdvice;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyStripper;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeySurface;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.WithoutAnswerKeys;
import vacademy.io.admin_core_service.features.learner_study_library.controller.LearnerStudyLibraryController;
import vacademy.io.admin_core_service.features.learner_study_library.controller.OpenLearnerStudyLibraryController;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.slide.controller.LearnerSlideController;
import vacademy.io.admin_core_service.features.slide.controller.SlideController;
import vacademy.io.admin_core_service.features.study_library.controller.StudyLibraryController;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

class AnswerKeyStrippingTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final AnswerKeyStripper stripper = new AnswerKeyStripper(MAPPER);

    /** Every slide type that can carry answers, in the shape the learner slide SQL builds. */
    private static final String SLIDES = """
            [{"id":"s1","source_type":"QUIZ","title":"Quiz","description":"{\\"questions\\":[{\\"answer\\":\\"KEYVALUE\\"}]}",
              "quiz_slide":{"id":"qz","time_limit_in_minutes":10,"marks_per_question":2,"re_attempt_count":3,"pass_percentage":50,
                "description":{"id":"d","type":"TEXT","content":"Plain quiz intro"},
                "questions":[{"id":"q1","question_type":"MCQS","marks":1,"auto_evaluation_json":"{\\"correctAnswers\\":[\\"KEYVALUE\\"]}",
                  "text":{"id":"t","type":"TEXT","content":"What?"},
                  "explanation_text":{"id":"e","type":"TEXT","content":"KEYVALUE"},
                  "options":[{"id":"o1","text":{"id":"ot","type":"TEXT","content":"Opt"},
                    "explanation_text_data":{"id":"oe","type":"TEXT","content":"KEYVALUE"}}]}]}},
             {"id":"s2","source_type":"QUESTION","description":"A normal description",
              "question_slide":{"id":"qq","question_type":"MCQS","auto_evaluation_json":"{\\"data\\":{\\"correctOptionIds\\":[\\"KEYVALUE\\"]}}",
                "explanation_text_data":{"id":"e2","type":"TEXT","content":"KEYVALUE"},
                "text_data":{"id":"t2","type":"TEXT","content":"Which?"},"options":[{"id":"o2"}]}},
             {"id":"s3","source_type":"VIDEO",
              "video_slide":{"id":"v","url":"u","questions":[{"id":"vq","question_type":"MCQS","auto_evaluation_json":"{\\"data\\":{\\"correctOptionIds\\":[\\"KEYVALUE\\"]}}",
                "explanation_text_data":{"id":"e3","type":"TEXT","content":"KEYVALUE"},
                "text_data":{"id":"t3","type":"TEXT","content":"Video?"},"options":[{"id":"o3"}]}]}}]
            """;

    private static List<LearnerSlidesDetailDTO> slideDtos() throws Exception {
        ObjectMapper lenient = new ObjectMapper()
                .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        return lenient.readValue(SLIDES, new TypeReference<>() {
        });
    }

    @Test
    @DisplayName("nothing that names an answer survives, through the real slide DTOs")
    void stripsEverySlideType() throws Exception {
        List<LearnerSlidesDetailDTO> dtos = slideDtos();
        assertThat(MAPPER.writeValueAsString(dtos)).as("the fixture holds them to begin with").contains("KEYVALUE");

        JsonNode out = stripper.strip(dtos);
        assertThat(out.toString()).doesNotContain("KEYVALUE");
        assertThat(out.toString()).doesNotContain("auto_evaluation_json");
        assertThat(out.toString()).doesNotContain("explanation_text");

        assertThat(out.get(0).path("quiz_slide").path("questions").get(0).path("text").path("content").asText()).isEqualTo("What?");
        assertThat(out.get(0).path("quiz_slide").path("questions").get(0).path("options").get(0).path("id").asText()).isEqualTo("o1");
        assertThat(out.get(0).path("quiz_slide").path("re_attempt_count").asInt()).isEqualTo(3);
        assertThat(out.get(0).path("quiz_slide").path("description").path("content").asText()).isEqualTo("Plain quiz intro");
        assertThat(out.get(1).path("description").asText()).as("real descriptions stay").isEqualTo("A normal description");
        assertThat(out.get(2).path("video_slide").path("questions").get(0).path("id").asText()).isEqualTo("vq");
    }

    @Test
    void doesNotChangeTheObjectItWasGiven() throws Exception {
        List<LearnerSlidesDetailDTO> dtos = slideDtos();
        stripper.strip(dtos);
        assertThat(MAPPER.writeValueAsString(dtos)).contains("KEYVALUE");
    }

    @Test
    @DisplayName("the generator output left in a quiz description goes, in the description-only reads too")
    void descriptionOnlyShapes() {
        JsonNode out = stripper.strip(List.of(
                Map.of("sourceType", "QUIZ", "slideDescription", "{\"questions\":[{\"answer\":\"KEYVALUE\"}]}"),
                Map.of("sourceType", "QUIZ", "slideDescription", "Plain words"),
                Map.of("sourceType", "DOCUMENT", "slideDescription", "{\"not\":\"a quiz\"}")));
        assertThat(out.toString()).doesNotContain("KEYVALUE");
        assertThat(out.get(1).path("slideDescription").asText()).isEqualTo("Plain words");
        assertThat(out.get(2).path("slideDescription").asText()).contains("not");
    }

    @Test
    void attemptLogLosesOnlyTheCorrectAnswers() {
        String stored = "{\"selectedOptions\":[{\"id\":\"a\"}],\"correctOptions\":[{\"id\":\"KEYVALUE\"}],\"marks\":1,\"maxMarks\":2}";
        String out = stripper.withoutCorrectOptions(stored);
        assertThat(out).doesNotContain("KEYVALUE").contains("selectedOptions").contains("maxMarks");
        assertThat(stripper.withoutCorrectOptions("{\"answer\":\"a\"}")).isEqualTo("{\"answer\":\"a\"}");
        assertThat(stripper.withoutCorrectOptions(null)).isNull();
        assertThat(stripper.withoutCorrectOptions("correctOptions not json")).isEqualTo("{}");
    }

    @ParameterizedTest
    @CsvSource({ "ADMIN,true", "TEACHER,true", "COURSE_CREATOR,true", "SOME_CUSTOM_ROLE,true", "STUDENT,false", "PARENT,false" })
    void authoringRead(String authority, boolean keeps) {
        assertThat(access(false, false, true).keepsAnswersOnAuthoringRead(user(authority))).isEqualTo(keeps);
    }

    @Test
    @DisplayName("a learner who also creates courses keeps answers; no authorities at all does not, even as root")
    void authoringEdges() {
        AnswerKeyAccess access = access(false, false, true);
        assertThat(access.keepsAnswersOnAuthoringRead(user("STUDENT", "TEACHER"))).isTrue();
        assertThat(access.keepsAnswersOnAuthoringRead(user())).isFalse();
        assertThat(access.keepsAnswersOnAuthoringRead(null)).isFalse();
    }

    private static AnswerKeyAccess access(boolean open, boolean learner, boolean authoring) {
        return new AnswerKeyAccess(open, learner, authoring, false);
    }

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u");
        dto.setUsername("u");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    // ------------------------------------------------------------------ through Spring MVC

    @RestController
    static class Fixture {
        @WithoutAnswerKeys(AnswerKeySurface.OPEN)
        @GetMapping("/open")
        ResponseEntity<List<LearnerSlidesDetailDTO>> open() throws Exception {
            return ResponseEntity.ok(slideDtos());
        }

        @WithoutAnswerKeys(AnswerKeySurface.LEARNER)
        @GetMapping("/learner")
        ResponseEntity<List<LearnerSlidesDetailDTO>> learner() throws Exception {
            return ResponseEntity.ok(slideDtos());
        }

        @WithoutAnswerKeys(AnswerKeySurface.AUTHORING)
        @GetMapping("/authoring")
        ResponseEntity<List<LearnerSlidesDetailDTO>> authoring() throws Exception {
            return ResponseEntity.ok(slideDtos());
        }

        @GetMapping("/other")
        ResponseEntity<List<LearnerSlidesDetailDTO>> other() throws Exception {
            return ResponseEntity.ok(slideDtos());
        }
    }

    private MockMvc mvc(AnswerKeyAccess access) {
        return MockMvcBuilders.standaloneSetup(new Fixture())
                .setControllerAdvice(new AnswerKeyResponseAdvice(access, stripper))
                .setMessageConverters(new MappingJackson2HttpMessageConverter())
                .build();
    }

    private String body(MockMvc mvc, String path, CustomUserDetails user) throws Exception {
        var request = get(path);
        if (user != null) {
            request = request.requestAttr("user", user);
        }
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return response.getContentAsString();
    }

    @Test
    @DisplayName("every switch is off by default: responses are unchanged")
    void offByDefault() throws Exception {
        MockMvc mvc = mvc(access(false, false, false));
        assertThat(body(mvc, "/open", null)).contains("KEYVALUE");
        assertThat(body(mvc, "/learner", user("STUDENT"))).contains("KEYVALUE");
        assertThat(body(mvc, "/authoring", user("STUDENT"))).contains("KEYVALUE");
    }

    @Test
    @DisplayName("each surface has its own switch, so the no-login reads can go first")
    void separateSwitches() throws Exception {
        MockMvc mvc = mvc(access(true, false, false));
        assertThat(body(mvc, "/open", null)).doesNotContain("KEYVALUE").contains("quiz_slide");
        assertThat(body(mvc, "/learner", user("STUDENT"))).contains("KEYVALUE");

        mvc = mvc(access(false, true, false));
        assertThat(body(mvc, "/open", null)).contains("KEYVALUE");
        assertThat(body(mvc, "/learner", user("STUDENT"))).doesNotContain("KEYVALUE").contains("quiz_slide");
    }

    @Test
    @DisplayName("authoring reads keep answers for staff and lose them for learners")
    void authoringSurface() throws Exception {
        MockMvc mvc = mvc(access(false, false, true));
        assertThat(body(mvc, "/authoring", user("ADMIN"))).contains("KEYVALUE");
        assertThat(body(mvc, "/authoring", user("STUDENT"))).doesNotContain("KEYVALUE");
        assertThat(body(mvc, "/authoring", null)).doesNotContain("KEYVALUE");
    }

    @Test
    void endpointsWithoutTheAnnotationAreUntouched() throws Exception {
        assertThat(body(mvc(access(true, true, true)), "/other", user("STUDENT"))).contains("KEYVALUE");
    }

    @Test
    @DisplayName("grading itself always needs a login")
    void gradingIsNotAnOpenPath() throws Exception {
        java.lang.reflect.Field field = vacademy.io.admin_core_service.core.config.ApplicationSecurityConfig.class
                .getDeclaredField("ALLOWED_PATHS");
        field.setAccessible(true);
        org.springframework.util.AntPathMatcher matcher = new org.springframework.util.AntPathMatcher();
        for (String pattern : (String[]) field.get(null)) {
            for (String path : List.of("submit", "result", "check-answer")) {
                assertThat(matcher.match(pattern, "/admin-core-service/learner-tracking/quiz-attempt/v1/" + path))
                        .as(pattern).isFalse();
            }
        }
    }

    @ParameterizedTest
    @CsvSource({
            "OPEN,getLearnerSlidesByChapterId,open", "OPEN,getChaptersWithSlides,open",
            "LEARNER,getSlidesByChapterId,learner", "LEARNER,getLearnerSlidesByChapterId,learner",
            "LEARNER,getLearnerSlidesByPackageSession,learner", "LEARNER,getChaptersWithSlides,learner",
            "LEARNER,getModuleChapterSlides,learner", "LEARNER,getLearnerSlides,slide-learner",
            "LEARNER,getManifest,manifest",
            "AUTHORING,getSlides,slide", "AUTHORING,getSlideById,slide", "AUTHORING,getSlidesByChapterId,slide",
            "AUTHORING,getChaptersWithSlides,study-library" })
    @DisplayName("every endpoint found to carry answers is covered")
    void endpointInventory(AnswerKeySurface surface, String methodName, String where) {
        Class<?> controller = switch (where) {
            case "open" -> OpenLearnerStudyLibraryController.class;
            case "learner" -> LearnerStudyLibraryController.class;
            case "slide-learner" -> LearnerSlideController.class;
            case "manifest" -> LearnerOfflineManifestController.class;
            case "slide" -> SlideController.class;
            default -> StudyLibraryController.class;
        };
        Method method = Arrays.stream(controller.getDeclaredMethods())
                .filter(m -> m.getName().equals(methodName)
                        && m.isAnnotationPresent(org.springframework.web.bind.annotation.GetMapping.class))
                .findFirst().orElseThrow();
        assertThat(method.getAnnotation(WithoutAnswerKeys.class)).isNotNull();
        assertThat(method.getAnnotation(WithoutAnswerKeys.class).value()).isEqualTo(surface);
    }
}
