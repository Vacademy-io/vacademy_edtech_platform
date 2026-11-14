package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;

import java.util.List;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnnouncementApiTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    private static CustomUserDetails principal(String userId, String role) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(role));
        return new CustomUserDetails(dto);
    }

    private CreateAnnouncementRequest sampleRequest() {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("Test Announcement");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("Hello world");
        req.setContent(content);
        req.setInstituteId("INST_TEST");
        req.setCreatedBy("USER_TEST");
        req.setCreatedByRole("ADMIN");
        req.setTimezone("UTC");

        // Example: ROLE recipient type (requires recipientId)
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        
        // Note: For CUSTOM_FIELD_FILTER type, use this pattern instead:
        // var customFieldRecipient = new CreateAnnouncementRequest.RecipientRequest();
        // customFieldRecipient.setRecipientType("CUSTOM_FIELD_FILTER");
        // var filter = new CreateAnnouncementRequest.RecipientRequest.CustomFieldFilter();
        // filter.setCustomFieldId("field-id");
        // filter.setFieldValue("value");
        // filter.setOperator("equals");
        // customFieldRecipient.setFilters(List.of(filter));
        // req.setRecipients(List.of(customFieldRecipient));

        var mode = new CreateAnnouncementRequest.ModeRequest();
        mode.setModeType("SYSTEM_ALERT");
        mode.setSettings(Map.of("priority", "HIGH"));
        req.setModes(List.of(mode));

        var medium = new CreateAnnouncementRequest.MediumRequest();
        medium.setMediumType("PUSH_NOTIFICATION");
        medium.setConfig(Map.of("title", "Hello", "body", "World"));
        req.setMediums(List.of(medium));

        return req;
    }

    @Test
    @DisplayName("Create and fetch announcement")
    void createAndFetchAnnouncement() throws Exception {
        var body = objectMapper.writeValueAsString(sampleRequest());

        var postResult = mockMvc.perform(post("/notification-service/v1/announcements")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andReturn();

        String id = objectMapper.readTree(postResult.getResponse().getContentAsString()).get("id").asText();

        mockMvc.perform(get("/notification-service/v1/announcements/" + id).header("clientId", "INST_TEST").with(user(principal("admin-1", "ADMIN"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Test Announcement"));
    }
}


