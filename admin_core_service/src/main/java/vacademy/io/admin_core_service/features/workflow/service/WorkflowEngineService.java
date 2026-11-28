package vacademy.io.admin_core_service.features.workflow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.workflow.engine.NodeHandler;
import vacademy.io.admin_core_service.features.workflow.engine.NodeHandlerRegistry;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowNodeMapping;
import vacademy.io.admin_core_service.features.workflow.repository.NodeTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowNodeMappingRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.logging.SentryLogger;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowEngineService {

    private final WorkflowRepository workflowRepository;
    private final WorkflowNodeMappingRepository mappingRepository;
    private final NodeTemplateRepository nodeTemplateRepository;
    private final NodeHandlerRegistry nodeHandlerRegistry;
    private final SpelEvaluator spelEvaluator;
    private final ObjectMapper objectMapper;
    private final InstituteRepository instituteRepository;

    // Context key under which the engine mirrors the set of notification nodes (SEND_EMAIL /
    // SEND_WHATSAPP) already executed in this logical run. It is persisted as part of the
    // serialized context on pause (DelayNodeHandler) and restored on resume so notifications
    // upstream of a long DELAY are not re-sent when the workflow is resumed from __resumed_at_node.
    private static final String EXECUTED_NOTIFICATION_NODES_KEY = "__executed_notification_nodes";

    /**
     * The running workflow's name, for send nodes to say which workflow a message came from
     * (WhatsApp Inbox / student timeline). Engine-internal, like the key above, so it can never
     * collide with a key a workflow author puts on the context.
     */
    public static final String WORKFLOW_NAME_KEY = "__workflowName";

    public Map<String, Object> run(String workflowId, Map<String, Object> seedContext) {
        try {
            // Check for dry-run mode from seedContext
            boolean dryRun = false;
            if (seedContext != null && Boolean.TRUE.equals(seedContext.get("dryRun"))) {
                dryRun = true;
                log.info("========== DRY RUN MODE ========== Workflow: {}", workflowId);
            }

            Workflow wf = workflowRepository.findById(workflowId).orElseThrow();
            List<WorkflowNodeMapping> mappings = mappingRepository.findByWorkflowIdOrderByNodeOrderAsc(workflowId);

            if (mappings.isEmpty()) {
                log.warn("No node mappings found for workflow: {}", workflowId);
                SentryLogger.logWarning("Workflow has no node mappings — nothing will be sent",
                        Map.of("workflow.id", workflowId, "layer", "2-workflow-engine"));
                return seedContext != null ? seedContext : new HashMap<>();
            }

            Map<String, NodeTemplate> templateById = new HashMap<>();
            nodeTemplateRepository.findByInstituteIdAndStatus(wf.getInstituteId(), "ACTIVE")
                    .forEach(t -> templateById.put(t.getId(), t));

            Map<String, Object> ctx = new HashMap<>();
            if (seedContext != null) {
                ctx.putAll(seedContext);
            }
            ctx.put("workflowId", workflowId);
            ctx.put(WORKFLOW_NAME_KEY, wf.getName());
            ctx.put("instituteId", wf.getInstituteId());

            // Resolve and inject the institute name so SEND_EMAIL templates can use
            // {{instituteName}} without each trigger source having to populate it.
            // Lookup is once per workflow run (cheap) and silently no-ops if the
            // institute can't be resolved — handlers that need it must branch on null.
            try {
                instituteRepository.findById(wf.getInstituteId())
                        .map(Institute::getInstituteName)
                        .ifPresent(name -> ctx.put("instituteName", name));
            } catch (Exception e) {
                log.warn("Could not resolve instituteName for instituteId={}: {}",
                        wf.getInstituteId(), e.getMessage());
            }

            // Propagate dryRun flag into context so all handlers can read it
            if (dryRun) {
                ctx.put("dryRun", true);
            }

            // Index by node ID for routing convenience
            Map<String, WorkflowNodeMapping> byNodeId = new HashMap<>();
            mappings.forEach(m -> byNodeId.put(m.getNodeTemplateId(), m));

            log.info("=== WORKFLOW NODE MAPPINGS ===");
            for (WorkflowNodeMapping mapping : mappings) {
                log.info("Node ID: {}, Template ID: {}, Order: {}, Is Start: {}",
                        mapping.getId(), mapping.getNodeTemplateId(), mapping.getNodeOrder(), mapping.getIsStartNode());
            }
            log.info("Available node IDs for routing: {}", byNodeId.keySet());
            log.info("=== END WORKFLOW NODE MAPPINGS ===");

            // Find start node
            WorkflowNodeMapping startNode = mappings.stream()
                    .filter(WorkflowNodeMapping::getIsStartNode)
                    .findFirst()
                    .orElse(mappings.get(0)); // Fallback to first node if no start node defined

            // Use Stack for routing calculation instead of relying on node order
            Stack<String> nodeExecutionStack = new Stack<>();
            Map<String, Integer> nodeVisitCount = new HashMap<>();
            int maxVisitsPerNode = 3; // Allow re-execution in diamond DAGs, but cap to prevent infinite loops

            // Track notification nodes that have already sent messages to prevent duplicates
            // in diamond DAG patterns where multiple paths converge on the same notification node.
            // This set is mirrored into ctx under EXECUTED_NOTIFICATION_NODES_KEY so it survives a
            // pause/resume cycle (DelayNodeHandler serializes ctx), preventing re-fires across resumes.
            Set<String> executedNotificationNodes = new HashSet<>();

            // H1 FIX: detect a resume. When WorkflowResumeJob restores a paused execution it seeds
            // ctx with __resumed_at_node (the node to continue from). If present & non-blank we must
            // (a) start the stack at THAT node, not startNode, and (b) restore the set of notification
            // nodes already fired before the pause, so SEND_EMAIL/SEND_WHATSAPP nodes upstream of the
            // delay are NOT re-sent. If absent/blank, behavior is exactly as before (start from startNode).
            Object resumedAtNodeObj = ctx.get("__resumed_at_node");
            String resumedAtNode = (resumedAtNodeObj == null) ? null : String.valueOf(resumedAtNodeObj).trim();
            boolean isResume = resumedAtNode != null && !resumedAtNode.isBlank();

            if (isResume) {
                // Restore previously-executed notification nodes from the persisted context.
                Object prevExecuted = ctx.get(EXECUTED_NOTIFICATION_NODES_KEY);
                if (prevExecuted instanceof Collection<?> col) {
                    for (Object n : col) {
                        if (n != null) {
                            executedNotificationNodes.add(String.valueOf(n));
                        }
                    }
                }
                // Pre-populate visit counts for those nodes so dedup-by-visit also treats them as seen.
                executedNotificationNodes.forEach(n -> nodeVisitCount.put(n, 1));
                log.info("Resuming workflow at node {} with {} previously-executed notification nodes restored: {}",
                        resumedAtNode, executedNotificationNodes.size(), executedNotificationNodes);
            }

            // Consume the resume marker so it does not leak into child traversal / handlers.
            ctx.remove("__resumed_at_node");
            // Keep ctx's executed-notification mirror in sync from the very start.
            ctx.put(EXECUTED_NOTIFICATION_NODES_KEY, new ArrayList<>(executedNotificationNodes));

            // Push the entry node: resumed node on resume, else the start node.
            String entryNodeId = isResume ? resumedAtNode : startNode.getNodeTemplateId();
            nodeExecutionStack.push(entryNodeId);
            log.info("Starting workflow execution with entry node: {} (resume={})", entryNodeId, isResume);

            int guard = 0; // prevent infinite loops
            while (!nodeExecutionStack.isEmpty() && guard++ < 100) {
                String currentNodeId = nodeExecutionStack.pop();
                log.info("Processing node ID: {} (stack size: {}, guard: {})", currentNodeId, nodeExecutionStack.size(),
                        guard);

                // Allow re-execution up to maxVisitsPerNode times (supports diamond DAG patterns)
                int visits = nodeVisitCount.getOrDefault(currentNodeId, 0);
                if (visits >= maxVisitsPerNode) {
                    log.warn("Node {} already visited {} times, skipping to prevent infinite loop", currentNodeId, visits);
                    continue;
                }

                nodeVisitCount.put(currentNodeId, visits + 1);

                WorkflowNodeMapping current = byNodeId.get(currentNodeId);
                if (current == null) {
                    log.error("Node mapping not found for node ID: {}", currentNodeId);
                    SentryLogger.logError(new IllegalStateException("Node mapping not found"),
                            "Workflow node mapping missing — node will be skipped",
                            Map.of("workflow.id", workflowId, "node.id", currentNodeId, "layer", "2-workflow-engine"));
                    continue;
                }

                log.info("Processing node: {} (order: {})", current.getId(), current.getNodeOrder());

                NodeTemplate tmpl = templateById.get(current.getNodeTemplateId());
                if (tmpl == null) {
                    log.error("Node template not found for mapping: {}", current.getId());
                    SentryLogger.logError(new IllegalStateException("Node template not found"),
                            "Node template missing — node will be skipped",
                            Map.of("workflow.id", workflowId, "mapping.id", current.getId(),
                                    "node.template.id", current.getNodeTemplateId(), "layer", "2-workflow-engine"));
                    continue;
                }

                String effectiveConfig = mergeConfig(tmpl.getConfigJson(), current.getOverrideConfig());
                String nodeType = tmpl.getNodeType();
                log.info("Node type: {}, effective config: {}", nodeType, effectiveConfig);

                // Prevent duplicate notification sends in diamond DAG patterns:
                // If multiple paths converge on the same SEND_EMAIL or SEND_WHATSAPP node,
                // only execute it once per workflow run. Membership is recorded AFTER a
                // successful handler run (below) — recording it up-front meant a crashed or
                // rate-limited send was permanently counted as "sent" and never retriable.
                boolean isNotificationNode =
                        "SEND_EMAIL".equalsIgnoreCase(nodeType) || "SEND_WHATSAPP".equalsIgnoreCase(nodeType);
                if (isNotificationNode && executedNotificationNodes.contains(currentNodeId)) {
                    log.info("Skipping duplicate notification node {} (type: {}) - already executed in this workflow run",
                            currentNodeId, nodeType);

                    SentryLogger.logWarning("Duplicate notification node skipped in workflow", Map.of(
                            "workflow.id", workflowId,
                            "node.id", currentNodeId,
                            "node.type", nodeType,
                            "institute.id", String.valueOf(ctx.get("instituteId")),
                            "operation", "WorkflowEngine.duplicateNodeSkipped"
                    ));
                    continue;
                }

                // Use registry for O(1) lookup
                NodeHandler handler = nodeHandlerRegistry.getHandler(nodeType);
                if (handler != null) {
                    log.info("Executing handler: {} for node: {}", handler.getClass().getSimpleName(),
                            current.getId());

                    // Parse retry config
                    int maxRetries = 0;
                    long backoffMs = 1000;
                    double backoffMultiplier = 2.0;
                    if (tmpl.getRetryConfig() != null && !tmpl.getRetryConfig().isBlank()) {
                        try {
                            JsonNode retryJson = objectMapper.readTree(tmpl.getRetryConfig());
                            maxRetries = retryJson.path("maxRetries").asInt(0);
                            backoffMs = retryJson.path("backoffMs").asLong(1000);
                            backoffMultiplier = retryJson.path("backoffMultiplier").asDouble(2.0);
                        } catch (Exception e) {
                            log.warn("Failed to parse retry config for node: {}", current.getId());
                        }
                    }

                    // Execute with retry
                    Exception lastError = null;
                    Map<String, Object> lastChanges = null;
                    for (int attempt = 0; attempt <= maxRetries; attempt++) {
                        try {
                            if (attempt > 0) {
                                long sleepMs = (long)(backoffMs * Math.pow(backoffMultiplier, attempt - 1));
                                log.info("Retry attempt {} for node {} (waiting {}ms)", attempt, current.getId(), sleepMs);
                                Thread.sleep(sleepMs);
                            }
                            ctx.put("currentNodeId", currentNodeId);
                            // On resume, the entry node IS the node we paused at (e.g. the long DELAY
                            // whose wait has now elapsed). Signal its handler to not re-wait/re-pause for
                            // this single execution; the flag is scoped to the entry node only and cleared
                            // immediately after so downstream delays behave normally.
                            boolean skipDelayThisNode = isResume && currentNodeId.equals(entryNodeId);
                            if (skipDelayThisNode) {
                                ctx.put("__skip_delay_once", true);
                            }
                            Map<String, Object> changes = handler.handle(ctx, effectiveConfig, templateById, guard);
                            lastChanges = changes;
                            if (skipDelayThisNode) {
                                ctx.remove("__skip_delay_once");
                            }
                            if (changes != null && !changes.isEmpty()) {
                                ctx.putAll(changes);
                                log.info("Node {} updated context with: {}", current.getId(), changes.keySet());

                                // Check if workflow was paused (e.g., by DELAY node for long waits)
                                if (Boolean.TRUE.equals(changes.get("__workflow_paused"))) {
                                    log.info("Workflow paused at node {}. Exiting execution loop. Will be resumed by WorkflowResumeJob.", currentNodeId);
                                    return ctx;
                                }
                            }
                            lastError = null;
                            break; // Success
                        } catch (Exception e) {
                            lastError = e;
                            log.warn("Node {} attempt {} failed: {}", current.getId(), attempt + 1, e.getMessage());
                        }
                    }
                    if (lastError != null) {
                        log.error("Node {} failed after {} retries", current.getId(), maxRetries + 1, lastError);
                        SentryLogger.logError(lastError, "Workflow node failed after all retries",
                                Map.of("workflow.id", workflowId, "node.id", current.getId(),
                                        "node.type", nodeType, "retries", String.valueOf(maxRetries),
                                        "layer", "2-workflow-engine"));
                    }

                    // Record the notification node as executed only when it actually dispatched:
                    // handler completed without throwing AND did not report an error / rate-limit
                    // drop. Mirrored into ctx so a later DELAY pause persists it and the resume
                    // pass will not re-fire sends that already went out.
                    if (isNotificationNode && lastError == null
                            && (lastChanges == null
                                    || (!lastChanges.containsKey("error")
                                            && !"rate_limited".equals(lastChanges.get("status"))))) {
                        executedNotificationNodes.add(currentNodeId);
                        ctx.put(EXECUTED_NOTIFICATION_NODES_KEY, new ArrayList<>(executedNotificationNodes));
                    }
                } else {
                    log.warn("No handler found for node type: {}", nodeType);
                    SentryLogger.logWarning("No handler registered for workflow node type",
                            Map.of("workflow.id", workflowId, "node.id", current.getId(),
                                    "node.type", nodeType, "layer", "2-workflow-engine"));
                }

                // Evaluate routing to find next nodes and push them to stack
                List<String> nextNodeIds = evaluateRoutingNextNodeIds(effectiveConfig, ctx);
                log.info("Routing evaluation for node {} returned: {}", current.getId(), nextNodeIds);

                if (nextNodeIds == null || nextNodeIds.isEmpty()) {
                    log.info("Path execution completed at node: {}", current.getId());
                    // =================== FIX START ===================
                    // This was the bug. A 'break' here would terminate the entire workflow
                    // if one parallel branch ended, even if other branches were still on the stack.
                    // 'continue' allows the loop to proceed with other nodes on the stack.
                    continue;
                    // =================== FIX END =====================
                }

                // Push next nodes to stack in reverse order so they execute in correct order
                // (Stack is LIFO, so we push in reverse to maintain execution order)
                // IMPORTANT: Process ALL routing rules to enable multi-path execution
                for (int i = nextNodeIds.size() - 1; i >= 0; i--) {
                    String nextNodeId = nextNodeIds.get(i);
                    if (nextNodeId != null && !"end".equalsIgnoreCase(nextNodeId)) {
                        // Check if the next node exists in the workflow
                        if (byNodeId.containsKey(nextNodeId)) {
                            nodeExecutionStack.push(nextNodeId);
                            log.info("Pushed next node {} to execution stack (route {})", nextNodeId, i);
                        } else {
                            log.error("Next node {} not found in workflow! Available nodes: {}", nextNodeId,
                                    byNodeId.keySet());
                            SentryLogger.logError(new IllegalStateException("Routing target node not found"),
                                    "Workflow routing points to non-existent node — branch will be dropped",
                                    Map.of("workflow.id", workflowId, "missing.node.id", nextNodeId,
                                            "current.node.id", current.getId(), "layer", "2-workflow-engine"));
                        }
                    }
                }

                // If we have multiple routes, we want to execute them all
                // This enables scenarios like: SendWhatsApp -> SendEmail (both execute)
                if (nextNodeIds.size() > 1) {
                    log.info("Multiple routes detected ({}), all will be executed sequentially", nextNodeIds.size());
                }
            }

            if (guard >= 100) {
                log.warn("Workflow execution stopped due to loop guard limit: {}", workflowId);
                SentryLogger.logWarning("Workflow hit 100-node loop guard — execution stopped early",
                        Map.of("workflow.id", workflowId, "layer", "2-workflow-engine"));
            }

            return ctx;

        } catch (Exception e) {
            log.error("Error executing workflow: {}", workflowId, e);
            SentryLogger.logError(e, "Unhandled exception in workflow engine",
                    Map.of("workflow.id", workflowId, "layer", "2-workflow-engine"));
            return seedContext != null ? seedContext : new HashMap<>();
        }
    }

    private String mergeConfig(String baseJson, String overrideJson) {
        try {
            if (overrideJson == null || overrideJson.isBlank()) {
                return baseJson;
            }
            JsonNode base = objectMapper.readTree(baseJson);
            JsonNode over = objectMapper.readTree(overrideJson);
            JsonNode merged = deepMerge(base, over);
            return objectMapper.writeValueAsString(merged);
        } catch (Exception e) {
            log.error("Error merging configs", e);
            return baseJson;
        }
    }

    private JsonNode deepMerge(JsonNode base, JsonNode over) {
        if (base.isObject() && over.isObject()) {
            Iterator<String> it = over.fieldNames();
            while (it.hasNext()) {
                String f = it.next();
                JsonNode bv = base.get(f);
                JsonNode ov = over.get(f);
                if (bv != null && bv.isObject() && ov.isObject()) {
                    deepMerge(bv, ov);
                } else if (base instanceof com.fasterxml.jackson.databind.node.ObjectNode on) {
                    on.set(f, ov);
                }
            }
        }
        return base;
    }

    private List<String> evaluateRoutingNextNodeIds(String configJson, Map<String, Object> ctx) {
        try {
            JsonNode root = objectMapper.readTree(configJson);
            JsonNode routing = root.path("routing");

            log.info("=== ROUTING EVALUATION START ===");
            log.info("Evaluating routing for config: {}", configJson);
            log.info("Routing node: {}", routing);
            log.info("Context keys: {}", ctx.keySet());

            if (routing.isMissingNode() || !routing.isArray()) {
                log.info("No routing found or routing is not an array - routing.isMissingNode: {}, routing.isArray: {}",
                        routing.isMissingNode(), routing.isArray());
                return Collections.emptyList();
            }

            List<String> allNextNodeIds = new ArrayList<>();

            for (int i = 0; i < routing.size(); i++) {
                JsonNode route = routing.get(i);
                String type = route.path("type").asText("");
                String operation = route.path("operation").asText("");
                String nextNodeId = null;

                log.info("Processing route {} - type: '{}', operation: '{}', route: {}", i, type, operation, route);

                if ("end".equalsIgnoreCase(type)) {
                    log.info("Found end route");
                    // We don't return immediately, in case there are other parallel routes.
                    // An "end" route simply means this path terminates.
                } else if ("goto".equalsIgnoreCase(type)) {
                    nextNodeId = route.path("targetNodeId").asText(null);
                    if (nextNodeId != null) {
                        allNextNodeIds.add(nextNodeId);
                        log.info("Added goto route to nextNodeId: {}", nextNodeId);
                    } else {
                        log.warn("Goto route missing targetNodeId: {}", route);
                    }
                } else if ("conditional".equalsIgnoreCase(type)) {
                    String cond = route.path("condition").asText("");
                    Object val = spelEvaluator.evaluate(cond, ctx);
                    boolean b = (val instanceof Boolean bo) ? bo : Boolean.parseBoolean(String.valueOf(val));
                    nextNodeId = b ? route.path("trueNodeId").asText(null) : route.path("falseNodeId").asText(null);
                    if (nextNodeId != null) {
                        allNextNodeIds.add(nextNodeId);
                        log.info("Added conditional route to nextNodeId: {} (condition: {} = {})", nextNodeId, cond, b);
                    } else {
                        log.warn("Conditional route missing targetNodeId: {}", route);
                    }
                } else if ("switch".equalsIgnoreCase(type)) {
                    // Handle old switch format
                    nextNodeId = evaluateSwitchRouting(route, ctx);
                    if (nextNodeId != null) {
                        allNextNodeIds.add(nextNodeId);
                        log.info("Added switch route to nextNodeId: {}", nextNodeId);
                    } else {
                        log.warn("Switch route evaluation returned null: {}", route);
                    }
                } else if ("SWITCH".equalsIgnoreCase(operation)) {
                    // Handle new SWITCH operation format
                    nextNodeId = evaluateSwitchOperationRouting(route, ctx);
                    if (nextNodeId != null) {
                        allNextNodeIds.add(nextNodeId);
                        log.info("Added SWITCH operation route to nextNodeId: {}", nextNodeId);
                    } else {
                        log.warn("SWITCH operation route evaluation returned null: {}", route);
                    }
                } else {
                    log.warn("Unknown route type/operation: type='{}', operation='{}'", type, operation);
                }
            }

            log.info("Final nextNodeIds: {}", allNextNodeIds);
            log.info("=== ROUTING EVALUATION END ===");
            return allNextNodeIds;

        } catch (Exception e) {
            log.error("Error evaluating routing", e);
            return Collections.emptyList();
        }
    }

    /**
     * Evaluate switch routing for old format (type: "switch")
     */
    private String evaluateSwitchRouting(JsonNode route, Map<String, Object> ctx) {
        String expr = route.path("expression").asText("");
        Object key = spelEvaluator.evaluate(expr, ctx);
        for (JsonNode c : route.path("cases")) {
            if (Objects.equals(String.valueOf(key), c.path("value").asText())) {
                String nextNodeId = c.path("targetNodeId").asText(null);
                if (nextNodeId != null) {
                    return nextNodeId;
                }
            }
        }
        String nextNodeId = route.path("defaultNodeId").asText(null);
        return nextNodeId;
    }

    /**
     * Evaluate switch operation routing for new format (operation: "SWITCH")
     */
    private String evaluateSwitchOperationRouting(JsonNode route, Map<String, Object> ctx) {
        String onExpr = route.path("on").asText("");
        if (onExpr.isBlank()) {
            log.warn("SWITCH operation missing 'on' expression");
            return null;
        }

        // Evaluate the switch expression
        Object switchValue = spelEvaluator.evaluate(onExpr, ctx);
        String key = String.valueOf(switchValue);
        log.info("SWITCH operation evaluating '{}' to key: '{}'", onExpr, key);

        // Find matching case
        JsonNode cases = route.path("cases");
        log.info("SWITCH cases: {}", cases);

        if (cases.isObject()) {
            JsonNode selectedCase = cases.get(key);
            log.info("SWITCH selected case for key '{}': {}", key, selectedCase);

            if (selectedCase != null) {
                // Handle nested structure: {"type": "goto", "targetNodeId": "node_id"}
                if (selectedCase.has("type") && selectedCase.has("targetNodeId")) {
                    String caseType = selectedCase.path("type").asText("");
                    String nextNodeId = selectedCase.path("targetNodeId").asText(null);

                    log.info("SWITCH case has nested structure - type: '{}', targetNodeId: '{}'", caseType, nextNodeId);

                    if ("goto".equalsIgnoreCase(caseType) && nextNodeId != null) {
                        log.info("SWITCH operation found matching case for key '{}': {} (nested format)", key,
                                nextNodeId);
                        return nextNodeId;
                    } else {
                        log.warn(
                                "SWITCH operation case has invalid type or missing targetNodeId: type='{}', targetNodeId='{}'",
                                caseType, nextNodeId);
                    }
                } else {
                    // Handle direct targetNodeId (old format)
                    String nextNodeId = selectedCase.path("targetNodeId").asText(null);
                    log.info("SWITCH case has direct format - targetNodeId: '{}'", nextNodeId);

                    if (nextNodeId != null) {
                        log.info("SWITCH operation found matching case for key '{}': {} (direct format)", key,
                                nextNodeId);
                        return nextNodeId;
                    }
                }
            } else {
                log.warn("SWITCH operation no case found for key: '{}'", key);
            }
        } else {
            log.warn("SWITCH operation cases is not an object: {}", cases);
        }

        // Check for default case
        JsonNode defaultCase = route.path("default");
        log.info("SWITCH default case: {}", defaultCase);

        if (!defaultCase.isMissingNode()) {
            // Handle nested structure for default case too
            if (defaultCase.has("type") && defaultCase.has("targetNodeId")) {
                String caseType = defaultCase.path("type").asText("");
                String nextNodeId = defaultCase.path("targetNodeId").asText(null);

                log.info("SWITCH default case has nested structure - type: '{}', targetNodeId: '{}'", caseType,
                        nextNodeId);

                if ("goto".equalsIgnoreCase(caseType) && nextNodeId != null) {
                    log.info("SWITCH operation using default case: {} (nested format)", nextNodeId);
                    return nextNodeId;
                }
            } else {
                // Handle direct targetNodeId for default case
                String nextNodeId = defaultCase.path("targetNodeId").asText(null);
                log.info("SWITCH default case has direct format - targetNodeId: '{}'", nextNodeId);

                if (nextNodeId != null) {
                    log.info("SWITCH operation using default case: {} (direct format)", nextNodeId);
                    return nextNodeId;
                }
            }
        }

        log.warn("SWITCH operation no matching case found for key: '{}' and no valid default case", key);
        return null;
    }
}