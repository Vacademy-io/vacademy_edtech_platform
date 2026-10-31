package vacademy.io.notification_service.features.email_inbox.service;

import jakarta.activation.DataHandler;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.util.ByteArrayDataSource;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

class InboundMimePartsTest {

    private static final byte[] PDF = "%PDF-1.4 fake pdf bytes".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] PNG = new byte[]{(byte) 0x89, 'P', 'N', 'G', 1, 2, 3};

    /**
     * mixed( alternative(text/plain, related(text/html, inline png)), pdf "RFQ – LMS.pdf",
     * delivery-status ) — round-tripped through bytes like an .eml read from S3.
     */
    static MimeMessage sampleMessage() throws Exception {
        Session session = Session.getInstance(new Properties());
        MimeMessage msg = new MimeMessage(session);
        msg.setSubject("RFQ");

        MimeBodyPart text = new MimeBodyPart();
        text.setText("Dear team, please see the attached RFQ.", "UTF-8");

        MimeBodyPart html = new MimeBodyPart();
        html.setContent("<p>Dear team</p><img src=\"cid:logo@x\">", "text/html; charset=UTF-8");
        MimeBodyPart logo = new MimeBodyPart();
        logo.setDataHandler(new DataHandler(new ByteArrayDataSource(PNG, "image/png")));
        logo.setHeader("Content-ID", "<logo@x>");
        logo.setDisposition(Part.INLINE);
        MimeMultipart related = new MimeMultipart("related");
        related.addBodyPart(html);
        related.addBodyPart(logo);
        MimeBodyPart relatedPart = new MimeBodyPart();
        relatedPart.setContent(related);

        MimeMultipart alternative = new MimeMultipart("alternative");
        alternative.addBodyPart(text);
        alternative.addBodyPart(relatedPart);
        MimeBodyPart alternativePart = new MimeBodyPart();
        alternativePart.setContent(alternative);

        MimeBodyPart pdf = new MimeBodyPart();
        pdf.setDataHandler(new DataHandler(new ByteArrayDataSource(PDF, "application/pdf")));
        pdf.setFileName(jakarta.mail.internet.MimeUtility.encodeText("RFQ – LMS.pdf", "UTF-8", null));
        pdf.setDisposition(Part.ATTACHMENT);

        MimeBodyPart dsn = new MimeBodyPart();
        dsn.setContent("Reporting-MTA: dns; x", "message/delivery-status");

        MimeMultipart mixed = new MimeMultipart("mixed");
        mixed.addBodyPart(alternativePart);
        mixed.addBodyPart(pdf);
        mixed.addBodyPart(dsn);
        msg.setContent(mixed);
        msg.saveChanges();

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        msg.writeTo(out);
        return new MimeMessage(session, new ByteArrayInputStream(out.toByteArray()));
    }

    @Test
    void listsAttachmentsWithStablePartIds() throws Exception {
        List<InboundMimeParts.Attachment> list = InboundMimeParts.listAttachments(sampleMessage());

        assertThat(list).extracting(InboundMimeParts.Attachment::id).containsExactly("1.2.2", "2");
        InboundMimeParts.Attachment logo = list.get(0);
        assertThat(logo.contentType()).isEqualTo("image/png");
        assertThat(logo.inline()).isTrue();
        assertThat(logo.contentId()).isEqualTo("logo@x");
        assertThat(logo.filename()).isEqualTo("attachment-1.png");
        assertThat(logo.size()).isEqualTo(PNG.length);

        InboundMimeParts.Attachment pdf = list.get(1);
        assertThat(pdf.filename()).isEqualTo("RFQ – LMS.pdf");
        assertThat(pdf.contentType()).isEqualTo("application/pdf");
        assertThat(pdf.inline()).isFalse();
        assertThat(pdf.size()).isEqualTo(PDF.length);
    }

    @Test
    void findPartReturnsTheDecodedBytesOfThatId() throws Exception {
        MimeMessage msg = sampleMessage();
        Part pdf = InboundMimeParts.findPart(msg, "2").orElseThrow();
        assertThat(InboundMimeParts.readBytes(pdf)).isEqualTo(PDF);
        assertThat(InboundMimeParts.findPart(msg, "9")).isEmpty();
        assertThat(InboundMimeParts.findPart(msg, "")).isEmpty();
    }

    @Test
    void htmlBodyIsTheNonAttachmentHtmlPart() throws Exception {
        assertThat(InboundMimeParts.htmlBody(sampleMessage())).contains("<p>Dear team</p><img src=\"cid:logo@x\">");
    }

    @Test
    void plainTextOnlyMessageHasNoAttachmentsAndNoHtml() throws Exception {
        MimeMessage msg = new MimeMessage(Session.getInstance(new Properties()));
        msg.setText("hello", "UTF-8");
        msg.saveChanges();
        assertThat(InboundMimeParts.listAttachments(msg)).isEmpty();
        assertThat(InboundMimeParts.hasHtmlBody(msg)).isFalse();
    }

    @Test
    @SuppressWarnings("unchecked")
    void indexFieldsIsWhatThePayloadStores() throws Exception {
        Map<String, Object> fields = InboundMimeParts.indexFields(sampleMessage());
        assertThat(fields.get(InboundMimeParts.HAS_HTML_KEY)).isEqualTo(true);
        List<Map<String, Object>> attachments = (List<Map<String, Object>>) fields.get(InboundMimeParts.ATTACHMENTS_KEY);
        assertThat(attachments).hasSize(2);
        assertThat(attachments.get(1)).containsEntry("id", "2").containsEntry("inline", false)
                .containsEntry("filename", "RFQ – LMS.pdf");
    }

    @Test
    void aBouncesReturnedCopyOfOurEmailIsNotAnAttachment() throws Exception {
        Session session = Session.getInstance(new Properties());
        MimeMessage original = new MimeMessage(session);
        original.setSubject("Our campaign");
        original.setText("hello", "UTF-8");
        original.saveChanges();

        MimeBodyPart notice = new MimeBodyPart();
        notice.setText("Delivery failed", "UTF-8");
        MimeBodyPart status = new MimeBodyPart();
        status.setContent("Reporting-MTA: dns; x", "message/delivery-status");
        MimeBodyPart returned = new MimeBodyPart();
        returned.setContent(original, "message/rfc822");
        MimeMultipart report = new MimeMultipart("report; report-type=delivery-status");
        report.addBodyPart(notice);
        report.addBodyPart(status);
        report.addBodyPart(returned);

        MimeMessage bounce = new MimeMessage(session);
        bounce.setContent(report);
        bounce.saveChanges();
        assertThat(InboundMimeParts.listAttachments(bounce)).isEmpty();

        // The same email forwarded by a person as an attachment is a file, named after its subject.
        MimeBodyPart note = new MimeBodyPart();
        note.setText("FYI", "UTF-8");
        MimeBodyPart forwarded = new MimeBodyPart();
        forwarded.setContent(original, "message/rfc822");
        MimeMultipart mixed = new MimeMultipart("mixed");
        mixed.addBodyPart(note);
        mixed.addBodyPart(forwarded);
        MimeMessage fwd = new MimeMessage(session);
        fwd.setContent(mixed);
        fwd.saveChanges();
        assertThat(InboundMimeParts.listAttachments(fwd))
                .extracting(InboundMimeParts.Attachment::filename).containsExactly("Our campaign.eml");
    }

    @Test
    void filenamesLoseTheirPathAndControlCharacters() {
        assertThat(InboundMimeParts.sanitizeFilename("../../etc/passwd")).isEqualTo("passwd");
        assertThat(InboundMimeParts.sanitizeFilename("C:\\Users\\a\\b.pdf")).isEqualTo("b.pdf");
        assertThat(InboundMimeParts.sanitizeFilename("a\u0000b.txt")).isEqualTo("ab.txt");
        assertThat(InboundMimeParts.sanitizeFilename("..")).isNull();
    }
}
