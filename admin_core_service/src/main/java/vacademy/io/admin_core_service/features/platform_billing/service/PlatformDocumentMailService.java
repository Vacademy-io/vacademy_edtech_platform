package vacademy.io.admin_core_service.features.platform_billing.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService.PlatformBillingEmail;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService.PlatformDocumentType;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.logging.SentryLogger;

import java.util.ArrayList;
import java.util.List;

/**
 * Emails a platform tax invoice or credit note to the buying institute, with every brand rule
 * applied (owner decisions D1/D2):
 *
 * <ul>
 *   <li>Brand mode: the one frozen on the document, else the payment's, else the institute's.</li>
 *   <li>Links go to the institute's own admin host ({@code admin_portal_base_url}). A NEUTRAL
 *       institute never gets a Vacademy-owned link: with no own host the link is left out.
 *       A VACADEMY institute without one gets {@code https://dash.vacademy.io}.</li>
 *   <li>Sender ({@link NeutralSender}): NEUTRAL uses {@code platform_payment_config.billing_from_email}
 *       with {@code billing_from_name} when set (no attachment possible on that path, so the email
 *       links to the PDF instead); otherwise the institute's own UTILITY_EMAIL sender with the PDF
 *       attached, as for packs, but only when that sender exists and is brand-free. With neither,
 *       the email is NOT sent (notification_service would send it as "Vacademy Support"): the
 *       document stays in the Billing tab and staff are alerted.</li>
 *   <li>Recipients: the institute email and the billing email of
 *       {@code platform_billing_profile}, de-duplicated.</li>
 * </ul>
 *
 * Never throws: a failed email is logged and reported as false, so it can run after the payment
 * is committed without affecting it.
 */
@Slf4j
@Service
public class PlatformDocumentMailService {

    static final String BILLING_PATH = "/settings?selectedTab=aiSettings&aiSection=grp-plan";
    static final String VACADEMY_ADMIN_FALLBACK = "https://dash.vacademy.io";
    static final String SELECT_BILLING_EMAIL =
            "SELECT billing_email FROM platform_billing_profile WHERE institute_id = ?";

    private final InstituteRepository instituteRepository;
    private final PlatformPaymentConfigService configService;
    private final BrandModeService brandModeService;
    private final PlatformInvoicePdfService pdfService;
    private final PaymentNotificatonService notificationService;
    private final PlatformInvoiceLineItemRepository lineItemRepository;
    private final PlatformPaymentRepository paymentRepository;
    private final JdbcTemplate jdbcTemplate;

    public PlatformDocumentMailService(
            InstituteRepository instituteRepository,
            PlatformPaymentConfigService configService,
            BrandModeService brandModeService,
            PlatformInvoicePdfService pdfService,
            PaymentNotificatonService notificationService,
            PlatformInvoiceLineItemRepository lineItemRepository,
            PlatformPaymentRepository paymentRepository,
            JdbcTemplate jdbcTemplate) {
        this.instituteRepository = instituteRepository;
        this.configService = configService;
        this.brandModeService = brandModeService;
        this.pdfService = pdfService;
        this.notificationService = notificationService;
        this.lineItemRepository = lineItemRepository;
        this.paymentRepository = paymentRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean sendInvoiceEmail(PlatformInvoice inv) {
        try {
            PlatformPayment payment = paymentRepository.findById(inv.getPlatformPaymentId()).orElse(null);
            BrandMode mode = brandModeService.resolve(inv.getBuyerInstituteId(),
                    StringUtils.hasText(inv.getBrandMode()) ? inv.getBrandMode()
                            : (payment == null ? null : payment.getBrandMode()));
            List<PlatformInvoiceLineItem> lines = lineItemRepository.findByPlatformInvoiceId(inv.getId());
            String description = lines.isEmpty() ? null : lines.get(0).getDescription();
            byte[] pdf = renderSafely(() -> pdfService.renderPdf(inv), inv.getInvoiceNumber());
            String kind = inv.getSourceKind() == null ? PlatformPaymentItemKind.CREDIT_PACK.name()
                    : inv.getSourceKind().name();
            return send(inv.getBuyerInstituteId(), mode, PlatformBillingEmail.builder()
                    .documentType(PlatformDocumentType.INVOICE)
                    .itemKind(kind)
                    .documentNumber(inv.getInvoiceNumber())
                    .description(description)
                    .amountDisplay(PlatformInvoicePdfService.money(inv.getTotalAmountMinor(), inv.getCurrency()))
                    .servicePeriod(PlatformInvoicePdfService.servicePeriodText(
                            inv.getServicePeriodStart(), inv.getServicePeriodEnd()))
                    .pdf(pdf)
                    .pdfFileName(pdfService.fileName(inv)));
        } catch (Exception e) {
            log.error("Invoice email failed for {}: {}", inv.getInvoiceNumber(), e.getMessage(), e);
            return false;
        }
    }

    public boolean sendCreditNoteEmail(PlatformCreditNote cn) {
        try {
            PlatformPayment payment = paymentRepository.findById(cn.getPlatformPaymentId()).orElse(null);
            BrandMode mode = brandModeService.resolve(cn.getBuyerInstituteId(),
                    StringUtils.hasText(cn.getBrandMode()) ? cn.getBrandMode()
                            : (payment == null ? null : payment.getBrandMode()));
            byte[] pdf = renderSafely(() -> pdfService.renderCreditNotePdf(cn), cn.getCreditNoteNumber());
            return send(cn.getBuyerInstituteId(), mode, PlatformBillingEmail.builder()
                    .documentType(PlatformDocumentType.CREDIT_NOTE)
                    .itemKind(cn.getItemKind() == null ? PlatformPaymentItemKind.CREDIT_PACK.name() : cn.getItemKind().name())
                    .documentNumber(cn.getCreditNoteNumber())
                    .againstInvoiceNumber(cn.getInvoiceNumber())
                    .description(cn.getDescription())
                    .reason(cn.getReason())
                    .amountDisplay(PlatformInvoicePdfService.money(cn.getTotalAmountMinor(), cn.getCurrency()))
                    .pdf(pdf)
                    .pdfFileName(pdfService.fileName(cn)));
        } catch (Exception e) {
            log.error("Credit note email failed for {}: {}", cn.getCreditNoteNumber(), e.getMessage(), e);
            return false;
        }
    }

    private boolean send(String instituteId, BrandMode mode, PlatformBillingEmail.PlatformBillingEmailBuilder b) {
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        List<String> recipients = recipients(instituteId, institute);
        if (recipients.isEmpty()) {
            log.warn("Platform billing email skipped: institute {} has no email address", instituteId);
            return false;
        }
        PlatformPaymentConfig cfg = null;
        try {
            cfg = configService.load();
        } catch (Exception e) {
            log.debug("platform_payment_config unavailable: {}", e.getMessage());
        }
        boolean vacademy = mode == BrandMode.VACADEMY;
        NeutralSender.Sender sender = null;
        if (!vacademy) {
            sender = NeutralSender.resolve(cfg, institute, brandModeService::isVacademyOwnedHost).orElse(null);
            if (sender == null) {
                log.warn("Platform billing email withheld for institute {}: no neutral sender (set "
                        + "billing_from_email / billing_from_name, or the institute's own UTILITY_EMAIL sender)", instituteId);
                SentryLogger.logWarning(
                        "NEUTRAL billing document email withheld: no neutral sender configured",
                        java.util.Map.of("institute.id", String.valueOf(instituteId)));
                return false;
            }
        }
        String linkBase = brandModeService.adminLinkBase(
                institute == null ? null : institute.getAdminPortalBaseUrl(), mode);
        if (linkBase == null && vacademy) {
            linkBase = VACADEMY_ADMIN_FALLBACK;
        }
        PlatformBillingEmail email = b
                .instituteId(instituteId)
                .instituteName(institute == null ? null : institute.getInstituteName())
                .recipients(recipients)
                .brandMode(mode)
                .billingLink(linkBase == null ? null : linkBase + BILLING_PATH)
                .tradeName(vacademy && cfg != null && StringUtils.hasText(cfg.getTradeName()) ? cfg.getTradeName()
                        : (vacademy ? "Vacademy" : null))
                .supportEmail(cfg == null ? null : supportEmailFor(cfg.getBillingSupportEmail(), mode))
                .fromName(sender == null ? null : sender.fromName())
                .fromEmail(sender == null ? null : sender.fromEmail())
                .build();
        return notificationService.sendPlatformBillingEmail(email) > 0;
    }

    /** A NEUTRAL email never shows a Vacademy-domain support address. */
    String supportEmailFor(String configured, BrandMode mode) {
        if (!StringUtils.hasText(configured)) {
            return null;
        }
        String c = configured.trim();
        if (mode == BrandMode.NEUTRAL) {
            int at = c.lastIndexOf('@');
            String host = at < 0 ? null : c.substring(at + 1);
            if (host == null || brandModeService.isVacademyOwnedHost(host)
                    || c.toLowerCase(java.util.Locale.ROOT).contains("vacademy")) {
                return null;
            }
        }
        return c;
    }

    /** A sender name for NEUTRAL mail; dropped when it carries the platform brand. */
    static String neutralText(String s) {
        if (!StringUtils.hasText(s) || s.toLowerCase(java.util.Locale.ROOT).contains("vacademy")) {
            return null;
        }
        return s.trim();
    }

    List<String> recipients(String instituteId, Institute institute) {
        List<String> out = new ArrayList<>();
        if (institute != null && StringUtils.hasText(institute.getEmail())) {
            out.add(institute.getEmail().trim());
        }
        try {
            List<String> rows = jdbcTemplate.queryForList(SELECT_BILLING_EMAIL, String.class, instituteId);
            for (String r : rows) {
                if (StringUtils.hasText(r) && out.stream().noneMatch(x -> x.equalsIgnoreCase(r.trim()))) {
                    out.add(r.trim());
                }
            }
        } catch (Exception e) {
            log.debug("platform_billing_profile unavailable for {}: {}", instituteId, e.getMessage());
        }
        return out;
    }

    private interface PdfRender {
        byte[] render();
    }

    private byte[] renderSafely(PdfRender r, String number) {
        try {
            return r.render();
        } catch (Exception e) {
            log.error("PDF render failed for {} — emailing without attachment: {}", number, e.getMessage());
            return null;
        }
    }
}
