package vacademy.io.notification_service.features.email_inbox.service;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.S3Object;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads an inbound email's raw .eml back from the inbound S3 bucket so the inbox can serve its
 * attachments and original HTML. The DB row only carries the S3 location and a part index
 * (written at ingest by InboundEmailService, or by {@link #indexPending()} for rows stored before
 * ingest indexed parts); the bytes are never copied into the database.
 */
@Slf4j
@Service
@ConditionalOnProperty(name = "aws.inbound.email.enabled", havingValue = "true", matchIfMissing = false)
public class InboundEmailContentService {

    private static final String INBOUND_TYPE = "INBOUND_EMAIL";
    private static final int INDEX_BATCH = 50;
    /** After a run that found nothing to index, re-check this rarely (the query scans an index). */
    private static final Duration IDLE_RECHECK = Duration.ofHours(6);
    /** HTML bodies above this are not rendered (the plain-text body still shows). */
    private static final int MAX_HTML_CHARS = 2_000_000;
    /** cid: images are inlined as data: URIs up to these limits; larger ones stay broken links. */
    private static final long MAX_INLINE_IMAGE_BYTES = 3L * 1024 * 1024;
    private static final long MAX_INLINE_TOTAL_BYTES = 8L * 1024 * 1024;
    private static final Pattern CID_REF = Pattern.compile("(?i)cid:([^\"'\\s>)]+)");

    public record AttachmentContent(byte[] bytes, String filename, String contentType) {}

    private final AmazonS3 inboundS3Client;
    private final NotificationLogRepository notificationLogRepository;
    private final ObjectMapper objectMapper;

    @Value("${aws.s3.inbound-email-bucket}")
    private String inboundBucket;

    private volatile Instant idleUntil = Instant.EPOCH;

    public InboundEmailContentService(@Qualifier("inboundS3Client") AmazonS3 inboundS3Client,
                                      NotificationLogRepository notificationLogRepository,
                                      ObjectMapper objectMapper) {
        this.inboundS3Client = inboundS3Client;
        this.notificationLogRepository = notificationLogRepository;
        this.objectMapper = objectMapper;
    }

    // ==================== Serving ====================

    /** The decoded bytes of one attachment, or empty when the row/part/raw email is gone. */
    public Optional<AttachmentContent> readAttachment(NotificationLog row, String partId) {
        Optional<MimeMessage> message = loadRaw(row);
        if (message.isEmpty()) return Optional.empty();
        Optional<Part> part = InboundMimeParts.findPart(message.get(), partId);
        if (part.isEmpty() || !InboundMimeParts.isAttachmentPart(part.get())) return Optional.empty();
        try {
            Part p = part.get();
            String name = InboundMimeParts.filename(p);
            if (name == null) name = "attachment-" + partId.replace('.', '-');
            return Optional.of(new AttachmentContent(
                    InboundMimeParts.readBytes(p), name, InboundMimeParts.baseType(p)));
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Could not read part {} of inbound {}: {}", partId, row.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * The email's own HTML body with cid: images inlined as data: URIs, for a sandboxed iframe.
     * Empty when the email has no HTML part (the plain-text body is then all there is).
     */
    public Optional<String> renderHtml(NotificationLog row) {
        Optional<MimeMessage> message = loadRaw(row);
        if (message.isEmpty()) return Optional.empty();
        Optional<String> html = InboundMimeParts.htmlBody(message.get());
        if (html.isEmpty() || html.get().length() > MAX_HTML_CHARS) return Optional.empty();
        return Optional.of(inlineCidImages(html.get(), message.get()));
    }

    String inlineCidImages(String html, MimeMessage message) {
        if (!CID_REF.matcher(html).find()) return html;
        Map<String, String> partIdByCid = new HashMap<>();
        Map<String, Long> sizeByCid = new HashMap<>();
        for (InboundMimeParts.Attachment a : InboundMimeParts.listAttachments(message)) {
            if (a.contentId() != null && a.contentType().startsWith("image/")) {
                partIdByCid.put(a.contentId(), a.id());
                sizeByCid.put(a.contentId(), a.size());
            }
        }
        Map<String, String> dataUris = new HashMap<>();
        long[] budget = {MAX_INLINE_TOTAL_BYTES};
        Matcher m = CID_REF.matcher(html);
        StringBuilder out = new StringBuilder(html.length());
        while (m.find()) {
            String cid = URLDecoder.decode(m.group(1), StandardCharsets.UTF_8);
            String uri = dataUris.computeIfAbsent(cid, c -> toDataUri(message, c, partIdByCid, sizeByCid, budget));
            m.appendReplacement(out, Matcher.quoteReplacement(uri != null && !uri.isEmpty() ? uri : m.group()));
        }
        m.appendTail(out);
        return out.toString();
    }

    private String toDataUri(MimeMessage message, String cid, Map<String, String> partIdByCid,
                             Map<String, Long> sizeByCid, long[] budget) {
        String partId = partIdByCid.get(cid);
        Long size = sizeByCid.get(cid);
        if (partId == null || size == null || size < 0 || size > MAX_INLINE_IMAGE_BYTES || size > budget[0]) {
            return "";
        }
        try {
            Optional<Part> part = InboundMimeParts.findPart(message, partId);
            if (part.isEmpty()) return "";
            byte[] bytes = InboundMimeParts.readBytes(part.get());
            budget[0] -= bytes.length;
            return "data:" + InboundMimeParts.baseType(part.get()) + ";base64,"
                    + Base64.getEncoder().encodeToString(bytes);
        } catch (Exception e) {
            return "";
        }
    }

    // ==================== Indexing ====================

    /**
     * Index rows whose S3 location is known but whose parts were never listed. Ingest indexes
     * every new email itself, so this only drains the backfill; once a run finds nothing it
     * re-checks every {@link #IDLE_RECHECK}.
     */
    @Scheduled(fixedDelayString = "${email.inbox.attachment-index.delay-ms:300000}",
            initialDelayString = "${email.inbox.attachment-index.initial-delay-ms:120000}")
    public void indexPending() {
        if (Instant.now().isBefore(idleUntil)) return;
        List<NotificationLog> rows;
        try {
            rows = notificationLogRepository.findInboundEmailsToIndex(INDEX_BATCH);
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Attachment index query failed: {}", e.getMessage());
            return;
        }
        if (rows.isEmpty()) {
            idleUntil = Instant.now().plus(IDLE_RECHECK);
            return;
        }
        int indexed = 0;
        for (NotificationLog row : rows) {
            if (index(row)) indexed++;
        }
        log.info("[EMAIL-INBOX] Indexed attachments for {}/{} inbound emails", indexed, rows.size());
    }

    /**
     * Writes the part index into the row's payload. A raw email that no longer exists is
     * recorded as indexed with no attachments (so it is not retried forever); any other failure
     * leaves the row for the next run. Returns true when the payload was updated.
     */
    boolean index(NotificationLog row) {
        Optional<ObjectNode> payload = payload(row);
        if (payload.isEmpty()) return false;
        Map<String, Object> fields;
        try {
            Optional<MimeMessage> message = loadRawOrThrow(row);
            if (message.isEmpty()) return false;
            fields = InboundMimeParts.indexFields(message.get());
        } catch (AmazonS3Exception e) {
            if (e.getStatusCode() != 404) {
                log.warn("[EMAIL-INBOX] S3 error indexing inbound {}: {}", row.getId(), e.getMessage());
                return false;
            }
            fields = Map.of(InboundMimeParts.ATTACHMENTS_KEY, List.of(),
                    InboundMimeParts.HAS_HTML_KEY, false,
                    "indexError", "RAW_EMAIL_MISSING");
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Could not index inbound {}: {}", row.getId(), e.getMessage());
            return false;
        }
        ObjectNode node = payload.get();
        fields.forEach((k, v) -> node.set(k, objectMapper.valueToTree(v)));
        try {
            row.setMessagePayload(objectMapper.writeValueAsString(node));
            notificationLogRepository.save(row);
            return true;
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Could not save index for inbound {}: {}", row.getId(), e.getMessage());
            return false;
        }
    }

    // ==================== Raw email ====================

    private Optional<MimeMessage> loadRaw(NotificationLog row) {
        try {
            return loadRawOrThrow(row);
        } catch (Exception e) {
            log.warn("[EMAIL-INBOX] Could not load raw email for inbound {}: {}", row.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * The parsed raw email of an INBOUND_EMAIL row. Empty when the row is not inbound or carries
     * no S3 location; only the configured inbound bucket is ever read.
     */
    private Optional<MimeMessage> loadRawOrThrow(NotificationLog row) throws Exception {
        if (row == null || !INBOUND_TYPE.equals(row.getNotificationType())) return Optional.empty();
        Optional<ObjectNode> payload = payload(row);
        if (payload.isEmpty()) return Optional.empty();
        String key = text(payload.get(), InboundMimeParts.S3_KEY_KEY);
        String bucket = text(payload.get(), InboundMimeParts.S3_BUCKET_KEY);
        if (key == null) return Optional.empty();
        if (bucket != null && !bucket.equals(inboundBucket)) {
            log.warn("[EMAIL-INBOX] Inbound {} points at bucket {}, not the inbound bucket; refusing",
                    row.getId(), bucket);
            return Optional.empty();
        }
        try (S3Object object = inboundS3Client.getObject(inboundBucket, key);
             InputStream in = object.getObjectContent()) {
            return Optional.of(new MimeMessage(Session.getInstance(new Properties()), in));
        }
    }

    private Optional<ObjectNode> payload(NotificationLog row) {
        String raw = row.getMessagePayload();
        if (raw == null || raw.isBlank()) return Optional.empty();
        try {
            JsonNode node = objectMapper.readTree(raw);
            return node instanceof ObjectNode o ? Optional.of(o) : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) return null;
        String s = v.asText();
        return s == null || s.isBlank() ? null : s;
    }
}
