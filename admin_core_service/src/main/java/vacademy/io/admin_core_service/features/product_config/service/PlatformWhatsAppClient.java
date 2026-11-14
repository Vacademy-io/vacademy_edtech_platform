package vacademy.io.admin_core_service.features.product_config.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import vacademy.io.admin_core_service.features.product_config.dto.AlertTemplateDTO;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Meta calls on the platform's own WhatsApp account (Vidyayatan), for messages to our team. No
 * institute's account is involved. Lives here and not in notification_service so it sits behind
 * the super-admin check and the internal HMAC check, not on a shared send path.
 */
@Slf4j
@Component
public class PlatformWhatsAppClient {

    /** What the shared deploy secret holds when it has no value; Meta would answer it with a 401. */
    private static final String PLACEHOLDER = "not-configured";

    private final String baseUrl;
    private final String accessToken;
    private final String phoneNumberId;
    private final RestTemplate rest;
    private final ObjectMapper mapper = new ObjectMapper();

    public PlatformWhatsAppClient(
            @Value("${meta.whatsapp.api.base.url:https://graph.facebook.com/v22.0}") String baseUrl,
            @Value("${WHATSAPP_ACCESS_TOKEN_VIDYAYATAN:}") String accessToken,
            @Value("${WHATSAPP_PHONE_NUMBER_ID_VIDYAYATAN:}") String phoneNumberId) {
        this.baseUrl = baseUrl;
        this.accessToken = withoutPlaceholder(accessToken);
        this.phoneNumberId = withoutPlaceholder(phoneNumberId);
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(15_000);
        this.rest = new RestTemplate(factory);
    }

    private static String withoutPlaceholder(String value) {
        return value == null || PLACEHOLDER.equalsIgnoreCase(value.trim()) ? "" : value;
    }

    RestTemplate restTemplate() {
        return rest;
    }

    public boolean isConfigured() {
        return StringUtils.hasText(accessToken) && StringUtils.hasText(phoneNumberId);
    }

    /** @return null when Meta accepted it, else why not */
    public String sendTemplate(String to, String template, String language, List<String> variables) {
        if (!isConfigured()) {
            return "The platform WhatsApp account is not configured on this server";
        }
        List<Map<String, String>> parameters = new ArrayList<>();
        for (String variable : variables) {
            parameters.add(Map.of("type", "text", "text", variable));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("messaging_product", "whatsapp");
        body.put("to", to);
        body.put("type", "template");
        body.put("template", Map.of(
                "name", template,
                "language", Map.of("code", language),
                "components", List.of(Map.of("type", "body", "parameters", parameters))));
        try {
            rest.exchange(baseUrl + "/" + phoneNumberId + "/messages", HttpMethod.POST,
                    new HttpEntity<>(body, headers()), String.class);
            return null;
        } catch (HttpStatusCodeException e) {
            return metaError(e);
        } catch (RestClientException e) {
            return "WhatsApp could not be reached";
        }
    }

    /** The template as Meta holds it, or a NOT_REGISTERED one. */
    public AlertTemplateDTO findTemplate(String wabaId, String name, String language) {
        String url = UriComponentsBuilder.fromHttpUrl(baseUrl + "/" + wabaId + "/message_templates")
                .queryParam("name", name)
                .queryParam("fields", "name,status,category,language,rejected_reason,components")
                .toUriString();
        JsonNode rows = call(url, HttpMethod.GET, null).path("data");
        for (JsonNode row : rows) {
            if (name.equals(row.path("name").asText()) && language.equals(row.path("language").asText())) {
                return AlertTemplateDTO.builder()
                        .name(name)
                        .language(language)
                        .status(row.path("status").asText())
                        .category(row.path("category").asText())
                        .rejectedReason(row.path("rejected_reason").asText(null))
                        .body(bodyOf(row))
                        .build();
            }
        }
        return AlertTemplateDTO.builder().name(name).language(language).status("NOT_REGISTERED").build();
    }

    /** Sends a UTILITY template with one body for review. */
    public void createTemplate(String wabaId, String name, String language, String body, List<String> samples) {
        Map<String, Object> component = new LinkedHashMap<>();
        component.put("type", "BODY");
        component.put("text", body);
        component.put("example", Map.of("body_text", List.of(samples)));
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("name", name);
        request.put("language", language);
        request.put("category", "UTILITY");
        request.put("components", List.of(component));
        call(baseUrl + "/" + wabaId + "/message_templates", HttpMethod.POST, request);
    }

    private JsonNode call(String url, HttpMethod method, Object body) {
        if (!StringUtils.hasText(accessToken)) {
            throw new IllegalStateException("The platform WhatsApp account is not configured on this server");
        }
        try {
            String response = rest.exchange(url, method, new HttpEntity<>(body, headers()), String.class).getBody();
            return mapper.readTree(response == null ? "{}" : response);
        } catch (HttpStatusCodeException e) {
            throw new IllegalStateException(metaError(e));
        } catch (RestClientException | com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("WhatsApp could not be reached");
        }
    }

    private static String bodyOf(JsonNode template) {
        for (JsonNode component : template.path("components")) {
            if ("BODY".equals(component.path("type").asText())) {
                return component.path("text").asText(null);
            }
        }
        return null;
    }

    private HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    /** Meta's sentence for a person to read. The request and its token are never included. */
    private String metaError(HttpStatusCodeException e) {
        try {
            JsonNode error = mapper.readTree(e.getResponseBodyAsString()).path("error");
            String text = error.path("error_user_msg").asText(error.path("message").asText(""));
            if (StringUtils.hasText(text)) {
                return text;
            }
        } catch (Exception ignored) {
            // falls through to the status
        }
        return "WhatsApp refused the request (" + e.getStatusCode().value() + ")";
    }
}
