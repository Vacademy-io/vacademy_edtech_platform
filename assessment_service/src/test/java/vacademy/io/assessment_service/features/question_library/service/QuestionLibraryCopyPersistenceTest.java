package vacademy.io.assessment_service.features.question_library.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentLinkQuestionsManager;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.evaluation.service.QuestionEvaluationService;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.CopyLibraryQuestionsRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryCopyResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryRandomPickRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryRandomPickResponse;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The promise of the Question Library, on real rows: a test can use a library question and
 * edit it however it likes, and the library question does not change.
 * <p>
 * Runs the real copy, the real save and real Hibernate against Postgres, because the way
 * this breaks is at the row level: a rich-text or option row shared between the two
 * questions looks fine until something is saved. Everything rolls back. Skipped unless
 * ASSESSMENT_TEST_DB_URL is set, so CI without a database stays green.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = QuestionLibraryCopyPersistenceTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class QuestionLibraryCopyPersistenceTest {

    private static final String OWNER = "zz-owner";
    private static final String CLIENT = "zz-client";
    private static final String OTHER_CLIENT = "zz-other";
    private static final String LIB = "zz-lib-q";
    private static final String LIB_KEY = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"zz-opt-b\"]}}";

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.question_core.repository",
            "vacademy.io.assessment_service.features.question_library.repository"
    })
    static class OrmOnlyConfig {
    }

    @Autowired
    private EntityManager entityManager;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private QuestionRepository questionRepository;
    @Autowired
    private OptionRepository optionRepository;
    @Autowired
    private QuestionLibraryNodeRepository nodeRepository;

    private QuestionLibraryCopyService service;
    private AddQuestionPaperFromImportManager importManager;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("ASSESSMENT_TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_USER", ""));
        registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_PASSWORD", ""));
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    @BeforeEach
    void setUp() throws Exception {
        // Inside the test transaction, so these roll back with everything else.
        for (String migration : List.of("V61__question_library.sql", "V62__question_library_paper.sql")) {
            jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration", migration)));
        }
        rich("zz-t", "<p>Library question</p>");
        rich("zz-e", "<p>Library explanation</p>");
        rich("zz-a", "Library 3");
        rich("zz-b", "Library 4");
        jdbc.update("""
                INSERT INTO question (id, text_id, explanation_text_id, question_response_type, question_type, access_level,
                                      status, institute_id, difficulty, auto_evaluation_json, evaluation_type)
                VALUES (?, 'zz-t', 'zz-e', 'OPTION', 'MCQS', 'PRIVATE', 'ACTIVE', ?, 'HARD', ?, 'AUTO')
                """, LIB, OWNER, LIB_KEY);
        jdbc.update("INSERT INTO option (id, question_id, text_id) VALUES ('zz-opt-a', ?, 'zz-a'), ('zz-opt-b', ?, 'zz-b')", LIB, LIB);
        jdbc.update("INSERT INTO question_library_node (id, institute_id, name) VALUES ('zz-node', ?, 'SSC')", OWNER);
        jdbc.update("INSERT INTO question_library_mapping (node_id, question_id, institute_id) VALUES ('zz-node', ?, ?)", LIB, OWNER);

        QuestionEvaluationService evaluation = new QuestionEvaluationService();
        ReflectionTestUtils.setField(evaluation, "objectMapper",
                new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false));
        importManager = spy(new AddQuestionPaperFromImportManager());
        ReflectionTestUtils.setField(importManager, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(importManager, "optionRepository", optionRepository);
        ReflectionTestUtils.setField(importManager, "questionEvaluationService", evaluation);
        // Tag writing is not what is under test and needs repositories outside this slice.
        doNothing().when(importManager).addQuestionEntityTags(anyList(), anyList(), anyString());

        QuestionLibraryAccess access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        service = new QuestionLibraryCopyService();
        ReflectionTestUtils.setField(service, "access", access);
        ReflectionTestUtils.setField(service, "nodeRepository", nodeRepository);
        ReflectionTestUtils.setField(service, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(service, "optionRepository", optionRepository);
        ReflectionTestUtils.setField(service, "importManager", importManager);
        ReflectionTestUtils.setField(service, "questionPaperManager", mock(GetQuestionPaperManager.class));
    }

    private void rich(String id, String content) {
        jdbc.update("INSERT INTO assessment_rich_text_data (id, type, content) VALUES (?, 'HTML', ?)", id, content);
    }

    private void sync() {
        entityManager.flush();
        entityManager.clear();
    }

    private String pick(String instituteId) {
        LibraryCopyResponse response = service.copy(instituteId, CopyLibraryQuestionsRequest.builder()
                .questionIds(List.of(LIB))
                .excludeQuestionIds(List.of())
                .build());
        sync();
        assertThat(response.getFailed()).isZero();
        return response.getCopied().get(0).getQuestionId();
    }

    /** What the teacher does in the editor: new wording, new option text, a different right answer. */
    private QuestionDTO teacherEdit(String copyId) {
        QuestionDTO dto = new QuestionDTO(questionRepository.findById(copyId).orElseThrow(), true);
        entityManager.clear();
        dto.getText().setContent("<p>Edited in my test</p>");
        dto.getExplanationText().setContent("<p>Edited explanation</p>");
        dto.getOptions().get(0).getText().setContent("Edited A");
        dto.getOptions().get(1).getText().setContent("Edited B");
        dto.setAutoEvaluationJson("{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"" + dto.getOptions().get(0).getId() + "\"]}}");
        return dto;
    }

    private void assertLibraryUntouched() {
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT institute_id, status, source_type, difficulty, auto_evaluation_json, text_id, explanation_text_id FROM question WHERE id = ?", LIB);
        assertThat(row.get("institute_id")).isEqualTo(OWNER);
        assertThat(row.get("status")).isEqualTo("ACTIVE");
        assertThat(row.get("source_type")).isNull();
        assertThat(row.get("difficulty")).isEqualTo("HARD");
        assertThat(row.get("auto_evaluation_json")).isEqualTo(LIB_KEY);
        assertThat(row.get("text_id")).isEqualTo("zz-t");
        assertThat(row.get("explanation_text_id")).isEqualTo("zz-e");
        assertThat(richContent("zz-t")).isEqualTo("<p>Library question</p>");
        assertThat(richContent("zz-e")).isEqualTo("<p>Library explanation</p>");
        assertThat(richContent("zz-a")).isEqualTo("Library 3");
        assertThat(richContent("zz-b")).isEqualTo("Library 4");
        assertThat(jdbc.queryForList("SELECT id FROM option WHERE question_id = ? ORDER BY id", String.class, LIB))
                .containsExactly("zz-opt-a", "zz-opt-b");
        assertThat(jdbc.queryForObject("SELECT text_id FROM option WHERE id = 'zz-opt-b'", String.class)).isEqualTo("zz-b");
    }

    private String richContent(String id) {
        return jdbc.queryForObject("SELECT content FROM assessment_rich_text_data WHERE id = ?", String.class, id);
    }

    private String textOf(String questionId) {
        return jdbc.queryForObject("""
                SELECT t.content FROM question q JOIN assessment_rich_text_data t ON t.id = q.text_id WHERE q.id = ?
                """, String.class, questionId);
    }

    private AssessmentLinkQuestionsManager assessmentWith(String sectionId, String questionId) {
        Assessment assessment = new Assessment();
        Section section = new Section();
        section.setId(sectionId);
        assessment.setSections(Set.of(section));
        AssessmentService assessmentService = mock(AssessmentService.class);
        when(assessmentService.getAssessmentWithActiveSections("zz-test", CLIENT)).thenReturn(Optional.of(assessment));
        QuestionAssessmentSectionMapping mapping = new QuestionAssessmentSectionMapping();
        mapping.setQuestion(questionRepository.findById(questionId).orElseThrow());
        QuestionAssessmentSectionMappingService mappings = mock(QuestionAssessmentSectionMappingService.class);
        when(mappings.getQuestionAssessmentSectionMappingBySectionIds(List.of(sectionId))).thenReturn(List.of(mapping));
        AssessmentLinkQuestionsManager manager = new AssessmentLinkQuestionsManager();
        ReflectionTestUtils.setField(manager, "assessmentService", assessmentService);
        ReflectionTestUtils.setField(manager, "questionAssessmentSectionMappingService", mappings);
        ReflectionTestUtils.setField(manager, "addQuestionPaperFromImportManager", importManager);
        return manager;
    }

    @Test
    void aCopySharesNoRowWithTheLibrary() {
        String copy = pick(CLIENT);

        assertThat(copy).isNotEqualTo(LIB);
        Map<String, Object> row = jdbc.queryForMap("SELECT institute_id, source_type, text_id, explanation_text_id, auto_evaluation_json FROM question WHERE id = ?", copy);
        assertThat(row.get("institute_id")).isEqualTo(CLIENT);
        assertThat(row.get("source_type")).isEqualTo(QuestionLibraryCopyService.SOURCE_TYPE);
        assertThat(row.get("text_id")).isNotEqualTo("zz-t");
        assertThat(row.get("explanation_text_id")).isNotEqualTo("zz-e");
        assertThat(textOf(copy)).isEqualTo("<p>Library question</p>");

        List<Map<String, Object>> options = jdbc.queryForList("SELECT id, text_id FROM option WHERE question_id = ?", copy);
        assertThat(options).hasSize(2);
        assertThat(options).noneMatch(o -> List.of("zz-opt-a", "zz-opt-b").contains(o.get("id")));
        assertThat(options).noneMatch(o -> List.of("zz-a", "zz-b").contains(o.get("text_id")));
        // Graded with its own options, and still the option that says 4.
        String correct = jdbc.queryForObject("""
                SELECT o.id FROM option o JOIN assessment_rich_text_data t ON t.id = o.text_id
                 WHERE o.question_id = ? AND t.content = 'Library 4'
                """, String.class, copy);
        assertThat((String) row.get("auto_evaluation_json")).contains(correct).doesNotContain("zz-opt-b");
        assertLibraryUntouched();
    }

    @Test
    void editingBeforeTheTestIsSavedChangesOnlyTheCopy() {
        String copy = pick(CLIENT);

        service.editCopy(CLIENT, teacherEdit(copy));
        sync();

        assertThat(textOf(copy)).isEqualTo("<p>Edited in my test</p>");
        assertThat(jdbc.queryForObject("SELECT source_type FROM question WHERE id = ?", String.class, copy))
                .isEqualTo(QuestionLibraryCopyService.SOURCE_TYPE);
        assertThat(jdbc.queryForObject("SELECT difficulty FROM question WHERE id = ?", String.class, copy)).isEqualTo("HARD");
        assertLibraryUntouched();
    }

    @Test
    void editingFromASavedAssessmentChangesOnlyTheCopy() {
        String copy = pick(CLIENT);
        AssessmentLinkQuestionsManager manager = assessmentWith("zz-section", copy);
        QuestionDTO edit = teacherEdit(copy);

        assertThat(manager.editQuestionsOfAssessment(null, "zz-test", CLIENT, List.of(edit))).isTrue();
        sync();

        assertThat(textOf(copy)).isEqualTo("<p>Edited in my test</p>");
        assertThat(jdbc.queryForObject("SELECT source_type FROM question WHERE id = ?", String.class, copy))
                .isEqualTo(QuestionLibraryCopyService.SOURCE_TYPE);
        assertLibraryUntouched();
    }

    @Test
    void twoTestsAndTwoInstitutesDoNotSeeEachOthersEdits() {
        String mine = pick(CLIENT);
        String myOtherTest = pick(CLIENT);
        String theirs = pick(OTHER_CLIENT);

        service.editCopy(CLIENT, teacherEdit(mine));
        sync();

        assertThat(textOf(mine)).isEqualTo("<p>Edited in my test</p>");
        assertThat(textOf(myOtherTest)).isEqualTo("<p>Library question</p>");
        assertThat(textOf(theirs)).isEqualTo("<p>Library question</p>");
        assertLibraryUntouched();
    }

    @Test
    void theEditPathRefusesALibraryRowAndAnotherInstitutesCopy() {
        String theirs = pick(OTHER_CLIENT);
        QuestionDTO library = new QuestionDTO(questionRepository.findById(LIB).orElseThrow(), true);
        entityManager.clear();
        library.getText().setContent("<p>Hacked</p>");

        assertThatThrownBy(() -> service.editCopy(CLIENT, library)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.editCopy(OWNER, library)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> service.editCopy(CLIENT, teacherEdit(theirs))).isInstanceOf(VacademyException.class);
        sync();
        assertLibraryUntouched();
    }

    @Test
    void anEditCarryingLibraryTextIdsWritesToTheCopysOwnRows() {
        String copy = pick(CLIENT);
        QuestionDTO edit = teacherEdit(copy);
        edit.getText().setId("zz-t");
        edit.getExplanationText().setId("zz-e");
        edit.getOptions().get(1).getText().setId("zz-b");

        service.editCopy(CLIENT, edit);
        sync();

        assertLibraryUntouched();
        assertThat(textOf(copy)).isEqualTo("<p>Edited in my test</p>");
    }

    @Test
    void anEditNamingALibraryOptionIsRefused() {
        String copy = pick(CLIENT);
        QuestionDTO edit = teacherEdit(copy);
        edit.getOptions().get(1).setId("zz-opt-b");

        assertThatThrownBy(() -> service.editCopy(CLIENT, edit)).isInstanceOf(VacademyException.class);
        sync();

        assertLibraryUntouched();
        assertThat(textOf(copy)).isEqualTo("<p>Library question</p>");
    }

    @Test
    void theSameTwoThroughASavedAssessment() {
        String copy = pick(CLIENT);
        AssessmentLinkQuestionsManager manager = assessmentWith("zz-section", copy);

        QuestionDTO textIds = teacherEdit(copy);
        textIds.getText().setId("zz-t");
        textIds.getOptions().get(1).getText().setId("zz-b");
        manager.editQuestionsOfAssessment(null, "zz-test", CLIENT, List.of(textIds));
        sync();
        assertLibraryUntouched();

        manager = assessmentWith("zz-section", copy);
        QuestionDTO optionId = teacherEdit(copy);
        optionId.getOptions().get(1).setId("zz-opt-b");
        AssessmentLinkQuestionsManager refused = manager;
        assertThatThrownBy(() -> refused.editQuestionsOfAssessment(null, "zz-test", CLIENT, List.of(optionId)))
                .isInstanceOf(VacademyException.class);
        sync();
        assertLibraryUntouched();
    }

    private void libraryQuestion(String id, String difficulty, String type, String parentText) {
        jdbc.update("""
                INSERT INTO question (id, text_id, parent_rich_text_id, question_response_type, question_type, access_level, status, institute_id, difficulty)
                VALUES (?, 'zz-t', ?, 'OPTION', ?, 'PRIVATE', 'ACTIVE', ?, ?)
                """, id, parentText, type, OWNER, difficulty);
        jdbc.update("INSERT INTO question_library_mapping (node_id, question_id, institute_id) VALUES ('zz-node', ?, ?)", id, OWNER);
    }

    private QuestionLibraryService pickService() {
        QuestionLibraryAccess access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", nodeRepository);
        QuestionLibraryService library = new QuestionLibraryService();
        ReflectionTestUtils.setField(library, "access", access);
        ReflectionTestUtils.setField(library, "nodeRepository", nodeRepository);
        ReflectionTestUtils.setField(library, "treeResolver", resolver);
        ReflectionTestUtils.setField(library, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(library, "questionPaperManager", mock(GetQuestionPaperManager.class));
        return library;
    }

    private void seedPickPool() {
        rich("zz-parent", "<p>A passage</p>");
        for (int i = 0; i < 6; i++) libraryQuestion("zz-easy-" + i, "EASY", "MCQS", null);
        for (int i = 0; i < 2; i++) libraryQuestion("zz-hard-" + i, "HARD", "MCQS", null);
        libraryQuestion("zz-numeric", "EASY", "NUMERIC", null);
        libraryQuestion("zz-passage", "EASY", "MCQS", "zz-parent");
        // On no topic: never offered, even though it is the owner's own.
        jdbc.update("""
                INSERT INTO question (id, text_id, question_response_type, question_type, access_level, status, institute_id, difficulty)
                VALUES ('zz-private', 'zz-t', 'OPTION', 'MCQS', 'PRIVATE', 'ACTIVE', ?, 'EASY')
                """, OWNER);
    }

    private static List<String> idsOf(LibraryRandomPickResponse response) {
        return response.getQuestions().stream().map(row -> row.getQuestion().getId()).toList();
    }

    @Test
    void randomPickReportsWhatIsAvailableAndWritesNothing() {
        seedPickPool();
        int questionsBefore = jdbc.queryForObject("SELECT COUNT(*) FROM question", Integer.class);

        LibraryRandomPickResponse response = pickService().randomPick(CLIENT, new LibraryRandomPickRequest());

        // Six easy MCQs plus the numeric. The passage question and the unplaced one do not count.
        assertThat(response.getAvailable()).containsEntry("EASY", 7L).containsEntry("MEDIUM", 0L).containsEntry("HARD", 3L);
        assertThat(response.getQuestions()).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM question", Integer.class)).isEqualTo(questionsBefore);
    }

    @Test
    void randomPickTakesTheAskedCountOfEachDifficulty() {
        seedPickPool();
        LibraryRandomPickRequest request = LibraryRandomPickRequest.builder()
                .questionTypes(List.of("MCQS"))
                .libraryNodeIds(List.of("zz-node"))
                .excludeQuestionIds(List.of())
                .easy(3).hard(5).build();

        LibraryRandomPickResponse response = pickService().randomPick(CLIENT, request);

        List<String> ids = idsOf(response);
        assertThat(ids).hasSize(3 + 3).doesNotHaveDuplicates()
                .doesNotContain("zz-numeric", "zz-passage", "zz-private");
        // Hard asked for 5, only 3 exist (the seed question plus two): it never invents more.
        assertThat(ids.stream().filter(id -> id.startsWith("zz-easy")).count()).isEqualTo(3);
        assertThat(response.getQuestions().get(0).getQuestion().getSourceMeta()).isNull();
    }

    @Test
    void randomPickSkipsWhatTheSectionAlreadyHasACopyOf() {
        String copy = pick(CLIENT);

        LibraryRandomPickRequest request = LibraryRandomPickRequest.builder()
                .libraryNodeIds(List.of())
                .questionTypes(List.of())
                .excludeQuestionIds(List.of(copy))
                .hard(5).build();
        LibraryRandomPickResponse response = pickService().randomPick(CLIENT, request);

        assertThat(idsOf(response)).doesNotContain(LIB);
    }

    @Test
    void aCopyStaysOutOfTheBankAndTheLibraryStaysOutOfTheClientsBank() {
        String copy = pick(CLIENT);
        jdbc.update("""
                INSERT INTO question (id, text_id, question_response_type, question_type, access_level, status, institute_id)
                VALUES ('zz-own', 'zz-t', 'OPTION', 'MCQS', 'PRIVATE', 'ACTIVE', ?)
                """, CLIENT);

        List<String> bank = questionRepository.findQuestionsByFilters(CLIENT, null, "ACTIVE", null, null, null, null, null, null, null, null, null,
                        PageRequest.of(0, 50))
                .map(Question::getId).getContent();

        assertThat(bank).contains("zz-own").doesNotContain(copy, LIB);
    }
}
