package vacademy.io.admin_core_service.features.suborg.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.certificate.entity.IssuedCertificate;
import vacademy.io.admin_core_service.features.certificate.repository.IssuedCertificateRepository;
import vacademy.io.admin_core_service.features.certificate.service.CertificateSettingsResolver;
import vacademy.io.admin_core_service.features.common.util.PostalAddressFormatter;
import vacademy.io.admin_core_service.features.institute.dto.CertificationGenerationRequest;
import vacademy.io.admin_core_service.features.certificate.dto.ResolvedCertificateConfig;
import vacademy.io.admin_core_service.features.institute.enums.CertificateTypeEnum;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateVariables;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.enums.CommunicationType;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.SendUniqueLinkService;
import vacademy.io.admin_core_service.features.notification_service.utils.StripeInvoiceEmailBody;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.common.auth.dto.UserCredentials;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;

import java.io.InputStream;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Base64;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * What happens the moment a channel partner's (sub-org's) subscription becomes ACTIVE —
 * paid via the gateway webhook, or free at registration:
 *
 * <ol>
 *   <li>issue the partner a Certificate of Affiliation, when the institute has enabled one
 *       (CERTIFICATE_SETTING entry {@code SUB_ORG_AFFILIATION}); and</li>
 *   <li>send the admin ONE welcome email — login details, the admin-portal link, and the
 *       certificate PDF attached — when the institute has opted in
 *       ({@code SUB_ORG_ONBOARDING_SETTING.sendWelcomeEmail}).</li>
 * </ol>
 *
 * <p>Both are opt-in and both are best-effort: nothing here may fail the payment or the
 * enrollment that triggered it. The credentials mail exists because the learner-facing
 * {@code showSendCredentials} toggle also silences the partner admin's credential mail, so an
 * institute that turned that off for learners shipped its partners no password at all.
 *
 * <p>Dependencies are injected lazily: this service hangs off the payment/enrollment paths,
 * which the certificate and notification services also reach — eager construction would
 * risk a cycle at boot.
 */
@Slf4j
@Service
public class SubOrgPartnerOnboardingService {

    public static final String ONBOARDING_SETTING_KEY = "SUB_ORG_ONBOARDING_SETTING";
    static final String WELCOME_EMAIL_FLAG = "sendWelcomeEmail";
    private static final String ROOT_ADMIN = "ROOT_ADMIN";
    private static final String ACTIVE = "ACTIVE";
    private static final SimpleDateFormat DISPLAY_DATE = new SimpleDateFormat("dd MMM yyyy", Locale.ENGLISH);

    @Autowired private InstituteRepository instituteRepository;
    @Autowired private StudentSessionInstituteGroupMappingRepository mappingRepository;
    @Autowired private IssuedCertificateRepository issuedCertificateRepository;
    @Autowired @Lazy private CertificateSettingsResolver certificateSettingsResolver;
    @Autowired @Lazy private InstituteSettingService instituteSettingService;
    @Autowired @Lazy private DynamicNotificationService dynamicNotificationService;
    @Autowired @Lazy private SendUniqueLinkService sendUniqueLinkService;
    @Autowired @Lazy private NotificationService notificationService;
    @Autowired @Lazy private AuthService authService;
    @Autowired @Lazy private MediaService mediaService;

    /**
     * Entry point for both activation paths. Never throws.
     *
     * @param subOrgId          the partner's own (spawned) institute id
     * @param parentInstituteId the institute the partner belongs to — whose branding, settings
     *                          and templates apply
     * @param plan              the partner's now-active UserPlan (validity comes from its end date)
     */
    public void onPartnerActivated(String subOrgId, String parentInstituteId, UserPlan plan) {
        try {
            if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId) || plan == null
                    || !StringUtils.hasText(plan.getUserId())) {
                return;
            }
            Institute parent = instituteRepository.findById(parentInstituteId).orElse(null);
            Institute org = instituteRepository.findById(subOrgId).orElse(null);
            if (parent == null || org == null) {
                return;
            }

            boolean welcomeEnabled = isWelcomeEmailEnabled(parent);
            ResolvedCertificateConfig certificateConfig = certificateSettingsResolver.resolve(
                    parent, null, CertificateTypeEnum.SUB_ORG_AFFILIATION.name());
            boolean certificateEnabled = certificateConfig != null && certificateConfig.isEnabled()
                    && StringUtils.hasText(certificateConfig.getTemplateHtml());
            if (!welcomeEnabled && !certificateEnabled) {
                return;
            }

            StudentSessionInstituteGroupMapping mapping = resolveAdminMapping(subOrgId, plan.getUserId());
            if (mapping == null) {
                log.warn("Partner onboarding for sub-org {} skipped: no ACTIVE mapping for admin {}",
                        subOrgId, plan.getUserId());
                return;
            }

            UserDTO admin = loadUser(plan.getUserId());
            Date validTill = resolveValidTill(plan);

            IssuedCertificate certificate = null;
            byte[] certificatePdf = null;
            if (certificateEnabled) {
                certificate = issueAffiliationCertificate(parent, org, admin, mapping, certificateConfig, validTill);
                if (certificate != null) {
                    certificatePdf = downloadPdf(certificate.getFileId());
                }
            }

            if (welcomeEnabled) {
                sendWelcomeEmail(parent, org, admin, certificate, certificatePdf, validTill);
            }
        } catch (Exception e) {
            log.error("Partner onboarding failed for sub-org {} (institute {}): {}", subOrgId, parentInstituteId,
                    e.getMessage(), e);
        }
    }

    // ------------------------------------------------------------------ certificate

    private IssuedCertificate issueAffiliationCertificate(Institute parent, Institute org, UserDTO admin,
            StudentSessionInstituteGroupMapping mapping, ResolvedCertificateConfig config, Date validTill) {
        try {
            Map<String, String> tokens = new HashMap<>();
            tokens.put("{{ORG_NAME}}", safe(org.getInstituteName()));
            tokens.put("{{ORG_ADDRESS}}", PostalAddressFormatter.compose(org.getAddress(), org.getCity(),
                    org.getState(), org.getPinCode(), org.getCountry()).replace("\n", ", "));
            tokens.put("{{VALID_TILL}}", validTill != null ? formatDate(validTill) : "");
            tokens.put("{{ADMIN_NAME}}", admin != null ? safe(admin.getFullName()) : "");

            CertificationGenerationRequest request = CertificationGenerationRequest.builder()
                    .completionDate(new Date())
                    .courseName(safe(org.getInstituteName()))
                    .build();
            Optional<FileDetailsDTO> file = instituteSettingService.issueCertificateForMapping(
                    config.getTemplateHtml(), mapping, request, config,
                    CertificateTypeEnum.SUB_ORG_AFFILIATION.name(), tokens);
            if (file.isEmpty()) {
                log.warn("Affiliation certificate for sub-org {} did not render", org.getId());
                return null;
            }
            String packageSessionId = mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null;
            return issuedCertificateRepository
                    .findFirstByUserIdAndPackageSessionIdAndCertificateTypeOrderByIssuedAtDesc(
                            mapping.getUserId(), packageSessionId, CertificateTypeEnum.SUB_ORG_AFFILIATION.name())
                    .orElse(null);
        } catch (Exception e) {
            log.error("Affiliation certificate failed for sub-org {}: {}", org.getId(), e.getMessage(), e);
            return null;
        }
    }

    /** The partner admin's ROOT_ADMIN mapping inside the sub-org; any active mapping as a fallback. */
    private StudentSessionInstituteGroupMapping resolveAdminMapping(String subOrgId, String userId) {
        List<StudentSessionInstituteGroupMapping> mappings =
                mappingRepository.findBySubOrg_IdAndUserIdAndStatusOrderByCreatedAtAsc(subOrgId, userId, ACTIVE);
        if (mappings == null || mappings.isEmpty()) {
            return null;
        }
        return mappings.stream()
                .filter(m -> m.getCommaSeparatedOrgRoles() != null && m.getCommaSeparatedOrgRoles().contains(ROOT_ADMIN))
                .findFirst()
                .orElse(mappings.get(0));
    }

    /**
     * Validity printed on the certificate = the plan's own end date. When the plan carries none
     * (some FREE plans), fall back to the payment plan's validity in days from today; null when
     * neither exists, and the template's VALID TILL simply stays blank.
     */
    private Date resolveValidTill(UserPlan plan) {
        if (plan.getEndDate() != null) {
            return plan.getEndDate();
        }
        try {
            if (plan.getPaymentPlan() != null && plan.getPaymentPlan().getValidityInDays() != null
                    && plan.getPaymentPlan().getValidityInDays() > 0) {
                Calendar c = Calendar.getInstance();
                c.setTime(plan.getStartDate() != null ? plan.getStartDate() : new Date());
                c.add(Calendar.DAY_OF_MONTH, plan.getPaymentPlan().getValidityInDays());
                return c.getTime();
            }
        } catch (Exception ignored) {
            // lazy payment plan not resolvable — no validity
        }
        return null;
    }

    private byte[] downloadPdf(String fileId) {
        if (!StringUtils.hasText(fileId)) {
            return null;
        }
        try {
            String url = mediaService.getFileUrlById(fileId);
            if (!StringUtils.hasText(url)) {
                return null;
            }
            try (InputStream in = new URL(url).openStream()) {
                return in.readAllBytes();
            }
        } catch (Exception e) {
            log.warn("Could not fetch certificate PDF {} for the welcome email: {}", fileId, e.getMessage());
            return null;
        }
    }

    // ------------------------------------------------------------------ welcome email

    private void sendWelcomeEmail(Institute parent, Institute org, UserDTO admin,
            IssuedCertificate certificate, byte[] certificatePdf, Date validTill) {
        try {
            if (admin == null || !StringUtils.hasText(admin.getEmail())) {
                log.warn("Partner welcome email for sub-org {} skipped: admin has no email", org.getId());
                return;
            }
            Template template = resolveTemplate(parent.getId());
            if (template == null || !StringUtils.hasText(template.getContent())) {
                log.warn("Partner welcome email for sub-org {} skipped: no SUB_ORG_PARTNER_WELCOME template", org.getId());
                return;
            }
            UserCredentials credentials = loadCredentials(admin.getId());
            if (credentials == null || !StringUtils.hasText(credentials.getUsername())) {
                log.warn("Partner welcome email for sub-org {} skipped: no credentials on file", org.getId());
                return;
            }

            NotificationTemplateVariables vars = buildVariables(parent, org, admin, credentials, certificate, validTill);
            Map<String, String> variables = sendUniqueLinkService.buildVariablesMap(template, vars);
            String body = applyVariables(template.getContent(), variables);
            String subject = StringUtils.hasText(template.getSubject())
                    ? applyVariables(template.getSubject(), variables)
                    : "Welcome to " + safe(parent.getInstituteName());
            String source = NotificationEventType.SUB_ORG_PARTNER_WELCOME.getValue();

            if (certificatePdf != null && certificatePdf.length > 0) {
                AttachmentUsersDTO.AttachmentDTO attachment = new AttachmentUsersDTO.AttachmentDTO();
                attachment.setAttachmentName("certificate_of_affiliation_"
                        + (certificate != null && StringUtils.hasText(certificate.getCertificateId())
                                ? certificate.getCertificateId().replaceAll("[^A-Za-z0-9._-]", "_")
                                : org.getId()) + ".pdf");
                attachment.setAttachment(Base64.getEncoder().encodeToString(certificatePdf));

                AttachmentUsersDTO toUser = new AttachmentUsersDTO();
                toUser.setUserId(admin.getId());
                toUser.setChannelId(admin.getEmail());
                toUser.setPlaceholders(new HashMap<>());
                toUser.setAttachments(List.of(attachment));

                AttachmentNotificationDTO dto = AttachmentNotificationDTO.builder()
                        .body(body)
                        .subject(subject)
                        .notificationType(CommunicationType.EMAIL.name())
                        .source(source)
                        .sourceId(org.getId())
                        .users(List.of(toUser))
                        .build();
                notificationService.sendAttachmentEmailViaUnified(List.of(dto), parent.getId());
            } else {
                NotificationDTO dto = new NotificationDTO();
                dto.setBody(body);
                dto.setSubject(subject);
                dto.setNotificationType(CommunicationType.EMAIL.name());
                dto.setSource(source);
                dto.setSourceId(org.getId());
                NotificationToUserDTO toUser = new NotificationToUserDTO();
                toUser.setUserId(admin.getId());
                toUser.setChannelId(admin.getEmail());
                toUser.setPlaceholders(new HashMap<>());
                dto.setUsers(List.of(toUser));
                notificationService.sendEmailViaUnified(dto, parent.getId());
            }
            log.info("Partner welcome email sent for sub-org {} to {} (certificate attached: {})",
                    org.getId(), admin.getEmail(), certificatePdf != null);
        } catch (Exception e) {
            log.error("Partner welcome email failed for sub-org {}: {}", org.getId(), e.getMessage(), e);
        }
    }

    private NotificationTemplateVariables buildVariables(Institute parent, Institute org, UserDTO admin,
            UserCredentials credentials, IssuedCertificate certificate, Date validTill) {
        String logoUrl = StringUtils.hasText(parent.getLogoFileId())
                ? mediaService.getFileUrlById(parent.getLogoFileId()) : null;
        String portal = normalizePortalUrl(parent.getAdminPortalBaseUrl());
        String issueDate = certificate != null && certificate.getIssuedAt() != null
                ? formatDate(certificate.getIssuedAt()) : "";
        // The same date the certificate printed as VALID TILL; blank when no certificate went out.
        String validTillText = certificate != null && validTill != null ? formatDate(validTill) : "";

        String certificateNote = "";
        if (certificate != null && StringUtils.hasText(certificate.getCertificateId())) {
            certificateNote = "<p>Your <strong>Certificate of Affiliation</strong> (No. "
                    + escape(certificate.getCertificateId()) + ")"
                    + (StringUtils.hasText(validTillText) ? ", valid till " + escape(validTillText) + "," : "")
                    + " is attached to this email.</p>";
        }

        return NotificationTemplateVariables.builder()
                .userId(admin.getId())
                .userEmail(safe(admin.getEmail()))
                .userMobile(safe(admin.getMobileNumber()))
                .userFullName(safe(admin.getFullName()))
                .name(safe(admin.getFullName()))
                .userName(safe(credentials.getUsername()))
                .userPassword(safe(credentials.getPassword()))
                .portalUrl(safe(portal))
                .organisationName(safe(org.getInstituteName()))
                .organisationAddress(PostalAddressFormatter.compose(org.getAddress(), org.getCity(), org.getState(),
                        org.getPinCode(), org.getCountry()).replace("\n", ", "))
                .certificateNumber(certificate != null ? safe(certificate.getCertificateId()) : "")
                .certificateIssueDate(issueDate)
                .certificateValidTill(validTillText)
                .certificateNote(certificateNote)
                .instituteId(parent.getId())
                .instituteName(safe(parent.getInstituteName()))
                .instituteAddress(safe(parent.getAddress()))
                .instituteEmail(safe(parent.getEmail()))
                .instituteWebsite(safe(parent.getWebsiteUrl()))
                .instituteLogoUrl(safe(logoUrl))
                // Sized on the tag itself — mail clients that drop <style> would otherwise show a
                // print-resolution logo at full size (see V516).
                .instituteLogo(StringUtils.hasText(logoUrl)
                        ? "<img src=\"" + logoUrl + "\" alt=\"" + escape(safe(parent.getInstituteName()))
                                + "\" width=\"120\" style=\"display: block; margin: 0 auto; width: 120px; height: auto;\" />"
                        : "")
                .themeColor(StripeInvoiceEmailBody.getThemeColorHex(parent.getInstituteThemeCode()))
                .year(String.valueOf(Calendar.getInstance().get(Calendar.YEAR)))
                .build();
    }

    private Template resolveTemplate(String instituteId) {
        Optional<NotificationEventConfig> config = dynamicNotificationService.findEventConfig(
                NotificationEventType.SUB_ORG_PARTNER_WELCOME, instituteId, NotificationTemplateType.EMAIL);
        return config.map(c -> dynamicNotificationService.resolveTemplate(c, instituteId)).orElse(null);
    }

    // ------------------------------------------------------------------ settings + helpers

    /** {@code SUB_ORG_ONBOARDING_SETTING.data.sendWelcomeEmail}; absent = false (opt-in). */
    boolean isWelcomeEmailEnabled(Institute institute) {
        try {
            Object data = instituteSettingService.getSettingData(institute, ONBOARDING_SETTING_KEY);
            if (data instanceof Map<?, ?> map) {
                return Boolean.TRUE.equals(map.get(WELCOME_EMAIL_FLAG))
                        || "true".equalsIgnoreCase(String.valueOf(map.get(WELCOME_EMAIL_FLAG)));
            }
        } catch (Exception e) {
            log.warn("Could not read {} for institute {}: {}", ONBOARDING_SETTING_KEY, institute.getId(), e.getMessage());
        }
        return false;
    }

    private UserDTO loadUser(String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            return users != null && !users.isEmpty() ? users.get(0) : null;
        } catch (Exception e) {
            log.warn("Could not load partner admin {}: {}", userId, e.getMessage());
            return null;
        }
    }

    private UserCredentials loadCredentials(String userId) {
        try {
            List<UserCredentials> creds = authService.getUsersCredentials(List.of(userId));
            return creds != null && !creds.isEmpty() ? creds.get(0) : null;
        } catch (Exception e) {
            log.warn("Could not load credentials for partner admin {}: {}", userId, e.getMessage());
            return null;
        }
    }

    private static String applyVariables(String content, Map<String, String> variables) {
        if (!StringUtils.hasText(content)) {
            return content;
        }
        String filled = content;
        for (Map.Entry<String, String> var : variables.entrySet()) {
            filled = filled.replace("{{" + var.getKey() + "}}", var.getValue() != null ? var.getValue() : "");
        }
        return filled;
    }

    /** Portals are stored bare ("admin.example.org") as often as with a scheme; a mail link needs one. */
    static String normalizePortalUrl(String url) {
        if (!StringUtils.hasText(url)) {
            return "";
        }
        String normalized = url.trim();
        if (!normalized.toLowerCase(Locale.ROOT).startsWith("http://")
                && !normalized.toLowerCase(Locale.ROOT).startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private static String formatDate(Date date) {
        synchronized (DISPLAY_DATE) {
            return DISPLAY_DATE.format(date);
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static String escape(String value) {
        return safe(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
