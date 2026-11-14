package vacademy.io.admin_core_service.features.course.service;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO.ChapterNode;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO.ModuleNode;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureRequestDTO.SubjectNode;
import vacademy.io.admin_core_service.features.course.dto.restructure.CourseRestructureResponseDTO;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Runs CourseRestructureService's real SQL on a real Postgres (the queries use Postgres
 * syntax). Skipped unless RESTRUCTURE_TEST_PG_URL points at a throwaway database, e.g.
 * jdbc:postgresql://127.0.0.1:55433/postgres?user=postgres — each test rebuilds a minimal
 * copy of the structure tables in its own schema.
 */
class CourseRestructureServiceIT {

    private JdbcTemplate db;
    private CourseRestructureService service;
    private LearnerTrackingAsyncService tracking;

    @BeforeEach
    void setUp() {
        String url = System.getenv("RESTRUCTURE_TEST_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "RESTRUCTURE_TEST_PG_URL not set");
        SingleConnectionDataSource ds = new SingleConnectionDataSource(url, true);
        ds.setAutoCommit(true);
        db = new JdbcTemplate(ds);
        db.execute("DROP SCHEMA IF EXISTS restructure_it CASCADE");
        db.execute("CREATE SCHEMA restructure_it");
        db.execute("SET search_path TO restructure_it");
        for (String ddl : List.of(
                "CREATE TABLE package (id varchar PRIMARY KEY, course_depth int, drip_condition_json text)",
                "CREATE TABLE package_institute (package_id varchar, institute_id varchar)",
                "CREATE TABLE package_session (id varchar PRIMARY KEY, package_id varchar, status varchar, created_at timestamptz DEFAULT now())",
                "CREATE TABLE subject (id varchar PRIMARY KEY, subject_name varchar, status varchar, created_by_user_id varchar, created_at timestamptz DEFAULT now())",
                "CREATE TABLE subject_session (id varchar PRIMARY KEY, subject_id varchar, session_id varchar, subject_order int)",
                "CREATE TABLE modules (id varchar PRIMARY KEY, module_name varchar, status varchar, created_by_user_id varchar)",
                "CREATE TABLE subject_module_mapping (id varchar PRIMARY KEY, subject_id varchar, module_id varchar, module_order int, created_at timestamptz DEFAULT now())",
                "CREATE TABLE chapter (id varchar PRIMARY KEY, chapter_name varchar, status varchar, created_by_user_id varchar, drip_condition_json text, created_at timestamptz DEFAULT now())",
                "CREATE TABLE module_chapter_mapping (id varchar PRIMARY KEY, chapter_id varchar, module_id varchar)",
                "CREATE TABLE chapter_package_session_mapping (id varchar PRIMARY KEY, chapter_id varchar, package_session_id varchar, status varchar, chapter_order int)",
                "CREATE TABLE chapter_to_slides (id varchar PRIMARY KEY, chapter_id varchar, slide_id varchar, slide_order int, status varchar)",
                "CREATE TABLE slide (id varchar PRIMARY KEY, title varchar, drip_condition_json text)",
                "CREATE TABLE student_session_institute_group_mapping (user_id varchar, package_session_id varchar, status varchar)")) {
            db.execute(ddl);
        }
        tracking = mock(LearnerTrackingAsyncService.class);
        service = new CourseRestructureService(new NamedParameterJdbcTemplate(ds), new DataSourceTransactionManager(ds),
                tracking);
    }

    /** A depth-3 course: hidden DEFAULT subject + module, chapters ch1 [s1, s2] and ch2 [s3], on the given batches. */
    private void seedDepth3(String... batches) {
        db.update("INSERT INTO package VALUES ('c1', 3, NULL)");
        db.update("INSERT INTO package_institute VALUES ('c1', 'inst-1')");
        db.update("INSERT INTO subject VALUES ('sub', 'DEFAULT', 'ACTIVE', 'u')");
        db.update("INSERT INTO modules VALUES ('mod', 'DEFAULT', 'ACTIVE', 'u')");
        db.update("INSERT INTO subject_module_mapping VALUES ('smm', 'sub', 'mod', 1)");
        db.update("INSERT INTO chapter VALUES ('ch1', 'Cells', 'ACTIVE', 'u', NULL)");
        db.update("INSERT INTO chapter VALUES ('ch2', 'Tissues', 'ACTIVE', 'u', NULL)");
        db.update("INSERT INTO module_chapter_mapping VALUES ('mcm1', 'ch1', 'mod'), ('mcm2', 'ch2', 'mod')");
        int i = 0;
        for (String b : batches) {
            db.update("INSERT INTO package_session VALUES (?, 'c1', 'ACTIVE')", b);
            db.update("INSERT INTO subject_session VALUES (?, 'sub', ?, 1)", "ss" + i, b);
            db.update("INSERT INTO chapter_package_session_mapping VALUES (?, 'ch1', ?, 'ACTIVE', 1), (?, 'ch2', ?, 'ACTIVE', 2)",
                    "cp1" + i, b, "cp2" + i, b);
            db.update("INSERT INTO student_session_institute_group_mapping VALUES (?, ?, 'ACTIVE')", "learner" + i, b);
            i++;
        }
        db.update("INSERT INTO slide VALUES ('s1', 'What is a cell', NULL), ('s2', 'Organelles', NULL), ('s3', 'Epithelium', NULL)");
        db.update("INSERT INTO chapter_to_slides VALUES ('t1', 'ch1', 's1', 1, 'PUBLISHED'), ('t2', 'ch1', 's2', 2, 'DRAFT'), "
                + "('t3', 'ch2', 's3', 1, 'PUBLISHED')");
    }

    private static ChapterNode chapter(String id, String name, String... slides) {
        return new ChapterNode(id, name, new ArrayList<>(List.of(slides)));
    }

    private static ModuleNode module(String id, String name, ChapterNode... chapters) {
        return new ModuleNode(id, name, new ArrayList<>(List.of(chapters)));
    }

    private static CourseRestructureRequestDTO tree(int depth, boolean dryRun, SubjectNode... subjects) {
        return new CourseRestructureRequestDTO(depth, dryRun, new ArrayList<>(List.of(subjects)));
    }

    private static SubjectNode subject(String id, String name, ModuleNode... modules) {
        return new SubjectNode(id, name, new ArrayList<>(List.of(modules)));
    }

    private CourseRestructureResponseDTO run(CourseRestructureRequestDTO req) {
        return service.restructure("inst-1", "c1", req, "admin-1");
    }

    private String one(String sql, Object... args) {
        return db.queryForObject(sql, String.class, args);
    }

    @Test
    void depth3To2MergesChaptersKeepsSlidesAndRepointsDrip() {
        seedDepth3("ps1");
        db.update("UPDATE chapter SET drip_condition_json = ? WHERE id = 'ch2'",
                "[{\"rules\":[{\"type\":\"date_based\",\"params\":{\"date\":\"2026-11-01\"}}]}]");
        db.update("UPDATE slide SET drip_condition_json = ? WHERE id = 's1'",
                "[{\"rules\":[{\"type\":\"prerequisite\",\"params\":{\"required_chapters\":[\"ch2\"]}}]}]");

        CourseRestructureResponseDTO out = run(tree(2, false, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "DEFAULT", "s1", "s2", "s3")))));

        assertEquals(3, out.getDepthFrom());
        assertEquals("2", one("SELECT course_depth::text FROM package WHERE id = 'c1'"));
        assertEquals("ch1", one("SELECT chapter_id FROM chapter_to_slides WHERE slide_id = 's3'"));
        assertEquals("3", one("SELECT slide_order::text FROM chapter_to_slides WHERE slide_id = 's3'"));
        assertEquals("DRAFT", one("SELECT status FROM chapter_to_slides WHERE slide_id = 's2'"));  // status kept
        assertEquals("DELETED", one("SELECT status FROM chapter WHERE id = 'ch2'"));
        assertEquals("DELETED", one("SELECT status FROM chapter_package_session_mapping WHERE chapter_id = 'ch2'"));
        assertEquals("DEFAULT", one("SELECT chapter_name FROM chapter WHERE id = 'ch1'"));
        assertEquals(1, out.getSlidesMoved());
        assertEquals("ch1", out.getChapterIdMap().get("ch2"));
        // ch2's own rule moved to ch1 (which had none); the slide's prerequisite now points at ch1.
        assertTrue(one("SELECT drip_condition_json FROM chapter WHERE id = 'ch1'").contains("date_based"));
        assertTrue(one("SELECT drip_condition_json FROM slide WHERE id = 's1'").contains("\"ch1\""));
        assertEquals(2, out.getDripChanges().size());
        assertEquals(1, out.getLearnersAffected());
        verify(tracking).updateLearnerOperationsForBatch("CHAPTER", null, null, "ch1", "mod", "sub", "ps1");
    }

    @Test
    void depth3To4CreatesModulesAroundExistingChapters() {
        seedDepth3("ps1");
        CourseRestructureResponseDTO out = run(tree(4, false, subject("sub", "DEFAULT",
                module("mod", "Basics", chapter("ch1", "Cells", "s1", "s2")),
                module(null, "Advanced", chapter("ch2", "Tissues", "s3")))));

        String newModule = one("SELECT id FROM modules WHERE module_name = 'Advanced'");
        assertEquals("Basics", one("SELECT module_name FROM modules WHERE id = 'mod'"));
        assertEquals(newModule, one("SELECT module_id FROM module_chapter_mapping WHERE chapter_id = 'ch2'"));
        assertEquals("2", one("SELECT module_order::text FROM subject_module_mapping WHERE module_id = ?", newModule));
        assertEquals("s3", one("SELECT slide_id FROM chapter_to_slides WHERE chapter_id = 'ch2'"));  // untouched
        assertEquals(0, out.getSlidesMoved());
        assertEquals(1, out.getCreated().size());
        assertEquals(1, out.getRenamed().size());
        assertTrue(out.getRemoved().isEmpty());
        assertEquals("4", one("SELECT course_depth::text FROM package WHERE id = 'c1'"));
    }

    @Test
    void depth3To5ForEveryBatch() {
        seedDepth3("ps1", "ps2");
        run(tree(5, false,
                subject("sub", "Biology", module("mod", "Basics", chapter("ch1", "Cells", "s1", "s2"))),
                subject(null, "Histology", module(null, "Tissue types", chapter(null, "Epithelial", "s3")))));
        String newSubject = one("SELECT id FROM subject WHERE subject_name = 'Histology'");
        String newChapter = one("SELECT id FROM chapter WHERE chapter_name = 'Epithelial'");
        assertEquals(2, db.queryForObject("SELECT count(*) FROM subject_session WHERE subject_id = ?", Integer.class, newSubject));
        assertEquals(2, db.queryForObject("SELECT count(*) FROM chapter_package_session_mapping WHERE chapter_id = ? "
                + "AND status = 'ACTIVE'", Integer.class, newChapter));
        assertEquals(newChapter, one("SELECT chapter_id FROM chapter_to_slides WHERE slide_id = 's3'"));
        assertEquals("DELETED", one("SELECT status FROM chapter WHERE id = 'ch2'"));
        verify(tracking, times(2)).updateLearnerOperationsForBatch(eq("CHAPTER"), isNull(), isNull(), eq(newChapter),
                anyString(), eq(newSubject), anyString());
    }

    @Test
    void dryRunReportsEverythingAndWritesNothing() {
        seedDepth3("ps1");
        CourseRestructureResponseDTO out = run(tree(2, true, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "DEFAULT", "s1", "s2", "s3")))));
        assertTrue(out.isDryRun());
        assertEquals(1, out.getSlidesMoved());
        assertEquals("ch2", out.getRemoved().get(0).getId());
        assertEquals("3", one("SELECT course_depth::text FROM package WHERE id = 'c1'"));
        assertEquals("ch2", one("SELECT chapter_id FROM chapter_to_slides WHERE slide_id = 's3'"));
        assertEquals("ACTIVE", one("SELECT status FROM chapter WHERE id = 'ch2'"));
        assertEquals("Cells", one("SELECT chapter_name FROM chapter WHERE id = 'ch1'"));
        verifyNoInteractions(tracking);
    }

    @Test
    void refusesBadTreesAndWritesNothing() {
        seedDepth3("ps1");
        // A slide left out.
        assertThrows(VacademyException.class, () -> run(tree(2, false, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "DEFAULT", "s1", "s2"))))));
        // Two chapters at depth 2.
        assertThrows(VacademyException.class, () -> run(tree(2, false, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "DEFAULT", "s1"), chapter("ch2", "DEFAULT", "s2", "s3"))))));
        // A visible level named DEFAULT, a slide from elsewhere, a duplicated slide.
        assertThrows(VacademyException.class, () -> run(tree(4, false, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "Cells", "s1", "s2", "s3"))))));
        assertThrows(VacademyException.class, () -> run(tree(3, false, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "Cells", "s1", "s2", "s3", "other-slide"))))));
        assertThrows(VacademyException.class, () -> run(tree(3, false, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "Cells", "s1", "s2"), chapter("ch2", "Tissues", "s2", "s3"))))));
        assertThrows(VacademyException.class, () -> service.restructure("other-inst", "c1",
                tree(3, true, subject("sub", "DEFAULT")), "admin-1"));
        assertEquals("3", one("SELECT course_depth::text FROM package WHERE id = 'c1'"));
        assertEquals(0, db.queryForObject("SELECT count(*) FROM chapter WHERE status = 'DELETED'", Integer.class));
    }

    @Test
    void refusesContentSharedWithAnotherCourse() {
        seedDepth3("ps1");
        db.update("INSERT INTO package_session VALUES ('other-ps', 'c2', 'ACTIVE')");
        db.update("INSERT INTO chapter_package_session_mapping VALUES ('cpx', 'ch2', 'other-ps', 'ACTIVE', 1)");
        VacademyException e = assertThrows(VacademyException.class, () -> run(tree(2, true, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "DEFAULT", "s1", "s2", "s3"))))));
        assertTrue(e.getMessage().contains("Tissues"));
    }

    @Test
    void refusesBatchesWithDifferentContent() {
        seedDepth3("ps1", "ps2");
        db.update("UPDATE chapter_package_session_mapping SET status = 'DELETED' WHERE chapter_id = 'ch2' AND package_session_id = 'ps2'");
        assertThrows(VacademyException.class, () -> run(tree(2, true, subject("sub", "DEFAULT",
                module("mod", "DEFAULT", chapter("ch1", "DEFAULT", "s1", "s2", "s3"))))));
    }
}
