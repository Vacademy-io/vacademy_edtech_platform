package vacademy.io.admin_core_service.features.workflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowCatalogController;
import vacademy.io.admin_core_service.features.workflow.dto.ContextSchemaRequestDTO;
import vacademy.io.admin_core_service.features.workflow.dto.ContextVariableDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowBuilderDTO;
import vacademy.io.admin_core_service.features.workflow.service.idempotency.IdempotencyStrategyFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A send node behind a DELAY used to be offered only the system ids as recipients, and a
 * welcome email was saved with on = #ctx['workflowId'], which can never reach anyone. The
 * builder must offer the triggering person instead, and the validator must refuse the id.
 */
class WorkflowSendRecipientTest {

    private WorkflowValidationService validator;
    private WorkflowContextSchemaService schema;

    @BeforeEach
    void setUp() {
        ObjectMapper om = new ObjectMapper();
        TriggerContextKeyRegistry registry = new TriggerContextKeyRegistry(new WorkflowCatalogController());
        validator = new WorkflowValidationService(om, new IdempotencyStrategyFactory(List.of(), om), registry);
        schema = new WorkflowContextSchemaService(registry);
    }

    /** trigger -> 5 min delay -> send email, the shape of the broken VetEd workflow. */
    private static WorkflowBuilderDTO delayedWelcome(String onExpr, String forEachEval) {
        Map<String, Object> sendConfig = new HashMap<>();
        sendConfig.put("on", onExpr);
        sendConfig.put("templateName", "Welcome");
        sendConfig.put("recipientField", "email");
        sendConfig.put("forEach", Map.of("operation", "SEND_EMAIL", "eval", forEachEval));
        sendConfig.put("routing", List.of(Map.of("type", "end")));
        List<WorkflowBuilderDTO.NodeDTO> nodes = List.of(
                WorkflowBuilderDTO.NodeDTO.builder().id("t1").name("Trigger").nodeType("TRIGGER").isStartNode(true)
                        .config(Map.of("triggerEvent", "LEARNER_BATCH_ENROLLMENT",
                                "routing", List.of(Map.of("type", "goto", "targetNodeId", "d1")))).build(),
                WorkflowBuilderDTO.NodeDTO.builder().id("d1").name("Wait").nodeType("DELAY")
                        .config(Map.of("delay", Map.of("value", 5, "unit", "MINUTES"),
                                "routing", List.of(Map.of("type", "goto", "targetNodeId", "s1")))).build(),
                WorkflowBuilderDTO.NodeDTO.builder().id("s1").name("Send").nodeType("SEND_EMAIL")
                        .config(sendConfig).build());
        return WorkflowBuilderDTO.builder()
                .name("wf").workflowType("EVENT_DRIVEN")
                .nodes(nodes)
                .edges(List.of(
                        WorkflowBuilderDTO.EdgeDTO.builder().id("e1").sourceNodeId("t1").targetNodeId("d1").build(),
                        WorkflowBuilderDTO.EdgeDTO.builder().id("e2").sourceNodeId("d1").targetNodeId("s1").build()))
                .trigger(WorkflowBuilderDTO.TriggerDTO.builder()
                        .triggerEventName("LEARNER_BATCH_ENROLLMENT").eventAppliedType("PACKAGE_SESSION").build())
                .build();
    }

    private List<WorkflowValidationService.ValidationError> onErrors(WorkflowBuilderDTO dto) {
        return validator.validate(dto).stream()
                .filter(e -> "config.on".equals(e.getField()) && "ERROR".equals(e.getSeverity()))
                .toList();
    }

    @Test
    void sendingToTheWorkflowIdIsAnError() {
        var errors = onErrors(delayedWelcome("#ctx['workflowId']", "#ctx['item']"));
        assertEquals(1, errors.size(), () -> "got " + errors);
        assertEquals("s1", errors.get(0).getNodeId());
        assertTrue(errors.get(0).getMessage().contains("{#ctx['user']}"), errors.get(0).getMessage());
    }

    @Test
    void otherEngineIdsAreErrorsToo() {
        assertEquals(1, onErrors(delayedWelcome("{#ctx['executionId']}", "#ctx['item']")).size());
        assertEquals(1, onErrors(delayedWelcome("#ctx['instituteId']", "#ctx[\"item\"]")).size());
    }

    @Test
    void sendingToTheTriggeringLearnerPasses() {
        assertTrue(onErrors(delayedWelcome("{#ctx['user']}", "#ctx['item']")).isEmpty());
    }

    @Test
    void aCustomForEachThatBuildsItsOwnRequestIsLeftAlone() {
        assertTrue(onErrors(delayedWelcome("{#ctx['instituteId']}",
                "{'to': 'office@example.com', 'subject': 'Daily digest'}")).isEmpty());
    }

    private List<ContextVariableDTO> triggerVars(String event) {
        ContextSchemaRequestDTO.UpstreamNode t = new ContextSchemaRequestDTO.UpstreamNode();
        t.setNodeId("t1");
        t.setNodeName("Trigger");
        t.setNodeType("TRIGGER");
        Map<String, Object> config = new HashMap<>();
        config.put("triggerEvent", event);
        t.setConfig(config);
        ContextSchemaRequestDTO req = new ContextSchemaRequestDTO();
        req.setUpstreamNodes(List.of(t));
        return schema.getAvailableVariables(req);
    }

    @Test
    void builderOffersTheEnrolledLearnerAsRecipients() {
        List<ContextVariableDTO> recipients = triggerVars("LEARNER_BATCH_ENROLLMENT").stream()
                .filter(v -> WorkflowContextSchemaService.RECIPIENTS_TYPE.equals(v.getType()))
                .toList();
        assertEquals(1, recipients.size(), recipients::toString);
        assertEquals("{#ctx['user']}", recipients.get(0).getSpelExpression());
    }

    @Test
    void builderOffersNoPersonForAnEventWithoutOne() {
        assertTrue(triggerVars("REVIEW_SUBMITTED").stream()
                .noneMatch(v -> WorkflowContextSchemaService.RECIPIENTS_TYPE.equals(v.getType())));
    }

    @Test
    void builderOffersNothingExtraForAnUncataloguedEvent() {
        List<ContextVariableDTO> vars = triggerVars("SOME_FUTURE_EVENT");
        assertTrue(vars.stream().allMatch(v -> "SYSTEM".equals(v.getSourceNodeType())
                || "triggerData".equals(v.getKey()) || "triggerEventName".equals(v.getKey())), vars::toString);
    }
}
