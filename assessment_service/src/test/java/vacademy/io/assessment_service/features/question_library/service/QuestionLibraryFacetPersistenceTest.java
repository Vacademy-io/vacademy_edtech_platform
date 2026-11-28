package vacademy.io.assessment_service.features.question_library.service;

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
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionBankFilter;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionBankManager;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAutoTagRequest;
import vacademy.io.assessment_service.features.question_library.dto.LibraryAutoTagResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryFacetCountDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryFacetsResponse;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagDto;
import vacademy.io.assessment_service.features.question_library.dto.LibraryTagRequest;
import vacademy.io.assessment_service.features.question_library.repository.QuestionLibraryNodeRepository;
import vacademy.io.assessment_service.features.tags.entities.repository.TagCommunityRepository;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The Question Library filter counts and tag groups against real Postgres: the native SQL,
 * the shared WHERE, typed null binding and per-group exclusion. Everything rolls back.
 * Skipped unless ASSESSMENT_TEST_DB_URL is set, so CI without a database stays green.
 * <p>
 * Physics has Kinematics (with Projectile below it) and Laws of Motion:
 * <pre>
 *   q1 Kinematics            EASY   MCQS     Vectors
 *   q2 Projectile            HARD   MCQS     Projectile, PYQ 2023
 *   q3 Laws of Motion        MEDIUM NUMERIC  Friction, PYQ 2023
 *   q4 Laws of Motion        HARD   MCQS     Friction
 *   q5 (no topic)            EASY   MCQS
 *   q6 Kinematics + Laws     MEDIUM MCQS     Vectors
 * </pre>
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = QuestionLibraryFacetPersistenceTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class QuestionLibraryFacetPersistenceTest {

    private static final String OWNER = "zz-owner";
    private static final String READER = "zz-reader";

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.question_core.repository",
            "vacademy.io.assessment_service.features.question_library.repository",
            "vacademy.io.assessment_service.features.tags.entities.repository"
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
    private QuestionLibraryNodeRepository nodeRepository;
    @Autowired
    private TagCommunityRepository tagRepository;
    @Autowired
    private PlatformTransactionManager transactionManager;

    private QuestionLibraryFacetService facets;
    private QuestionLibraryService library;
    private QuestionLibraryCurationService curation;
    private QuestionLibraryAutoTagService autoTag;
    private AiServiceLlmClient llm;

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
        for (String migration : List.of("V61__question_library.sql", "V62__question_library_paper.sql",
                "V64__question_library_access.sql", "V65__question_library_access_hides.sql")) {
            jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration", migration)));
        }
        jdbc.update("INSERT INTO assessment_rich_text_data (id, type, content) VALUES ('zz-txt', 'HTML', '<p>Q</p>')");
        question("zz-q1", "EASY", "MCQS");
        question("zz-q2", "HARD", "MCQS");
        question("zz-q3", "MEDIUM", "NUMERIC");
        question("zz-q4", "HARD", "MCQS");
        question("zz-q5", "EASY", "MCQS");
        question("zz-q6", "MEDIUM", "MCQS");

        node("zz-phy", null);
        node("zz-kin", "zz-phy");
        node("zz-lom", "zz-phy");
        node("zz-proj", "zz-kin");
        place("zz-kin", "zz-q1");
        place("zz-proj", "zz-q2");
        place("zz-lom", "zz-q3");
        place("zz-lom", "zz-q4");
        place("zz-kin", "zz-q6");
        place("zz-lom", "zz-q6");

        tag("zz-t-vec", "Vectors");
        tag("zz-t-proj", "Projectile");
        tag("zz-t-fric", "Friction");
        tag("zz-t-2023", "2023");
        tagQuestion("zz-q1", "zz-t-vec", "CONCEPT");
        tagQuestion("zz-q2", "zz-t-proj", "CONCEPT");
        tagQuestion("zz-q2", "zz-t-2023", "PYQ");
        tagQuestion("zz-q3", "zz-t-fric", "CONCEPT");
        tagQuestion("zz-q3", "zz-t-2023", "PYQ");
        tagQuestion("zz-q4", "zz-t-fric", "CONCEPT");
        tagQuestion("zz-q6", "zz-t-vec", "CONCEPT");

        QuestionLibraryAccess access = new QuestionLibraryAccess();
        ReflectionTestUtils.setField(access, "ownerInstituteId", OWNER);
        QuestionLibraryScope scope = QuestionLibraryTestScopes.scope(access, nodeRepository);
        QuestionLibraryTreeResolver resolver = new QuestionLibraryTreeResolver();
        ReflectionTestUtils.setField(resolver, "nodeRepository", nodeRepository);

        GetQuestionBankManager bank = new GetQuestionBankManager();
        ReflectionTestUtils.setField(bank, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(bank, "libraryTreeResolver", resolver);

        library = new QuestionLibraryService();
        ReflectionTestUtils.setField(library, "nodeRepository", nodeRepository);
        ReflectionTestUtils.setField(library, "treeResolver", resolver);
        ReflectionTestUtils.setField(library, "scope", scope);
        ReflectionTestUtils.setField(library, "questionBankManager", bank);
        ReflectionTestUtils.setField(library, "questionPaperManager", mock(GetQuestionPaperManager.class));

        facets = new QuestionLibraryFacetService();
        ReflectionTestUtils.setField(facets, "entityManager", entityManager);
        ReflectionTestUtils.setField(facets, "scope", scope);
        ReflectionTestUtils.setField(facets, "treeResolver", resolver);
        ReflectionTestUtils.setField(facets, "libraryService", library);

        curation = new QuestionLibraryCurationService();
        ReflectionTestUtils.setField(curation, "nodeRepository", nodeRepository);
        ReflectionTestUtils.setField(curation, "treeResolver", resolver);
        ReflectionTestUtils.setField(curation, "scope", scope);
        ReflectionTestUtils.setField(curation, "tagRepository", tagRepository);

        llm = mock(AiServiceLlmClient.class);
        autoTag = new QuestionLibraryAutoTagService();
        ReflectionTestUtils.setField(autoTag, "nodeRepository", nodeRepository);
        ReflectionTestUtils.setField(autoTag, "treeResolver", resolver);
        ReflectionTestUtils.setField(autoTag, "curationService", curation);
        ReflectionTestUtils.setField(autoTag, "questionRepository", questionRepository);
        ReflectionTestUtils.setField(autoTag, "llmClient", llm);
        ReflectionTestUtils.setField(autoTag, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(autoTag, "transactionManager", transactionManager);
    }

    private void question(String id, String difficulty, String type) {
        jdbc.update("""
                INSERT INTO question (id, text_id, question_response_type, question_type, access_level, status, institute_id, difficulty)
                VALUES (?, 'zz-txt', 'OPTION', ?, 'PRIVATE', 'ACTIVE', ?, ?)
                """, id, type, OWNER, difficulty);
    }

    private void node(String id, String parentId) {
        jdbc.update("INSERT INTO question_library_node (id, institute_id, parent_id, name) VALUES (?, ?, ?, ?)",
                id, OWNER, parentId, id);
    }

    private void place(String nodeId, String questionId) {
        jdbc.update("INSERT INTO question_library_mapping (node_id, question_id, institute_id) VALUES (?, ?, ?)",
                nodeId, questionId, OWNER);
    }

    private void tag(String id, String name) {
        jdbc.update("INSERT INTO tags (tag_id, tag_name, institute_id) VALUES (?, ?, ?)", id, name, OWNER);
    }

    private void tagQuestion(String questionId, String tagId, String kind) {
        jdbc.update("INSERT INTO entity_tags (entity_id, entity_name, tag_id, tag_source) VALUES (?, 'QUESTION', ?, ?)",
                questionId, tagId, kind);
    }

    private static QuestionBankFilter filter(List<String> nodeIds) {
        QuestionBankFilter filter = new QuestionBankFilter();
        filter.setLibraryNodeIds(nodeIds);
        return filter;
    }

    private static Map<String, Long> topics(LibraryFacetsResponse response) {
        return response.getTopics().stream()
                .collect(Collectors.toMap(LibraryFacetCountDto::getId, LibraryFacetCountDto::getCount));
    }

    private static Map<String, Long> tags(LibraryFacetsResponse response) {
        return response.getTags().stream()
                .collect(Collectors.toMap(LibraryTagDto::getTagName, LibraryTagDto::getQuestionCount));
    }

    private List<String> list(String instituteId, QuestionBankFilter filter) {
        return library.listQuestions(null, instituteId, filter, 0, 50).getContent().stream()
                .map(row -> row.getQuestion().getId())
                .sorted()
                .toList();
    }

    @Test
    void counts_every_group_inside_the_open_topic() {
        LibraryFacetsResponse response = facets.facets(OWNER, filter(List.of("zz-phy")), "zz-phy");

        // q6 sits in both chapters and counts once in each, never twice in one.
        assertThat(topics(response)).containsExactlyInAnyOrderEntriesOf(Map.of("zz-kin", 3L, "zz-lom", 3L));
        assertThat(response.getDifficulties()).containsExactlyInAnyOrderEntriesOf(Map.of("EASY", 1L, "MEDIUM", 2L, "HARD", 2L));
        assertThat(response.getQuestionTypes()).containsExactlyInAnyOrderEntriesOf(Map.of("MCQS", 4L, "NUMERIC", 1L));
        assertThat(tags(response)).containsExactlyInAnyOrderEntriesOf(
                Map.of("Vectors", 2L, "Projectile", 1L, "Friction", 2L, "2023", 2L));
        assertThat(response.getTags()).filteredOn(tag -> tag.getTagName().equals("2023"))
                .extracting(LibraryTagDto::getKind).containsExactly("PYQ");
    }

    @Test
    void a_group_is_counted_without_its_own_selection() {
        QuestionBankFilter hard = filter(List.of("zz-phy"));
        hard.setDifficulties(List.of("HARD"));

        LibraryFacetsResponse response = facets.facets(OWNER, hard, "zz-phy");

        // Ticking Hard does not zero Easy and Medium: they show what they would add.
        assertThat(response.getDifficulties()).containsExactlyInAnyOrderEntriesOf(Map.of("EASY", 1L, "MEDIUM", 2L, "HARD", 2L));
        assertThat(topics(response)).containsExactlyInAnyOrderEntriesOf(Map.of("zz-kin", 1L, "zz-lom", 1L));
        assertThat(tags(response)).containsExactlyInAnyOrderEntriesOf(Map.of("Projectile", 1L, "Friction", 1L, "2023", 1L));
    }

    @Test
    void chosen_chapters_narrow_the_other_groups_but_not_the_chapter_list() {
        LibraryFacetsResponse response = facets.facets(OWNER, filter(List.of("zz-kin")), "zz-phy");

        assertThat(topics(response)).containsExactlyInAnyOrderEntriesOf(Map.of("zz-kin", 3L, "zz-lom", 3L));
        // Kinematics with Projectile below it: q1, q2, q6.
        assertThat(response.getDifficulties()).containsExactlyInAnyOrderEntriesOf(Map.of("EASY", 1L, "MEDIUM", 1L, "HARD", 1L));
        assertThat(list(OWNER, filter(List.of("zz-kin")))).containsExactly("zz-q1", "zz-q2", "zz-q6");
        assertThat(list(OWNER, filter(List.of("zz-kin", "zz-lom")))).containsExactly("zz-q1", "zz-q2", "zz-q3", "zz-q4", "zz-q6");
    }

    @Test
    void tag_groups_are_any_inside_a_kind_and_all_across_kinds() {
        QuestionBankFilter either = filter(List.of("zz-phy"));
        either.setTagGroups(Map.of("CONCEPT", List.of("zz-t-fric", "zz-t-proj")));
        assertThat(list(OWNER, either)).containsExactly("zz-q2", "zz-q3", "zz-q4");

        QuestionBankFilter both = filter(List.of("zz-phy"));
        Map<String, List<String>> groups = new LinkedHashMap<>();
        groups.put("CONCEPT", List.of("zz-t-fric"));
        groups.put("PYQ", List.of("zz-t-2023"));
        both.setTagGroups(groups);
        assertThat(list(OWNER, both)).containsExactly("zz-q3");

        LibraryFacetsResponse response = facets.facets(OWNER, both, "zz-phy");
        // Concepts are counted with only PYQ 2023 applied, PYQ with only Friction applied.
        assertThat(tags(response)).containsExactlyInAnyOrderEntriesOf(Map.of("Projectile", 1L, "Friction", 1L, "2023", 1L));
        assertThat(response.getDifficulties()).containsExactlyInAnyOrderEntriesOf(Map.of("MEDIUM", 1L));
    }

    @Test
    void the_top_level_counts_courses_and_the_owner_sees_unsorted_questions_too() {
        LibraryFacetsResponse response = facets.facets(OWNER, new QuestionBankFilter(), null);

        assertThat(topics(response)).containsExactlyInAnyOrderEntriesOf(Map.of("zz-phy", 5L));
        // q5 is in no topic: the owner's whole bank still counts it, as the list shows it.
        assertThat(response.getDifficulties()).containsEntry("EASY", 2L);

        QuestionBankFilter unsorted = new QuestionBankFilter();
        unsorted.setUnsortedOnly(true);
        LibraryFacetsResponse loose = facets.facets(OWNER, unsorted, null);
        assertThat(loose.getTopics()).isEmpty();
        assertThat(loose.getDifficulties()).containsExactlyInAnyOrderEntriesOf(Map.of("EASY", 1L));
    }

    @Test
    void a_reader_never_counts_a_hidden_topic() {
        nodeRepository.hideNode("zz-lom", READER, "Reader", null);
        entityManager.flush();

        LibraryFacetsResponse response = facets.facets(READER, filter(List.of("zz-phy")), "zz-phy");

        assertThat(topics(response)).containsExactlyInAnyOrderEntriesOf(Map.of("zz-kin", 3L));
        // q6 is also on Kinematics, so it stays. q3 and q4 are only on the hidden chapter.
        assertThat(response.getDifficulties()).containsExactlyInAnyOrderEntriesOf(Map.of("EASY", 1L, "MEDIUM", 1L, "HARD", 1L));
        assertThat(tags(response)).doesNotContainKey("Friction");
        // Asking for the hidden chapter by id gives nothing, not everything.
        assertThat(facets.facets(READER, filter(List.of("zz-lom")), "zz-phy").getDifficulties()).isEmpty();
        // The unsorted question is never offered to a reader.
        assertThat(facets.facets(READER, new QuestionBankFilter(), null).getDifficulties())
                .containsExactlyInAnyOrderEntriesOf(Map.of("EASY", 1L, "MEDIUM", 1L, "HARD", 1L));
    }

    private List<String> conceptsOf(String questionId) {
        return jdbc.queryForList("""
                SELECT t.tag_name FROM entity_tags et JOIN tags t ON t.tag_id = et.tag_id
                 WHERE et.entity_id = ? AND et.entity_name = 'QUESTION' AND et.tag_source = 'CONCEPT'
                 ORDER BY t.tag_name
                """, String.class, questionId);
    }

    @Test
    void ai_tags_only_untagged_questions_and_reuses_an_existing_tag_in_any_case() {
        question("zz-q7", "EASY", "MCQS");
        place("zz-lom", "zz-q7");
        LibraryAutoTagRequest count = LibraryAutoTagRequest.builder().nodeId("zz-phy").limit(0).build();
        assertThat(autoTag.autoTag(OWNER, count).getRemaining()).isEqualTo(1L);
        verify(llm, never()).complete(any(), anyList(), eq(true), anyInt(), any(), any(), any(Duration.class));

        when(llm.complete(eq("question_metadata"), anyList(), eq(true), anyInt(), any(), eq(OWNER), any(Duration.class)))
                .thenReturn(new AiServiceLlmClient.Completion(
                        "{\"questions\":[{\"id\":\"zz-q7\",\"tags\":[\"friction\",\"Static Friction\",\"ZZ-LOM\"]}]}",
                        "test-model", Map.of(), "stop"));

        LibraryAutoTagResponse batch = autoTag.autoTag(OWNER, LibraryAutoTagRequest.builder().nodeId("zz-phy").build());
        entityManager.flush();

        // Only q7 had no concept tag. "friction" lands on the existing Friction tag; the
        // chapter name (topics are named by their id here) is not a concept.
        assertThat(batch.getAttemptedIds()).containsExactly("zz-q7");
        assertThat(batch.getTagged()).isEqualTo(1);
        assertThat(batch.getRemaining()).isZero();
        assertThat(batch.getTags()).containsExactly("Friction", "Static Friction");
        assertThat(conceptsOf("zz-q7")).containsExactly("Friction", "Static Friction");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tags WHERE institute_id = ? AND LOWER(tag_name) = 'friction'",
                Long.class, OWNER)).isEqualTo(1L);
        // Nothing left: the next batch asks the model nothing.
        assertThat(autoTag.autoTag(OWNER, LibraryAutoTagRequest.builder().nodeId("zz-phy").build()).getAttemptedIds()).isEmpty();
    }

    @Test
    void renaming_a_tag_to_another_ones_name_merges_them_and_delete_takes_it_off_everywhere() {
        curation.renameTag(OWNER, LibraryTagRequest.builder().tagId("zz-t-proj").name("vectors").build());
        entityManager.flush();
        assertThat(conceptsOf("zz-q2")).containsExactly("Vectors");
        assertThat(tags(facets.facets(OWNER, filter(List.of("zz-phy")), "zz-phy")))
                .containsEntry("Vectors", 3L).doesNotContainKey("Projectile");

        // Same tag, new case: renamed in place.
        curation.renameTag(OWNER, LibraryTagRequest.builder().tagId("zz-t-fric").name("FRICTION").build());
        entityManager.flush();
        assertThat(conceptsOf("zz-q3")).containsExactly("FRICTION");

        // A newer "friction" twin and a rename back to it: merged into that exact spelling,
        // never a duplicate-name error (the any-case lookup alone finds the older tag itself).
        tag("zz-t-fric-new", "friction");
        jdbc.update("UPDATE tags SET created_at = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE tag_id = 'zz-t-fric-new'");
        curation.renameTag(OWNER, LibraryTagRequest.builder().tagId("zz-t-fric").name("friction").build());
        entityManager.flush();
        assertThat(conceptsOf("zz-q3")).containsExactly("friction");

        curation.deleteTag(OWNER, LibraryTagRequest.builder().tagId("zz-t-2023").build());
        entityManager.flush();
        assertThat(tags(facets.facets(OWNER, filter(List.of("zz-phy")), "zz-phy"))).doesNotContainKey("2023");
        // The tag row itself stays: other uses of it are not the library's.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tags WHERE tag_id = 'zz-t-2023'", Long.class)).isEqualTo(1L);
    }
}
