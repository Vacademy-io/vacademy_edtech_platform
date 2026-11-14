package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import vacademy.io.notification_service.features.chatbot_flow.entity.WhatsAppTemplate;
import vacademy.io.notification_service.features.chatbot_flow.exception.WhatsAppTemplateException;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * An admin picked "Authentication" for a registration-confirmation template because it carried
 * login credentials. Meta reserves that category for OTP messages whose body it writes itself, so
 * the submit died with "component of type BODY has unexpected field(s) (text)" — a message that
 * says nothing about the category. Both layers now name the real problem.
 */
class WhatsAppTemplateAuthCategoryTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final WhatsAppTemplateValidator validator = new WhatsAppTemplateValidator(objectMapper);
    private final WhatsAppProviderErrorTranslator translator = new WhatsAppProviderErrorTranslator(objectMapper);

    private static WhatsAppTemplate template(String category) {
        return WhatsAppTemplate.builder()
                .instituteId("inst-1")
                .name("unlockx_registration_login_details")
                .language("en")
                .category(category)
                .headerType("NONE")
                .bodyText("Hi {{1}}, your registration is confirmed. Username: {{2}} Password: {{3}} — see you soon.")
                .bodySampleValues("[\"Deepankar Dey\",\"deep@example.com\",\"IOwECtWx\"]")
                .build();
    }

    @Test
    @DisplayName("validator: AUTHENTICATION with custom body text is refused before the Meta round trip")
    void validatorRejectsAuthenticationCategory() {
        assertThatThrownBy(() -> validator.validateForSubmit(template("AUTHENTICATION")))
                .isInstanceOf(WhatsAppTemplateException.class)
                .satisfies(e -> {
                    WhatsAppTemplateException ex = (WhatsAppTemplateException) e;
                    assertThat(ex.getField()).isEqualTo("category");
                    assertThat(ex.getMessage()).contains("Authentication").contains("Utility");
                });
    }

    @Test
    @DisplayName("validator: the same template passes as UTILITY")
    void validatorAcceptsUtilityCategory() {
        assertThatCode(() -> validator.validateForSubmit(template("UTILITY"))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("translator: Meta's 'BODY has unexpected field(s) (text)' maps to the category, not a generic 400")
    void translatorNamesTheCategoryProblem() {
        String metaBody = "{\"error\":{\"message\":\"Message template \\\"components\\\" param contains unexpected "
                + "field(s): component of type BODY has unexpected field(s) (text)\",\"type\":\"OAuthException\","
                + "\"code\":100,\"error_user_title\":\"Invalid parameter\",\"error_user_msg\":\"Invalid parameter\","
                + "\"fbtrace_id\":\"AbC123\"}}";
        HttpClientErrorException http = HttpClientErrorException.create(
                HttpStatus.BAD_REQUEST, "Bad Request", null, metaBody.getBytes(StandardCharsets.UTF_8), null);

        WhatsAppTemplateException ex = translator.translate("Meta", "submit template 'x'", http);

        assertThat(ex.getCode()).isEqualTo("META_AUTH_CATEGORY_HAS_BODY_TEXT");
        assertThat(ex.getField()).isEqualTo("category");
        assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getHint()).contains("Utility");
        assertThat(ex.getProviderCode()).isEqualTo("100");
        assertThat(ex.getProviderTraceId()).isEqualTo("AbC123");
    }

    @Test
    @DisplayName("translator: an unrelated code-100 rejection still gets the generic invalid-template mapping")
    void translatorLeavesOtherInvalidParameterErrorsAlone() {
        String metaBody = "{\"error\":{\"message\":\"(#100) Invalid parameter\",\"code\":100,"
                + "\"error_user_msg\":\"Body text ends with a variable\"}}";
        HttpClientErrorException http = HttpClientErrorException.create(
                HttpStatus.BAD_REQUEST, "Bad Request", null, metaBody.getBytes(StandardCharsets.UTF_8), null);

        WhatsAppTemplateException ex = translator.translate("Meta", "submit template 'x'", http);

        assertThat(ex.getCode()).isEqualTo("META_INVALID_TEMPLATE");
        assertThat(ex.getField()).isNull();
    }
}
