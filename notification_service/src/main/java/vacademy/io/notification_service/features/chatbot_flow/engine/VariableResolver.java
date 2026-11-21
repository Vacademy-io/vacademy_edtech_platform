package vacademy.io.notification_service.features.chatbot_flow.engine;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.service.EnrollmentCredentialsClient;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared resolver for {{placeholder}} tokens in SEND_MESSAGE and SEND_TEMPLATE
 * node configs.
 *
 * Resolution precedence:
 *   1. Node-config `variables` array — explicit typed mapping with fallback default.
 *      Each entry: { name, source, field, defaultValue }
 *      Sources: SYSTEM_FIELD, CUSTOM_FIELD, SESSION, CONTEXT, FIXED,
 *               ENROLLMENT_CREDENTIALS (login-details text from admin_core)
 *   2. Built-in placeholders (backwards compatible):
 *        {{fixed:literal}}         -> literal
 *        {{session.key}}           -> sessionVariables[key]
 *        {{user.key}}              -> userDetails.user[key] (snake_case or camelCase)
 *        {{customField.name}}      -> userDetails.customFields[name]
 *        {{phone}} / {{phoneNumber}}, {{instituteId}}, {{userId}}, {{messageText}}
 *        (unqualified names)       -> sessionVariables[name]
 */
@Component
@RequiredArgsConstructor
public class VariableResolver {

    private final EnrollmentCredentialsClient enrollmentCredentialsClient;

    private static final Pattern VARIABLE_PATTERN = Pattern.compile("\\{\\{(.+?)}}");

    /**
     * Resolve all {{placeholder}} tokens in the template.
     *
     * @param template       raw string (may contain 0+ placeholders)
     * @param variableConfig the node config's "variables" list (may be null)
     * @param context        flow execution context
     */
    public String resolve(String template, List<Map<String, Object>> variableConfig,
                          FlowExecutionContext context) {
        if (template == null || template.isEmpty()) return template;
        Matcher m = VARIABLE_PATTERN.matcher(template);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String name = m.group(1).trim();
            String value = resolveOne(name, variableConfig, context);
            m.appendReplacement(out, Matcher.quoteReplacement(value == null ? "" : value));
        }
        m.appendTail(out);
        return out.toString();
    }

    private String resolveOne(String name, List<Map<String, Object>> variableConfig,
                              FlowExecutionContext ctx) {
        // 1) Node-config explicit mapping
        if (variableConfig != null) {
            for (Map<String, Object> var : variableConfig) {
                if (var == null) continue;
                Object nameObj = var.get("name");
                if (nameObj != null && name.equals(nameObj.toString())) {
                    String resolved = resolveFromSource(var, ctx);
                    String defaultVal = var.get("defaultValue") != null
                            ? var.get("defaultValue").toString() : "";
                    return (resolved == null || resolved.isBlank()) ? defaultVal : resolved;
                }
            }
        }
        // 2) Built-in fallback
        return resolveBuiltin(name, ctx);
    }

    @SuppressWarnings("unchecked")
    private String resolveFromSource(Map<String, Object> var, FlowExecutionContext ctx) {
        String source = var.get("source") != null ? var.get("source").toString() : "SYSTEM_FIELD";

        // Checked before the `field` guard below: this source takes no field, it is keyed
        // purely on the caller's phone number.
        //
        // Credentials cannot travel in a WhatsApp template body — Meta classifies any such
        // body as AUTHENTICATION, which is fixed-format, so the template hard-rejects with
        // INCORRECT_CATEGORY in every category. They are fetched here instead and emitted
        // as a free-text session message. admin_core returns the fully composed text; null
        // means "no in-scope enrollment for this number", and SEND_MESSAGE refuses a blank
        // body, so an unknown number yields no message rather than a half-filled one.
        if ("ENROLLMENT_CREDENTIALS".equals(source)) {
            return enrollmentCredentialsClient.fetchCredentialsText(ctx.getPhoneNumber());
        }

        Object fieldObj = var.get("field");
        String field = fieldObj != null ? fieldObj.toString() : null;
        if (field == null || field.isBlank()) return null;

        Map<String, Object> details = ctx.getUserDetails();
        switch (source) {
            case "SYSTEM_FIELD": {
                if (details == null) return null;
                Object u = details.get("user");
                if (!(u instanceof Map)) return null;
                Map<String, Object> user = (Map<String, Object>) u;
                // Try snake_case then camelCase for convenience
                Object val = user.get(field);
                if (val == null) val = user.get(toSnakeCase(field));
                if (val == null) val = user.get(toCamelCase(field));
                return val != null ? val.toString() : null;
            }
            case "CUSTOM_FIELD": {
                if (details == null) return null;
                Object cf = details.get("customFields");
                if (!(cf instanceof Map)) return null;
                Object val = ((Map<String, Object>) cf).get(field);
                return val != null ? val.toString() : null;
            }
            case "SESSION": {
                if (ctx.getSessionVariables() == null) return null;
                Object val = ctx.getSessionVariables().get(field);
                return val != null ? val.toString() : null;
            }
            case "CONTEXT":
                return resolveBuiltin(field, ctx);
            case "FIXED":
                return field;
            default:
                return null;
        }
    }

    @SuppressWarnings("unchecked")
    private String resolveBuiltin(String name, FlowExecutionContext ctx) {
        if (name.startsWith("fixed:")) return name.substring(6);

        if (name.startsWith("session.") && ctx.getSessionVariables() != null) {
            Object val = ctx.getSessionVariables().get(name.substring(8));
            return val != null ? val.toString() : "";
        }

        if (name.startsWith("user.") && ctx.getUserDetails() != null) {
            String key = name.substring(5);
            Object u = ctx.getUserDetails().get("user");
            if (u instanceof Map) {
                Map<String, Object> user = (Map<String, Object>) u;
                Object val = user.get(key);
                if (val == null) val = user.get(toSnakeCase(key));
                if (val == null) val = user.get(toCamelCase(key));
                if (val != null) return val.toString();
            }
            return "";
        }

        if (name.startsWith("customField.") && ctx.getUserDetails() != null) {
            Object cf = ctx.getUserDetails().get("customFields");
            if (cf instanceof Map) {
                Object val = ((Map<String, Object>) cf).get(name.substring(12));
                if (val != null) return val.toString();
            }
            return "";
        }

        switch (name) {
            case "phone":
            case "phoneNumber":
                return ctx.getPhoneNumber() != null ? ctx.getPhoneNumber() : "";
            case "instituteId":
                return ctx.getInstituteId() != null ? ctx.getInstituteId() : "";
            case "userId":
                return ctx.getUserId() != null ? ctx.getUserId() : "";
            case "messageText":
                return ctx.getMessageText() != null ? ctx.getMessageText() : "";
            default:
                if (ctx.getSessionVariables() != null) {
                    Object val = ctx.getSessionVariables().get(name);
                    if (val != null) return val.toString();
                }
                return "";
        }
    }

    private static String toSnakeCase(String camel) {
        if (camel == null || camel.isEmpty()) return camel;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < camel.length(); i++) {
            char c = camel.charAt(i);
            if (Character.isUpperCase(c)) {
                if (i > 0) sb.append('_');
                sb.append(Character.toLowerCase(c));
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static String toCamelCase(String snake) {
        if (snake == null || !snake.contains("_")) return snake;
        StringBuilder sb = new StringBuilder();
        boolean upper = false;
        for (int i = 0; i < snake.length(); i++) {
            char c = snake.charAt(i);
            if (c == '_') {
                upper = true;
            } else if (upper) {
                sb.append(Character.toUpperCase(c));
                upper = false;
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
