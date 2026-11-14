package vacademy.io.admin_core_service.features.discussion;

import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionPostView;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionRequests;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionThreadView;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionReactionRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionReportRepository;
import vacademy.io.admin_core_service.features.discussion.service.DiscussionService;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The discussion forum on a real Postgres: the V670 migration, the native queries
 * (batch scoping, ON CONFLICT reactions and reports, batch names) and the real
 * enrollment check from LearnerQuizAccessService.
 *
 * <p>Skipped unless {@code DISCUSSION_PG_URL} (a JDBC URL) points at an empty scratch
 * database. It drops and recreates the public schema; never point it at a real database.
 */
class DiscussionPostgresTest {

    private static JdbcTemplate jdbc;
    private static LocalContainerEntityManagerFactoryBean emfBean;
    private static TransactionTemplate tx;
    private static DiscussionService service;

    private static final String INSTITUTE = "inst-1";
    private static final String SLIDE = "slide-1";
    private static final String BATCH_A = "ps-a";
    private static final String BATCH_B = "ps-b";

    @BeforeAll
    static void boot() throws Exception {
        String url = System.getenv("DISCUSSION_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "DISCUSSION_PG_URL not set");
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url);
        dataSource.setDriverClassName("org.postgresql.Driver");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
        jdbc.execute(new ClassPathResource("learner_quiz/schema.sql").getContentAsString(StandardCharsets.UTF_8));
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS document_slide (
                  id varchar(255) PRIMARY KEY, type varchar(255), data text, title varchar(255),
                  cover_file_id varchar(255), total_pages integer, published_data text,
                  published_document_total_pages integer,
                  created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
                CREATE TABLE IF NOT EXISTS level (id varchar(255) PRIMARY KEY, level_name varchar(255));
                CREATE TABLE IF NOT EXISTS session (id varchar(255) PRIMARY KEY, session_name varchar(255));
                """);
        jdbc.execute(new FileSystemResource("src/main/resources/db/migration/V670__discussion_forum.sql")
                .getContentAsString(StandardCharsets.UTF_8));

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
        tx = new TransactionTemplate(new JpaTransactionManager(emf));

        // Only "teacher" is institute staff, as the real validator would decide from the token.
        InstituteAccessValidator validator = mock(InstituteAccessValidator.class);
        doAnswer(inv -> {
            CustomUserDetails u = inv.getArgument(0);
            if (!"teacher".equals(u.getUserId())) {
                throw new ForbiddenException("Access denied: staff role required");
            }
            return null;
        }).when(validator).requireInstituteStaff(any(), anyString());
        service = new DiscussionService(
                factory.getRepository(DiscussionPostRepository.class),
                factory.getRepository(DiscussionReactionRepository.class),
                factory.getRepository(DiscussionReportRepository.class),
                new LearnerQuizAccessService(factory.getRepository(LearnerQuizAttemptRepository.class), validator),
                validator);
    }

    @AfterAll
    static void close() {
        if (emfBean != null) {
            emfBean.destroy();
        }
    }

    @BeforeEach
    void seed() {
        jdbc.execute("""
                TRUNCATE slide, document_slide, chapter_to_slides, chapter_package_session_mapping,
                  student_session_institute_group_mapping, package_session, package, package_institute,
                  level, session, discussion_post, discussion_reaction, discussion_report CASCADE
                """);
        jdbc.update("INSERT INTO package (id, package_name, status) VALUES ('pkg', 'Mindful Living', 'ACTIVE')");
        jdbc.update("INSERT INTO package_institute (id, package_id, institute_id) VALUES ('pi', 'pkg', ?)", INSTITUTE);
        jdbc.update("INSERT INTO level (id, level_name) VALUES ('lvl', 'DEFAULT')");
        jdbc.update("INSERT INTO session (id, session_name) VALUES ('s-a', 'Jan 2027'), ('s-b', 'Mar 2027')");
        jdbc.update("""
                INSERT INTO package_session (id, package_id, level_id, session_id, status)
                VALUES (?, 'pkg', 'lvl', 's-a', 'ACTIVE'), (?, 'pkg', 'lvl', 's-b', 'ACTIVE')
                """, BATCH_A, BATCH_B);
        jdbc.update("INSERT INTO slide (id, source_id, source_type, title, status) VALUES (?, 'doc-1', 'DOCUMENT', 'Reflect', 'PUBLISHED')",
                SLIDE);
        jdbc.update("INSERT INTO document_slide (id, type, data, published_data) VALUES ('doc-1', 'DISCUSSION', ?, ?)",
                "{}", "{\"prompt_html\":\"<p>What helps?</p>\",\"settings\":{\"visibility\":\"OPEN\",\"reactions\":[\"HEART\",\"HUG\"]}}");
        jdbc.update("INSERT INTO chapter_to_slides (id, chapter_id, slide_id, status) VALUES ('cts', 'ch-1', ?, 'PUBLISHED')", SLIDE);
        jdbc.update("""
                INSERT INTO chapter_package_session_mapping (id, chapter_id, package_session_id, status)
                VALUES ('m-a', 'ch-1', ?, 'ACTIVE'), ('m-b', 'ch-1', ?, 'ACTIVE')
                """, BATCH_A, BATCH_B);
        enroll("amy", BATCH_A);
        enroll("ben", BATCH_A);
        enroll("cara", BATCH_B);
    }

    private static void enroll(String userId, String batch) {
        jdbc.update("""
                INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, institute_id, status)
                VALUES (?, ?, ?, ?, 'ACTIVE')
                """, UUID.randomUUID().toString(), userId, batch, INSTITUTE);
    }

    private static CustomUserDetails user(String id) {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn(id);
        when(u.getFullName()).thenReturn(id.substring(0, 1).toUpperCase() + id.substring(1));
        return u;
    }

    private static <T> T inTx(Supplier<T> work) {
        return tx.execute(status -> work.get());
    }

    private static DiscussionPostView respond(String userId, String batch, String text) {
        DiscussionRequests.CreatePost req = new DiscussionRequests.CreatePost();
        req.setSlideId(SLIDE);
        req.setPackageSessionId(batch);
        req.setContent(text);
        return inTx(() -> service.createAsLearner(user(userId), req, INSTITUTE)).post();
    }

    private static DiscussionThreadView thread(String userId, String batch) {
        return inTx(() -> service.learnerThread(user(userId), SLIDE, batch, null, INSTITUTE));
    }

    @Test
    void learnersOnlySeeTheirOwnBatch() {
        respond("amy", BATCH_A, "Walking helps me.");
        respond("cara", BATCH_B, "Music helps me.");

        assertThat(thread("ben", BATCH_A).getPosts()).extracting(DiscussionPostView::getContent)
                .containsExactly("Walking helps me.");
        assertThat(thread("cara", BATCH_B).getPosts()).extracting(DiscussionPostView::getContent)
                .containsExactly("Music helps me.");
    }

    @Test
    void aLearnerCannotReadOrPostIntoABatchTheyAreNotIn() {
        respond("amy", BATCH_A, "Walking helps me.");
        // cara (batch B) asks for batch A: access resolves to her own batch, so A's posts stay hidden.
        assertThat(thread("cara", BATCH_A).getPosts()).isEmpty();
        // Someone with no enrollment at all is refused outright.
        assertThatThrownBy(() -> thread("stranger", BATCH_A)).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void reactionsToggle_andReportsCountOncePerPerson() {
        DiscussionPostView post = respond("amy", BATCH_A, "Walking helps me.");
        DiscussionRequests.React heart = new DiscussionRequests.React();
        heart.setReaction("HEART");

        List<DiscussionPostView.ReactionCount> on = inTx(() -> service.react(user("ben"), post.getId(), heart, INSTITUTE, null));
        assertThat(on).singleElement().satisfies(r -> {
            assertThat(r.getCount()).isEqualTo(1);
            assertThat(r.isReactedByMe()).isTrue();
        });
        List<DiscussionPostView.ReactionCount> off = inTx(() -> service.react(user("ben"), post.getId(), heart, INSTITUTE, null));
        assertThat(off).isEmpty();

        DiscussionRequests.Report report = new DiscussionRequests.Report();
        report.setReason("Not kind");
        inTx(() -> { service.report(user("ben"), post.getId(), report, INSTITUTE); return null; });
        inTx(() -> { service.report(user("ben"), post.getId(), report, INSTITUTE); return null; });
        assertThat(jdbc.queryForObject("SELECT report_count FROM discussion_post WHERE id = ?", Integer.class,
                post.getId())).isEqualTo(1);
        assertThat(thread("ben", BATCH_A).getPosts().get(0).getReportedByMe()).isTrue();
    }

    @Test
    void staffSeeEveryBatch_withNamedBatches_andCanModerate() {
        DiscussionPostView amy = respond("amy", BATCH_A, "Walking helps me.");
        respond("cara", BATCH_B, "Music helps me.");

        DiscussionThreadView all = inTx(() -> service.staffThread(user("teacher"), SLIDE, INSTITUTE, null));
        assertThat(all.getPosts()).hasSize(2);
        assertThat(all.getBatches()).extracting(DiscussionThreadView.Batch::getName)
                .containsExactly("Mindful Living · Jan 2027", "Mindful Living · Mar 2027");

        DiscussionThreadView onlyB = inTx(() -> service.staffThread(user("teacher"), SLIDE, INSTITUTE, BATCH_B));
        assertThat(onlyB.getPosts()).extracting(DiscussionPostView::getContent).containsExactly("Music helps me.");

        DiscussionRequests.Moderate hide = new DiscussionRequests.Moderate();
        hide.setAction("HIDE");
        inTx(() -> service.moderate(user("teacher"), INSTITUTE, amy.getId(), hide));
        assertThat(thread("ben", BATCH_A).getPosts()).isEmpty();
        assertThat(thread("amy", BATCH_A).getPosts()).singleElement()
                .extracting(DiscussionPostView::getStatus).isEqualTo("HIDDEN");
    }

    @Test
    void teacherPostToEveryBatchReachesEveryone() {
        DiscussionRequests.CreatePost req = new DiscussionRequests.CreatePost();
        req.setSlideId(SLIDE);
        req.setContent("Thank you all for sharing.");
        inTx(() -> service.createAsStaff(user("teacher"), INSTITUTE, req));

        assertThat(thread("amy", BATCH_A).getPosts()).singleElement()
                .extracting(DiscussionPostView::getAuthorRole).isEqualTo("STAFF");
        assertThat(thread("cara", BATCH_B).getPosts()).hasSize(1);
    }
}
