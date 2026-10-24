package vacademy.io.admin_core_service.features.workflow.engine;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.dto.MessageOrigin;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowEngineService;
import vacademy.io.admin_core_service.features.notification.dto.WhatsappRequest;
import vacademy.io.admin_core_service.features.notification.util.PhoneCountryUtil;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.workflow.dto.ForEachConfigDTO;
import vacademy.io.admin_core_service.features.workflow.dto.SendWhatsAppNodeDTO;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowExecutionLogger;

import vacademy.io.admin_core_service.features.workflow.enums.ExecutionLogStatus;
import vacademy.io.admin_core_service.features.workflow.enums.NodeType;
import vacademy.io.admin_core_service.features.workflow.dto.execution_log.WhatsAppExecutionDetails;
import vacademy.io.common.logging.SentryLogger;

import vacademy.io.admin_core_service.features.workflow.service.NotificationRateLimitService;

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
public class SendWhatsAppNodeHandler implements NodeHandler {

    private final ObjectMapper objectMapper;
    private final SpelEvaluator spelEvaluator;
    private final NotificationService notificationService;
    private final TemplateRepository templateRepository;
    private final WorkflowExecutionLogger executionLogger;
    private final NotificationRateLimitService rateLimitService;
    private final InstituteRepository instituteRepository;

    // Cache for templates (InstituteID:TemplateName -> Template)
    private final Map<String, Template> templateCache = new java.util.concurrent.ConcurrentHashMap<>();

    // Throttling defaults — mirror SendEmailNodeHandler. Workflows that fan out to
    // many recipients can overwhelm notification-service / the WhatsApp provider if
    // dispatched as one giant request. Overridable per-node via config:
    //   "chunkSize": 100, "throttleMs": 500, "chunkTimeoutMs": 60000
    private static final int DEFAULT_CHUNK_SIZE = 50;
    private static final long DEFAULT_THROTTLE_MS = 200L;
    private static final long DEFAULT_CHUNK_TIMEOUT_MS = 30_000L;

    // Daemon pool so a hung notification call can be abandoned via Future.cancel()
    // without blocking the workflow thread indefinitely.
    private final ExecutorService chunkExecutor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "send-whatsapp-chunk");
        t.setDaemon(true);
        return t;
    });

    @Override
    public boolean supports(String nodeType) {
        return "SEND_WHATSAPP".equalsIgnoreCase(nodeType);
    }

    /**
     * The template to send, which is normally the literal name typed in the config
     * ("daily_reminder") but may be an expression when the message changes run to
     * run — a class workflow that reads its weekday row picks a different template
     * on a Sunday than on a weekday.
     *
     * <p>Only values that already look like an expression ({@code #...} or
     * {@code T(...)}) are evaluated, so every node holding a literal name — which
     * is all of them today — is passed through untouched. A name cannot begin with
     * '#' or 'T(' in Meta's naming rules, so there is no ambiguity to resolve.</p>
     *
     * @return the resolved name, or null when the expression yields nothing; the
     *         caller then sends no template rather than a wrong one.
     */
    private String resolveTemplateName(String configured, Map<String, Object> context) {
        String trimmed = configured.trim();
        if (!trimmed.startsWith("#") && !trimmed.startsWith("T(")) {
            return configured;
        }
        try {
            Object resolved = spelEvaluator.evaluate(trimmed, context);
            if (resolved == null || !StringUtils.hasText(resolved.toString())) {
                log.warn("templateName expression '{}' resolved to nothing — skipping send", trimmed);
                return null;
            }
            return resolved.toString().trim();
        } catch (Exception e) {
            log.warn("Could not evaluate templateName expression '{}': {}", trimmed, e.getMessage());
            return null;
        }
    }

    @Override
    public Map<String, Object> handle(Map<String, Object> context,
            String nodeConfigJson,
            Map<String, NodeTemplate> nodeTemplates,
            int countProcessed) {

        log.info("SendWhatsAppNodeHandler.handle() invoked.");

        // Dry-run check: skip actual WhatsApp sending but log the intent
        Boolean dryRun = (Boolean) context.getOrDefault("dryRun", false);
        if (Boolean.TRUE.equals(dryRun)) {
            log.info("[DRY RUN] SendWhatsAppNodeHandler - skipping actual WhatsApp send. Config: {}", nodeConfigJson);
            Map<String, Object> dryRunResult = new HashMap<>();
            dryRunResult.put("dryRun", true);
            dryRunResult.put("skipped", "whatsapp_send");
            dryRunResult.put("details", "WhatsApp send skipped in dry-run mode. Config: " + nodeConfigJson);
            return dryRunResult;
        }

        String workflowExecutionId = (String) context.get("executionId");
        String nodeId = (String) context.get("currentNodeId");

        // Start logging
        String logId = null;
        long startTime = System.currentTimeMillis();
        if (workflowExecutionId != null && nodeId != null) {
            logId = executionLogger.startNodeExecution(workflowExecutionId, nodeId, NodeType.SEND_WHATSAPP,
                    context);
        }

        Map<String, Object> changes = new HashMap<>();
        int processedCount = 0;
        int skippedCount = 0;
        int failedCount = 0;
        List<String> results = new ArrayList<>();
        List<WhatsAppExecutionDetails.FailedMessage> failedMessages = new ArrayList<>();

        try {
            SendWhatsAppNodeDTO nodeDTO = objectMapper.readValue(nodeConfigJson, SendWhatsAppNodeDTO.class);
            String onExpression = nodeDTO.getOn();
            if (!StringUtils.hasText(onExpression)) {
                log.warn("SendWhatsAppNode missing 'on' expression");
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
                    WhatsAppExecutionDetails details = WhatsAppExecutionDetails.builder()
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

            List<Object> items;
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

            log.info("Processing {} items for WhatsApp sending", items.size());

            // Read node-level templateName/templateVars/languageCode from raw config JSON.
            // SendWhatsAppNodeDTO doesn't declare these fields (Jackson would drop them),
            // but the frontend stores them at config root. Mirror SendEmailNodeHandler: pick
            // them up here and inject into each iterated item so forEach.eval = "#ctx['item']"
            // still produces a valid message map with templateName + templateVars.
            String nodeLevelTemplateName = null;
            Map<String, Object> nodeLevelTemplateVars = null;
            String nodeLevelLanguageCode = null;
            String nodeLevelRecipientField = null; // which item field holds the phone (e.g. "parentMobile", "Phone Number")
            // The builder stores the template's expected params here (e.g. {"1":"name"}). It is the
            // only description of the template's shape available when the institute's WhatsApp
            // template lives solely in notification_service's whatsapp_templates table.
            Map<String, String> nodeLevelTemplateParams = null;
            int chunkSize = DEFAULT_CHUNK_SIZE;
            long throttleMs = DEFAULT_THROTTLE_MS;
            long chunkTimeoutMs = DEFAULT_CHUNK_TIMEOUT_MS;
            try {
                com.fasterxml.jackson.databind.JsonNode configRoot = objectMapper.readTree(nodeConfigJson);
                if (configRoot.has("templateName") && !configRoot.get("templateName").asText("").isBlank()) {
                    nodeLevelTemplateName = resolveTemplateName(configRoot.get("templateName").asText(), context);
                }
                if (configRoot.has("templateVars") && configRoot.get("templateVars").isObject()) {
                    nodeLevelTemplateVars = objectMapper.convertValue(configRoot.get("templateVars"), Map.class);
                }
                if (configRoot.has("languageCode") && !configRoot.get("languageCode").asText("").isBlank()) {
                    nodeLevelLanguageCode = configRoot.get("languageCode").asText();
                }
                if (configRoot.has("recipientField") && !configRoot.get("recipientField").asText("").isBlank()) {
                    nodeLevelRecipientField = configRoot.get("recipientField").asText();
                }
                if (configRoot.has("_templateParams") && configRoot.get("_templateParams").isObject()) {
                    Map<String, Object> raw = objectMapper.convertValue(configRoot.get("_templateParams"), Map.class);
                    if (raw != null && !raw.isEmpty()) {
                        nodeLevelTemplateParams = new LinkedHashMap<>();
                        for (Map.Entry<String, Object> e : raw.entrySet()) {
                            nodeLevelTemplateParams.put(e.getKey(),
                                    e.getValue() == null ? "" : String.valueOf(e.getValue()));
                        }
                    }
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
                log.warn("Failed to parse node-level WhatsApp template config", e);
            }

            // BACKWARD COMPATIBLE: Check both context keys for institute ID
            String instituteIdTemp = (String) context.get("instituteIdForWhatsapp"); // SEND_WHATSAPP format
            if (!StringUtils.hasText(instituteIdTemp)) {
                instituteIdTemp = (String) context.get("instituteId"); // COMBOT fallback
            }
            final String instituteId = instituteIdTemp; // Make effectively final for lambda usage

            if (!StringUtils.hasText(instituteId)) {
                log.warn("Missing 'instituteIdForWhatsapp' or 'instituteId' in context");
                changes.put("status", "error");
                changes.put("error", "Missing institute ID in context");

                if (logId != null) {
                    executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                            "Missing institute ID in context");
                }
                return changes;
            }

            // Resolve once whether this institute's numbers default to India (+91)
            // for bare 10-digit numbers. Blank/unknown country → treat as India.
            boolean instituteDefaultsToIndia = PhoneCountryUtil.defaultsToIndia(
                    instituteRepository.findById(instituteId)
                            .map(Institute::getCountry).orElse(null));

            // --- OPTIMIZATION START ---

            // Map to group users by templateName
            Map<String, WhatsappRequest> batchRequestMap = new HashMap<>();
            // Map to store original items for failure tracking
            Map<String, Object> mobileToItemMap = new HashMap<>();
            // Set to deduplicate (mobileNumber::templateName)
            Set<String> sentLog = new HashSet<>();
            
            // NEW: Maps for COMBOT-specific features (per-phone)
            Map<String, Map<String, String>> headerVideoParamsMap = new HashMap<>();  // templateName -> (phone -> videoUrl)
            Map<String, Map<String, String>> buttonUrlParamsMap = new HashMap<>();    // templateName -> (phone -> buttonParam)
            Map<String, Map<String, String>> buttonIndexParamsMap = new HashMap<>();  // templateName -> (phone -> buttonIndex)

            int index = 0;
            for (Object item : items) {
                index++;
                Map<String, Object> itemContext = new HashMap<>(context);

                // Inject node-level templateName/templateVars/languageCode into the item so
                // forEach.eval = "#ctx['item']" produces a complete message map. Items may be
                // either Maps (DB rows / JSON) or Java beans (UserDTO from {#ctx['user']}) —
                // convert beans to Map first.
                if (nodeLevelTemplateName != null) {
                    Map<String, Object> enrichedItem;
                    if (item instanceof Map) {
                        enrichedItem = new HashMap<>((Map<String, Object>) item);
                    } else {
                        try {
                            enrichedItem = objectMapper.convertValue(item, Map.class);
                            if (enrichedItem == null) enrichedItem = new HashMap<>();
                        } catch (Exception e) {
                            log.warn("Could not convert WhatsApp iteration item ({}) to Map: {}",
                                    item != null ? item.getClass().getSimpleName() : "null", e.getMessage());
                            enrichedItem = new HashMap<>();
                        }
                    }
                    enrichedItem.put("templateName", nodeLevelTemplateName);
                    if (nodeLevelTemplateVars != null) {
                        enrichedItem.put("templateVars", nodeLevelTemplateVars);
                    }
                    if (nodeLevelLanguageCode != null && !enrichedItem.containsKey("languageCode")) {
                        enrichedItem.put("languageCode", nodeLevelLanguageCode);
                    }
                    itemContext.put("item", enrichedItem);
                } else {
                    itemContext.put("item", item);
                }

                List<Map<String, Object>> messagesToSend = processForEachOperation(
                        nodeDTO.getForEach(), itemContext);

                for (Map<String, Object> messageData : messagesToSend) {
                    // Recipient extraction — mirrors SendEmailNodeHandler.extractEmailAddress:
                    // 1. Node-level recipientField (explicit choice: a SpEL expression, or a field
                    //    name — supports parent numbers and audience custom fields like
                    //    "Phone Number", which live on the context, not on a user item)
                    // 2. Known key aliases (camelCase, snake_case, COMBOT 'to', parent/guardian)
                    // 3. Last-resort scan for a phone-shaped value on the item
                    String mobileNumber = extractMobileNumber(messageData, nodeLevelRecipientField,
                            itemContext, items.size() == 1);
                    
                    String templateName = (String) messageData.get("templateName");
                    String languageCode = (String) messageData.get("languageCode");
                    String userId = (String) messageData.get("userId");
                    
                    // BACKWARD COMPATIBLE: Accept both "templateVars" (Map) and "params" (List or Map - COMBOT format)
                    Map<String, String> templateVars = (Map<String, String>) messageData.get("templateVars");
                    if (templateVars == null) {
                        Object paramsObj = messageData.get("params");
                        if (paramsObj instanceof List) {
                            // COMBOT format: params is a List<String> - convert to positional Map
                            List<String> paramsList = (List<String>) paramsObj;
                            templateVars = new HashMap<>();
                            for (int i = 0; i < paramsList.size(); i++) {
                                templateVars.put(String.valueOf(i + 1),
                                        paramsList.get(i) != null ? paramsList.get(i) : "");
                            }
                        } else if (paramsObj instanceof Map) {
                            // COMBOT format: params is a Map<String, Object> (e.g., {parentName: "X", childrenName: "Y"})
                            // Convert named keys to positional: sort by key name for deterministic ordering
                            Map<String, Object> paramsMap = (Map<String, Object>) paramsObj;
                            templateVars = new HashMap<>();
                            // Separate numeric and named keys
                            List<Map.Entry<String, Object>> numericEntries = new ArrayList<>();
                            List<Map.Entry<String, Object>> namedEntries = new ArrayList<>();
                            for (Map.Entry<String, Object> pEntry : paramsMap.entrySet()) {
                                try {
                                    Integer.parseInt(pEntry.getKey());
                                    numericEntries.add(pEntry);
                                } catch (NumberFormatException e) {
                                    namedEntries.add(pEntry);
                                }
                            }
                            // Add numeric keys as-is
                            for (Map.Entry<String, Object> pEntry : numericEntries) {
                                templateVars.put(pEntry.getKey(),
                                        pEntry.getValue() != null ? pEntry.getValue().toString() : "");
                            }
                            // Sort named keys alphabetically for deterministic positional assignment
                            namedEntries.sort(Comparator.comparing(Map.Entry::getKey));
                            int paramPos = 1;
                            for (Map.Entry<String, Object> pEntry : namedEntries) {
                                // Skip positions already taken by numeric keys
                                while (templateVars.containsKey(String.valueOf(paramPos))) paramPos++;
                                templateVars.put(String.valueOf(paramPos++),
                                        pEntry.getValue() != null ? pEntry.getValue().toString() : "");
                            }
                        }
                    }
                    
                    // Resolve dynamic templateVars values the same way SEND_EMAIL does:
                    // '#...' → SpEL against the item context (with #item bound), plain
                    // string that matches an item field → that field's value, else literal.
                    // Previously values were passed through VERBATIM, so an AI-drafted
                    // "#item['full_name']" reached Meta as literal text in the message.
                    if (templateVars != null && !templateVars.isEmpty()) {
                        Map<String, String> resolvedVars = new HashMap<>();
                        for (Map.Entry<String, String> varEntry : templateVars.entrySet()) {
                            resolvedVars.put(varEntry.getKey(),
                                    resolveTemplateVarValue(varEntry.getValue(), messageData, itemContext));
                        }
                        templateVars = resolvedVars;
                    }

                    // NEW: Extract COMBOT-specific fields
                    log.debug("messageData keys for template {}: {}", templateName, messageData.keySet());
                    String headerImage = (String) messageData.get("headerImage");
                    String headerVideo = (String) messageData.get("headerVideo");
                    String buttonUrlParam = (String) messageData.get("buttonUrlParam");
                    String buttonIndex = (String) messageData.getOrDefault("buttonIndex", "0");

                    if (headerVideo == null && headerImage == null) {
                        log.info("No header media found in messageData for template {}. Keys: {}", templateName, messageData.keySet());
                    }

                    try {
                        // 0. Validate template. A node whose templateName is an expression can
                        // resolve to nothing (e.g. a weekday with no configured template); the
                        // batch map accepts a null key, so without this the request would reach
                        // notification-service nameless and fail there instead of here.
                        if (!StringUtils.hasText(templateName)) {
                            log.warn("Skipping user {}: no template resolved for this node.", userId);
                            results.add("SKIPPED: User " + userId + " - No template resolved.");
                            skippedCount++;
                            failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                    .index(index)
                                    .mobileNumber(mobileNumber)
                                    .languageCode(languageCode)
                                    .templateVars(new HashMap<>(templateVars != null ? templateVars : Map.of()))
                                    .itemData(item)
                                    .errorMessage("No template resolved")
                                    .errorType("VALIDATION_ERROR")
                                    .failureReason("SKIPPED")
                                    .build());
                            continue;
                        }

                        // 1. Validate Mobile Number
                        if (!StringUtils.hasText(mobileNumber)) {
                            log.warn("Skipping user {}: mobile number is null or empty.", userId);
                            results.add("SKIPPED: User " + userId + " - Missing mobile number.");
                            skippedCount++;
                            failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                    .index(index)
                                    .mobileNumber(mobileNumber)
                                    .templateName(templateName)
                                    .languageCode(languageCode)
                                    .templateVars(new HashMap<>(templateVars != null ? templateVars : Map.of()))
                                    .itemData(item)
                                    .errorMessage("Missing mobile number")
                                    .errorType("VALIDATION_ERROR")
                                    .failureReason("SKIPPED")
                                    .build());
                            continue;
                        }

                        // Sanitize to digits and prepend 91 for bare 10-digit numbers
                        // when the institute defaults to India (blank/unknown or India).
                        String sanitizedMobile = PhoneCountryUtil.normalizePhone(mobileNumber, instituteDefaultsToIndia);

                        if (!StringUtils.hasText(sanitizedMobile)) {
                            log.warn("Skipping user {}: mobile number '{}' is invalid after sanitization.", userId,
                                    mobileNumber);
                            results.add("SKIPPED: User " + userId + " - Invalid mobile number.");
                            skippedCount++;
                            failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                    .index(index)
                                    .mobileNumber(mobileNumber)
                                    .templateName(templateName)
                                    .languageCode(languageCode)
                                    .templateVars(new HashMap<>(templateVars != null ? templateVars : Map.of()))
                                    .itemData(item)
                                    .errorMessage("Invalid mobile number")
                                    .errorType("VALIDATION_ERROR")
                                    .failureReason("SKIPPED")
                                    .build());
                            continue;
                        }

                        // 2. Deduplicate
                        String dedupeKey = sanitizedMobile + "::" + templateName;
                        if (sentLog.contains(dedupeKey)) {
                            log.warn("Skipping user {}: duplicate request for template '{}'.", userId, templateName);
                            results.add("SKIPPED: User " + userId + " - Duplicate request.");
                            skippedCount++;
                            failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                    .index(index)
                                    .mobileNumber(mobileNumber)
                                    .templateName(templateName)
                                    .languageCode(languageCode)
                                    .templateVars(new HashMap<>(templateVars != null ? templateVars : Map.of()))
                                    .itemData(item)
                                    .errorMessage("Duplicate request")
                                    .errorType("DUPLICATE")
                                    .failureReason("SKIPPED")
                                    .build());
                            continue;
                        }

                        // DETECT COMBOT FORMAT: If params was originally a List or Map (converted above),
                        // skip DB template lookup - COMBOT workflows define template directly in config
                        boolean isCombotFormat = messageData.get("params") != null;
                        
                        Map<String, String> finalParamMap;
                        if (isCombotFormat) {
                            // COMBOT format: Skip DB lookup, use params directly (already converted to Map)
                            log.debug("COMBOT format detected - skipping template DB lookup for: {}", templateName);
                            finalParamMap = templateVars != null ? templateVars : new HashMap<>();
                        } else {
                            // SEND_WHATSAPP format: Best-effort Template lookup in admin_core's
                            // `templates` table for param validation. Some institutes only have
                            // their WhatsApp templates in notification_service's whatsapp_templates
                            // table (created via the Message Templates UI), so a miss here is not
                            // fatal — notification-service does its own template resolution on send.
                            String cacheKey = instituteId + ":" + templateName;
                            Template template = templateCache.get(cacheKey);
                            if (template == null) {
                                template = templateRepository
                                        .findByInstituteIdAndNameAndType(instituteId, templateName, "WHATSAPP")
                                        .orElse(null);
                                if (template != null) {
                                    templateCache.put(cacheKey, template);
                                }
                            }
                            if (template != null) {
                                finalParamMap = buildValidatedParams(template, templateVars, userId,
                                        messageData, itemContext);
                            } else if (nodeLevelTemplateParams != null) {
                                // No admin-core row (the template was authored in notification-service's
                                // whatsapp_templates), but the builder recorded the template's expected
                                // params on the node. That is a good enough spec to run the same
                                // required-key auto-fill, which is what stops an unmapped placeholder
                                // from reaching Meta empty.
                                log.info(
                                        "Admin-core Template row not found for institute {} name {} — validating against the node's _templateParams {} instead.",
                                        instituteId, templateName, nodeLevelTemplateParams.keySet());
                                finalParamMap = buildParamsFromSpec(nodeLevelTemplateParams, templateVars,
                                        messageData, itemContext);
                            } else {
                                log.warn(
                                        "Admin-core Template row not found for institute {} name {} and the node carries no _templateParams — proceeding without param validation (notification-service will resolve from whatsapp_templates).",
                                        instituteId, templateName);
                                finalParamMap = templateVars != null ? templateVars : new HashMap<>();
                            }
                        }
                        
                        // 4b. Fail closed on an empty placeholder. Meta rejects a template message whose
                        // body parameter has no text with "(#131008) Required parameter is missing", so
                        // dispatching one is a guaranteed failure that the node would nevertheless have
                        // reported as a success (the unified-send call returns 200 and the per-recipient
                        // provider result is never inspected). Skipping here turns an invisible
                        // non-delivery into a visible SKIPPED row naming the offending parameter.
                        List<String> blankParams = finalParamMap.entrySet().stream()
                                .filter(e -> !StringUtils.hasText(e.getValue()))
                                .map(Map.Entry::getKey)
                                .sorted()
                                .toList();
                        if (!blankParams.isEmpty() && !isCombotFormat) {
                            log.warn("Skipping user {}: template '{}' parameter(s) {} resolved to empty — Meta would reject this with 131008.",
                                    userId, templateName, blankParams);
                            results.add("SKIPPED: User " + userId + " - Empty template parameter(s) " + blankParams + ".");
                            skippedCount++;
                            failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                    .index(index)
                                    .mobileNumber(sanitizedMobile)
                                    .templateName(templateName)
                                    .languageCode(languageCode)
                                    .templateVars(new HashMap<>(finalParamMap))
                                    .itemData(item)
                                    .errorMessage("Template parameter(s) " + blankParams
                                            + " resolved to an empty value. Map them to a field that exists on this item"
                                            + " (or set them literally) — WhatsApp rejects empty parameters.")
                                    .errorType("VALIDATION_ERROR")
                                    .failureReason("SKIPPED")
                                    .build());
                            continue;
                        }

                        Map<String, Map<String, String>> singleUser = Map.of(sanitizedMobile, finalParamMap);

                        // 5. Add to Batch
                        WhatsappRequest batchRequest = batchRequestMap.computeIfAbsent(templateName, k -> {
                            WhatsappRequest newReq = new WhatsappRequest();
                            newReq.setTemplateName(templateName);
                            newReq.setLanguageCode(StringUtils.hasText(languageCode) ? languageCode : "en");
                            newReq.setHeaderParams(new HashMap<>()); // Initialize for potential image headers
                            newReq.setUserDetails(new ArrayList<>()); // Initialize list
                            newReq.setHeaderVideoParams(new HashMap<>()); // NEW: Initialize video params
                            newReq.setButtonUrlParams(new HashMap<>());   // NEW: Initialize button params
                            newReq.setButtonIndexParams(new HashMap<>()); // NEW: Initialize button index params
                            return newReq;
                        });

                        batchRequest.getUserDetails().add(singleUser);
                        
                        // NEW: Handle COMBOT-specific features
                        // Header Image (existing format: headerParams)
                        if (StringUtils.hasText(headerImage)) {
                            if (batchRequest.getHeaderParams() == null) {
                                batchRequest.setHeaderParams(new HashMap<>());
                            }
                            batchRequest.getHeaderParams().put(sanitizedMobile, Map.of("1", headerImage));
                            batchRequest.setHeaderType("image");
                        }
                        
                        // Header Video (NEW for COMBOT)
                        if (StringUtils.hasText(headerVideo)) {
                            batchRequest.getHeaderVideoParams().put(sanitizedMobile, headerVideo);
                            batchRequest.setHeaderType("video");
                        }
                        
                        // Button URL Param (NEW for COMBOT)
                        if (StringUtils.hasText(buttonUrlParam)) {
                            batchRequest.getButtonUrlParams().put(sanitizedMobile, buttonUrlParam);
                            batchRequest.getButtonIndexParams().put(sanitizedMobile, 
                                StringUtils.hasText(buttonIndex) ? buttonIndex : "0");
                        }
                        
                        sentLog.add(dedupeKey); // Mark as processed
                        processedCount++;

                        // Store item for failure tracking
                        mobileToItemMap.put(sanitizedMobile, item);

                    } catch (Exception e) {
                        log.error("Failed to build WhatsApp request for item {}: {}", item, e.getMessage());
                        SentryLogger.SentryEventBuilder.error(e)
                                .withMessage("Failed to build WhatsApp request for user")
                                .withTag("workflow.execution.id",
                                        workflowExecutionId != null ? workflowExecutionId : "unknown")
                                .withTag("node.id", nodeId != null ? nodeId : "unknown")
                                .withTag("node.type", "SEND_WHATSAPP")
                                .withTag("template.name", templateName != null ? templateName : "unknown")
                                .withTag("institute.id", instituteId)
                                .withTag("operation", "buildWhatsAppRequest")
                                .send();
                        results.add("ERROR: " + e.getMessage());
                        failedCount++; // Count build failures as failed
                        failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                .index(index)
                                .mobileNumber(mobileNumber)
                                .templateName(templateName)
                                .languageCode(languageCode)
                                .templateVars(new HashMap<>(templateVars != null ? templateVars : Map.of()))
                                .itemData(item)
                                .errorMessage(e.getMessage())
                                .errorType("PROCESSING_ERROR")
                                .failureReason("FAILED")
                                .build());
                    }
                }
            }

            // 6. Dispatch Batches
            List<WhatsappRequest> finalBatchList = new ArrayList<>(batchRequestMap.values());
            if (!finalBatchList.isEmpty()) {
                // Rate limit check
                if (!rateLimitService.checkAndIncrement(instituteId, "WHATSAPP", processedCount)) {
                    log.warn("WHATSAPP rate limit exceeded for institute: {}. Skipping {} messages.", instituteId, processedCount);
                    changes.put("rateLimitExceeded", true);
                    changes.put("status", "rate_limited");
                    if (logId != null) {
                        executionLogger.completeNodeExecution(logId, ExecutionLogStatus.FAILED, null,
                                "WhatsApp rate limit exceeded for institute: " + instituteId);
                    }
                    return changes;
                }

                try {
                    // Chunked dispatch — mirrors SendEmailNodeHandler: split each batch's
                    // userDetails into chunks, throttle between chunks, and bound each
                    // chunk send with a timeout so a hung provider call can't block the
                    // workflow thread forever.
                    dispatchBatchesChunked(finalBatchList, instituteId, chunkSize, throttleMs, chunkTimeoutMs,
                            workflowOrigin(context));
                    log.info("Successfully dispatched {} WhatsApp batches for {} total users (chunkSize={}, throttleMs={}, chunkTimeoutMs={}).",
                            finalBatchList.size(), processedCount, chunkSize, throttleMs, chunkTimeoutMs);
                    results.add("SUCCESS: Dispatched " + finalBatchList.size() + " batches for " + processedCount
                            + " users.");
                } catch (Exception e) {
                    log.error("Failed to send WhatsApp batch request: {}", e.getMessage(), e);
                    SentryLogger.SentryEventBuilder.error(e)
                            .withMessage("WhatsApp batch send failed")
                            .withTag("workflow.execution.id",
                                    workflowExecutionId != null ? workflowExecutionId : "unknown")
                            .withTag("node.id", nodeId != null ? nodeId : "unknown")
                            .withTag("node.type", "SEND_WHATSAPP")
                            .withTag("batch.count", String.valueOf(finalBatchList.size()))
                            .withTag("user.count", String.valueOf(processedCount))
                            .withTag("institute.id", instituteId)
                            .withTag("operation", "sendWhatsAppBatch")
                            .send();
                    results.add("ERROR: Batch send failed - " + e.getMessage());

                    // Handle failures for all users in these batches
                    for (WhatsappRequest batch : finalBatchList) {
                        if (batch.getUserDetails() != null) {
                            for (Map<String, Map<String, String>> userMap : batch.getUserDetails()) {
                                // userMap key is the mobile number
                                for (String mobile : userMap.keySet()) {
                                    Object originalItem = mobileToItemMap.get(mobile);

                                    failedMessages.add(WhatsAppExecutionDetails.FailedMessage.builder()
                                            .mobileNumber(mobile)
                                            .templateName(batch.getTemplateName())
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
            }
            // --- OPTIMIZATION END ---

            changes.put("status", "completed");
            changes.put("results", results);
            changes.put("processed_count", processedCount);
            changes.put("skipped_count", skippedCount);

            // Complete logging with success
            if (logId != null) {
                ExecutionLogStatus status = ExecutionLogStatus.SUCCESS;
                if (failedCount > 0 || skippedCount > 0) {
                    status = ExecutionLogStatus.PARTIAL_SUCCESS;
                }
                if (processedCount == 0 && (failedCount > 0 || skippedCount > 0)) {
                    if (skippedCount == 0) {
                        status = ExecutionLogStatus.FAILED;
                    }
                }

                WhatsAppExecutionDetails details = WhatsAppExecutionDetails.builder()
                        // Minimize data: do not store full context
                        .inputContext(null)
                        .outputContext(null)
                        .successCount(processedCount)
                        .failureCount(failedCount)
                        .skippedCount(skippedCount)
                        .failedMessages(failedMessages)
                        .executionTimeMs(System.currentTimeMillis() - startTime)
                        .build();

                executionLogger.completeNodeExecution(logId, status, details, null);
            }

        } catch (Exception e) {
            log.error("Error handling SendWhatsApp node", e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("SendWhatsApp node execution failed")
                    .withTag("workflow.execution.id", workflowExecutionId != null ? workflowExecutionId : "unknown")
                    .withTag("node.id", nodeId != null ? nodeId : "unknown")
                    .withTag("node.type", "SEND_WHATSAPP")
                    .withTag("operation", "handleSendWhatsAppNode")
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

    /**
     * Evaluates the 'eval' expression to get the list of messages for a single
     * item.
     * BACKWARD COMPATIBLE: Accepts both List<Map> and single Map (COMBOT format)
     */
    private List<Map<String, Object>> processForEachOperation(ForEachConfigDTO forEachConfig,
            Map<String, Object> itemContext) {
        if (forEachConfig == null) {
            log.warn("No forEach configuration found in SendWhatsApp node");
            return List.of();
        }

        String evalExpression = forEachConfig.getEval();
        if (!StringUtils.hasText(evalExpression)) {
            log.warn("SEND_WHATSAPP forEach missing 'eval' expression");
            return List.of();
        }

        try {
            Object evalResult = spelEvaluator.evaluate(evalExpression, itemContext);
            if (evalResult instanceof List) {
                return (List<Map<String, Object>>) evalResult;
            } else if (evalResult instanceof Map) {
                // COMBOT compatibility: single Map result
                return List.of((Map<String, Object>) evalResult);
            } else if (evalResult != null) {
                log.warn("Eval expression did not return a List or Map. Got: {}", evalResult.getClass().getName());
            }
        } catch (Exception e) {
            log.error("Error processing forEach operation for item: {}", itemContext.get("item"), e);
            SentryLogger.logError(e, "WhatsApp forEach operation failed", Map.of(
                    "operation", "processForEachOperation",
                    "node.type", "SEND_WHATSAPP"));
        }

        return List.of();
    }

    /**
     * Validates template variables against the template's dynamic parameters.
     * Mirrors SendEmailNodeHandler's "all item fields become placeholders" behavior:
     * a required parameter missing from the configured templateVars is auto-resolved
     * from the item's fields (camelCase/snake_case variants), then the workflow
     * context, then customFields — throwing only when nothing at all resolves.
     * This lets a WhatsApp template with params like fullName work with zero
     * manual mapping when the iterated items already carry those fields.
     */
    private Map<String, String> buildValidatedParams(Template template, Map<String, String> templateVarsFromAutomation,
            String userId, Map<String, Object> item, Map<String, Object> itemContext) {
        // Parse template's required parameters
        Map<String, String> dynamicParams = parseDynamicParameters(template.getDynamicParameters());
        Map<String, String> configuredVars = templateVarsFromAutomation != null
                ? templateVarsFromAutomation
                : Map.of();
        Map<String, String> finalParamMap = new HashMap<>();

        // Validate and build final parameters
        if (dynamicParams != null && !dynamicParams.isEmpty()) {
            for (String requiredKey : dynamicParams.keySet()) {
                String value = configuredVars.get(requiredKey);
                if (StringUtils.hasText(value)) {
                    finalParamMap.put(requiredKey, value);
                    continue;
                }
                // Auto-fill: item field (with case-style variants) → context → customFields.
                // Reached both when the key was never mapped and when its mapping resolved to
                // an empty string (a templateVar pointing at a field the item does not have).
                String autoResolved = autoResolveParam(requiredKey, item, itemContext);
                if (autoResolved != null) {
                    finalParamMap.put(requiredKey, autoResolved);
                    continue;
                }
                throw new RuntimeException("Missing required template variable '" + requiredKey +
                        "' for template: " + template.getName() + ", user: " + userId);
            }
        } else {
            log.warn("No dynamic_parameters JSON found for template: {}. Proceeding without validation.",
                    template.getName());
            finalParamMap.putAll(configuredVars); // Send all vars if no dynamic params defined
        }
        return finalParamMap;
    }

    /**
     * Same required-key fill as {@link #buildValidatedParams}, driven by the node's recorded
     * {@code _templateParams} instead of an admin-core Template row — for institutes whose
     * WhatsApp templates exist only in notification-service's {@code whatsapp_templates}.
     *
     * <p>Unlike buildValidatedParams this does not throw when a key resolves to nothing: it
     * leaves the value empty and lets the caller's blank-parameter guard record a precise
     * SKIPPED row. The node's params are the builder's snapshot of the template rather than
     * the live definition, so a stale entry should not abort the whole send.</p>
     */
    private Map<String, String> buildParamsFromSpec(Map<String, String> templateParamSpec,
                                                    Map<String, String> templateVarsFromAutomation,
                                                    Map<String, Object> item,
                                                    Map<String, Object> itemContext) {
        Map<String, String> configuredVars = templateVarsFromAutomation != null
                ? templateVarsFromAutomation
                : Map.of();
        Map<String, String> finalParamMap = new LinkedHashMap<>();
        for (String requiredKey : templateParamSpec.keySet()) {
            String value = configuredVars.get(requiredKey);
            if (StringUtils.hasText(value)) {
                finalParamMap.put(requiredKey, value);
                continue;
            }
            // The spec's value is the placeholder's human name (e.g. "name"), which is often the
            // field name on the item — try the key ("1") and then that name before giving up.
            String autoResolved = autoResolveParam(requiredKey, item, itemContext);
            if (autoResolved == null) {
                String paramName = templateParamSpec.get(requiredKey);
                if (StringUtils.hasText(paramName)) {
                    autoResolved = autoResolveParam(paramName.trim(), item, itemContext);
                }
            }
            finalParamMap.put(requiredKey, autoResolved != null ? autoResolved : "");
        }
        // Anything explicitly mapped but not in the spec still travels (headers, extra params).
        for (Map.Entry<String, String> e : configuredVars.entrySet()) {
            finalParamMap.putIfAbsent(e.getKey(), e.getValue() != null ? e.getValue() : "");
        }
        return finalParamMap;
    }

    /**
     * Resolve a template parameter that wasn't explicitly mapped, in the same order
     * SendEmailNodeHandler enriches placeholders: item field (including
     * camelCase/snake_case variants of the key) → workflow context → customFields.
     * Returns null when nothing resolves.
     */
    private String autoResolveParam(String key, Map<String, Object> item, Map<String, Object> itemContext) {
        Object fromItem = lookupFieldVariants(item, key);
        if (fromItem != null) {
            return String.valueOf(fromItem);
        }
        if (itemContext != null) {
            Object fromContext = itemContext.get(key);
            if (fromContext != null && isScalar(fromContext)) {
                return String.valueOf(fromContext);
            }
            Object customFieldsObj = itemContext.get("customFields");
            if (customFieldsObj instanceof Map) {
                Object fromCustom = lookupFieldVariants((Map<String, Object>) customFieldsObj, key);
                if (fromCustom != null) {
                    return String.valueOf(fromCustom);
                }
            }
        }
        return null;
    }

    /**
     * Look up a key on a map trying the exact key first, then its snake_case and
     * camelCase variants (queries return either style depending on the source —
     * fetch_ssigm_by_package emits full_name while fetch_students_by_batch emits
     * fullName). Only scalar values are returned — nested objects/collections are
     * never useful as a message parameter.
     */
    private static Object lookupFieldVariants(Map<String, Object> map, String key) {
        if (map == null || key == null) {
            return null;
        }
        Object exact = map.get(key);
        if (exact != null && isScalar(exact)) {
            return exact;
        }
        String snake = key.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase();
        if (!snake.equals(key)) {
            Object v = map.get(snake);
            if (v != null && isScalar(v)) {
                return v;
            }
        }
        StringBuilder camelBuilder = new StringBuilder();
        boolean upperNext = false;
        for (char c : key.toCharArray()) {
            if (c == '_' || c == ' ') {
                upperNext = true;
            } else {
                camelBuilder.append(upperNext ? Character.toUpperCase(c) : c);
                upperNext = false;
            }
        }
        String camel = camelBuilder.toString();
        if (!camel.equals(key)) {
            Object v = map.get(camel);
            if (v != null && isScalar(v)) {
                return v;
            }
        }
        return null;
    }

    private static boolean isScalar(Object value) {
        return value instanceof String || value instanceof Number || value instanceof Boolean
                || value instanceof Character || value instanceof Enum;
    }

    /**
     * Return the first non-blank string value from the given keys in a message map.
     * Used to handle both camelCase and snake_case shapes (e.g. mobileNumber vs mobile_number)
     * when the iteration item came from a bean serialized via a SnakeCase ObjectMapper.
     */
    /**
     * Resolve one templateVars value for the current item. Mirrors SEND_EMAIL's
     * substitution order: SpEL (value starts with '#', evaluated with both
     * {@code #ctx} and {@code #item} bound) → item-field lookup by name (with
     * camelCase/snake_case variants) → workflow-context lookup → customFields
     * lookup → literal. A failed SpEL evaluation resolves to "" (and logs)
     * rather than leaking the raw expression text into the outbound message.
     */
    private String resolveTemplateVarValue(String value, Map<String, Object> item,
                                           Map<String, Object> itemContext) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        if (trimmed.startsWith("#")) {
            try {
                Object out = spelEvaluator.evaluate(trimmed, itemContext, Map.of("item", item));
                return out != null ? String.valueOf(out) : "";
            } catch (Exception e) {
                log.warn("templateVars SpEL '{}' failed to resolve: {} — sending empty value", trimmed, e.getMessage());
                return "";
            }
        }
        Object fieldValue = item.get(trimmed);
        if (fieldValue != null) {
            return String.valueOf(fieldValue);
        }
        // Same enrichment chain SEND_EMAIL applies: item variants → context → customFields.
        String resolved = autoResolveParam(trimmed, item, itemContext);
        if (resolved != null) {
            return resolved;
        }
        return value;
    }

    /**
     * Extract the recipient phone from a message map. Mirrors
     * SendEmailNodeHandler.extractEmailAddress:
     * 1. explicit node-level recipientField — a SpEL expression (starts with '#',
     *    e.g. {@code #ctx['customFields']['Phone Number']}) or a plain field name,
     *    resolved against the item and, for single-item sends only, the workflow
     *    context and its customFields;
     * 2. known key aliases — camelCase, snake_case, COMBOT 'to', parent/guardian
     *    variants (UserDTO serializes snake_case via the shared ObjectMapper, so
     *    both forms must be checked — mirrors IteratorProcessorStrategy);
     * 3. last-resort scan over all values for a phone-shaped string (covers
     *    audience custom fields named "Phone Number", "WhatsApp Number", etc.).
     *
     * <p><b>Why the item alone is not enough.</b> When a node iterates the resolved
     * platform user ({@code on = "{#ctx['user']}"}), the item carries that user's
     * STORED mobile_number, which for an audience lead is frequently not the number
     * they just typed into the form — that value lives only in
     * {@code #ctx['customFields']['Phone Number']}. Before this, recipientField did a
     * bare {@code messageData.get(name)}, so naming a custom field silently missed and
     * fell through to the stored number: the message went to the wrong phone with no
     * warning. Observed live on workflow 85cb8ef5 (sent to the account's old number
     * instead of the submitted one).</p>
     *
     * <p><b>Why the context fallback is gated on a single item.</b> The context is shared
     * across every iteration, so an unconditional fallback would route a whole batch to
     * one person's number whenever an item happened to lack the field. Cross-recipient
     * mis-sends are worse than a skip, so for multi-item sends a plain recipientField
     * must resolve on the item itself; use a SpEL expression for anything else.</p>
     */
    private String extractMobileNumber(Map<String, Object> messageData, String recipientField,
                                       Map<String, Object> itemContext, boolean singleItemSend) {
        if (StringUtils.hasText(recipientField)) {
            String field = recipientField.trim();
            if (field.startsWith("#")) {
                // Explicit expression — evaluated exactly like a templateVar, with #ctx and #item
                // bound. Never guesses, so it is safe regardless of batch size.
                try {
                    Object out = spelEvaluator.evaluate(field, itemContext, Map.of("item", messageData));
                    if (out != null && StringUtils.hasText(String.valueOf(out))) {
                        return String.valueOf(out);
                    }
                    log.warn("recipientField SpEL '{}' resolved to nothing for this item", field);
                } catch (Exception e) {
                    log.warn("recipientField SpEL '{}' failed to resolve: {}", field, e.getMessage());
                }
            } else {
                Object v = lookupFieldVariants(messageData, field);
                if (v != null && StringUtils.hasText(String.valueOf(v))) {
                    return String.valueOf(v);
                }
                if (singleItemSend) {
                    String resolved = autoResolveParam(field, messageData, itemContext);
                    if (resolved != null && StringUtils.hasText(resolved)) {
                        return resolved;
                    }
                }
                log.warn("recipientField '{}' did not resolve on this item (keys: {}) — falling back to the item's own phone fields",
                        field, messageData.keySet());
            }
        }
        String fromKnownKeys = firstNonBlank(messageData,
                "mobileNumber", "mobile_number", "mobile",
                "phoneNumber", "phone_number", "phone", "to",
                "whatsappNumber", "whatsapp_number",
                "parentMobile", "parent_mobile", "parentsMobile", "parents_mobile",
                "guardianMobile", "guardian_mobile", "contactNumber", "contact_number");
        if (fromKnownKeys != null) {
            return fromKnownKeys;
        }
        // Defensive fallback scan — only values that LOOK like phone numbers
        // (10-15 digits, phone punctuation only) are accepted, so emails, ids,
        // pincodes and free text never match.
        for (Object value : messageData.values()) {
            if (value instanceof String && looksLikePhoneNumber((String) value)) {
                return (String) value;
            }
        }
        return null;
    }

    private static boolean looksLikePhoneNumber(String raw) {
        if (raw == null) {
            return false;
        }
        String s = raw.trim();
        if (s.isEmpty() || !s.matches("[+\\d()\\s.-]+")) {
            return false;
        }
        long digits = s.chars().filter(Character::isDigit).count();
        return digits >= 10 && digits <= 15;
    }

    /**
     * Chunked batch dispatch — mirrors SendEmailNodeHandler.sendRegularBatchesChunked.
     * Splits each WhatsappRequest's userDetails into {@code chunkSize} slices (the
     * per-phone header/button maps are filtered down to each slice's phones),
     * throttles between sends, and bounds each send with a per-chunk timeout.
     * A single-chunk batch reuses the original request object unchanged.
     */
    private void dispatchBatchesChunked(List<WhatsappRequest> batches, String instituteId,
            int chunkSize, long throttleMs, long chunkTimeoutMs, MessageOrigin origin) {
        boolean firstSend = true;
        for (WhatsappRequest batch : batches) {
            List<Map<String, Map<String, String>>> users = batch.getUserDetails();
            if (users == null || users.isEmpty()) {
                continue;
            }
            int total = users.size();
            for (int i = 0; i < total; i += chunkSize) {
                if (!firstSend) sleepQuiet(throttleMs);
                int end = Math.min(i + chunkSize, total);
                WhatsappRequest chunkRequest;
                if (i == 0 && end == total) {
                    chunkRequest = batch; // single-chunk batch: reuse as-is
                } else {
                    chunkRequest = buildChunkRequest(batch, users.subList(i, end));
                }
                int chunkUserCount = end - i;
                runWithTimeout(
                        () -> notificationService.sendWhatsappViaUnified(List.of(chunkRequest), instituteId, origin),
                        chunkTimeoutMs,
                        "WhatsApp chunk (template=" + batch.getTemplateName() + ", users=" + chunkUserCount + ")");
                firstSend = false;
            }
        }
    }

    /**
     * The workflow this node runs in, so notification-service can show "sent by workflow X" on
     * each message. Null when the run carries no workflow id.
     */
    static MessageOrigin workflowOrigin(Map<String, Object> context) {
        Object workflowId = context != null ? context.get("workflowId") : null;
        if (workflowId == null) return null;
        Object workflowName = context.get(WorkflowEngineService.WORKFLOW_NAME_KEY);
        return MessageOrigin.workflow(workflowId.toString(), workflowName != null ? workflowName.toString() : null);
    }

    private static WhatsappRequest buildChunkRequest(WhatsappRequest batch,
            List<Map<String, Map<String, String>>> chunkUsers) {
        WhatsappRequest chunk = new WhatsappRequest();
        chunk.setTemplateName(batch.getTemplateName());
        chunk.setLanguageCode(batch.getLanguageCode());
        chunk.setHeaderType(batch.getHeaderType());
        chunk.setUserDetails(new ArrayList<>(chunkUsers));
        Set<String> phones = new HashSet<>();
        for (Map<String, Map<String, String>> user : chunkUsers) {
            phones.addAll(user.keySet());
        }
        chunk.setHeaderParams(filterByPhones(batch.getHeaderParams(), phones));
        chunk.setHeaderVideoParams(filterByPhones(batch.getHeaderVideoParams(), phones));
        chunk.setButtonUrlParams(filterByPhones(batch.getButtonUrlParams(), phones));
        chunk.setButtonIndexParams(filterByPhones(batch.getButtonIndexParams(), phones));
        return chunk;
    }

    private static <V> Map<String, V> filterByPhones(Map<String, V> source, Set<String> phones) {
        if (source == null || source.isEmpty()) {
            return source;
        }
        Map<String, V> filtered = new HashMap<>();
        for (Map.Entry<String, V> entry : source.entrySet()) {
            if (phones.contains(entry.getKey())) {
                filtered.put(entry.getKey(), entry.getValue());
            }
        }
        return filtered;
    }

    /**
     * Same contract as SendEmailNodeHandler.runWithTimeout: timeout → warn and
     * continue to the next chunk; other exceptions → propagate so the caller's
     * catch marks the batch failed; interrupt → restore flag and propagate.
     */
    private void runWithTimeout(Runnable task, long timeoutMs, String description) {
        if (timeoutMs <= 0) {
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

    private static void sleepQuiet(long ms) {
        if (ms <= 0) return;
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String firstNonBlank(Map<String, Object> messageData, String... keys) {
        for (String key : keys) {
            Object value = messageData.get(key);
            if (value == null) continue;
            String stringValue = String.valueOf(value);
            if (StringUtils.hasText(stringValue)) {
                return stringValue;
            }
        }
        return null;
    }

    /**
     * Helper to parse the dynamic_parameters JSON string from the Template entity.
     */
    private Map<String, String> parseDynamicParameters(String dynamicParametersJson) {
        if (!StringUtils.hasText(dynamicParametersJson)) {
            return new HashMap<>();
        }
        try {
            return objectMapper.readValue(dynamicParametersJson, new TypeReference<>() {
            });
        } catch (Exception e) {
            log.error("Failed to parse dynamic_parameters JSON: " + dynamicParametersJson, e);
            SentryLogger.logError(e, "Failed to parse WhatsApp template parameters", Map.of(
                    "operation", "parseDynamicParameters",
                    "node.type", "SEND_WHATSAPP"));
            return new HashMap<>();
        }
    }
}
