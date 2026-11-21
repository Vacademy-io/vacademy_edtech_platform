package vacademy.io.notification_service.service;

import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.URLName;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/** What the send path stores as source_id and what SES hands back on events must be the same reference. */
class EmailServiceMessageRefTest {

    private static MimeMessage message() throws Exception {
        MimeMessage message = new MimeMessage(Session.getInstance(new Properties()));
        message.setFrom(new InternetAddress("hello@academy.in"));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress("lead@example.com"));
        message.setSubject("Hello");
        message.setText("Hi");
        return message;
    }

    /** Sends nothing; the real JavaMailSenderImpl still runs up to the transport. */
    private static final class NoNetworkSender extends JavaMailSenderImpl {
        @Override
        protected Transport connectTransport() {
            return new Transport(Session.getInstance(new Properties()), new URLName("smtp://none")) {
                @Override
                public void sendMessage(Message msg, Address[] addresses) {
                }

                @Override
                public synchronized boolean isConnected() {
                    return true;
                }
            };
        }
    }

    @Test
    @DisplayName("The Message-ID we set survives the send, so source_id can be read after it")
    void messageIdSurvivesSend() throws Exception {
        MimeMessage message = message();

        EmailService.stampMessageRef(message, true);
        String stamped = message.getMessageID();
        new NoNetworkSender().send(message);

        assertThat(message.getMessageID()).isEqualTo(stamped);
    }

    @Test
    @DisplayName("The SES tag carries the same reference as the Message-ID")
    void tagMatchesMessageId() throws Exception {
        MimeMessage message = message();

        EmailService.stampMessageRef(message, true);

        String tag = message.getHeader("X-SES-MESSAGE-TAGS")[0];
        assertThat(tag).startsWith(EmailService.SES_TAG_MESSAGE_REF + "=");
        String ref = tag.substring(tag.indexOf('=') + 1);
        assertThat(ref).matches("[A-Za-z0-9-]+");
        assertThat(message.getMessageID()).isEqualTo(EmailService.messageIdOf(ref));
    }

    @Test
    @DisplayName("Without SES tracking there is no SES header, and the Message-ID is still ours")
    void noTagWithoutSesTracking() throws Exception {
        MimeMessage message = message();

        EmailService.stampMessageRef(message, false);

        assertThat(message.getHeader("X-SES-MESSAGE-TAGS")).isNull();
        assertThat(message.getMessageID()).endsWith("@notification-service>");
    }
}
