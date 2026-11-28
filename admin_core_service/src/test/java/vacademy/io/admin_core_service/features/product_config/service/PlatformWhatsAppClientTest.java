package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import vacademy.io.admin_core_service.features.product_config.dto.AlertTemplateDTO;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

class PlatformWhatsAppClientTest {

    private PlatformWhatsAppClient client;
    private MockRestServiceServer meta;

    @BeforeEach
    void setUp() {
        client = new PlatformWhatsAppClient("https://meta.test/v22.0", "tok-secret", "PHONE1");
        meta = MockRestServiceServer.createServer(client.restTemplate());
    }

    @Test
    void aTemplateIsSentFromThePlatformNumber() {
        meta.expect(requestTo("https://meta.test/v22.0/PHONE1/messages"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer tok-secret"))
                .andExpect(jsonPath("$.to").value("919000000001"))
                .andExpect(jsonPath("$.template.name").value("product_signup_alert"))
                .andExpect(jsonPath("$.template.language.code").value("en"))
                .andExpect(jsonPath("$.template.components[0].parameters[1].text").value("Asha"))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        assertNull(client.sendTemplate("919000000001", "product_signup_alert", "en", List.of("Evalezy", "Asha")));
        meta.verify();
    }

    @Test
    void metaSentenceComesBackAndTheTokenNever() {
        meta.expect(requestTo("https://meta.test/v22.0/PHONE1/messages"))
                .andRespond(withBadRequest().contentType(MediaType.APPLICATION_JSON)
                        .body("{\"error\":{\"message\":\"Template name does not exist\"}}"));
        String error = client.sendTemplate("919000000001", "x", "en", List.of("a"));
        assertEquals("Template name does not exist", error);
        assertFalse(error.contains("tok-secret"));
    }

    @Test
    void noCredentialsIsAnAnswerNotACrash() {
        PlatformWhatsAppClient none = new PlatformWhatsAppClient("https://meta.test", "", "");
        assertFalse(none.isConfigured());
        assertNotNull(none.sendTemplate("919000000001", "x", "en", List.of("a")));
    }

    @Test
    void theDeployPlaceholderCountsAsNoCredentials() {
        PlatformWhatsAppClient none = new PlatformWhatsAppClient("https://meta.test", "not-configured", "not-configured");
        assertFalse(none.isConfigured());
        assertEquals("The platform WhatsApp account is not configured on this server",
                none.sendTemplate("919000000001", "x", "en", List.of("a")));
        assertThrows(IllegalStateException.class, () -> none.findTemplate("WABA", "t1", "en"));
    }

    @Test
    void findsTheTemplateAndItsStatus() {
        meta.expect(requestTo(org.hamcrest.Matchers.startsWith("https://meta.test/v22.0/WABA/message_templates?name=t1")))
                .andRespond(withSuccess("{\"data\":[{\"name\":\"t1\",\"language\":\"en\",\"status\":\"APPROVED\","
                        + "\"category\":\"UTILITY\",\"components\":[{\"type\":\"BODY\",\"text\":\"Hi {{1}}\"}]}]}",
                        MediaType.APPLICATION_JSON));
        AlertTemplateDTO found = client.findTemplate("WABA", "t1", "en");
        assertEquals("APPROVED", found.getStatus());
        assertEquals("Hi {{1}}", found.getBody());
    }

    @Test
    void aMissingTemplateReadsAsNotRegistered() {
        meta.expect(requestTo(org.hamcrest.Matchers.startsWith("https://meta.test/v22.0/WABA/message_templates")))
                .andRespond(withSuccess("{\"data\":[]}", MediaType.APPLICATION_JSON));
        assertEquals("NOT_REGISTERED", client.findTemplate("WABA", "t1", "en").getStatus());
    }

    @Test
    void creatingSendsAUtilityTemplateWithSamples() {
        meta.expect(requestTo("https://meta.test/v22.0/WABA/message_templates"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.category").value("UTILITY"))
                .andExpect(jsonPath("$.components[0].example.body_text[0][0]").value("Evalezy"))
                .andRespond(withSuccess("{\"id\":\"1\"}", MediaType.APPLICATION_JSON));
        client.createTemplate("WABA", "t1", "en", "Hi {{1}}", List.of("Evalezy"));
        meta.verify();
    }
}
