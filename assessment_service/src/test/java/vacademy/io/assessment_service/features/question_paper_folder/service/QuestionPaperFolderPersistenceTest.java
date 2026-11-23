package vacademy.io.assessment_service.features.question_paper_folder.service;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import vacademy.io.assessment_service.features.question_bank.dto.AllQuestionPaperResponse;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionPaperDTO;
import vacademy.io.assessment_service.features.question_bank.dto.QuestionPaperFilter;
import vacademy.io.assessment_service.features.question_bank.manager.GetQuestionPaperManager;
import vacademy.io.assessment_service.features.question_bank.repository.QuestionPaperRepository;
import vacademy.io.assessment_service.features.question_paper_folder.dto.MoveQuestionPapersRequest;
import vacademy.io.assessment_service.features.question_paper_folder.dto.QuestionPaperFolderDto;
import vacademy.io.assessment_service.features.question_paper_folder.dto.QuestionPaperFolderLinkDto;
import vacademy.io.assessment_service.features.question_paper_folder.dto.QuestionPaperFolderRequest;
import vacademy.io.assessment_service.features.question_paper_folder.repository.QuestionPaperFolderMappingRepository;
import vacademy.io.assessment_service.features.question_paper_folder.repository.QuestionPaperFolderRepository;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Question paper folders against real Postgres, through the real Spring Data native
 * queries (paging, sort, typed null binding, list expansion). Everything rolls back.
 * Skipped unless ASSESSMENT_TEST_DB_URL is set, so CI without a database stays green.
 * <pre>
 *   institute A: p1 ACTIVE (Maths), p2 FAVOURITE, p3 DELETE (Maths), p4 ACTIVE
 *   institute B: p5 ACTIVE
 * </pre>
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = QuestionPaperFolderPersistenceTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class QuestionPaperFolderPersistenceTest {

    private static final String A = "zz-qpf-inst-a";
    private static final String B = "zz-qpf-inst-b";

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.question_bank.repository",
            "vacademy.io.assessment_service.features.question_paper_folder.repository"
    })
    static class OrmOnlyConfig {
    }

    @Autowired
    private EntityManager entityManager;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private QuestionPaperRepository questionPaperRepository;
    @Autowired
    private QuestionPaperFolderRepository folderRepository;
    @Autowired
    private QuestionPaperFolderMappingRepository mappingRepository;

    private QuestionPaperFolderService folders;
    private GetQuestionPaperManager papers;
    private String maths;

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
        // Inside the test transaction, so the tables and rows roll back with everything else.
        jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/V76__question_paper_folders.sql")));
        paper("zz-qpf-p1", "Alpha", A, "ACTIVE", "2026-01-01 10:00:00");
        paper("zz-qpf-p2", "Beta", A, "FAVOURITE", "2026-01-02 10:00:00");
        paper("zz-qpf-p3", "Gamma", A, "DELETE", "2026-01-03 10:00:00");
        paper("zz-qpf-p4", "Delta", A, "ACTIVE", "2026-01-04 10:00:00");
        paper("zz-qpf-p5", "Other", B, "ACTIVE", "2026-01-05 10:00:00");

        folders = new QuestionPaperFolderService();
        ReflectionTestUtils.setField(folders, "folderRepository", folderRepository);
        ReflectionTestUtils.setField(folders, "mappingRepository", mappingRepository);
        papers = new GetQuestionPaperManager();
        ReflectionTestUtils.setField(papers, "questionPaperRepository", questionPaperRepository);

        maths = folders.create(null, A, new QuestionPaperFolderRequest("Maths", null, null,
                new ArrayList<>(List.of("zz-qpf-p1", "zz-qpf-p3", "zz-qpf-p5")))).getId();
        folders.create(null, A, new QuestionPaperFolderRequest("Empty", null, null, new ArrayList<>()));
        entityManager.flush();
    }

    private void paper(String id, String title, String institute, String status, String createdOn) {
        jdbc.update("INSERT INTO question_paper (id, title, created_by_user_id, created_on) VALUES (?, ?, 'zz-u', ?::timestamp)",
                id, title, createdOn);
        jdbc.update("INSERT INTO institute_question_paper (id, question_paper_id, institute_id, status) VALUES (?, ?, ?, ?)",
                "iqp-" + id, id, institute, status);
    }

    private QuestionPaperFilter allTab(Map<String, String> sort) {
        QuestionPaperFilter filter = new QuestionPaperFilter();
        filter.setStatuses(new ArrayList<>(List.of("ACTIVE", "FAVOURITE")));
        filter.setSortColumns(sort);
        return filter;
    }

    private static List<String> ids(AllQuestionPaperResponse response) {
        return response.getContent().stream().map(QuestionPaperDTO::getId).toList();
    }

    @Test
    @DisplayName("no folder fields: the original list, all of A's active and favourite papers, newest first")
    void originalListUnchanged() {
        AllQuestionPaperResponse page = papers.getQuestionPapers(null, allTab(Map.of("createdOn", "DESC")), A, 0, 10);
        assertEquals(List.of("zz-qpf-p4", "zz-qpf-p2", "zz-qpf-p1"), ids(page));
        assertEquals(3, page.getTotalElements());
    }

    @Test
    @DisplayName("folder: only its papers; a deleted paper and another institute's paper never show")
    void folderList() {
        QuestionPaperFilter filter = allTab(Map.of("createdOn", "DESC"));
        filter.setFolderId(maths);
        AllQuestionPaperResponse page = papers.getQuestionPapers(null, filter, A, 0, 10);
        assertEquals(List.of("zz-qpf-p1"), ids(page));
        assertEquals(1, page.getTotalElements());
    }

    @Test
    @DisplayName("not in a folder: the rest, paged and sorted by name, with the right total")
    void unfiledList() {
        QuestionPaperFilter filter = allTab(Map.of("title", "ASC"));
        filter.setUnfiledOnly(true);
        AllQuestionPaperResponse first = papers.getQuestionPapers(null, filter, A, 0, 1);
        assertEquals(List.of("zz-qpf-p2"), ids(first));
        assertEquals(2, first.getTotalElements());
        AllQuestionPaperResponse second = papers.getQuestionPapers(null, filter, A, 1, 1);
        assertEquals(List.of("zz-qpf-p4"), ids(second));
    }

    @Test
    @DisplayName("folder scope keeps the other filters: favourites tab, search, level and tag")
    void folderWithOtherFilters() {
        QuestionPaperFilter favourites = new QuestionPaperFilter();
        favourites.setStatuses(new ArrayList<>(List.of("FAVOURITE")));
        favourites.setUnfiledOnly(true);
        assertEquals(List.of("zz-qpf-p2"), ids(papers.getQuestionPapers(null, favourites, A, 0, 10)));

        QuestionPaperFilter search = allTab(null);
        search.setUnfiledOnly(true);
        search.setName("delt");
        assertEquals(List.of("zz-qpf-p4"), ids(papers.getQuestionPapers(null, search, A, 0, 10)));

        QuestionPaperFilter tagged = allTab(null);
        tagged.setFolderId(maths);
        tagged.setLevelIds(new ArrayList<>(List.of("no-such-level")));
        tagged.setTagIds(new ArrayList<>(List.of("no-such-tag")));
        assertEquals(List.of(), ids(papers.getQuestionPapers(null, tagged, A, 0, 10)));
    }

    @Test
    @DisplayName("another institute's folder id lists nothing, and B's unfiled list is not touched by A's folders")
    void institutesStaySeparate() {
        QuestionPaperFilter foreign = allTab(null);
        foreign.setFolderId(maths);
        assertEquals(List.of(), ids(papers.getQuestionPapers(null, foreign, B, 0, 10)));

        QuestionPaperFilter unfiledB = allTab(null);
        unfiledB.setUnfiledOnly(true);
        assertEquals(List.of("zz-qpf-p5"), ids(papers.getQuestionPapers(null, unfiledB, B, 0, 10)));
    }

    @Test
    @DisplayName("folder list: counts what the All tab shows (deleted paper not counted), in display order")
    void folderCounts() {
        List<QuestionPaperFolderDto> list = folders.list(A);
        assertEquals(List.of("Maths", "Empty"), list.stream().map(QuestionPaperFolderDto::getName).toList());
        assertEquals(1L, list.get(0).getPaperCount());
        assertEquals(0L, list.get(1).getPaperCount());
        assertEquals(List.of(), folders.list(B));
    }

    @Test
    @DisplayName("move, take out and delete: papers are never deleted, links follow")
    void moveAndDelete() {
        folders.move(A, new MoveQuestionPapersRequest(maths, new ArrayList<>(List.of("zz-qpf-p4", "zz-qpf-p5"))));
        entityManager.flush();
        List<QuestionPaperFolderLinkDto> links = folders.foldersForPapers(A,
                List.of("zz-qpf-p1", "zz-qpf-p2", "zz-qpf-p4", "zz-qpf-p5"));
        assertEquals(List.of("zz-qpf-p1", "zz-qpf-p4"),
                links.stream().map(QuestionPaperFolderLinkDto::getQuestionPaperId).sorted().toList());

        folders.move(A, new MoveQuestionPapersRequest(null, new ArrayList<>(List.of("zz-qpf-p1"))));
        entityManager.flush();
        assertEquals(1L, folders.list(A).get(0).getPaperCount());

        folders.delete(A, maths);
        entityManager.flush();
        assertEquals(List.of("Empty"), folders.list(A).stream().map(QuestionPaperFolderDto::getName).toList());
        Integer left = jdbc.queryForObject("SELECT COUNT(*) FROM question_paper WHERE id LIKE 'zz-qpf-p%'", Integer.class);
        assertEquals(5, left);
        QuestionPaperFilter unfiled = allTab(null);
        unfiled.setUnfiledOnly(true);
        assertEquals(3, papers.getQuestionPapers(null, unfiled, A, 0, 10).getTotalElements());
    }
}
