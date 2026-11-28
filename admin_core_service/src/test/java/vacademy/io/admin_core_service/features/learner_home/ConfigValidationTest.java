package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.*;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeLayoutService;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.*;

/** Save-time validation per block type (spec 3): shape, unknown keys, lengths, counts, URL schemes. */
class ConfigValidationTest {

    // ── Envelope ────────────────────────────────────────────────────────────

    @Test
    void envelopeDefaultsAndGeneratedKey() {
        Block b = block("{'type':'NOTICE','config':{'title':'Hi'}}");
        assertNotNull(b.blockKey());
        assertEquals(Placement.MAIN, b.placement());
        assertEquals(Devices.BOTH, b.devices());
        assertTrue(b.enabled());
        assertTrue(b.audience().everyone());
    }

    @Test
    void unknownKeysAreRejectedAtEveryLevel() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'NOTICE','colour':'red','config':{'title':'x','extra':1,"
                + "'image':{'file_id':'f','alt':'a','size':3},'button':{'label':'Go','link':{'kind':'URL','url':'https://a.b','target':'_blank'}}},"
                + "'audience':{'mode':'EVERYONE','who':'all'}}", issues);
        assertTrue(has(issues, "UNKNOWN_FIELD", "colour"));
        assertTrue(has(issues, "UNKNOWN_FIELD", "config.extra"));
        assertTrue(has(issues, "UNKNOWN_FIELD", "config.image.size"));
        assertTrue(has(issues, "UNKNOWN_FIELD", "config.button.link.target"));
        assertTrue(has(issues, "UNKNOWN_FIELD", "audience.who"));
    }

    @Test
    void enumsAndWindowAreChecked() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'NOTICE','desktop_placement':'SIDE','devices':'TV','starts_at':'2026-12-02T00:00:00Z',"
                + "'ends_at':'2026-12-01T00:00:00Z'}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "desktop_placement"));
        assertTrue(has(issues, "INVALID_VALUE", "devices"));
        assertTrue(has(issues, "INVALID_VALUE", "ends_at"));
    }

    @Test
    void naiveLocalTimesAreRefused() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'NOTICE','starts_at':'2026-12-01T10:00:00'}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "starts_at"));
        assertNotNull(HomeParser.parseInstant("2026-12-01T10:00:00+05:30"));
    }

    @Test
    void unknownTypeAndBadKeyAreRejected() {
        List<Issue> issues = new ArrayList<>();
        assertNull(block("{'type':'POPUP'}", issues));
        assertTrue(has(issues, "INVALID_VALUE", "type"));
        issues.clear();
        block("{'block_key':'has space','type':'NOTICE'}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "block_key"));
    }

    // ── BANNER_CAROUSEL ─────────────────────────────────────────────────────

    @Test
    void bannerLimits() {
        List<Issue> issues = new ArrayList<>();
        StringBuilder slides = new StringBuilder();
        for (int i = 0; i < 6; i++) slides.append(i == 0 ? "" : ",").append("{'key':'s").append(i).append("'}");
        Block b = block("{'type':'BANNER_CAROUSEL','config':{'title':'" + "x".repeat(61) + "','slides':[" + slides + "]}}", issues);
        assertTrue(has(issues, "TOO_LONG", "config.title"));
        assertTrue(has(issues, "TOO_MANY", "config.slides"));
        assertEquals(5, ((BannerConfig) b.config()).slides().size());
    }

    @Test
    void bannerDefaultsAndDuplicateSlideKeys() {
        Block ok = block("{'type':'BANNER_CAROUSEL','config':{'slides':[{'image':{'file_id':'f1','alt':'Sale'}}]}}");
        BannerConfig c = (BannerConfig) ok.config();
        assertTrue(c.autoRotate());
        assertNotNull(c.slides().get(0).key());
        List<Issue> issues = new ArrayList<>();
        block("{'type':'BANNER_CAROUSEL','config':{'slides':[{'key':'a'},{'key':'a'}]}}", issues);
        assertTrue(has(issues, "DUPLICATE", "slides[1].key"));
    }

    @Test
    void imageRefRules() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'BANNER_CAROUSEL','config':{'slides':[{'image':{'file_id':'f','alt':'" + "a".repeat(141)
                + "','url':'ftp://x/y','renditions':{'320':'https://c/1.webp','999':'https://c/2.webp'}}}]}}", issues);
        assertTrue(has(issues, "TOO_LONG", "image.alt"));
        assertTrue(has(issues, "INVALID_URL", "image.url"));
        assertTrue(has(issues, "UNKNOWN_FIELD", "renditions.999"));
    }

    // ── SHORTCUTS ───────────────────────────────────────────────────────────

    @Test
    void shortcutLimitsAndIcons() {
        List<Issue> issues = new ArrayList<>();
        StringBuilder tiles = new StringBuilder();
        for (int i = 0; i < 17; i++) tiles.append(i == 0 ? "" : ",").append("{'label':'T").append(i).append("'}");
        block("{'type':'SHORTCUTS','config':{'tiles':[" + tiles + "]}}", issues);
        assertTrue(has(issues, "TOO_MANY", "config.tiles"));

        issues.clear();
        block("{'type':'SHORTCUTS','config':{'tiles':[{'label':'" + "x".repeat(21)
                + "','icon':{'kind':'ICON','name':'NotAnIcon'}},{'label':'B','icon':{'kind':'EMOJI'}}]}}", issues);
        assertTrue(has(issues, "TOO_LONG", "tiles[0].label"));
        assertTrue(has(issues, "INVALID_VALUE", "tiles[0].icon.name"));
        assertTrue(has(issues, "INVALID_VALUE", "tiles[1].icon.kind"));

        Block ok = block("{'type':'SHORTCUTS','config':{'tiles':[{'label':'Notes','icon':{'kind':'ICON','name':'Notebook'},"
                + "'link':{'kind':'FEATURE','feature':'NOTEBOOK'}}]}}");
        assertEquals(ShortcutIcon.Notebook, ((ShortcutsConfig) ok.config()).tiles().get(0).icon().name());
    }

    @Test
    void fortyCuratedIcons() {
        assertEquals(40, ShortcutIcon.values().length);
    }

    // ── COURSE_SHELF ────────────────────────────────────────────────────────

    @Test
    void shelfRules() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'COURSE_SHELF','config':{'title':'New','source':'POPULAR','tags':['a','b','c','d','e','f'],"
                + "'limit':3}}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "config.source"));
        assertTrue(has(issues, "TOO_MANY", "config.tags"));
        assertTrue(has(issues, "OUT_OF_RANGE", "config.limit"));

        issues.clear();
        StringBuilder ids = new StringBuilder();
        for (int i = 0; i < 21; i++) ids.append(i == 0 ? "" : ",").append("'p").append(i).append("'");
        block("{'type':'COURSE_SHELF','config':{'title':'Picks','source':'HAND_PICKED','package_ids':[" + ids + "],'limit':21}}", issues);
        assertTrue(has(issues, "TOO_MANY", "config.package_ids"));
        assertTrue(has(issues, "OUT_OF_RANGE", "config.limit"));

        ShelfConfig c = (ShelfConfig) block("{'type':'COURSE_SHELF','config':{'title':'New'}}").config();
        assertEquals(ShelfSource.NEWEST, c.source());
        assertEquals(10, c.limit());
        assertTrue(c.hideOwned());
        assertTrue(c.showPrice());
    }

    // ── NOTICE ──────────────────────────────────────────────────────────────

    @Test
    void noticeRules() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'NOTICE','config':{'title':'" + "t".repeat(81) + "','body':'" + "b".repeat(601)
                + "','tone':'DANGER','button':{'label':'" + "l".repeat(25) + "'}}}", issues);
        assertTrue(has(issues, "TOO_LONG", "config.title"));
        assertTrue(has(issues, "TOO_LONG", "config.body"));
        assertTrue(has(issues, "INVALID_VALUE", "config.tone"));
        assertTrue(has(issues, "TOO_LONG", "config.button.label"));

        NoticeConfig n = (NoticeConfig) block("{'type':'NOTICE','config':{'title':'Read','require_ack':true}}").config();
        assertEquals("I have read this", n.ackLabel());
        assertTrue(n.dismissible());
        assertEquals(Tone.NEUTRAL, n.tone());
    }

    // ── EVENT ───────────────────────────────────────────────────────────────

    @Test
    void eventRules() {
        List<Issue> issues = new ArrayList<>();
        block("{'type':'EVENT','config':{'title':'Webinar','starts_at':'2026-12-01T15:00:00Z','ends_at':'2026-12-01T13:00:00Z',"
                + "'join_opens_minutes':121,'source':'ZOOM'}}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "config.ends_at"));
        assertTrue(has(issues, "OUT_OF_RANGE", "config.join_opens_minutes"));
        assertTrue(has(issues, "INVALID_VALUE", "config.source"));

        EventConfig e = (EventConfig) block("{'type':'EVENT','config':{'title':'W'}}").config();
        assertEquals(15, e.joinOpensMinutes());
        assertEquals(EventSource.CUSTOM, e.source());
    }

    // ── BUILTIN ─────────────────────────────────────────────────────────────

    @Test
    void builtinOptionsPerWidget() {
        BuiltinConfig hero = (BuiltinConfig) block("{'type':'BUILTIN','builtin_widget':'HERO','config':{'options':{'getting_started':false}}}").config();
        assertEquals(false, hero.options().get("getting_started"));
        BuiltinConfig stats = (BuiltinConfig) block("{'type':'BUILTIN','builtin_widget':'STATS_ROW'}").config();
        assertEquals(List.of("COURSES", "LIVE_CLASSES", "EVALUATIONS"), stats.options().get("cards"));

        List<Issue> issues = new ArrayList<>();
        block("{'type':'BUILTIN','builtin_widget':'STATS_ROW','config':{'options':{'cards':['COURSES','COURSES','BADGES']}}}", issues);
        assertTrue(has(issues, "DUPLICATE", "cards[1]"));
        assertTrue(has(issues, "INVALID_VALUE", "cards[2]"));

        issues.clear();
        block("{'type':'BUILTIN','builtin_widget':'MY_MENTORS','config':{'options':{'show_all':true}}}", issues);
        assertTrue(has(issues, "UNKNOWN_FIELD", "options.show_all"));

        issues.clear();
        assertNull(block("{'type':'BUILTIN'}", issues));
        assertTrue(has(issues, "REQUIRED", "builtin_widget"));
        issues.clear();
        block("{'type':'NOTICE','builtin_widget':'HERO'}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "builtin_widget"));
    }

    // ── Links ───────────────────────────────────────────────────────────────

    @Test
    void urlSchemesAndAppPaths() {
        assertTrue(HomeParser.isAllowedLinkUrl("https://example.com/x"));
        assertTrue(HomeParser.isAllowedLinkUrl("http://example.com"));
        assertTrue(HomeParser.isAllowedLinkUrl("mailto:help@example.com"));
        assertTrue(HomeParser.isAllowedLinkUrl("tel:+911234567890"));
        assertFalse(HomeParser.isAllowedLinkUrl("javascript:alert(1)"));
        assertFalse(HomeParser.isAllowedLinkUrl("JavaScript:alert(1)"));
        assertFalse(HomeParser.isAllowedLinkUrl("data:text/html,hi"));
        assertFalse(HomeParser.isAllowedLinkUrl("/relative"));
        assertFalse(HomeParser.isAllowedLinkUrl("https://"));
        assertFalse(HomeParser.isAllowedLinkUrl("https://a.b/\nx"));

        List<Issue> issues = new ArrayList<>();
        block("{'type':'NOTICE','config':{'button':{'label':'Go','link':{'kind':'URL','url':'javascript:alert(1)'}}}}", issues);
        assertTrue(has(issues, "INVALID_URL", "button.link.url"));
        issues.clear();
        block("{'type':'NOTICE','config':{'button':{'label':'Go','link':{'kind':'APP_PATH','path':'//evil.example'}}}}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "button.link.path"));
        issues.clear();
        block("{'type':'NOTICE','config':{'button':{'label':'Go','link':{'kind':'COURSE','package_id':'p','code':'x'}}}}", issues);
        assertTrue(has(issues, "UNKNOWN_FIELD", "button.link.code"));
        issues.clear();
        block("{'type':'NOTICE','config':{'button':{'label':'Go','link':{'kind':'TELEPORT'}}}}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "button.link.kind"));
        issues.clear();
        block("{'type':'NOTICE','config':{'button':{'label':'Go','link':{'kind':'FEATURE','feature':'TIME_MACHINE'}}}}", issues);
        assertTrue(has(issues, "INVALID_VALUE", "button.link.feature"));
    }

    // ── Audience ────────────────────────────────────────────────────────────

    @Test
    void audienceShape() {
        Block b = block("{'type':'NOTICE','audience':{'mode':'RULES','all_of':[{'kind':'PACKAGE_SESSION','ids':['ps1','ps1','ps2']},"
                + "{'kind':'NOT_ENROLLED_IN_COURSE','package_ids':['p1']},{'kind':'USER_TAG','tag_ids':['t1']}]}}");
        assertFalse(b.audience().everyone());
        assertEquals(List.of("ps1", "ps2"), b.audience().allOf().get(0).ids());
        assertTrue(b.audience().usesTags());

        List<Issue> issues = new ArrayList<>();
        block("{'type':'NOTICE','audience':{'mode':'RULES','all_of':[{'kind':'USER_TAG','ids':['t1']},"
                + "{'kind':'BIRTHDAY','ids':[]}]}}", issues);
        assertTrue(has(issues, "UNKNOWN_FIELD", "all_of[0].ids"));
        assertTrue(has(issues, "INVALID_VALUE", "all_of[1].kind"));

        issues.clear();
        StringBuilder rows = new StringBuilder();
        for (int i = 0; i < 6; i++) rows.append(i == 0 ? "" : ",").append("{'kind':'USER_TAG','tag_ids':['t']}");
        block("{'type':'NOTICE','audience':{'mode':'RULES','all_of':[" + rows + "]}}", issues);
        assertTrue(has(issues, "TOO_MANY", "audience.all_of"));

        issues.clear();
        StringBuilder ids = new StringBuilder();
        for (int i = 0; i < 201; i++) ids.append(i == 0 ? "" : ",").append("'t").append(i).append("'");
        block("{'type':'NOTICE','audience':{'mode':'RULES','all_of':[{'kind':'USER_TAG','tag_ids':[" + ids + "]}]}}", issues);
        assertTrue(has(issues, "TOO_MANY", "tag_ids"));
    }

    // ── Layout level ────────────────────────────────────────────────────────

    @Test
    void heroRequiredAndBuiltinsUnique() {
        List<Issue> issues = new ArrayList<>();
        new HomeParser(issues).parseLayout(json("{}"), json("[{'type':'NOTICE'}]"));
        assertTrue(codes(issues).contains("HERO_REQUIRED"));

        issues.clear();
        layout(issues, "{'type':'BUILTIN','builtin_widget':'PINS'}", "{'type':'BUILTIN','builtin_widget':'PINS'}",
                "{'type':'BUILTIN','builtin_widget':'HERO','block_key':'hero2'}");
        assertEquals(2, issues.stream().filter(i -> i.code().equals("DUPLICATE")).count());
    }

    @Test
    void layoutCountLimits() {
        List<Issue> issues = new ArrayList<>();
        String banner = "{'type':'BANNER_CAROUSEL'}";
        layout(issues, banner, banner, banner, banner);
        assertTrue(issues.stream().anyMatch(i -> i.code().equals("TOO_MANY") && i.message().contains("banner")));

        issues.clear();
        String[] many = new String[21];
        for (int i = 0; i < 21; i++) many[i] = "{'type':'NOTICE'}";
        layout(issues, many);
        assertTrue(issues.stream().anyMatch(i -> i.code().equals("TOO_MANY") && i.message().contains("not built-in")));

        issues.clear();
        String[] shelves = new String[7];
        for (int i = 0; i < 7; i++) shelves[i] = "{'type':'COURSE_SHELF'}";
        layout(issues, shelves);
        assertTrue(issues.stream().anyMatch(i -> i.code().equals("TOO_MANY") && i.message().contains("shelves")));

        issues.clear();
        layout(issues, "{'block_key':'k','type':'NOTICE'}", "{'block_key':'k','type':'NOTICE'}");
        assertTrue(has(issues, "DUPLICATE", "block_key"));
    }

    @Test
    void settingsRejectUnknownKeys() {
        List<Issue> issues = new ArrayList<>();
        Settings s = new HomeParser(issues).parseSettings(json("{'phone_spacing':'COMFORTABLE','dark':true}"));
        assertEquals(PhoneSpacing.COMFORTABLE, s.phoneSpacing());
        assertTrue(has(issues, "UNKNOWN_FIELD", "settings.dark"));
    }

    @Test
    void payloadOver256KbIsRefused() {
        String big = "{\"settings\":{},\"blocks\":[],\"pad\":\"" + "x".repeat(HomeParser.MAX_BODY_BYTES) + "\"}";
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> LearnerHomeLayoutService.readBody(big));
        assertEquals("PAYLOAD_TOO_LARGE", e.getCode());
        assertEquals("INVALID_JSON", assertThrows(LearnerHomeException.class,
                () -> LearnerHomeLayoutService.readBody("{not json")).getCode());
    }

    @Test
    void writerOutputParsesBackToTheSameModel() {
        String src = "{'block_key':'b1','type':'EVENT','desktop_placement':'RAIL','devices':'PHONE','admin_label':'Open day',"
                + "'starts_at':'2026-11-20T00:00:00Z','audience':{'mode':'RULES','all_of':[{'kind':'ENROLLED_IN_COURSE','package_ids':['p1']}]},"
                + "'config':{'title':'Open day','subtitle':'Campus','source':'CUSTOM','starts_at':'2026-12-01T13:30:00Z',"
                + "'ends_at':'2026-12-01T15:00:00Z','register_cta':{'label':'Register','link':{'kind':'URL','url':'https://x.example/r','sells_something':true}},"
                + "'join_opens_minutes':30,'show_countdown':false,'image':{'file_id':'img','alt':'Hall','width':1280,'height':720}}}";
        Block a = block(src);
        String written = HomeWriter.toJson(HomeWriter.block(a));
        Block b = block(written.replace('"', '\''));
        assertEquals(a, b);
    }
}
