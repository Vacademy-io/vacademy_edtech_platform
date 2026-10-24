package vacademy.io.notification_service.features.chatbot_flow.engine.executors;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.engine.ChatbotNodeExecutor;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.NodeExecutionResult;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppFlowLeadClient;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * ASK_FIELD — ask one question tied to one CRM field, wait for the reply, validate it and save it.
 *
 * <p>Reached by traversal it sends the question and waits. The user's next message comes back
 * to it ({@link FlowExecutionContext#isReplyToWaitingNode()}): a valid answer is stored in the
 * session and written to the lead straight away (when the lead is known), and the flow moves on;
 * an invalid one gets {@code retryMessage} + the question again, up to {@code maxRetries} times,
 * after which the field is left empty and the flow moves on.
 *
 * <p>How it asks: option fields with ≤3 choices → reply buttons, ≤10 → a WhatsApp list, more (or
 * multi-select) → a numbered text message. Free-text fields are validated by type (email,
 * number, phone, url, date).
 *
 * <p>Config:
 * <pre>
 * { "fieldSource": "CUSTOM_FIELD" | "SYSTEM_FIELD", "customFieldId": "...", "systemField": "full_name" | "email",
 *   "fieldName": "Year Group", "fieldType": "dropdown", "options": [{"value": "Y5", "label": "Year 5"}],
 *   "question": "...", "retryMessage": "...", "maxRetries": 2, "allowSkip": false, "listButtonText": "Choose" }
 * </pre>
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AskFieldNodeExecutor implements ChatbotNodeExecutor {

    static final String SKIP_ID = "skip";
    static final String OPTION_ID_PREFIX = "opt_";
    static final String RETRY_KEY_PREFIX = "__ask_retry_";

    private static final int MAX_BUTTONS = 3;
    private static final int MAX_LIST_ROWS = 10;
    private static final int BUTTON_TITLE_MAX = 20;
    private static final int ROW_TITLE_MAX = 24;
    private static final int ROW_DESCRIPTION_MAX = 72;
    private static final int MAX_TEXT_ANSWER = 1000;
    private static final int DEFAULT_MAX_RETRIES = 2;
    private static final String DEFAULT_RETRY = "Sorry, that doesn't look right. Please try again.";
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ISO_LOCAL_DATE,
            DateTimeFormatter.ofPattern("d/M/uuuu"),
            DateTimeFormatter.ofPattern("d-M-uuuu"),
            DateTimeFormatter.ofPattern("d.M.uuuu"),
            DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("d MMMM uuuu", Locale.ENGLISH));

    private final CrmLeadNodeSupport support;
    private final WhatsAppFlowLeadClient leadClient;
    private final ObjectMapper objectMapper;

    @Override
    public boolean canHandle(String nodeType) {
        return ChatbotNodeType.ASK_FIELD.name().equals(nodeType);
    }

    @Override
    public NodeExecutionResult execute(ChatbotFlowNode node, ChatbotFlowSession session,
                                       String userText, FlowExecutionContext context) {
        FieldSpec field = FieldSpec.from(support.parseConfig(node.getConfig()));
        if (!field.isConfigured()) {
            // No field picked in the builder — skip the node rather than strand the conversation.
            log.warn("ASK_FIELD node {} has no field configured — skipping", node.getId());
            return NodeExecutionResult.builder().success(true).build();
        }
        if (!context.isReplyToWaitingNode()) {
            NodeExecutionResult asked = ask(field, context, null);
            if (!asked.isSuccess()) return asked;
            Map<String, Object> output = new HashMap<>();
            output.put(RETRY_KEY_PREFIX + node.getId(), 0);
            return NodeExecutionResult.builder().success(true).waitForInput(true).outputVariables(output).build();
        }
        return handleReply(node, session, context, field);
    }

    // ==================== Asking ====================

    private NodeExecutionResult ask(FieldSpec field, FlowExecutionContext context, String prefix) {
        String text = prefix == null || prefix.isBlank() ? field.question() : prefix.trim() + "\n\n" + field.question();
        List<Option> options = field.options();
        boolean multi = field.isMultiSelect();
        int choices = options.size() + (field.allowSkip() ? 1 : 0);
        try {
            if (!options.isEmpty() && !multi && choices <= MAX_BUTTONS) {
                List<Map<String, Object>> buttons = new ArrayList<>();
                for (int i = 0; i < options.size(); i++) {
                    buttons.add(Map.of("id", OPTION_ID_PREFIX + i, "title", truncate(options.get(i).label(), BUTTON_TITLE_MAX)));
                }
                if (field.allowSkip()) buttons.add(Map.of("id", SKIP_ID, "title", "Skip"));
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("interactiveType", "button");
                payload.put("body", text);
                payload.put("buttons", buttons);
                support.sendInteractive(context, payload, text + "\n" + optionSummary(options, field.allowSkip()));
            } else if (!options.isEmpty() && !multi && choices <= MAX_LIST_ROWS) {
                List<Map<String, Object>> rows = new ArrayList<>();
                for (int i = 0; i < options.size(); i++) {
                    String label = options.get(i).label();
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", OPTION_ID_PREFIX + i);
                    row.put("title", truncate(label, ROW_TITLE_MAX));
                    if (label.length() > ROW_TITLE_MAX) row.put("description", truncate(label, ROW_DESCRIPTION_MAX));
                    rows.add(row);
                }
                if (field.allowSkip()) rows.add(Map.of("id", SKIP_ID, "title", "Skip"));
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("interactiveType", "list");
                payload.put("body", text);
                payload.put("listButtonText", truncate(field.listButtonText(), BUTTON_TITLE_MAX));
                payload.put("sections", List.of(Map.of("title", truncate(field.name(), ROW_TITLE_MAX), "rows", rows)));
                support.sendInteractive(context, payload, text + "\n" + optionSummary(options, field.allowSkip()));
            } else {
                StringBuilder sb = new StringBuilder(text);
                if (!options.isEmpty()) {
                    sb.append("\n");
                    for (int i = 0; i < options.size(); i++) {
                        sb.append("\n").append(i + 1).append(". ").append(options.get(i).label());
                    }
                    sb.append(multi
                            ? "\n\nYou can choose more than one — reply with the numbers separated by commas, e.g. 1, 3."
                            : "\n\nReply with the number of your choice.");
                }
                if (field.allowSkip()) sb.append("\nReply SKIP to skip this question.");
                support.sendText(context, sb.toString());
            }
            return NodeExecutionResult.builder().success(true).build();
        } catch (Exception e) {
            context.setLastSentBody(null);
            log.error("ASK_FIELD: question for '{}' not sent to {}: {}", field.name(), context.getPhoneNumber(), e.getMessage());
            return NodeExecutionResult.builder().success(false).errorMessage("Question send failed: " + e.getMessage()).build();
        }
    }

    private static String optionSummary(List<Option> options, boolean allowSkip) {
        List<String> labels = new ArrayList<>();
        options.forEach(o -> labels.add(o.label()));
        if (allowSkip) labels.add("Skip");
        return "[" + String.join(" / ", labels) + "]";
    }

    // ==================== Answer ====================

    private NodeExecutionResult handleReply(ChatbotFlowNode node, ChatbotFlowSession session,
                                            FlowExecutionContext context, FieldSpec field) {
        Map<String, Object> sessionCtx = support.sessionContext(session);
        String retryKey = RETRY_KEY_PREFIX + node.getId();
        Map<String, Object> output = new HashMap<>();

        Answer answer = resolve(field, context);
        if (answer.accepted()) {
            output.put(retryKey, 0);
            if (!answer.skipped()) {
                record(field, answer.value(), sessionCtx, output);
                saveNow(field, answer.value(), session, context, sessionCtx);
            }
            return NodeExecutionResult.builder().success(true).outputVariables(output).build();
        }

        int retries = toInt(sessionCtx.get(retryKey)) + 1;
        if (retries > field.maxRetries()) {
            log.info("ASK_FIELD: no valid answer for '{}' from {} after {} tries — moving on",
                    field.name(), context.getPhoneNumber(), retries);
            output.put(retryKey, 0);
            return NodeExecutionResult.builder().success(true).outputVariables(output).build();
        }
        output.put(retryKey, retries);
        NodeExecutionResult asked = ask(field, context, field.retryMessage());
        if (!asked.isSuccess()) return asked;
        return NodeExecutionResult.builder().success(true).waitForInput(true).outputVariables(output).build();
    }

    /** Keep the answer in the session — SAVE_TO_CRM sends every collected answer again at the end. */
    private void record(FieldSpec field, String value, Map<String, Object> sessionCtx, Map<String, Object> output) {
        if (field.isSystem()) {
            Map<String, String> system = CrmLeadNodeSupport.stringMap(sessionCtx, CrmLeadNodeSupport.KEY_SYSTEM);
            system.put(field.key(), value);
            output.put(CrmLeadNodeSupport.KEY_SYSTEM, system);
        } else {
            Map<String, String> fields = CrmLeadNodeSupport.stringMap(sessionCtx, CrmLeadNodeSupport.KEY_FIELDS);
            fields.put(field.key(), value);
            output.put(CrmLeadNodeSupport.KEY_FIELDS, fields);
            Map<String, String> labels = CrmLeadNodeSupport.stringMap(sessionCtx, CrmLeadNodeSupport.KEY_FIELD_LABELS);
            labels.put(field.key(), field.name());
            output.put(CrmLeadNodeSupport.KEY_FIELD_LABELS, labels);
        }
    }

    /** Write the answer onto the lead now, so a conversation that stops later still has it. */
    private void saveNow(FieldSpec field, String value, ChatbotFlowSession session,
                         FlowExecutionContext context, Map<String, Object> sessionCtx) {
        String responseId = CrmLeadNodeSupport.str(sessionCtx, CrmLeadNodeSupport.KEY_RESPONSE_ID);
        if (responseId == null) return; // lead not known yet — SAVE_TO_CRM resolves it
        try {
            Map<String, Object> request = support.baseRequest(session, context);
            request.put("responseId", responseId);
            request.put("overwrite", CrmLeadNodeSupport.RESULT_NEW.equals(
                    CrmLeadNodeSupport.str(sessionCtx, CrmLeadNodeSupport.KEY_RESULT)));
            request.put("complete", false);
            if (field.isSystem()) {
                request.put("full_name".equals(field.key()) ? "fullName" : "email", value);
            } else {
                request.put("fieldValues", Map.of(field.key(), value));
            }
            leadClient.save(request);
        } catch (Exception e) {
            log.warn("ASK_FIELD: saving '{}' on lead {} failed (SAVE_TO_CRM will retry): {}",
                    field.name(), responseId, e.getMessage());
        }
    }

    Answer resolve(FieldSpec field, FlowExecutionContext context) {
        String text = context.getMessageText() == null ? "" : context.getMessageText().trim();
        String replyId = firstNonBlank(context.getButtonId(), context.getListReplyId(), context.getButtonPayload());

        if (field.allowSkip() && (SKIP_ID.equals(replyId) || "skip".equalsIgnoreCase(text))) {
            return Answer.skip();
        }

        List<Option> options = field.options();
        if (!options.isEmpty()) {
            if (field.isMultiSelect()) return resolveMulti(options, text);
            Option chosen = optionById(options, replyId);
            if (chosen == null) chosen = optionByText(options, text);
            return chosen == null ? Answer.invalid() : Answer.of(chosen.value());
        }

        if (text.isEmpty()) return Answer.invalid();
        switch (field.type()) {
            case "email":
                return EMAIL.matcher(text).matches() ? Answer.of(text) : Answer.invalid();
            case "number": {
                String cleaned = text.replace(",", "").replace(" ", "");
                try {
                    new BigDecimal(cleaned);
                    return Answer.of(cleaned);
                } catch (NumberFormatException e) {
                    return Answer.invalid();
                }
            }
            case "phone": {
                int digits = text.replaceAll("[^0-9]", "").length();
                boolean onlyPhoneChars = text.matches("[0-9+()\\-\\s]+");
                return onlyPhoneChars && digits >= 7 && digits <= 15 ? Answer.of(text) : Answer.invalid();
            }
            case "url":
                return !text.contains(" ") && text.contains(".") ? Answer.of(text) : Answer.invalid();
            case "date": {
                String iso = parseDate(text);
                return iso == null ? Answer.invalid() : Answer.of(iso);
            }
            default:
                return Answer.of(truncate(text, MAX_TEXT_ANSWER));
        }
    }

    /** Multi-select answers are stored the way the CRM stores them: a JSON array of option values. */
    private Answer resolveMulti(List<Option> options, String text) {
        if (text.isEmpty()) return Answer.invalid();
        String[] tokens = text.split("[,;\\n]+");
        if (tokens.length == 1 && tokens[0].trim().matches("\\d+(\\s+\\d+)+")) {
            tokens = tokens[0].trim().split("\\s+");
        }
        List<String> values = new ArrayList<>();
        for (String token : tokens) {
            String t = token.trim();
            if (t.isEmpty()) continue;
            Option o = optionByText(options, t);
            if (o == null) return Answer.invalid();
            if (!values.contains(o.value())) values.add(o.value());
        }
        if (values.isEmpty()) return Answer.invalid();
        try {
            return Answer.of(objectMapper.writeValueAsString(values));
        } catch (Exception e) {
            return Answer.invalid();
        }
    }

    private static Option optionById(List<Option> options, String replyId) {
        if (replyId == null || !replyId.startsWith(OPTION_ID_PREFIX)) return null;
        try {
            int index = Integer.parseInt(replyId.substring(OPTION_ID_PREFIX.length()));
            return index >= 0 && index < options.size() ? options.get(index) : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Match a typed/tapped reply to an option: its number, label, value, or the truncated title we sent. */
    private static Option optionByText(List<Option> options, String text) {
        if (text == null || text.isBlank()) return null;
        String t = text.trim();
        if (t.matches("\\d+")) {
            int n = Integer.parseInt(t);
            if (n >= 1 && n <= options.size()) return options.get(n - 1);
        }
        for (Option o : options) {
            if (o.label().equalsIgnoreCase(t) || o.value().equalsIgnoreCase(t)
                    || truncate(o.label(), BUTTON_TITLE_MAX).equalsIgnoreCase(t)
                    || truncate(o.label(), ROW_TITLE_MAX).equalsIgnoreCase(t)) {
                return o;
            }
        }
        return null;
    }

    private static String parseDate(String text) {
        for (DateTimeFormatter format : DATE_FORMATS) {
            try {
                return LocalDate.parse(text, format).toString();
            } catch (Exception ignored) {
                // try the next format
            }
        }
        return null;
    }

    // ==================== Helpers ====================

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    private static int toInt(Object value) {
        if (value instanceof Number) return ((Number) value).intValue();
        try {
            return value == null ? 0 : Integer.parseInt(value.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    static String truncate(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }

    record Option(String value, String label) {}

    record Answer(boolean accepted, boolean skipped, String value) {
        static Answer of(String value) { return new Answer(true, false, value); }
        static Answer skip() { return new Answer(true, true, null); }
        static Answer invalid() { return new Answer(false, false, null); }
    }

    /** The node's config, normalised. */
    record FieldSpec(String source, String customFieldId, String systemField, String name, String type,
                     List<Option> options, String question, String retryMessage, int maxRetries,
                     boolean allowSkip, String listButtonText) {

        static FieldSpec from(Map<String, Object> config) {
            String source = CrmLeadNodeSupport.str(config, "fieldSource");
            String systemField = CrmLeadNodeSupport.str(config, "systemField");
            boolean system = "SYSTEM_FIELD".equals(source);
            String name = orDefault(CrmLeadNodeSupport.str(config, "fieldName"),
                    system && "email".equals(systemField) ? "email" : system ? "name" : "answer");
            String type;
            if (system) {
                type = "email".equals(systemField) ? "email" : "text";
            } else {
                type = orDefault(CrmLeadNodeSupport.str(config, "fieldType"), "text").toLowerCase(Locale.ROOT);
            }
            List<Option> options = parseOptions(config.get("options"));
            if (options.isEmpty() && "checkbox".equals(type)) {
                // Stored the way the lead form stores a checkbox ("true" / "false"), shown as Yes / No.
                options = List.of(new Option("true", "Yes"), new Option("false", "No"));
            }
            Object retries = config.get("maxRetries");
            int maxRetries = retries instanceof Number ? Math.max(0, ((Number) retries).intValue()) : DEFAULT_MAX_RETRIES;
            return new FieldSpec(
                    source,
                    CrmLeadNodeSupport.str(config, "customFieldId"),
                    systemField,
                    name,
                    type,
                    options,
                    orDefault(CrmLeadNodeSupport.str(config, "question"), "Please share your " + name + "."),
                    orDefault(CrmLeadNodeSupport.str(config, "retryMessage"), DEFAULT_RETRY),
                    maxRetries,
                    Boolean.TRUE.equals(config.get("allowSkip")),
                    orDefault(CrmLeadNodeSupport.str(config, "listButtonText"), "Choose"));
        }

        boolean isSystem() {
            return "SYSTEM_FIELD".equals(source);
        }

        boolean isMultiSelect() {
            return "multi_select".equals(type);
        }

        boolean isConfigured() {
            return isSystem()
                    ? "full_name".equals(systemField) || "email".equals(systemField)
                    : customFieldId != null && !customFieldId.isBlank();
        }

        /** custom_field_id, or "full_name" / "email" for system fields. */
        String key() {
            return isSystem() ? systemField : customFieldId;
        }

        @SuppressWarnings("unchecked")
        private static List<Option> parseOptions(Object raw) {
            List<Option> options = new ArrayList<>();
            if (!(raw instanceof List)) return options;
            for (Object item : (List<Object>) raw) {
                if (item instanceof Map) {
                    Map<String, Object> m = (Map<String, Object>) item;
                    String value = m.get("value") != null ? m.get("value").toString() : null;
                    String label = m.get("label") != null ? m.get("label").toString() : value;
                    if (value == null) value = label;
                    if (value != null && !value.isBlank()) options.add(new Option(value.trim(), label.trim()));
                } else if (item != null && !item.toString().isBlank()) {
                    options.add(new Option(item.toString().trim(), item.toString().trim()));
                }
            }
            return options;
        }

        private static String orDefault(String value, String fallback) {
            return value == null || value.isBlank() ? fallback : value;
        }
    }
}
