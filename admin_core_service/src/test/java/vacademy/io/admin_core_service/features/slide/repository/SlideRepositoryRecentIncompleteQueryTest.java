package vacademy.io.admin_core_service.features.slide.repository;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * SQL contract of the query behind the learner dashboard's in-progress lessons.
 * These tests boot no database, so its pieces are pinned as text; the query
 * itself was run against PostgreSQL over a stratified set of learners when it
 * changed.
 */
class SlideRepositoryRecentIncompleteQueryTest {

    private static Method method() {
        List<Method> found = Arrays.stream(SlideRepository.class.getDeclaredMethods())
                .filter(m -> m.getName().equals("findRecentIncompleteSlides")).toList();
        assertThat(found).as("findRecentIncompleteSlides declared exactly once").hasSize(1);
        return found.get(0);
    }

    private static String rawSql() {
        Query query = method().getAnnotation(Query.class);
        assertThat(query.nativeQuery()).isTrue();
        return query.value();
    }

    private static String sql() {
        return rawSql().replaceAll("\\s+", " ").trim();
    }

    @Test
    @DisplayName("every named parameter in the SQL has a @Param and every @Param is used")
    void parametersMatch() {
        // Quoted text is removed first so a literal can never read as a parameter.
        Matcher matcher = Pattern.compile(":([A-Za-z]+)").matcher(sql().replaceAll("'[^']*'", "''"));
        Set<String> inSql = new java.util.HashSet<>();
        while (matcher.find()) {
            inSql.add(matcher.group(1));
        }
        Set<String> declared = Arrays.stream(method().getParameters())
                .map(Parameter::getDeclaredAnnotations)
                .flatMap(Arrays::stream)
                .filter(Param.class::isInstance)
                .map(a -> ((Param) a).value())
                .collect(Collectors.toSet());
        assertThat(inSql).isEqualTo(declared);
    }

    @Test
    @DisplayName("the response keeps the projection names the learner app reads")
    void projectionNames() {
        assertThat(sql()).contains(
                "s.id AS slideId,",
                "s.title AS slideTitle,",
                " AS slideDescription,",
                "s.source_type AS sourceType,",
                "s.status AS status,",
                "s.image_file_id AS imageFileId,",
                "END AS progressMarker,",
                "ps.package_id AS packageId,",
                "ps.level_id AS levelId,",
                "recent.chapter_id AS chapterId,",
                "recent.module_id AS moduleId,",
                "recent.subject_id AS subjectId,",
                "ps.id AS packageSessionId");
    }

    @Test
    @DisplayName("a quiz returns an empty description and every other lesson type returns its stored one")
    void quizDescriptionIsEmpty() {
        assertThat(sql())
                .contains("s.title AS slideTitle,"
                        + " CASE WHEN s.source_type = 'QUIZ' THEN '' ELSE s.description END AS slideDescription,"
                        + " s.source_type AS sourceType,")
                .doesNotContain("s.description AS slideDescription");
        assertThat(sql().split("s\\.description", -1))
                .as("the stored description is read in one place only")
                .hasSize(2);
    }

    @Test
    @DisplayName("a chapter counts only through its link to a batch the learner is active in at this institute")
    void batchComesFromTheChapterLinkAndTheEnrolment() {
        assertThat(sql()).contains(
                "JOIN chapter_package_session_mapping cpsm ON cpsm.chapter_id = ch.id"
                        + " AND cpsm.status IN (:chapterStatus)"
                        + " AND cpsm.package_session_id IN (:packageSessionIds)",
                "JOIN student_session_institute_group_mapping ssigm ON ssigm.user_id = :userId"
                        + " AND ssigm.institute_id = :instituteId"
                        + " AND ssigm.package_session_id = cpsm.package_session_id"
                        + " AND ssigm.status IN (:learnerStatus)");
    }

    @Test
    @DisplayName("a subject counts only through its own link to the returned batch")
    void subjectBelongsToTheBatch() {
        assertThat(sql()).contains(
                "JOIN subject_session sbs ON sbs.subject_id = sub.id AND sbs.session_id = nearest.package_session_id");
    }

    @Test
    @DisplayName("a lesson is judged as a whole: any finished activity row or completed rollup ends it")
    void finishedIsPerLesson() {
        assertThat(sql()).contains(
                "GROUP BY al.slide_id HAVING NOT COALESCE(BOOL_OR(al.percentage_watched >= 100), FALSE)",
                "WHERE NOT EXISTS ( SELECT 1 FROM learner_operation finished");
    }

    @Test
    @DisplayName("most recent lessons first, with a stable order, and five at most")
    void orderedByRecency() {
        assertThat(sql())
                .contains("MAX(COALESCE(al.last_seen_at, al.updated_at)) AS last_active")
                .contains("ORDER BY located.last_active DESC NULLS LAST, located.slide_id LIMIT 5")
                .endsWith("ORDER BY recent.last_active DESC NULLS LAST, recent.slide_id");
    }

    @Test
    @DisplayName("several matching batches resolve to one joined by the last activity, then the latest enrolment, then the id")
    void batchChoiceIsDeterministic() {
        assertThat(sql())
                .contains("ORDER BY activity.slide_id, (ssigm.created_at <= activity.last_active) DESC,"
                        + " ssigm.created_at DESC, cpsm.package_session_id, cts.chapter_id")
                .doesNotContain("batch_progress", "PERCENTAGE_PACKAGE_SESSION_COMPLETED");
    }

    @Test
    @DisplayName("module and subject are resolved after the lessons are narrowed down")
    void pathResolvedOnTheNearestLessonsOnly() {
        String sql = sql();
        assertThat(sql.indexOf("LIMIT 10")).isPositive()
                .isLessThan(sql.indexOf("JOIN subject_module_mapping smm"));
    }

    @Test
    @DisplayName("stored position and percentage are converted only when they are numbers")
    void numericConversionsAreGuarded() {
        assertThat(sql()).contains(
                "CASE WHEN lo.value ~ '^[0-9]+$' AND LENGTH(lo.value) <= 18 THEN CAST(lo.value AS BIGINT) END",
                "CASE WHEN finished.value ~ '^[0-9]+(\\.[0-9]+)?$' THEN CAST(finished.value AS FLOAT) ELSE 0 END >= 100");
    }

    @Test
    @DisplayName("the stored position has one source row for each lesson")
    void positionIsDeterministic() {
        assertThat(sql()).contains(
                "AND lo.operation = CASE s.source_type WHEN 'VIDEO' THEN 'VIDEO_LAST_TIMESTAMP'"
                        + " WHEN 'DOCUMENT' THEN 'DOCUMENT_LAST_PAGE' END");
    }
}
