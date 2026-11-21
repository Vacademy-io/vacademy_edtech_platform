package vacademy.io.notification_service.features.chat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Chat is OFF until an institute opts in, so CHAT_DISABLED is the state most institutes are in and
 * the one clients branch on. Both halves of that contract regressed at once and are pinned here:
 *
 * <ul>
 *   <li>the STATUS -- the common GlobalExceptionHandler's catch-all {@code RuntimeException} method
 *       used to match ResponseStatusException too and rewrite every chat rejection into 511, which
 *       both frontends discard as a server error (they only read reason codes off a 4xx);</li>
 *   <li>the LOG LEVEL -- SlowQueryLogger logged any thrown exception at error level, so a request
 *       to a chat-disabled institute raised a Sentry issue for behaving exactly as designed.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChatRejectionStatusTest {

    private static final String CHAT_OFF_INSTITUTE = "INST_WITHOUT_CHAT";

    @Autowired
    private MockMvc mockMvc;

    private Logger slowQueryLogger;
    private ListAppender<ILoggingEvent> appender;

    private static CustomUserDetails admin() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-user-1");
        dto.setUsername("admin@example.com");
        dto.setFullName("Institute Admin");
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    @BeforeEach
    void captureLogs() {
        slowQueryLogger = (Logger) LoggerFactory.getLogger("vacademy.io.common.tracing.SlowQueryLogger");
        slowQueryLogger.setLevel(Level.DEBUG);
        appender = new ListAppender<>();
        appender.start();
        slowQueryLogger.addAppender(appender);
    }

    @AfterEach
    void releaseLogs() {
        slowQueryLogger.detachAppender(appender);
        appender.stop();
    }

    @Test
    @DisplayName("Opening the community on a chat-disabled institute answers 403 CHAT_DISABLED")
    void communityProvisionKeepsItsForbiddenStatus() throws Exception {
        mockMvc.perform(post("/notification-service/v1/chat/conversations/community")
                        .header("clientId", CHAT_OFF_INSTITUTE)
                        .with(user(admin())))
                .andExpect(status().isForbidden())
                // Bare reason code, not "403 FORBIDDEN \"CHAT_DISABLED\"": the learner app matches
                // it exactly against its rejection-code map.
                .andExpect(jsonPath("$.message").value("CHAT_DISABLED"));
    }

    @Test
    @DisplayName("Listing conversations on a chat-disabled institute answers 403 CHAT_DISABLED")
    void listConversationsKeepsItsForbiddenStatus() throws Exception {
        mockMvc.perform(get("/notification-service/v1/chat/conversations")
                        .header("clientId", CHAT_OFF_INSTITUTE)
                        .with(user(admin())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("CHAT_DISABLED"));
    }

    @Test
    @DisplayName("A 4xx business rejection is not logged as a service failure")
    void chatDisabledRaisesNoErrorLog() throws Exception {
        mockMvc.perform(post("/notification-service/v1/chat/conversations/community")
                        .header("clientId", CHAT_OFF_INSTITUTE)
                        .with(user(admin())))
                .andExpect(status().isForbidden());

        assertThat(appender.list)
                .as("a deliberate 403 must not reach Sentry as an error")
                .noneMatch(event -> event.getLevel() == Level.ERROR);
    }
}
