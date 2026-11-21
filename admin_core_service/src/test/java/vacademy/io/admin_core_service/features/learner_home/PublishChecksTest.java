package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.LayoutBody;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.LiveRow;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Owner;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver.CourseCard;
import vacademy.io.admin_core_service.features.learner_home.service.PublishChecks;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.*;

/** Publish checks (spec 6.6): what blocks a publish and what only warns. */
class PublishChecksTest {

    static final String INST = "inst-1";
    static final Instant NOW = Instant.parse("2026-11-16T10:00:00Z");

    LearnerHomeJdbc jdbc;
    ShelfResolver shelves;
    PublishChecks checks;

    @BeforeEach
    void setUp() {
        jdbc = mock(LearnerHomeJdbc.class);
        shelves = mock(ShelfResolver.class);
        checks = new PublishChecks(jdbc, new LinkMetaService(jdbc), shelves);
    }

    List<Block> blocks(String... json) {
        List<Issue> parse = new ArrayList<>();
        LayoutBody body = layout(parse, json);
        assertEquals(List.of(), parse, "fixtures must be valid drafts");
        return body.blocks();
    }

    @Test
    void templatePlaceholdersSaveButDoNotPublish() {
        List<Block> b = blocks(
                "{'block_key':'ban','type':'BANNER_CAROUSEL','config':{'slides':[{'key':'s1'}]}}",
                "{'block_key':'row','type':'SHORTCUTS','config':{'tiles':[{'key':'t1','label':''}]}}",
                "{'block_key':'shelf','type':'COURSE_SHELF','config':{'source':'TAG'}}",
                "{'block_key':'ev','type':'EVENT','config':{}}",
                "{'block_key':'note','type':'NOTICE','config':{'button':{'label':'','link':{'kind':'COURSE'}}}}");
        PublishChecks.Result r = checks.check(INST, b, NOW);
        List<Issue> e = r.errors();
        assertTrue(has(e, "REQUIRED", "slides[0].image"));
        assertTrue(has(e, "REQUIRED", "tiles[0].label"));
        assertTrue(has(e, "REQUIRED", "tiles[0].link"));
        assertTrue(has(e, "REQUIRED", "tiles[0].icon"));
        assertTrue(has(e, "REQUIRED", "config.title") && e.stream().anyMatch(i -> i.blockKey().equals("shelf")));
        assertTrue(has(e, "TOO_FEW", "config.tags"));
        assertTrue(has(e, "REQUIRED", "config.starts_at"));
        assertTrue(has(e, "REQUIRED", "config.ends_at"));
        assertTrue(has(e, "REQUIRED", "button.label"));
        assertTrue(has(e, "LINK_INCOMPLETE", "button.link"));
    }

    @Test
    void altTextRequiredUnlessDecorative() {
        List<Block> b = blocks(
                "{'block_key':'n1','type':'NOTICE','config':{'title':'a','image':{'file_id':'f1'}}}",
                "{'block_key':'n2','type':'NOTICE','config':{'title':'a','image':{'file_id':'f2','decorative':true}}}");
        List<Issue> errors = checks.check(INST, b, NOW).errors();
        assertEquals(1, errors.stream().filter(i -> i.code().equals("ALT_REQUIRED")).count());
        assertEquals("n1", errors.stream().filter(i -> i.code().equals("ALT_REQUIRED")).findFirst().get().blockKey());
    }

    @Test
    void allSlidesEndedIsAnErrorAndManySlidesAWarning() {
        String img = "'image':{'file_id':'f','alt':'a'}";
        List<Block> b = blocks(
                "{'block_key':'old','type':'BANNER_CAROUSEL','config':{'slides':[{" + img + ",'ends_at':'2026-11-01T00:00:00Z'}]}}",
                "{'block_key':'big','type':'BANNER_CAROUSEL','config':{'slides':[{" + img + "},{" + img + "},{" + img + "},{" + img + "}]}}");
        PublishChecks.Result r = checks.check(INST, b, NOW);
        assertTrue(has(r.errors(), "ALL_SLIDES_ENDED", "slides"));
        assertTrue(has(r.warnings(), "MANY_SLIDES", "slides"));
    }

    @Test
    void endedBlockConditionalFeatureFunSkinAndAssessmentWarn() {
        List<Block> b = blocks(
                "{'block_key':'n','type':'NOTICE','ends_at':'2026-11-10T00:00:00Z','config':{'title':'t',"
                        + "'button':{'label':'Notes','link':{'kind':'FEATURE','feature':'NOTEBOOK'}}}}",
                "{'block_key':'q','type':'NOTICE','config':{'title':'t','button':{'label':'Test','link':{'kind':'ASSESSMENT','assessment_id':'a1'}}}}",
                "{'type':'BUILTIN','builtin_widget':'GAMIFICATION'}");
        PublishChecks.Result r = checks.check(INST, b, NOW);
        assertEquals(List.of(), r.errors());
        List<String> w = codes(r.warnings());
        assertTrue(w.contains("BLOCK_ENDED"));
        assertTrue(w.contains("FEATURE_CONDITIONAL"));
        assertTrue(w.contains("NOT_IN_FUN_SKIN"));
        assertTrue(w.contains("ASSESSMENT_NOT_VERIFIED"));
    }

    @Test
    void audienceIdFromAnotherInstituteIsAnErrorAndAMissingIdAWarning() {
        when(jdbc.batchOwners(any())).thenReturn(List.of(new Owner("ps-mine", INST, null, null),
                new Owner("ps-theirs", "inst-2", null, null)));
        when(jdbc.tagOwners(any())).thenReturn(List.of(new Owner("t-default", null, "ACTIVE", null)));
        List<Block> b = blocks("{'block_key':'n','type':'NOTICE','config':{'title':'t'},'audience':{'mode':'RULES','all_of':["
                + "{'kind':'PACKAGE_SESSION','ids':['ps-mine','ps-theirs','ps-deleted']},{'kind':'USER_TAG','tag_ids':['t-default']}]}}");
        PublishChecks.Result r = checks.check(INST, b, NOW);
        assertEquals(1, r.errors().stream().filter(i -> i.code().equals("OTHER_INSTITUTE")).count());
        assertTrue(r.errors().get(0).message().contains("ps-theirs"));
        assertEquals(1, r.warnings().stream().filter(i -> i.code().equals("AUDIENCE_ID_MISSING")).count());
    }

    @Test
    void emptyRulesAreAnError() {
        List<Block> b = blocks("{'block_key':'n','type':'NOTICE','config':{'title':'t'},'audience':{'mode':'RULES','all_of':[]}}");
        assertTrue(has(checks.check(INST, b, NOW).errors(), "REQUIRED", "audience.all_of"));
    }

    @Test
    void linkTargetsMustExistAndBeActive() {
        when(jdbc.packageOwners(any())).thenReturn(List.of(new Owner("p-ok", INST, "ACTIVE", "Ok"),
                new Owner("p-draft", INST, "DRAFT", "Draft"), new Owner("p-other", "inst-2", "ACTIVE", "Other")));
        when(jdbc.productPages(any())).thenReturn(List.of(new Owner("PAGE", INST, "DRAFT", null)));
        when(jdbc.liveSessions(any(), any(), any())).thenReturn(List.of(
                new LiveRow("ls-ok", INST, "Live", "UTC", "PUBLIC", "LIVE", LocalDate.of(2026, 11, 20),
                        LocalTime.of(9, 0), LocalTime.of(10, 0), null),
                new LiveRow("ls-draft", INST, "Draft", "UTC", "PUBLIC", "DRAFT", LocalDate.of(2026, 11, 20),
                        LocalTime.of(9, 0), LocalTime.of(10, 0), null)));
        List<Block> b = blocks("{'block_key':'row','type':'SHORTCUTS','config':{'tiles':["
                + "{'key':'a','label':'A','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-ok'}},"
                + "{'key':'b','label':'B','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-draft'}},"
                + "{'key':'c','label':'C','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-other'}},"
                + "{'key':'d','label':'D','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'COURSE','package_id':'p-missing'}},"
                + "{'key':'e','label':'E','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'PRODUCT_PAGE','code':'PAGE'}},"
                + "{'key':'f','label':'F','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'LIVE_CLASS','session_id':'ls-ok'}},"
                + "{'key':'g','label':'G','icon':{'kind':'ICON','name':'Books'},'link':{'kind':'LIVE_CLASS','session_id':'ls-draft'}}]}}");
        List<Issue> e = checks.check(INST, b, NOW).errors();
        assertFalse(has(e, "LINK_TARGET", "tiles[0]"));
        assertTrue(has(e, "LINK_TARGET_INACTIVE", "tiles[1]"));
        assertTrue(has(e, "LINK_TARGET_MISSING", "tiles[2]"));
        assertTrue(has(e, "LINK_TARGET_MISSING", "tiles[3]"));
        assertTrue(has(e, "LINK_TARGET_INACTIVE", "tiles[4]"));
        assertFalse(e.stream().anyMatch(i -> i.path().contains("tiles[5]")));
        assertTrue(has(e, "LINK_TARGET_INACTIVE", "tiles[6]"));
    }

    @Test
    void shelfThatIsEmptyNowWarns() {
        when(shelves.candidates(eq(INST), eq("s"), eq(-1), any())).thenReturn(List.of());
        when(shelves.candidates(eq(INST), eq("s2"), eq(-1), any())).thenReturn(List.of(new CourseCard("c", "C", null, null, null)));
        List<Block> b = blocks("{'block_key':'s','type':'COURSE_SHELF','config':{'title':'Free','source':'FREE'}}",
                "{'block_key':'s2','type':'COURSE_SHELF','config':{'title':'New'}}");
        PublishChecks.Result r = checks.check(INST, b, NOW);
        assertEquals(1, r.warnings().stream().filter(i -> i.code().equals("SHELF_EMPTY_NOW")).count());
        assertEquals("s", r.warnings().stream().filter(i -> i.code().equals("SHELF_EMPTY_NOW")).findFirst().get().blockKey());
    }

    @Test
    void limitsAreEnforcedAtPublishToo() {
        List<Block> b = new ArrayList<>(blocks());
        for (int i = 0; i < 4; i++) {
            b.add(block("{'block_key':'e" + i + "','type':'EVENT','config':{'title':'t','starts_at':'2026-12-01T00:00:00Z','ends_at':'2026-12-01T01:00:00Z'}}"));
        }
        assertTrue(codes(checks.check(INST, b, NOW).errors()).contains("TOO_MANY"));
    }
}
