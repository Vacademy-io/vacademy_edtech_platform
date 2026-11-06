package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyStripper;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckRequest;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckResponse;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse.AttemptSummary;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse.Status;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptSubmitRequest;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAttemptService;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizLoader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizReviewPolicy;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizSideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuizSlideQuestionTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.ActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuizSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionOptionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.reset;

/**
 * Quiz grading on a real Postgres with the production columns: Hibernate and Spring Data
 * parse and run the actual repositories, and the attempt cap is raced with real threads.
 *
 * <p>Skipped unless {@code QUIZ_GRADING_PG_URL} (a JDBC URL) points at an empty scratch
 * database. It creates tables and writes rows; never point it at a real database.
 */
class LearnerQuizAttemptPostgresTest {

    private static JdbcTemplate jdbc;
    private static LocalContainerEntityManagerFactoryBean emfBean;
    private static TransactionTemplate tx;
    private static LearnerQuizAttemptRepository repository;
    private static ActivityLogRepository activityLogRepository;
    private static QuizSlideQuestionTrackedRepository trackedRepository;
    private static QuizSlideQuestionRepository questionRepository;
    private static QuizSlideQuestionOptionRepository optionRepository;
    private static LearnerQuizAttemptService service;
    private static LearnerTrackingAsyncService asyncService;
    private static QuizSlideActivityLogService legacyService;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String institute;
    private String slide;
    private String quiz;
    private String packageSession;
    private String chapter;
    private String learner;
    private String q1;
    private String q2;
    private String q3;

    @BeforeAll
    static void boot() throws Exception {
        String url = System.getenv("QUIZ_GRADING_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "QUIZ_GRADING_PG_URL not set");
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url);
        dataSource.setDriverClassName("org.postgresql.Driver");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
        jdbc.execute(new ClassPathResource("learner_quiz/schema.sql").getContentAsString(StandardCharsets.UTF_8));

        emfBean = new LocalContainerEntityManagerFactoryBean();
        emfBean.setDataSource(dataSource);
        emfBean.setPackagesToScan("vacademy.io");
        emfBean.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        Properties props = new Properties();
        props.put("hibernate.hbm2ddl.auto", "none");
        props.put("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect");
        props.put("hibernate.physical_naming_strategy",
                "org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy");
        props.put("hibernate.implicit_naming_strategy",
                "org.springframework.boot.orm.jpa.hibernate.SpringImplicitNamingStrategy");
        emfBean.setJpaProperties(props);
        emfBean.afterPropertiesSet();
        EntityManagerFactory emf = emfBean.getObject();
        EntityManager em = SharedEntityManagerCreator.createSharedEntityManager(emf);
        JpaRepositoryFactory factory = new JpaRepositoryFactory(em);
        repository = factory.getRepository(LearnerQuizAttemptRepository.class);
        activityLogRepository = factory.getRepository(ActivityLogRepository.class);
        trackedRepository = factory.getRepository(QuizSlideQuestionTrackedRepository.class);
        questionRepository = factory.getRepository(QuizSlideQuestionRepository.class);
        optionRepository = factory.getRepository(QuizSlideQuestionOptionRepository.class);

        JpaTransactionManager transactionManager = new JpaTransactionManager(emf);
        tx = new TransactionTemplate(transactionManager);
        asyncService = mock(LearnerTrackingAsyncService.class);
        AutoEvaluationScorer scorer = new AutoEvaluationScorer(MAPPER);
        QuizGrader grader = new QuizGrader(scorer, MAPPER);
        QuizLoader loader = new QuizLoader(repository);
        service = new LearnerQuizAttemptService(repository, activityLogRepository, trackedRepository, asyncService,
                new LearnerQuizAccessService(repository, new InstituteAccessValidator()),
                new QuizReviewPolicy(repository, MAPPER, false), loader, grader, scorer, MAPPER, transactionManager);
        legacyService = new QuizSlideActivityLogService(trackedRepository, activityLogRepository,
                new ActivityLogService(activityLogRepository), asyncService, questionRepository, optionRepository,
                scorer, loader, grader, new AnswerKeyAccess(false, true, false, true),
                new AnswerKeyStripper(MAPPER), new LearnerQuizAccessService(repository, new InstituteAccessValidator()),
                repository);
    }

    @AfterAll
    static void shutdown() {
        if (emfBean != null) {
            emfBean.destroy();
        }
    }

    @BeforeEach
    void seed() {
        reset(asyncService);
        // Option ids are fixed names in these tests; everything else is unique per test.
        jdbc.update("DELETE FROM quiz_slide_question_options");
        institute = id();
        slide = id();
        quiz = id();
        packageSession = id();
        chapter = id();
        learner = id();
        jdbc.update("INSERT INTO institutes (id, name, setting_json) VALUES (?, 'T', NULL)", institute);
        String pkg = id();
        jdbc.update("INSERT INTO package_institute (id, package_id, institute_id) VALUES (?, ?, ?)", id(), pkg, institute);
        jdbc.update("INSERT INTO package_session (id, package_id, status) VALUES (?, ?, 'ACTIVE')", packageSession, pkg);
        jdbc.update("INSERT INTO quiz_slide (id, title, marks_per_question, negative_marking, pass_percentage, "
                + "partial_marking, re_attempt_count) VALUES (?, 'Quiz', 2, 0.5, 50, true, NULL)", quiz);
        jdbc.update("INSERT INTO slide (id, source_id, source_type, title, status) VALUES (?, ?, 'QUIZ', 'Quiz', 'PUBLISHED')",
                slide, quiz);
        jdbc.update("INSERT INTO chapter_to_slides (id, chapter_id, slide_id, status) VALUES (?, ?, ?, 'PUBLISHED')",
                id(), chapter, slide);
        jdbc.update("INSERT INTO chapter_package_session_mapping (id, chapter_id, package_session_id, status) "
                + "VALUES (?, ?, ?, 'ACTIVE')", id(), chapter, packageSession);
        enrol(learner, "ACTIVE", null, institute);

        q1 = question("MCQS", "{\"correctAnswers\":[\"" + "A1" + "\"]}", "Q one", "Because one", 1, null, null);
        option(q1, "A1", "Right");
        option(q1, "A2", "Other");
        q2 = question("MCQM", "{\"correctAnswers\":[\"B1\",\"B2\"]}", "Q two", null, 2, 4.0, null);
        option(q2, "B1", "One");
        option(q2, "B2", "Two");
        option(q2, "B3", "Three");
        q3 = question("LONG_ANSWER", "{\"data\":{\"answer\":{\"content\":\"model\"}}}", "Q three", null, 3, null, null);
    }

    private static String id() {
        return UUID.randomUUID().toString();
    }

    private void enrol(String user, String status, String type, String inInstitute) {
        jdbc.update("INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, institute_id, "
                + "status, type) VALUES (?, ?, ?, ?, ?, ?)", id(), user, packageSession, inInstitute, status, type);
    }

    private String question(String type, String key, String text, String explanation, int order, Double marks,
            Double negative) {
        String qid = id();
        String textId = richText(text);
        String expId = explanation == null ? null : richText(explanation);
        jdbc.update("INSERT INTO quiz_slide_question (id, quiz_slide_id, text_id, explanation_text_id, status, "
                + "question_response_type, question_type, access_level, auto_evaluation_json, evaluation_type, "
                + "question_order, marks, negative_marking) VALUES (?, ?, ?, ?, 'ACTIVE', 'OPTION', ?, 'PUBLIC', ?, "
                + "'AUTO', ?, ?, ?)", qid, quiz, textId, expId, type, key, order, marks, negative);
        return qid;
    }

    private void option(String questionId, String optionKey, String text) {
        jdbc.update("INSERT INTO quiz_slide_question_options (id, quiz_slide_question_id, text_id) VALUES (?, ?, ?)",
                optionKey, questionId, richText(text));
    }

    private String richText(String content) {
        String rid = id();
        jdbc.update("INSERT INTO rich_text_data (id, type, content) VALUES (?, 'TEXT', ?)", rid, content);
        return rid;
    }

    private CustomUserDetails user(String userId) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setRootUser(true);
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private QuizAttemptSubmitRequest request(String attemptId, Map<String, List<String>> picks) {
        QuizAttemptSubmitRequest request = new QuizAttemptSubmitRequest();
        request.setAttemptId(attemptId);
        request.setSlideId(slide);
        request.setChapterId(chapter);
        request.setModuleId("m");
        request.setSubjectId("s");
        request.setPackageSessionId(packageSession);
        request.setStartTimeInMillis(System.currentTimeMillis() - 60_000);
        request.setEndTimeInMillis(System.currentTimeMillis());
        List<QuizAttemptSubmitRequest.Answer> answers = new ArrayList<>();
        picks.forEach((question, ids) -> {
            QuizAttemptSubmitRequest.Answer answer = new QuizAttemptSubmitRequest.Answer();
            answer.setQuestionId(question);
            answer.setSelectedOptionIds(ids);
            answers.add(answer);
        });
        request.setAnswers(answers);
        return request;
    }

    private QuizAttemptResultResponse submit(String attemptId, Map<String, List<String>> picks) {
        return service.submit(request(attemptId, picks), user(learner), institute);
    }

    private int attemptRows() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM activity_log WHERE slide_id = ?", Integer.class, slide);
    }

    private int answerRows() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM quiz_slide_question_tracked t JOIN activity_log a "
                + "ON a.id = t.activity_id WHERE a.slide_id = ?", Integer.class, slide);
    }

    private void setCap(int cap) {
        jdbc.update("UPDATE quiz_slide SET re_attempt_count = ? WHERE id = ?", cap, quiz);
    }

    @Test
    @DisplayName("grades, records one row per question, and scores by the quiz rules")
    void gradesAndRecords() throws Exception {
        String attempt = id();
        QuizAttemptResultResponse result = submit(attempt, Map.of(q1, List.of("A1"), q2, List.of("B1"),
                q3, List.of("an essay")));

        assertThat(result.getStatus()).isEqualTo(Status.GRADED);
        assertThat(result.getAttemptsUsed()).isEqualTo(1);
        assertThat(result.isCanAttempt()).isTrue();
        AttemptSummary summary = result.getAttempts().get(0);
        assertThat(summary.getAttemptId()).isEqualTo(attempt);
        // q1 2 of 2 (quiz default), q2 half of 4 (partial marking), q3 not marked.
        assertThat(summary.getEarned()).isEqualTo(4.0);
        assertThat(summary.getTotalMarks()).isEqualTo(8.0);
        assertThat(summary.getCorrect()).isEqualTo(1);
        assertThat(summary.getPartial()).isEqualTo(1);
        assertThat(summary.getPending()).isEqualTo(1);
        assertThat(summary.getPassed()).isTrue();

        assertThat(attemptRows()).isEqualTo(1);
        assertThat(answerRows()).isEqualTo(3);
        Map<String, Object> row = jdbc.queryForMap("SELECT response_json, response_status FROM "
                + "quiz_slide_question_tracked WHERE activity_id = ? AND question_id = ?", attempt, q2);
        assertThat(row.get("response_status")).isEqualTo("WRONG");
        JsonNode json = MAPPER.readTree((String) row.get("response_json"));
        assertThat(json.path("marks").asDouble()).isEqualTo(2.0);
        assertThat(json.path("maxMarks").asDouble()).isEqualTo(4.0);
        assertThat(json.path("isPartial").asBoolean()).isTrue();
        assertThat(json.path("gradedBy").asText()).isEqualTo("server");
        assertThat(jdbc.queryForObject("SELECT response_status FROM quiz_slide_question_tracked WHERE "
                + "activity_id = ? AND question_id = ?", String.class, attempt, q3)).isEqualTo("SUBMITTED");
    }

    @Test
    @DisplayName("progress and analytics run after the attempt is committed")
    void hooksRunAfterCommit() {
        AtomicBoolean inTransaction = new AtomicBoolean(true);
        doAnswer(call -> {
            inTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            return null;
        }).when(asyncService).updateLearnerOperationsForQuiz(any(), any(), any(), any(), any(), any(), any());
        submit(id(), Map.of(q1, List.of("A1")));
        assertThat(inTransaction.get()).isFalse();
        verify(asyncService).updateLearnerOperationsForQuiz(any(), any(), any(), any(), any(), any(), any());
        verify(asyncService).saveLLMQuizDataAsync(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a retry of the same attempt returns the stored result and changes nothing")
    void retryIsIdempotent() {
        String attempt = id();
        QuizAttemptResultResponse first = submit(attempt, Map.of(q1, List.of("A1")));
        QuizAttemptResultResponse retry = submit(attempt, Map.of(q1, List.of("A2")));

        assertThat(first.getStatus()).isEqualTo(Status.GRADED);
        assertThat(retry.getStatus()).isEqualTo(Status.ALREADY_GRADED);
        assertThat(retry.getAttempts().get(0).getEarned()).isEqualTo(first.getAttempts().get(0).getEarned());
        assertThat(attemptRows()).isEqualTo(1);
        assertThat(answerRows()).isEqualTo(3);
        verify(asyncService, times(1)).updateLearnerOperationsForQuiz(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a retry still returns its result once the cap is reached")
    void retryAfterCapStillAnswers() {
        setCap(1);
        String attempt = id();
        submit(attempt, Map.of(q1, List.of("A1")));
        assertThat(submit(attempt, Map.of(q1, List.of("A1"))).getStatus()).isEqualTo(Status.ALREADY_GRADED);
    }

    @Test
    @DisplayName("past the cap nothing is recorded, and the earlier result comes back")
    void capEnforced() {
        setCap(2);
        submit(id(), Map.of(q1, List.of("A2")));
        QuizAttemptResultResponse second = submit(id(), Map.of(q1, List.of("A2")));
        assertThat(second.isCanAttempt()).isFalse();
        assertThat(second.getAttemptsLeft()).isEqualTo(0);

        QuizAttemptResultResponse third = submit(id(), Map.of(q1, List.of("A1")));
        assertThat(third.getStatus()).isEqualTo(Status.ATTEMPTS_EXHAUSTED);
        assertThat(third.getAttemptsUsed()).isEqualTo(2);
        assertThat(third.getAttempts()).hasSize(2);
        assertThat(attemptRows()).isEqualTo(2);
    }

    @Test
    @DisplayName("attempts recorded by the older endpoint count towards the cap")
    void legacyRowsCount() {
        setCap(1);
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                id(), slide, learner, slide);
        assertThat(submit(id(), Map.of(q1, List.of("A1"))).getStatus()).isEqualTo(Status.ATTEMPTS_EXHAUSTED);
    }

    @Test
    @DisplayName("twenty tabs racing a cap of two record exactly two attempts")
    void capHoldsUnderRace() throws Exception {
        setCap(2);
        int threads = 20;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Status>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                go.await();
                return submit(id(), Map.of(q1, List.of("A1"))).getStatus();
            }));
        }
        go.countDown();
        int graded = 0;
        int refused = 0;
        for (Future<Status> f : futures) {
            Status status = f.get();
            if (status == Status.GRADED) {
                graded++;
            } else if (status == Status.ATTEMPTS_EXHAUSTED) {
                refused++;
            }
        }
        pool.shutdownNow();
        assertThat(graded).isEqualTo(2);
        assertThat(refused).isEqualTo(18);
        assertThat(attemptRows()).isEqualTo(2);
        assertThat(answerRows()).isEqualTo(6);
    }

    @Test
    @DisplayName("ten retries of one attempt at once make one attempt, and all get its result")
    void sameAttemptRace() throws Exception {
        String attempt = id();
        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<QuizAttemptResultResponse>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                go.await();
                return submit(attempt, Map.of(q1, List.of("A1")));
            }));
        }
        go.countDown();
        int graded = 0;
        for (Future<QuizAttemptResultResponse> f : futures) {
            QuizAttemptResultResponse result = f.get();
            assertThat(result.getAttempts().get(0).getEarned()).isEqualTo(2.0);
            if (result.getStatus() == Status.GRADED) {
                graded++;
            }
        }
        pool.shutdownNow();
        assertThat(graded).isEqualTo(1);
        assertThat(attemptRows()).isEqualTo(1);
        assertThat(answerRows()).isEqualTo(3);
    }

    @Test
    @DisplayName("another learner's attempt id is refused and left as it was")
    void anotherLearnersAttemptId() {
        String attempt = id();
        submit(attempt, Map.of(q1, List.of("A1")));
        String other = id();
        enrol(other, "ACTIVE", null, institute);
        assertThatThrownBy(() -> service.submit(request(attempt, Map.of(q1, List.of("A2"))), user(other), institute))
                .isInstanceOf(ConflictException.class);
        assertThat(jdbc.queryForObject("SELECT user_id FROM activity_log WHERE id = ?", String.class, attempt))
                .isEqualTo(learner);
    }

    @Test
    @DisplayName("not enrolled, inactive, unpaid or enrolled under another institute: refused, even as root")
    void notEnrolled() {
        String stranger = id();
        assertThatThrownBy(() -> service.submit(request(id(), Map.of()), user(stranger), institute))
                .isInstanceOf(ForbiddenException.class);

        String inactive = id();
        enrol(inactive, "INACTIVE", null, institute);
        assertThatThrownBy(() -> service.submit(request(id(), Map.of()), user(inactive), institute))
                .isInstanceOf(ForbiddenException.class);

        String unpaid = id();
        enrol(unpaid, "ACTIVE", "ABANDONED_CART", institute);
        assertThatThrownBy(() -> service.submit(request(id(), Map.of()), user(unpaid), institute))
                .isInstanceOf(ForbiddenException.class);

        String wrongInstitute = id();
        enrol(wrongInstitute, "ACTIVE", null, id());
        assertThatThrownBy(() -> service.submit(request(id(), Map.of()), user(wrongInstitute), institute))
                .isInstanceOf(ForbiddenException.class);

        assertThat(attemptRows()).isEqualTo(0);
        verify(asyncService, never()).updateLearnerOperationsForQuiz(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a learner whose app points at another institute is still graded on the real membership")
    void headerDoesNotDecideEnrolment() {
        assertThat(service.submit(request(id(), Map.of(q1, List.of("A1"))), user(learner), id()).getStatus())
                .isEqualTo(Status.GRADED);
    }

    @Test
    @DisplayName("a draft or deleted quiz is not graded")
    void draftNotGraded() {
        jdbc.update("UPDATE slide SET status = 'DRAFT' WHERE id = ?", slide);
        assertThatThrownBy(() -> submit(id(), Map.of(q1, List.of("A1")))).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("answers come back only after an attempt, and only if the institute allows it")
    void reviewRules() {
        QuizAttemptResultResponse before = service.getResult(slide, user(learner), institute);
        assertThat(before.isShowAnswers()).isFalse();
        assertThat(before.getAnswerKeys()).isEmpty();
        assertThat(before.getAttempts()).isEmpty();
        assertThat(before.getAttemptId()).isNull();

        QuizAttemptResultResponse after = submit(id(), Map.of(q1, List.of("A2")));
        assertThat(after.isShowAnswers()).isTrue();
        assertThat(after.getAnswerKeys()).hasSize(3);
        assertThat(after.getAnswerKeys().get(0).getCorrectOptionIds()).containsExactly("A1");
        assertThat(after.getAnswerKeys().get(0).getExplanation()).isEqualTo("Because one");
        assertThat(after.getAnswerKeys().get(2).getCorrectAnswerText()).isEqualTo("model");

        jdbc.update("UPDATE institutes SET setting_json = ? WHERE id = ?",
                "{\"setting\":{\"STUDENT_DISPLAY_SETTINGS\":{\"data\":{\"courseSettings\":{\"quiz\":"
                        + "{\"showReportAndCorrectAnswers\":false}}}}}}", institute);
        QuizAttemptResultResponse hidden = service.getResult(slide, user(learner), institute);
        assertThat(hidden.isShowAnswers()).isFalse();
        assertThat(hidden.getAnswerKeys()).isEmpty();
        assertThat(hidden.getAttempts()).hasSize(1);
        assertThat(hidden.getAttempts().get(0).getQuestions()).isNotEmpty();
    }

    @Test
    @DisplayName("a learner reads back only their own attempts")
    void readsOnlyOwnAttempts() {
        submit(id(), Map.of(q1, List.of("A1")));
        String other = id();
        enrol(other, "ACTIVE", null, institute);
        QuizAttemptResultResponse theirs = service.getResult(slide, user(other), institute);
        assertThat(theirs.getAttempts()).isEmpty();
        assertThat(theirs.getAnswerKeys()).isEmpty();
    }

    @Test
    @DisplayName("a positional answer key is graded through the option order")
    void positionalKey() {
        String q4 = question("MCQS", "{\"correctAnswers\":[1]}", "Q four", null, 4, null, null);
        option(q4, "D1-" + q4, "First");
        option(q4, "D2-" + q4, "Second");
        QuizAttemptResultResponse result = submit(id(), Map.of(q4, List.of("D2-" + q4)));
        assertThat(result.getAttempts().get(0).getQuestions().stream()
                .filter(q -> q.getQuestionId().equals(q4)).findFirst().orElseThrow().getOutcome())
                .isEqualTo("CORRECT");
    }

    @Test
    @DisplayName("older rows with no marks are scored one per correct answer")
    void olderRowsScored() {
        String attempt = id();
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                attempt, slide, learner, slide);
        jdbc.update("INSERT INTO quiz_slide_question_tracked (id, activity_id, question_id, response_json, response_status) "
                + "VALUES (?, ?, ?, ?, 'SUBMITTED')", id(), attempt, q1, "{\"answer\":\"A1\"}");
        jdbc.update("INSERT INTO quiz_slide_question_tracked (id, activity_id, question_id, response_json, response_status) "
                + "VALUES (?, ?, ?, ?, 'SUBMITTED')", id(), attempt, q2, "{}");
        AttemptSummary summary = service.getResult(slide, user(learner), institute).getAttempts().get(0);
        assertThat(summary.getEarned()).isEqualTo(1);
        assertThat(summary.getTotalMarks()).isEqualTo(2);
        assertThat(summary.getCorrect()).isEqualTo(1);
        assertThat(summary.getSkipped()).isEqualTo(1);
    }

    @Test
    @DisplayName("the AI tutor's record keeps its own judgement and the words the learner used")
    void tutorRecordsAreLeftAlone() throws Exception {
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId(id());
        dto.setSourceId(slide);
        dto.setSourceType("QUIZ");
        dto.setNewActivity(true);
        QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
        side.setId(id());
        side.setQuestionId(q3);
        side.setResponseStatus("CORRECT");
        side.setResponseJson("{\"questionName\":\"x\",\"selectedOptions\":[],\"correctOptions\":[],\"learnerAnswer\":\"spoken\","
                + "\"marks\":1,\"maxMarks\":1,\"isCorrect\":true,\"questionType\":\"ONE_WORD\",\"source\":\"tutor\"}");
        dto.setQuizSides(List.of(side));
        tx.executeWithoutResult(s -> legacyService.addOrUpdateQuizSlideActivityLog(dto, slide, chapter, "m", "s",
                packageSession, "ignored", user(learner)));
        JsonNode json = MAPPER.readTree(jdbc.queryForObject("SELECT response_json FROM quiz_slide_question_tracked "
                + "WHERE id = ?", String.class, side.getId()));
        assertThat(json.path("learnerAnswer").asText()).isEqualTo("spoken");
        assertThat(json.path("marks").asDouble()).isEqualTo(1.0);
        assertThat(json.has("gradedBy")).isFalse();
    }

    @Test
    @DisplayName("the older endpoint now records server marks, whatever the client claimed")
    void legacyEndpointRecordsServerMarks() throws Exception {
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId(id());
        dto.setSourceId(slide);
        dto.setSourceType("QUIZ");
        dto.setNewActivity(true);
        QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
        side.setId(id());
        side.setQuestionId(q1);
        side.setResponseStatus("CORRECT");
        side.setResponseJson("{\"questionName\":\"x\",\"selectedOptions\":[{\"id\":\"A2\",\"name\":\"Other\"}],"
                + "\"marks\":99,\"maxMarks\":99,\"isCorrect\":true}");
        dto.setQuizSides(List.of(side));

        tx.executeWithoutResult(s -> legacyService.addOrUpdateQuizSlideActivityLog(dto, slide, chapter, "m", "s",
                packageSession, "ignored", user(learner)));

        Map<String, Object> row = jdbc.queryForMap("SELECT response_json, response_status FROM "
                + "quiz_slide_question_tracked WHERE id = ?", side.getId());
        assertThat(row.get("response_status")).isEqualTo("WRONG");
        JsonNode json = MAPPER.readTree((String) row.get("response_json"));
        assertThat(json.path("marks").asDouble()).isEqualTo(-0.5);
        assertThat(json.path("maxMarks").asDouble()).isEqualTo(2.0);
        assertThat(json.path("isCorrect").asBoolean()).isFalse();
        assertThat(json.path("gradedBy").asText()).isEqualTo("server-legacy");
    }

    @Test
    @DisplayName("with enforcement on, the older endpoint refuses strangers and attempts past the cap")
    void legacyEnforcement() {
        setCap(1);
        ActivityLogDTO first = new ActivityLogDTO();
        first.setId(id());
        assertThatThrownBy(() -> legacyService.requireLegacySubmitAllowed(first, slide, user(id()), institute))
                .isInstanceOf(ForbiddenException.class);

        legacyService.requireLegacySubmitAllowed(first, slide, user(learner), institute);
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                first.getId(), slide, learner, slide);
        // The same attempt sent again is still fine; a new one is past the cap.
        legacyService.requireLegacySubmitAllowed(first, slide, user(learner), institute);
        ActivityLogDTO second = new ActivityLogDTO();
        second.setId(id());
        assertThatThrownBy(() -> legacyService.requireLegacySubmitAllowed(second, slide, user(learner), institute))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("an attempt log read by its learner has no correct answers, and nobody else may read it")
    void attemptLogRedaction() {
        submit(id(), Map.of(q1, List.of("A2")));
        tx.executeWithoutResult(s -> {
            var logs = legacyService.getQuizSlideActivityLog(learner, slide,
                    org.springframework.data.domain.PageRequest.of(0, 10), user(learner));
            assertThat(logs.getTotalElements()).isEqualTo(1);
            var sides = logs.getContent().get(0).getQuizSides();
            assertThat(sides).hasSize(3);
            sides.forEach(side -> {
                assertThat(side.getResponseJson()).doesNotContain("correctOptions");
                assertThat(side.getResponseJson()).contains("selectedOptions");
            });
        });
        assertThatThrownBy(() -> legacyService.getQuizSlideActivityLog(learner, slide,
                org.springframework.data.domain.PageRequest.of(0, 10), user(id())))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("a quiz question is checked only where the institute uses move-on-when-correct")
    void quizCheckGated() {
        QuizAnswerCheckRequest check = new QuizAnswerCheckRequest();
        check.setSlideId(slide);
        check.setQuestionId(q1);
        check.setSelectedOptionIds(List.of("A1"));
        assertThatThrownBy(() -> service.checkAnswer(check, user(learner), institute))
                .isInstanceOf(ForbiddenException.class);

        jdbc.update("UPDATE institutes SET setting_json = ? WHERE id = ?",
                "{\"setting\":{\"STUDENT_DISPLAY_SETTINGS\":{\"data\":{\"courseSettings\":{\"quiz\":"
                        + "{\"showReportAndCorrectAnswers\":false,\"moveOnlyOnCorrectAnswer\":true}}}}}}", institute);
        QuizAnswerCheckResponse ok = service.checkAnswer(check, user(learner), institute);
        assertThat(ok.getCorrect()).isTrue();
        assertThat(ok.getCorrectOptionIds()).isNull();
        assertThat(ok.getExplanation()).isNull();
        check.setSelectedOptionIds(List.of("A2"));
        assertThat(service.checkAnswer(check, user(learner), institute).getCorrect()).isFalse();
    }

    @Test
    @DisplayName("a question slide check returns its guidance")
    void questionSlideCheck() {
        String qs = id();
        String expl = richText("Guidance");
        String textId = richText("Q");
        jdbc.update("INSERT INTO question_slide (id, text_id, explanation_text_id, question_response_type, question_type, "
                + "access_level, auto_evaluation_json) VALUES (?, ?, ?, 'OPTION', 'MCQS', 'PUBLIC', ?)", qs, textId, expl, "{\"data\":{\"correctOptionIds\":[\"X\"]}}");
        jdbc.update("UPDATE slide SET source_type = 'QUESTION', source_id = ? WHERE id = ?", qs, slide);
        QuizAnswerCheckRequest check = new QuizAnswerCheckRequest();
        check.setSlideId(slide);
        check.setQuestionId(qs);
        check.setSelectedOptionIds(List.of("X"));
        QuizAnswerCheckResponse response = service.checkAnswer(check, user(learner), institute);
        assertThat(response.getCorrect()).isTrue();
        assertThat(response.getExplanation()).isEqualTo("Guidance");
        assertThat(response.getCorrectOptionIds()).containsExactly("X");

        QuizAnswerCheckRequest noAnswer = new QuizAnswerCheckRequest();
        noAnswer.setSlideId(slide);
        noAnswer.setQuestionId(qs);
        QuizAnswerCheckResponse nothing = service.checkAnswer(noAnswer, user(learner), institute);
        assertThat(nothing.getExplanation()).isNull();
        assertThat(nothing.getCorrectOptionIds()).isNull();

        check.setQuestionId(id());
        assertThatThrownBy(() -> service.checkAnswer(check, user(learner), institute))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("a video question check needs the question to be on that video")
    void videoCheck() {
        String video = id();
        String vq = id();
        jdbc.update("INSERT INTO video_slide_question (id, video_slide_id, question_response_type, question_type, "
                + "access_level, auto_evaluation_json, status) VALUES (?, ?, 'OPTION', 'MCQM', 'PUBLIC', ?, 'ACTIVE')",
                vq, video, "{\"data\":{\"correctOptionIds\":[\"V1\",\"V2\"]}}");
        jdbc.update("UPDATE slide SET source_type = 'VIDEO', source_id = ? WHERE id = ?", video, slide);
        QuizAnswerCheckRequest check = new QuizAnswerCheckRequest();
        check.setSlideId(slide);
        check.setQuestionId(vq);
        check.setSelectedOptionIds(List.of("V1"));
        assertThat(service.checkAnswer(check, user(learner), institute).getCorrect()).isFalse();
        check.setSelectedOptionIds(List.of("V2", "V1"));
        assertThat(service.checkAnswer(check, user(learner), institute).getCorrect()).isTrue();
    }

    @Test
    void loadedRowsCarryTheActivityEntity() {
        String attempt = id();
        submit(attempt, Map.of(q1, List.of("A1")));
        ActivityLog stored = activityLogRepository.findById(attempt).orElseThrow();
        assertThat(stored.getSourceType()).isEqualTo("QUIZ");
        assertThat(stored.getSlideId()).isEqualTo(slide);
        assertThat(stored.getUserId()).isEqualTo(learner);
    }
}
