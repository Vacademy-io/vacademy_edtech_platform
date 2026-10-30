package vacademy.io.admin_core_service.features.workflow.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.dto.ForEachConfigDTO;
import vacademy.io.admin_core_service.features.workflow.dto.SendEmailNodeDTO;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;
import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.enums.NodeType;
import vacademy.io.admin_core_service.features.workflow.dto.execution_log.EmailExecutionDetails;
import vacademy.io.common.logging.SentryLogger;

import vacademy.io.admin_core_service.features.workflow.service.NotificationRateLimitService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWorkflowSuppression;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
@Service
@RequiredArgsConstructor
public class SendEmailNodeHandler implements NodeHandler {

    private final ObjectMapper objectMapper;
    private final SpelEvaluator spelEvaluator;
    private final NotificationService notificationService;
    private final TemplateRepository templateRepository;
    private final WorkflowExecutionLogger executionLogger;
    private final NotificationRateLimitService rateLimitService;

    /** Holds lead nurture back from leads an engagement engine is working. Optional: absent = no hold. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private EngagementWorkflowSuppression engagementSuppression;
    private final Map<String, Template> templateCache = new java.util.concurrent.ConcurrentHashMap<>();

    // Throttling defaults — workflows that fan out to many recipients (e.g., a batch
    // of 500 students) can overwhelm the notification service / SMTP provider if
    // dispatched as a single API call. We chunk users per batch, sleep between chunks,
    // and enforce a per-chunk timeout so a hung backend doesn't block the workflow
    // thread indefinitely. All three values can be overridden per-node via config:
    //   "chunkSize": 100, "throttleMs": 500, "chunkTimeoutMs": 60000
    private static final int DEFAULT_CHUNK_SIZE = 50;
    private static final long DEFAULT_THROTTLE_MS = 200L;
    private static final long DEFAULT_CHUNK_TIMEOUT_MS = 30_000L; // 30 seconds per chunk send

    // Daemon thread pool dedicated to chunked sends. We need a separate thread so we
    // can abandon a hung notification call via Future.cancel(). Cached pool reclaims
    // idle threads automatically. Daemon = won't block JVM shutdown.
    private final ExecutorService chunkExecutor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "send-email-chunk");
        t.setDaemon(true);
        return t;
    });

    @Override
    public boolean supports(String nodeType) {
        return "SEND_EMAIL".equalsIgnoreCase(nodeType);
    }

    @Override
    public Map<String, Object> handle(Map<String, Object> context,
            String nodeConfigJson,
            Map<String, NodeTemplate> nodeTemplates,
            int countProcessed) {

        log.info("SendEmailNodeHandler.handle() invoked.");

        // Dry-run check: skip actual email sending but log the intent
        Boolean dryRun = (Boolean) context.getOrDefault("dryRun", false);
        if (Boolean.TRUE.equals(dryRun)) {
            log.info("[DRY RUN] SendEmailNodeHandler - skipping actual email send. Config: {}", nodeConfigJson);
            Map<String, Object> dryRunResult = new HashMap<>();
            dryRunResult.put("dryRun", true);
            dryRunResult.put("skipped", "email_send");
            dryRunResult.put("details", "Email send skipped in dry-run mode. Config: " + nodeConfigJson);
            return dryRunResult;
        }

        String workflowExecutionId = (String) context.get("executionId");
        String nodeId = (String) context.get("currentNodeId");

        // Start logging
        // Start logging
        String logId = null;
        long startTime = System.currentTimeMillis();
        if (workflowExecutionId != null && nodeId != null) {
            logId = executionLogger.startNodeExecution(workflowExecutionId, nodeId, NodeType.SEND_EMAIL,
                    context);
        }

        Map<String, Object> changes = new HashMap<>();
        int processedCount = 0;
        int skippedCount = 0;
        int failedCount = 0;

        String instituteId = (String) context.get("instituteId");
        if (!StringUtils.hasText(instituteId)) {
            instituteId = (String) context.get("instituteIdForWhatsapp");
            if (!StringUtils.hasText(instituteId)) {
                log.warn("SendEmailNode missing 'instituteId' from context");
                changes.put("status", "error");
                changes.put("error", "Missing 'instituteId' from context");

                if (logId != null) {
                    executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                            "Missing 'instituteId' from context");
                }
                return changes;
            }
        }
        final String finalInstituteId = instituteId; // For use in streams/lambdas

        try {
            SendEmailNodeDTO sendEmailNodeDTO = objectMapper.readValue(nodeConfigJson, SendEmailNodeDTO.class);
            String onExpression = sendEmailNodeDTO.getOn();
            if (onExpression == null || onExpression.isBlank()) {
                log.warn("SendEmailNode missing 'on' expression");
                changes.put("status", "error");
                changes.put("error", "Missing 'on' expression");

                if (logId != null) {
                    executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                            "Missing 'on' expression");
                }
                return changes;
            }

            Object listObj = spelEvaluator.evaluate(onExpression, context);
            if (listObj == null) {
                log.warn("No list found for expression: {}", onExpression);
                changes.put("status", "no_items_found");

                if (logId != null) {
                    EmailExecutionDetails details = EmailExecutionDetails.builder()
                            .inputContext(executionLogger.sanitizeContext(context))
                            .outputContext(executionLogger.sanitizeContext(changes))
                            .successCount(0)
                            .failureCount(0)
                            .skippedCount(0)
                            .executionTimeMs(System.currentTimeMillis() - startTime)
                            .build();
                    executionLogger.completeNodeExecution(logId, ExecutionLogStatus.SUCCESS, details,
                            null);
                }
                return changes;
            }

            List<Object> items = new ArrayList<>();
            if (listObj instanceof List) {
                items = (List<Object>) listObj;
            } else if (listObj instanceof Collection) {
                items = new ArrayList<>((Collection<?>) listObj);
            } else {
                log.warn("Expression '{}' did not evaluate to a list: {}", onExpression, listObj.getClass());
                changes.put("status", "error");
                changes.put("error", "Expression did not evaluate to a list");

                if (logId != null) {
                    executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                            "Expression did not evaluate to a list");
                }
                return changes;
            }

            log.info("Processing {} items for email sending", items.size());

            // 1. Create all individual email "requests" (raw data maps)
            List<Map<String, Object>> allEmailRequests = new ArrayList<>();
            List<EmailExecutionDetails.FailedEmail> failedEmails = new ArrayList<>();

            // Get node-level config: templateName, templateVars, recipientField, chunkSize, throttleMs, chunkTimeoutMs
            String nodeLevelTemplateName = null;
            Map<String, Object> nodeLevelTemplateVars = null;
            String nodeLevelRecipientField = null; // e.g., "parentsEmail" to send to parents instead of students
            int chunkSize = DEFAULT_CHUNK_SIZE;
            long throttleMs = DEFAULT_THROTTLE_MS;
            long chunkTimeoutMs = DEFAULT_CHUNK_TIMEOUT_MS;
            try {
                com.fasterxml.jackson.databind.JsonNode configRoot = objectMapper.readTree(nodeConfigJson);
                if (configRoot.has("templateName") && !configRoot.get("templateName").asText("").isBlank()) {
                    nodeLevelTemplateName = configRoot.get("templateName").asText();
                }
                if (configRoot.has("recipientField") && !configRoot.get("recipientField").asText("").isBlank()) {
                    nodeLevelRecipientField = configRoot.get("recipientField").asText();
                }
                if (configRoot.has("templateVars") && configRoot.get("templateVars").isObject()) {
                    nodeLevelTemplateVars = objectMapper.convertValue(configRoot.get("templateVars"), Map.class);
                }
                if (configRoot.has("chunkSize") && configRoot.get("chunkSize").isInt()) {
                    int cs = configRoot.get("chunkSize").asInt();
                    if (cs > 0) chunkSize = cs;
                }
                if (configRoot.has("throttleMs") && configRoot.get("throttleMs").canConvertToLong()) {
                    long t = configRoot.get("throttleMs").asLong();
                    if (t >= 0) throttleMs = t;
                }
                if (configRoot.has("chunkTimeoutMs") && configRoot.get("chunkTimeoutMs").canConvertToLong()) {
                    long t = configRoot.get("chunkTimeoutMs").asLong();
                    if (t > 0) chunkTimeoutMs = t;
                }
            } catch (Exception e) {
                log.warn("Failed to parse node-level template config", e);
            }

            for (Object item : items) {
                Map<String, Object> itemContext = new HashMap<>(context);

                // If node config has a recipientField, store it in context for extractEmailAddress
                if (nodeLevelRecipientField != null) {
                    itemContext.put("_recipientField", nodeLevelRecipientField);
                }

                // If node config has a templateName, inject it into the item so the handler uses the template
                // instead of the item's pre-built subject/body.
                // Items can be either Maps (typical — DB rows / JSON objects) OR Java beans
                // (e.g. UserDTO when the workflow iterates over a single user from the trigger
                // context via SpEL like `{#ctx['user']}`). For beans we convert to Map first so
                // (a) we can attach templateName/templateVars and (b) downstream Map.get() lookups
                // (recipient extraction at line 1054, field substitution at line 926) work.
                if (nodeLevelTemplateName != null) {
                    Map<String, Object> enrichedItem;
                    if (item instanceof Map) {
                        enrichedItem = new HashMap<>((Map<String, Object>) item);
                    } else {
                        try {
                            enrichedItem = objectMapper.convertValue(item, Map.class);
                            if (enrichedItem == null) enrichedItem = new HashMap<>();
                        } catch (Exception e) {
                            log.warn("Could not convert iteration item ({}) to Map; falling back to empty enriched item: {}",
                                    item != null ? item.getClass().getSimpleName() : "null", e.getMessage());
                            enrichedItem = new HashMap<>();
                        }
                    }
                    enrichedItem.put("templateName", nodeLevelTemplateName);
                    if (nodeLevelTemplateVars != null) {
                        enrichedItem.put("templateVars", nodeLevelTemplateVars);
                    }
                    itemContext.put("item", enrichedItem);
                } else {
                    itemContext.put("item", item);
                }

                List<Map<String, Object>> itemRequests = processForEachOperation(sendEmailNodeDTO.getForEach(),
                        itemContext, item, failedEmails);
                if (itemRequests != null && !itemRequests.isEmpty()) {
                    allEmailRequests.addAll(itemRequests);
                }
            }

            // --- BATCHING AND DEDUPLICATION LOGIC ---
            if (!allEmailRequests.isEmpty()) {

                // Batch maps
                Map<String, NotificationDTO> regularBatchMap = new HashMap<>();
                Map<String, AttachmentNotificationDTO> attachmentBatchMap = new HashMap<>();

                // Deduplication set
                Set<String> sentLog = new HashSet<>();
                List<String> emailResults = new ArrayList<>();

                // Leads an engagement engine is working right now: the engine owns their outreach, so
                // a nurture workflow skips them (transactional and learner sends are never held).
                Set<String> engagedEmails = engagementSuppression != null
                        && EngagementWorkflowSuppression.appliesTo(context)
                        ? engagementSuppression.engagedLeadEmails(finalInstituteId) : Set.of();

                // Map to store original items for failure tracking
                Map<String, Object> recipientToItemMap = new HashMap<>();

                for (Map<String, Object> request : allEmailRequests) {
                    String recipient = (String) request.get("recipient");
                    String subject = (String) request.get("subject");
                    String type = (String) request.getOrDefault("type", "REGULAR");
                    Object originalItem = request.get("_originalItem");

                    if (recipient == null || recipient.isBlank()) {
                        log.warn("Skipping email request, recipient is null or blank.");
                        skippedCount++;
                        failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                                .recipientEmail(recipient)
                                .errorMessage("Recipient is null or blank")
                                .errorType("VALIDATION_ERROR")
                                .failureReason("SKIPPED")
                                .itemData(originalItem)
                                .build());
                        continue;
                    }

                    if (!engagedEmails.isEmpty()
                            && engagedEmails.contains(EngagementWorkflowSuppression.emailKey(recipient))) {
                        log.info("Skipping email to {}: lead is inside an engagement engine, which owns its outreach.",
                                recipient);
                        skippedCount++;
                        failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                                .recipientEmail(recipient)
                                .errorMessage("Lead is inside an engagement engine; the engine owns its outreach")
                                .errorType("ENGAGEMENT_ENGINE")
                                .failureReason("SKIPPED")
                                .itemData(originalItem)
                                .build());
                        continue;
                    }

                    // --- Deduplication Check ---
                    String dedupeKey = recipient + "::" + subject;
                    if (sentLog.contains(dedupeKey)) {
                        log.warn("Duplicate email request for {} with subject ''{}''. Skipping.", recipient, subject);
                        skippedCount++;
                        failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                                .recipientEmail(recipient)
                                .errorMessage("Duplicate request")
                                .errorType("DUPLICATE")
                                .failureReason("SKIPPED")
                                .itemData(originalItem)
                                .build());
                        continue; // Already added this user for this template
                    }
                    sentLog.add(dedupeKey);
                    // --- End Deduplication ---

                    // Store item for failure tracking
                    if (originalItem != null) {
                        recipientToItemMap.put(recipient, originalItem);
                    }

                    processedCount++;

                    // --- Batching by Type ---
                    if ("ATTACHMENT_EMAIL".equals(type)) {
                        String body = (String) request.get("body");
                        String attachmentName = (String) request.get("attachmentName");
                        String attachmentBase64 = (String) request.get("attachmentBase64");
                        Map<String, String> placeholders = (Map<String, String>) request.get("placeholders");

                        // Group by subject + body + attachmentName
                        String groupingKey = subject + "||" + body + "||" + attachmentName;

                        AttachmentNotificationDTO batchDTO = attachmentBatchMap.computeIfAbsent(groupingKey,
                                k -> AttachmentNotificationDTO.builder()
                                        .subject(subject)
                                        .body(body)
                                        .notificationType("EMAIL")
                                        .source("WORKFLOW")
                                        .sourceId("send_attachment_email_batch")
                                        .users(new ArrayList<>())
                                        .build());

                        AttachmentUsersDTO userDTO = new AttachmentUsersDTO();
                        userDTO.setChannelId(recipient);
                        // Use actual userId if available, fall back to recipient email
                        String attachUserIdStr = (String) request.get("userId");
                        userDTO.setUserId(attachUserIdStr != null ? attachUserIdStr : recipient);
                        userDTO.setPlaceholders(placeholders); // Add placeholders

                        AttachmentUsersDTO.AttachmentDTO attachment = new AttachmentUsersDTO.AttachmentDTO();
                        attachment.setAttachmentName(attachmentName);
                        attachment.setAttachment(attachmentBase64);
                        userDTO.setAttachments(List.of(attachment));

                        batchDTO.getUsers().add(userDTO);

                    } else { // "REGULAR" email
                        String body = (String) request.get("body");
                        Map<String, String> placeholders = (Map<String, String>) request.get("placeholders");
                        String groupingKey = subject + "||" + body;

                        NotificationDTO batchDTO = regularBatchMap.computeIfAbsent(groupingKey, k -> {
                            NotificationDTO newDto = new NotificationDTO();
                            newDto.setSubject(subject);
                            newDto.setBody(body);
                            newDto.setNotificationType("EMAIL");
                            newDto.setSource("WORKFLOW");
                            newDto.setSourceId("send_email_node_batch");
                            newDto.setUsers(new ArrayList<>());
                            return newDto;
                        });

                        NotificationToUserDTO userDTO = new NotificationToUserDTO();
                        userDTO.setChannelId(recipient);
                        // Use actual userId if available, fall back to recipient email
                        String regularUserIdStr = (String) request.get("userId");
                        userDTO.setUserId(regularUserIdStr != null ? regularUserIdStr : recipient);
                        userDTO.setPlaceholders(placeholders != null ? placeholders : Map.of("email", recipient));

                        batchDTO.getUsers().add(userDTO);
                    }
                }

                // --- Send Regular Email Batches ---
                if (!regularBatchMap.isEmpty()) {
                    // Rate limit check
                    int emailCount = regularBatchMap.values().stream()
                            .mapToInt(dto -> dto.getUsers() != null ? dto.getUsers().size() : 0).sum();
                    if (!rateLimitService.checkAndIncrement(finalInstituteId, "EMAIL", emailCount)) {
                        log.warn("EMAIL rate limit exceeded for institute: {}. Skipping {} emails.", finalInstituteId, emailCount);
                        changes.put("rateLimitExceeded", true);
                        changes.put("status", "rate_limited");
                        if (logId != null) {
                            executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                                    "Email rate limit exceeded for institute: " + finalInstituteId);
                        }
                        return changes;
                    }

                    List<NotificationDTO> finalBatchList = new ArrayList<>(regularBatchMap.values());
                    try {
                        sendRegularBatchesChunked(finalBatchList, finalInstituteId, chunkSize, throttleMs, chunkTimeoutMs);
                        emailResults.add("SUCCESS: Dispatched " + finalBatchList.size() + " batches");
                        log.info("Successfully dispatched {} regular email batches (chunkSize={}, throttleMs={}, chunkTimeoutMs={}).",
                                finalBatchList.size(), chunkSize, throttleMs, chunkTimeoutMs);
                    } catch (Exception e) {
                        log.error("Error sending regular email batch request", e);
                        SentryLogger.SentryEventBuilder.error(e)
                                .withMessage("Email batch send failed (regular)")
                                .withTag("workflow.execution.id",
                                        workflowExecutionId != null ? workflowExecutionId : "unknown")
                                .withTag("node.id", nodeId != null ? nodeId : "unknown")
                                .withTag("node.type", "SEND_EMAIL")
                                .withTag("email.type", "REGULAR")
                                .withTag("batch.count", String.valueOf(finalBatchList.size()))
                                .withTag("institute.id", finalInstituteId)
                                .withTag("operation", "sendRegularEmailBatch")
                                .send();
                        emailResults.add("ERROR: Batch send failed (regular) - " + e.getMessage());

                        // Handle failures for all users in these batches
                        for (NotificationDTO batch : finalBatchList) {
                            if (batch.getUsers() != null) {
                                for (NotificationToUserDTO user : batch.getUsers()) {
                                    String recipient = user.getChannelId();
                                    Object originalItem = recipientToItemMap.get(recipient);

                                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                                            .recipientEmail(recipient)
                                            .errorMessage("Batch send failed: " + e.getMessage())
                                            .errorType("BATCH_SEND_ERROR")
                                            .failureReason("FAILED")
                                            .itemData(originalItem)
                                            .build());

                                    failedCount++;
                                    processedCount--; // Decrement as it failed
                                }
                            }
                        }
                    }
                }

                // --- Send Attachment Email Batches ---
                if (!attachmentBatchMap.isEmpty()) {
                    List<AttachmentNotificationDTO> finalAttachmentList = new ArrayList<>(attachmentBatchMap.values());
                    try {
                        sendAttachmentBatchesChunked(finalAttachmentList, finalInstituteId, chunkSize, throttleMs, chunkTimeoutMs);
                        emailResults.add("Attachment batch send successful.");
                        log.info("Successfully dispatched {} attachment email batches (chunkSize={}, throttleMs={}, chunkTimeoutMs={}).",
                                finalAttachmentList.size(), chunkSize, throttleMs, chunkTimeoutMs);
                    } catch (Exception e) {
                        log.error("Error sending attachment email batch request", e);
                        SentryLogger.SentryEventBuilder.error(e)
                                .withMessage("Email batch send failed (attachment)")
                                .withTag("workflow.execution.id",
                                        workflowExecutionId != null ? workflowExecutionId : "unknown")
                                .withTag("node.id", nodeId != null ? nodeId : "unknown")
                                .withTag("node.type", "SEND_EMAIL")
                                .withTag("email.type", "ATTACHMENT")
                                .withTag("batch.count", String.valueOf(finalAttachmentList.size()))
                                .withTag("institute.id", finalInstituteId)
                                .withTag("operation", "sendAttachmentEmailBatch")
                                .send();
                        emailResults.add("ERROR: Batch send failed (attachment) - " + e.getMessage());

                        // Handle failures for all users in these batches
                        for (AttachmentNotificationDTO batch : finalAttachmentList) {
                            if (batch.getUsers() != null) {
                                for (AttachmentUsersDTO user : batch.getUsers()) {
                                    String recipient = user.getChannelId();
                                    Object originalItem = recipientToItemMap.get(recipient);

                                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                                            .recipientEmail(recipient)
                                            .errorMessage("Batch send failed: " + e.getMessage())
                                            .errorType("BATCH_SEND_ERROR")
                                            .failureReason("FAILED")
                                            .itemData(originalItem)
                                            .build());

                                    failedCount++;
                                    processedCount--; // Decrement as it failed
                                }
                            }
                        }
                    }
                }

                if (regularBatchMap.isEmpty() && attachmentBatchMap.isEmpty()) {
                    log.info("No valid, non-duplicate email requests to send.");
                    changes.put("status", "no_requests_sent");
                } else {
                    changes.put("email_requests_processed", processedCount);
                    changes.put("email_requests_skipped", skippedCount);
                    changes.put("regular_batches_sent", regularBatchMap.size());
                    changes.put("attachment_batches_sent", attachmentBatchMap.size());
                    changes.put("email_results", emailResults);
                    changes.put("status", "emails_sent");
                    log.info("Successfully processed {} email requests.", processedCount);
                }

            } else {
                changes.put("status", "no_requests_created");
            }
            // --- BATCHING LOGIC END ---

            // One aggregated Sentry event per node run if any item failed — replaces
            // the former per-item captures that fanned a batch outage into thousands
            // of events. Full per-item detail lives in the execution log (failedEmails).
            if (!failedEmails.isEmpty()) {
                SentryLogger.SentryEventBuilder.error()
                        .withMessage("SEND_EMAIL forEach completed with failures")
                        .withTag("node.type", "SEND_EMAIL")
                        .withTag("failed.count", String.valueOf(failedEmails.size()))
                        .withTag("success.count", String.valueOf(processedCount))
                        .withTag("first.error", failedEmails.get(0).getErrorMessage() != null
                                ? failedEmails.get(0).getErrorMessage()
                                : "unknown")
                        .withTag("operation", "handleSendEmailForEach")
                        .send();
            }

            // Complete logging with success
            if (logId != null) {
                EmailExecutionDetails details = EmailExecutionDetails.builder()
                        // Minimize data: do not store full context
                        .inputContext(null)
                        .outputContext(null)
                        .successCount(processedCount)
                        .failureCount(failedCount + failedEmails.size()) // Add individual failures
                        .skippedCount(skippedCount)
                        .failedEmails(failedEmails) // Add the list
                        .executionTimeMs(System.currentTimeMillis() - startTime)
                        .build();

                // If we have failures or skips, use PARTIAL_SUCCESS or FAILED
                ExecutionLogStatus status = (failedCount > 0 || !failedEmails.isEmpty() || skippedCount > 0)
                        ? ExecutionLogStatus.PARTIAL_SUCCESS
                        : ExecutionLogStatus.SUCCESS;

                // If everything failed/skipped, use FAILED (unless we want to call it
                // PARTIAL_SUCCESS for skips)
                // User said "skipped at least one ... partially skipped".
                // So if we have skips, we use PARTIAL_SUCCESS.
                // Only if we have NO success AND NO skips (but failures), we use FAILED.
                // Wait, if processedCount == 0 and skippedCount > 0, it's PARTIAL_SUCCESS (or
                // maybe just SKIPPED/FAILED).
                // Let's stick to: if (processedCount == 0 && skippedCount == 0 && (failedCount
                // > 0 || !failedEmails.isEmpty())) -> FAILED
                if (processedCount == 0 && skippedCount == 0 && (failedCount > 0 || !failedEmails.isEmpty())) {
                    status = ExecutionLogStatus.FAILED;
                }

                executionLogger.completeNodeExecution(logId, status, details, null);
            }

        } catch (Exception e) {
            log.error("Error handling SendEmail node", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("SendEmail node execution failed")
                    .withTag("workflow.execution.id", workflowExecutionId != null ? workflowExecutionId : "unknown")
                    .withTag("node.id", nodeId != null ? nodeId : "unknown")
                    .withTag("node.type", "SEND_EMAIL")
                    .withTag("institute.id", instituteId != null ? instituteId : "unknown")
                    .withTag("operation", "handleSendEmailNode")
                    .send();
            changes.put("status", "error");
            changes.put("error", e.getMessage());

            // Log failure
            if (logId != null) {
                executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                        e.getMessage());
            }
        }

        return changes;
    }

    private List<Map<String, Object>> processForEachOperation(ForEachConfigDTO forEachConfig,
            Map<String, Object> itemContext, Object item, List<EmailExecutionDetails.FailedEmail> failedEmails) {
        if (forEachConfig == null) {
            log.warn("No forEach configuration found in SendEmail node");
            return Collections.emptyList();
        }

        String operation = forEachConfig.getOperation();

        // --- NEW: Handle ATTACHMENT_EMAIL operation ---
        if ("ATTACHMENT_EMAIL".equalsIgnoreCase(operation)) {
            return processAttachmentEmailOperation(forEachConfig, itemContext, item, failedEmails);
        }

        if ("SWITCH".equalsIgnoreCase(operation)) {
            return processSwitchOperation(forEachConfig, itemContext, item, failedEmails);
        }

        // Default to regular email
        return processRegularEmailOperation(forEachConfig, itemContext, item, failedEmails);
    }

    // --- NEW: Method to handle regular email (template or hardcoded) ---
    private List<Map<String, Object>> processRegularEmailOperation(ForEachConfigDTO forEachConfig,
            Map<String, Object> itemContext, Object item, List<EmailExecutionDetails.FailedEmail> failedEmails) {
        String emailDataExpr = forEachConfig.getEval();
        if (emailDataExpr == null || emailDataExpr.isBlank()) {
            log.warn("SEND_EMAIL forEach missing 'eval' expression for email data");
            return Collections.emptyList();
        }

        try {
            Object emailDataObj = spelEvaluator.evaluate(emailDataExpr, itemContext);
            if (emailDataObj == null) {
                log.warn("No email data found for expression: {}", emailDataExpr);
                return Collections.emptyList();
            }

            return processEmailDataAndCreateRequests(emailDataObj, itemContext, "REGULAR", failedEmails, item);
        } catch (Exception e) {
            // Per-item failure: collected into failedEmails and reported ONCE in
            // aggregate after the forEach (see handle()). Capturing per item here
            // fanned a single batch outage into thousands of identical Sentry events.
            log.error("Error processing regular email forEach operation for item: {}", item, e);
            failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                    .itemData(item)
                    .errorMessage(e.getMessage())
                    .errorType("REGULAR_EMAIL_PROCESSING_ERROR")
                    .build());
            return Collections.emptyList();
        }
    }

    // --- NEW: Method to handle attachment email ---
    private List<Map<String, Object>> processAttachmentEmailOperation(ForEachConfigDTO forEachConfig,
            Map<String, Object> itemContext, Object item, List<EmailExecutionDetails.FailedEmail> failedEmails) {
        String emailDataExpr = forEachConfig.getEval();
        if (emailDataExpr == null || emailDataExpr.isBlank()) {
            log.warn("ATTACHMENT_EMAIL forEach missing 'eval' expression");
            return Collections.emptyList();
        }

        try {
            Object emailDataObj = spelEvaluator.evaluate(emailDataExpr, itemContext);
            if (emailDataObj == null) {
                log.warn("No attachment email data found for expression: {}", emailDataExpr);
                return Collections.emptyList();
            }

            // 'item' in this context is the recipient email string
            String recipientEmail = String.valueOf(item);

            // The evaluated object is a list containing one map
            if (emailDataObj instanceof List && !((List) emailDataObj).isEmpty()) {
                Object data = ((List) emailDataObj).get(0);
                if (data instanceof Map) {
                    // --- MODIFIED: Pass itemContext ---
                    Map<String, Object> request = createAttachmentEmailRequest(recipientEmail,
                            (Map<String, Object>) data, itemContext, failedEmails, item);
                    if (request != null) {
                        return List.of(request);
                    }
                }
            }
            return Collections.emptyList();
        } catch (Exception e) {
            // Per-item failure: aggregated after the forEach, not captured per item.
            log.error("Error processing attachment email forEach operation for item: {}", item, e);
            failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                    .itemData(item)
                    .errorMessage(e.getMessage())
                    .errorType("ATTACHMENT_EMAIL_PROCESSING_ERROR")
                    .build());
            return Collections.emptyList();
        }
    }

    private List<Map<String, Object>> processSwitchOperation(ForEachConfigDTO forEachConfig,
            Map<String, Object> itemContext, Object item, List<EmailExecutionDetails.FailedEmail> failedEmails) {
        try {
            String onExpr = forEachConfig.getOn();
            if (onExpr == null || onExpr.isBlank()) {
                log.warn("SWITCH operation missing 'on' expression");
                return Collections.emptyList();
            }
            Object switchValue = spelEvaluator.evaluate(onExpr, itemContext);
            String key = String.valueOf(switchValue);
            Map<String, Object> cases = forEachConfig.getCases();
            if (cases == null || cases.isEmpty()) {
                log.warn("SWITCH operation missing cases");
                return Collections.emptyList();
            }
            Object selectedCase = cases.get(key);
            if (selectedCase == null) {
                selectedCase = cases.get("default");
                if (selectedCase == null) {
                    log.debug("SWITCH operation no matching case found for key: {}", key);
                    return Collections.emptyList();
                }
            }
            // A switch operation implies a regular email
            return processEmailDataAndCreateRequests(selectedCase, itemContext, "REGULAR", failedEmails, item);
        } catch (Exception e) {
            log.error("Error processing SWITCH operation for item: {}", item, e);
            failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                    .itemData(item)
                    .errorMessage(e.getMessage())
                    .errorType("SWITCH_OPERATION_ERROR")
                    .build());
            return Collections.emptyList();
        }
    }

    private List<Map<String, Object>> processEmailDataAndCreateRequests(Object emailDataObj,
            Map<String, Object> itemContext, String type, List<EmailExecutionDetails.FailedEmail> failedEmails,
            Object originalItem) {
        List<Map<String, Object>> requests = new ArrayList<>();
        try {
            if (emailDataObj instanceof List) {
                List<?> emailDataList = (List<?>) emailDataObj;
                for (Object emailData : emailDataList) {
                    Map<String, Object> request = createEmailRequest(emailData, itemContext, type, failedEmails,
                            originalItem);
                    if (request != null) {
                        requests.add(request);
                    }
                }
            } else if (emailDataObj instanceof Map) {
                Map<String, Object> request = createEmailRequest(emailDataObj, itemContext, type, failedEmails,
                        originalItem);
                if (request != null) {
                    requests.add(request);
                }
            } else {
                log.warn("Email data is neither a list nor a map: {}", emailDataObj.getClass());
            }
        } catch (Exception e) {
            log.error("Error processing email data: {}", emailDataObj, e);
        }
        return requests;
    }

    /**
     * --- MODIFIED: Added template support ---
     */
    private Map<String, Object> createAttachmentEmailRequest(String recipientEmail, Map<String, Object> emailData,
            Map<String, Object> itemContext, List<EmailExecutionDetails.FailedEmail> failedEmails,
            Object originalItem) {
        try {
            Map<String, Object> request = new HashMap<>();
            request.put("type", "ATTACHMENT_EMAIL");
            request.put("recipient", recipientEmail);
            request.put("attachmentName", emailData.get("attachmentName"));
            request.put("attachmentBase64", emailData.get("attachmentBase64"));

            // Extract actual userId from item context for unsubscribe check
            Object itemObj = itemContext.get("item");
            if (itemObj instanceof Map) {
                String extractedId = extractUserId((Map<String, Object>) itemObj);
                if (extractedId != null) {
                    request.put("userId", extractedId);
                }
            }

            Map<String, String> finalVars = new HashMap<>();
            finalVars.put("recipient", recipientEmail); // Add recipient as a default placeholder

            // Check if this is template-based
            if (emailData.containsKey("templateName")) {
                String templateName = (String) emailData.get("templateName");
                Map<String, ?> templateVars = (Map<String, ?>) emailData.get("templateVars");
                String instituteId = (String) itemContext.get("instituteId");

                if (!StringUtils.hasText(instituteId)) {
                    instituteId = (String) itemContext.get("instituteIdForWhatsapp");
                }

                if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(templateName)) {
                    log.warn("Skipping attachment template email. Missing instituteId or templateName.");
                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                            .itemData(originalItem)
                            .errorMessage("Missing instituteId or templateName")
                            .errorType("MISSING_TEMPLATE_INFO")
                            .failureReason("SKIPPED")
                            .build());
                    return null;
                }

                String cacheKey = instituteId + ":" + templateName + ":EMAIL";
                final String finalInstituteId = instituteId;
                Template template = templateCache.computeIfAbsent(cacheKey,
                        k -> templateRepository.findByInstituteIdAndNameAndType(finalInstituteId, templateName, "EMAIL")
                                .or(() -> templateRepository.findByInstituteIdAndNameAndType(finalInstituteId, templateName, "email"))
                                .orElse(null));

                if (template == null) {
                    log.warn("Email template not found: {} for institute: {}", templateName, instituteId);
                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                            .itemData(originalItem)
                            .errorMessage("Email template not found: " + templateName)
                            .errorType("TEMPLATE_NOT_FOUND")
                            .failureReason("SKIPPED")
                            .build());
                    return null;
                }

                if (templateVars != null) {
                    templateVars.forEach((key, value) -> finalVars.put(key, String.valueOf(value)));
                }

                // Add all item context properties as strings for fallback
                itemContext.forEach((key, value) -> {
                    if (value != null) {
                        finalVars.putIfAbsent(key, String.valueOf(value));
                    }
                });

                request.put("subject", template.getSubject());
                request.put("body", template.getContent());

            } else {
                // Fallback to hardcoded subject/body
                request.put("subject", emailData.get("subject"));
                request.put("body", emailData.get("body"));
            }

            request.put("placeholders", finalVars);
            request.put("_originalItem", originalItem); // Store for failure tracking
            return request;

        } catch (Exception e) {
            log.error("Error creating attachment email request", e);
            failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                    .itemData(originalItem)
                    .errorMessage(e.getMessage())
                    .errorType("ATTACHMENT_EMAIL_CREATION_ERROR")
                    .failureReason("FAILED")
                    .build());
            return null;
        }
    }

    private Map<String, Object> createEmailRequest(Object emailData, Map<String, Object> itemContext, String type,
            List<EmailExecutionDetails.FailedEmail> failedEmails, Object originalItem) {
        try {
            Object userDetailsObj = itemContext.get("item");
            if (userDetailsObj == null) {
                log.warn("No user details (item) found in context");
                failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                        .itemData(originalItem)
                        .errorMessage("No user details (item) found in context")
                        .errorType("MISSING_USER_DETAILS")
                        .failureReason("SKIPPED")
                        .build());
                return null;
            }

            Map<String, Object> userDetails = JsonUtil.convertValue(userDetailsObj, Map.class);
            // We can no longer assume 'item' is a map, it could be a string.
            // extractEmailAddress will handle this.

            String recipientField = (String) itemContext.get("_recipientField");
            String emailAddress = extractEmailAddress(userDetails, itemContext.get("item"), recipientField);
            if (emailAddress == null || emailAddress.isBlank()) {
                log.warn("No email address found for user: {}", userDetailsObj);
                failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                        .itemData(originalItem)
                        .errorMessage("No email address found for user")
                        .errorType("MISSING_EMAIL_ADDRESS")
                        .failureReason("SKIPPED")
                        .build());
                return null;
            }

            if (!(emailData instanceof Map)) {
                log.warn("Email data is not a map: {}", emailData);
                failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                        .itemData(originalItem)
                        .errorMessage("Email data is not a map")
                        .errorType("INVALID_EMAIL_DATA")
                        .failureReason("SKIPPED")
                        .build());
                return null;
            }

            Map<String, Object> emailDataMap = (Map<String, Object>) emailData;
            Map<String, Object> request = new HashMap<>();
            request.put("type", type);
            request.put("recipient", emailAddress);

            // Extract actual userId from user details for unsubscribe check
            String extractedUserId = extractUserId(userDetails);
            if (extractedUserId != null) {
                request.put("userId", extractedUserId);
            }

            // Check for templateName
            if (emailDataMap.containsKey("templateName")) {
                String templateName = (String) emailDataMap.get("templateName");
                Map<String, ?> templateVars = (Map<String, ?>) emailDataMap.get("templateVars");
                String instituteId = (String) itemContext.get("instituteId");

                if (!StringUtils.hasText(instituteId)) {
                    instituteId = (String) itemContext.get("instituteIdForWhatsapp");
                }

                if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(templateName)) {
                    log.warn("Skipping template email. Missing instituteId or templateName.");
                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                            .itemData(originalItem)
                            .errorMessage("Missing instituteId or templateName")
                            .errorType("MISSING_TEMPLATE_INFO")
                            .failureReason("SKIPPED")
                            .build());
                    return null;
                }

                String cacheKey = instituteId + ":" + templateName + ":EMAIL";
                final String finalInstituteId = instituteId;
                final String finalTemplateName = templateName;

                Template template = templateCache.computeIfAbsent(cacheKey,
                        k -> templateRepository
                                .findByInstituteIdAndNameAndType(finalInstituteId, finalTemplateName, "EMAIL")
                                .or(() -> templateRepository.findByInstituteIdAndNameAndType(finalInstituteId, finalTemplateName, "email"))
                                .orElse(null));

                if (template == null) {
                    log.warn("Email template not found: {} for institute: {}", templateName, instituteId);
                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                            .itemData(originalItem)
                            .errorMessage("Email template not found: " + templateName)
                            .errorType("TEMPLATE_NOT_FOUND")
                            .failureReason("SKIPPED")
                            .build());
                    return null;
                }

                Map<String, String> finalVars = new HashMap<>();

                // First, add all item fields as available placeholders
                if (userDetails != null) {
                    userDetails.forEach((key, value) -> {
                        if (value != null) {
                            finalVars.put(key, String.valueOf(value));
                        }
                    });
                }

                // Then, resolve templateVars mapping: key = placeholder name, value = field name or SpEL
                // e.g., {"name": "fullName"} → looks up "fullName" from item data, then context
                if (templateVars != null) {
                    templateVars.forEach((placeholderKey, fieldNameOrExpr) -> {
                        String fieldName = String.valueOf(fieldNameOrExpr);
                        // 1. Try item data (userDetails = the current list item)
                        if (userDetails != null && userDetails.containsKey(fieldName)) {
                            Object resolved = userDetails.get(fieldName);
                            finalVars.put(placeholderKey, resolved != null ? String.valueOf(resolved) : "");
                        }
                        // 2. Try full workflow context (e.g., customFields, user, etc.)
                        else if (itemContext.containsKey(fieldName)) {
                            Object resolved = itemContext.get(fieldName);
                            finalVars.put(placeholderKey, resolved != null ? String.valueOf(resolved) : "");
                        }
                        // 3. Try nested context lookup (e.g., "Full Name" might be in customFields map)
                        else if (itemContext.containsKey("customFields") && itemContext.get("customFields") instanceof Map) {
                            Map<String, Object> customFields = (Map<String, Object>) itemContext.get("customFields");
                            if (customFields.containsKey(fieldName)) {
                                Object resolved = customFields.get(fieldName);
                                finalVars.put(placeholderKey, resolved != null ? String.valueOf(resolved) : "");
                            } else {
                                // 4. SpEL expression
                                resolveAsSpelOrLiteral(placeholderKey, fieldName, itemContext, finalVars);
                            }
                        }
                        // 4. SpEL expression or literal
                        else {
                            resolveAsSpelOrLiteral(placeholderKey, fieldName, itemContext, finalVars);
                        }
                    });
                }

                // Finally, fall back to the workflow context for anything still unmapped.
                // Without this, a node with no templateVars (or an incomplete one) could
                // only ever resolve fields that happen to live on the iterated item — so
                // e.g. {{instituteName}}, which is a context key, shipped literally. The
                // attachment-email path has always done this; the regular path had not.
                addScalarContextFallback(itemContext, finalVars);

                request.put("subject", template.getSubject());
                request.put("body", template.getContent());
                request.put("placeholders", finalVars);

            }
            // Fallback to hardcoded subject/body
            else if (emailDataMap.containsKey("subject")) {
                String subject = (String) emailDataMap.get("subject");
                String body = (String) emailDataMap.get("body");

                if (subject == null || body == null) {
                    log.warn("Email data missing subject or body");
                    failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                            .itemData(originalItem)
                            .errorMessage("Email data missing subject or body")
                            .errorType("MISSING_SUBJECT_OR_BODY")
                            .failureReason("SKIPPED")
                            .build());
                    return null;
                }

                String evaluatedSubject = evaluateSpelExpression(subject, itemContext);
                String evaluatedBody = evaluateSpelExpression(body, itemContext);

                request.put("subject", evaluatedSubject);
                request.put("body", evaluatedBody);

                Map<String, String> placeholders = new HashMap<>();
                if (userDetails != null) { // Add item properties if it's a map
                    userDetails.forEach((key, value) -> {
                        if (value != null) {
                            placeholders.put(key, String.valueOf(value));
                        }
                    });
                }
                addScalarContextFallback(itemContext, placeholders);
                request.put("placeholders", placeholders);
            } else {
                log.warn("Email data is missing 'templateName' or 'subject'");
                failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                        .itemData(originalItem)
                        .errorMessage("Email data is missing 'templateName' or 'subject'")
                        .errorType("INVALID_EMAIL_CONFIG")
                        .failureReason("SKIPPED")
                        .build());
                return null;
            }

            request.put("_originalItem", originalItem); // Store for failure tracking
            return request;

        } catch (Exception e) {
            log.error("Error creating email request", e);
            failedEmails.add(EmailExecutionDetails.FailedEmail.builder()
                    .itemData(originalItem)
                    .errorMessage(e.getMessage())
                    .errorType("EMAIL_CREATION_ERROR")
                    .failureReason("FAILED")
                    .build());
            return null;
        }
    }

    /**
     * Adds workflow-context values as placeholders for any key not already resolved.
     *
     * Scalars only: the context also carries DTOs, lists and the raw node plumbing
     * (executionId, currentNodeId, the email request lists), and stringifying those into
     * a placeholder map would be noise at best and a leaked object dump at worst. Nested
     * {@code customFields} entries are flattened in too, since audience templates address
     * them by field name.
     *
     * Never overwrites an existing entry — item fields and explicit templateVars win.
     */
    private void addScalarContextFallback(Map<String, Object> itemContext, Map<String, String> finalVars) {
        if (itemContext == null || finalVars == null) {
            return;
        }
        itemContext.forEach((key, value) -> {
            if (isScalar(value)) {
                finalVars.putIfAbsent(key, String.valueOf(value));
            }
        });
        Object customFields = itemContext.get("customFields");
        if (customFields instanceof Map<?, ?> cf) {
            cf.forEach((key, value) -> {
                if (key != null && isScalar(value)) {
                    finalVars.putIfAbsent(String.valueOf(key), String.valueOf(value));
                }
            });
        }
    }

    private boolean isScalar(Object value) {
        return value instanceof String || value instanceof Number
                || value instanceof Boolean || value instanceof Character;
    }

    private void resolveAsSpelOrLiteral(String placeholderKey, String fieldName,
            Map<String, Object> context, Map<String, String> finalVars) {
        if (fieldName.startsWith("#ctx") || fieldName.startsWith("#")) {
            try {
                Object resolved = spelEvaluator.evaluate(fieldName, context);
                finalVars.put(placeholderKey, resolved != null ? String.valueOf(resolved) : "");
            } catch (Exception e) {
                log.warn("Failed to resolve template var '{}' with expression '{}'", placeholderKey, fieldName);
                finalVars.put(placeholderKey, fieldName);
            }
        } else {
            finalVars.put(placeholderKey, fieldName);
        }
    }

    private String evaluateSpelExpression(String expression, Map<String, Object> context) {
        try {
            if (expression == null || expression.isBlank()) {
                return expression;
            }
            if (expression.startsWith("''") && expression.endsWith("''") && expression.length() > 3) {
                expression = expression.substring(1, expression.length() - 1);
            }

            Object result = spelEvaluator.evaluate(expression, context);
            return result != null ? String.valueOf(result) : "";
        } catch (Exception e) {
            log.warn("Error evaluating SPEL expression: {}", expression, e);
            return expression;
        }
    }

    // --- MODIFIED: To handle 'item' being a simple string ---
    private String extractEmailAddress(Map<String, Object> userDetailsMap, Object item) {
        return extractEmailAddress(userDetailsMap, item, null);
    }

    private String extractEmailAddress(Map<String, Object> userDetailsMap, Object item, String recipientField) {
        // If a specific recipientField is configured, use it directly
        if (recipientField != null && userDetailsMap != null) {
            Object value = userDetailsMap.get(recipientField);
            if (value != null) {
                String email = String.valueOf(value).trim();
                if (!email.isBlank() && email.contains("@")) {
                    return email;
                }
            }
        }

        // Check if 'item' itself is a valid email string
        if (item instanceof String) {
            String email = ((String) item).trim();
            if (!email.isBlank() && email.contains("@")) {
                return email;
            }
        }

        // Check the userDetailsMap for common email field names
        if (userDetailsMap != null) {
            String[] possibleFields = {
                    "to", "email", "emailAddress", "email_address",
                    "userEmail", "user_email", "mail", "channelId",
                    "recipientEmail", "recipient_email",
                    "parentsEmail", "guardianEmail", "motherEmail"
            };

            for (String field : possibleFields) {
                Object value = userDetailsMap.get(field);
                if (value != null) {
                    String email = String.valueOf(value).trim();
                    if (!email.isBlank() && email.contains("@")) {
                        return email;
                    }
                }
            }

            // Defensive last-resort fallback: scan ALL values for an email-shaped
            // string. Handles audience customFields named "Email", "Email Address",
            // "Your Email", etc. — anything that wasn't promoted at the data layer.
            // Validates: contains "@" with text on both sides and no whitespace.
            for (Map.Entry<String, Object> entry : userDetailsMap.entrySet()) {
                Object value = entry.getValue();
                if (value instanceof String) {
                    String s = ((String) value).trim();
                    int at = s.indexOf('@');
                    if (at > 0 && at < s.length() - 1 && !s.contains(" ")) {
                        return s;
                    }
                }
            }
        }

        return null; // No valid email found
    }

    /**
     * Splits each NotificationDTO's user list into smaller chunks and dispatches
     * them sequentially with a delay between calls. Avoids hammering the
     * notification service / SMTP provider with one giant request when the
     * workflow fans out to hundreds of recipients.
     *
     * Behavior preserved vs the original single-call dispatch:
     *  - Same emails sent to same recipients (chunk size only affects how the
     *    notification service receives them; the underlying loop processes one
     *    DTO at a time anyway).
     *  - When a batch fits in one chunk, the original DTO is reused (no copy).
     *  - Sleep only happens BETWEEN sends, never before the first or after the
     *    last, so small workflows pay no extra latency.
     *  - Each chunk send is wrapped with a per-chunk timeout. On timeout we
     *    log a warning and continue to the next chunk (don't abort the batch).
     *    On any OTHER exception we propagate so the outer try/catch marks the
     *    batch failed exactly as it did before chunking was added.
     */
    private void sendRegularBatchesChunked(List<NotificationDTO> batches, String instituteId,
            int chunkSize, long throttleMs, long chunkTimeoutMs) {
        boolean firstSend = true;
        for (NotificationDTO batch : batches) {
            List<NotificationToUserDTO> users = batch.getUsers();
            if (users == null || users.isEmpty()) {
                continue;
            }
            int total = users.size();
            for (int i = 0; i < total; i += chunkSize) {
                if (!firstSend) sleepQuiet(throttleMs);
                int end = Math.min(i + chunkSize, total);
                NotificationDTO chunkDto;
                if (i == 0 && end == total) {
                    // Single-chunk batch: reuse original DTO, no copy needed.
                    chunkDto = batch;
                } else {
                    chunkDto = new NotificationDTO();
                    chunkDto.setSubject(batch.getSubject());
                    chunkDto.setBody(batch.getBody());
                    chunkDto.setNotificationType(batch.getNotificationType());
                    chunkDto.setSource(batch.getSource());
                    chunkDto.setSourceId(batch.getSourceId());
                    chunkDto.setUsers(new ArrayList<>(users.subList(i, end)));
                }
                int chunkUserCount = end - i;
                runWithTimeout(
                        () -> notificationService.sendEmailToUsersMultipleViaUnified(List.of(chunkDto), instituteId),
                        chunkTimeoutMs,
                        "regular email chunk (subject=" + chunkDto.getSubject() + ", users=" + chunkUserCount + ")");
                firstSend = false;
            }
        }
    }

    private void sendAttachmentBatchesChunked(List<AttachmentNotificationDTO> batches, String instituteId,
            int chunkSize, long throttleMs, long chunkTimeoutMs) {
        boolean firstSend = true;
        for (AttachmentNotificationDTO batch : batches) {
            List<AttachmentUsersDTO> users = batch.getUsers();
            if (users == null || users.isEmpty()) {
                continue;
            }
            int total = users.size();
            for (int i = 0; i < total; i += chunkSize) {
                if (!firstSend) sleepQuiet(throttleMs);
                int end = Math.min(i + chunkSize, total);
                AttachmentNotificationDTO chunkDto;
                if (i == 0 && end == total) {
                    chunkDto = batch;
                } else {
                    chunkDto = AttachmentNotificationDTO.builder()
                            .subject(batch.getSubject())
                            .body(batch.getBody())
                            .notificationType(batch.getNotificationType())
                            .source(batch.getSource())
                            .sourceId(batch.getSourceId())
                            .users(new ArrayList<>(users.subList(i, end)))
                            .build();
                }
                int chunkUserCount = end - i;
                runWithTimeout(
                        () -> notificationService.sendAttachmentEmailViaUnified(List.of(chunkDto), instituteId),
                        chunkTimeoutMs,
                        "attachment email chunk (subject=" + chunkDto.getSubject() + ", users=" + chunkUserCount + ")");
                firstSend = false;
            }
        }
    }

    /**
     * Runs the chunk-send task on a daemon executor and waits up to timeoutMs.
     * Behavior contract:
     *  - If the call completes in time → return normally.
     *  - If it TIMES OUT → cancel the future, log a warning, return normally
     *    (the workflow continues to the next chunk).
     *  - If it throws any OTHER exception → propagate as RuntimeException so
     *    the call site's existing try/catch can mark the batch failed (this
     *    preserves pre-existing failure-marking semantics for non-hung errors).
     *  - If the wait is interrupted → restore interrupt flag and propagate.
     *
     * NOTE: Future.cancel(true) only sets the interrupt flag on the worker
     * thread. The underlying HTTP call may still complete in the background
     * (depends on the HTTP client honoring interrupts). This is acceptable —
     * the goal is to stop blocking the workflow thread, not to forcibly kill
     * the network request.
     */
    private void runWithTimeout(Runnable task, long timeoutMs, String description) {
        if (timeoutMs <= 0) {
            // Timeout disabled — run inline (preserves pre-timeout behavior).
            task.run();
            return;
        }
        CompletableFuture<Void> future = CompletableFuture.runAsync(task, chunkExecutor);
        try {
            future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            log.warn("Send timed out after {}ms — {}. Continuing to next chunk.", timeoutMs, description);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            if (cause instanceof RuntimeException) {
                throw (RuntimeException) cause;
            }
            throw new RuntimeException("Send failed for " + description, cause);
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new RuntimeException("Send interrupted for " + description, e);
        }
    }

    private void sleepQuiet(long ms) {
        if (ms <= 0) return;
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Extract actual user UUID from user details map.
     * Looks for common field names that store the user ID.
     */
    private String extractUserId(Map<String, Object> userDetailsMap) {
        if (userDetailsMap == null) {
            return null;
        }

        String[] possibleFields = {
                "user_id", "userId", "id", "learner_id", "learnerId"
        };

        for (String field : possibleFields) {
            Object value = userDetailsMap.get(field);
            if (value != null) {
                String id = String.valueOf(value).trim();
                if (!id.isBlank() && !id.contains("@")) {
                    return id;
                }
            }
        }

        return null;
    }
}
