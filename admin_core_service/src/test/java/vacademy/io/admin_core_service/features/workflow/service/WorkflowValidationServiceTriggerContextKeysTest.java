package vacademy.io.admin_core_service.features.workflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowCatalogController;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowBuilderDTO;
import vacademy.io.admin_core_service.features.workflow.service.idempotency.IdempotencyStrategyFactory;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Guards the 2026-09-11 failure: the AI drafter emitted {@code #ctx['lead']} for an
 * AUDIENCE_LEAD_SUBMISSION workflow (idempotency expression + SEND_WHATSAPP 'on'), the key
 * generator threw, and the trigger was skipped with no execution row.
 */
class WorkflowValidationServiceTriggerContextKeysTest {

    private WorkflowValidationService service;

    @BeforeEach
    void setUp() {
        ObjectMapper om = new ObjectMapper();
        service = new WorkflowValidationService(
                om,
                new IdempotencyStrategyFactory(List.of(), om),
                new TriggerContextKeyRegistry(new WorkflowCatalogController()));
    }

    private static WorkflowBuilderDTO eventWorkflow(String event, String idempotencyExpr, String onExpr) {
        WorkflowBuilderDTO.NodeDTO trigger = WorkflowBuilderDTO.NodeDTO.builder()
                .id("t1").name("Trigger").nodeType("TRIGGER").isStartNode(true)
                .config(Map.of("routing", List.of(Map.of("type", "goto", "targetNodeId", "s1"))))
                .build();
        WorkflowBuilderDTO.NodeDTO send = WorkflowBuilderDTO.NodeDTO.builder()
                .id("s1").name("Send").nodeType("SEND_WHATSAPP").isStartNode(false)
                .config(Map.of("on", onExpr, "templateName", "yoga_leads",
                        "routing", List.of(Map.of("type", "end"))))
                .build();
        WorkflowBuilderDTO.EdgeDTO edge = WorkflowBuilderDTO.EdgeDTO.builder()
                .id("e1").sourceNodeId("t1").targetNodeId("s1").build();
        WorkflowBuilderDTO.TriggerDTO triggerDTO = WorkflowBuilderDTO.TriggerDTO.builder()
                .triggerEventName(event)
                .eventAppliedType("AUDIENCE")
                .idempotencyGenerationSetting(idempotencyExpr == null ? null
                        : Map.of("strategy", "CUSTOM_EXPRESSION", "customExpression", idempotencyExpr))
                .build();
        return WorkflowBuilderDTO.builder()
                .name("wf").workflowType("EVENT_DRIVEN")
                .nodes(List.of(trigger, send)).edges(List.of(edge))
                .trigger(triggerDTO)
                .build();
    }

    @Test
    @DisplayName("#ctx['lead'] in the idempotency expression is an ERROR naming the real keys")
    void unknownIdempotencyKeyIsError() {
        var errors = service.validate(eventWorkflow("AUDIENCE_LEAD_SUBMISSION",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['lead']['id']", "{#ctx['user']}"));

        var idem = errors.stream()
                .filter(e -> "trigger.idempotency_generation_setting".equals(e.getField()))
                .toList();
        assertEquals(1, idem.size(), () -> "expected one idempotency error, got " + errors);
        assertEquals("ERROR", idem.get(0).getSeverity());
        assertTrue(idem.get(0).getMessage().contains("[lead]"), idem.get(0).getMessage());
        assertTrue(idem.get(0).getMessage().contains("responseId"), idem.get(0).getMessage());
        assertTrue(idem.get(0).getMessage().contains("user"), idem.get(0).getMessage());
    }

    @Test
    @DisplayName("'on' = {#ctx['lead']} with no producing node upstream is a WARNING on the node")
    void unknownOnKeyIsWarning() {
        var errors = service.validate(eventWorkflow("AUDIENCE_LEAD_SUBMISSION",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['responseId']", "{#ctx['lead']}"));

        var on = errors.stream().filter(e -> "config.on".equals(e.getField())).toList();
        assertEquals(1, on.size(), () -> "expected one 'on' warning, got " + errors);
        assertEquals("WARNING", on.get(0).getSeverity());
        assertEquals("s1", on.get(0).getNodeId());
        assertTrue(errors.stream().noneMatch(e -> "trigger.idempotency_generation_setting".equals(e.getField())));
    }

    @Test
    @DisplayName("Keys the event really emits (user, responseId, triggerId) pass clean")
    void knownKeysPass() {
        var errors = service.validate(eventWorkflow("AUDIENCE_LEAD_SUBMISSION",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['user']['id']", "{#ctx['user']}"));
        assertTrue(errors.isEmpty(), () -> "expected no errors, got " + errors);
    }

    @Test
    @DisplayName("PAYMENT_FAILED main path has no 'user' — #ctx['user']['id'] idempotency is flagged")
    void paymentFailedUserKeyIsFlaggedButUserIdPasses() {
        // 'user' IS in the union (renewal emitter sets it) so it passes the closed-list check; the
        // catalog note steers the drafter to userId. What must be flagged is a wholly absent key.
        var flagged = service.validate(eventWorkflow("PAYMENT_FAILED",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['student']['id']", "{#ctx['user']}"));
        assertTrue(flagged.stream().anyMatch(e -> "ERROR".equals(e.getSeverity())
                && e.getMessage().contains("[student]")), flagged::toString);

        var ok = service.validate(eventWorkflow("PAYMENT_FAILED",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['userId']", "{#ctx['user']}"));
        assertTrue(ok.stream().noneMatch(e -> "trigger.idempotency_generation_setting".equals(e.getField())), ok::toString);
    }

    @Test
    @DisplayName("An event the registry does not know is never validated (no false errors)")
    void unknownEventIsSkipped() {
        var errors = service.validate(eventWorkflow("COURSE_CREATED",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['whatever']['id']", "{#ctx['whatever']}"));
        assertTrue(errors.isEmpty(), () -> "expected no errors for an uncatalogued event, got " + errors);
    }

    @Test
    @DisplayName("Lead-SLA events resolve their keys from the admin catalog (leadId known, lead unknown)")
    void leadEventsUseCatalogKeys() {
        var ok = service.validate(eventWorkflow("LEAD_ASSIGNED_TO_COUNSELOR",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['leadId']", "{#ctx['leadMobile']}"));
        assertTrue(ok.stream().noneMatch(e -> "ERROR".equals(e.getSeverity())), ok::toString);

        var bad = service.validate(eventWorkflow("LEAD_ASSIGNED_TO_COUNSELOR",
                "'wf_' + #ctx['triggerId'] + '_' + #ctx['lead']['id']", "{#ctx['leadMobile']}"));
        assertTrue(bad.stream().anyMatch(e -> "ERROR".equals(e.getSeverity())), bad::toString);
    }
}
