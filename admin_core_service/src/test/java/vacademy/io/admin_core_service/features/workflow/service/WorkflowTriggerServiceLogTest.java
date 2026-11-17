package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.commerce.notify.LogCapture;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.admin_core_service.features.workflow.service.idempotency.IdempotencyStrategyFactory;
import vacademy.io.admin_core_service.features.workflow.util.WorkflowSubjectResolver;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The two INFO lines of a trigger event that used to print the whole context ("Context data
 * received" and "Seed context prepared") print its keys only, so a context holding a phone
 * number, an e-mail address or a name never reaches the logs.
 */
class WorkflowTriggerServiceLogTest {

    static final String PHONE = "919876543210";
    static final String EMAIL = "asha.verma@example.com";
    static final String NAME = "Asha Verma";

    /** The engine with one global trigger of the event that runs. */
    static final class Engine {
        final WorkflowTriggerService service = new WorkflowTriggerService();
        final WorkflowTriggerRepository repository = mock(WorkflowTriggerRepository.class);
        final IdempotencyService idempotency = mock(IdempotencyService.class);
        final WorkflowEngineService runner = mock(WorkflowEngineService.class);
        final IdempotencyStrategyFactory keys = mock(IdempotencyStrategyFactory.class);
        final WorkflowTrigger trigger = new WorkflowTrigger();

        Engine(String eventName) {
            Workflow workflow = new Workflow();
            workflow.setId("wf-1");
            trigger.setId("tr-1");
            trigger.setWorkflow(workflow);
            trigger.setTriggerEventName(eventName);
            when(repository.findSpecificTriggers(anyString(), anyString(), anyString(), anyList()))
                    .thenReturn(List.of());
            when(repository.findGlobalTriggers(anyString(), anyString(), anyList())).thenReturn(List.of(trigger));
            when(keys.generateKey(any(), anyString(), any(), anyMap())).thenReturn("key-1");
            WorkflowExecution execution = new WorkflowExecution();
            execution.setId("ex-1");
            when(idempotency.markAsProcessingForTrigger(anyString(), anyString(), anyString())).thenReturn(execution);
            when(runner.run(anyString(), anyMap())).thenReturn(Map.of("done", true));
            ReflectionTestUtils.setField(service, "workflowTriggerRepository", repository);
            ReflectionTestUtils.setField(service, "idempotencyStrategyFactory", keys);
            ReflectionTestUtils.setField(service, "idempotencyService", idempotency);
            ReflectionTestUtils.setField(service, "workflowEngineService", runner);
            ReflectionTestUtils.setField(service, "workflowSubjectResolver", mock(WorkflowSubjectResolver.class));
        }
    }

    private Engine engine;
    private Map<String, Object> context;

    @BeforeEach
    void setUp() {
        engine = new Engine("ORDER_SHIPPED");
        context = new LinkedHashMap<>();
        context.put("customerPhone", PHONE);
        context.put("customerEmail", EMAIL);
        context.put("customerName", NAME);
        context.put("orderLink", "https://shop.example.com/order#l=l1.cGF5bG9hZA.c2ln");
    }

    @Test
    void theContextLineAndTheSeedLinePrintKeysOnly() {
        try (LogCapture logs = LogCapture.of(LogCapture.WORKFLOW)) {
            Map<String, Object> result = engine.service.handleTriggerEvents("ORDER_SHIPPED", "order-1", "inst-1",
                    context);
            assertEquals(Map.of("done", true), result, "the workflow still ran");

            List<String> messages = logs.messages();
            assertTrue(messages.contains("Context data received (4 keys): [customerPhone, customerEmail, "
                    + "customerName, orderLink]"), messages.toString());
            String seed = messages.stream().filter(m -> m.startsWith("Seed context prepared for workflow run ("))
                    .findFirst().orElseThrow(() -> new AssertionError(messages.toString()));
            for (String key : List.of("customerPhone", "customerEmail", "customerName", "orderLink", "triggerEvents",
                    "instituteId", "executionId", "eventId", "triggerTime")) {
                assertTrue(seed.contains(key), seed);
            }
            assertFalse(seed.contains("="), "keys, not key=value pairs: " + seed);
            for (String text : logs.everything()) {
                assertFalse(text.contains("98765") || text.contains(EMAIL) || text.contains(NAME)
                        || text.contains("https://") || text.contains("l1."), text);
            }
        }
    }

    @Test
    void anEmptyContextStillSaysSo() {
        try (LogCapture logs = LogCapture.of(LogCapture.WORKFLOW)) {
            engine.service.handleTriggerEvents("ORDER_SHIPPED", "order-1", "inst-1", Map.of());
            assertTrue(logs.messages().contains("Context data is EMPTY or NULL"));
        }
    }
}
