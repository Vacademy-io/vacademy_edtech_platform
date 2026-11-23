package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        // DB: H2 for isolation; Quartz off to avoid external
        "spring.datasource.url=jdbc:h2:mem:notifdb;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
        "spring.datasource.driverClassName=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create",
        "spring.quartz.auto-startup=false"
})
@ActiveProfiles("test")
@AutoConfigureMockMvc
class AnnouncementEmailApiIT {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @DynamicPropertySource
    static void stageMailFromEnv(DynamicPropertyRegistry registry) {
        // Read env vars as in .vscode/launch.json for stage
        String host = System.getenv("MAIL_HOST");
        String port = System.getenv("MAIL_PORT");
        String username = System.getenv("AWS_MAIL_USERNAME");
        String password = System.getenv("AWS_MAIL_PASSWORD");
        String sender = System.getenv("SES_SENDER_EMAIL");

        if (host != null) registry.add("spring.mail.host", () -> host);
        if (port != null) registry.add("spring.mail.port", () -> port);
        if (username != null) registry.add("spring.mail.username", () -> username);
        if (password != null) registry.add("spring.mail.password", () -> password);
        if (sender != null) registry.add("app.ses.sender.email", () -> sender);

        // Stage defaults
        registry.add("spring.mail.properties.mail.smtp.auth", () -> true);
        registry.add("spring.mail.properties.mail.smtp.starttls.enable", () -> true);
    }

    @Test
    void createAnnouncement_withEmailMedium_sendsEmailToAddress() throws Exception {
        var req = Map.of(
                "title", "Email Medium API Test",
                "instituteId", "INST_EMAIL_IT",
                "createdBy", "CREATOR_EMAIL_IT",
                "createdByRole", "ADMIN",
                "timezone", "UTC",
                "content", Map.of(
                        "type", "html",
                        "content", "<p>This is a live API email test</p>"
                ),
                "recipients", List.of(Map.of(
                        "recipientType", "USER",
                        "recipientId", "user-email-it"
                )),
                "modes", List.of(Map.of(
                        "modeType", "SYSTEM_ALERT",
                        "settings", Map.of("priority", 1)
                )),
                "mediums", List.of(Map.of(
                        "mediumType", "EMAIL",
                        "config", Map.of(
                                "subject", "Vacademy Announcement Email API Test",
                                "force_to_email", "shreyash@vidyayatan.com"
                        )
                )),
                "scheduling", Map.of(
                        "scheduleType", "IMMEDIATE"
                )
        );

        mockMvc.perform(post("/notification-service/v1/announcements").with(AnnouncementTestAuth.admin("INST_EMAIL_IT"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk());
    }
}


