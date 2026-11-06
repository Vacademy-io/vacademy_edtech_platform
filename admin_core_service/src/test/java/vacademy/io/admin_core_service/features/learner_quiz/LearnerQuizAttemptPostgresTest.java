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
import org.junit.jupiter.api.AfterEach;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyStripper;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AuthoringAnswerAccess;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineSyncEventRequestDTO;
import vacademy.io.admin_core_service.features.learner_offline.dto.OfflineSyncEventResultDTO;
import vacademy.io.admin_core_service.features.learner_offline.enums.OfflineSyncEventStatus;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineSyncDiscrepancyRepository;
import vacademy.io.admin_core_service.features.learner_offline.repository.OfflineSyncEventRepository;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineDownloadStateService;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineQuizRescoringService;
import vacademy.io.admin_core_service.features.learner_offline.service.OfflineSyncEventProcessor;
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
import vacademy.io.admin_core_service.features.learner_tracking.service.AssignmentSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuestionSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuizSlideActivityLogService;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.quiz_results.repository.QuizResultsRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionOptionRepository;
import vacademy.io.admin_core_service.features.slide.repository.QuizSlideQuestionRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
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
import static org.mockito.Mockito.when;
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
    /** The older endpoint with every switch on, and with every switch off. */
    private static QuizSlideActivityLogService legacyService;
    private static QuizSlideActivityLogService legacyOff;
    private static OfflineSyncEventProcessor offlineOn;
    private static OfflineSyncEventProcessor offlineOff;
    private static OfflineSyncEventRepository offlineEvents;
    private static AuthoringAnswerAccess authoringAccess;
    private static QuizResultsRepository resultsRepository;
    private static EntityManager entityManager;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String institute;
    private String slide;
    private String quiz;
    private String packageSession;
    private String chapter;
    private String learner;
    private String pkg;
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
        entityManager = em;
        resultsRepository = factory.getRepository(QuizResultsRepository.class);
        authoringAccess = new AuthoringAnswerAccess(repository, new InstituteAccessValidator());
        legacyService = legacy(new AnswerKeyAccess(false, true, false, true), scorer, loader, grader, transactionManager);
        legacyOff = legacy(new AnswerKeyAccess(false, false, false, false), scorer, loader, grader, transactionManager);
        offlineEvents = mock(OfflineSyncEventRepository.class);
        offlineOn = offline(legacyService);
        offlineOff = offline(legacyOff);
    }

    private static QuizSlideActivityLogService legacy(AnswerKeyAccess switches, AutoEvaluationScorer scorer,
            QuizLoader loader, QuizGrader grader, JpaTransactionManager transactionManager) {
        return new QuizSlideActivityLogService(trackedRepository, activityLogRepository,
                new ActivityLogService(activityLogRepository), asyncService, questionRepository, optionRepository,
                scorer, loader, grader, switches,
                new AnswerKeyStripper(MAPPER), new LearnerQuizAccessService(repository, new InstituteAccessValidator()),
                repository, authoringAccess, transactionManager);
    }

    private static OfflineSyncEventProcessor offline(QuizSlideActivityLogService quizService) {
        OfflineQuizRescoringService rescoring = mock(OfflineQuizRescoringService.class);
        return new OfflineSyncEventProcessor(offlineEvents, mock(OfflineSyncDiscrepancyRepository.class), rescoring,
                mock(OfflineDownloadStateService.class), mock(LearnerTrackingService.class),
                mock(QuestionSlideActivityLogService.class), quizService, mock(AssignmentSlideActivityLogService.class));
    }

    @AfterAll
    static void shutdown() {
        if (emfBean != null) {
            emfBean.destroy();
        }
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @BeforeEach
    void seed() {
        reset(asyncService);
        reset(offlineEvents);
        when(offlineEvents.insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(1);
        // Option ids are fixed names in these tests; everything else is unique per test.
        jdbc.update("DELETE FROM quiz_slide_question_options");
        institute = id();
        slide = id();
        quiz = id();
        packageSession = id();
        chapter = id();
        learner = id();
        jdbc.update("INSERT INTO institutes (id, name, setting_json) VALUES (?, 'T', NULL)", institute);
        pkg = id();
        jdbc.update("INSERT INTO package (id, package_name, status) VALUES (?, 'Course', 'ACTIVE')", pkg);
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
        legacyPost(legacyOff, oldClientPost(id(), slide, Map.of(q1, List.of("A1"))));
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
        // q3 has no row: it stays in the total, one mark like the rest of an attempt this old.
        assertThat(summary.getTotalMarks()).isEqualTo(3);
        assertThat(summary.getCorrect()).isEqualTo(1);
        assertThat(summary.getSkipped()).isEqualTo(2);
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
        ActivityLogDTO first = oldClientPost(id(), slide, Map.of(q1, List.of("A1")));
        assertThatThrownBy(() -> legacyService.requireLegacySubmitAllowed(first, slide, user(id()), institute))
                .isInstanceOf(ForbiddenException.class);

        legacyService.requireLegacySubmitAllowed(first, slide, user(learner), institute);
        legacyPost(legacyService, first);
        // The same attempt sent again is still fine; a new one is past the cap.
        legacyService.requireLegacySubmitAllowed(first, slide, user(learner), institute);
        assertThat(legacyPost(legacyService, first)).isEqualTo(first.getId());
        ActivityLogDTO second = oldClientPost(id(), slide, Map.of(q1, List.of("A1")));
        assertThatThrownBy(() -> legacyPost(legacyService, second)).isInstanceOf(ConflictException.class);
        assertThat(attemptRows()).isEqualTo(1);
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
        assertThat(response.getCorrectOptionIds()).as("guidance only, the screen reads nothing else").isNull();
        assertThat(response.getCorrectAnswerText()).isNull();

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

    // ---------------------------------------------------------------- what an old client posts

    /** The body the older quiz viewer posts: judged on the device, marks included. */
    private ActivityLogDTO oldClientPost(String attemptId, String onSlide, Map<String, List<String>> picks) {
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId(attemptId);
        dto.setSourceId(onSlide);
        dto.setSourceType("QUIZ");
        dto.setSlideId(onSlide);
        dto.setPercentageWatched(100.0);
        dto.setNewActivity(true);
        List<QuizSideActivityLogDTO> sides = new ArrayList<>();
        picks.forEach((question, ids) -> sides.add(oldClientRow(question, ids, 2, 2, true, "CORRECT")));
        dto.setQuizSides(sides);
        return dto;
    }

    private QuizSideActivityLogDTO oldClientRow(String question, List<String> ids, double marks, double max,
            boolean correct, String status) {
        QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
        side.setId(id());
        side.setQuestionId(question);
        side.setResponseStatus(status);
        var selected = MAPPER.createArrayNode();
        ids.forEach(optionId -> selected.addObject().put("id", optionId).put("name", optionId));
        var json = MAPPER.createObjectNode();
        json.put("questionName", "shown to the learner");
        json.set("selectedOptions", selected);
        json.putArray("correctOptions");
        json.put("marks", marks);
        json.put("maxMarks", max);
        json.put("isCorrect", correct);
        json.put("isPartial", false);
        json.put("questionType", "MCQS");
        side.setResponseJson(json.toString());
        return side;
    }

    private String legacyPost(QuizSlideActivityLogService on, ActivityLogDTO dto) {
        return on.addOrUpdateQuizSlideActivityLog(dto, slide, chapter, "m", "s", packageSession, "ignored", user(learner));
    }

    private JsonNode storedRow(String attempt, String question) throws Exception {
        return MAPPER.readTree(jdbc.queryForObject("SELECT response_json FROM quiz_slide_question_tracked "
                + "WHERE activity_id = ? AND question_id = ?", String.class, attempt, question));
    }

    private String storedStatus(String attempt, String question) {
        return jdbc.queryForObject("SELECT response_status FROM quiz_slide_question_tracked WHERE activity_id = ? "
                + "AND question_id = ?", String.class, attempt, question);
    }

    private int rowsOn(String attempt) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM quiz_slide_question_tracked WHERE activity_id = ?",
                Integer.class, attempt);
    }

    private CustomUserDetails userWith(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private void signedInTo(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private void hideAnswers(String inInstitute) {
        jdbc.update("UPDATE institutes SET setting_json = ? WHERE id = ?",
                "{\"setting\":{\"STUDENT_DISPLAY_SETTINGS\":{\"data\":{\"courseSettings\":{\"quiz\":"
                        + "{\"showReportAndCorrectAnswers\":false}}}}}}", inInstitute);
    }

    // ---------------------------------------------------------------- rollout step 1: nothing changes

    @Test
    @DisplayName("switches off: an old client's rows keep its own judgement, field for field")
    void oldClientRowsStayAsJudged() throws Exception {
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
        // A correct pick, a partial pick, and a long answer the old viewer counted wrong.
        QuizSideActivityLogDTO right = oldClientRow(q1, List.of("A1"), 2, 2, true, "CORRECT");
        QuizSideActivityLogDTO part = oldClientRow(q2, List.of("B1"), 2, 4, false, "WRONG");
        QuizSideActivityLogDTO essay = oldClientRow(q3, List.of("an essay"), -0.5, 2, false, "WRONG");
        dto.setQuizSides(List.of(right, part, essay));
        String clientEssay = essay.getResponseJson();

        legacyPost(legacyOff, dto);

        assertThat(storedStatus(attempt, q3)).as("not rewritten to waiting-for-marking").isEqualTo("WRONG");
        JsonNode stored = storedRow(attempt, q3);
        assertThat(stored.path("marks").asDouble()).isEqualTo(-0.5);
        assertThat(stored.path("questionName").asText()).isEqualTo("shown to the learner");
        assertThat(stored.path("gradedBy").asText()).isEqualTo("client-legacy");
        var withoutMarker = (com.fasterxml.jackson.databind.node.ObjectNode) stored.deepCopy();
        withoutMarker.remove("gradedBy");
        assertThat(withoutMarker).isEqualTo(MAPPER.readTree(clientEssay));
        assertThat(storedRow(attempt, q2).path("marks").asDouble()).isEqualTo(2.0);
        assertThat(storedRow(attempt, q1).path("marks").asDouble()).isEqualTo(2.0);
        assertThat(storedStatus(attempt, q1)).isEqualTo("CORRECT");
    }

    @Test
    @DisplayName("a one-word answer that matches an explicit key stays correct, on every path")
    void oneWordKeyStaysCorrect() throws Exception {
        String word = question("ONE_WORD", "{\"correctAnswers\":[\"Paris\"]}", "Capital?", null, 4, null, null);

        String oldClient = id();
        ActivityLogDTO dto = oldClientPost(oldClient, slide, Map.of());
        dto.setQuizSides(List.of(oldClientRow(word, List.of("Paris"), 2, 2, true, "CORRECT")));
        legacyPost(legacyOff, dto);
        assertThat(storedRow(oldClient, word).path("marks").asDouble()).isEqualTo(2.0);
        assertThat(storedRow(oldClient, word).path("isCorrect").asBoolean()).isTrue();
        assertThat(storedStatus(oldClient, word)).isEqualTo("CORRECT");

        String newClient = id();
        QuizAttemptSubmitRequest.Answer typed = new QuizAttemptSubmitRequest.Answer();
        typed.setQuestionId(word);
        typed.setTextAnswer("Paris");
        QuizAttemptSubmitRequest request = request(newClient, Map.of());
        request.setAnswers(List.of(typed));
        AttemptSummary summary = service.submit(request, user(learner), institute).getAttempts().get(0);
        assertThat(summary.getQuestions().stream().filter(q -> q.getQuestionId().equals(word)).findFirst()
                .orElseThrow().getOutcome()).isEqualTo("CORRECT");

        // Anything else waits for a person. It is not marked wrong.
        typed.setTextAnswer("London");
        request.setAttemptId(id());
        AttemptSummary other = service.submit(request, user(learner), institute).getAttempts().get(0);
        assertThat(other.getQuestions().stream().filter(q -> q.getQuestionId().equals(word)).findFirst()
                .orElseThrow().getOutcome()).isEqualTo("PENDING");
    }

    // ---------------------------------------------------------------- a normal old client

    @Test
    @DisplayName("a normal old client's first post and retry work with switches off and on")
    void oldClientFirstPostAndRetry() throws Exception {
        for (QuizSlideActivityLogService endpoint : List.of(legacyOff, legacyService)) {
            reset(asyncService);
            String attempt = id();
            ActivityLogDTO first = oldClientPost(attempt, slide, Map.of(q1, List.of("A1"), q2, List.of("B1", "B2")));
            assertThat(legacyPost(endpoint, first)).isEqualTo(attempt);
            assertThat(rowsOn(attempt)).isEqualTo(2);
            String before = storedRow(attempt, q1).toString();

            ActivityLogDTO retry = oldClientPost(attempt, slide, Map.of(q1, List.of("A1"), q2, List.of("B1", "B2")));
            assertThat(legacyPost(endpoint, retry)).isEqualTo(attempt);
            assertThat(rowsOn(attempt)).isEqualTo(2);
            assertThat(storedRow(attempt, q1).toString()).isEqualTo(before);
            verify(asyncService, times(1)).updateLearnerOperationsForQuiz(any(), any(), any(), any(), any(), any(), any());
        }
    }

    @Test
    @DisplayName("a post with no id is refused plainly, as it always failed")
    void noIdIsRefused() {
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setSourceType("ASSESSMENT");
        assertThatThrownBy(() -> legacyPost(legacyOff, dto)).isInstanceOf(InvalidRequestException.class);
        assertThat(attemptRows()).isZero();
    }

    // ---------------------------------------------------------------- attempt integrity

    @Test
    @DisplayName("once graded, an attempt cannot be rewritten through the older endpoint")
    void gradedAttemptStays() throws Exception {
        setCap(1);
        for (QuizSlideActivityLogService endpoint : List.of(legacyOff, legacyService)) {
            String attempt = id();
            jdbc.update("DELETE FROM quiz_slide_question_tracked");
            jdbc.update("DELETE FROM activity_log");
            QuizAttemptResultResponse graded = submit(attempt, Map.of(q1, List.of("A2"), q2, List.of("B3")));
            assertThat(graded.getAttempts().get(0).getEarned()).isZero();

            for (boolean isNew : List.of(false, true)) {
                ActivityLogDTO rewrite = oldClientPost(attempt, slide, Map.of(q1, List.of("A1"), q2, List.of("B1", "B2")));
                rewrite.setNewActivity(isNew);
                assertThat(legacyPost(endpoint, rewrite)).isEqualTo(attempt);
            }

            AttemptSummary after = service.getResult(slide, user(learner), institute).getAttempts().get(0);
            assertThat(after.getEarned()).isZero();
            assertThat(after.getTotalMarks()).isEqualTo(8.0);
            assertThat(rowsOn(attempt)).isEqualTo(3);
            assertThat(storedRow(attempt, q1).path("gradedBy").asText()).isEqualTo("server");
        }
    }

    @Test
    @DisplayName("an attempt cannot be moved to, or rewritten from, another slide")
    void attemptStaysOnItsSlide() throws Exception {
        String attempt = id();
        legacyPost(legacyOff, oldClientPost(attempt, slide, Map.of(q1, List.of("A1"))));
        String before = storedRow(attempt, q1).toString();
        String otherSlide = id();
        for (boolean isNew : List.of(false, true)) {
            ActivityLogDTO elsewhere = oldClientPost(attempt, otherSlide, Map.of(q1, List.of("A2")));
            elsewhere.setNewActivity(isNew);
            assertThatThrownBy(() -> legacyOff.addOrUpdateQuizSlideActivityLog(elsewhere, otherSlide, chapter, "m", "s",
                    packageSession, "ignored", user(learner))).isInstanceOf(ConflictException.class);
        }
        assertThat(storedRow(attempt, q1).toString()).isEqualTo(before);
    }

    @Test
    @DisplayName("a row with no recorded answers is not an attempt and unlocks nothing")
    void emptyAttemptsUnlockNothing() {
        // What the document endpoint can write, and an empty post to the older endpoint.
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                id(), slide, learner, slide);
        legacyPost(legacyOff, oldClientPost(id(), slide, Map.of()));

        QuizAttemptResultResponse enrolled = service.getResult(slide, user(learner), institute);
        assertThat(enrolled.getAttemptsUsed()).isZero();
        assertThat(enrolled.isShowAnswers()).isFalse();
        assertThat(enrolled.getAnswerKeys()).isEmpty();

        String stranger = id();
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                id(), slide, stranger, slide);
        QuizAttemptResultResponse theirs = service.getResult(slide, user(stranger), id());
        assertThat(theirs.getAttemptsUsed()).isZero();
        assertThat(theirs.isShowAnswers()).isFalse();
        assertThat(theirs.getAnswerKeys()).isEmpty();
    }

    @Test
    @DisplayName("an empty row cannot be finished past the attempt cap")
    void emptyRowFollowsTheCap() {
        setCap(1);
        submit(id(), Map.of(q1, List.of("A2")));
        String empty = id();
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                empty, slide, learner, slide);
        assertThat(submit(empty, Map.of(q1, List.of("A1"))).getStatus()).isEqualTo(Status.ATTEMPTS_EXHAUSTED);
        assertThat(rowsOn(empty)).isZero();
    }

    @Test
    @DisplayName("a claimed score in a shape the server cannot read is not kept, whatever the switches")
    void unreadableClaimsGo() throws Exception {
        for (QuizSlideActivityLogService endpoint : List.of(legacyOff, legacyService)) {
            String attempt = id();
            ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
            QuizSideActivityLogDTO claimed = new QuizSideActivityLogDTO();
            claimed.setId(id());
            claimed.setQuestionId(q1);
            claimed.setResponseStatus("CORRECT");
            claimed.setResponseJson("{\"marks\":1000,\"maxMarks\":1,\"isCorrect\":true,\"note\":\"kept\"}");
            dto.setQuizSides(List.of(claimed));
            legacyPost(endpoint, dto);

            JsonNode stored = storedRow(attempt, q1);
            assertThat(stored.has("marks")).isFalse();
            assertThat(stored.has("isCorrect")).isFalse();
            assertThat(stored.path("note").asText()).isEqualTo("kept");
            assertThat(storedStatus(attempt, q1)).isEqualTo("SUBMITTED");
            AttemptSummary summary = service.getResult(slide, user(learner), institute).getAttempts().stream()
                    .filter(a -> a.getAttemptId().equals(attempt)).findFirst().orElseThrow();
            assertThat(summary.getEarned()).isZero();
        }
    }

    @Test
    @DisplayName("a row for a question this quiz does not have adds nothing to a score, stored or not")
    void rowOutsideTheQuiz() throws Exception {
        String stored = id();
        ActivityLogDTO off = oldClientPost(stored, slide, Map.of());
        off.setQuizSides(List.of(oldClientRow("not-a-question", List.of("x"), 100, 100, true, "CORRECT")));
        legacyPost(legacyOff, off);
        assertThat(storedRow(stored, "not-a-question").path("marks").asDouble()).as("kept as sent").isEqualTo(100.0);
        assertThat(storedStatus(stored, "not-a-question")).isEqualTo("CORRECT");

        String attempt = id();
        ActivityLogDTO on = oldClientPost(attempt, slide, Map.of());
        on.setQuizSides(List.of(oldClientRow("not-a-question", List.of("x"), 100, 100, true, "CORRECT")));
        legacyPost(legacyService, on);
        assertThat(storedRow(attempt, "not-a-question").has("marks")).isFalse();
        assertThat(storedStatus(attempt, "not-a-question")).isEqualTo("SUBMITTED");

        for (String each : List.of(stored, attempt)) {
            AttemptSummary summary = service.getResult(slide, user(learner), institute).getAttempts().stream()
                    .filter(a -> a.getAttemptId().equals(each)).findFirst().orElseThrow();
            assertThat(summary.getEarned()).isZero();
            assertThat(summary.getCorrect()).isZero();
            assertThat(summary.getSkipped()).as("the quiz's own questions").isEqualTo(3);
            assertThat(summary.getPassed()).isNotEqualTo(Boolean.TRUE);
        }
    }

    /** The Marks by Subject sums for one attempt, as findQuizMarksForUserInRange adds them up. */
    private List<Double> marksBySubject(String attempt) {
        return jdbc.queryForObject("""
                SELECT SUM(CASE WHEN t.response_status = 'CORRECT' THEN q.marks ELSE 0 END) AS obtained, SUM(q.marks) AS total
                FROM quiz_slide_question_tracked t
                JOIN quiz_slide_question q ON q.id = t.question_id
                WHERE t.activity_id = ?
                """, (row, n) -> List.of(row.getDouble("obtained"), row.getDouble("total")), attempt);
    }

    @Test
    @DisplayName("switches off: answering a question removed during the attempt stores what it always stored")
    void removedQuestionKeepsItsRecord() throws Exception {
        for (String removedStatus : new String[] { "DELETED", null }) {
            String kept = question("MCQS", "{\"correctAnswers\":[\"K1\"]}", "Kept", null, 7, 5.0, null);
            String removed = question("MCQS", "{\"correctAnswers\":[\"R1\"]}", "Removed", null, 8, 5.0, null);
            option(kept, "K1", "Right");
            option(removed, "R1", "Right");
            String attempt = id();
            ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
            dto.setQuizSides(List.of(oldClientRow(kept, List.of("K1"), 5, 5, true, "SUBMITTED"),
                    oldClientRow(removed, List.of("R1"), 5, 5, true, "SUBMITTED")));
            String sent = dto.getQuizSides().get(1).getResponseJson();
            jdbc.update("UPDATE quiz_slide_question SET status = ? WHERE id = ?", removedStatus, removed);

            legacyPost(legacyOff, dto);

            assertThat(storedStatus(attempt, removed)).isEqualTo("CORRECT");
            JsonNode stored = storedRow(attempt, removed);
            assertThat(stored.path("gradedBy").asText()).isEqualTo("client-legacy");
            var withoutMarker = (com.fasterxml.jackson.databind.node.ObjectNode) stored.deepCopy();
            withoutMarker.remove("gradedBy");
            assertThat(withoutMarker).isEqualTo(MAPPER.readTree(sent));
            assertThat(marksBySubject(attempt)).containsExactly(10.0, 10.0);
            jdbc.update("DELETE FROM quiz_slide_question_options WHERE id IN ('K1', 'R1')");
        }
    }

    @Test
    @DisplayName("switches off: marks changed during the attempt leave what the client recorded")
    void reMarkedQuestionKeepsItsRecord() throws Exception {
        String right = question("MCQS", "{\"correctAnswers\":[\"R1\"]}", "Right", null, 7, 5.0, 1.0);
        String wrong = question("MCQS", "{\"correctAnswers\":[\"W1\"]}", "Wrong", null, 8, 5.0, 1.0);
        String tutored = question("MCQS", "{\"correctAnswers\":[\"T1\"]}", "Tutored", null, 9, 1.0, null);
        option(right, "R1", "Right");
        option(wrong, "W1", "Right");
        option(wrong, "W2", "Other");
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
        QuizSideActivityLogDTO tutorRow = new QuizSideActivityLogDTO();
        tutorRow.setId(id());
        tutorRow.setQuestionId(tutored);
        tutorRow.setResponseStatus("CORRECT");
        tutorRow.setResponseJson("{\"selectedOptions\":[],\"learnerAnswer\":\"spoken\",\"marks\":1,\"maxMarks\":1,"
                + "\"isCorrect\":true,\"source\":\"tutor\"}");
        dto.setQuizSides(List.of(oldClientRow(right, List.of("R1"), 5, 5, true, "SUBMITTED"),
                oldClientRow(wrong, List.of("W2"), -1, 5, false, "SUBMITTED"), tutorRow));
        String sentTutor = tutorRow.getResponseJson();
        jdbc.update("UPDATE quiz_slide_question SET marks = 2, negative_marking = 0 WHERE id IN (?, ?)", right, wrong);
        jdbc.update("UPDATE quiz_slide_question SET marks = 0 WHERE id = ?", tutored);

        legacyPost(legacyOff, dto);

        assertThat(storedRow(attempt, right).path("marks").asDouble()).isEqualTo(5.0);
        assertThat(storedRow(attempt, right).path("maxMarks").asDouble()).isEqualTo(5.0);
        assertThat(storedRow(attempt, wrong).path("marks").asDouble()).isEqualTo(-1.0);
        assertThat(jdbc.queryForObject("SELECT response_json FROM quiz_slide_question_tracked WHERE activity_id = ? "
                + "AND question_id = ?", String.class, attempt, tutored)).isEqualTo(sentTutor);
    }

    @Test
    @DisplayName("with the switch on, the tutor's marks are held and no penalty stores a plain 0")
    void heldMarksStorePlainZero() {
        jdbc.update("UPDATE quiz_slide_question SET negative_marking = 0 WHERE id = ?", q1);
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
        QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
        side.setId(id());
        side.setQuestionId(q1);
        side.setResponseStatus("WRONG");
        side.setResponseJson("{\"selectedOptions\":[],\"marks\":-1,\"maxMarks\":2,\"source\":\"tutor\"}");
        dto.setQuizSides(List.of(side));
        legacyPost(legacyService, dto);
        String stored = jdbc.queryForObject("SELECT response_json FROM quiz_slide_question_tracked WHERE activity_id = ?",
                String.class, attempt);
        assertThat(stored).contains("\"marks\":0.0").doesNotContain("-0.0");
    }

    @Test
    @DisplayName("switches off: a post routed under another quiz's slide stays as judged, and adds nothing to that quiz's score")
    void rowsUnderAnotherSlideStayAsJudged() throws Exception {
        String otherQuiz = id();
        String otherSlide = id();
        jdbc.update("INSERT INTO quiz_slide (id, title, marks_per_question, negative_marking, pass_percentage, "
                + "partial_marking, re_attempt_count) VALUES (?, 'Other', 1, 0, 50, false, NULL)", otherQuiz);
        jdbc.update("INSERT INTO slide (id, source_id, source_type, title, status) VALUES (?, ?, 'QUIZ', 'Other', 'PUBLISHED')",
                otherSlide, otherQuiz);
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, otherSlide, Map.of());
        QuizSideActivityLogDTO skipped = oldClientRow(q2, List.of(), 0, 4, false, "SKIPPED");
        dto.setQuizSides(List.of(oldClientRow(q1, List.of("A1"), 2, 2, true, "SUBMITTED"), skipped));

        legacyOff.addOrUpdateQuizSlideActivityLog(dto, otherSlide, chapter, "m", "s", packageSession, "ignored", user(learner));

        assertThat(storedStatus(attempt, q1)).isEqualTo("CORRECT");
        assertThat(storedRow(attempt, q1).path("marks").asDouble()).isEqualTo(2.0);
        assertThat(storedRow(attempt, q1).path("gradedBy").asText()).isEqualTo("client-legacy");
        assertThat(storedStatus(attempt, q2)).isEqualTo("SKIPPED");
        assertThat(storedRow(attempt, q2).path("maxMarks").asDouble()).isEqualTo(4.0);
        AttemptSummary summary = service.getResult(otherSlide, user(learner), institute).getAttempts().get(0);
        assertThat(summary.getEarned()).isZero();
    }

    @Test
    @DisplayName("marks are held inside what the question can award, written with the switch on and whenever read")
    void marksStayInsideTheQuestion() throws Exception {
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
        dto.setQuizSides(List.of(oldClientRow(q1, List.of("A1"), 1000, 1000, true, "CORRECT")));
        legacyPost(legacyService, dto);
        assertThat(storedRow(attempt, q1).path("marks").asDouble()).isEqualTo(2.0);
        assertThat(storedRow(attempt, q1).path("maxMarks").asDouble()).isEqualTo(2.0);

        // A row already stored that way, with nothing to say it was marked here.
        String older = id();
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                older, slide, learner, slide);
        jdbc.update("INSERT INTO quiz_slide_question_tracked (id, activity_id, question_id, response_json, response_status) "
                + "VALUES (?, ?, ?, ?, 'CORRECT')", id(), older, q1,
                "{\"selectedOptions\":[{\"id\":\"A1\"}],\"marks\":1000,\"maxMarks\":1000,\"isCorrect\":true}");
        AttemptSummary summary = service.getResult(slide, user(learner), institute).getAttempts().stream()
                .filter(a -> a.getAttemptId().equals(older)).findFirst().orElseThrow();
        assertThat(summary.getEarned()).isEqualTo(2.0);
        assertThat(summary.getTotalMarks()).isEqualTo(8.0);
    }

    @Test
    @DisplayName("leaving questions out of a post does not shrink the total")
    void omittedQuestionsStayInTheTotal() {
        for (QuizSlideActivityLogService endpoint : List.of(legacyOff, legacyService)) {
            String attempt = id();
            legacyPost(endpoint, oldClientPost(attempt, slide, Map.of(q1, List.of("A1"))));
            AttemptSummary summary = service.getResult(slide, user(learner), institute).getAttempts().stream()
                    .filter(a -> a.getAttemptId().equals(attempt)).findFirst().orElseThrow();
            assertThat(summary.getEarned()).isEqualTo(2.0);
            assertThat(summary.getTotalMarks()).isEqualTo(8.0);
            assertThat(summary.getSkipped()).isEqualTo(2);
            assertThat(summary.getPassed()).isFalse();
        }
    }

    @Test
    @DisplayName("a client-chosen row id cannot take another learner's row")
    void rowIdCannotReachAnotherLearner() throws Exception {
        String otherLearner = id();
        enrol(otherLearner, "ACTIVE", null, institute);
        String theirAttempt = id();
        service.submit(request(theirAttempt, Map.of(q1, List.of("A1"))), user(otherLearner), institute);
        String theirRow = jdbc.queryForObject("SELECT id FROM quiz_slide_question_tracked WHERE activity_id = ? AND "
                + "question_id = ?", String.class, theirAttempt, q1);
        String theirJson = storedRow(theirAttempt, q1).toString();

        String mine = id();
        ActivityLogDTO dto = oldClientPost(mine, slide, Map.of());
        QuizSideActivityLogDTO aimed = oldClientRow(q1, List.of("A2"), 0, 2, false, "WRONG");
        aimed.setId(theirRow);
        dto.setQuizSides(List.of(aimed));
        legacyPost(legacyOff, dto);

        assertThat(rowsOn(theirAttempt)).isEqualTo(3);
        assertThat(storedRow(theirAttempt, q1).toString()).isEqualTo(theirJson);
        assertThat(rowsOn(mine)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT activity_id FROM quiz_slide_question_tracked WHERE id = ?", String.class,
                theirRow)).isEqualTo(theirAttempt);
    }

    @Test
    @DisplayName("the tutor keeps its judgement, inside what the question can award")
    void tutorMarksAreHeld() throws Exception {
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
        QuizSideActivityLogDTO side = new QuizSideActivityLogDTO();
        side.setId(id());
        side.setQuestionId(q1);
        side.setResponseStatus("CORRECT");
        side.setResponseJson("{\"selectedOptions\":[],\"learnerAnswer\":\"spoken\",\"marks\":1000,\"maxMarks\":1000,"
                + "\"isCorrect\":true,\"source\":\"tutor\",\"gradedBy\":\"server\"}");
        dto.setQuizSides(List.of(side));
        legacyPost(legacyService, dto);
        JsonNode stored = storedRow(attempt, q1);
        assertThat(stored.path("marks").asDouble()).isEqualTo(2.0);
        assertThat(stored.path("learnerAnswer").asText()).isEqualTo("spoken");
        assertThat(stored.has("gradedBy")).isFalse();
    }

    @Test
    @DisplayName("a typed answer the tutor judged wrong shows as wrong, an old penalty as a penalty")
    void recordedWrongStaysWrong() {
        String attempt = id();
        ActivityLogDTO dto = oldClientPost(attempt, slide, Map.of());
        QuizSideActivityLogDTO tutor = new QuizSideActivityLogDTO();
        tutor.setId(id());
        tutor.setQuestionId(q3);
        tutor.setResponseStatus("WRONG");
        tutor.setResponseJson("{\"selectedOptions\":[],\"learnerAnswer\":\"Pariss\",\"marks\":0,\"maxMarks\":1,"
                + "\"isCorrect\":false,\"source\":\"tutor\"}");
        dto.setQuizSides(List.of(tutor));
        legacyPost(legacyOff, dto);
        String older = id();
        jdbc.update("INSERT INTO activity_log (id, source_id, source_type, user_id, slide_id) VALUES (?, ?, 'QUIZ', ?, ?)",
                older, slide, learner, slide);
        jdbc.update("INSERT INTO quiz_slide_question_tracked (id, activity_id, question_id, response_json, response_status) "
                + "VALUES (?, ?, ?, ?, 'WRONG')", id(), older, q3,
                "{\"selectedOptions\":[{\"id\":\"essay\"}],\"marks\":-0.5,\"maxMarks\":2,\"isCorrect\":false}");
        for (String id : List.of(attempt, older)) {
            assertThat(service.getResult(slide, user(learner), institute).getAttempts().stream()
                    .filter(a -> a.getAttemptId().equals(id)).findFirst().orElseThrow().getQuestions().stream()
                    .filter(q -> q.getQuestionId().equals(q3)).findFirst().orElseThrow().getOutcome())
                    .as(id).isEqualTo("WRONG");
        }
    }

    @Test
    @DisplayName("the older endpoint and submit cannot interleave on one attempt")
    void legacyAndSubmitDoNotInterleave() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 15; round++) {
                String attempt = id();
                CountDownLatch go = new CountDownLatch(1);
                Future<?> viaSubmit = pool.submit(() -> {
                    go.await();
                    return service.submit(request(attempt, Map.of(q1, List.of("A2"))), user(learner), institute);
                });
                Future<?> viaLegacy = pool.submit(() -> {
                    go.await();
                    return legacyPost(legacyOff, oldClientPost(attempt, slide, Map.of(q1, List.of("A1"))));
                });
                go.countDown();
                viaSubmit.get();
                viaLegacy.get();
                int rows = rowsOn(attempt);
                assertThat(rows).as("one writer's rows only").isIn(1, 3);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("with enforcement on, parallel posts to the older endpoint cannot pass the cap")
    void legacyCapHoldsUnderRace() throws Exception {
        setCap(1);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<String>> posts = new ArrayList<>();
            for (int i = 0; i < 16; i++) {
                posts.add(pool.submit(() -> {
                    go.await();
                    try {
                        return legacyPost(legacyService, oldClientPost(id(), slide, Map.of(q1, List.of("A1"))));
                    } catch (ConflictException full) {
                        return "refused";
                    }
                }));
            }
            go.countDown();
            for (Future<String> post : posts) {
                post.get();
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(attemptRows()).isEqualTo(1);
    }

    @Test
    @DisplayName("a retry of a recorded attempt reads it back even if the slide or the membership has gone")
    void retryAfterAccessEnds() {
        String attempt = id();
        submit(attempt, Map.of(q1, List.of("A1")));
        jdbc.update("UPDATE student_session_institute_group_mapping SET status = 'INACTIVE' WHERE user_id = ?", learner);
        jdbc.update("UPDATE slide SET status = 'DRAFT' WHERE id = ?", slide);
        QuizAttemptResultResponse again = submit(attempt, Map.of(q1, List.of("A1")));
        assertThat(again.getStatus()).isEqualTo(Status.ALREADY_GRADED);
        assertThat(again.getAttempts()).hasSize(1);
        assertThatThrownBy(() -> submit(id(), Map.of(q1, List.of("A1")))).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("a slide or chapter removed from the batch is no longer the learner's")
    void removedContentIsNotAvailable() {
        jdbc.update("UPDATE chapter_to_slides SET status = 'DELETED' WHERE slide_id = ?", slide);
        assertThatThrownBy(() -> submit(id(), Map.of(q1, List.of("A1")))).isInstanceOf(ForbiddenException.class);
        jdbc.update("UPDATE chapter_to_slides SET status = 'PUBLISHED' WHERE slide_id = ?", slide);
        jdbc.update("UPDATE chapter_package_session_mapping SET status = 'DELETED' WHERE chapter_id = ?", chapter);
        assertThatThrownBy(() -> submit(id(), Map.of(q1, List.of("A1")))).isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("with no live access, every institute owning the slide must allow answers: the header cannot choose")
    void endedAccessUsesTheStrictestPolicy() {
        submit(id(), Map.of(q1, List.of("A2")));
        jdbc.update("UPDATE student_session_institute_group_mapping SET status = 'INACTIVE' WHERE user_id = ?", learner);
        assertThat(service.getResult(slide, user(learner), institute).isShowAnswers()).as("read back, as today").isTrue();

        String generous = id();
        jdbc.update("INSERT INTO institutes (id, name, setting_json) VALUES (?, 'G', NULL)", generous);
        jdbc.update("INSERT INTO package_institute (id, package_id, institute_id) VALUES (?, ?, ?)", id(), pkg, generous);
        hideAnswers(institute);
        QuizAttemptResultResponse viaGenerous = service.getResult(slide, user(learner), generous);
        assertThat(viaGenerous.isShowAnswers()).isFalse();
        assertThat(viaGenerous.getAttempts()).hasSize(1);
    }

    // ---------------------------------------------------------------- offline replay

    private OfflineSyncEventRequestDTO quizEvent(ActivityLogDTO dto) {
        OfflineSyncEventRequestDTO event = new OfflineSyncEventRequestDTO();
        event.setClientEventId(id());
        event.setEventType("QUIZ");
        event.setSlideId(slide);
        event.setChapterId(chapter);
        event.setModuleId("m");
        event.setSubjectId("s");
        event.setPackageSessionId(packageSession);
        event.setPayload(MAPPER.valueToTree(dto));
        return event;
    }

    /** As it runs in production: inside the event's own transaction, which must still commit. */
    private OfflineSyncEventResultDTO replay(OfflineSyncEventProcessor processor, ActivityLogDTO dto, String asUser) {
        return tx.execute(status -> processor.process(quizEvent(dto), "device", user(asUser)));
    }

    @Test
    @DisplayName("an empty replay records nothing and unlocks nothing, whatever the switches")
    void emptyReplayRecordsNothing() {
        String stranger = id();
        for (OfflineSyncEventProcessor processor : List.of(offlineOff, offlineOn)) {
            OfflineSyncEventResultDTO result = replay(processor, oldClientPost(id(), slide, Map.of()), stranger);
            assertThat(result.getStatus()).isEqualTo(OfflineSyncEventStatus.ACCEPTED);
        }
        assertThat(attemptRows()).isZero();
        QuizAttemptResultResponse read = service.getResult(slide, user(stranger), institute);
        assertThat(read.isShowAnswers()).isFalse();
        assertThat(read.getAnswerKeys()).isEmpty();
    }

    @Test
    @DisplayName("with enforcement on, a replay from someone with no membership is refused and records nothing")
    void replayNeedsMembership() {
        String stranger = id();
        OfflineSyncEventResultDTO result = replay(offlineOn, oldClientPost(id(), slide, Map.of(q1, List.of("A1"))), stranger);
        assertThat(result.getStatus()).isEqualTo(OfflineSyncEventStatus.FAILED);
        assertThat(attemptRows()).isZero();
        assertThat(service.getResult(slide, user(stranger), institute).isShowAnswers()).isFalse();
    }

    @Test
    @DisplayName("with enforcement on, a replay past the cap is refused; the first replay is recorded and graded")
    void replayFollowsTheCap() throws Exception {
        setCap(1);
        String attempt = id();
        OfflineSyncEventResultDTO first = replay(offlineOn, oldClientPost(attempt, slide, Map.of(q1, List.of("A1"))), learner);
        assertThat(first.getStatus()).isEqualTo(OfflineSyncEventStatus.ACCEPTED);
        assertThat(storedRow(attempt, q1).path("gradedBy").asText()).isEqualTo("server-legacy");

        OfflineSyncEventResultDTO second = replay(offlineOn, oldClientPost(id(), slide, Map.of(q1, List.of("A1"))), learner);
        assertThat(second.getStatus()).isEqualTo(OfflineSyncEventStatus.FAILED);
        assertThat(attemptRows()).isEqualTo(1);
    }

    @Test
    @DisplayName("with the switch off, an offline attempt is still kept, as it is today")
    void replayIsKeptWithSwitchesOff() {
        setCap(1);
        submit(id(), Map.of(q1, List.of("A2")));
        String attempt = id();
        OfflineSyncEventResultDTO result = replay(offlineOff, oldClientPost(attempt, slide, Map.of(q1, List.of("A1"))), learner);
        assertThat(result.getStatus()).isEqualTo(OfflineSyncEventStatus.ACCEPTED);
        assertThat(rowsOn(attempt)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- option order

    /** Index order differs from row order, and these settings make Postgres read through it. */
    private void readThroughAnIndex() {
        entityManager.createNativeQuery("SET LOCAL enable_seqscan = off").executeUpdate();
        entityManager.createNativeQuery("SET LOCAL enable_bitmapscan = off").executeUpdate();
    }

    @Test
    @DisplayName("a positional key means the option learners are shown, also after one option is edited")
    void positionalKeyFollowsTheOrderShown() {
        jdbc.execute("CREATE INDEX IF NOT EXISTS test_option_by_question ON quiz_slide_question_options (quiz_slide_question_id)");
        try {
            String q4 = question("MCQS", "{\"correctAnswers\":[0]}", "Q four", null, 4, null, null);
            option(q4, "Z-first-" + q4, "Shown first");
            option(q4, "M-second-" + q4, "Shown second");
            option(q4, "A-third-" + q4, "Shown third");
            List<String> shown = List.of("Z-first-" + q4, "M-second-" + q4, "A-third-" + q4);
            // An edit writes a new version of the row later in the table, which row order follows.
            jdbc.update("UPDATE quiz_slide_question_options SET media_id = 'edited' WHERE id = ?", shown.get(0));
            assertThat(jdbc.queryForList("SELECT id FROM quiz_slide_question_options WHERE quiz_slide_question_id = ? "
                    + "ORDER BY ctid", String.class, q4)).as("row order").isNotEqualTo(shown);

            tx.executeWithoutResult(s -> {
                readThroughAnIndex();
                assertThat(entityManager.createNativeQuery("""
                        SELECT CAST(json_agg(o.id) AS text)
                        FROM quiz_slide_question_options o
                        LEFT JOIN rich_text_data o_text_rt ON o_text_rt.id = o.text_id
                        WHERE o.quiz_slide_question_id = :q
                        """).setParameter("q", q4).getSingleResult().toString().replace(" ", ""))
                        .as("the read learners get").isEqualTo("[\"" + String.join("\",\"", shown) + "\"]");
                assertThat(repository.findOptions(quiz, "en").stream().filter(o -> o.getQuestionId().equals(q4))
                        .map(LearnerQuizAttemptRepository.QuizOptionRow::getOptionId).toList()).isEqualTo(shown);
                assertThat(optionRepository.findByQuizSlideQuestionId(q4).stream().map(o -> o.getId()).toList())
                        .isEqualTo(shown);
                AttemptSummary summary = service.submit(request(id(), Map.of(q4, List.of(shown.get(0)))), user(learner),
                        institute).getAttempts().get(0);
                assertThat(summary.getQuestions().stream().filter(q -> q.getQuestionId().equals(q4)).findFirst()
                        .orElseThrow().getOutcome()).isEqualTo("CORRECT");
            });
        } finally {
            jdbc.execute("DROP INDEX IF EXISTS test_option_by_question");
        }
    }

    // ---------------------------------------------------------------- who keeps answers

    @Test
    @DisplayName("answers stay only with staff of an institute that owns the content, or its creator")
    void keepsAnswersOnlyForOwners() {
        CustomUserDetails teacher = userWith(id(), "TEACHER");
        CustomUserDetails customRole = userWith(id(), "COURSE_REVIEWER");
        CustomUserDetails learnerWithTeacher = userWith(id(), "STUDENT", "TEACHER");
        CustomUserDetails plainLearner = userWith(id(), "STUDENT");

        signedInTo(institute);
        assertThat(authoringAccess.keepsAnswersOnSlide(teacher, slide)).isTrue();
        assertThat(authoringAccess.keepsAnswersOnChapter(teacher, chapter)).isTrue();
        assertThat(authoringAccess.keepsAnswersOnBatch(teacher, packageSession)).isTrue();
        assertThat(authoringAccess.keepsAnswersOnSlide(customRole, slide)).isTrue();
        assertThat(authoringAccess.keepsAnswersOnSlide(userWith(id(), "STUDENT", "COUNSELLOR"), slide)).isTrue();
        assertThat(authoringAccess.keepsAnswersOnSlide(learnerWithTeacher, slide)).isFalse();
        assertThat(authoringAccess.keepsAnswersOnSlide(plainLearner, slide)).isFalse();
        assertThat(authoringAccess.keepsAnswersOnSlide(userWith(id()), slide)).isFalse();
        assertThat(authoringAccess.keepsAnswersOnSlide(null, slide)).isFalse();

        // A role in some other institute, such as one they signed up for themselves.
        String own = id();
        signedInTo(own);
        assertThat(authoringAccess.keepsAnswersOnSlide(userWith(id(), "ADMIN"), slide)).isFalse();
        assertThat(authoringAccess.keepsAnswersOnChapter(userWith(id(), "ADMIN"), chapter)).isFalse();
        assertThat(authoringAccess.keepsAnswersOnBatch(userWith(id(), "ADMIN"), packageSession)).isFalse();

        signedInTo(null);
        assertThat(authoringAccess.keepsAnswersOnSlide(teacher, slide)).isFalse();

        // The creator of this course keeps them, even as a learner who also carries TEACHER.
        signedInTo(institute);
        jdbc.update("UPDATE package SET created_by_user_id = ? WHERE id = ?", learnerWithTeacher.getUserId(), pkg);
        assertThat(authoringAccess.keepsAnswersOnSlide(learnerWithTeacher, slide)).isTrue();
        signedInTo(own);
        assertThat(authoringAccess.keepsAnswersOnSlide(learnerWithTeacher, slide)).isFalse();
    }

    @Test
    @DisplayName("with answers stripped, another learner's attempt log needs staff of the institute owning the quiz")
    void attemptLogFollowsTheInstitute() {
        submit(id(), Map.of(q1, List.of("A2")));
        var page = org.springframework.data.domain.PageRequest.of(0, 10);

        signedInTo(id());
        assertThatThrownBy(() -> legacyService.getQuizSlideActivityLog(learner, slide, page, userWith(id(), "ADMIN")))
                .as("a role in another institute").isInstanceOf(ForbiddenException.class);

        signedInTo(institute);
        assertThatThrownBy(() -> legacyService.getQuizSlideActivityLog(learner, slide, page, userWith(id(), "STUDENT", "TEACHER")))
                .as("a learner who also carries TEACHER").isInstanceOf(ForbiddenException.class);

        tx.executeWithoutResult(s -> {
            var logs = legacyService.getQuizSlideActivityLog(learner, slide, page, userWith(id(), "TEACHER"));
            assertThat(logs.getContent().get(0).getQuizSides().get(0).getResponseJson()).contains("correctOptions");
        });

        tx.executeWithoutResult(s -> {
            var off = legacyOff.getQuizSlideActivityLog(learner, slide, page, user(id()));
            assertThat(off.getTotalElements()).as("switch off: as it is today").isEqualTo(1);
        });
    }

    @Test
    @DisplayName("Quiz Results refuse learner-only tokens and batches of another institute, and pass real callers")
    void resultsReader() {
        signedInTo(institute);
        authoringAccess.requireResultsReader(userWith(id(), "ADMIN"), packageSession);
        authoringAccess.requireResultsReader(userWith(id(), "TEACHER"), packageSession);
        authoringAccess.requireResultsReader(userWith(id(), "COURSE_REVIEWER"), packageSession);
        authoringAccess.requireResultsReader(userWith(id(), "STUDENT", "COUNSELLOR"), packageSession);
        authoringAccess.requireResultsReader(userWith(id(), "STUDENT", "TEACHER"), packageSession);

        assertThatThrownBy(() -> authoringAccess.requireResultsReader(userWith(id(), "STUDENT"), packageSession))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> authoringAccess.requireResultsReader(userWith(id()), packageSession))
                .isInstanceOf(ForbiddenException.class);
        signedInTo(id());
        assertThatThrownBy(() -> authoringAccess.requireResultsReader(userWith(id(), "ADMIN"), packageSession))
                .isInstanceOf(ForbiddenException.class);
    }

    // ---------------------------------------------------------------- check-answer

    @Test
    @DisplayName("check-answer refuses a slide that is not live")
    void checkNeedsALiveSlide() {
        String qs = id();
        jdbc.update("INSERT INTO question_slide (id, text_id, question_response_type, question_type, access_level, "
                + "auto_evaluation_json) VALUES (?, ?, 'OPTION', 'MCQS', 'PUBLIC', ?)", qs, richText("Q"),
                "{\"data\":{\"correctOptionIds\":[\"X\"]}}");
        jdbc.update("UPDATE slide SET source_type = 'QUESTION', source_id = ?, status = 'DRAFT' WHERE id = ?", qs, slide);
        QuizAnswerCheckRequest check = new QuizAnswerCheckRequest();
        check.setSlideId(slide);
        check.setQuestionId(qs);
        check.setSelectedOptionIds(List.of("X"));
        assertThatThrownBy(() -> service.checkAnswer(check, user(learner), institute))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("a gated quiz check stops once no attempts are left")
    void gatedCheckStopsAtTheCap() {
        jdbc.update("UPDATE institutes SET setting_json = ? WHERE id = ?",
                "{\"setting\":{\"STUDENT_DISPLAY_SETTINGS\":{\"data\":{\"courseSettings\":{\"quiz\":"
                        + "{\"showReportAndCorrectAnswers\":false,\"moveOnlyOnCorrectAnswer\":true}}}}}}", institute);
        setCap(1);
        QuizAnswerCheckRequest check = new QuizAnswerCheckRequest();
        check.setSlideId(slide);
        check.setQuestionId(q1);
        check.setSelectedOptionIds(List.of("A1"));
        assertThat(service.checkAnswer(check, user(learner), institute).getCorrect()).isTrue();
        submit(id(), Map.of(q1, List.of("A2")));
        assertThatThrownBy(() -> service.checkAnswer(check, user(learner), institute))
                .isInstanceOf(ForbiddenException.class);
    }
}
