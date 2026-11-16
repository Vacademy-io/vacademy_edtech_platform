package vacademy.io.admin_core_service.features.learner_home;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeLayout;
import vacademy.io.admin_core_service.features.learner_home.media.LearnerHomeMediaService;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeBlockRepository;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeLayoutRepository;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeLayoutService;
import vacademy.io.admin_core_service.features.learner_home.service.PublishChecks;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.json;

/**
 * Proof against a real, local, throwaway PostgreSQL: the migration applies (twice), every native
 * statement runs with its real shape, the partial index serves the enrolment query, and the
 * draft / publish / restore flow holds its invariants with real constraints and locks.
 *
 * <p>The tables the feature reads but does not own (package, ssigm, tags, live_session ...) are
 * created here with the columns the queries use; the learner-home tables come from the real
 * migration file. Runs only when {@code LEARNER_HOME_IT_PG_URL} points at localhost, e.g.
 * {@code LEARNER_HOME_IT_PG_URL=jdbc:postgresql://127.0.0.1:55432/lh_it}.
 */
@EnabledIfEnvironmentVariable(named = "LEARNER_HOME_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@SpringJUnitConfig(LearnerHomeDatabaseProofIT.Config.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LearnerHomeDatabaseProofIT {

    static final String INST = "inst-it";
    static final Path MIGRATION = Path.of("src/main/resources/db/migration/V712__learner_home_builder.sql");

    @Configuration
    @EnableTransactionManagement
    @EnableJpaRepositories(basePackageClasses = LearnerHomeLayoutRepository.class)
    static class Config {
        @Bean
        DataSource dataSource() {
            DriverManagerDataSource ds = new DriverManagerDataSource(System.getenv("LEARNER_HOME_IT_PG_URL"),
                    System.getenv().getOrDefault("LEARNER_HOME_IT_PG_USER", "postgres"),
                    System.getenv().getOrDefault("LEARNER_HOME_IT_PG_PASSWORD", ""));
            ds.setDriverClassName("org.postgresql.Driver");
            return ds;
        }

        @Bean
        LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource ds) {
            LocalContainerEntityManagerFactoryBean f = new LocalContainerEntityManagerFactoryBean();
            f.setDataSource(ds);
            f.setPackagesToScan(LearnerHomeLayout.class.getPackageName());
            f.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            Properties p = new Properties();
            p.put("hibernate.hbm2ddl.auto", "none");
            // As in the stage/prod profile: batched, reordered inserts.
            p.put("hibernate.order_inserts", "true");
            p.put("hibernate.jdbc.batch_size", "50");
            f.setJpaProperties(p);
            return f;
        }

        @Bean
        PlatformTransactionManager transactionManager(jakarta.persistence.EntityManagerFactory emf) {
            return new JpaTransactionManager(emf);
        }

        @Bean
        NamedParameterJdbcTemplate namedJdbc(DataSource ds) {
            return new NamedParameterJdbcTemplate(ds);
        }

        @Bean
        LearnerHomeJdbc learnerHomeJdbc(NamedParameterJdbcTemplate t) {
            return new LearnerHomeJdbc(t);
        }
    }

    @Autowired DataSource dataSource;
    @Autowired LearnerHomeLayoutRepository layouts;
    @Autowired LearnerHomeBlockRepository blocks;
    @Autowired LearnerHomeJdbc jdbc;
    @Autowired PlatformTransactionManager tm;

    JdbcTemplate sql;
    LearnerHomeLayoutService service;
    LearnerHomeResolver resolver;
    LearnerHomeLayoutCache cache;

    @BeforeAll
    void schema() throws Exception {
        sql = new JdbcTemplate(dataSource);
        sql.execute("DROP SCHEMA public CASCADE");
        sql.execute("CREATE SCHEMA public");
        for (String ddl : List.of(
                "CREATE TABLE package (id varchar(255) PRIMARY KEY, package_name varchar(255), status varchar(50) NOT NULL, package_type varchar(64), created_at timestamp DEFAULT now() NOT NULL)",
                "CREATE TABLE package_session (id varchar(255) PRIMARY KEY, package_id varchar(255), status varchar(255))",
                "CREATE TABLE package_institute (id varchar PRIMARY KEY, package_id varchar(255), institute_id varchar NOT NULL)",
                "CREATE TABLE student_session_institute_group_mapping (id varchar PRIMARY KEY, user_id varchar(255), package_session_id varchar(255), institute_id varchar(255), status varchar(255), enrolled_date date)",
                "CREATE INDEX idx_ssigm_user_id_status ON student_session_institute_group_mapping (user_id, status) WHERE status = 'ACTIVE'",
                "CREATE TABLE tags (id varchar(255) PRIMARY KEY, tag_name varchar(255) NOT NULL, institute_id varchar(255), status varchar(255) DEFAULT 'ACTIVE' NOT NULL)",
                "CREATE TABLE user_tags (id varchar(255) PRIMARY KEY, user_id varchar(255) NOT NULL, tag_id varchar(255) NOT NULL, institute_id varchar(255) NOT NULL, status varchar(255) DEFAULT 'ACTIVE' NOT NULL)",
                "CREATE INDEX idx_user_tags_user_id ON user_tags (user_id)",
                "CREATE TABLE product_page (id varchar(255) PRIMARY KEY, name varchar(255), code varchar(255) UNIQUE NOT NULL, institute_id varchar(255) NOT NULL, status varchar(255) NOT NULL)",
                "CREATE TABLE live_session (id varchar(255) PRIMARY KEY, institute_id varchar(255), title varchar(255), timezone varchar(64), access_level varchar(32), status varchar(32))",
                "CREATE TABLE session_schedules (id varchar(255) PRIMARY KEY, session_id varchar(255), meeting_date date, start_time time, last_entry_time time, status varchar(32))",
                "CREATE TABLE payment_option (id varchar(255) PRIMARY KEY, source varchar(64), source_id varchar(255), status varchar(32), created_at timestamp DEFAULT now())",
                "CREATE TABLE payment_plan (id varchar(255) PRIMARY KEY, payment_option_id varchar(255), status varchar(32), actual_price double precision, currency varchar(8), validity_in_days int)",
                "CREATE TABLE live_session_participants (id varchar(255) PRIMARY KEY, session_id varchar(255) NOT NULL, source_type varchar(32) NOT NULL, source_id varchar(255) NOT NULL)")) {
            sql.execute(ddl);
        }
        String migration = Files.readString(MIGRATION);
        sql.execute(migration);
        // IF NOT EXISTS everywhere: a second run is a no-op.
        sql.execute(migration);

        sql.update("INSERT INTO package VALUES ('p-a','A','ACTIVE',null,now()),('p-b','B','ACTIVE','COURSE',now()),"
                + "('p-old','Old','DELETED',null,now()),('p-fee','Fee','ACTIVE','DELIVERY_CHARGE',now()),('p-x','X','ACTIVE',null,now())");
        sql.update("INSERT INTO package_session VALUES ('ps-a','p-a','ACTIVE'),('ps-b','p-b','HIDDEN'),('ps-old','p-old','ACTIVE'),"
                + "('ps-fee','p-fee','ACTIVE'),('ps-x','p-x','ACTIVE')");
        sql.update("INSERT INTO package_institute VALUES ('pi1','p-a',?),('pi2','p-b',?),('pi3','p-old',?),('pi4','p-fee',?),('pi5','p-x','inst-other')",
                INST, INST, INST, INST);
        sql.update("INSERT INTO student_session_institute_group_mapping VALUES "
                + "('m1','u1','ps-a',?,'ACTIVE','2026-01-01'),('m2','u1','ps-b',?,'ACTIVE','2026-06-01'),"
                + "('m3','u1','ps-old',?,'ACTIVE','2026-07-01'),('m4','u1','ps-fee',?,'ACTIVE','2026-08-01'),"
                + "('m5','u1','ps-x',?,'INACTIVE','2026-09-01'),('m6','u2','ps-a',?,'ACTIVE',null)",
                INST, INST, INST, INST, INST, INST);
        sql.update("INSERT INTO tags VALUES ('t1','VIP',?,'ACTIVE'),('t-def','Default',null,'ACTIVE'),('t-other','Other','inst-other','ACTIVE')", INST);
        sql.update("INSERT INTO user_tags VALUES ('ut1','u1','t1',?,'ACTIVE'),('ut2','u1','t-other','inst-other','ACTIVE')", INST);
        sql.update("INSERT INTO product_page VALUES ('pp1','Sale','SALE',?,'ACTIVE')", INST);
        sql.update("INSERT INTO live_session VALUES ('ls1',?,'Physics','Asia/Kolkata','public','LIVE')", INST);
        sql.update("INSERT INTO session_schedules VALUES ('ss0','ls1',CURRENT_DATE - 3,'09:00','10:00',null),"
                + "('ss1','ls1',CURRENT_DATE + 2,'09:00','10:00',null),('ss2','ls1',CURRENT_DATE + 3,'09:00','10:00','CANCELLED')");
        sql.update("INSERT INTO payment_option VALUES ('po1','LIVE_SESSION','ls1','ACTIVE',now())");
        sql.update("INSERT INTO payment_plan VALUES ('pl1','po1','ACTIVE',199.0,'INR',30)");
        sql.update("INSERT INTO live_session_participants VALUES ('lp1','ls1','BATCH','ps-a')");
    }

    @BeforeEach
    void wire() {
        LearnerHomeGate gate = mock(LearnerHomeGate.class);
        when(gate.moduleEnabled(INST)).thenReturn(true);
        LearnerHomeMediaService media = mock(LearnerHomeMediaService.class);
        when(media.prepare(any(), any(), any())).thenAnswer(i -> i.getArgument(1));
        LinkMetaService linkMeta = new LinkMetaService(jdbc);
        ShelfResolver shelves = mock(ShelfResolver.class);
        cache = new LearnerHomeLayoutCache(layouts, blocks, jdbc, tm);
        resolver = new LearnerHomeResolver(gate, cache, jdbc, linkMeta, shelves);
        service = new LearnerHomeLayoutService(layouts, blocks, new PublishChecks(jdbc, linkMeta, shelves), media,
                cache, resolver, tm);
        sql.update("DELETE FROM learner_home_layout");
        sql.update("DELETE FROM learner_home_block_user_state");
        sql.update("DELETE FROM learner_home_event");
        sql.update("DELETE FROM learner_home_view_daily");
    }

    static String body(String extraBlocks) {
        return "{'template_key':'CLASSROOM','settings':{},'blocks':[" + HomeFixtures.HERO
                + (extraBlocks.isEmpty() ? "" : "," + extraBlocks) + "]}";
    }

    static final String NOTICE = "{'block_key':'note','type':'NOTICE','config':{'title':'Welcome','require_ack':true},"
            + "'audience':{'mode':'RULES','all_of':[{'kind':'PACKAGE_SESSION','ids':['ps-a']},{'kind':'USER_TAG','tag_ids':['t1','t-def']}]}}";

    // ── Learner facts ───────────────────────────────────────────────────────

    @Test
    void enrolmentsTagsAndStateQueriesRunWithTheirRealShape() {
        List<LearnerHomeJdbc.Enrolment> e = jdbc.enrolments(INST, "u1");
        assertEquals(List.of("ps-b", "ps-a"), e.stream().map(LearnerHomeJdbc.Enrolment::packageSessionId).toList(),
                "newest first; DELETED course, charge package and INACTIVE mapping left out");
        assertEquals(List.of("t1"), jdbc.tagIds(INST, "u1"));

        assertTrue(jdbc.acknowledge(INST, "u1", "note"), "the first ack sets the time");
        Instant first = jdbc.state(INST, "u1", "note").acknowledgedAt();
        assertFalse(jdbc.acknowledge(INST, "u1", "note"), "a repeat changes nothing");
        assertEquals(first, jdbc.state(INST, "u1", "note").acknowledgedAt(), "a second ack keeps the first time");
        assertTrue(jdbc.dismiss(INST, "u1", "note"));
        assertFalse(jdbc.dismiss(INST, "u1", "note"));
        LearnerHomeJdbc.BlockState s = jdbc.states(INST, "u1").get(0);
        assertNotNull(s.dismissedAt());
        assertEquals(first, s.acknowledgedAt());
    }

    @Test
    void concurrentAcksSetTheTimeExactlyOnce() throws Exception {
        for (int round = 0; round < 20; round++) {
            String key = "race-" + round;
            java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(4);
            java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
            List<java.util.concurrent.Future<Boolean>> results = new java.util.ArrayList<>();
            for (int t = 0; t < 4; t++) {
                results.add(pool.submit(() -> {
                    go.await();
                    return jdbc.acknowledge(INST, "racer", key);
                }));
            }
            go.countDown();
            int winners = 0;
            for (java.util.concurrent.Future<Boolean> f : results) winners += f.get() ? 1 : 0;
            pool.shutdown();
            assertEquals(1, winners, "exactly one of four concurrent acks wins, round " + round);
        }
    }

    @Test
    void thePartialIndexServesTheEnrolmentQuery() {
        sql.execute("SET enable_seqscan = off");
        try {
            String explainSql = "EXPLAIN " + LearnerHomeJdbc.ENROLMENTS_SQL.replace(":userId", "'u1'")
                    .replace(":instituteId", "'" + INST + "'");
            String plan = String.join("\n", sql.queryForList(explainSql, String.class));
            assertTrue(plan.contains("idx_ssigm_user_id_status"), plan);
        } finally {
            sql.execute("SET enable_seqscan = on");
        }
    }

    @Test
    void ownershipLinkAndLiveQueriesRun() {
        assertEquals(2, jdbc.batchOwners(List.of("ps-a", "ps-x")).size());
        assertEquals(INST, jdbc.packageOwners(List.of("p-a")).get(0).instituteId());
        assertEquals(3, jdbc.tagOwners(List.of("t1", "t-def", "t-other")).size());
        assertEquals("ACTIVE", jdbc.productPages(List.of("SALE")).get(0).status());
        assertEquals(List.of("ps-a"), jdbc.batchPackages(INST, List.of("ps-a", "ps-x")).stream()
                .map(LearnerHomeJdbc.Enrolment::packageSessionId).toList());

        Map<String, LinkMetaService.LiveInfo> live = new LinkMetaService(jdbc).live(List.of("ls1", "nope"));
        LinkMetaService.LiveInfo info = live.get("ls1");
        assertNotNull(info);
        assertFalse(live.containsKey("nope"));
        assertTrue(info.paid());
        assertTrue(info.isPublic());
        assertEquals(1, info.occurrences().size(), "past and cancelled occurrences are not upcoming");
        assertTrue(info.batchIds().contains("ps-a"));
        assertTrue(info.availableFor(INST, Instant.now()));
    }

    // ── Draft / publish / restore ───────────────────────────────────────────

    @Test
    void draftSavePublishAndRestoreKeepTheirInvariants() {
        ObjectNode created = service.createDraft(INST, "admin", json(body(NOTICE)));
        assertEquals(1, created.get("revision").asInt());
        assertEquals("DRAFT_EXISTS", assertThrows(LearnerHomeException.class,
                () -> service.createDraft(INST, "admin", json(body("")))).getCode());

        ObjectNode saved = service.saveDraft(INST, "admin", json("{'revision':1,'settings':{'show_header':false},'blocks':["
                + NOTICE + "," + HomeFixtures.HERO + "]}"));
        assertEquals(2, saved.get("revision").asInt());
        assertEquals("note", saved.get("layout").get("blocks").get(0).get("block_key").asText());
        LearnerHomeException stale = assertThrows(LearnerHomeException.class, () -> service.saveDraft(INST, "other",
                json("{'revision':1,'blocks':[" + HomeFixtures.HERO + "]}")));
        assertEquals("STALE_DRAFT", stale.getCode());
        assertEquals(2, stale.body().get("revision"));
        assertEquals("admin", stale.body().get("updated_by"));

        assertEquals(1, service.publish(INST, "admin", 2).get("version").asInt());
        assertEquals(0, count("status = 'DRAFT'"));
        service.createFromPublished(INST, "admin");
        assertEquals(2, service.publish(INST, "admin", 1).get("version").asInt());
        assertEquals(1, count("status = 'PUBLISHED'"));
        assertEquals(1, count("status = 'ARCHIVED'"));
        assertEquals(List.of("note", "hero"), sql.queryForList("SELECT b.block_key FROM learner_home_block b JOIN "
                + "learner_home_layout l ON l.id = b.layout_id WHERE l.status = 'PUBLISHED' ORDER BY b.position", String.class),
                "block keys survive publish");

        JsonNode published = service.draftView(INST, true, false).get("published");
        assertEquals(2, published.get("version").asInt());
        assertEquals(List.of("note", "hero"), List.of(published.get("blocks").get(0).get("block_key").asText(),
                published.get("blocks").get(1).get("block_key").asText()));

        JsonNode versions = service.versions(INST).get("versions");
        assertEquals(2, versions.get(0).get("version").asInt());
        assertEquals(2, versions.get(0).get("block_count").asInt());

        service.createDraft(INST, "admin", json(body("")));
        assertEquals("DRAFT_EXISTS", assertThrows(LearnerHomeException.class, () -> service.restore(INST, "admin", 1, false)).getCode());
        ObjectNode restored = service.restore(INST, "admin", 1, true);
        assertEquals(1, restored.get("base_version").asInt());
        assertEquals(2, restored.get("blocks").size());
        assertEquals(1, count("status = 'DRAFT'"));

        service.unpublish(INST);
        assertEquals(0, count("status = 'PUBLISHED'"));
        assertTrue(cache.get(INST).isEmpty());
    }

    @Test
    void theDatabaseRefusesASecondDraftOrPublishedRow() {
        service.createDraft(INST, "admin", json(body("")));
        assertThrows(DataIntegrityViolationException.class, () -> sql.update(
                "INSERT INTO learner_home_layout (id, institute_id, status) VALUES ('x', ?, 'DRAFT')", INST));
        sql.update("INSERT INTO learner_home_layout (id, institute_id, status, version) VALUES ('p1', ?, 'PUBLISHED', 1)", INST);
        assertThrows(DataIntegrityViolationException.class, () -> sql.update(
                "INSERT INTO learner_home_layout (id, institute_id, status, version) VALUES ('p2', ?, 'PUBLISHED', 2)", INST));
        assertThrows(DataIntegrityViolationException.class, () -> sql.update(
                "INSERT INTO learner_home_block (id, layout_id, institute_id, block_key, type, position) VALUES ('b','p1',?,'k','BUILTIN',0)", INST),
                "a BUILTIN row needs its widget");
    }

    @Test
    void archivedVersionsArePrunedToTwenty() {
        service.createDraft(INST, "admin", json(body("")));
        service.publish(INST, "admin", 1);
        for (int i = 0; i < 22; i++) {
            service.createFromPublished(INST, "admin");
            service.publish(INST, "admin", 1);
        }
        assertEquals(1, count("status = 'PUBLISHED'"));
        assertEquals(20, count("status = 'ARCHIVED'"));
        assertEquals(23, sql.queryForObject("SELECT MAX(version) FROM learner_home_layout", Integer.class));
        assertEquals(21, sql.queryForObject("SELECT COUNT(DISTINCT layout_id) FROM learner_home_block", Integer.class),
                "blocks of pruned versions went with them");
    }

    // ── Learner side on real rows ───────────────────────────────────────────

    @Test
    void resolveDismissAndAckOnRealRows() {
        service.createDraft(INST, "admin", json(body(NOTICE + ",{'block_key':'ev','type':'EVENT','config':{'source':'LIVE_SESSION','live_session_id':'ls1'}}")));
        service.publish(INST, "admin", 1);

        JsonNode u1 = resolver.resolve(INST, "u1", Instant.now());
        assertEquals("BUILDER", u1.get("mode").asText());
        assertEquals(3, u1.get("blocks").size(), "u1 is in ps-a and has tag t1");
        JsonNode join = u1.get("blocks").get(2).get("config").get("join_cta").get("link");
        assertTrue(join.get("is_paid").asBoolean());
        assertTrue(join.get("in_my_batch").asBoolean());
        assertEquals(2, resolver.resolve(INST, "u2", Instant.now()).get("blocks").size(), "u2 has no tag");

        jdbc.acknowledge(INST, "u1", "note");
        jdbc.dismiss(INST, "u1", "note");
        assertEquals(2, resolver.resolve(INST, "u1", Instant.now()).get("blocks").size(), "dismissed on any device");
        assertTrue(cache.get(INST).get().eventKeys().contains("note"));
    }

    // ── Analytics ───────────────────────────────────────────────────────────

    @Test
    void analyticsWritesAndReads() {
        LocalDate day = LocalDate.of(2026, 11, 16);
        jdbc.upsertViews(List.of(new LearnerHomeJdbc.ViewRow(INST, day, "b1", "", "PHONE", 5),
                new LearnerHomeJdbc.ViewRow(INST, day, "b1", "s1", "PHONE", 2)));
        jdbc.upsertViews(List.of(new LearnerHomeJdbc.ViewRow(INST, day, "b1", "", "PHONE", 3)));
        Instant at = Instant.parse("2026-11-16T05:00:00Z");
        jdbc.insertEvents(List.of(
                new LearnerHomeJdbc.EventRow(INST, "b1", "s1", "CLICK", "u1", 1, "PHONE", "WEB", at),
                new LearnerHomeJdbc.EventRow(INST, "b1", "s1", "CLICK", "u1", 1, "PHONE", "WEB", at),
                new LearnerHomeJdbc.EventRow(INST, "b1", null, "CLICK", "u2", 1, "DESKTOP", null, at),
                new LearnerHomeJdbc.EventRow(INST, "b1", null, "CLICK", "u3", 1, "DESKTOP", null,
                        Instant.parse("2026-01-01T00:00:00Z"))));

        List<LearnerHomeJdbc.Total> views = jdbc.viewTotals(INST, day, day);
        assertEquals(8, views.stream().filter(v -> v.itemKey().isEmpty()).mapToLong(LearnerHomeJdbc.Total::count).sum());
        Instant from = Instant.parse("2026-11-15T18:30:00Z");
        Instant to = Instant.parse("2026-11-16T18:30:00Z");
        assertEquals(3, jdbc.eventTotals(INST, from, to).stream().mapToLong(LearnerHomeJdbc.Total::count).sum());
        assertEquals(2, jdbc.uniqueClickers(INST, from, to).get(0).count());

        jdbc.acknowledge(INST, "u1", "n");
        assertEquals(1, jdbc.ackCount(INST, "n"));
        assertEquals("u1", jdbc.ackPage(INST, "n", 10, 0).get(0).userId());
        assertTrue(jdbc.blockLabels(INST, List.of("nothing")).isEmpty());
        assertEquals("A", jdbc.packageNames(INST, List.of("p-a", "p-x")).get(0)[1]);
        assertEquals(1, jdbc.packageNames(INST, List.of("p-a", "p-x")).size(), "another institute's course is not named");

        assertEquals(1, jdbc.deleteEventsBefore(Instant.parse("2026-06-01T00:00:00Z"), 10_000), "retention removes only old rows");
        assertEquals(3, sql.queryForObject("SELECT COUNT(*) FROM learner_home_event", Integer.class));
    }

    private int count(String where) {
        return sql.queryForObject("SELECT COUNT(*) FROM learner_home_layout WHERE institute_id = ? AND " + where,
                Integer.class, INST);
    }
}
