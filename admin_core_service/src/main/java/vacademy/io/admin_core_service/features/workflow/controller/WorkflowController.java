package vacademy.io.admin_core_service.features.workflow.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.workflow.dto.*;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.admin_core_service.features.workflow.service.AsyncWorkflowExecutor;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowBuilderService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowContextSchemaService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowScheduleQueryService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowValidationService;
import vacademy.io.common.auth.config.PageConstants;

import java.time.Instant;
import java.util.*;

import static vacademy.io.common.auth.config.PageConstants.DEFAULT_PAGE_NUMBER;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/workflow")
@RequiredArgsConstructor
public class WorkflowController {

    private final WorkflowService workflowService;
    private final WorkflowScheduleQueryService workflowScheduleQueryService;
    private final WorkflowBuilderService workflowBuilderService;
    private final WorkflowValidationService workflowValidationService;
    private final WorkflowEngineService workflowEngineService;
    private final WorkflowTemplateRepository workflowTemplateRepository;
    private final WorkflowTriggerRepository workflowTriggerRepository;
    private final AsyncWorkflowExecutor asyncWorkflowExecutor;
    private final WorkflowContextSchemaService workflowContextSchemaService;
    private final ObjectMapper objectMapper;

    @GetMapping("/institute/{instituteId}")
    public ResponseEntity<List<WorkflowResponseDTO>> getActiveWorkflowsByInstituteId(
            @PathVariable String instituteId) {

        List<WorkflowResponseDTO> workflows = workflowService.getActiveWorkflowsByInstituteId(instituteId);
        return ResponseEntity.ok(workflows);
    }

    @PostMapping("/schedule/list")
    public ResponseEntity<PagedWorkflowScheduleResponseDTO> getWorkflowSchedules(
            @RequestBody WorkflowScheduleFilterDTO filter,
            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize) {

        log.info("Getting workflow schedules for instituteId: {}, workflowIds: {}, statuses: {}, page: {}, size: {}",
                filter.getInstituteId(), filter.getWorkflowIds(), filter.getStatuses(), pageNo, pageSize);

        PagedWorkflowScheduleResponseDTO response = workflowScheduleQueryService.getWorkflowSchedules(filter, pageNo,
                pageSize);

        log.info("Retrieved {} workflow schedules out of {} total",
                response.getContent().size(), response.getTotalElements());

        return ResponseEntity.ok(response);
    }

    @PostMapping("/institute/workflows-with-schedules/list")
    public ResponseEntity<PagedWorkflowsResponseDTO> getWorkflowsWithSchedules(
        @RequestBody WorkflowWithSchedulesFilterDTO filter,
        @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
        @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize) {

        PagedWorkflowsResponseDTO response = workflowService.getWorkflowsWithSchedulesPaged(filter, pageNo,
            pageSize);
        return ResponseEntity.ok(response);
    }

    @PostMapping
    @Auditable(
            entityType = "AUTOMATION",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            // A builder payload is the whole node graph — big, and re-readable
            // from the workflow itself. The name is what an audit row needs.
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'created automation ' + (#dto?.name ?: '')")
    public ResponseEntity<WorkflowBuilderDTO> createWorkflow(
            @RequestBody WorkflowBuilderDTO dto,
            @RequestParam(value = "userId") String userId) {

        log.info("Creating workflow '{}' for institute: {} by user: {}", dto.getName(), dto.getInstituteId(), userId);
        WorkflowBuilderDTO result = workflowBuilderService.createWorkflow(dto, userId);
        log.info("Created workflow with id: {}", result.getId());
        return ResponseEntity.ok(result);
    }

    /**
     * Update an existing workflow IN PLACE (reuses the same workflow id — not a clone). The old
     * flow re-POSTed to {@code POST /workflow}, which always inserted a brand-new workflow and left
     * the original behind. Use this when saving edits from the visual builder.
     */
    @PutMapping("/{workflowId}")
    @Auditable(
            entityType = "AUTOMATION",
            action = "UPDATE",
            entityIdExpr = "#workflowId",
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'updated automation ' + (#dto?.name ?: #workflowId)")
    public ResponseEntity<WorkflowBuilderDTO> updateWorkflow(
            @PathVariable String workflowId,
            @RequestBody WorkflowBuilderDTO dto,
            @RequestParam(value = "userId") String userId) {

        log.info("Updating workflow '{}' ({}) by user: {}", dto.getName(), workflowId, userId);
        WorkflowBuilderDTO result = workflowBuilderService.updateWorkflow(workflowId, dto, userId);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/{workflowId}/edit")
    public ResponseEntity<WorkflowBuilderDTO> getWorkflowForEditing(
            @PathVariable String workflowId) {

        log.info("Fetching workflow for editing: {}", workflowId);
        WorkflowBuilderDTO result = workflowBuilderService.getWorkflowForEditing(workflowId);
        return ResponseEntity.ok(result);
    }

    @DeleteMapping("/{workflowId}")
    @Auditable(
            entityType = "AUTOMATION",
            action = "DELETE",
            entityIdExpr = "#workflowId",
            descriptionExpr = "'deleted an automation'")
    public ResponseEntity<Void> deleteWorkflow(
            @PathVariable String workflowId) {

        log.info("Soft-deleting workflow: {}", workflowId);
        workflowBuilderService.deleteWorkflow(workflowId);
        return ResponseEntity.noContent().build();
    }

    // =================== In-place node-config editor (workflow detail page) ===================

    /**
     * Loss-less view of a workflow's nodes for the in-place "Configuration" editor on the detail
     * page. Returns each node template's raw {@code config_json} (routing intact) plus its name,
     * type, status, version, retry config, order, and start/end flags. Unlike {@code /edit}, this
     * does NOT strip routing or reconstruct edges, so complex workflows round-trip safely.
     */
    @GetMapping("/{workflowId}/raw")
    public ResponseEntity<WorkflowRawDTO> getWorkflowRaw(
            @PathVariable String workflowId) {

        log.info("Fetching raw workflow config: {}", workflowId);
        return ResponseEntity.ok(workflowBuilderService.getWorkflowRaw(workflowId));
    }

    /**
     * In-place partial update of one node template within a workflow. Only non-null fields on the
     * body are applied. {@code config_json}/{@code retry_config} are validated as JSON objects and
     * {@code node_type} against the {@code NodeType} enum, so a bad edit returns 400 instead of
     * persisting an unrunnable node. The running workflow picks up the change on its next execution.
     */
    @PutMapping("/{workflowId}/node-template/{nodeTemplateId}")
    public ResponseEntity<WorkflowRawDTO.RawNodeDTO> updateNodeTemplate(
            @PathVariable String workflowId,
            @PathVariable String nodeTemplateId,
            @RequestBody NodeTemplateUpdateDTO dto) {

        log.info("Updating node template {} of workflow {}", nodeTemplateId, workflowId);
        return ResponseEntity.ok(
                workflowBuilderService.updateNodeTemplate(workflowId, nodeTemplateId, dto));
    }

    @PostMapping("/validate")
    public ResponseEntity<List<WorkflowValidationService.ValidationError>> validateWorkflow(
            @RequestBody WorkflowBuilderDTO dto) {

        log.info("Validating workflow: {}", dto.getName());
        List<WorkflowValidationService.ValidationError> errors = workflowValidationService.validate(dto);
        return ResponseEntity.ok(errors);
    }

    // =================== Test-Run Endpoint ===================

    @PostMapping("/{workflowId}/test-run")
    public ResponseEntity<Map<String, Object>> testRunWorkflow(
            @PathVariable String workflowId,
            @RequestBody(required = false) Map<String, Object> sampleContext) {

        log.info("Test-running workflow: {} with dry-run mode", workflowId);
        Map<String, Object> ctx = sampleContext != null ? new HashMap<>(sampleContext) : new HashMap<>();
        ctx.put("dryRun", true);

        Map<String, Object> result = workflowEngineService.run(workflowId, ctx);
        return ResponseEntity.ok(result);
    }

    // =================== Manual "Run Now" Endpoint ===================

    /**
     * Trigger a workflow on demand in PRODUCTION mode (real emails go out).
     * Use this to fire a scheduled workflow without waiting for its next
     * scheduled run, or to re-fire an event-driven workflow with a custom
     * context payload.
     *
     * Differences from {@code /test-run}:
     *  - Does NOT set {@code dryRun=true} → SendEmail and other handlers
     *    perform their real side effects (emails sent, records updated, etc).
     *  - Adds {@code triggeredManually=true} and {@code executionTime} to
     *    the context for visibility in logs and downstream handlers.
     *
     * The optional request body becomes the seed context. For scheduled
     * workflows you can pass anything the QUERY nodes expect (e.g.
     * {@code daysAgo}, {@code audienceId}) — same shape as the schedule's
     * {@code initialContext}.
     */
    @PostMapping("/{workflowId}/trigger-now")
    @Auditable(
            entityType = "AUTOMATION",
            action = "TRIGGER",
            entityIdExpr = "#workflowId",
            descriptionExpr = "'manually ran an automation'")
    public ResponseEntity<Map<String, Object>> triggerWorkflowNow(
            @PathVariable String workflowId,
            @RequestBody(required = false) Map<String, Object> sampleContext) {

        log.info("Manually triggering workflow (production mode, real emails): {}", workflowId);
        Map<String, Object> ctx = sampleContext != null ? new HashMap<>(sampleContext) : new HashMap<>();
        // Defensive: even if a caller passed dryRun=true, strip it — the whole
        // point of this endpoint is to actually send.
        ctx.remove("dryRun");
        ctx.putIfAbsent("triggeredManually", true);
        ctx.putIfAbsent("executionTime", Instant.now().toEpochMilli());

        Map<String, Object> result = workflowEngineService.run(workflowId, ctx);
        return ResponseEntity.ok(result);
    }

    // =================== Template Endpoints ===================

    @GetMapping("/templates")
    public ResponseEntity<List<WorkflowTemplate>> listTemplates(
            @RequestParam(value = "instituteId", required = false) String instituteId) {

        log.info("Listing workflow templates for instituteId: {}", instituteId);

        // Always include system templates
        List<WorkflowTemplate> templates = new ArrayList<>(
                workflowTemplateRepository.findByStatusAndIsSystemTrue("ACTIVE"));

        // Also include institute-specific templates if instituteId is provided
        if (instituteId != null && !instituteId.isBlank()) {
            List<WorkflowTemplate> instituteTemplates =
                    workflowTemplateRepository.findByStatusAndInstituteId("ACTIVE", instituteId);
            templates.addAll(instituteTemplates);
        }

        return ResponseEntity.ok(templates);
    }

    @PostMapping("/templates/apply")
    public ResponseEntity<WorkflowBuilderDTO> applyTemplate(
            @RequestParam(value = "templateId") String templateId,
            @RequestParam(value = "instituteId") String instituteId,
            @RequestParam(value = "userId") String userId,
            @RequestParam(value = "workflowName", required = false) String workflowName) {

        log.info("Applying template {} for institute {} by user {}", templateId, instituteId, userId);

        WorkflowTemplate template = workflowTemplateRepository.findById(UUID.fromString(templateId))
                .orElseThrow(() -> new RuntimeException("Template not found: " + templateId));

        try {
            // Parse template_json into WorkflowBuilderDTO
            WorkflowBuilderDTO dto = objectMapper.readValue(template.getTemplateJson(), WorkflowBuilderDTO.class);

            // Override with caller-provided values
            dto.setInstituteId(instituteId);
            dto.setName(workflowName != null && !workflowName.isBlank() ? workflowName : template.getName());
            dto.setDescription(template.getDescription());
            dto.setStatus("DRAFT");

            // Create the workflow via the builder service
            WorkflowBuilderDTO result = workflowBuilderService.createWorkflow(dto, userId);
            log.info("Created workflow {} from template {}", result.getId(), templateId);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Failed to apply template {}: {}", templateId, e.getMessage(), e);
            throw new RuntimeException("Failed to apply workflow template: " + e.getMessage(), e);
        }
    }

    // =================== Context Schema Endpoint ===================

    @PostMapping("/context-schema")
    public ResponseEntity<List<ContextVariableDTO>> getContextSchema(
            @RequestBody ContextSchemaRequestDTO request) {

        log.info("Getting context schema for target node: {}", request.getTargetNodeId());
        List<ContextVariableDTO> variables = workflowContextSchemaService.getAvailableVariables(request);
        return ResponseEntity.ok(variables);
    }

    // =================== Webhook Endpoint ===================

    @PostMapping("/webhook/{webhookSlug}")
    public ResponseEntity<Map<String, Object>> handleWebhook(
            @PathVariable String webhookSlug,
            @RequestHeader(value = "X-Webhook-Secret", required = false) String secret,
            @RequestBody(required = false) Map<String, Object> payload) {

        log.info("Webhook received for slug: {}", webhookSlug);

        // Find trigger by webhook slug
        WorkflowTrigger trigger = workflowTriggerRepository
                .findByWebhookUrlSlugAndStatus(webhookSlug, "ACTIVE");

        if (trigger == null) {
            return ResponseEntity.notFound().build();
        }

        // Validate secret
        if (trigger.getWebhookSecret() != null && !trigger.getWebhookSecret().isBlank()) {
            if (secret == null || !secret.equals(trigger.getWebhookSecret())) {
                return ResponseEntity.status(403).body(Map.of("error", "Invalid webhook secret"));
            }
        }

        // Execute workflow asynchronously — webhook callers should not wait
        Map<String, Object> ctx = payload != null ? new HashMap<>(payload) : new HashMap<>();
        ctx.put("webhookSlug", webhookSlug);
        ctx.put("triggeredBy", "webhook");

        String workflowId = trigger.getWorkflow().getId();
        String idempotencyKey = "webhook-" + webhookSlug + "-" + System.currentTimeMillis();
        asyncWorkflowExecutor.executeAsync(workflowId, idempotencyKey, ctx);
        return ResponseEntity.accepted().body(Map.of(
                "status", "accepted",
                "workflowId", workflowId,
                "idempotencyKey", idempotencyKey
        ));
    }
}
