package vacademy.io.admin_core_service.features.workflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.features.workflow.dto.NodeTemplateUpdateDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowBuilderDTO;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowRawDTO;
import vacademy.io.admin_core_service.features.workflow.enums.NodeType;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowNodeMapping;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowSchedule;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.repository.NodeTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowNodeMappingRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowScheduleRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowBuilderService {

    private final WorkflowRepository workflowRepository;
    private final NodeTemplateRepository nodeTemplateRepository;
    private final WorkflowNodeMappingRepository mappingRepository;
    private final WorkflowScheduleRepository scheduleRepository;
    private final WorkflowTriggerRepository triggerRepository;
    private final WorkflowValidationService validationService;
    private final WorkflowScheduleService workflowScheduleService;
    private final ObjectMapper objectMapper;
    private final vacademy.io.admin_core_service.features.workflow.service.idempotency.IdempotencyStrategyFactory idempotencyStrategyFactory;

    @Transactional
    public WorkflowBuilderDTO createWorkflow(WorkflowBuilderDTO dto, String userId) {
        // Validate
        List<WorkflowValidationService.ValidationError> errors = validationService.validate(dto);
        List<WorkflowValidationService.ValidationError> criticalErrors = errors.stream()
                .filter(e -> "ERROR".equals(e.getSeverity()))
                .collect(Collectors.toList());
        if (!criticalErrors.isEmpty()) {
            throw new IllegalArgumentException("Validation errors: " +
                    criticalErrors.stream().map(WorkflowValidationService.ValidationError::getMessage)
                            .collect(Collectors.joining(", ")));
        }

        // Create workflow
        Workflow workflow = Workflow.builder()
                .name(dto.getName())
                .description(dto.getDescription())
                .status(dto.getStatus() != null ? dto.getStatus() : "DRAFT")
                .workflowType(dto.getWorkflowType() != null ? dto.getWorkflowType() : "SCHEDULED")
                .createdByUserId(userId)
                .instituteId(dto.getInstituteId())
                .build();
        workflow = workflowRepository.save(workflow);
        String workflowId = workflow.getId();

        // Map client node IDs to DB node IDs
        Map<String, String> clientToDbNodeId = new HashMap<>();

        // Create node templates and mappings
        int order = 0;
        for (WorkflowBuilderDTO.NodeDTO nodeDto : dto.getNodes()) {
            String configJson;
            try {
                // Build config including routing from edges
                Map<String, Object> config = new HashMap<>();
                if (nodeDto.getConfig() != null) {
                    if (nodeDto.getConfig() instanceof Map) {
                        config.putAll((Map<String, Object>) nodeDto.getConfig());
                    } else {
                        config = objectMapper.readValue(
                                objectMapper.writeValueAsString(nodeDto.getConfig()),
                                Map.class);
                    }
                }
                configJson = objectMapper.writeValueAsString(config);
            } catch (Exception e) {
                configJson = "{}";
                log.error("Failed to serialize node config for node: {}", nodeDto.getName(), e);
            }

            NodeTemplate template = NodeTemplate.builder()
                    .instituteId(dto.getInstituteId())
                    .nodeName(nodeDto.getName())
                    .nodeType(nodeDto.getNodeType())
                    .status("ACTIVE")
                    .version(1)
                    .configJson(configJson)
                    .build();
            template = nodeTemplateRepository.save(template);

            clientToDbNodeId.put(nodeDto.getId(), template.getId());

            WorkflowNodeMapping mapping = WorkflowNodeMapping.builder()
                    .workflowId(workflowId)
                    .nodeTemplateId(template.getId())
                    .nodeOrder(order++)
                    .isStartNode(Boolean.TRUE.equals(nodeDto.getIsStartNode()))
                    .isEndNode(Boolean.TRUE.equals(nodeDto.getIsEndNode()))
                    .build();
            mappingRepository.save(mapping);
        }

        // Build routing for every node from the edges (conditional true/false pairing,
        // parallel goto fan-out, preserved switch/custom routing, end for leaf nodes).
        applyEdgesAsRouting(dto, clientToDbNodeId);

        // Create schedule if applicable
        persistSchedule(workflowId, dto);

        // Create trigger(s) if applicable (fresh create — no webhook slugs to preserve)
        persistTriggers(workflowId, dto, Collections.emptyMap());

        // Build response
        dto.setId(workflowId);
        // Remap node IDs to DB IDs
        for (WorkflowBuilderDTO.NodeDTO node : dto.getNodes()) {
            String dbId = clientToDbNodeId.get(node.getId());
            if (dbId != null) {
                node.setId(dbId);
            }
        }

        return dto;
    }

    /**
     * In-place update of an existing workflow (NOT a clone — the old create-then-POST path always
     * inserted a brand-new workflow). Reuses the existing Workflow row id, so its triggers,
     * schedules, execution history and the detail route all stay attached, and reconciles nodes by
     * identity:
     * <ul>
     *   <li>a DTO node whose id matches an existing node_template is UPDATED in place;</li>
     *   <li>a new DTO node (client-generated id) is created;</li>
     *   <li>an existing node missing from the DTO is removed by deleting its mapping row and
     *       soft-inactivating its node_template (status=INACTIVE). The template is never hard-deleted
     *       because {@code workflow_execution_log.node_template_id} CASCADEs and would destroy
     *       execution history; the mapping row is safe to delete (post-V30 nothing FKs to it).</li>
     * </ul>
     * Schedule and trigger rows are rebuilt from the DTO (webhook slug/secret preserved by eventId).
     */
    @Transactional
    public WorkflowBuilderDTO updateWorkflow(String workflowId, WorkflowBuilderDTO dto, String userId) {
        // Validate BEFORE mutating anything — abort the whole update if the graph is invalid.
        List<WorkflowValidationService.ValidationError> errors = validationService.validate(dto);
        List<WorkflowValidationService.ValidationError> criticalErrors = errors.stream()
                .filter(e -> "ERROR".equals(e.getSeverity()))
                .collect(Collectors.toList());
        if (!criticalErrors.isEmpty()) {
            throw new IllegalArgumentException("Validation errors: " +
                    criticalErrors.stream().map(WorkflowValidationService.ValidationError::getMessage)
                            .collect(Collectors.joining(", ")));
        }

        Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workflow not found: " + workflowId));

        // Update workflow-level fields.
        if (dto.getName() != null) workflow.setName(dto.getName());
        workflow.setDescription(dto.getDescription());
        if (dto.getStatus() != null) workflow.setStatus(dto.getStatus());
        if (dto.getWorkflowType() != null) workflow.setWorkflowType(dto.getWorkflowType());
        workflowRepository.save(workflow);

        // Reconcile nodes by identity (existing template id == DTO node id).
        List<WorkflowNodeMapping> existingMappings = mappingRepository.findByWorkflowIdOrderByNodeOrderAsc(workflowId);
        Map<String, WorkflowNodeMapping> mappingByTemplateId = new HashMap<>();
        for (WorkflowNodeMapping m : existingMappings) {
            mappingByTemplateId.put(m.getNodeTemplateId(), m);
        }

        Map<String, String> clientToDbNodeId = new HashMap<>();
        Set<String> keptTemplateIds = new HashSet<>();
        int order = 0;
        for (WorkflowBuilderDTO.NodeDTO nodeDto : dto.getNodes()) {
            String configJson = serializeNodeConfig(nodeDto);
            WorkflowNodeMapping existingMapping = nodeDto.getId() != null
                    ? mappingByTemplateId.get(nodeDto.getId()) : null;

            if (existingMapping != null) {
                NodeTemplate template = nodeTemplateRepository.findById(nodeDto.getId()).orElse(null);
                if (template != null) {
                    template.setNodeName(nodeDto.getName());
                    template.setNodeType(nodeDto.getNodeType());
                    template.setConfigJson(configJson);
                    if (!"ACTIVE".equalsIgnoreCase(template.getStatus())) {
                        template.setStatus("ACTIVE"); // un-inactivate if it was previously removed
                    }
                    nodeTemplateRepository.save(template);

                    existingMapping.setNodeOrder(order++);
                    existingMapping.setIsStartNode(Boolean.TRUE.equals(nodeDto.getIsStartNode()));
                    existingMapping.setIsEndNode(Boolean.TRUE.equals(nodeDto.getIsEndNode()));
                    mappingRepository.save(existingMapping);

                    clientToDbNodeId.put(nodeDto.getId(), template.getId());
                    keptTemplateIds.add(template.getId());
                    continue;
                }
            }

            // New node — create template + mapping.
            NodeTemplate template = NodeTemplate.builder()
                    .instituteId(dto.getInstituteId())
                    .nodeName(nodeDto.getName())
                    .nodeType(nodeDto.getNodeType())
                    .status("ACTIVE")
                    .version(1)
                    .configJson(configJson)
                    .build();
            template = nodeTemplateRepository.save(template);
            clientToDbNodeId.put(nodeDto.getId(), template.getId());
            keptTemplateIds.add(template.getId());

            WorkflowNodeMapping mapping = WorkflowNodeMapping.builder()
                    .workflowId(workflowId)
                    .nodeTemplateId(template.getId())
                    .nodeOrder(order++)
                    .isStartNode(Boolean.TRUE.equals(nodeDto.getIsStartNode()))
                    .isEndNode(Boolean.TRUE.equals(nodeDto.getIsEndNode()))
                    .build();
            mappingRepository.save(mapping);
        }

        // Remove nodes no longer present: delete mapping (safe), soft-inactivate template (keep logs).
        for (WorkflowNodeMapping m : existingMappings) {
            if (!keptTemplateIds.contains(m.getNodeTemplateId())) {
                mappingRepository.delete(m);
                nodeTemplateRepository.findById(m.getNodeTemplateId()).ifPresent(t -> {
                    t.setStatus("INACTIVE");
                    nodeTemplateRepository.save(t);
                });
            }
        }

        // Rebuild routing from the edges.
        applyEdgesAsRouting(dto, clientToDbNodeId);

        // Schedule handling. Previously this ALWAYS deleted every schedule row and recreated one
        // from the DTO, which (a) wiped schedules when the DTO carried none (the edit page only
        // loads the first ACTIVE row), (b) regenerated the id and unlinked execution history, and
        // (c) reset next_run_at/last_run_at/status — a hand-tuned production schedule could be
        // silently replaced by builder defaults. Now: no schedule in the DTO → leave rows alone;
        // schedule present → update the existing row in place (recompute next_run_at only when
        // the cron/timezone actually changed).
        if (dto.getSchedule() != null) {
            updateOrCreateSchedule(workflowId, dto);
        }

        // Trigger rows: only EVENT_DRIVEN workflows own trigger rows through the builder. A
        // SCHEDULED workflow save must not touch trigger rows it never displays.
        if ("EVENT_DRIVEN".equalsIgnoreCase(dto.getWorkflowType())) {
            reconcileTriggers(workflowId, dto);
        }

        // Build response with (possibly remapped) node ids.
        dto.setId(workflowId);
        for (WorkflowBuilderDTO.NodeDTO node : dto.getNodes()) {
            String dbId = clientToDbNodeId.get(node.getId());
            if (dbId != null) node.setId(dbId);
        }
        log.info("Updated workflow {} in place ({} nodes)", workflowId, dto.getNodes().size());
        return dto;
    }

    /** Serialize a node DTO's config object to a JSON string (defaults to {@code {}} on failure). */
    @SuppressWarnings("unchecked")
    private String serializeNodeConfig(WorkflowBuilderDTO.NodeDTO nodeDto) {
        try {
            Map<String, Object> config = new HashMap<>();
            if (nodeDto.getConfig() != null) {
                if (nodeDto.getConfig() instanceof Map) {
                    config.putAll((Map<String, Object>) nodeDto.getConfig());
                } else {
                    config = objectMapper.readValue(objectMapper.writeValueAsString(nodeDto.getConfig()), Map.class);
                }
            }
            return objectMapper.writeValueAsString(config);
        } catch (Exception e) {
            log.error("Failed to serialize node config for node: {}", nodeDto.getName(), e);
            return "{}";
        }
    }

    /**
     * Rebuild every node's {@code routing[]} from the builder edges and persist it into the node
     * template's config_json. Shared by create and update. Behaviour:
     * <ul>
     *   <li><b>2-way CONDITION</b>: a conditioned edge + an edge labelled "false" become ONE
     *       {@code conditional} route carrying both {@code trueNodeId} and {@code falseNodeId} — the
     *       shape the engine evaluates. (The old code emitted two parallel routes, so both branches
     *       ran and the false target was lost.)</li>
     *   <li><b>parallel fan-out</b>: plain (unconditioned) edges become {@code goto} routes that all
     *       execute.</li>
     *   <li><b>preserved routing</b>: {@code switch}/{@code SWITCH}/custom routes the visual builder
     *       can't draw are stashed under {@code __preservedRouting} by {@link #getWorkflowForEditing}
     *       and re-appended here, so a re-save through the builder never silently destroys them.</li>
     *   <li><b>leaf nodes</b>: a node with no edges and no preserved/embedded routing gets an
     *       {@code end} route.</li>
     * </ul>
     */
    @SuppressWarnings("unchecked")
    private void applyEdgesAsRouting(WorkflowBuilderDTO dto, Map<String, String> clientToDbNodeId) {
        if (dto.getNodes() == null) return;

        Map<String, List<WorkflowBuilderDTO.EdgeDTO>> edgesBySource =
                (dto.getEdges() == null ? new ArrayList<WorkflowBuilderDTO.EdgeDTO>() : dto.getEdges())
                        .stream()
                        .filter(e -> e.getSourceNodeId() != null)
                        .collect(Collectors.groupingBy(WorkflowBuilderDTO.EdgeDTO::getSourceNodeId));

        for (WorkflowBuilderDTO.NodeDTO nodeDto : dto.getNodes()) {
            String dbId = clientToDbNodeId.get(nodeDto.getId());
            if (dbId == null) continue;
            NodeTemplate tmpl = nodeTemplateRepository.findById(dbId).orElse(null);
            if (tmpl == null) continue;

            Map<String, Object> config;
            try {
                config = objectMapper.readValue(tmpl.getConfigJson(), Map.class);
            } catch (Exception e) {
                config = new HashMap<>();
            }

            // Pull out routing the visual builder can't represent (stashed on read).
            List<Map<String, Object>> preserved = new ArrayList<>();
            Object pres = config.remove("__preservedRouting");
            if (pres instanceof List) {
                for (Object o : (List<?>) pres) {
                    if (o instanceof Map) preserved.add((Map<String, Object>) o);
                }
            }
            Object existingRouting = config.get("routing");

            List<WorkflowBuilderDTO.EdgeDTO> edges =
                    edgesBySource.getOrDefault(nodeDto.getId(), Collections.emptyList());

            // Partition edges: conditioned (true branch), ALL "false"-labelled edges, plain gotos.
            List<WorkflowBuilderDTO.EdgeDTO> condEdges = new ArrayList<>();
            List<WorkflowBuilderDTO.EdgeDTO> falseEdges = new ArrayList<>();
            List<WorkflowBuilderDTO.EdgeDTO> plainEdges = new ArrayList<>();
            for (WorkflowBuilderDTO.EdgeDTO edge : edges) {
                boolean hasCond = edge.getCondition() != null && !edge.getCondition().isBlank();
                if (hasCond) {
                    condEdges.add(edge);
                } else if ("false".equalsIgnoreCase(edge.getLabel())) {
                    falseEdges.add(edge);
                } else {
                    plainEdges.add(edge);
                }
            }

            List<Map<String, Object>> routing = new ArrayList<>();
            if (!condEdges.isEmpty()) {
                // Pair each conditioned edge with ITS OWN "false" edge by position. getWorkflowForEditing
                // emits routes in order (true_0, false_0, true_1, false_1, ...), so condEdges[i] pairs with
                // falseEdges[i] — keeping independent if / else-if branches distinct (a single shared
                // falseNodeId would conflate them, and surplus false edges must not be silently dropped).
                for (int i = 0; i < condEdges.size(); i++) {
                    WorkflowBuilderDTO.EdgeDTO ce = condEdges.get(i);
                    String trueDbId = clientToDbNodeId.get(ce.getTargetNodeId());
                    if (trueDbId == null) continue;
                    Map<String, Object> route = new HashMap<>();
                    route.put("type", "conditional");
                    route.put("condition", ce.getCondition());
                    route.put("trueNodeId", trueDbId);
                    WorkflowBuilderDTO.EdgeDTO fe = (i < falseEdges.size()) ? falseEdges.get(i) : null;
                    String falseDbId = (fe != null) ? clientToDbNodeId.get(fe.getTargetNodeId()) : null;
                    if (falseDbId != null) route.put("falseNodeId", falseDbId);
                    if (ce.getLabel() != null) route.put("label", ce.getLabel());
                    routing.add(route);
                }
                // Any surplus "false" edges (more than conditions) become plain gotos so they aren't lost.
                for (int j = condEdges.size(); j < falseEdges.size(); j++) {
                    plainEdges.add(falseEdges.get(j));
                }
                for (WorkflowBuilderDTO.EdgeDTO pe : plainEdges) {
                    addGotoRoute(routing, pe, clientToDbNodeId);
                }
            } else {
                // No conditions on this node — every edge is a plain goto (parallel fan-out).
                for (WorkflowBuilderDTO.EdgeDTO e : edges) {
                    addGotoRoute(routing, e, clientToDbNodeId);
                }
            }

            routing.addAll(preserved);

            List<Map<String, Object>> finalRouting;
            if (!routing.isEmpty()) {
                finalRouting = routing;
            } else if (existingRouting instanceof List && !((List<?>) existingRouting).isEmpty()) {
                // No edges and nothing preserved, but the node already embeds routing (e.g. an
                // applied template) — keep it instead of clobbering with "end".
                finalRouting = (List<Map<String, Object>>) existingRouting;
            } else {
                finalRouting = new ArrayList<>();
                Map<String, Object> end = new HashMap<>();
                end.put("type", "end");
                finalRouting.add(end);
            }

            config.put("routing", finalRouting);
            try {
                tmpl.setConfigJson(objectMapper.writeValueAsString(config));
                nodeTemplateRepository.save(tmpl);
            } catch (Exception e) {
                log.error("Failed to persist routing for node: {}", dbId, e);
            }
        }
    }

    private void addGotoRoute(List<Map<String, Object>> routing, WorkflowBuilderDTO.EdgeDTO edge,
                              Map<String, String> clientToDbNodeId) {
        String dbTarget = clientToDbNodeId.get(edge.getTargetNodeId());
        if (dbTarget == null) return;
        Map<String, Object> route = new HashMap<>();
        route.put("type", "goto");
        route.put("targetNodeId", dbTarget);
        if (edge.getLabel() != null) route.put("label", edge.getLabel());
        routing.add(route);
    }

    /**
     * Update-in-place variant used by {@code updateWorkflow}: keeps the existing schedule row's
     * id, status, last_run_at and execution-history links; recomputes next_run_at ONLY when the
     * cron expression or timezone actually changed. Surplus rows are left untouched (the edit
     * page only ever displays the first one). Falls back to creating a row when none exists.
     */
    private void updateOrCreateSchedule(String workflowId, WorkflowBuilderDTO dto) {
        if (!"SCHEDULED".equalsIgnoreCase(dto.getWorkflowType()) || dto.getSchedule() == null) return;
        List<WorkflowSchedule> existing = scheduleRepository.findByWorkflowId(workflowId);
        if (existing.isEmpty()) {
            persistSchedule(workflowId, dto);
            return;
        }
        WorkflowBuilderDTO.ScheduleDTO sch = dto.getSchedule();
        WorkflowSchedule schedule = existing.get(0);
        boolean cronChanged = !java.util.Objects.equals(schedule.getCronExpression(), sch.getCronExpression())
                || (sch.getTimezone() != null && !java.util.Objects.equals(schedule.getTimezone(), sch.getTimezone()));
        schedule.setScheduleType(sch.getScheduleType());
        schedule.setCronExpression(sch.getCronExpression());
        schedule.setIntervalMinutes(sch.getIntervalMinutes());
        if (sch.getTimezone() != null) schedule.setTimezone(sch.getTimezone());
        if (sch.getStartDate() != null) schedule.setStartDate(Instant.parse(sch.getStartDate()));
        if (sch.getEndDate() != null) schedule.setEndDate(Instant.parse(sch.getEndDate()));
        schedule.setUpdatedAt(Instant.now());
        if (cronChanged && schedule.getCronExpression() != null && !schedule.getCronExpression().isBlank()) {
            schedule.setNextRunAt(workflowScheduleService.calculateNextRunTime(
                    schedule.getCronExpression(), schedule.getTimezone()));
        }
        scheduleRepository.save(schedule);
    }

    /** Create the workflow's schedule row from the DTO (SCHEDULED workflows only). */
    private void persistSchedule(String workflowId, WorkflowBuilderDTO dto) {
        if (!"SCHEDULED".equalsIgnoreCase(dto.getWorkflowType()) || dto.getSchedule() == null) return;
        WorkflowBuilderDTO.ScheduleDTO sch = dto.getSchedule();
        WorkflowSchedule schedule = new WorkflowSchedule();
        schedule.setId(UUID.randomUUID().toString());
        schedule.setWorkflowId(workflowId);
        schedule.setScheduleType(sch.getScheduleType());
        schedule.setCronExpression(sch.getCronExpression());
        schedule.setIntervalMinutes(sch.getIntervalMinutes());
        schedule.setTimezone(sch.getTimezone() != null ? sch.getTimezone() : "UTC");
        schedule.setStartDate(sch.getStartDate() != null ? Instant.parse(sch.getStartDate()) : Instant.now());
        if (sch.getEndDate() != null) {
            schedule.setEndDate(Instant.parse(sch.getEndDate()));
        }
        schedule.setStatus("ACTIVE");
        schedule.setCreatedAt(Instant.now());
        schedule.setUpdatedAt(Instant.now());
        if (schedule.getCronExpression() != null && !schedule.getCronExpression().isBlank()) {
            Instant nextRun = workflowScheduleService.calculateNextRunTime(
                    schedule.getCronExpression(), schedule.getTimezone());
            schedule.setNextRunAt(nextRun);
        } else {
            schedule.setNextRunAt(Instant.now());
        }
        scheduleRepository.save(schedule);
    }

    /**
     * Create the workflow's trigger row(s) from the DTO (EVENT_DRIVEN workflows only). One row per
     * effective event id (global trigger when none). {@code webhookByEventId} carries any webhook
     * slug/secret to preserve across an update (keyed by eventId, "" = global); empty for create.
     */
    /**
     * Make this workflow's trigger rows match the DTO by UPDATING rows in place, never by
     * delete-and-recreate.
     *
     * <p>Two reasons a hard delete is wrong here. (1) {@code workflow_execution.workflow_trigger_id}
     * FK-references this table ({@code fk_workflow_execution_trigger}, V73), so once a trigger has
     * fired even once the DELETE aborts with a DataIntegrityViolationException and the workflow
     * becomes permanently uneditable -- the exact failure already documented for the onboarding
     * path in OnboardingStepWorkflowTriggerService.saveStepWorkflowTriggers. (2) Even when the
     * delete succeeds (never-fired workflow), recreating regenerates the id, so existing execution
     * history stops resolving back to its trigger and the webhook slug/secret have to be manually
     * carried across. Updating in place keeps ids, history links and webhook credentials stable --
     * the same reasoning that already governs schedule rows above.</p>
     *
     * <p>Rows that are no longer wanted are status-flipped to INACTIVE rather than removed. Every
     * fire-time lookup filters {@code status IN ('ACTIVE')} (WorkflowTriggerService:58,283,343), so
     * a deactivated row can never start a run, and its execution history stays intact.</p>
     */
    private void reconcileTriggers(String workflowId, WorkflowBuilderDTO dto) {
        List<WorkflowTrigger> existing = triggerRepository.findByWorkflowId(workflowId);
        WorkflowBuilderDTO.TriggerDTO trig = dto.getTrigger();

        // No trigger authored in the DTO -> leave existing rows alone (mirrors the schedule rule:
        // the edit page not sending one must not be read as "delete what is there").
        if (trig == null) {
            return;
        }

        // Preserve idempotency settings when the DTO doesn't carry its own (the edit page does not
        // round-trip them; resetting would silently drop CUSTOM_EXPRESSION dedup back to UUID).
        if (trig.getIdempotencyGenerationSetting() == null) {
            existing.stream()
                    .map(WorkflowTrigger::getIdempotencyGenerationSetting)
                    .filter(s -> s != null && !s.isBlank())
                    .findFirst()
                    .ifPresent(trig::setIdempotencyGenerationSetting);
        }

        String eventName = trig.getTriggerEventName();
        String idempotencySettings = resolveIdempotencySettings(trig, defaultIdempotencyFor(eventName));
        Workflow managedWorkflow = workflowRepository.findById(workflowId).orElseThrow();

        // An empty event-ids list is the legitimate "fires for everything" choice, represented by a
        // single row with a null eventId (WorkflowBuilderDTO.getEffectiveEventIds).
        List<String> targets = trig.getEffectiveEventIds();
        if (targets.isEmpty()) {
            targets = Collections.singletonList(null);
        }

        Set<WorkflowTrigger> claimed = Collections.newSetFromMap(new IdentityHashMap<>());
        for (String eventId : targets) {
            // Prefer the row that already represents this (event, entity) pair; otherwise recycle
            // any spare row so the common single-trigger edit (switching event or audience) updates
            // the existing row instead of orphaning it.
            WorkflowTrigger row = existing.stream()
                    .filter(t -> !claimed.contains(t))
                    .filter(t -> Objects.equals(t.getEventId(), eventId)
                            && Objects.equals(t.getTriggerEventName(), eventName))
                    .findFirst()
                    .orElseGet(() -> existing.stream()
                            .filter(t -> !claimed.contains(t))
                            .findFirst()
                            .orElse(null));

            if (row == null) {
                row = new WorkflowTrigger();
                row.setWorkflow(managedWorkflow);
            } else {
                claimed.add(row);
            }
            row.setTriggerEventName(eventName);
            row.setInstituteId(dto.getInstituteId());
            row.setDescription(trig.getDescription());
            row.setStatus("ACTIVE");
            row.setEventId(eventId);
            row.setEventAppliedType(trig.getEventAppliedType());
            row.setIdempotencyGenerationSetting(idempotencySettings);
            // webhookUrlSlug / webhookSecret are deliberately left untouched: the row survives, so
            // an already-published webhook URL keeps working across edits.
            triggerRepository.save(row);
        }

        for (WorkflowTrigger leftover : existing) {
            if (!claimed.contains(leftover) && !"INACTIVE".equalsIgnoreCase(leftover.getStatus())) {
                leftover.setStatus("INACTIVE");
                triggerRepository.save(leftover);
                log.info("Deactivated trigger {} (event={}, eventId={}) on workflow {} -- no longer in the DTO",
                        leftover.getId(), leftover.getTriggerEventName(), leftover.getEventId(), workflowId);
            }
        }
    }

    private void persistTriggers(String workflowId, WorkflowBuilderDTO dto, Map<String, String[]> webhookByEventId) {
        if (!"EVENT_DRIVEN".equalsIgnoreCase(dto.getWorkflowType()) || dto.getTrigger() == null) return;
        WorkflowBuilderDTO.TriggerDTO trig = dto.getTrigger();
        // Default dedup strategy depends on how the event is emitted — see
        // defaultIdempotencyFor. Explicit settings on the DTO still win (resolveIdempotencySettings).
        String defaultIdempotencySettings = defaultIdempotencyFor(trig.getTriggerEventName());
        String idempotencySettings = resolveIdempotencySettings(trig, defaultIdempotencySettings);
        Workflow managedWorkflow = workflowRepository.findById(workflowId).orElseThrow();

        List<String> effectiveIds = trig.getEffectiveEventIds();
        if (effectiveIds.isEmpty()) {
            String[] webhook = webhookByEventId.get("");
            WorkflowTrigger trigger = WorkflowTrigger.builder()
                    .triggerEventName(trig.getTriggerEventName())
                    .instituteId(dto.getInstituteId())
                    .description(trig.getDescription())
                    .status("ACTIVE")
                    .eventId(null)
                    .eventAppliedType(trig.getEventAppliedType())
                    .idempotencyGenerationSetting(idempotencySettings)
                    .webhookUrlSlug(webhook != null ? webhook[0] : null)
                    .webhookSecret(webhook != null ? webhook[1] : null)
                    .build();
            trigger.setWorkflow(managedWorkflow);
            triggerRepository.save(trigger);
        } else {
            for (String eid : effectiveIds) {
                String[] webhook = webhookByEventId.get(eid);
                WorkflowTrigger trigger = WorkflowTrigger.builder()
                        .triggerEventName(trig.getTriggerEventName())
                        .instituteId(dto.getInstituteId())
                        .description(trig.getDescription())
                        .status("ACTIVE")
                        .eventId(eid)
                        .eventAppliedType(trig.getEventAppliedType())
                        .idempotencyGenerationSetting(idempotencySettings)
                        .webhookUrlSlug(webhook != null ? webhook[0] : null)
                        .webhookSecret(webhook != null ? webhook[1] : null)
                        .build();
                trigger.setWorkflow(managedWorkflow);
                triggerRepository.save(trigger);
            }
        }
    }

    /**
     * Honor caller-supplied idempotency settings (JSON object or string, per IdempotencySettings)
     * after validating them; otherwise keep the per-event default. Invalid settings fall back to
     * the default rather than failing the publish — the validation service surfaces the error to
     * the builder/AI-repair loop before this point for anything user-visible.
     */
    private String resolveIdempotencySettings(WorkflowBuilderDTO.TriggerDTO trig, String fallback) {
        Object provided = trig.getIdempotencyGenerationSetting();
        if (provided == null) return fallback;
        try {
            String json = provided instanceof String s ? s : objectMapper.writeValueAsString(provided);
            if (json.isBlank() || "null".equals(json)) return fallback;
            vacademy.io.admin_core_service.features.workflow.dto.IdempotencySettings settings =
                    objectMapper.readValue(json, vacademy.io.admin_core_service.features.workflow.dto.IdempotencySettings.class);
            idempotencyStrategyFactory.validateSettings(settings);
            return json;
        } catch (Exception e) {
            log.warn("Invalid trigger idempotency settings ({}) — falling back to default {}", e.getMessage(), fallback);
            return fallback;
        }
    }

    @Transactional
    public void deleteWorkflow(String workflowId) {
        Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new RuntimeException("Workflow not found: " + workflowId));
        workflow.setStatus("INACTIVE");
        workflowRepository.save(workflow);

        // Deactivate schedules
        scheduleRepository.findByWorkflowIdAndStatus(workflowId, "ACTIVE")
                .forEach(s -> {
                    s.setStatus("INACTIVE");
                    scheduleRepository.save(s);
                });

        // Deactivate triggers
        triggerRepository.findByWorkflowId(workflowId)
                .forEach(t -> {
                    t.setStatus("INACTIVE");
                    triggerRepository.save(t);
                });

        log.info("Soft-deleted workflow: {}", workflowId);
    }

    @Transactional(readOnly = true)
    public WorkflowBuilderDTO getWorkflowForEditing(String workflowId) {
        Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new RuntimeException("Workflow not found: " + workflowId));

        List<WorkflowNodeMapping> mappings = mappingRepository.findByWorkflowIdOrderByNodeOrderAsc(workflowId);

        List<WorkflowBuilderDTO.NodeDTO> nodes = new ArrayList<>();
        Map<String, String> dbIdToClientId = new HashMap<>();

        for (WorkflowNodeMapping mapping : mappings) {
            NodeTemplate template = nodeTemplateRepository.findById(mapping.getNodeTemplateId()).orElse(null);
            if (template == null) continue;

            Object configObj = null;
            try {
                configObj = objectMapper.readValue(template.getConfigJson(), Map.class);
            } catch (Exception e) {
                configObj = template.getConfigJson();
            }

            WorkflowBuilderDTO.NodeDTO nodeDto = WorkflowBuilderDTO.NodeDTO.builder()
                    .id(template.getId())
                    .name(template.getNodeName())
                    .nodeType(template.getNodeType())
                    .config(configObj)
                    .isStartNode(mapping.getIsStartNode())
                    .isEndNode(mapping.getIsEndNode())
                    .build();
            nodes.add(nodeDto);
            dbIdToClientId.put(template.getId(), template.getId());
        }

        // Extract edges from routing configs
        List<WorkflowBuilderDTO.EdgeDTO> edges = new ArrayList<>();
        for (WorkflowBuilderDTO.NodeDTO node : nodes) {
            if (node.getConfig() instanceof Map) {
                Map<String, Object> config = (Map<String, Object>) node.getConfig();
                Object routingObj = config.get("routing");
                // Routes the visual builder cannot draw (switch/SWITCH/custom). We keep these so a
                // re-save through the builder re-appends them via applyEdgesAsRouting instead of
                // silently destroying them (the loss-less alternative is the Configuration tab).
                List<Map<String, Object>> preserved = new ArrayList<>();
                if (routingObj instanceof List) {
                    List<Map<String, Object>> routing = (List<Map<String, Object>>) routingObj;
                    for (Map<String, Object> route : routing) {
                        String type = String.valueOf(route.getOrDefault("type", ""));
                        if ("goto".equalsIgnoreCase(type)) {
                            String targetId = String.valueOf(route.get("targetNodeId"));
                            edges.add(WorkflowBuilderDTO.EdgeDTO.builder()
                                    .id(UUID.randomUUID().toString())
                                    .sourceNodeId(node.getId())
                                    .targetNodeId(targetId)
                                    .label((String) route.get("label"))
                                    .build());
                        } else if ("conditional".equalsIgnoreCase(type)) {
                            String trueNodeId = String.valueOf(route.get("trueNodeId"));
                            String falseNodeId = route.get("falseNodeId") != null ? String.valueOf(route.get("falseNodeId")) : null;
                            edges.add(WorkflowBuilderDTO.EdgeDTO.builder()
                                    .id(UUID.randomUUID().toString())
                                    .sourceNodeId(node.getId())
                                    .targetNodeId(trueNodeId)
                                    .label("true")
                                    .condition((String) route.get("condition"))
                                    .build());
                            if (falseNodeId != null) {
                                edges.add(WorkflowBuilderDTO.EdgeDTO.builder()
                                        .id(UUID.randomUUID().toString())
                                        .sourceNodeId(node.getId())
                                        .targetNodeId(falseNodeId)
                                        .label("false")
                                        .build());
                            }
                        } else if ("end".equalsIgnoreCase(type)) {
                            // Leaf marker — nothing to draw; applyEdgesAsRouting re-derives it.
                        } else {
                            preserved.add(route);
                        }
                    }
                }
                // Remove routing from config so it doesn't confuse the editor; stash the
                // un-drawable routes so they survive the round-trip.
                config.remove("routing");
                if (!preserved.isEmpty()) {
                    config.put("__preservedRouting", preserved);
                }
            }
        }

        // Get schedule
        WorkflowBuilderDTO.ScheduleDTO scheduleDto = null;
        List<WorkflowSchedule> schedules = scheduleRepository.findByWorkflowIdAndStatus(workflowId, "ACTIVE");
        if (!schedules.isEmpty()) {
            WorkflowSchedule schedule = schedules.get(0);
            scheduleDto = WorkflowBuilderDTO.ScheduleDTO.builder()
                    .scheduleType(schedule.getScheduleType())
                    .cronExpression(schedule.getCronExpression())
                    .intervalMinutes(schedule.getIntervalMinutes())
                    .timezone(schedule.getTimezone())
                    .startDate(schedule.getStartDate() != null ? schedule.getStartDate().toString() : null)
                    .endDate(schedule.getEndDate() != null ? schedule.getEndDate().toString() : null)
                    .build();
        }

        // Get trigger(s) — consolidate multiple trigger rows into one DTO with event_ids array
        WorkflowBuilderDTO.TriggerDTO triggerDto = null;
        List<WorkflowTrigger> triggers = triggerRepository.findByWorkflowId(workflowId);
        if (!triggers.isEmpty()) {
            WorkflowTrigger firstTrigger = triggers.get(0);
            java.util.List<String> allEventIds = triggers.stream()
                    .map(WorkflowTrigger::getEventId)
                    .filter(id -> id != null && !id.isBlank())
                    .distinct()
                    .collect(java.util.stream.Collectors.toList());
            triggerDto = WorkflowBuilderDTO.TriggerDTO.builder()
                    .triggerEventName(firstTrigger.getTriggerEventName())
                    .description(firstTrigger.getDescription())
                    .eventId(allEventIds.isEmpty() ? null : allEventIds.get(0))
                    .eventIds(allEventIds.isEmpty() ? null : allEventIds)
                    .eventAppliedType(firstTrigger.getEventAppliedType())
                    // Round-trip dedup settings so an edit-page save can't reset them to UUID.
                    .idempotencyGenerationSetting(firstTrigger.getIdempotencyGenerationSetting())
                    .build();
        }

        return WorkflowBuilderDTO.builder()
                .id(workflow.getId())
                .name(workflow.getName())
                .description(workflow.getDescription())
                .status(workflow.getStatus())
                .workflowType(workflow.getWorkflowType())
                .instituteId(workflow.getInstituteId())
                .nodes(nodes)
                .edges(edges)
                .schedule(scheduleDto)
                .trigger(triggerDto)
                .build();
    }

    // =================== In-place node-config editor (workflow detail page) ===================

    /**
     * Loss-less view of a workflow's nodes for the in-place "Configuration" editor. Returns each
     * node template's {@code config_json} EXACTLY as stored (routing included) — unlike
     * {@link #getWorkflowForEditing(String)}, which strips routing and rebuilds edges (lossy for
     * SWITCH / falseNodeId / custom routing). Nodes are ordered by {@code node_order}.
     */
    @Transactional(readOnly = true)
    public WorkflowRawDTO getWorkflowRaw(String workflowId) {
        Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workflow not found: " + workflowId));

        List<WorkflowNodeMapping> mappings = mappingRepository.findByWorkflowIdOrderByNodeOrderAsc(workflowId);

        List<WorkflowRawDTO.RawNodeDTO> nodes = new ArrayList<>();
        for (WorkflowNodeMapping mapping : mappings) {
            NodeTemplate template = nodeTemplateRepository.findById(mapping.getNodeTemplateId()).orElse(null);
            if (template == null) continue;
            nodes.add(WorkflowRawDTO.RawNodeDTO.builder()
                    .mappingId(mapping.getId())
                    .nodeTemplateId(template.getId())
                    .nodeName(template.getNodeName())
                    .nodeType(template.getNodeType())
                    .status(template.getStatus())
                    .version(template.getVersion())
                    .configJson(template.getConfigJson())
                    .retryConfig(template.getRetryConfig())
                    .nodeOrder(mapping.getNodeOrder())
                    .isStartNode(mapping.getIsStartNode())
                    .isEndNode(mapping.getIsEndNode())
                    .build());
        }

        return WorkflowRawDTO.builder()
                .id(workflow.getId())
                .name(workflow.getName())
                .description(workflow.getDescription())
                .status(workflow.getStatus())
                .workflowType(workflow.getWorkflowType())
                .instituteId(workflow.getInstituteId())
                .createdAt(workflow.getCreatedAt() != null ? workflow.getCreatedAt().toInstant().toString() : null)
                .updatedAt(workflow.getUpdatedAt() != null ? workflow.getUpdatedAt().toInstant().toString() : null)
                .nodes(nodes)
                .build();
    }

    /**
     * In-place partial update of a single node template, scoped to the given workflow. Only
     * non-null fields on the DTO are applied. {@code config_json} (and {@code retry_config}) are
     * validated as JSON objects before persisting, and {@code node_type} must be a known
     * {@link NodeType} — so a bad edit can't brick the engine's dispatch. The {@code routing}
     * lives inside {@code config_json}, so editing the JSON is how complex branching gets tuned.
     *
     * <p>Updates the existing {@code node_template} row in place (no version bump) — the running
     * workflow picks up the new config on its next execution, since the engine reads
     * {@code NodeTemplate.configJson} at run time.
     */
    @Transactional
    public WorkflowRawDTO.RawNodeDTO updateNodeTemplate(String workflowId, String nodeTemplateId,
                                                        NodeTemplateUpdateDTO dto) {
        // Scope the node to this workflow via its mapping (also where start/end flags live).
        List<WorkflowNodeMapping> mappings = mappingRepository
                .findByWorkflowIdAndNodeTemplateId(workflowId, nodeTemplateId);
        if (mappings.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Node template " + nodeTemplateId + " is not part of workflow " + workflowId);
        }
        WorkflowNodeMapping mapping = mappings.get(0);

        NodeTemplate template = nodeTemplateRepository.findById(nodeTemplateId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Node template not found: " + nodeTemplateId));

        // config_json — must parse to a JSON object; re-serialize to canonical form.
        if (dto.getConfigJson() != null) {
            String trimmed = dto.getConfigJson().trim();
            if (trimmed.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "config_json cannot be empty");
            }
            Map<String, Object> parsed;
            try {
                parsed = objectMapper.readValue(trimmed, Map.class);
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "config_json is not a valid JSON object: " + e.getMessage());
            }
            try {
                template.setConfigJson(objectMapper.writeValueAsString(parsed));
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Failed to serialize config_json: " + e.getMessage());
            }
        }

        // node_type — must be a known NodeType so the engine can dispatch it.
        if (dto.getNodeType() != null && !dto.getNodeType().isBlank()) {
            try {
                NodeType.valueOf(dto.getNodeType().trim());
            } catch (IllegalArgumentException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown node_type: " + dto.getNodeType());
            }
            template.setNodeType(dto.getNodeType().trim());
        }

        if (dto.getNodeName() != null && !dto.getNodeName().isBlank()) {
            template.setNodeName(dto.getNodeName().trim());
        }

        if (dto.getStatus() != null && !dto.getStatus().isBlank()) {
            template.setStatus(dto.getStatus().trim());
        }

        // retry_config — blank clears it; non-blank must be a JSON object.
        if (dto.getRetryConfig() != null) {
            String rc = dto.getRetryConfig().trim();
            if (rc.isEmpty()) {
                template.setRetryConfig(null);
            } else {
                try {
                    objectMapper.readValue(rc, Map.class);
                } catch (Exception e) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "retry_config is not a valid JSON object: " + e.getMessage());
                }
                template.setRetryConfig(rc);
            }
        }

        nodeTemplateRepository.save(template);

        boolean mappingChanged = false;
        if (dto.getIsStartNode() != null) {
            mapping.setIsStartNode(dto.getIsStartNode());
            mappingChanged = true;
        }
        if (dto.getIsEndNode() != null) {
            mapping.setIsEndNode(dto.getIsEndNode());
            mappingChanged = true;
        }
        if (mappingChanged) {
            mappingRepository.save(mapping);
        }

        log.info("Updated node template {} of workflow {}", nodeTemplateId, workflowId);

        return WorkflowRawDTO.RawNodeDTO.builder()
                .mappingId(mapping.getId())
                .nodeTemplateId(template.getId())
                .nodeName(template.getNodeName())
                .nodeType(template.getNodeType())
                .status(template.getStatus())
                .version(template.getVersion())
                .configJson(template.getConfigJson())
                .retryConfig(template.getRetryConfig())
                .nodeOrder(mapping.getNodeOrder())
                .isStartNode(mapping.getIsStartNode())
                .isEndNode(mapping.getIsEndNode())
                .build();
    }

    /**
     * Trigger event types whose dispatch happens from a periodic Quartz scan
     * (rather than a per-request HTTP path). For these, every backend replica
     * picks up the same eligible record and would fire the workflow once per
     * replica unless we use an event-derived idempotency key. Add new event
     * types here as they're added to the periodic-scan list.
     *
     * <p>Currently only LIVE_SESSION_END qualifies — fired by
     * LiveSessionNotificationProcessor#dispatchEndedLiveSessionWorkflows on a
     * 5-min Quartz tick, with eventId = scheduleId (stable per occurrence).
     */
    private static boolean isPeriodicScanTrigger(String eventName) {
        if (eventName == null) return false;
        // These events are emitted by periodic Quartz scans (not one-shot
        // request handlers), so they need EVENT_BASED idempotency to dedup
        // cross-replica fires for the same eventId.
        //   - LIVE_SESSION_START / LIVE_SESSION_END  → LiveSessionNotificationProcessor
        //   - MEMBERSHIP_EXPIRY                       → PackageSessionScheduler.emitMembershipExpiryReminders
        return "LIVE_SESSION_END".equals(eventName)
                || "LIVE_SESSION_START".equals(eventName)
                || "MEMBERSHIP_EXPIRY".equals(eventName);
    }

    /**
     * Default idempotency for a trigger event, used when the caller supplies none.
     *
     * <p>Three shapes, picked by how the event is emitted:
     * <ul>
     *   <li><b>EVENT_BASED</b> for periodic scans keyed by a per-recipient eventId
     *       ({@link #isPeriodicScanTrigger}) — the key is trigger+type+eventId, so it
     *       dedups exactly once per entity across replicas.</li>
     *   <li><b>CONTEXT_BASED</b> for periodic scans that emit once per LEARNER but key eventId
     *       to the parent entity. ASSESSMENT_REMINDER_BEFORE_START is emitted per registered
     *       learner with eventId = assessmentId (so admins can still scope a trigger to one
     *       assessment), which means EVENT_BASED would collapse an entire assessment's
     *       reminders into a single execution and only the first learner would ever be
     *       notified. Keying on assessmentId + userId keeps the per-learner fan-out while
     *       reminding each learner exactly once per assessment.</li>
     *   <li><b>UUID</b> for one-shot request handlers, which need no dedup.</li>
     * </ul>
     */
    private static String defaultIdempotencyFor(String eventName) {
        if (isPeriodicScanTrigger(eventName)) {
            return "{\"strategy\":\"EVENT_BASED\",\"includeTriggerId\":true,\"includeEventType\":true,\"includeEventId\":true}";
        }
        if ("ASSESSMENT_REMINDER_BEFORE_START".equals(eventName)) {
            // CONTEXT_BASED, deliberately NOT CONTEXT_TIME_WINDOW. That strategy buckets on
            // tumbling wall-clock windows (floor(now / ttl) * ttl), so any ttl short enough to
            // allow a future second reminder stage is also short enough for two sweeps of the
            // same "starting soon" assessment to land in adjacent buckets and re-notify the
            // entire cohort. A reminder is a once-per-learner-per-assessment fact, which is
            // exactly what CONTEXT_BASED expresses — with no boundary to straddle.
            //
            // includeTriggerId is stated explicitly (it already defaults to true) because the
            // key depends on it: without the trigger id every trigger row on this event shares
            // one key, and an institute running two reminder workflows — one email, one
            // WhatsApp — would have the second rejected as a duplicate of the first.
            return "{\"strategy\":\"CONTEXT_BASED\",\"includeTriggerId\":true,"
                    + "\"contextFields\":[\"assessmentId\",\"userId\"]}";
        }
        return "{\"strategy\":\"UUID\"}";
    }
}
