package vacademy.io.notification_service.service;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Writer side of the counterparty-name contract: the From: display name is what
 * InboundEmailService stores in sender_name, which the inbox shows as counterpartyName.
 */
class InboundEmailFromNameTest {

    private static MimeMessage parse(String rfc822) throws Exception {
        return new MimeMessage(Session.getInstance(new Properties()),
                new ByteArrayInputStream(rfc822.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    @DisplayName("From: Neeraj Hariyale <x@y> → 'Neeraj Hariyale'")
    void personalNameIsExtracted() throws Exception {
        MimeMessage msg = parse("From: Neeraj Hariyale <neeraj@example.com>\r\n"
                + "To: hello@vidyayatan.com\r\nSubject: Re: hello\r\n\r\nhello boss\r\n");

        assertThat(InboundEmailService.extractFromName(msg)).isEqualTo("Neeraj Hariyale");
    }

    @Test
    void quotedAndEncodedNamesAreDecoded() throws Exception {
        MimeMessage quoted = parse("From: \"Jain, Shreyash\" <shreyash@vidyayatan.com>\r\n\r\nx\r\n");
        MimeMessage encoded = parse("From: =?UTF-8?B?4KSo4KWA4KSw4KSc?= <neeraj@example.com>\r\n\r\nx\r\n");

        assertThat(InboundEmailService.extractFromName(quoted)).isEqualTo("Jain, Shreyash");
        assertThat(InboundEmailService.extractFromName(encoded)).isEqualTo("नीरज");
    }

    @Test
    void bareAddressHasNoName() throws Exception {
        MimeMessage msg = parse("From: mailer-daemon@ap-south-1.amazonses.com\r\n\r\nx\r\n");

        assertThat(InboundEmailService.extractFromName(msg)).isNull();
    }

    @Test
    void missingFromHeaderIsNull() throws Exception {
        assertThat(InboundEmailService.extractFromName(parse("Subject: no sender\r\n\r\nx\r\n"))).isNull();
    }
}
