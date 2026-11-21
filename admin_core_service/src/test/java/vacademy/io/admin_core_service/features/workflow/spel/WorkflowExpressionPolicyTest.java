package vacademy.io.admin_core_service.features.workflow.spel;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The allow-listed expression context runs the expression shapes the templates, seed workflows
 * and AI drafting rules produce, and refuses class/reflection/process/system access.
 */
class WorkflowExpressionPolicyTest {

    private final SpelEvaluator spel = new SpelEvaluator(new WorkflowDateFunctions());
    private final ListAppender<ILoggingEvent> warnings = new ListAppender<>();
    private Logger policyLogger;
    private Level previousLevel;

    @BeforeEach
    void captureWarnings() {
        warnings.start();
        policyLogger = (Logger) LoggerFactory.getLogger(WorkflowExpressionPolicy.class);
        previousLevel = policyLogger.getLevel();
        policyLogger.setLevel(Level.WARN);
        policyLogger.addAppender(warnings);
    }

    @AfterEach
    void release() {
        policyLogger.detachAppender(warnings);
        policyLogger.setLevel(previousLevel);
    }

    private Map<String, Object> ctx() {
        Map<String, Object> learner = new LinkedHashMap<>();
        learner.put("name", "Asha Verma");
        learner.put("fullName", "Asha Verma");
        learner.put("enrolledDate", Date.from(LocalDate.now(ZoneId.of("Asia/Kolkata"))
                .atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant()));
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("workflowId", "wf-1");
        ctx.put("user", learner);
        ctx.put("item", learner);
        ctx.put("ssigmList", List.of(learner));
        ctx.put("tags", List.of("a", "b", "a"));
        ctx.put("amount", "2.50");
        ctx.put("pojo", new Helper());
        return ctx;
    }

    private Object eval(String expr) {
        return spel.evaluate(expr, ctx(), Map.of("item", ctx().get("item")));
    }

    @Test
    void restrictedByDefault() {
        assertTrue(spel.isRestricted());
    }

    @Test
    void documentedExpressionShapesStillWork() {
        // AI drafting rule: per-day roster filter (ChronoUnit + SimpleDateFormat + LocalDate + ZoneId).
        Object day1 = eval("#ctx['ssigmList'].?[#this['enrolledDate'] != null && "
                + "T(java.time.temporal.ChronoUnit).DAYS.between(T(java.time.LocalDate).parse("
                + "new java.text.SimpleDateFormat('yyyy-MM-dd').format(#this['enrolledDate'])), "
                + "T(java.time.LocalDate).now(T(java.time.ZoneId).of('Asia/Kolkata'))) + 1 == 1]");
        assertEquals(1, ((List<?>) day1).size());
        // Session-creator rule shapes.
        assertNotNull(eval("T(java.time.ZonedDateTime).of(T(java.time.LocalDate).now(T(java.time.ZoneId).of('Asia/Kolkata')), "
                + "T(java.time.LocalTime).of(5,30), T(java.time.ZoneId).of('Asia/Kolkata'))"));
        assertEquals(java.sql.Time.valueOf("05:30:00"), eval("T(java.sql.Time).valueOf('05:30:00')"));
        assertNotNull(eval("T(java.sql.Date).valueOf(T(java.time.LocalDate).now())"));
        // Seed workflow / README shapes.
        assertEquals(List.of("RUN"), eval("T(java.util.Collections).singletonList('RUN')"));
        assertEquals(3, eval("T(java.util.Arrays).asList(1, 2, 3).size()"));
        assertEquals(2, eval("new java.util.HashSet(#ctx['tags']).size()"));
        assertEquals(5, eval("T(java.lang.Math).max(2, 5)"));
        assertEquals("7", eval("T(String).valueOf(7)"));
        assertEquals("a,b", eval("T(java.lang.String).join(',', {'a','b'})"));
        assertEquals(3, eval("T(Integer).parseInt('3')"));
        // Map access styles, string methods, enums and static fields.
        assertEquals("Asha Verma", eval("#ctx['user'].fullName"));
        assertEquals("Asha", eval("#ctx['user']['name'].split(' ')[0]"));
        assertEquals("Ash", eval("#item['name'].substring(0, 3)"));
        assertEquals("MONDAY", eval("T(java.time.DayOfWeek).MONDAY.name()"));
        assertEquals(0L, eval("T(java.time.temporal.ChronoUnit).DAYS.between(T(java.time.LocalDate).now(), T(java.time.LocalDate).now())"));
        assertEquals("2.5", eval("new java.math.BigDecimal(#ctx['amount']).stripTrailingZeros().toPlainString()"));
        assertEquals("3", eval("T(java.math.BigDecimal).valueOf(2.5).setScale(0, T(java.math.RoundingMode).HALF_UP).toPlainString()"));
        assertEquals("YWI=", eval("T(java.util.Base64).getEncoder().encodeToString('ab'.getBytes())"));
        assertEquals("a+b", eval("T(java.net.URLEncoder).encode('a b', 'UTF-8')"));
        assertEquals(true, eval("T(org.springframework.util.StringUtils).hasText('x')"));
        assertNotNull(eval("T(java.time.format.DateTimeFormatter).ofPattern('dd MMM yyyy').format(T(java.time.LocalDate).now())"));
        assertNotNull(eval("T(java.time.LocalDate).now().with(T(java.time.temporal.TemporalAdjusters).previousOrSame(T(java.time.DayOfWeek).MONDAY))"));
        assertEquals(true, eval("#ctx['tags'] instanceof T(java.util.List)"));
        assertNotNull(eval("#dates.nextWeekday('MONDAY', 'Asia/Kolkata', 'do MMMM')"));
        assertEquals(Map.of("k", "Asha Verma"), eval("{'k': #ctx['user']['fullName']}"));
        assertEquals(List.of("Asha Verma"), eval("#ctx['ssigmList'].![#this['fullName']]"));
        assertEquals("x", eval("#ctx['missing']?.toString() ?: 'x'"));
        assertEquals(0, warnings.list.size());
    }

    @Test
    void classReflectionProcessAndSystemAccessIsRefused() {
        List<String> refused = List.of(
                "T(java.lang.Runtime)",
                "T(java.lang.Runtime).getRuntime().exec('id')",
                "T(java.lang.Class).forName('java.lang.Runtime')",
                "''.getClass()",
                "''.class",
                "''.getClass().forName('java.lang.Runtime')",
                "''.class.forName('java.lang.Runtime')",
                "T(java.lang.String).forName('java.lang.Runtime')",
                "T(String).getClassLoader()",
                "T(java.lang.String).class",
                "T(java.lang.String).name",
                "T(java.lang.String).classLoader",
                "T(java.lang.String).getMethods()",
                "T(java.time.DayOfWeek).MONDAY.getDeclaringClass().forName('java.lang.Runtime')",
                "new java.lang.ProcessBuilder('id')",
                "new java.lang.ProcessBuilder({'id'}).start()",
                "T(java.lang.System).getenv()",
                "T(java.lang.System).getProperty('user.home')",
                "T(java.lang.Thread).currentThread()",
                "T(java.lang.invoke.MethodHandles).lookup()",
                "new javax.script.ScriptEngineManager()",
                "T(javax.naming.InitialContext)",
                "new java.io.File('/etc/passwd')",
                "T(java.nio.file.Files).readAllLines(T(java.nio.file.Paths).get('/etc/passwd'))",
                "new java.net.URL('http://example.com').openStream()",
                "#ctx.getClass()",
                "#ctx['user'].getClass().getClassLoader()",
                "#ctx['user'].class",
                "#ctx['pojo']['class']",
                "#ctx['pojo'].class",
                "#ctx['pojo'].getClass()",
                "#root.getClass()",
                "@someBean",
                "new java.lang.String('x')",
                "T(java.util.TimeZone).setDefault(null)",
                "T(java.util.Locale).setDefault(T(java.util.Locale).US)",
                "T(java.lang.Integer).getInteger('java.version')",
                "T(java.time.chrono.HijrahChronology)");
        TimeZone zoneBefore = TimeZone.getDefault();
        for (String expr : refused) {
            assertThrows(SpelEvaluator.SpelEvaluationError.class, () -> eval(expr), expr);
        }
        assertEquals(zoneBefore, TimeZone.getDefault());
        assertFalse(warnings.list.isEmpty(), "refusals are logged");
        for (ILoggingEvent event : warnings.list) {
            assertEquals(Level.WARN, event.getLevel());
            assertTrue(event.getFormattedMessage().contains("workflowId=wf-1"), event.getFormattedMessage());
        }
    }

    @Test
    void helperCallsOnMissingContextKeysFailTheSameWayInBothModes() {
        String expr = "transformNodeHandler.computeRemainingDays(#ctx['ssigm_list'])";
        SpelEvaluator legacy = new SpelEvaluator(new WorkflowDateFunctions());
        legacy.setRestricted(false);
        assertThrows(SpelEvaluator.SpelEvaluationError.class, () -> legacy.evaluate(expr, ctx()));
        assertThrows(SpelEvaluator.SpelEvaluationError.class, () -> spel.evaluate(expr, ctx()));
        // A helper object that IS in the context keeps working (methods on application objects are not restricted).
        Map<String, Object> withHelper = ctx();
        withHelper.put("transformNodeHandler", new Helper());
        withHelper.put("ssigm_list", List.of());
        assertEquals(1, spel.evaluate(expr, withHelper));
        assertEquals(1, legacy.evaluate(expr, withHelper));
    }

    @Test
    void flagOffRestoresThePreviousContext() {
        SpelEvaluator legacy = new SpelEvaluator(new WorkflowDateFunctions());
        legacy.setRestricted(false);
        assertFalse(legacy.isRestricted());
        // Previously allowed, now refused by the allow-list: proves which context ran.
        assertEquals("x", legacy.evaluate("new java.lang.String('x')", ctx()));
        assertThrows(SpelEvaluator.SpelEvaluationError.class, () -> spel.evaluate("new java.lang.String('x')", ctx()));
        // The previous deny-list still applies when the flag is off.
        assertThrows(SpelEvaluator.SpelEvaluationError.class, () -> legacy.evaluate("T(java.lang.Runtime)", ctx()));
    }

    public static class Helper {
        public int computeRemainingDays(Object list) {
            return list == null ? 0 : 1;
        }
    }
}
