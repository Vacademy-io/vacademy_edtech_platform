package vacademy.io.admin_core_service.features.learner_home;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.LayoutBody;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;

import java.util.ArrayList;
import java.util.List;

/** JSON helpers shared by the learner-home tests. Single quotes in the input become double quotes. */
public final class HomeFixtures {

    private HomeFixtures() {
    }

    public static JsonNode json(String singleQuoted) {
        try {
            return HomeWriter.MAPPER.readTree(singleQuoted.replace('\'', '"'));
        } catch (Exception e) {
            throw new IllegalArgumentException("bad fixture JSON: " + singleQuoted, e);
        }
    }

    public static final String HERO = "{'block_key':'hero','type':'BUILTIN','builtin_widget':'HERO','desktop_placement':'FULL'}";

    /** Parses one block (asserting nothing); issues go to {@code issues}. */
    public static Block block(String singleQuoted, List<Issue> issues) {
        return new HomeParser(issues).parseBlock(json(singleQuoted), 0);
    }

    /** Parses one block that must be valid. */
    public static Block block(String singleQuoted) {
        List<Issue> issues = new ArrayList<>();
        Block b = block(singleQuoted, issues);
        if (!issues.isEmpty()) throw new AssertionError("unexpected issues: " + issues);
        return b;
    }

    /** A layout of HERO plus the given blocks. */
    public static LayoutBody layout(List<Issue> issues, String... blocks) {
        StringBuilder sb = new StringBuilder("{'settings':{},'blocks':[").append(HERO);
        for (String b : blocks) sb.append(',').append(b);
        sb.append("]}");
        JsonNode body = json(sb.toString());
        return new HomeParser(issues).parseLayout(body.get("settings"), body.get("blocks"));
    }

    public static List<String> codes(List<Issue> issues) {
        return issues.stream().map(Issue::code).toList();
    }

    public static boolean has(List<Issue> issues, String code, String pathPart) {
        return issues.stream().anyMatch(i -> i.code().equals(code) && i.path() != null && i.path().contains(pathPart));
    }
}
