package vacademy.io.notification_service.features.email_sending_controls.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Locale;

/**
 * Puts the RFC 8058 headers and the CAN-SPAM footer on a message. Applied only
 * when {@link SenderPolicy#unsubscribeApplies} says so, so OTPs and receipts
 * never grow an unsubscribe line.
 */
@Component
@RequiredArgsConstructor
public class UnsubscribeMailer {

    private final EmailUnsubscribeService unsubscribes;

    /** Optional mailto: target listed alongside the https link (needs an inbox that processes it). */
    @Value("${email.unsubscribe.mailto:}")
    private String mailto;

    /** Platform-wide fallback postal address when the sender node has none. */
    @Value("${email.sender.postal.address:}")
    private String defaultPostalAddress;

    public void addHeaders(MimeMessage message, String instituteId, String toEmail) throws MessagingException {
        String url = unsubscribes.unsubscribeUrl(instituteId, toEmail);
        String value = (mailto != null && !mailto.isBlank())
                ? "<mailto:" + mailto.trim() + "?subject=unsubscribe>, <" + url + ">"
                : "<" + url + ">";
        message.setHeader("List-Unsubscribe", value);
        message.setHeader("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
    }

    /**
     * Appends (or substitutes at {@code {{unsubscribeUrl}}}) the footer. Kept deliberately
     * plain: one line, muted, inline styles only, works in every client.
     */
    public String withFooter(String html, String instituteId, String toEmail, SenderPolicy policy, String senderName) {
        if (html == null) html = "";
        String url = unsubscribes.unsubscribeUrl(instituteId, toEmail);
        if (html.contains("{{unsubscribeUrl}}")) {
            return html.replace("{{unsubscribeUrl}}", url);
        }
        String address = policy != null && policy.postalAddress() != null ? policy.postalAddress()
                : (defaultPostalAddress != null && !defaultPostalAddress.isBlank() ? defaultPostalAddress.trim() : null);
        StringBuilder f = new StringBuilder();
        f.append("<div style=\"margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280\">");
        f.append("You received this email from ").append(escape(senderName == null ? "us" : senderName)).append(". ");
        f.append("Don't want these? <a href=\"").append(url).append("\" style=\"color:#6b7280;text-decoration:underline\">Unsubscribe</a>.");
        if (address != null) f.append("<br>").append(escape(address));
        f.append("</div>");
        String lower = html.toLowerCase(Locale.ROOT);
        int idx = lower.lastIndexOf("</body>");
        return idx >= 0 ? html.substring(0, idx) + f + html.substring(idx) : html + f;
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
