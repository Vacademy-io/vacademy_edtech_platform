package vacademy.io.admin_core_service.features.workflow.engine;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.spel.WorkflowDateFunctions;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The TRIGGER, QUERY and TRANSFORM node handlers log the keys of the workflow context, never its
 * values (a context can carry a person's phone, e-mail and a link meant for them), and do exactly
 * what they did before: the same outputs for the same context and config. The execution log
 * redacts an order link the same way it redacts a token.
 */
class WorkflowNodeHandlerLogKeysTest {

    private static final String PHONE = "919876543210";
    private static final String EMAIL = "asha.verma@example.com";
    private static final String NAME = "Asha Verma";
    private static final String LINK = "https://shop.example.com/order#l=l1.cGF5bG9hZA.c2lnbmF0dXJl";

    private final ObjectMapper json = new ObjectMapper();
    private final SpelEvaluator spel = new SpelEvaluator(mock(WorkflowDateFunctions.class));
    private final WorkflowExecutionLogger executionLogger = mock(WorkflowExecutionLogger.class);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private final List<Logger> loggers = new ArrayList<>();
    private final List<Level> levels = new ArrayList<>();

    @BeforeEach
    void capture() {
        appender.start();
        for (Class<?> type : List.of(TriggerNodeHandler.class, QueryNodeHandler.class, TransformNodeHandler.class,
                SpelEvaluator.class)) {
            Logger logger = (Logger) LoggerFactory.getLogger(type);
            loggers.add(logger);
            levels.add(logger.getLevel());
            logger.setLevel(Level.ALL);
            logger.addAppender(appender);
        }
    }

    @AfterEach
    void release() {
        for (int i = 0; i < loggers.size(); i++) {
            loggers.get(i).detachAppender(appender);
            loggers.get(i).setLevel(levels.get(i));
        }
    }

    private static Map<String, Object> context() {
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("instituteId", "inst-1");
        ctx.put("orderId", "order-1");
        ctx.put("customerName", NAME);
        ctx.put("customerPhone", PHONE);
        ctx.put("customerEmail", EMAIL);
        ctx.put("orderLink", LINK);
        return ctx;
    }

    private void assertNoValueLogged() {
        assertFalse(appender.list.isEmpty(), "the handlers still log");
        for (ILoggingEvent e : appender.list) {
            String line = e.getFormattedMessage();
            for (String value : List.of(PHONE, EMAIL, NAME, LINK, "l1.cGF5bG9hZA")) {
                assertFalse(line.contains(value), "logged a value: " + line);
            }
        }
    }

    @Test
    void theTriggerNodeLogsKeysAndComputesTheSameOutputs() {
        TriggerNodeHandler handler = new TriggerNodeHandler(spel, executionLogger);
        String config = "{\"outputDataPoints\":["
                + "{\"fieldName\":\"to\",\"compute\":\"#ctx['customerPhone']\"},"
                + "{\"fieldName\":\"mail\",\"compute\":\"#ctx['customerEmail']\"},"
                + "{\"fieldName\":\"kind\",\"value\":\"order\"}]}";

        Map<String, Object> changes = handler.handle(context(), config, Map.of(), 0);

        assertEquals(Map.of("to", PHONE, "mail", EMAIL, "kind", "order"), changes);
        assertNoValueLogged();
        assertTrue(appender.list.stream().anyMatch(e -> e.getFormattedMessage().contains("customerPhone")),
                "the keys are logged");
        verifyNoInteractions(executionLogger);
    }

    @Test
    void theQueryNodeLogsKeysAndRunsTheSameQueryWithTheSameParams() {
        QueryNodeHandler.QueryService queries = mock(QueryNodeHandler.QueryService.class);
        Map<String, Object> answer = new HashMap<>();
        answer.put("leadPhone", PHONE);
        answer.put("rows", 1);
        when(queries.execute(eq("lookupByPhone"), anyMap())).thenReturn(answer);
        QueryNodeHandler handler = new QueryNodeHandler(json, spel, queries, executionLogger);
        String config = "{\"prebuiltKey\":\"lookupByPhone\",\"params\":{\"phone\":\"#ctx['customerPhone']\","
                + "\"link\":\"#ctx['orderLink']\",\"status\":\"ACTIVE\"}}";

        Map<String, Object> changes = handler.handle(context(), config, Map.of(), 0);

        assertEquals(answer, changes);
        verify(queries).execute("lookupByPhone", Map.of("phone", PHONE, "link", LINK, "status", "ACTIVE",
                "instituteId", "inst-1"));
        assertNoValueLogged();
    }

    @Test
    void aDryRunStillSkipsAMutatingQueryAndLogsOnlyTheParamKeys() {
        QueryNodeHandler.QueryService queries = mock(QueryNodeHandler.QueryService.class);
        QueryNodeHandler handler = new QueryNodeHandler(json, spel, queries, executionLogger);
        String mutating = "upsertUserCustomField";
        assertTrue(MutatingQueryKeys.isMutating(mutating));
        Map<String, Object> ctx = context();
        ctx.put("dryRun", true);
        String config = "{\"prebuiltKey\":\"" + mutating + "\",\"params\":{\"phone\":\"#ctx['customerPhone']\"}}";

        Map<String, Object> changes = handler.handle(ctx, config, Map.of(), 0);

        assertEquals(Map.of("dryRun", true, "skippedMutatingQuery", mutating), changes);
        verifyNoInteractions(queries);
        assertNoValueLogged();
    }

    @Test
    void theTransformNodeLogsKeysAndTransformsTheSame() {
        TransformNodeHandler handler = new TransformNodeHandler(json, spel, executionLogger);
        String config = "{\"outputDataPoints\":["
                + "{\"fieldName\":\"greeting\",\"compute\":\"'Hello ' + #ctx['customerName']\"},"
                + "{\"fieldName\":\"customerPhone\",\"compute\":\"#ctx['customerPhone']\"}]}";

        Map<String, Object> changes = handler.handle(context(), config, Map.of(), 0);

        // An unchanged value is not a change; a new key is.
        assertEquals(Map.of("greeting", "Hello " + NAME), changes);
        assertNoValueLogged();
    }

    @Test
    void theExecutionLogRedactsAnOrderLinkAndKeepsTheRestAsBefore() {
        WorkflowExecutionLogger real = new WorkflowExecutionLogger(null, null, json);
        Map<String, Object> sanitized = real.sanitizeContext(context());
        assertEquals("[REDACTED]", sanitized.get("orderLink"));
        assertEquals("inst-1", sanitized.get("instituteId"));
        assertEquals("order-1", sanitized.get("orderId"));
        assertEquals(NAME, sanitized.get("customerName"));
        assertEquals(PHONE, sanitized.get("customerPhone"));
        assertEquals(EMAIL, sanitized.get("customerEmail"));
        // The keys it redacted before are still redacted.
        assertEquals("[REDACTED]", real.sanitizeContext(Map.of("accessToken", "x")).get("accessToken"));
        assertEquals("[REDACTED]", real.sanitizeContext(Map.of("otp", "1234")).get("otp"));
    }

}
