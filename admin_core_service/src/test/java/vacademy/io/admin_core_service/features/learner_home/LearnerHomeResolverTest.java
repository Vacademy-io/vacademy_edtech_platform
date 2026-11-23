package vacademy.io.admin_core_service.features.learner_home;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Devices;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Settings;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.BlockState;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Enrolment;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.LiveRow;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Owner;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService;
import vacademy.io.admin_core_service.features.learner_home.resolve.PublishedLayout;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver.CourseCard;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.block;

class LearnerHomeResolverTest {

    static final String INST = "inst-1";
    static final String USER = "user-1";
    static final Instant NOW = Instant.parse("2026-11-16T10:00:00Z");

    LearnerHomeGate gate;
    LearnerHomeLayoutCache cache;
    LearnerHomeJdbc jdbc;
    ShelfResolver shelves;
    LearnerHomeResolver resolver;

    @BeforeEach
    void setUp() {
        gate = mock(LearnerHomeGate.class);
        cache = mock(LearnerHomeLayoutCache.class);
        jdbc = mock(LearnerHomeJdbc.class);
        shelves = mock(ShelfResolver.class);
        when(gate.moduleEnabled(INST)).thenReturn(true);
        when(gate.isHolistic(INST)).thenReturn(false);
        resolver = new LearnerHomeResolver(gate, cache, jdbc, new LinkMetaService(jdbc), shelves);
    }

    void publish(String... blocks) {
        List<Block> list = new ArrayList<>();
        for (String b : blocks) list.add(block(b));
        Map<String, Block> byKey = new LinkedHashMap<>();
        list.forEach(b -> byKey.put(b.blockKey(), b));
        when(cache.get(INST)).thenReturn(Optional.of(new PublishedLayout("l1", 7, Settings.DEFAULT, list, byKey,
                byKey.keySet())));
    }

    JsonNode resolve() {
        return resolver.resolve(INST, USER, NOW);
    }

    static List<String> keys(JsonNode out) {
        List<String> k = new ArrayList<>();
        out.get("blocks").forEach(b -> k.add(b.get("key").asText()));
        return k;
    }

    static JsonNode blockOf(JsonNode out, String key) {
        for (JsonNode b : out.get("blocks")) if (b.get("key").asText().equals(key)) return b;
        return null;
    }

    // ── LEGACY ──────────────────────────────────────────────────────────────

    @Test
    void moduleOffIsLegacyWithoutTouchingTheLayout() {
        when(gate.moduleEnabled(INST)).thenReturn(false);
        assertEquals("LEGACY", resolve().get("mode").asText());
        assertEquals(1, resolve().size());
        verifyNoInteractions(cache, jdbc);
    }

    @Test
    void holisticIsLegacy() {
        when(gate.isHolistic(INST)).thenReturn(true);
        publish(HomeFixtures.HERO);
        assertEquals("LEGACY", resolve().get("mode").asText());
    }

    @Test
    void noPublishedLayoutIsLegacy() {
        when(cache.get(INST)).thenReturn(Optional.empty());
        assertEquals("LEGACY", resolve().get("mode").asText());
        verifyNoInteractions(jdbc);
    }

    // ── Envelope filters ────────────────────────────────────────────────────

    @Test
    void enabledAndWindowFilterAndListOrder() {
        publish(HomeFixtures.HERO,
                "{'block_key':'off','type':'NOTICE','enabled':false,'config':{'title':'x'}}",
                "{'block_key':'later','type':'NOTICE','starts_at':'2026-11-17T00:00:00Z','config':{'title':'x'}}",
                "{'block_key':'over','type':'NOTICE','ends_at':'2026-11-16T09:59:59Z','config':{'title':'x'}}",
                "{'block_key':'now','type':'NOTICE','starts_at':'2026-11-16T10:00:00Z','ends_at':'2026-11-16T11:00:00Z','config':{'title':'x'}}",
                "{'block_key':'phone','type':'NOTICE','devices':'PHONE','config':{'title':'x'}}");
        JsonNode out = resolve();
        assertEquals("BUILDER", out.get("mode").asText());
        assertEquals(7, out.get("layout_version").asInt());
        assertEquals(NOW.toString(), out.get("server_time").asText());
        assertEquals(List.of("hero", "now", "phone"), keys(out));
        // devices are not filtered on the server
        assertEquals("PHONE", blockOf(out, "phone").get("devices").asText());
        assertEquals("2026-11-16T11:00:00Z", blockOf(out, "now").get("ends_at").asText());
    }

    @Test
    void factsAreNotLoadedWhenNothingNeedsThem() {
        publish(HomeFixtures.HERO, "{'block_key':'n','type':'NOTICE','config':{'title':'x'}}");
        resolve();
        verify(jdbc, never()).enrolments(any(), any());
        verify(jdbc, never()).tagIds(any(), any());
        verify(jdbc).states(INST, USER);
    }

    // ── Audience ────────────────────────────────────────────────────────────

    @Test
    void audienceUsesEnrolmentsAndTagsOnlyWhenNeeded() {
        when(jdbc.enrolments(INST, USER)).thenReturn(List.of(new Enrolment("ps-1", "p-1")));
        publish(HomeFixtures.HERO,
                "{'block_key':'batch','type':'BUILTIN','builtin_widget':'PINS','audience':{'mode':'RULES','all_of':[{'kind':'PACKAGE_SESSION','ids':['ps-1']}]}}",
                "{'block_key':'other','type':'BUILTIN','builtin_widget':'GET_APP','audience':{'mode':'RULES','all_of':[{'kind':'PACKAGE_SESSION','ids':['ps-2']}]}}",
                "{'block_key':'buyers','type':'BUILTIN','builtin_widget':'MY_BOOKS','audience':{'mode':'RULES','all_of':[{'kind':'ENROLLED_IN_COURSE','package_ids':['p-1']}]}}",
                "{'block_key':'promo','type':'BUILTIN','builtin_widget':'MY_ORDERS','audience':{'mode':'RULES','all_of':[{'kind':'NOT_ENROLLED_IN_COURSE','package_ids':['p-1']}]}}");
        assertEquals(List.of("hero", "batch", "buyers"), keys(resolve()));
        verify(jdbc, never()).tagIds(any(), any());
    }

    @Test
    void tagConditionLoadsTags() {
        when(jdbc.enrolments(INST, USER)).thenReturn(List.of());
        when(jdbc.tagIds(INST, USER)).thenReturn(List.of("t-1"));
        publish(HomeFixtures.HERO,
                "{'block_key':'tagged','type':'BUILTIN','builtin_widget':'PINS','audience':{'mode':'RULES','all_of':[{'kind':'USER_TAG','tag_ids':['t-1']}]}}",
                "{'block_key':'both','type':'BUILTIN','builtin_widget':'GET_APP','audience':{'mode':'RULES','all_of':[{'kind':'USER_TAG','tag_ids':['t-1']},{'kind':'PACKAGE_SESSION','ids':['ps-1']}]}}");
        assertEquals(List.of("hero", "tagged"), keys(resolve()));
        verify(jdbc).tagIds(INST, USER);
    }

    // ── Notices ─────────────────────────────────────────────────────────────

    @Test
    void dismissedNoticeIsHiddenAndAckStateIsAttached() {
        when(jdbc.states(INST, USER)).thenReturn(List.of(
                new BlockState("gone", Instant.parse("2026-11-15T00:00:00Z"), null),
                new BlockState("read", null, Instant.parse("2026-11-14T08:00:00Z"))));
        publish(HomeFixtures.HERO,
                "{'block_key':'gone','type':'NOTICE','config':{'title':'x'}}",
                "{'block_key':'read','type':'NOTICE','config':{'title':'Rules','require_ack':true}}");
        JsonNode out = resolve();
        assertEquals(List.of("hero", "read"), keys(out));
        JsonNode state = blockOf(out, "read").get("config").get("state");
        assertFalse(state.get("dismissed").asBoolean());
        assertEquals("2026-11-14T08:00:00Z", state.get("acknowledged_at").asText());
    }

    // ── Banners and links ───────────────────────────────────────────────────

    @Test
    void slideWindowsImagesAndUnavailableLinks() {
        when(jdbc.productPages(any())).thenReturn(List.of(new Owner("SALE", INST, "INACTIVE", null)));
        publish(HomeFixtures.HERO,
                "{'block_key':'ban','type':'BANNER_CAROUSEL','config':{'slides':["
                        + "{'key':'s1','image':{'file_id':'f1','alt':'a'},'link':{'kind':'PRODUCT_PAGE','code':'SALE'}},"
                        + "{'key':'s2','image':{'file_id':'f2','alt':'b'},'ends_at':'2026-11-16T09:00:00Z'},"
                        + "{'key':'s3'},"
                        + "{'key':'s4','image':{'file_id':'f4','alt':'d'},'link':{'kind':'URL','url':'https://shop.example','sells_something':true}}]}}",
                "{'block_key':'empty','type':'BANNER_CAROUSEL','config':{'slides':[{'key':'x','image':{'file_id':'f','alt':'a'},'starts_at':'2026-12-01T00:00:00Z'}]}}");
        JsonNode out = resolve();
        assertEquals(List.of("hero", "ban"), keys(out));
        JsonNode slides = blockOf(out, "ban").get("config").get("slides");
        assertEquals(2, slides.size());
        assertEquals("s1", slides.get(0).get("key").asText());
        assertTrue(slides.get(0).get("link").isNull(), "inactive page: image stays, link removed");
        JsonNode url = slides.get(1).get("link");
        assertTrue(url.get("commerce").asBoolean());
        assertTrue(url.get("available").asBoolean());
    }

    @Test
    void tilesWithUnavailableLinksAreRemovedAndAnEmptyRowIsDropped() {
        when(jdbc.packageOwners(any())).thenReturn(List.of(
                new Owner("p-live", INST, "ACTIVE", "Live"), new Owner("p-dead", INST, "DELETED", "Dead"),
                new Owner("p-else", "inst-2", "ACTIVE", "Elsewhere")));
        when(jdbc.enrolments(INST, USER)).thenReturn(List.of(new Enrolment("ps-9", "p-live")));
        publish(HomeFixtures.HERO,
                "{'block_key':'row','type':'SHORTCUTS','config':{'tiles':["
                        + "{'key':'a','label':'Live','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-live'}},"
                        + "{'key':'b','label':'Dead','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-dead'}},"
                        + "{'key':'c','label':'Else','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-else'}},"
                        + "{'key':'d','label':'Pay','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'APP_PATH','path':'/courses/course-details?courseId=x'}},"
                        + "{'key':'e','label':'Store','icon':{'kind':'ICON','name':'Gift'},'link':{'kind':'FEATURE','feature':'STORE_BOOKS'}}]}}",
                "{'block_key':'dead','type':'SHORTCUTS','config':{'tiles':[{'key':'x','label':'X','link':{'kind':'COURSE','package_id':'p-dead'}}]}}");
        JsonNode out = resolve();
        assertEquals(List.of("hero", "row"), keys(out));
        JsonNode tiles = blockOf(out, "row").get("config").get("tiles");
        assertEquals(List.of("a", "d", "e"), List.of(tiles.get(0).get("key").asText(), tiles.get(1).get("key").asText(),
                tiles.get(2).get("key").asText()));
        JsonNode owned = tiles.get(0).get("link");
        assertTrue(owned.get("owned").asBoolean());
        assertEquals("ps-9", owned.get("package_session_id").asText());
        assertFalse(owned.get("commerce").asBoolean());
        assertTrue(tiles.get(1).get("link").get("commerce").asBoolean(), "reader-blocked app path is commerce");
        assertTrue(tiles.get(2).get("link").get("commerce").asBoolean(), "store feature is commerce");
    }

    // ── Shelves ─────────────────────────────────────────────────────────────

    @Test
    void shelfMarksOwnedHidesOwnedAndDropsWhenEmpty() {
        when(jdbc.enrolments(INST, USER)).thenReturn(List.of(new Enrolment("ps-1", "c1")));
        when(shelves.candidates(eq(INST), eq("keep"), eq(7), any())).thenReturn(List.of(
                new CourseCard("c1", "One", "https://t/1.jpg", 0d, null),
                new CourseCard("c2", "Two", null, 4999d, "INR")));
        when(shelves.candidates(eq(INST), eq("hide"), eq(7), any())).thenReturn(List.of(
                new CourseCard("c1", "One", null, null, null)));
        publish(HomeFixtures.HERO,
                "{'block_key':'keep','type':'COURSE_SHELF','config':{'title':'All','hide_owned':false,'limit':4}}",
                "{'block_key':'hide','type':'COURSE_SHELF','config':{'title':'New'}}");
        JsonNode out = resolve();
        assertEquals(List.of("hero", "keep"), keys(out));
        JsonNode cfg = blockOf(out, "keep").get("config");
        assertEquals("COURSE_LIST", cfg.get("see_all").get("kind").asText());
        assertTrue(cfg.get("see_all").get("tag").isNull());
        JsonNode c1 = cfg.get("courses").get(0);
        assertTrue(c1.get("owned").asBoolean());
        assertTrue(c1.get("is_free").asBoolean());
        assertEquals("ps-1", c1.get("link").get("package_session_id").asText());
        JsonNode c2 = cfg.get("courses").get(1);
        assertFalse(c2.get("owned").asBoolean());
        assertEquals(4999d, c2.get("price").asDouble());
        assertEquals("INR", c2.get("currency").asText());
        assertTrue(c2.get("link").get("commerce").asBoolean());
    }

    // ── Events ──────────────────────────────────────────────────────────────

    @Test
    void customEventTimesAndPastEventDropped() {
        publish(HomeFixtures.HERO,
                "{'block_key':'soon','type':'EVENT','config':{'title':'Open day','starts_at':'2026-11-16T12:00:00Z','ends_at':'2026-11-16T13:00:00Z','join_opens_minutes':30,"
                        + "'join_cta':{'label':'Join','link':{'kind':'URL','url':'https://meet.example/x'}}}}",
                "{'block_key':'past','type':'EVENT','config':{'title':'Old','starts_at':'2026-11-16T08:00:00Z','ends_at':'2026-11-16T09:00:00Z'}}",
                "{'block_key':'notimes','type':'EVENT','config':{'title':'Draft'}}");
        JsonNode out = resolve();
        assertEquals(List.of("hero", "soon"), keys(out));
        JsonNode cfg = blockOf(out, "soon").get("config");
        assertEquals("2026-11-16T11:30:00Z", cfg.get("join_opens_at").asText());
        assertEquals("Join", cfg.get("join_cta").get("label").asText());
        assertTrue(cfg.get("register_cta").isNull());
    }

    @Test
    void liveSessionEventGetsNextOccurrenceAndDefaultCtas() {
        when(jdbc.enrolments(INST, USER)).thenReturn(List.of(new Enrolment("ps-1", "p-1")));
        // Today 09:00-10:30 IST has ended (03:30-05:00 UTC); tomorrow 09:00 IST is next.
        when(jdbc.liveSessions(any(), any(), any())).thenReturn(List.of(
                new LiveRow("ls-1", INST, "Physics live", "Asia/Kolkata", "public", "LIVE",
                        LocalDate.of(2026, 11, 16), LocalTime.of(9, 0), LocalTime.of(10, 30), 0d),
                new LiveRow("ls-1", INST, "Physics live", "Asia/Kolkata", "public", "LIVE",
                        LocalDate.of(2026, 11, 17), LocalTime.of(9, 0), LocalTime.of(10, 30), 0d),
                new LiveRow("ls-gone", INST, "Old", "Asia/Kolkata", "PUBLIC", "LIVE", null, null, null, null)));
        when(jdbc.sessionBatches(any())).thenReturn(List.<String[]>of(new String[] {"ls-1", "ps-1"}));
        publish(HomeFixtures.HERO,
                "{'block_key':'ev','type':'EVENT','config':{'source':'LIVE_SESSION','live_session_id':'ls-1'}}",
                "{'block_key':'ev2','type':'EVENT','config':{'source':'LIVE_SESSION','live_session_id':'ls-gone'}}");
        JsonNode out = resolve();
        assertEquals(List.of("hero", "ev"), keys(out));
        JsonNode cfg = blockOf(out, "ev").get("config");
        assertEquals("2026-11-17T03:30:00Z", cfg.get("starts_at").asText());
        assertEquals("2026-11-17T05:00:00Z", cfg.get("ends_at").asText());
        assertEquals("Physics live", cfg.get("title").asText());
        JsonNode join = cfg.get("join_cta").get("link");
        assertEquals("LIVE_CLASS", join.get("kind").asText());
        assertTrue(join.get("in_my_batch").asBoolean());
        assertFalse(join.get("is_paid").asBoolean());
        assertTrue(cfg.get("register_cta").get("label").isNull(), "default buttons leave the label to the app");
        assertTrue(cfg.get("join_cta").get("label").isNull());
        assertTrue(cfg.get("join_cta").has("label"));
    }

    @Test
    void privateLiveClassLinkIsUnavailable() {
        when(jdbc.liveSessions(any(), any(), any())).thenReturn(List.of(
                new LiveRow("ls-p", INST, "Private", "UTC", "private", "LIVE",
                        LocalDate.of(2026, 11, 20), LocalTime.of(9, 0), LocalTime.of(10, 0), null)));
        publish(HomeFixtures.HERO,
                "{'block_key':'n','type':'NOTICE','config':{'title':'x','button':{'label':'Go','link':{'kind':'LIVE_CLASS','session_id':'ls-p'}}}}");
        assertTrue(blockOf(resolve(), "n").get("config").get("button").isNull());
    }

    // ── Preview ─────────────────────────────────────────────────────────────

    @Test
    void previewFiltersDevicesMarksBuiltinsAndUsesTheGivenBatches() {
        when(jdbc.batchPackages(INST, List.of("ps-1"))).thenReturn(List.of(new Enrolment("ps-1", "p-1")));
        List<Block> blocks = Arrays.asList(block(HomeFixtures.HERO),
                block("{'block_key':'desk','type':'NOTICE','devices':'DESKTOP','config':{'title':'x'}}"),
                block("{'block_key':'mine','type':'NOTICE','audience':{'mode':'RULES','all_of':[{'kind':'ENROLLED_IN_COURSE','package_ids':['p-1']}]},'config':{'title':'x'}}"),
                block("{'block_key':'tag','type':'NOTICE','audience':{'mode':'RULES','all_of':[{'kind':'USER_TAG','tag_ids':['t-1']}]},'config':{'title':'x'}}"));
        ObjectNode out = resolver.preview(INST, 0, Settings.DEFAULT, blocks,
                new LearnerHomeResolver.PreviewAs(List.of("ps-1"), List.of()), Devices.PHONE, NOW);
        assertTrue(out.get("preview").asBoolean());
        assertEquals(List.of("hero", "mine"), keys(out));
        assertTrue(blockOf(out, "hero").get("placeholder").asBoolean());
        verify(jdbc, never()).states(any(), any());
        verify(jdbc, never()).enrolments(any(), any());
    }

    @Test
    void liveSessionIdsCollectedFromLinksAndEvents() {
        Block ev = block("{'type':'EVENT','config':{'source':'LIVE_SESSION','live_session_id':'a',"
                + "'register_cta':{'label':'R','link':{'kind':'LIVE_CLASS','session_id':'b'}}}}");
        assertEquals(Set.of("a", "b"), LinkMetaService.liveSessionIds(List.of(ev)));
    }
}
