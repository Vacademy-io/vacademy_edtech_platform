package vacademy.io.admin_core_service.features.learner_home;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.LayoutBody;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Settings;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Owner;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService;
import vacademy.io.admin_core_service.features.learner_home.resolve.PublishedLayout;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;
import vacademy.io.admin_core_service.features.learner_home.service.PublishChecks;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.json;

/**
 * "Start from my current home" (spec 11): the admin app converts today's widget settings and
 * custom cards into blocks. The server must accept that payload as is (template CURRENT), let it
 * publish without errors, and serve imported cards in the parity shape (neutral, not dismissible,
 * no ack) with their links resolved.
 */
class CustomWidgetImportTest {

    static final String INST = "inst-1";
    static final Instant NOW = Instant.parse("2026-11-16T10:00:00Z");

    /** What legacy-conversion.ts produces for a home with every widget and four custom cards. */
    static final String CONVERTED = "{'template_key':'CURRENT','settings':{'phone_spacing':'COMPACT','show_header':true},'blocks':["
            + "{'block_key':'hero','type':'BUILTIN','builtin_widget':'HERO','desktop_placement':'FULL','config':{'options':{'getting_started':true}}},"
            + "{'block_key':'nrl','type':'BUILTIN','builtin_widget':'NOTEBOOK_REVIEW','desktop_placement':'MAIN'},"
            + "{'block_key':'cmp','type':'BUILTIN','builtin_widget':'COMPANIONS','desktop_placement':'MAIN'},"
            + "{'block_key':'cl','type':'BUILTIN','builtin_widget':'CONTINUE_LEARNING','desktop_placement':'MAIN'},"
            + "{'block_key':'c1','type':'NOTICE','admin_label':'Imported card','desktop_placement':'MAIN','config':{'title':'Join our Telegram','body':'Daily tips',"
            + "  'button':{'label':'Open','link':{'kind':'URL','url':'https://t.me/example','sells_something':false}},'tone':'NEUTRAL','dismissible':false,'require_ack':false}},"
            + "{'block_key':'ec','type':'BUILTIN','builtin_widget':'ENROLLED_COURSES','desktop_placement':'MAIN','config':{'options':{'show_all':false}}},"
            + "{'block_key':'st','type':'BUILTIN','builtin_widget':'STATS_ROW','desktop_placement':'MAIN','config':{'options':{'cards':['COURSES','EVALUATIONS']}}},"
            + "{'block_key':'c2','type':'NOTICE','admin_label':'Imported card','desktop_placement':'MAIN','config':{'title':'Mock tests','body':'',"
            + "  'button':{'label':'Open','link':{'kind':'APP_PATH','path':'/study-library/reports?tab=mock'}},'tone':'NEUTRAL','dismissible':false,'require_ack':false}},"
            + "{'block_key':'c3','type':'NOTICE','admin_label':'Imported card','desktop_placement':'MAIN','config':{'title':'Buy the crash course','body':'',"
            + "  'button':{'label':'Open','link':{'kind':'APP_PATH','path':'/courses/course-details?courseId=p-1'}},'tone':'NEUTRAL','dismissible':false,'require_ack':false}},"
            + "{'block_key':'c4','type':'NOTICE','admin_label':'Imported card','desktop_placement':'MAIN','enabled':false,'config':{'title':'Untitled','body':'',"
            + "  'button':null,'tone':'NEUTRAL','dismissible':false,'require_ack':false}},"
            + "{'block_key':'la','type':'BUILTIN','builtin_widget':'LEARNING_ANALYTICS','desktop_placement':'MAIN','enabled':false},"
            + "{'block_key':'mm','type':'BUILTIN','builtin_widget':'MY_MEMBERSHIP','desktop_placement':'MAIN'},"
            + "{'block_key':'mb','type':'BUILTIN','builtin_widget':'MY_BOOKS','desktop_placement':'MAIN'},"
            + "{'block_key':'mo','type':'BUILTIN','builtin_widget':'MY_ORDERS','desktop_placement':'MAIN'},"
            + "{'block_key':'pins','type':'BUILTIN','builtin_widget':'PINS','desktop_placement':'RAIL'},"
            + "{'block_key':'tt','type':'BUILTIN','builtin_widget':'TODAY_TASKS','desktop_placement':'RAIL'},"
            + "{'block_key':'ul','type':'BUILTIN','builtin_widget':'UPCOMING_LIVE_CLASSES','desktop_placement':'RAIL'},"
            + "{'block_key':'wa','type':'BUILTIN','builtin_widget':'THIS_WEEK_ATTENDANCE','desktop_placement':'RAIL'},"
            + "{'block_key':'men','type':'BUILTIN','builtin_widget':'MY_MENTORS','desktop_placement':'RAIL'},"
            + "{'block_key':'app','type':'BUILTIN','builtin_widget':'GET_APP','desktop_placement':'RAIL'},"
            + "{'block_key':'gam','type':'BUILTIN','builtin_widget':'GAMIFICATION','desktop_placement':'FULL'},"
            + "{'block_key':'rq','type':'BUILTIN','builtin_widget':'RAISE_QUERY','desktop_placement':'FULL'},"
            + "{'block_key':'ex','type':'BUILTIN','builtin_widget':'EXPLORE_BUTTONS','desktop_placement':'FULL','config':{'options':{'memberships':true,'books':false}}}"
            + "]}";

    static LayoutBody parse(List<Issue> issues) {
        JsonNode body = json(CONVERTED);
        return new HomeParser(issues).parseLayout(body.get("settings"), body.get("blocks"));
    }

    @Test
    void theConvertedHomeIsAValidDraftAndRoundTrips() {
        List<Issue> issues = new ArrayList<>();
        LayoutBody body = parse(issues);
        assertEquals(List.of(), issues);
        assertEquals(23, body.blocks().size());
        assertEquals("hero", body.blocks().get(0).blockKey());
        for (Block b : body.blocks()) {
            List<Issue> again = new ArrayList<>();
            Block back = new HomeParser(again).parseBlock(HomeWriter.block(b), 0);
            assertEquals(List.of(), again);
            assertEquals(b, back, "stored form reads back identically: " + b.blockKey());
        }
    }

    @Test
    void theConvertedHomePublishesWithoutErrors() {
        LearnerHomeJdbc jdbc = mock(LearnerHomeJdbc.class);
        PublishChecks checks = new PublishChecks(jdbc, new LinkMetaService(jdbc), mock(ShelfResolver.class));
        PublishChecks.Result r = checks.check(INST, parse(new ArrayList<>()).blocks(), NOW);
        assertEquals(List.of(), r.errors());
        assertTrue(r.warnings().stream().anyMatch(w -> w.code().equals("NOT_IN_FUN_SKIN") && w.blockKey().equals("tt")));
    }

    @Test
    void importedCardsResolveInTheParityShape() {
        LearnerHomeJdbc jdbc = mock(LearnerHomeJdbc.class);
        when(jdbc.packageOwners(any())).thenReturn(List.<Owner>of());
        LearnerHomeGate gate = mock(LearnerHomeGate.class);
        when(gate.moduleEnabled(INST)).thenReturn(true);
        LearnerHomeLayoutCache cache = mock(LearnerHomeLayoutCache.class);
        List<Block> blocks = parse(new ArrayList<>()).blocks();
        Map<String, Block> byKey = new LinkedHashMap<>();
        blocks.forEach(b -> byKey.put(b.blockKey(), b));
        when(cache.get(INST)).thenReturn(Optional.of(new PublishedLayout("l", 1, Settings.DEFAULT, blocks, byKey,
                byKey.keySet())));
        LearnerHomeResolver resolver = new LearnerHomeResolver(gate, cache, jdbc, new LinkMetaService(jdbc),
                mock(ShelfResolver.class));

        JsonNode out = resolver.resolve(INST, "u1", NOW);
        List<String> keys = new ArrayList<>();
        out.get("blocks").forEach(b -> keys.add(b.get("key").asText()));
        assertFalse(keys.contains("c4"), "a disabled import stays hidden");
        assertFalse(keys.contains("la"));
        assertEquals("hero", keys.get(0));
        assertEquals(List.of("gam", "rq", "ex"), keys.subList(keys.size() - 3, keys.size()), "bottom row stays at the bottom");

        JsonNode c1 = find(out, "c1").get("config");
        assertEquals("NEUTRAL", c1.get("tone").asText());
        assertFalse(c1.get("dismissible").asBoolean());
        assertFalse(c1.get("require_ack").asBoolean());
        assertTrue(c1.get("image").isNull());
        assertEquals("https://t.me/example", c1.get("button").get("link").get("url").asText());
        assertFalse(c1.get("button").get("link").get("commerce").asBoolean());

        assertFalse(find(out, "c2").get("config").get("button").get("link").get("commerce").asBoolean());
        assertTrue(find(out, "c3").get("config").get("button").get("link").get("commerce").asBoolean(),
                "an imported link into the paid course page is hidden in reader mode");
        assertEquals("FULL", find(out, "ex").get("placement").asText());
        assertFalse(find(out, "ex").get("config").get("options").get("books").asBoolean());
    }

    static JsonNode find(JsonNode out, String key) {
        for (JsonNode b : out.get("blocks")) if (b.get("key").asText().equals(key)) return b;
        throw new AssertionError("missing block " + key);
    }
}
