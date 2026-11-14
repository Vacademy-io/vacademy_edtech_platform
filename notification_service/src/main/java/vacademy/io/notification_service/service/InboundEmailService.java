package vacademy.io.notification_service.service;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.AmazonS3Exception;
import com.amazonaws.services.s3.model.S3Object;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.bounced_emails.service.BounceNoticeRecipients;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.email_inbox.service.InboundMimeParts;
import vacademy.io.notification_service.features.notification_log.entity.EmailAddressMapping;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@Slf4j
@Service
@ConditionalOnProperty(name = "aws.inbound.email.enabled", havingValue = "true", matchIfMissing = false)
public class InboundEmailService {

    private static final int MAX_INBOUND_PER_MINUTE = 10;
    private static final int MAX_BODY_BYTES = 65536; // 64 KB
    private static final Duration BOUNCE_NOTICE_WINDOW = Duration.ofDays(7);

    private final AmazonS3 inboundS3Client;
    private final NotificationLogRepository notificationLogRepository;
    private final EmailAddressMappingRepository emailAddressMappingRepository;
    private final ObjectMapper objectMapper;

    /** The blocklist a bounce notice feeds; field-injected so the constructor stays as it was. */
    @Autowired(required = false)
    private BouncedEmailService bouncedEmailService;

    @Value("${aws.s3.inbound-email-bucket}")
    private String inboundBucket;

    // In-memory rate limiting: sender address → count in the last 60 seconds
    private final Cache<String, AtomicInteger> rateLimitCache = CacheBuilder.newBuilder()
            .expireAfterWrite(60, TimeUnit.SECONDS)
            .build();

    public InboundEmailService(
            @Qualifier("inboundS3Client") AmazonS3 inboundS3Client,
            NotificationLogRepository notificationLogRepository,
            EmailAddressMappingRepository emailAddressMappingRepository,
            ObjectMapper objectMapper) {
        this.inboundS3Client = inboundS3Client;
        this.notificationLogRepository = notificationLogRepository;
        this.emailAddressMappingRepository = emailAddressMappingRepository;
        this.objectMapper = objectMapper;
    }

    public void processInboundEmail(String bucket, String key) {
        try {
            // 1. Download raw .eml from S3
            S3Object s3Object = inboundS3Client.getObject(bucket, key);
            Session session = Session.getInstance(new Properties());
            MimeMessage mimeMessage;
            try (var inputStream = s3Object.getObjectContent()) {
                mimeMessage = new MimeMessage(session, inputStream);
            }

            // 2. Parse headers and body
            String messageId = extractHeader(mimeMessage, "Message-ID");
            String inReplyTo = extractHeader(mimeMessage, "In-Reply-To");
            String fromAddress = extractFrom(mimeMessage);
            String fromName = extractFromName(mimeMessage);
            List<String> toAddresses = extractRecipients(mimeMessage);
            String subject = safeGetSubject(mimeMessage);
            String body = extractBody(mimeMessage);

            // 3. Dedup: skip if we already stored this inbound email
            if (messageId != null && !notificationLogRepository
                    .findBySourceIdAndNotificationType(messageId, "INBOUND_EMAIL").isEmpty()) {
                log.info("Duplicate inbound email messageId={}, skipping", messageId);
                return;
            }

            // 3b. A bounce notice blocks its recipient. Before the rate limit: a batch send can bounce
            // more than the limit allows from this one sender, and each notice names a different address.
            recordBounceNotice(fromAddress, body, messageId);

            // 4. Rate limit per sender
            if (fromAddress != null && isRateLimited(fromAddress)) {
                log.warn("Rate limit exceeded for inbound sender={}, skipping", fromAddress);
                return;
            }

            // 5. Institute lookup — best-effort, does not block saving.
            // matchedInstituteAddress is the institute-side address (the To: that matched a mapping).
            // We store it as sender_business_channel_id so inbox queries can scope by institute,
            // mirroring how WhatsApp uses sender_business_channel_id for the institute's WA number.
            String instituteId = null;
            String matchedInstituteAddress = null;
            for (String toAddr : toAddresses) {
                Optional<EmailAddressMapping> mapping =
                        emailAddressMappingRepository.findByEmailAddressIgnoreCaseAndIsActiveTrue(toAddr);
                if (mapping.isPresent()) {
                    instituteId = mapping.get().getInstituteId();
                    matchedInstituteAddress = mapping.get().getEmailAddress();
                    break;
                }
            }
            if (instituteId == null) {
                log.warn("No active email_address_mapping found for To={}, saving log without instituteId", toAddresses);
            }

            // 6. Reply linking via In-Reply-To → original outbound EMAIL log
            String parentLogId = null;
            String userId = null;
            Optional<NotificationLog> parent = findRepliedToEmail(inReplyTo, fromAddress, toAddresses, instituteId);
            if (parent.isPresent()) {
                parentLogId = parent.get().getId();
                userId = parent.get().getUserId();
            }

            // 7. userId fallback: resolve from most recent outbound email to this sender
            if (userId == null && fromAddress != null) {
                Optional<NotificationLog> recent = notificationLogRepository
                        .findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(fromAddress, "EMAIL");
                if (recent.isPresent()) {
                    userId = recent.get().getUserId();
                }
            }

            // 8. Build messagePayload JSON
            String toAddress = toAddresses.isEmpty() ? "" : toAddresses.get(0);
            String truncatedBody = truncate(body, MAX_BODY_BYTES, "[TRUNCATED]");

            Map<String, Object> payloadMap = new HashMap<>();
            payloadMap.put("subject", subject);
            payloadMap.put("from", fromAddress);
            payloadMap.put("to", toAddress);
            payloadMap.put("body", truncatedBody);
            payloadMap.put("instituteId", instituteId);
            // Where the raw email lives, plus its attachment index: the inbox lists attachments
            // from this and streams a file from S3 only when an admin opens it.
            payloadMap.put(InboundMimeParts.S3_BUCKET_KEY, bucket);
            payloadMap.put(InboundMimeParts.S3_KEY_KEY, key);
            try {
                payloadMap.putAll(InboundMimeParts.indexFields(mimeMessage));
            } catch (Exception e) {
                // Left unindexed: InboundEmailContentService.indexPending() retries it.
                log.warn("Could not index attachments of inbound {}/{}: {}", bucket, key, e.getMessage());
            }
            String messagePayload = objectMapper.writeValueAsString(payloadMap);

            // 9. Persist
            NotificationLog inboundLog = new NotificationLog();
            inboundLog.setId(UUID.randomUUID().toString());
            inboundLog.setNotificationType("INBOUND_EMAIL");
            inboundLog.setChannelId(fromAddress);
            inboundLog.setBody(subject != null && subject.length() > 100
                    ? subject.substring(0, 100) : subject);
            inboundLog.setSourceId(messageId);
            inboundLog.setSource(parentLogId);
            inboundLog.setUserId(userId);
            // "Neeraj Hariyale <x@y>" → the inbox shows the person, not just the bare address.
            inboundLog.setSenderName(fromName);
            // email_address_mapping rows are already canonical lowercase emails, but route through
            // the shared normalizer for consistency with EmailService / AnnouncementDeliveryService.
            String normalizedInbox = EmailService.normalizeFromAddress(matchedInstituteAddress);
            if (normalizedInbox != null) {
                inboundLog.setSenderBusinessChannelId(normalizedInbox);
            }
            inboundLog.setMessagePayload(messagePayload);
            inboundLog.setInstituteId(instituteId);
            inboundLog.setNotificationDate(Instant.now());

            notificationLogRepository.save(inboundLog);
            log.info("Saved INBOUND_EMAIL from={} messageId={} parentLogId={} userId={}",
                    fromAddress, messageId, parentLogId, userId);

        } catch (AmazonS3Exception e) {
            if ("NoSuchKey".equals(e.getErrorCode())) {
                log.error("S3 object not found (already expired?): {}/{}", bucket, key);
            } else {
                log.error("S3 error processing inbound email {}/{}: {}", bucket, key, e.getMessage(), e);
            }
        } catch (Exception e) {
            log.error("Error processing inbound email {}/{}: {}", bucket, key, e.getMessage(), e);
        }
    }

    /**
     * SES mails a bounce notice even when its bounce event never reaches us (seen on prod: the mail
     * came, the event did not, and the address kept getting email). Only an address we recently
     * mailed is blocked, so a forged notice cannot block an arbitrary address. Never fails the ingest.
     */
    void recordBounceNotice(String fromAddress, String body, String messageId) {
        if (bouncedEmailService == null) return;
        try {
            for (String recipient : BounceNoticeRecipients.parse(fromAddress, body)) {
                if (bouncedEmailService.isEmailBlocked(recipient)) continue;
                Optional<NotificationLog> sent = notificationLogRepository
                        .findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(recipient, "EMAIL");
                if (sent.isEmpty() || sent.get().getNotificationDate() == null
                        || sent.get().getNotificationDate().isBefore(Instant.now().minus(BOUNCE_NOTICE_WINDOW))) {
                    log.warn("Bounce notice for an address not mailed recently, ignored: {}", recipient);
                    continue;
                }
                bouncedEmailService.addBouncedEmail(recipient, BounceNoticeRecipients.BOUNCE_TYPE,
                        BounceNoticeRecipients.BOUNCE_SUB_TYPE, "From the bounce notice email", messageId,
                        sent.get().getId());
            }
        } catch (Exception e) {
            log.warn("Could not record bounce notice {}: {}", messageId, e.getMessage());
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * The outbound email this one answers, surest first. A mail with no In-Reply-To answers nothing.
     * <ol>
     *   <li>In-Reply-To is the Message-ID we stored: a provider that keeps our Message-ID.</li>
     *   <li>In-Reply-To is the id SES sent it under (SES overwrites ours): that id is on the
     *       message's EMAIL_EVENT rows, and their source is the EMAIL row.</li>
     *   <li>The latest email from the mailbox it was sent to, to this person: right unless they
     *       answered an older one.</li>
     *   <li>Only for a mailbox no institute owns: the latest email to this person from anyone.
     *       Otherwise another institute's email could take the reply.</li>
     * </ol>
     */
    Optional<NotificationLog> findRepliedToEmail(String inReplyTo, String fromAddress,
                                                 List<String> toAddresses, String instituteId) {
        if (inReplyTo == null) {
            return Optional.empty();
        }
        List<NotificationLog> exact = notificationLogRepository.findBySourceIdAndNotificationType(inReplyTo, "EMAIL");
        if (!exact.isEmpty()) {
            return Optional.of(exact.get(0));
        }
        String sesId = sesMessageId(inReplyTo);
        if (sesId != null) {
            Optional<NotificationLog> sent = notificationLogRepository
                    .findTopByNotificationTypeAndSourceIdOrderByNotificationDateDesc("EMAIL_EVENT", sesId)
                    .map(NotificationLog::getSource)
                    .flatMap(notificationLogRepository::findById);
            if (sent.isPresent()) {
                return sent;
            }
        }
        for (String mailbox : toAddresses) {
            Optional<NotificationLog> latest = notificationLogRepository
                    .findTopByChannelIdAndSenderBusinessChannelIdAndNotificationTypeOrderByNotificationDateDesc(
                            fromAddress, mailbox, "EMAIL");
            if (latest.isPresent()) {
                return latest;
            }
        }
        if (instituteId != null) {
            return Optional.empty();
        }
        return notificationLogRepository
                .findTopByChannelIdAndNotificationTypeAndNotificationDateBeforeOrderByNotificationDateDesc(
                        fromAddress, "EMAIL", Instant.now().plus(Duration.ofMinutes(5)));
    }

    /** {@code <id@ap-south-1.amazonses.com>} → {@code id}, as SES names the message on its events; else null. */
    static String sesMessageId(String messageIdHeader) {
        String value = messageIdHeader.trim().replaceAll("^<|>$", "");
        int at = value.indexOf('@');
        return at > 0 && value.toLowerCase().endsWith("amazonses.com") ? value.substring(0, at) : null;
    }

    private boolean isRateLimited(String fromAddress) {
        try {
            AtomicInteger counter = rateLimitCache.get(fromAddress, AtomicInteger::new);
            return counter.incrementAndGet() > MAX_INBOUND_PER_MINUTE;
        } catch (Exception e) {
            return false;
        }
    }

    private String extractHeader(MimeMessage msg, String headerName) {
        try {
            String[] values = msg.getHeader(headerName);
            return (values != null && values.length > 0) ? values[0].trim() : null;
        } catch (Exception e) {
            log.debug("Could not extract header {}: {}", headerName, e.getMessage());
            return null;
        }
    }

    private String extractFrom(MimeMessage msg) {
        try {
            Address[] froms = msg.getFrom();
            if (froms != null && froms.length > 0 && froms[0] instanceof InternetAddress ia) {
                return ia.getAddress().toLowerCase();
            }
        } catch (Exception e) {
            log.debug("Could not extract From: {}", e.getMessage());
        }
        return null;
    }

    /** From: display name ("Personal" part), trimmed and capped to the column; null when absent. */
    static String extractFromName(MimeMessage msg) {
        try {
            Address[] froms = msg.getFrom();
            if (froms != null && froms.length > 0 && froms[0] instanceof InternetAddress ia) {
                String personal = ia.getPersonal();
                if (personal == null) return null;
                String trimmed = personal.trim();
                if (trimmed.isEmpty()) return null;
                return trimmed.length() > 255 ? trimmed.substring(0, 255) : trimmed;
            }
        } catch (Exception e) {
            log.debug("Could not extract From display name: {}", e.getMessage());
        }
        return null;
    }

    private List<String> extractRecipients(MimeMessage msg) {
        List<String> recipients = new ArrayList<>();
        try {
            for (Message.RecipientType type : new Message.RecipientType[]{
                    Message.RecipientType.TO, Message.RecipientType.CC}) {
                Address[] addrs = msg.getRecipients(type);
                if (addrs != null) {
                    for (Address addr : addrs) {
                        if (addr instanceof InternetAddress ia) {
                            recipients.add(ia.getAddress().toLowerCase());
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Could not extract recipients: {}", e.getMessage());
        }
        return recipients;
    }

    private String safeGetSubject(MimeMessage msg) {
        try {
            return msg.getSubject();
        } catch (Exception e) {
            log.debug("Could not extract subject: {}", e.getMessage());
            return null;
        }
    }

    private String extractBody(MimeMessage msg) {
        try {
            return extractBodyFromPart(msg);
        } catch (Exception e) {
            log.warn("Could not parse MIME body: {}", e.getMessage());
            return "[PARSE_ERROR]";
        }
    }

    private String extractBodyFromPart(Part part) throws Exception {
        if (part.isMimeType("text/plain")) {
            return (String) part.getContent();
        }
        if (part.isMimeType("text/html")) {
            return stripHtml((String) part.getContent());
        }
        if (part.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) part.getContent();
            // Prefer text/plain
            for (int i = 0; i < mp.getCount(); i++) {
                Part bp = mp.getBodyPart(i);
                if (bp.isMimeType("text/plain")) return extractBodyFromPart(bp);
            }
            // Fallback to text/html
            for (int i = 0; i < mp.getCount(); i++) {
                Part bp = mp.getBodyPart(i);
                if (bp.isMimeType("text/html")) return extractBodyFromPart(bp);
            }
            // Recurse into nested multipart
            for (int i = 0; i < mp.getCount(); i++) {
                Part bp = mp.getBodyPart(i);
                if (bp.isMimeType("multipart/*")) return extractBodyFromPart(bp);
            }
        }
        return null;
    }

    private String stripHtml(String html) {
        if (html == null) return null;
        return html.replaceAll("<[^>]*>", " ").replaceAll("\\s+", " ").trim();
    }

    private String truncate(String text, int maxBytes, String marker) {
        if (text == null) return null;
        byte[] bytes = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (bytes.length <= maxBytes) return text;
        return new String(bytes, 0, maxBytes, java.nio.charset.StandardCharsets.UTF_8) + marker;
    }
}
