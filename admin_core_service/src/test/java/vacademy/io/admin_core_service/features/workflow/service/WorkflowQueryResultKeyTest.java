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
 * A QUERY node never stores its result under its resultKey, so a send node reading
 * #ctx['queryResult'] (or the resultKey) sends nothing while the run reports success. The
 * builder must offer the query's own keys, and the validator must refuse the phantom read.
 */
class WorkflowQueryResultKeyTest {

    private WorkflowValidationService validator;

    @BeforeEach
    void setUp() {
        ObjectMapper om = new ObjectMapper();
        validator = new WorkflowValidationService(om, new IdempotencyStrategyFactory(List.of(), om),
                new TriggerContextKeyRegistry(new WorkflowCatalogController()));
    }

    private static WorkflowBuilderDTO teamEmailWorkflow(String resultKey, String onExpr) {
        Map<String, Object> queryConfig = new HashMap<>();
        queryConfig.put("prebuiltKey", "fetch_institute_admin_emails");
        queryConfig.put("params", Map.of("instituteId", "#ctx['instituteId']"));
        if (resultKey != null) queryConfig.put("resultKey", resultKey);
        queryConfig.put("routing", List.of(Map.of("type", "goto", "targetNodeId", "s1")));
        List<WorkflowBuilderDTO.NodeDTO> nodes = List.of(
                WorkflowBuilderDTO.NodeDTO.builder().id("t1").name("Trigger").nodeType("TRIGGER").isStartNode(true)
                        .config(Map.of("routing", List.of(Map.of("type", "goto", "targetNodeId", "q1")))).build(),
                WorkflowBuilderDTO.NodeDTO.builder().id("q1").name("Fetch admins").nodeType("QUERY")
                        .config(queryConfig).build(),
                WorkflowBuilderDTO.NodeDTO.builder().id("s1").name("Send").nodeType("SEND_EMAIL")
                        .config(Map.of("on", onExpr, "templateName", "New Lead Alert",
                                "routing", List.of(Map.of("type", "end")))).build());
        return WorkflowBuilderDTO.builder()
                .name("wf").workflowType("EVENT_DRIVEN")
                .nodes(nodes)
                .edges(List.of(
                        WorkflowBuilderDTO.EdgeDTO.builder().id("e1").sourceNodeId("t1").targetNodeId("q1").build(),
                        WorkflowBuilderDTO.EdgeDTO.builder().id("e2").sourceNodeId("q1").targetNodeId("s1").build()))
                .trigger(WorkflowBuilderDTO.TriggerDTO.builder()
                        .triggerEventName("AUDIENCE_LEAD_SUBMISSION").eventAppliedType("AUDIENCE").build())
                .build();
    }

    private List<WorkflowValidationService.ValidationError> onErrors(WorkflowBuilderDTO dto) {
        return validator.validate(dto).stream()
                .filter(e -> "config.on".equals(e.getField()) && "ERROR".equals(e.getSeverity()))
                .toList();
    }

    @Test
    void readingQueryResultIsAnErrorNamingTheRealList() {
        var errors = onErrors(teamEmailWorkflow("Send Email", "#ctx['queryResult']"));
        assertEquals(1, errors.size(), () -> "got " + errors);
        assertEquals("s1", errors.get(0).getNodeId());
        assertTrue(errors.get(0).getMessage().contains("adminContacts"), errors.get(0).getMessage());
    }

    @Test
    void readingTheResultKeyIsAnError() {
        assertEquals(1, onErrors(teamEmailWorkflow("admins", "#ctx['admins']")).size());
    }

    @Test
    void readingTheQueryOwnListPasses() {
        assertTrue(onErrors(teamEmailWorkflow("Send Email", "#ctx['adminContacts']")).isEmpty());
        assertTrue(onErrors(teamEmailWorkflow(null, "#ctx['adminContacts']")).isEmpty());
    }

    @Test
    void builderOffersTheQueryOwnKeysNotTheResultKey() {
        ContextSchemaRequestDTO.UpstreamNode q = new ContextSchemaRequestDTO.UpstreamNode();
        q.setNodeId("q1");
        q.setNodeName("Fetch admins");
        q.setNodeType("QUERY");
        q.setConfig(Map.of("prebuiltKey", "fetch_institute_admin_emails", "resultKey", "queryResult"));
        ContextSchemaRequestDTO req = new ContextSchemaRequestDTO();
        req.setUpstreamNodes(List.of(q));

        List<String> exprs = new WorkflowContextSchemaService().getAvailableVariables(req).stream()
                .map(ContextVariableDTO::getSpelExpression).toList();
        assertTrue(exprs.contains("#ctx['adminContacts']"), exprs::toString);
        assertFalse(exprs.contains("#ctx['queryResult']"), exprs::toString);
    }
}
