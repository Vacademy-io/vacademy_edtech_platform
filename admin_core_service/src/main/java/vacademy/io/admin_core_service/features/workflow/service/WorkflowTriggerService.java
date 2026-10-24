package vacademy.io.admin_core_service.features.workflow.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowTriggerRepository;
import vacademy.io.common.logging.SentryLogger;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@Slf4j
public class WorkflowTriggerService {

    @Autowired
    private WorkflowTriggerRepository workflowTriggerRepository;

    @Autowired
    private WorkflowEngineService workflowEngineService;

    @Autowired
    private IdempotencyService idempotencyService;

    @Autowired
    private vacademy.io.admin_core_service.features.workflow.repository.WorkflowNodeMappingRepository workflowNodeMappingRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.workflow.service.idempotency.IdempotencyStrategyFactory idempotencyStrategyFactory;

    @Autowired
    private vacademy.io.admin_core_service.features.workflow.util.WorkflowSubjectResolver workflowSubjectResolver;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Map<String, Object> handleTriggerEvents(String eventName, String eventId, String instituteId,
            Map<String, Object> contextData) {
        log.info("---- Workflow Trigger Event START ----");
        log.info("Incoming trigger params: eventName='{}', eventId='{}', instituteId='{}'", eventName, eventId,
                instituteId);
        Map<String, Object> response = new HashMap<>();
        try {
            // Log context data if present
            if (contextData == null || contextData.isEmpty()) {
                log.warn("Context data is EMPTY or NULL");
            } else {
                log.info("Context data received ({} keys): {}", contextData.size(), contextData);
            }

            // Priority-based matching: specific triggers take priority over global ones
            List<String> activeStatuses = List.of(StatusEnum.ACTIVE.name());

            List<WorkflowTrigger> triggers;

            // Step 1: If eventId is provided, look for specific triggers first (priority)
            if (eventId != null && !eventId.isEmpty()) {
                log.info("Looking for SPECIFIC triggers: instituteId='{}', eventId='{}', eventType='{}'",
                        instituteId, eventId, eventName);
                triggers = workflowTriggerRepository
                        .findSpecificTriggers(instituteId, eventId, eventName, activeStatuses);

                if (!triggers.isEmpty()) {
                    log.info("Found {} SPECIFIC triggers for eventId='{}'. Global triggers will be skipped.",
                            triggers.size(), eventId);
                } else {
                    // No specific triggers — fall back to global
                    log.info("No specific triggers found. Falling back to GLOBAL triggers for event='{}'", eventName);
                    triggers = workflowTriggerRepository
                            .findGlobalTriggers(instituteId, eventName, activeStatuses);
                    log.info("Found {} GLOBAL triggers for event='{}'", triggers.size(), eventName);
                }
            } else {
                // No eventId — only look for global triggers
                log.info("No eventId provided. Looking for GLOBAL triggers for event='{}'", eventName);
                triggers = workflowTriggerRepository
                        .findGlobalTriggers(instituteId, eventName, activeStatuses);
                log.info("Found {} GLOBAL triggers for event='{}'", triggers.size(), eventName);
            }

            // Pool-scoped triggers fire IN ADDITION to institute-level ones (stack).
            // A pool trigger is modelled like any other entity-scoped trigger: its eventId
            // holds the pool's id (event_applied_type = POOL), mirroring how PACKAGE_SESSION /
            // LIVE_SESSION / AUDIENCE scope by their entity id. A lead's pool is resolved
            // upstream (from its audience) and passed on the context as 'poolId'; when present
            // we look those up by eventId = poolId and union them with the matches above.
            // Pool ids are UUIDs, so an eventId = poolId match never collides with lead/audience
            // ids. The id de-dup guards against any accidental overlap.
            Object poolIdObj = contextData == null ? null : contextData.get("poolId");
            if (poolIdObj != null && !poolIdObj.toString().isBlank()) {
                String poolId = poolIdObj.toString();
                log.info("Looking for POOL triggers: instituteId='{}', poolId='{}', eventType='{}'",
                        instituteId, poolId, eventName);
                List<WorkflowTrigger> poolTriggers = workflowTriggerRepository
                        .findSpecificTriggers(instituteId, poolId, eventName, activeStatuses);
                log.info("Found {} POOL triggers for poolId='{}', event='{}'",
                        poolTriggers.size(), poolId, eventName);
                if (!poolTriggers.isEmpty()) {
                    java.util.Set<String> seen = new java.util.HashSet<>();
                    for (WorkflowTrigger t : triggers) {
                        seen.add(t.getId());
                    }
                    // triggers may be an immutable list from the repo — copy into a mutable one.
                    triggers = new java.util.ArrayList<>(triggers);
                    for (WorkflowTrigger pt : poolTriggers) {
                        if (seen.add(pt.getId())) {
                            triggers.add(pt);
                            log.info("Stacking POOL trigger: TriggerId='{}', WorkflowId='{}'",
                                    pt.getId(), pt.getWorkflow().getId());
                        }
                    }
                }
            } else {
                log.debug("No poolId on ctx — skipping POOL trigger lookup");
            }

            log.info("Total {} triggers to execute for event='{}', eventId='{}', instituteId='{}'",
                    triggers.size(), eventName, eventId, instituteId);

            if (triggers.isEmpty()) {
                log.info("No ACTIVE workflow triggers found. Exiting execution.");
                log.info("---- Workflow Trigger Event END ----");
                return response;
            }

            int count = 0;

            for (WorkflowTrigger trigger : triggers) {
                count++;
                log.info("Processing trigger {} of {} | TriggerId='{}', TriggerEventName='{}', WorkflowId='{}'",
                        count, triggers.size(), trigger.getId(), trigger.getTriggerEventName(),
                        trigger.getWorkflow().getId());

                // Declared outside the try so the failure path below marks the SAME execution.
                // Re-generating the key there is wrong for non-deterministic strategies (UUID,
                // the default): the new key matches no row, markAsFailed finds nothing, and the
                // execution is left PROCESSING forever.
                String idempotencyKey = null;
                try {
                    // Generate idempotency key based on trigger's configuration
                    try {
                        idempotencyKey = idempotencyStrategyFactory.generateKey(
                                trigger, eventName, eventId, contextData);
                        log.info("Generated idempotency key: {} for trigger: {}", idempotencyKey, trigger.getId());
                    } catch (Exception e) {
                        log.error("Failed to generate idempotency key for trigger: {}", trigger.getId(), e);
                        SentryLogger.SentryEventBuilder.error(e)
                                .withMessage("Failed to generate idempotency key")
                                .withTag("trigger.id", trigger.getId())
                                .withTag("trigger.event", eventName)
                                .withTag("institute.id", instituteId)
                                .send();
                        recordKeyGenerationFailure(trigger, eventName, eventId, instituteId, contextData, e);
                        continue; // Skip this trigger
                    }

                    // Try to mark as processing (will fail if duplicate key exists)
                    vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution execution;
                    try {
                        execution = idempotencyService.markAsProcessingForTrigger(
                                idempotencyKey,
                                trigger.getWorkflow().getId(),
                                trigger.getId());
                        log.info("Marked workflow execution as PROCESSING (EVENT_DRIVEN): {}", execution.getId());
                    } catch (org.springframework.dao.DataIntegrityViolationException e) {
                        log.warn(
                                "Workflow already executed or in progress (duplicate idempotency key): {} for trigger: {}",
                                idempotencyKey, trigger.getId());
                        continue; // Skip duplicate execution
                    }

                    // Build seed context
                    Map<String, Object> seedContext = new HashMap<>(
                            Optional.ofNullable(contextData).orElse(new HashMap<>()));
                    seedContext.put("triggerEvents", eventName);
                    seedContext.put("triggerId", trigger.getId());
                    seedContext.put("instituteId", instituteId);
                    seedContext.put("executionId", execution.getId());
                    seedContext.put("eventId", eventId);
                    if (trigger.getEventAppliedType() != null) {
                        seedContext.put("eventAppliedType", trigger.getEventAppliedType());
                    }
                    // Flag whether this is a global trigger (event_id IS NULL in DB)
                    seedContext.put("isGlobalTrigger", trigger.getEventId() == null);
                    // ISO-8601 timestamp of when this trigger fired. Available on the
                    // context as #ctx['triggerTime'] for HTTP_REQUEST bodies, SEND_EMAIL
                    // templates, etc. — handlers that need "when did this happen" no
                    // longer have to compute it themselves or rely on T(java.time.Instant)
                    // SpEL (which the body evaluator doesn't pick up).
                    seedContext.put("triggerTime", Instant.now().toString());
                    log.info("Seed context prepared for workflow run ({} keys): {}", seedContext.size(), seedContext);

                    // Record WHO this run is for and WHAT it started from, before running it.
                    // Written up-front so a run that crashes mid-way still shows up on the
                    // learner's Workflows tab (as FAILED) and can still be retried — recording
                    // it after the run would lose exactly the failures worth retrying.
                    recordRunSubject(execution.getId(), seedContext);

                    log.info("Starting workflowEngineService.run for workflowId='{}'", trigger.getWorkflow().getId());

                    // Execute workflow
                    Map<String, Object> result = workflowEngineService.run(trigger.getWorkflow().getId(), seedContext);

                    log.info("Workflow execution completed for workflowId='{}'", trigger.getWorkflow().getId());

                    // Mark as completed
                    idempotencyService.markAsCompleted(idempotencyKey, result);
                    response.putAll(result);

                } catch (Exception ex) {
                    log.error("Error executing workflowId='{}' for triggerId='{}'",
                            trigger.getWorkflow().getId(), trigger.getId(), ex);

                    // Mark as failed — on the key that created the execution, never a fresh one.
                    try {
                        if (idempotencyKey != null) {
                            idempotencyService.markAsFailed(idempotencyKey, ex.getMessage());
                        }
                    } catch (Exception e) {
                        log.error("Failed to mark execution as failed", e);
                    }

                    SentryLogger.SentryEventBuilder.error(ex)
                            .withMessage("Workflow execution failed for trigger")
                            .withTag("workflow.id", trigger.getWorkflow().getId().toString())
                            .withTag("trigger.id", trigger.getId().toString())
                            .withTag("trigger.event", eventName)
                            .withTag("institute.id", instituteId)
                            .withTag("operation", "workflowExecution")
                            .send();
                }
            }

            log.info("Completed processing {} workflow triggers.", triggers.size());
            return response;
        } catch (Exception e) {
            log.error("Unexpected error while processing trigger event='{}', eventId='{}'", eventName, eventId, e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Unexpected error during trigger event processing")
                    .withTag("trigger.event", eventName)
                    .withTag("event.id", eventId)
                    .withTag("institute.id", instituteId)
                    .withTag("operation", "handleTriggerEvents")
                    .send();
        }

        log.info("---- Workflow Trigger Event END ----");
        return response;
    }

    /**
     * Record which learner a run is for, and the inputs it started from, so the run can be
     * listed on that learner's Workflows tab and retried from there.
     *
     * <p>Wholly best-effort and wholly swallowed. It sits inside the per-trigger try block,
     * whose catch marks the execution FAILED and moves on — so an exception escaping here
     * would fail a workflow that was about to run perfectly well. This is bookkeeping for a
     * UI tab; it is never a reason not to run the automation. The worst outcome of a failure
     * is one run missing from one tab.</p>
     */
    /**
     * A trigger whose idempotency expression cannot be evaluated (typically a CUSTOM_EXPRESSION
     * naming a context key the event never emits, e.g. {@code #ctx['lead']['id']}) used to be
     * skipped with nothing but a log line — the workflow showed zero executions and the admin had
     * no way to see why. Record a FAILED execution instead so it shows up in the Executions tab
     * and on the learner's Workflows tab with the real cause. Best-effort: this must never throw
     * back into the emitter.
     */
    private void recordKeyGenerationFailure(WorkflowTrigger trigger, String eventName, String eventId,
            String instituteId, Map<String, Object> contextData, Exception cause) {
        try {
            String surrogateKey = "idempotency_error_" + java.util.UUID.randomUUID();
            vacademy.io.admin_core_service.features.workflow.entity.WorkflowExecution execution =
                    idempotencyService.markAsProcessingForTrigger(
                            surrogateKey, trigger.getWorkflow().getId(), trigger.getId());
            Map<String, Object> seedContext = new HashMap<>(
                    Optional.ofNullable(contextData).orElse(new HashMap<>()));
            seedContext.put("triggerEvents", eventName);
            seedContext.put("triggerId", trigger.getId());
            seedContext.put("instituteId", instituteId);
            seedContext.put("executionId", execution.getId());
            seedContext.put("eventId", eventId);
            recordRunSubject(execution.getId(), seedContext);
            Throwable root = cause;
            while (root.getCause() != null && root.getCause() != root) {
                root = root.getCause();
            }
            String message = "Idempotency key could not be generated from the trigger's "
                    + "idempotency_generation_setting — the workflow did not run. "
                    + "Check that every #ctx[...] key in the expression is emitted by " + eventName
                    + ". Cause: " + root.getMessage();
            idempotencyService.markAsFailed(surrogateKey, message.length() > 2000 ? message.substring(0, 2000) : message);
            log.warn("Recorded FAILED execution {} for trigger {} (idempotency key generation failed)",
                    execution.getId(), trigger.getId());
        } catch (Exception e) {
            log.error("Could not record idempotency-failure execution for trigger {}", trigger.getId(), e);
        }
    }

    private void recordRunSubject(String executionId, Map<String, Object> seedContext) {
        try {
            idempotencyService.recordSubjectAndContext(
                    executionId,
                    workflowSubjectResolver.resolveSubjectUserId(seedContext),
                    workflowSubjectResolver.toStorableContext(seedContext));
        } catch (Exception e) {
            log.warn("Could not record workflow run subject for execution {} — continuing with the run: {}",
                    executionId, e.getMessage());
        }
    }

    /**
     * Resolve which triggers would fire for an event, applying the SAME precedence rules as
     * {@link #handleTriggerEvents}: specific (eventId) triggers take priority over global
     * (eventId IS NULL) ones, and pool-scoped triggers (contextData['poolId']) stack on top.
     * Read-only; kept quiet (no dispatch logging). If the precedence in handleTriggerEvents
     * ever changes, update this in lockstep.
     */
    private List<WorkflowTrigger> resolveTriggers(String eventName, String eventId, String instituteId,
            Map<String, Object> contextData) {
        List<String> activeStatuses = List.of(StatusEnum.ACTIVE.name());
        List<WorkflowTrigger> triggers;

        if (eventId != null && !eventId.isEmpty()) {
            triggers = workflowTriggerRepository.findSpecificTriggers(instituteId, eventId, eventName, activeStatuses);
            if (triggers.isEmpty()) {
                triggers = workflowTriggerRepository.findGlobalTriggers(instituteId, eventName, activeStatuses);
            }
        } else {
            triggers = workflowTriggerRepository.findGlobalTriggers(instituteId, eventName, activeStatuses);
        }

        Object poolIdObj = contextData == null ? null : contextData.get("poolId");
        if (poolIdObj != null && !poolIdObj.toString().isBlank()) {
            String poolId = poolIdObj.toString();
            List<WorkflowTrigger> poolTriggers = workflowTriggerRepository
                    .findSpecificTriggers(instituteId, poolId, eventName, activeStatuses);
            if (!poolTriggers.isEmpty()) {
                java.util.Set<String> seen = new java.util.HashSet<>();
                for (WorkflowTrigger t : triggers) {
                    seen.add(t.getId());
                }
                triggers = new java.util.ArrayList<>(triggers);
                for (WorkflowTrigger pt : poolTriggers) {
                    if (seen.add(pt.getId())) {
                        triggers.add(pt);
                    }
                }
            }
        }
        return triggers;
    }

    /**
     * True if the workflow(s) that fire for this event already send the admin-notification
     * email (a SEND_EMAIL node bound to {@code adminEmailRequests}). Callers that also carry
     * a to_notify admin list (e.g. the audience submit paths) use this to decide whether they
     * must send that admin alert directly — the direct send only runs when this returns false,
     * so audiences whose workflow already includes an admin-notify node are not double-emailed.
     */
    @Transactional(readOnly = true)
    public boolean anyResolvedWorkflowSendsAdminEmail(String eventName, String eventId, String instituteId,
            Map<String, Object> contextData) {
        List<WorkflowTrigger> triggers = resolveTriggers(eventName, eventId, instituteId, contextData);
        if (triggers == null || triggers.isEmpty()) {
            return false;
        }
        List<String> workflowIds = triggers.stream()
                .map(t -> t.getWorkflow() == null ? null : t.getWorkflow().getId())
                .filter(java.util.Objects::nonNull)
                .distinct()
                .collect(java.util.stream.Collectors.toList());
        if (workflowIds.isEmpty()) {
            return false;
        }
        return workflowNodeMappingRepository.existsAdminEmailNodeInWorkflows(workflowIds);
    }

    public Optional<WorkflowTrigger> findByInstituteIdEventNameAndEventId(String instituteId, String eventName,
            String eventId) {
        List<String> activeStatuses = List.of(StatusEnum.ACTIVE.name());

        // Check specific triggers first
        List<WorkflowTrigger> res = workflowTriggerRepository.findSpecificTriggers(
                instituteId, eventId, eventName, activeStatuses);

        // Fall back to global triggers if no specific ones found
        if (res.isEmpty()) {
            res = workflowTriggerRepository.findGlobalTriggers(instituteId, eventName, activeStatuses);
        }

        if (!res.isEmpty()) {
            return Optional.of(res.get(0));
        }
        return Optional.empty();
    }
}
