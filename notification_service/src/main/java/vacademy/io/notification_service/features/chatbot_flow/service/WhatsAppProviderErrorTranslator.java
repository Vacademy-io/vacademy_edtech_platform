package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import vacademy.io.notification_service.features.chatbot_flow.exception.WhatsAppTemplateException;

/**
 * Turns a raw provider failure into a {@link WhatsAppTemplateException} an admin can act on.
 *
 * <p>Meta answers a failed template registration with HTTP 400 and a body like:
 * <pre>
 * {"error":{"message":"(#100) Invalid parameter","type":"OAuthException","code":100,
 *           "error_subcode":2388043,"error_user_title":"Template Name Already Exists",
 *           "error_user_msg":"…","fbtrace_id":"Axb…"}}
 * </pre>
 * Spring's {@code RestTemplate} throws {@code HttpClientErrorException} for that, whose
 * {@code getMessage()} is a wall of escaped JSON. Everything useful — {@code error_user_msg},
 * the subcode, the trace id — is in the body, so we parse it and hand the admin the sentence Meta
 * actually wrote instead of "Meta API returned: 400 BAD_REQUEST".
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class WhatsAppProviderErrorTranslator {

    private final ObjectMapper objectMapper;

    /**
     * @param operation what was being attempted, e.g. "submit template to Meta" — used when the
     *                  provider gives us nothing intelligible to quote.
     */
    public WhatsAppTemplateException translate(String provider, String operation, RestClientException e) {
        if (e instanceof HttpStatusCodeException httpError) {
            return fromHttpError(provider, operation, httpError);
        }
        if (e instanceof ResourceAccessException) {
            // DNS failure, connect/read timeout — the request may or may not have landed.
            return WhatsAppTemplateException
                    .builder(HttpStatus.GATEWAY_TIMEOUT, "PROVIDER_UNREACHABLE",
                            "Could not reach " + provider + " while trying to " + operation + ".")
                    .hint("This is a network problem, not a problem with your template. "
                            + "Wait a moment and try again — then use \"Sync Templates\" to check whether it went through.")
                    .cause(e)
                    .build();
        }
        return WhatsAppTemplateException
                .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_CALL_FAILED",
                        "Call to " + provider + " failed while trying to " + operation + ": " + e.getMessage())
                .cause(e)
                .build();
    }

    private WhatsAppTemplateException fromHttpError(String provider, String operation, HttpStatusCodeException e) {
        String body = e.getResponseBodyAsString();
        HttpStatusCode upstreamStatus = e.getStatusCode();
        log.error("{} rejected '{}': status={}, body={}", provider, operation, upstreamStatus, body);

        JsonNode error = parseErrorNode(body);
        if (error == null) {
            // Non-JSON body (HTML error page, empty 502 from a proxy, …).
            return WhatsAppTemplateException
                    .builder(statusFor(upstreamStatus), "PROVIDER_CALL_FAILED",
                            provider + " rejected the request to " + operation
                                    + " (HTTP " + upstreamStatus.value() + ")"
                                    + (body == null || body.isBlank() ? "." : ": " + truncate(body)))
                    .cause(e)
                    .build();
        }

        String userTitle = text(error, "error_user_title");
        String userMsg = text(error, "error_user_msg");
        String rawMessage = text(error, "message");
        String code = text(error, "code");
        String subcode = text(error, "error_subcode");
        String traceId = text(error, "fbtrace_id");

        // Meta writes error_user_msg for the human; error.message is the developer-facing string.
        // Prefer the human copy, but never lose the developer one entirely.
        String message = compose(userTitle, userMsg, rawMessage, provider, operation, upstreamStatus);

        Mapped mapped = classify(code, subcode, rawMessage, userMsg);

        return WhatsAppTemplateException
                .builder(mapped.status, mapped.code, message)
                .field(mapped.field)
                .hint(mapped.hint)
                .providerCode(code)
                .providerSubcode(subcode)
                .providerTraceId(traceId)
                .cause(e)
                .build();
    }

    /** Handles both Meta's {@code {"error":{…}}} and WATI's flatter failure bodies. */
    private JsonNode parseErrorNode(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode root = objectMapper.readTree(body);
            JsonNode error = root.path("error");
            if (error.isObject()) return error;
            // WATI: {"result":"failure","info":"…"} — normalise into the same shape.
            String info = root.path("info").asText(root.path("message").asText(null));
            if (info != null && !info.isBlank()) {
                return objectMapper.createObjectNode().put("message", info);
            }
            return root.isObject() ? root : null;
        } catch (Exception parseFailure) {
            return null;
        }
    }

    private String compose(String userTitle, String userMsg, String rawMessage,
                           String provider, String operation, HttpStatusCode status) {
        StringBuilder sb = new StringBuilder();
        if (notBlank(userTitle)) sb.append(userTitle.trim());
        if (notBlank(userMsg)) {
            if (sb.length() > 0) sb.append(": ");
            sb.append(userMsg.trim());
        }
        if (sb.length() == 0 && notBlank(rawMessage)) {
            sb.append(rawMessage.trim());
        }
        if (sb.length() == 0) {
            sb.append(provider).append(" rejected the request to ").append(operation)
                    .append(" (HTTP ").append(status.value()).append(").");
        } else if (notBlank(rawMessage) && notBlank(userMsg)
                && !rawMessage.trim().equalsIgnoreCase(userMsg.trim())) {
            // Keep the developer-facing string too — it's what carries "(#100) Invalid parameter".
            sb.append(" [").append(rawMessage.trim()).append("]");
        }
        return sb.toString();
    }

    /**
     * Map the provider's code onto something the UI can react to. Only codes whose meaning is
     * unambiguous get a bespoke hint; everything else stays a generic upstream rejection so we never
     * invent a wrong explanation for a real failure.
     */
    private Mapped classify(String code, String subcode, String rawMessage, String userMsg) {
        String haystack = ((rawMessage == null ? "" : rawMessage) + " "
                + (userMsg == null ? "" : userMsg)).toLowerCase();

        // Duplicate name is by far the most common registration failure and Meta signals it in text.
        if (haystack.contains("already exists") || haystack.contains("name_exists")) {
            return new Mapped(HttpStatus.CONFLICT, "TEMPLATE_NAME_EXISTS", "name",
                    "A template with this name and language already exists on WhatsApp. "
                            + "Rename it, or click \"Sync Templates\" to pull the existing one in.");
        }

        if ("190".equals(code)) {
            return new Mapped(HttpStatus.FAILED_DEPENDENCY, "META_TOKEN_INVALID", null,
                    "The Meta access token for this institute is expired or invalid. "
                            + "Update it in Settings → WhatsApp, then submit again.");
        }
        if ("200".equals(code) || "10".equals(code) || "3".equals(code)) {
            return new Mapped(HttpStatus.FAILED_DEPENDENCY, "META_PERMISSION_DENIED", null,
                    "The Meta access token is missing the whatsapp_business_management permission "
                            + "for this WABA. Regenerate it with that scope in Settings → WhatsApp.");
        }
        if ("33".equals(code)) {
            return new Mapped(HttpStatus.FAILED_DEPENDENCY, "META_WABA_NOT_FOUND", null,
                    "Meta could not find the configured WhatsApp Business Account. "
                            + "Check the WABA id in Settings → WhatsApp.");
        }
        if ("4".equals(code) || "613".equals(code) || "80007".equals(code) || "130429".equals(code)) {
            return new Mapped(HttpStatus.TOO_MANY_REQUESTS, "META_RATE_LIMITED", null,
                    "Meta is rate-limiting template requests for this account. Wait a few minutes and retry.");
        }
        if ("368".equals(code)) {
            return new Mapped(HttpStatus.FAILED_DEPENDENCY, "META_ACCOUNT_RESTRICTED", null,
                    "Meta has temporarily restricted this WhatsApp Business Account for policy reasons. "
                            + "Check the WhatsApp Manager account quality page.");
        }
        if ("2388273".equals(subcode)) {
            return new Mapped(HttpStatus.BAD_REQUEST, "META_HEADER_HANDLE_REQUIRED", "headerSampleUrl",
                    "Meta would not accept the sample media. Re-upload the sample file and try again.");
        }
        // "component of type BODY has unexpected field(s) (text)" is Meta's way of saying the
        // category is AUTHENTICATION: those templates get a fixed Meta-written OTP body, so any
        // body text at all is refused. The validator catches this pre-flight; this is the safety
        // net for a template that reached Meta another way (synced, or an older client).
        if (haystack.contains("type body") && haystack.contains("unexpected field")
                && haystack.contains("text")) {
            return new Mapped(HttpStatus.BAD_REQUEST, "META_AUTH_CATEGORY_HAS_BODY_TEXT", "category",
                    "Meta refuses custom body text on Authentication templates — that category is only for "
                            + "one-time-password messages whose wording Meta writes. "
                            + "Change the category to Utility (or Marketing) and submit again.");
        }
        if ("100".equals(code)) {
            // Meta's catch-all for a malformed template — the composed message carries the specifics.
            return new Mapped(HttpStatus.BAD_REQUEST, "META_INVALID_TEMPLATE", null,
                    "Meta rejected the template content. Fix the highlighted issue above and re-submit.");
        }

        return new Mapped(HttpStatus.BAD_GATEWAY, "PROVIDER_REJECTED", null, null);
    }

    /** Never surface a 5xx from Meta as a 5xx of ours if it was really our payload that was wrong. */
    private HttpStatus statusFor(HttpStatusCode upstream) {
        return upstream.is4xxClientError() ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String s = value.asText(null);
        return notBlank(s) ? s : null;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String truncate(String s) {
        String flat = s.replaceAll("\\s+", " ").trim();
        return flat.length() > 300 ? flat.substring(0, 300) + "…" : flat;
    }

    private record Mapped(HttpStatus status, String code, String field, String hint) {}
}
