package vacademy.io.notification_service.features.chatbot_flow;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.notification_service.features.chatbot_flow.engine.FlowExecutionContext;
import vacademy.io.notification_service.features.chatbot_flow.engine.VariableResolver;
import vacademy.io.notification_service.features.chatbot_flow.service.EnrollmentCredentialsClient;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The ENROLLMENT_CREDENTIALS variable source is how login details reach a learner:
 * a WhatsApp template body cannot carry them (Meta classifies such a body as
 * AUTHENTICATION, which is fixed-format, so it hard-rejects with
 * INCORRECT_CATEGORY), so they go out as a free-text session message instead.
 */
class EnrollmentCredentialsVariableTest {

    private static final String PHONE = "916367185063";

    private static FlowExecutionContext ctx() {
        return FlowExecutionContext.builder().phoneNumber(PHONE).build();
    }

    private static List<Map<String, Object>> credsVar() {
        // Deliberately no "field": this source is keyed only on the phone number.
        return List.of(Map.of("name", "credsText", "source", "ENROLLMENT_CREDENTIALS"));
    }

    @Test
    @DisplayName("resolves {{credsText}} to the composed login-details text")
    void resolvesCredentialsText() {
        EnrollmentCredentialsClient client = mock(EnrollmentCredentialsClient.class);
        when(client.fetchCredentialsText(PHONE)).thenReturn(
                "Hi Manish Yadav,\n\nUsername: manishyadav838509@gmail.com\nPassword: abcd1234");

        String out = new VariableResolver(client).resolve("{{credsText}}", credsVar(), ctx());

        assertThat(out).contains("Username: manishyadav838509@gmail.com");
        assertThat(out).contains("Password: abcd1234");
    }

    @Test
    @DisplayName("a source with no 'field' is not dropped by the field guard")
    void notSwallowedByFieldGuard() {
        // Regression guard: resolveFromSource() returns null early when "field" is blank,
        // so this source has to be handled before that check or it silently resolves empty.
        EnrollmentCredentialsClient client = mock(EnrollmentCredentialsClient.class);
        when(client.fetchCredentialsText(PHONE)).thenReturn("real text");

        String out = new VariableResolver(client).resolve("{{credsText}}", credsVar(), ctx());

        assertThat(out).isEqualTo("real text");
    }

    @Test
    @DisplayName("unknown number yields blank, so SEND_MESSAGE sends nothing")
    void unknownNumberYieldsBlank() {
        EnrollmentCredentialsClient client = mock(EnrollmentCredentialsClient.class);
        when(client.fetchCredentialsText(PHONE)).thenReturn(null);

        String out = new VariableResolver(client).resolve("{{credsText}}", credsVar(), ctx());

        // SendMessageNodeExecutor refuses to send a blank body, so this is fail-closed:
        // a number with no in-scope enrollment gets no message at all.
        assertThat(out).isBlank();
    }
}
