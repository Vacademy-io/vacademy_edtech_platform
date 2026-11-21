package vacademy.io.notification_service.service;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;

/** An answer joins the person's thread, and their Message-ID can never add a header of its own. */
class EmailReplyHeadersTest {

    private static MimeMessage message() {
        return new MimeMessage(Session.getInstance(new Properties()));
    }

    @Test
    @DisplayName("a well-formed id sets In-Reply-To and References")
    void setsThreadHeaders() throws Exception {
        MimeMessage m = message();
        EmailService.applyReplyHeaders(m, " <abc.123@mail.example.com> ");
        assertEquals("<abc.123@mail.example.com>", m.getHeader("In-Reply-To", null));
        assertEquals("<abc.123@mail.example.com>", m.getHeader("References", null));
    }

    @Test
    @DisplayName("no id, a malformed id or a header injection adds nothing")
    void dropsAnythingElse() throws Exception {
        for (String bad : new String[]{null, "", "plain-id", "<a b@c>", "<a@b>\r\nBcc: x@y.test", "<a@b><c@d>"}) {
            MimeMessage m = message();
            EmailService.applyReplyHeaders(m, bad);
            assertNull(m.getHeader("In-Reply-To"), String.valueOf(bad));
            assertNull(m.getHeader("References"), String.valueOf(bad));
        }
    }
}
