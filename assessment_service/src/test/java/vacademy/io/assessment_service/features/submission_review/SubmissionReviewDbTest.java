package vacademy.io.assessment_service.features.submission_review;

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
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarkedByKind;
import vacademy.io.assessment_service.features.submission_review.model.MarkingStatus;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;
import vacademy.io.assessment_service.features.submission_review.service.Review;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;

import java.util.Date;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The submission review SQL against a real Postgres that has V73-V75 applied: the store's
 * projections, the row locks and the targeted attempt UPDATEs. Skipped unless
 * ASSESSMENT_TEST_DB_URL is set (run against a stage copy, never prod).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ContextConfiguration(classes = SubmissionReviewDbTest.OrmOnlyConfig.class)
@EnabledIfEnvironmentVariable(named = "ASSESSMENT_TEST_DB_URL", matches = ".+")
class SubmissionReviewDbTest {

    @Configuration
    @EntityScan(basePackages = "vacademy.io")
    @EnableJpaRepositories(basePackages = {
            "vacademy.io.assessment_service.features.assessment.repository",
            "vacademy.io.assessment_service.features.learner_assessment.repository",
            "vacademy.io.assessment_service.features.submission_review.repository"})
    static class OrmOnlyConfig {
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("ASSESSMENT_TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_USER", ""));
        registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("ASSESSMENT_TEST_DB_PASSWORD", ""));
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
    }

    @Autowired StudentAttemptRepository attempts;
    @Autowired QuestionWiseMarksRepository marks;
    @Autowired MarkEventRepository events;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager em;

    private SubmissionReviewStore store;
    private final String a = "A-" + UUID.randomUUID();
    private final String sec = "sec-" + UUID.randomUUID();
    private String mcq;
    private String cbe;
    private String att;

    private void sql(String s, Object... args) {
        jdbc.update(s, args);
    }

    private String question(String type, double max) {
        // Plain UUIDs: prod's question.text_id is VARCHAR(50).
        String q = UUID.randomUUID().toString();
        String textId = UUID.randomUUID().toString();
        sql("INSERT INTO assessment_rich_text_data (id, type, content) VALUES (?, 'HTML', 'Q')", textId);
        sql("INSERT INTO question (id, text_id, question_response_type, question_type, access_level) VALUES (?, ?, ?, ?, 'PRIVATE')",
                q, textId, type, type);
        sql("INSERT INTO question_assessment_section_mapping (id, question_id, section_id, question_order, marking_json, status) VALUES (?, ?, ?, 1, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), q, sec, "{\"type\":\"" + type + "\",\"data\":{\"totalMark\":" + max + "}}");
        return q;
    }

    @BeforeEach
    void seed() {
        store = new SubmissionReviewStore(jdbc);
        sql("INSERT INTO assessment (id, name, play_mode, evaluation_type, can_switch_section, assessment_visibility, submission_type, status, can_request_reattempt, can_request_time_increase) VALUES (?, 'Review', 'EXAM', 'AUTO', false, 'PRIVATE', 'ONLINE', 'PUBLISHED', false, false)", a);
        sql("INSERT INTO section (id, assessment_id, name, section_order, status) VALUES (?, ?, 'Section 1', 1, 'ACTIVE')", sec, a);
        mcq = question("MCQS", 2);
        cbe = question("CBE_RESPONSE", 10);
        String reg = "reg-" + UUID.randomUUID();
        att = "att-" + UUID.randomUUID();
        sql("INSERT INTO assessment_user_registration (id, assessment_id, user_id, status, registration_time) VALUES (?, ?, ?, 'ACTIVE', now())", reg, a, "u-" + reg);
        sql("INSERT INTO student_attempt (id, registration_id, status, attempt_number, max_time, start_time, preview_start_time, total_marks, result_marks, report_release_status) VALUES (?, ?, 'ENDED', 1, 60, now(), now(), 2, 2, 'PENDING')",
                att, reg);
        sql("INSERT INTO question_wise_marks (id, assessment_id, attempt_id, question_id, section_id, marks, status) VALUES (?, ?, ?, ?, ?, 2, 'CORRECT')",
                UUID.randomUUID().toString(), a, att, mcq, sec);
        sql("INSERT INTO question_wise_marks (id, assessment_id, attempt_id, question_id, section_id, marks, status, response_json) VALUES (?, ?, ?, ?, ?, 0, 'PENDING', ?)",
                UUID.randomUUID().toString(), a, att, cbe, sec,
                "{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>Done</p>\"}}}}}");
        em.flush();
        em.clear();
    }

    @Test
    void outline_mcq_and_cbe() {
        Review.Paper paper = store.paper(a);
        assertThat(paper.keys()).hasSize(2);
        List<Review.MarkRow> rows = store.rows(List.of(att));
        assertThat(rows).hasSize(2);
        assertThat(rows.stream().filter(r -> r.questionId().equals(cbe)).findFirst().orElseThrow().responseJson())
                .isNotNull();
        var snap = new SubmissionSnapshots().compute(new SubmissionSnapshots.Facts(a, "AUTO", false,
                SubmissionKind.ONLINE), false, paper, rows, store.runs(att), List.of());
        assertThat(snap.total()).isEqualTo(2.0);
        assertThat(snap.maxTotal()).isEqualTo(12.0);
        assertThat(SubmissionSnapshots.marking("ENDED", true, 2.0, snap.counts())).isEqualTo(MarkingStatus.NEEDS_MARKING);
        assertThat(store.submittedAttempts(a)).extracting(SubmissionReviewStore.AttemptState::id).containsExactly(att);
    }

    @Test
    void keyword_suggestion_reads_needs_marking_through_the_store_and_history_stays_marked() {
        // Owner decision 2026-11-19: a keyword-match score (marks_source KEYWORD) is a suggestion.
        String fresh = question("LONG_ANSWER", 5);
        String old = question("LONG_ANSWER", 5);
        sql("INSERT INTO question_wise_marks (id, assessment_id, attempt_id, question_id, section_id, marks, status, marks_source, response_json) VALUES (?, ?, ?, ?, ?, 2.5, 'CORRECT', 'KEYWORD', ?)",
                UUID.randomUUID().toString(), a, att, fresh, sec, "{\"responseData\":{\"answer\":\"photosynthesis uses light\"}}");
        // Scored before submit wrote KEYWORD (NULL source): history is not re-guessed.
        sql("INSERT INTO question_wise_marks (id, assessment_id, attempt_id, question_id, section_id, marks, status) VALUES (?, ?, ?, ?, ?, 5, 'CORRECT')",
                UUID.randomUUID().toString(), a, att, old, sec);
        em.flush();
        em.clear();

        Review.Paper paper = store.paper(a);
        List<Review.MarkRow> rows = store.rows(List.of(att));
        var snap = new SubmissionSnapshots().compute(new SubmissionSnapshots.Facts(a, "AUTO", false,
                SubmissionKind.ONLINE), false, paper, rows, store.runs(att), List.of());
        var kw = snap.keys().stream().filter(k -> k.key().questionId().equals(fresh)).findFirst().orElseThrow();
        assertThat(kw.state()).isEqualTo(MarkState.NEEDS_MARKING);
        assertThat(kw.derived().markedBy()).isEqualTo(MarkedByKind.KEYWORD);
        var hist = snap.keys().stream().filter(k -> k.key().questionId().equals(old)).findFirst().orElseThrow();
        assertThat(hist.state()).isEqualTo(MarkState.MARKED);
        // The suggestion still counts in the total (R6) and blocks a release.
        assertThat(snap.total()).isEqualTo(2.0 + 2.5 + 5.0);
        assertThat(snap.blockers()).extracting(k -> k.key().key()).contains(kw.key().key());
        // Released or not, it stays a suggestion.
        var released = new SubmissionSnapshots().compute(new SubmissionSnapshots.Facts(a, "AUTO", false,
                SubmissionKind.ONLINE), true, paper, rows, store.runs(att), List.of());
        assertThat(released.keys().stream().filter(k -> k.key().questionId().equals(fresh)).findFirst().orElseThrow()
                .state()).isEqualTo(MarkState.NEEDS_MARKING);
    }

    @Test
    void locks_and_targeted_updates() {
        assertThat(attempts.lockById(att)).isEqualTo(att);
        assertThat(marks.lockAllForAttempt(att)).hasSize(2);
        attempts.applyMarkTotals(att, 9.0, "COMPLETED", false, new Date());
        var st = store.attempt(att);
        assertThat(st.totalMarks()).isEqualTo(9.0);
        assertThat(st.marksRevision()).isEqualTo(1);
        assertThat(st.resultRevisedAt()).isNull();
        attempts.markReleasedState(att, "pdf-1", false, new Date(), true);
        st = store.attempt(att);
        assertThat(st.released()).isTrue();
        assertThat(st.notifiedRevision()).isEqualTo(1);
        attempts.applyMarkTotals(att, 10.0, "COMPLETED", true, new Date());
        st = store.attempt(att);
        assertThat(st.changedSinceRelease()).isTrue();
        attempts.markNotifiedToCurrent(att);
        assertThat(store.attempt(att).changedSinceRelease()).isFalse();
    }

    @Test
    void history_counts_per_answer() {
        Date release = new Date(System.currentTimeMillis() - 60_000);
        events.save(MarkEvent.builder().instituteId("i").assessmentId(a).attemptId(att).sectionId(sec).questionId(cbe)
                .eventType("TEACHER_EDITED").actorType("TEACHER").afterRelease(true).createdAt(new Date()).build());
        events.save(MarkEvent.builder().instituteId("i").assessmentId(a).attemptId(att).eventType("RELEASED")
                .actorType("TEACHER").afterRelease(false).createdAt(new Date()).build());
        em.flush();
        var counts = events.countPerKey(att, release);
        assertThat(counts).hasSize(1);
        assertThat(counts.get(0).getEventCount()).isEqualTo(1L);
        assertThat(counts.get(0).getChangedAfterRelease()).isTrue();
        assertThat(events.findQuestionHistory(att, sec, cbe, 10)).hasSize(2);
    }

    /**
     * Live follow-up B1 (2026-11-19): the learner report counted an AI-marked CBE (10 / 10,
     * accepted on release, status left PENDING) as skipped while its marks were in the total.
     * The report SQL now reads such a row by its marks; a "not answered" row stays skipped.
     */
    @Test
    void report_counts_a_marked_answer_with_a_stale_pending_status_as_answered() {
        String inst = "inst-" + UUID.randomUUID();
        sql("INSERT INTO assessment_institute_mapping (id, assessment_id, institute_id) VALUES (?, ?, ?)",
                UUID.randomUUID().toString(), a, inst);
        sql("UPDATE question_wise_marks SET marks = 10, marks_source = 'AI_REVIEWED', mark_state = 'MARKED', max_marks = 10 "
                + "WHERE attempt_id = ? AND question_id = ?", att, cbe);
        sql("UPDATE student_attempt SET total_marks = 12, result_marks = 12 WHERE id = ?", att);
        em.flush();
        var d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getCorrectAttempt()).isEqualTo(2);
        assertThat(d.getSkippedCount()).isZero();
        assertThat(d.getTotalCorrectMarks()).isEqualTo(12.0);

        sql("UPDATE question_wise_marks SET marks = 4 WHERE attempt_id = ? AND question_id = ?", att, cbe);
        d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getPartialCorrectAttempt()).isEqualTo(1);
        assertThat(d.getTotalPartialMarks()).isEqualTo(4.0);
        assertThat(d.getSkippedCount()).isZero();

        sql("UPDATE question_wise_marks SET marks = 0, marks_source = 'MANUAL', mark_state = 'NOT_ANSWERED' "
                + "WHERE attempt_id = ? AND question_id = ?", att, cbe);
        d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getSkippedCount()).isEqualTo(1);
        assertThat(d.getCorrectAttempt()).isEqualTo(1);
    }

    /**
     * Review issues B1-legacy-null-max-reads-correct / B1-reader-null-max, B1-blank-ai-zero and
     * B1-pdf-tool-status-evaluated, against the real report SQL.
     */
    @Test
    void report_reads_old_rows_with_the_papers_max_and_leaves_an_old_zero_skipped() {
        String inst = "inst-" + UUID.randomUUID();
        sql("INSERT INTO assessment_institute_mapping (id, assessment_id, institute_id) VALUES (?, ?, ?)",
                UUID.randomUUID().toString(), a, inst);
        // A pre-1a AI mark, 4 of the 10-mark CBE question, accepted at release: max_marks NULL.
        sql("UPDATE question_wise_marks SET marks = 4, marks_source = 'AI_REVIEWED', mark_state = 'MARKED', max_marks = NULL "
                + "WHERE attempt_id = ? AND question_id = ?", att, cbe);
        em.flush();
        var d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getPartialCorrectAttempt()).isEqualTo(1);
        assertThat(d.getTotalPartialMarks()).isEqualTo(4.0);
        assertThat(d.getCorrectAttempt()).isEqualTo(1);
        assertThat(d.getSkippedCount()).isZero();

        // A malformed marking_json falls back to the section marks_per_question, never an error.
        sql("UPDATE question_assessment_section_mapping SET marking_json = '{not json' WHERE question_id = ?", cbe);
        sql("UPDATE section SET marks_per_question = 10 WHERE id = ?", sec);
        d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getPartialCorrectAttempt()).isEqualTo(1);

        // An old AI 0 (the AI's no-answer verdict) stays skipped, as it read before.
        sql("UPDATE question_wise_marks SET marks = 0, marks_source = 'AI', mark_state = NULL "
                + "WHERE attempt_id = ? AND question_id = ?", att, cbe);
        d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getSkippedCount()).isEqualTo(1);
        assertThat(d.getWrongAttempt()).isZero();

        // The PDF tool's "evaluated" reads by the mark (no source, no max on the row).
        sql("UPDATE question_wise_marks SET marks = 10, marks_source = NULL, status = 'evaluated' "
                + "WHERE attempt_id = ? AND question_id = ?", att, cbe);
        d = attempts.findParticipantsQuestionOverallDetails(a, inst, att);
        assertThat(d.getCorrectAttempt()).isEqualTo(2);
        assertThat(d.getSkippedCount()).isZero();
        assertThat(d.getTotalCorrectMarks()).isEqualTo(12.0);
    }
}
