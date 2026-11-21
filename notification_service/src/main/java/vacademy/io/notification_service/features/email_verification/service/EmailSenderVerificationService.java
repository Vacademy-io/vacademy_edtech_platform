package vacademy.io.notification_service.features.email_verification.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.email_verification.dto.DnsRecordDTO;
import vacademy.io.notification_service.features.email_verification.dto.SenderVerificationRequest;
import vacademy.io.notification_service.features.email_verification.dto.SenderVerificationResponse;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.util.List;
import java.util.UUID;

/**
 * Orchestrates self-serve SES sender verification for white-label institutes:
 * triggers the AWS verification, and records the verification state inside the
 * institute's {@code EMAIL_SETTING.data.<type>} node so both the send path
 * ({@code EmailService.getMailSenderConfig}) and the admin UI agree on whether a
 * sender is usable.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailSenderVerificationService {

    static final String MODE_EMAIL = "EMAIL";
    static final String MODE_DOMAIN = "DOMAIN";

    static final String STATUS_NOT_STARTED = "NOT_STARTED";
    static final String STATUS_PENDING = "PENDING";
    static final String STATUS_VERIFIED = "VERIFIED";

    private final SesIdentityService sesIdentityService;
    private final InstituteInternalService instituteInternalService;
    private final EmailAddressMappingRepository emailAddressMappingRepository;
    private final ObjectMapper objectMapper;

    public boolean isEnabled() {
        return sesIdentityService.isEnabled();
    }

    /**
     * Initiate (or re-initiate) SES verification for a sender and persist the sender +
     * its PENDING verification state into EMAIL_SETTING.
     */
    public SenderVerificationResponse verifySender(String instituteId, SenderVerificationRequest request, String authToken) {
        if (!sesIdentityService.isEnabled()) {
            return disabledResponse(request != null ? request.getType() : null,
                    request != null ? request.getEmail() : null);
        }
        if (request == null || !StringUtils.hasText(request.getEmail())) {
            throw new IllegalArgumentException("Email address is required");
        }
        if (!StringUtils.hasText(request.getType())) {
            throw new IllegalArgumentException("Email type is required");
        }

        String email = request.getEmail().trim();
        String type = request.getType().trim();
        String name = request.getName() != null ? request.getName().trim() : "";
        String mode = normalizeMode(request.getMode());
        String domain = extractDomain(email);
        if (mode.equals(MODE_DOMAIN) && !StringUtils.hasText(domain)) {
            throw new IllegalArgumentException("Cannot derive a domain from email: " + email);
        }

        // 1) Fire the AWS verification and collect any DNS records the institute must publish.
        List<DnsRecordDTO> dnsRecords = null;
        String identity;
        if (mode.equals(MODE_DOMAIN)) {
            identity = domain;
            dnsRecords = sesIdentityService.verifyDomain(domain);
        } else {
            identity = email;
            sesIdentityService.verifyEmailIdentity(email);
        }

        // 2) Persist sender + PENDING verification state into EMAIL_SETTING.data.<type>.
        // Upgrading an already-working address to domain (DKIM) verification must not
        // interrupt sending: SES still accepts mail from an address whose own identity is
        // verified, so the send path stays on the custom sender while DNS propagates.
        boolean stillSendable = mode.equals(MODE_DOMAIN) && emailIdentityVerified(email);
        persistSenderVerificationState(instituteId, type, email, name, mode, identity,
                STATUS_PENDING, stillSendable, authToken);

        // 3) Keep inbound routing table in sync.
        upsertMapping(instituteId, email, type);

        return SenderVerificationResponse.builder()
                .enabled(true)
                .type(type)
                .email(email)
                .identity(identity)
                .mode(mode)
                .status(STATUS_PENDING)
                .verified(stillSendable)
                .message(messageFor(mode, STATUS_PENDING, email, domain)
                        + (stillSendable ? " Sending continues from " + email + " in the meantime." : ""))
                .dnsRecords(dnsRecords)
                .build();
    }

    /**
     * Re-check the live SES status for a sender and, if it flipped, persist the change
     * (so the send path immediately starts/stops using the custom sender).
     */
    public SenderVerificationResponse getStatus(String instituteId, String emailType, String authToken) {
        if (!sesIdentityService.isEnabled()) {
            return disabledResponse(emailType, null);
        }

        InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
        JsonNode configNode = readConfigNode(institute, emailType);
        if (configNode == null) {
            return SenderVerificationResponse.builder()
                    .enabled(true)
                    .type(emailType)
                    .status(STATUS_NOT_STARTED)
                    .verified(false)
                    .message("No sender configured for this type yet.")
                    .build();
        }

        String storedMode = normalizeMode(configNode.path(NotificationConstants.VERIFICATION_MODE).asText(MODE_EMAIL));
        String email = extractEmail(configNode.path(NotificationConstants.FROM).asText(""));
        String identity = configNode.path(NotificationConstants.VERIFICATION_IDENTITY).asText(
                storedMode.equals(MODE_DOMAIN) ? extractDomain(email) : email);
        String storedStatus = configNode.path(NotificationConstants.VERIFICATION_STATUS).asText(STATUS_NOT_STARTED);

        String liveStatus = StringUtils.hasText(identity)
                ? sesIdentityService.getStatus(identity)
                : STATUS_NOT_STARTED;
        boolean verified = STATUS_VERIFIED.equals(liveStatus);
        // Domain verification still pending: fall back to the address identity so a refresh
        // never flips a sender that SES is perfectly willing to send from back to the default.
        if (!verified && storedMode.equals(MODE_DOMAIN)) {
            verified = emailIdentityVerified(email);
        }

        // Persist only when the status actually changed, to avoid a settings write on every poll.
        if (!liveStatus.equals(storedStatus)) {
            persistSenderVerificationState(instituteId, emailType, email,
                    extractName(configNode.path(NotificationConstants.FROM).asText("")),
                    storedMode, identity, liveStatus, verified, authToken);
        }

        List<DnsRecordDTO> dnsRecords = null;
        if (storedMode.equals(MODE_DOMAIN) && !verified && StringUtils.hasText(identity)) {
            try {
                dnsRecords = sesIdentityService.getDkimRecords(identity);
            } catch (Exception e) {
                log.warn("Could not fetch DKIM records for {}: {}", identity, e.getMessage());
            }
        }

        return SenderVerificationResponse.builder()
                .enabled(true)
                .type(emailType)
                .email(email)
                .identity(identity)
                .mode(storedMode)
                .status(liveStatus)
                .verified(verified)
                .message(messageFor(storedMode, liveStatus, email, extractDomain(email)))
                .dnsRecords(dnsRecords)
                .build();
    }

    // ----------------------------------------------------------------------------------

    private void persistSenderVerificationState(String instituteId, String type, String email, String name,
                                                String mode, String identity, String status, boolean verified,
                                                String authToken) {
        try {
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null) {
                throw new IllegalArgumentException("Institute not found: " + instituteId);
            }
            String currentSettings = institute.getSetting();
            if (!StringUtils.hasText(currentSettings)) {
                currentSettings = "{}";
            }

            ObjectNode root = (ObjectNode) objectMapper.readTree(currentSettings);
            ObjectNode dataNode = ensureEmailDataNode(root);

            ObjectNode configNode = dataNode.has(type) && dataNode.get(type).isObject()
                    ? (ObjectNode) dataNode.get(type)
                    : objectMapper.createObjectNode();

            // Only write the from-address when the node has none yet (i.e. we're creating it).
            // For an existing sender we preserve whatever display name it already stores, so
            // verifying/refreshing never silently rewrites the "Name <email>" a user chose.
            if (!StringUtils.hasText(configNode.path(NotificationConstants.FROM).asText(""))) {
                String fromValue = StringUtils.hasText(name) ? (name + " <" + email + ">") : email;
                configNode.put(NotificationConstants.FROM, fromValue);
            }

            // Only seed placeholder SMTP creds when none exist, so we don't clobber an
            // institute that genuinely uses its own SMTP server. Placeholders route the
            // send through the shared SES SMTP account with this verified from-address.
            if (!configNode.has(NotificationConstants.HOST)) {
                configNode.put(NotificationConstants.HOST, "smtp.gmail.com");
            }
            if (!configNode.has(NotificationConstants.PORT)) {
                configNode.put(NotificationConstants.PORT, 587);
            }
            if (!configNode.has(NotificationConstants.USERNAME)) {
                configNode.put(NotificationConstants.USERNAME, "SMTP_USERNAME");
            }
            if (!configNode.has(NotificationConstants.PASSWORD)) {
                configNode.put(NotificationConstants.PASSWORD, "SMTP_PASSWORD");
            }

            // verification metadata
            configNode.put(NotificationConstants.VERIFICATION_MODE, mode);
            configNode.put(NotificationConstants.VERIFICATION_IDENTITY, identity);
            configNode.put(NotificationConstants.VERIFICATION_STATUS, status);
            configNode.put(NotificationConstants.VERIFIED, verified);
            if (verified) {
                configNode.put(NotificationConstants.VERIFIED_AT, System.currentTimeMillis());
            }

            dataNode.set(type, configNode);

            String updated = objectMapper.writeValueAsString(root);
            boolean persisted = instituteInternalService.updateInstituteSettings(instituteId, updated, authToken);
            if (!persisted) {
                log.warn("Failed to persist sender verification state for institute {} type {}", instituteId, type);
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error persisting sender verification state (institute={}, type={})", instituteId, type, e);
            throw new RuntimeException("Failed to save verification state: " + e.getMessage(), e);
        }
    }

    private ObjectNode ensureEmailDataNode(ObjectNode root) {
        if (!root.has(NotificationConstants.SETTING) || !root.get(NotificationConstants.SETTING).isObject()) {
            root.set(NotificationConstants.SETTING, objectMapper.createObjectNode());
        }
        ObjectNode setting = (ObjectNode) root.get(NotificationConstants.SETTING);
        if (!setting.has(NotificationConstants.EMAIL_SETTING) || !setting.get(NotificationConstants.EMAIL_SETTING).isObject()) {
            setting.set(NotificationConstants.EMAIL_SETTING, objectMapper.createObjectNode());
        }
        ObjectNode emailSetting = (ObjectNode) setting.get(NotificationConstants.EMAIL_SETTING);
        if (!emailSetting.has(NotificationConstants.DATA) || !emailSetting.get(NotificationConstants.DATA).isObject()) {
            emailSetting.set(NotificationConstants.DATA, objectMapper.createObjectNode());
        }
        return (ObjectNode) emailSetting.get(NotificationConstants.DATA);
    }

    private JsonNode readConfigNode(InstituteInfoDTO institute, String emailType) {
        if (institute == null || !StringUtils.hasText(institute.getSetting())) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(institute.getSetting())
                    .path(NotificationConstants.SETTING)
                    .path(NotificationConstants.EMAIL_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(emailType);
            return node.isMissingNode() ? null : node;
        } catch (Exception e) {
            log.warn("Failed to read email config node for type {}: {}", emailType, e.getMessage());
            return null;
        }
    }

    private void upsertMapping(String instituteId, String email, String type) {
        try {
            if (StringUtils.hasText(email)) {
                emailAddressMappingRepository.upsert(
                        UUID.randomUUID().toString(), email.toLowerCase().trim(), instituteId, type);
            }
        } catch (Exception e) {
            log.warn("Failed to upsert email_address_mapping for {}: {}", email, e.getMessage());
        }
    }

    private SenderVerificationResponse disabledResponse(String type, String email) {
        return SenderVerificationResponse.builder()
                .enabled(false)
                .type(type)
                .email(email)
                .status(STATUS_NOT_STARTED)
                .verified(false)
                .message("Self-serve sender verification is not enabled on this deployment.")
                .build();
    }

    private String normalizeMode(String mode) {
        if (mode != null && mode.trim().equalsIgnoreCase(MODE_DOMAIN)) {
            return MODE_DOMAIN;
        }
        return MODE_EMAIL;
    }

    private String extractDomain(String email) {
        if (email == null) return null;
        int at = email.lastIndexOf('@');
        return at >= 0 && at < email.length() - 1 ? email.substring(at + 1).trim().toLowerCase() : null;
    }

    /** "Name <a@b.com>" -> "a@b.com"; "a@b.com" -> "a@b.com". */
    private String extractEmail(String from) {
        if (from == null) return "";
        String s = from.trim();
        int lt = s.indexOf('<');
        int gt = s.lastIndexOf('>');
        if (lt >= 0 && gt > lt) {
            return s.substring(lt + 1, gt).trim();
        }
        return s;
    }

    /** "Name <a@b.com>" -> "Name"; "a@b.com" -> "". */
    private String extractName(String from) {
        if (from == null) return "";
        String s = from.trim();
        int lt = s.indexOf('<');
        if (lt > 0) {
            return s.substring(0, lt).trim();
        }
        return "";
    }

    /** Whether SES has the single address verified as its own identity (never throws). */
    private boolean emailIdentityVerified(String email) {
        if (!StringUtils.hasText(email)) return false;
        try {
            return STATUS_VERIFIED.equals(sesIdentityService.getStatus(email));
        } catch (Exception e) {
            log.warn("Could not read SES status for address {}: {}", email, e.getMessage());
            return false;
        }
    }

    private String messageFor(String mode, String status, String email, String domain) {
        boolean domainMode = MODE_DOMAIN.equals(mode);
        switch (status) {
            case STATUS_VERIFIED:
                return domainMode
                        ? "Domain " + domain + " is verified — you can send from any address on it."
                        : "Verified — emails will now be sent from " + email + ".";
            case STATUS_PENDING:
                return domainMode
                        ? "Add the DNS records below to " + domain + ". Verification completes automatically once "
                          + "AWS detects them (can take up to ~72 hours). Refresh to re-check."
                        : "AWS sent a confirmation email to " + email + ". Open it and click the verification link, "
                          + "then refresh. Until then, mail is sent from the platform default address.";
            case "FAILED":
                return domainMode
                        ? "Domain verification failed. Re-check the DNS records and try again."
                        : "Verification failed or expired. Re-send the confirmation email and try again.";
            default:
                return "Not verified yet.";
        }
    }
}
