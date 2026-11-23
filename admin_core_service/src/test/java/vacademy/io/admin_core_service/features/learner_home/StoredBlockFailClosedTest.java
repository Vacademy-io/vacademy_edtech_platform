package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeBlock;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.resolve.AudienceEvaluator;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerFacts;
import vacademy.io.admin_core_service.features.learner_home.service.BlockMapper;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A stored block whose audience or config cannot be read cleanly is skipped (and reported), never
 * served: an unreadable audience must not turn into "everyone".
 */
class StoredBlockFailClosedTest {

    static LearnerHomeBlock row(String audience, String config) {
        return LearnerHomeBlock.builder().id("1").layoutId("l").instituteId("i").blockKey("n1").type("NOTICE")
                .position(0).desktopPlacement("MAIN").devices("BOTH").enabled(true)
                .audienceJson(audience).configJson(config).build();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"mode\":\"RULES\",\"all_of\":[{\"kind\":\"BATCH\",\"ids\":[\"ps-x\"]}]}",
            "{not json",
            "{\"mode\":\"Rules\"}",
            "{}",
            "[]",
            "",
            "{\"mode\":\"RULES\",\"all_of\":[{\"kind\":\"USER_TAG\",\"ids\":[\"t\"]}]}",
            "{\"mode\":\"EVERYONE\",\"who\":\"all\"}"
    })
    void anUnreadableAudienceSkipsTheBlock(String audience) {
        List<Issue> issues = new ArrayList<>();
        List<Block> served = BlockMapper.fromEntities(List.of(row(audience, "{\"title\":\"Fees overdue\"}")), issues);
        assertEquals(List.of(), served, audience);
        assertFalse(issues.isEmpty());
        assertEquals("n1", issues.get(0).blockKey());
    }

    @Test
    void aNullAudienceSkipsTheBlock() {
        List<Issue> issues = new ArrayList<>();
        assertTrue(BlockMapper.fromEntities(List.of(row(null, "{}")), issues).isEmpty());
        assertFalse(issues.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{oops", "{\"title\":\"x\",\"colour\":\"red\"}", "{\"title\":42}", "[]"})
    void anUnreadableConfigSkipsTheBlock(String config) {
        List<Issue> issues = new ArrayList<>();
        assertTrue(BlockMapper.fromEntities(List.of(row("{\"mode\":\"EVERYONE\"}", config)), issues).isEmpty(), config);
        assertFalse(issues.isEmpty());
    }

    @Test
    void aCleanRowIsServedWithItsRules() {
        List<Issue> issues = new ArrayList<>();
        List<Block> served = BlockMapper.fromEntities(List.of(row(
                "{\"mode\":\"RULES\",\"all_of\":[{\"kind\":\"PACKAGE_SESSION\",\"ids\":[\"ps-x\"]}]}",
                "{\"title\":\"Fees overdue\"}")), issues);
        assertEquals(List.of(), issues);
        assertEquals(1, served.size());
        assertFalse(AudienceEvaluator.matches(served.get(0).audience(), LearnerFacts.EMPTY));
    }

    @Test
    void anUnknownTypeOrWidgetSkipsTheBlock() {
        List<Issue> issues = new ArrayList<>();
        LearnerHomeBlock popup = row("{\"mode\":\"EVERYONE\"}", "{}");
        popup.setType("POPUP");
        LearnerHomeBlock widget = row("{\"mode\":\"EVERYONE\"}", "{}");
        widget.setType("BUILTIN");
        widget.setBuiltinWidget("WEATHER");
        assertTrue(BlockMapper.fromEntities(List.of(popup, widget), issues).isEmpty());
        assertEquals(2, issues.size());
    }
}
