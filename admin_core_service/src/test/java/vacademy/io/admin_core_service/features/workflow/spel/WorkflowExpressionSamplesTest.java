package vacademy.io.admin_core_service.features.workflow.spel;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.expression.spel.SpelNode;
import org.springframework.expression.spel.ast.BeanReference;
import org.springframework.expression.spel.ast.ConstructorReference;
import org.springframework.expression.spel.ast.MethodReference;
import org.springframework.expression.spel.ast.TypeReference;
import org.springframework.expression.spel.standard.SpelExpression;
import org.springframework.expression.spel.standard.SpelExpressionParser;

import java.io.InputStream;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Representative automation expressions (src/test/resources/workflow-expression-samples.json; a full export can be
 * passed with -Dworkflow.expression.corpus=<file>,
 * literals that pointed at real hosts/ids replaced by placeholders) still parses, and every type and
 * constructor it names still resolves under the allow-listed evaluation context. A sample marked
 * {@code "parses": false} is stored text that was never valid SpEL (message copy, colour codes,
 * {@code #{...}} templates, unbalanced parentheses) and fails to parse exactly as it always did.
 */
class WorkflowExpressionSamplesTest {

    private static final Set<String> NEVER_CALLED = Set.of("getClass", "forName", "exec", "getRuntime",
            "loadClass", "invoke", "invokeExact", "newInstance", "getMethod", "getDeclaredMethod",
            "getDeclaredField", "setAccessible", "lookup", "getenv", "getProperty", "setDefault");

    private final SpelExpressionParser parser = new SpelExpressionParser();
    private final ListAppender<ILoggingEvent> refusals = new ListAppender<>();
    private Logger policyLogger;
    private Level previousLevel;

    @BeforeEach
    void captureRefusals() {
        refusals.start();
        policyLogger = (Logger) LoggerFactory.getLogger(WorkflowExpressionPolicy.class);
        previousLevel = policyLogger.getLevel();
        policyLogger.setLevel(Level.WARN);
        policyLogger.addAppender(refusals);
    }

    @AfterEach
    void release() {
        policyLogger.detachAppender(refusals);
        policyLogger.setLevel(previousLevel);
    }

    /** Optional: -Dworkflow.expression.corpus=/path/to/export.json runs the same checks on a full local export. */
    private static final String CORPUS_PROPERTY = "workflow.expression.corpus";

    private static List<JsonNode> samples() throws Exception {
        String external = System.getProperty(CORPUS_PROPERTY);
        if (external != null && !external.isBlank()) {
            List<JsonNode> out = new ArrayList<>();
            new ObjectMapper().readTree(new java.io.File(external)).forEach(out::add);
            return out;
        }
        try (InputStream in = WorkflowExpressionSamplesTest.class
                .getResourceAsStream("/workflow-expression-samples.json")) {
            assertTrue(in != null, "workflow-expression-samples.json is on the test classpath");
            List<JsonNode> out = new ArrayList<>();
            new ObjectMapper().readTree(in).forEach(out::add);
            return out;
        }
    }

    @Test
    void everySavedExpressionParsesAndEveryTypeAndConstructorResolves() throws Exception {
        List<JsonNode> samples = samples();
        WorkflowExpressionPolicy.AllowListTypeLocator locator = new WorkflowExpressionPolicy.AllowListTypeLocator("test");
        int parsed = 0;
        int notSpel = 0;
        int typeRefs = 0;
        int ctorRefs = 0;
        Set<String> typesSeen = new TreeSet<>();
        List<String> problems = new ArrayList<>();

        for (JsonNode sample : samples) {
            String expr = sample.get("expr").asText().trim();
            boolean expectedToParse = sample.path("parses").asBoolean(true);
            SpelExpression parsedExpr;
            try {
                parsedExpr = (SpelExpression) parser.parseExpression(expr);
            } catch (Exception e) {
                if (expectedToParse) {
                    problems.add("does not parse: " + shorten(expr) + " -> " + e.getMessage());
                } else {
                    notSpel++;
                }
                continue;
            }
            if (!expectedToParse) {
                problems.add("marked as not parsing but parses: " + shorten(expr));
                continue;
            }
            parsed++;
            List<SpelNode> nodes = new ArrayList<>();
            collect(parsedExpr.getAST(), nodes);
            for (SpelNode node : nodes) {
                if (node instanceof TypeReference) {
                    typeRefs++;
                    String name = node.getChild(0).toStringAST();
                    typesSeen.add(name);
                    try {
                        locator.findType(name);
                    } catch (Exception e) {
                        problems.add("type not resolved: " + name + " in " + shorten(expr));
                    }
                } else if (node instanceof ConstructorReference) {
                    ctorRefs++;
                    String name = node.getChild(0).toStringAST();
                    typesSeen.add("new " + name);
                    try {
                        Class<?> type = locator.findType(name);
                        if (!WorkflowExpressionPolicy.CONSTRUCTIBLE_TYPES.contains(type.getName())) {
                            problems.add("constructor not allowed: " + name + " in " + shorten(expr));
                        }
                    } catch (Exception e) {
                        problems.add("constructor type not resolved: " + name + " in " + shorten(expr));
                    }
                } else if (node instanceof MethodReference m && NEVER_CALLED.contains(m.getName())) {
                    problems.add("calls a refused method " + m.getName() + ": " + shorten(expr));
                } else if (node instanceof BeanReference) {
                    problems.add("uses a bean reference: " + shorten(expr));
                }
            }
        }

        System.out.printf("workflow expression samples: %d total, %d parse, %d stored text that never parsed, "
                        + "%d T() references and %d constructor references resolved; types: %s%n",
                samples.size(), parsed, notSpel, typeRefs, ctorRefs, typesSeen);
        if (!problems.isEmpty()) {
            fail(problems.size() + " sample(s) would change behaviour:\n" + String.join("\n", problems));
        }
        assertEquals(samples.size(), parsed + notSpel);
        assertTrue(parsed >= samples.size() * 9 / 10, "almost every sample is an expression");
        assertEquals(0, refusals.list.size(), "no lookup was refused");
    }

    /**
     * Evaluates every parseable sample against a fake run context with the previous context and with
     * the allow-listed one. Most samples need data the fake context does not have and fail in both;
     * what matters is that the allow-list never refuses a lookup and that nothing that worked before
     * stops working or returns something else.
     */
    @Test
    void savedExpressionsEvaluateTheSameUnderTheAllowList() throws Exception {
        SpelEvaluator legacy = new SpelEvaluator(new WorkflowDateFunctions());
        legacy.setRestricted(false);
        SpelEvaluator restricted = new SpelEvaluator(new WorkflowDateFunctions());

        int evaluated = 0;
        int succeeded = 0;
        List<String> problems = new ArrayList<>();
        for (JsonNode sample : samples()) {
            if (!sample.path("parses").asBoolean(true)) {
                continue;
            }
            String expr = sample.get("expr").asText();
            evaluated++;
            Object before;
            Object after;
            boolean beforeOk;
            boolean afterOk;
            try {
                before = legacy.evaluate(expr, fakeContext(), Map.of("item", fakeLearner()));
                beforeOk = true;
            } catch (SpelEvaluator.SpelEvaluationError e) {
                before = null;
                beforeOk = false;
            }
            try {
                after = restricted.evaluate(expr, fakeContext(), Map.of("item", fakeLearner()));
                afterOk = true;
            } catch (SpelEvaluator.SpelEvaluationError e) {
                after = null;
                afterOk = false;
            }
            if (beforeOk) {
                succeeded++;
                if (!afterOk) {
                    problems.add("worked before, fails now: " + shorten(expr));
                } else if (!isTimeOrRandomDependent(expr) && !String.valueOf(before).equals(String.valueOf(after))) {
                    problems.add("different result: " + shorten(expr));
                }
            }
        }
        System.out.printf("workflow expression samples evaluated against a fake context: %d, "
                + "%d evaluate without error (same result under the allow-list)%n", evaluated, succeeded);
        if (!problems.isEmpty()) {
            fail(String.join("\n", problems));
        }
        assertTrue(succeeded >= Math.min(50, evaluated / 2), "a representative share of the samples ran to completion");
        assertEquals(0, refusals.list.size(), "no lookup was refused: "
                + refusals.list.stream().map(ILoggingEvent::getFormattedMessage).toList());
    }

    private static Map<String, Object> fakeLearner() {
        Map<String, Object> learner = new LinkedHashMap<>();
        learner.put("userId", "u-1");
        learner.put("user_id", "u-1");
        learner.put("id", "u-1");
        learner.put("name", "Learner");
        learner.put("fullName", "Learner One");
        learner.put("full_name", "Learner One");
        learner.put("email", "learner@example.com");
        learner.put("mobileNumber", "910000000000");
        learner.put("phone", "910000000000");
        learner.put("enrolledDate", Date.from(LocalDate.now().minusDays(3).atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant()));
        learner.put("expiryDate", new Date());
        learner.put("remainingDays", 3);
        learner.put("remaining_days", 3);
        learner.put("learningDay", 4);
        learner.put("packageSessionId", "ps-1");
        learner.put("status", "ACTIVE");
        return learner;
    }

    private static Map<String, Object> fakeContext() {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("workflowId", "wf-test");
        ctx.put("instituteId", "inst-1");
        ctx.put("institute_id", "inst-1");
        ctx.put("item", fakeLearner());
        ctx.put("user", fakeLearner());
        List<Map<String, Object>> roster = List.of(fakeLearner(), fakeLearner());
        ctx.put("ssigmList", roster);
        ctx.put("ssigm_list", roster);
        ctx.put("learners", roster);
        ctx.put("leads", roster);
        ctx.put("users", roster);
        ctx.put("packageSessionIds", List.of("ps-1"));
        ctx.put("packageId", "p-1");
        ctx.put("channel", "EMAIL");
        ctx.put("todayDow", "MONDAY");
        ctx.put("currentDayInCycle", 2);
        ctx.put("lmsConfig", Map.of("apiUrl", "https://lms.example.com/wp-json/wp/v2",
                "data", Map.of("ldLmsApiUrl", "https://lms.example.com/wp-json/ldlms/v2", "allLectureGroupId", "7")));
        return ctx;
    }

    private static boolean isTimeOrRandomDependent(String expr) {
        return expr.contains("now(") || expr.contains("Date()") || expr.contains("random") || expr.contains("#dates");
    }

    private static void collect(SpelNode node, List<SpelNode> out) {
        out.add(node);
        for (int i = 0; i < node.getChildCount(); i++) {
            collect(node.getChild(i), out);
        }
    }

    private static String shorten(String expr) {
        String flat = expr.replace('\n', ' ');
        return flat.length() > 160 ? flat.substring(0, 160) + "..." : flat;
    }
}
