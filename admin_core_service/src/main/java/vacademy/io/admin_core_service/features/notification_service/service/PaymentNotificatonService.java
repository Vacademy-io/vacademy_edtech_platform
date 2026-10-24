
package vacademy.io.admin_core_service.features.notification_service.service;

import vacademy.io.admin_core_service.features.common.util.TemplateConditionals;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.service.InstituteService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateVariables;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.enums.CommunicationType;
import vacademy.io.admin_core_service.features.notification_service.utils.StripeInvoiceEmailBody;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.logging.SentryLogger;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class PaymentNotificatonService {

    /** Locale-pinned so month names read identically regardless of the host JVM locale. */
    private static final DateTimeFormatter DATE_FORMAT =
            DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);

    @Autowired
    private InstituteService instituteService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private MediaService mediaService;

    @Autowired
    private DynamicNotificationService dynamicNotificationService;

    @Autowired
    private SendUniqueLinkService sendUniqueLinkService;

    @Autowired
    private BillingContactRecipientResolver billingContactRecipientResolver;

    @Autowired
    private InvoiceAdminCopyRecipientResolver invoiceAdminCopyRecipientResolver;

    @Autowired
    private vacademy.io.admin_core_service.features.invoice.util.CourseTagResolver courseTagResolver;

    public boolean sendPaymentConfirmationNotification(
            String instituteId,
            PaymentResponseDTO paymentResponseDTO,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            UserDTO userDTO) {
        return sendPaymentConfirmationNotification(instituteId, paymentResponseDTO,
                paymentInitiationRequestDTO, userDTO, null, null, null, null);
    }

    /**
     * Overload that can attach the invoice PDF directly to the payment-confirmation email.
     * Used when {@code INVOICE_SETTING.invoicePdfPlacement = PAYMENT_CONFIRMATION_EMAIL}, so the
     * learner receives a single mail (confirmation + invoice PDF) instead of two separate emails.
     * When {@code invoicePdfBytes} is null/empty this behaves exactly like the no-attachment path.
     */
    public boolean sendPaymentConfirmationNotification(
            String instituteId,
            PaymentResponseDTO paymentResponseDTO,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            UserDTO userDTO,
            byte[] invoicePdfBytes,
            String invoiceNumber) {
        return sendPaymentConfirmationNotification(instituteId, paymentResponseDTO,
                paymentInitiationRequestDTO, userDTO, invoicePdfBytes, invoiceNumber, null, null);
    }

    /**
     * Full overload. The body comes from whichever template the {@code PAYMENT_CONFIRMATION}
     * event config points at for this institute (falling back to the seeded {@code DEFAULT}
     * config), so an institute changes its confirmation mail by editing a template — no code.
     *
     * <p>{@code paymentLog} is the authoritative source for the money facts. The gateway
     * {@code responseData} cannot be trusted for them: on the live Razorpay webhook path it
     * carries only {@code {"paymentStatus":"PAID"}}, and where it does carry an amount it is in
     * minor units (500000 for ₹5,000). {@code courseName} is resolved by the caller, which holds
     * the InvoiceService that already derives it for the invoice line item.
     *
     * <p>Delivery stays here rather than going through
     * {@code DynamicNotificationService.sendNotificationViaUnifiedApi} because this mail also
     * carries the invoice PDF and copies the billing contact plus any admin-copy recipients,
     * which that single-recipient helper does not model.
     */
    public boolean sendPaymentConfirmationNotification(
            String instituteId,
            PaymentResponseDTO paymentResponseDTO,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            UserDTO userDTO,
            byte[] invoicePdfBytes,
            String invoiceNumber,
            String courseName,
            PaymentLog paymentLog) {
        return sendPaymentConfirmationNotification(instituteId, paymentResponseDTO,
                paymentInitiationRequestDTO, userDTO, invoicePdfBytes, invoiceNumber, courseName,
                paymentLog, null);
    }

    /**
     * What ONE order cost, when that order paid for several courses at once.
     *
     * A multi-course checkout is recorded as one child PaymentLog per course, so
     * the log this email is sent from knows only its own share. Quoting that made
     * a parent who paid ₹949 for four subjects receive four emails each announcing
     * ₹349 — none of which matched their bank. These are the order's figures, so
     * the one email that goes out can state what was actually charged and what
     * was taken off to get there.
     *
     * @param grossAmount   the courses at list price, before any reduction
     * @param discountAmount what the basket price, offer and coupon took off
     * @param paidAmount    what the gateway actually charged
     * @param itemCount     how many courses the order bought
     */
    public record OrderAmountSummary(double grossAmount, double discountAmount, double paidAmount,
            int itemCount) {
        boolean coversMultipleCourses() {
            return itemCount > 1;
        }

        boolean hasDiscount() {
            return discountAmount > 0.005 && grossAmount > paidAmount;
        }
    }

    public boolean sendPaymentConfirmationNotification(
            String instituteId,
            PaymentResponseDTO paymentResponseDTO,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            UserDTO userDTO,
            byte[] invoicePdfBytes,
            String invoiceNumber,
            String courseName,
            PaymentLog paymentLog,
            OrderAmountSummary orderAmounts) {
        if (instituteId == null || paymentResponseDTO == null || paymentInitiationRequestDTO == null
                || userDTO == null) {
            return false;
        }

        Institute institute = instituteService.findById(instituteId);
        if (institute == null || userDTO.getEmail() == null)
            return false;

        if (!isPaymentSuccessful(paymentResponseDTO)) {
            return false;
        }

        Template template = resolvePaymentConfirmationTemplate(instituteId);
        if (template == null || !StringUtils.hasText(template.getContent())) {
            SentryLogger.logError(
                    new IllegalStateException("No PAYMENT_CONFIRMATION email template resolved"),
                    "Payment confirmation email skipped - no institute or DEFAULT config/template",
                    Map.of("instituteId", instituteId, "userId", safe(userDTO.getId())));
            return false;
        }

        // Variables come from the declared NotificationTemplateVariables fields, mapped by
        // SendUniqueLinkService: it emits both {{camelCase}} and {{snake_case}} for every field
        // and overlays the template's own dynamic_parameters for anything left blank.
        NotificationTemplateVariables templateVars = buildPaymentConfirmationVariables(
                institute, userDTO, paymentInitiationRequestDTO, paymentResponseDTO,
                invoiceNumber, courseName, paymentLog, invoicePdfBytes, orderAmounts);
        Map<String, String> variables = withReceiptAliases(
                sendUniqueLinkService.buildVariablesMap(template, templateVars), courseTagResolver.tagsFor(paymentLog));

        String emailBody = applyVariables(template.getContent(), variables);
        String subject = StringUtils.hasText(template.getSubject())
                ? applyVariables(template.getSubject(), variables)
                : "Payment Confirmation from " + institute.getInstituteName();

        String channelId = paymentInitiationRequestDTO.getEmail() == null ? userDTO.getEmail()
                : paymentInitiationRequestDTO.getEmail();
        boolean attachPdf = invoicePdfBytes != null && invoicePdfBytes.length > 0;

        try {
            if (attachPdf) {
                String attachmentName = "invoice_"
                        + (StringUtils.hasText(invoiceNumber) ? invoiceNumber : userDTO.getId()) + ".pdf";
                AttachmentUsersDTO.AttachmentDTO attachmentDTO = new AttachmentUsersDTO.AttachmentDTO();
                attachmentDTO.setAttachmentName(attachmentName);
                attachmentDTO.setAttachment(Base64.getEncoder().encodeToString(invoicePdfBytes));

                AttachmentUsersDTO toUser = new AttachmentUsersDTO();
                toUser.setUserId(userDTO.getId());
                toUser.setChannelId(channelId);
                toUser.setPlaceholders(new HashMap<>());
                toUser.setAttachments(List.of(attachmentDTO));

                List<AttachmentUsersDTO> recipients = new ArrayList<>();
                recipients.add(toUser);
                billingContactRecipientResolver
                        .buildBillingContactAttachmentRecipient(userDTO.getId(), instituteId, channelId,
                                List.of(attachmentDTO))
                        .ifPresent(recipients::add);
                recipients.addAll(invoiceAdminCopyRecipientResolver.buildAdminCopyAttachmentRecipients(
                        instituteId,
                        recipients.stream().map(AttachmentUsersDTO::getChannelId).collect(Collectors.toSet()),
                        List.of(attachmentDTO)));

                AttachmentNotificationDTO attachmentNotification = AttachmentNotificationDTO.builder()
                        .body(emailBody)
                        .subject(subject)
                        .notificationType(CommunicationType.EMAIL.name())
                        .source(NotificationEventType.PAYMENT_CONFIRMATION.getValue())
                        .sourceId(StringUtils.hasText(invoiceNumber) ? invoiceNumber : userDTO.getId())
                        .users(recipients)
                        .build();

                notificationService.sendAttachmentEmailViaUnified(List.of(attachmentNotification), instituteId);
            } else {
                NotificationDTO notificationDTO = new NotificationDTO();
                notificationDTO.setBody(emailBody);
                notificationDTO.setNotificationType(CommunicationType.EMAIL.name());
                notificationDTO.setSubject(subject);
                // Mirrors the attachment path above. Without a source the send carries no event
                // key, so institute-configured CC/BCC copies can never match this trigger.
                notificationDTO.setSource(NotificationEventType.PAYMENT_CONFIRMATION.getValue());

                NotificationToUserDTO notificationToUserDTO = new NotificationToUserDTO();
                notificationToUserDTO.setUserId(userDTO.getId());
                notificationToUserDTO.setChannelId(channelId);
                notificationToUserDTO.setPlaceholders(new HashMap<>());

                List<NotificationToUserDTO> recipients = new ArrayList<>();
                recipients.add(notificationToUserDTO);
                billingContactRecipientResolver
                        .buildBillingContactRecipient(userDTO.getId(), instituteId, channelId)
                        .ifPresent(recipients::add);
                recipients.addAll(invoiceAdminCopyRecipientResolver.buildAdminCopyRecipients(
                        instituteId,
                        recipients.stream().map(NotificationToUserDTO::getChannelId).collect(Collectors.toSet())));
                notificationDTO.setUsers(recipients);

                notificationService.sendEmailViaUnified(notificationDTO, instituteId);
            }
            return true;
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send payment confirmation email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "PAYMENT_CONFIRMATION")
                    .withTag("institute.id", instituteId)
                    .withTag("user.id", userDTO.getId())
                    .withTag("user.email", channelId)
                    .withTag("operation", "sendPaymentConfirmationEmail")
                    .send();
            return false;
        }
    }

    // This method can now be deprecated or removed if you only use Payment Intents
    public boolean sendDonationPaymentNotification(/* ... */) {
        // ... existing logic
        return true;
    }

    public boolean sendDonationPaymentConfirmationNotification(
            String instituteId,
            PaymentResponseDTO paymentResponseDTO,
            PaymentInitiationRequestDTO paymentInitiationRequestDTO,
            String email) {
        if (instituteId == null || paymentResponseDTO == null || paymentInitiationRequestDTO == null || email == null) {
            return false;
        }

        Institute institute = instituteService.findById(instituteId);
        if (institute == null)
            return false;

        if (!isPaymentSuccessful(paymentResponseDTO)) {
            return false;
        }

        // UPDATED: Build the email body using the new logic
        String emailBody = buildDonationPaymentConfirmationEmailBody(institute, email, paymentInitiationRequestDTO,
                paymentResponseDTO);
        if (emailBody == null)
            return false;

        NotificationDTO notificationDTO = new NotificationDTO();
        notificationDTO.setBody(emailBody);
        notificationDTO.setNotificationType(CommunicationType.EMAIL.name());
        notificationDTO.setSubject("Donation Confirmation from " + institute.getInstituteName());

        NotificationToUserDTO notificationToUserDTO = new NotificationToUserDTO();
        notificationToUserDTO.setUserId(null); // No user ID for unknown users
        notificationToUserDTO.setPlaceholders(new HashMap<>());
        notificationToUserDTO.setChannelId(email);
        notificationDTO.setUsers(List.of(notificationToUserDTO));

        try {
            notificationService.sendEmailViaUnified(notificationDTO, instituteId);
            return true;
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send donation payment confirmation email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "DONATION_CONFIRMATION")
                    .withTag("institute.id", instituteId)
                    .withTag("donor.email", email)
                    .withTag("payment.amount", String.valueOf(paymentInitiationRequestDTO.getAmount()))
                    .withTag("operation", "sendDonationConfirmationEmail")
                    .send();
            return false;
        }
    }

    /**
     * Template bound to the PAYMENT_CONFIRMATION event for this institute, falling back to the
     * platform-wide DEFAULT config seeded in V421. Returns null when neither resolves.
     */
    private Template resolvePaymentConfirmationTemplate(String instituteId) {
        try {
            Optional<NotificationEventConfig> config = dynamicNotificationService.findEventConfig(
                    NotificationEventType.PAYMENT_CONFIRMATION, instituteId, NotificationTemplateType.EMAIL);
            return config.map(c -> dynamicNotificationService.resolveTemplate(c, instituteId)).orElse(null);
        } catch (Exception e) {
            SentryLogger.logError(e, "Failed to resolve payment confirmation template",
                    Map.of("instituteId", instituteId));
            return null;
        }
    }

    /**
     * Populates the declared payment-confirmation variable fields.
     *
     * <p>Nothing here invents placeholder names — the field names on
     * {@link NotificationTemplateVariables} are the contract, and SendUniqueLinkService derives
     * the {@code {{snake_case}}} keys from them.
     */
    private NotificationTemplateVariables buildPaymentConfirmationVariables(
            Institute institute, UserDTO userDTO, PaymentInitiationRequestDTO requestDTO,
            PaymentResponseDTO responseDTO, String invoiceNumber, String courseName,
            PaymentLog paymentLog, byte[] invoicePdfBytes,
            OrderAmountSummary orderAmounts) {

        Map<String, Object> responseData = responseDTO.getResponseData() != null
                ? responseDTO.getResponseData()
                : Map.of();

        String learnerName = StringUtils.hasText(userDTO.getFullName())
                ? userDTO.getFullName()
                : safe(userDTO.getEmail());

        // PaymentLog carries the amount in major units; responseData carries minor units when it
        // carries anything, so it is never used as a numeric source.
        // The ORDER's total wins over this log's own share. A multi-course checkout
        // fans out into one child log per course, so the log driving this email
        // knows only a fraction of what was charged — see OrderAmountSummary.
        Double amountValue = orderAmounts != null ? orderAmounts.paidAmount() : null;
        if (amountValue == null) {
            amountValue = paymentLog != null ? paymentLog.getPaymentAmount() : null;
        }
        if (amountValue == null) {
            amountValue = requestDTO.getAmount();
        }
        String amount = amountValue != null ? String.format(Locale.ENGLISH, "%,.2f", amountValue) : "";

        String currency = StringUtils.hasText(requestDTO.getCurrency())
                ? requestDTO.getCurrency()
                : (paymentLog != null ? safe(paymentLog.getCurrency()) : "");

        // created_at, not the `date` DATE column — the latter loses the time of day.
        String paymentDate;
        if (paymentLog != null && paymentLog.getCreatedAt() != null) {
            paymentDate = paymentLog.getCreatedAt().format(DATE_FORMAT);
        } else {
            Number createdValue = responseData.get("created") instanceof Number
                    ? (Number) responseData.get("created")
                    : Instant.now().getEpochSecond();
            paymentDate = Instant.ofEpochSecond(createdValue.longValue())
                    .atZone(ZoneId.systemDefault())
                    .toLocalDate()
                    .format(DATE_FORMAT);
        }

        // Gateway reference when the response carried one, else our payment-log id — which is the
        // order_id the gateway was handed, so it stays traceable either way.
        String transactionId = safeCastToString(responseData.get("transactionId"));
        if (!StringUtils.hasText(transactionId) && paymentLog != null) {
            transactionId = safe(paymentLog.getId());
        }

        String receiptUrl = safeCastToString(responseData.get("receiptUrl"));
        boolean pdfAttached = invoicePdfBytes != null && invoicePdfBytes.length > 0;
        String instituteLogoUrl = resolveInstituteLogoUrl(institute);

        return NotificationTemplateVariables.builder()
                .userId(userDTO.getId())
                .userEmail(safe(userDTO.getEmail()))
                .userMobile(safe(userDTO.getMobileNumber()))
                .userFullName(learnerName)
                .name(learnerName)
                .learnerName(learnerName)
                .courseName(safe(courseName))
                .packageName(safe(courseName))
                .amount(amount)
                .paymentAmount(amount)
                .orderTotal(orderAmounts != null && orderAmounts.hasDiscount()
                        ? String.format(Locale.ENGLISH, "%,.2f", orderAmounts.grossAmount())
                        : "")
                .discountAmount(orderAmounts != null && orderAmounts.hasDiscount()
                        ? String.format(Locale.ENGLISH, "%,.2f", orderAmounts.discountAmount())
                        : "")
                .itemCount(orderAmounts != null && orderAmounts.coversMultipleCourses()
                        ? String.valueOf(orderAmounts.itemCount())
                        : "")
                .amountBreakdownHtml(buildAmountBreakdownHtml(orderAmounts, currencySymbol(currency)))
                .paymentStatus(PaymentStatusEnum.PAID.name())
                .currency(currency)
                .currencySymbol(currencySymbol(currency))
                .paymentDate(paymentDate)
                .paymentMode(paymentLog != null && StringUtils.hasText(paymentLog.getVendor())
                        ? paymentLog.getVendor()
                        : safe(requestDTO.getVendor()))
                .transactionId(transactionId)
                .invoiceNumber(safe(invoiceNumber))
                .receiptUrl(receiptUrl)
                .invoicePdfLink(pdfAttached
                        ? "Please find your invoice attached to this email."
                        : receiptUrl)
                .instituteId(institute.getId())
                .instituteName(safe(institute.getInstituteName()))
                .instituteAddress(safe(institute.getAddress()))
                .instituteContact(StringUtils.hasText(institute.getMobileNumber())
                        ? institute.getMobileNumber()
                        : safe(institute.getEmail()))
                .instituteEmail(safe(institute.getEmail()))
                .instituteWebsite(safe(institute.getWebsiteUrl()))
                .instituteLogoUrl(instituteLogoUrl)
                .instituteLogo(StringUtils.hasText(instituteLogoUrl)
                        ? "<img src=\"" + instituteLogoUrl + "\" alt=\"" + safe(institute.getInstituteName())
                                + "\" style=\"max-height:60px;\" />"
                        : "")
                // Same name->hex mapping the built-in body used, so the seeded DEFAULT template
                // renders in the institute's colour exactly as before.
                .themeColor(StripeInvoiceEmailBody.getThemeColorHex(institute.getInstituteThemeCode()))
                .receiptButton(StringUtils.hasText(receiptUrl)
                        ? "<table width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\""
                                + " style=\"margin: 30px 0;\"><tr><td align=\"center\">"
                                + "<a href=\"" + receiptUrl + "\" class=\"cta-button\">View Full Receipt</a>"
                                + "</td></tr></table>"
                        : "")
                .currentDate(LocalDateTime.now().format(DATE_FORMAT))
                .year(String.valueOf(LocalDateTime.now().getYear()))
                .build();
    }

    /**
     * Literal {@code {{key}}} substitution, matching UnifiedSendService's own replacement so a
     * template renders identically whichever path sends it. Applied to the shared body rather
     * than per-recipient placeholders because the billing-contact and admin-copy recipients are
     * built with empty placeholder maps — per-recipient substitution would leave their copies
     * showing raw tokens. Unknown tokens are left intact so an authoring typo stays visible.
     */
    private String applyVariables(String content, Map<String, String> variables) {
        if (!StringUtils.hasText(content)) {
            return content;
        }
        // {{#if key}}...{{/if}} blocks are resolved by this same substitution; see TemplateConditionals.
        String filled = TemplateConditionals.prepare(content);
        for (Map.Entry<String, String> var : variables.entrySet()) {
            filled = filled.replace("{{" + var.getKey() + "}}", var.getValue() != null ? var.getValue() : "");
        }
        return TemplateConditionals.finish(filled);
    }

    /**
     * The names an email-editor receipt template uses for values this email already carries, so
     * such a template fills without being rewritten: customer_name, amount_paid (with the currency
     * symbol), payment_received_date, invoice_item_description (the course) and invoice_item_tag
     * (the course's tags, e.g. "Vet Course"; blank when it has none). Keys the variables map
     * already holds are left alone.
     */
    static Map<String, String> withReceiptAliases(Map<String, String> variables, String courseTags) {
        Map<String, String> out = new HashMap<>(variables != null ? variables : Map.of());
        String amount = out.getOrDefault("amount", "");
        out.putIfAbsent("customer_name", out.getOrDefault("user_full_name", ""));
        out.putIfAbsent("amount_paid", StringUtils.hasText(amount)
                ? out.getOrDefault("currency_symbol", "") + amount : "");
        out.putIfAbsent("payment_received_date", out.getOrDefault("payment_date", ""));
        out.putIfAbsent("invoice_item_description", out.getOrDefault("course_name", ""));
        out.putIfAbsent("invoice_item_tag", courseTags != null ? courseTags : "");
        return out;
    }

    /**
     * The "Subtotal / Discount" rows that sit above "Amount Paid", pre-rendered.
     *
     * Built here rather than in the template because placeholder substitution is a
     * literal {@code {{key}}} replace with no conditionals — a template carrying a
     * discount row unconditionally would print an empty "Discount" line on every
     * ordinary single-course receipt. Returning "" collapses the receipt back to
     * the single row it has always had.
     *
     * Deliberately inline-styled and using the same table the surrounding rows do,
     * so it inherits whatever the institute's template looks like instead of
     * importing a second visual language into their receipt.
     */
    static String buildAmountBreakdownHtml(OrderAmountSummary orderAmounts, String symbol) {
        if (orderAmounts == null || !orderAmounts.hasDiscount()) {
            return "";
        }
        String sym = symbol == null ? "" : symbol;
        String subtotalLabel = orderAmounts.coversMultipleCourses()
                ? orderAmounts.itemCount() + " courses"
                : "Subtotal";
        return "<tr><td style=\"padding:2px 0;color:#6b7280;font-size:14px;\">" + subtotalLabel
                + "</td><td style=\"padding:2px 0;text-align:right;color:#6b7280;font-size:14px;\">"
                + sym + String.format(Locale.ENGLISH, "%,.2f", orderAmounts.grossAmount())
                + "</td></tr>"
                + "<tr><td style=\"padding:2px 0 10px;color:#059669;font-size:14px;\">Discount</td>"
                + "<td style=\"padding:2px 0 10px;text-align:right;color:#059669;font-size:14px;\">-"
                + sym + String.format(Locale.ENGLISH, "%,.2f", orderAmounts.discountAmount())
                + "</td></tr>";
    }

    private String resolveInstituteLogoUrl(Institute institute) {
        try {
            if (StringUtils.hasText(institute.getLogoFileId())) {
                return safe(mediaService.getFileUrlById(institute.getLogoFileId()));
            }
        } catch (Exception e) {
            SentryLogger.logError(e, "Failed to get institute logo for email",
                    Map.of("instituteId", institute.getId()));
        }
        return "";
    }

    private String currencySymbol(String currency) {
        if (!StringUtils.hasText(currency)) {
            return "";
        }
        switch (currency.toUpperCase()) {
            case "INR":
                return "₹";
            case "USD":
                return "$";
            case "EUR":
                return "€";
            case "GBP":
                return "£";
            case "AUD":
                return "A$";
            case "AED":
                return "د.إ";
            default:
                return currency.toUpperCase();
        }
    }

    /**
     * UPDATED: Builds donation email body using PaymentIntent data.
     */
    private String buildDonationPaymentConfirmationEmailBody(
            Institute institute, String email, PaymentInitiationRequestDTO requestDTO, PaymentResponseDTO responseDTO) {

        Map<String, Object> responseData = responseDTO.getResponseData();
        if (responseData == null)
            return null;

        String transactionId = safeCastToString(responseData.get("transactionId"));
        String instituteLogoUrl = mediaService.getFileUrlById(institute.getLogoFileId());
        String receiptUrl = safeCastToString(responseData.get("receiptUrl"));

        // FIX: Safely cast the 'created' timestamp to long
        Number createdValue = (Number) responseData.getOrDefault("created", Instant.now().getEpochSecond());
        long createdTimestamp = createdValue.longValue();

        String paymentDate = Instant.ofEpochSecond(createdTimestamp)
                .atZone(ZoneId.systemDefault())
                .toLocalDate()
                .format(DateTimeFormatter.ofPattern("dd MMM yyyy"));

        // This line already uses the correct pattern
        String displayAmount = String.valueOf(responseDTO.getResponseData().get("amount"));

        return StripeInvoiceEmailBody.getPaymentConfirmationEmailBody(
                safe(institute.getInstituteName()),
                safe(instituteLogoUrl),
                "Supporter", // Generic greeting for donation
                displayAmount,
                safe(requestDTO.getCurrency()),
                transactionId,
                paymentDate,
                receiptUrl, // Corrected parameter order
                safe(institute.getAddress()),
                institute.getInstituteThemeCode());
    }

    private boolean isPaymentSuccessful(PaymentResponseDTO responseDTO) {
        if (responseDTO == null || responseDTO.getResponseData() == null)
            return false;
        String paymentStatus = safeCastToString(responseDTO.getResponseData().get("paymentStatus"));
        return PaymentStatusEnum.PAID.name().equals(paymentStatus);
    }

    private String safeCastToString(Object value) {
        return value != null ? value.toString() : "";
    }

    private <T> T safe(T val) {
        // A simple way to avoid NullPointerException for strings in the template.
        if (val == null)
            return (T) "";
        return val;
    }

    // ========================================================================
    // AI Credit Pack confirmation email (v1: basic HTML body, no PDF attachment)
    // ========================================================================

    /**
     * Send a confirmation email after a successful AI credit pack purchase.
     * Called from {@code PlatformRazorpayWebHookService.handleCreditPackPayment}
     * once the credits have been granted and the {@code platform_invoice} row
     * persisted.
     *
     * v1 scope: minimal HTML body, no PDF attachment. v1.1 will attach the
     * rendered invoice PDF once {@code PlatformInvoiceService} populates
     * {@code platform_invoice.pdf_s3_url}.
     *
     * @param instituteId      buyer institute (for tenant routing in unified)
     * @param recipientEmail   email to deliver to (buyer's clicker email)
     * @param recipientUserId  user id of the recipient (for placeholders)
     * @param invoiceNumber    e.g. "INV-AICRED-202605-0001"
     * @param creditsGranted   credits added to the institute's balance
     * @param totalAmountMajor "₹548.70" / "$25.00"
     * @param packName         e.g. "Pro"
     * @return true on success, false on any failure (Sentry-logged)
     */
    public boolean sendCreditPackConfirmation(
            String instituteId,
            String recipientEmail,
            String recipientUserId,
            String invoiceNumber,
            String creditsGranted,
            String totalAmountMajor,
            String packName) {
        return sendCreditPackConfirmation(instituteId, recipientEmail, recipientUserId, invoiceNumber,
                creditsGranted, totalAmountMajor, packName, null, null);
    }

    /**
     * @param invoicePdf      rendered GST tax invoice to attach; null = send without attachment
     * @param invoiceFileName attachment file name, e.g. "INV-AICRED-202609-0007.pdf"
     */
    public boolean sendCreditPackConfirmation(
            String instituteId,
            String recipientEmail,
            String recipientUserId,
            String invoiceNumber,
            String creditsGranted,
            String totalAmountMajor,
            String packName,
            byte[] invoicePdf,
            String invoiceFileName) {
        if (instituteId == null || recipientEmail == null || invoiceNumber == null) {
            return false;
        }

        Institute institute = instituteService.findById(instituteId);
        if (institute == null) {
            return false;
        }

        boolean attached = invoicePdf != null && invoicePdf.length > 0;
        String body = buildCreditPackEmailBody(
                institute.getInstituteName(), invoiceNumber, creditsGranted, totalAmountMajor, packName, attached);
        String subject = "Your AI credits are ready — tax invoice " + invoiceNumber;

        try {
            if (attached) {
                AttachmentUsersDTO.AttachmentDTO att = new AttachmentUsersDTO.AttachmentDTO();
                att.setAttachmentName(invoiceFileName != null ? invoiceFileName : invoiceNumber + ".pdf");
                att.setAttachment(Base64.getEncoder().encodeToString(invoicePdf));

                AttachmentUsersDTO recipient = new AttachmentUsersDTO();
                recipient.setUserId(recipientUserId);
                recipient.setChannelId(recipientEmail);
                recipient.setPlaceholders(new HashMap<>());
                recipient.setAttachments(List.of(att));

                AttachmentNotificationDTO dto = AttachmentNotificationDTO.builder()
                        .body(body)
                        .subject(subject)
                        .notificationType(CommunicationType.EMAIL.name())
                        .source("AI_CREDIT_PACK_CONFIRMATION")
                        .sourceId(invoiceNumber)
                        .attachmentName(att.getAttachmentName())
                        .emailType("UTILITY_EMAIL")
                        .users(List.of(recipient))
                        .build();
                notificationService.sendAttachmentEmailViaUnified(List.of(dto), instituteId);
                return true;
            }

            NotificationDTO notification = new NotificationDTO();
            notification.setBody(body);
            notification.setNotificationType(CommunicationType.EMAIL.name());
            notification.setSubject(subject);

            NotificationToUserDTO recipient = new NotificationToUserDTO();
            recipient.setUserId(recipientUserId);
            recipient.setChannelId(recipientEmail);
            recipient.setPlaceholders(new HashMap<>());
            notification.setUsers(List.of(recipient));

            notificationService.sendEmailViaUnified(notification, instituteId);
            return true;
        } catch (Exception e) {
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send AI credit pack confirmation email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", "AI_CREDIT_PACK_CONFIRMATION")
                    .withTag("institute.id", instituteId)
                    .withTag("user.id", recipientUserId == null ? "anonymous" : recipientUserId)
                    .withTag("user.email", recipientEmail)
                    .withTag("invoice.number", invoiceNumber)
                    .withTag("operation", "sendCreditPackConfirmation")
                    .send();
            return false;
        }
    }

    private static String buildCreditPackEmailBody(
            String instituteName, String invoiceNumber, String credits, String total, String packName,
            boolean invoiceAttached) {
        String safeInstitute = StringUtils.hasText(instituteName) ? instituteName : "your institute";
        String safePack = StringUtils.hasText(packName) ? packName : "AI Credits";
        return "<!DOCTYPE html><html><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;\">"
                + "<div style=\"max-width:560px;margin:24px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;\">"
                + "<h2 style=\"margin:0 0 16px;color:#7c3aed;\">Payment received</h2>"
                + "<p>Thanks — your <strong>" + safePack + "</strong> purchase for <strong>" + safeInstitute
                + "</strong> went through.</p>"
                + "<table style=\"width:100%;border-collapse:collapse;margin:16px 0;\">"
                + "<tr><td style=\"padding:6px 0;color:#6b7280;\">Credits added</td>"
                + "<td style=\"padding:6px 0;text-align:right;font-weight:600;\">" + credits + "</td></tr>"
                + "<tr><td style=\"padding:6px 0;color:#6b7280;\">Amount paid</td>"
                + "<td style=\"padding:6px 0;text-align:right;font-weight:600;\">" + total + "</td></tr>"
                + "<tr><td style=\"padding:6px 0;color:#6b7280;\">Invoice number</td>"
                + "<td style=\"padding:6px 0;text-align:right;font-family:ui-monospace,monospace;font-size:13px;\">"
                + invoiceNumber + "</td></tr>"
                + "</table>"
                + "<p style=\"color:#6b7280;font-size:13px;margin-top:24px;\">"
                + "Your credits are already available in the AI Credits panel. "
                + (invoiceAttached
                        ? "Your GST tax invoice <strong>" + invoiceNumber + "</strong> is attached to this email as a PDF. "
                        : "")
                + "You can download your GST tax invoice anytime from the admin dashboard under "
                + "<strong>AI Credits &rarr; Billing</strong>.</p>"
                + "</div></body></html>";
    }

    // ========================================================================
    // Platform tax documents (AI plan invoices, credit notes): brand-mode aware
    // ========================================================================

    /** Which platform tax document an email carries. */
    public enum PlatformDocumentType { INVOICE, CREDIT_NOTE }

    /**
     * Everything a platform billing email needs. Built by {@code PlatformDocumentMailService};
     * every brand decision (link host, sender, trade name) is already made by the caller, and this
     * class only renders and sends.
     *
     * <ul>
     *   <li>{@code brandMode} NEUTRAL: subject, body and links never say "Vacademy" (owner decision
     *       D2). With {@code fromName} set, the mail goes out under that sender name (and
     *       {@code fromEmail} when set) without an attachment — the attachment path cannot override
     *       the sender — and points to the institute's own admin host for the PDF. Without it, the
     *       PDF is attached and sent through the institute's own UTILITY_EMAIL sender, exactly as
     *       credit-pack confirmations are today.</li>
     *   <li>{@code brandMode} VACADEMY: the subject is prefixed with {@code tradeName}; PDF attached.</li>
     * </ul>
     */
    @lombok.Builder
    @lombok.Getter
    public static class PlatformBillingEmail {
        private final String instituteId;
        private final String instituteName;
        private final List<String> recipients;
        private final BrandMode brandMode;
        private final PlatformDocumentType documentType;
        /** CREDIT_PACK | AI_SUBSCRIPTION */
        private final String itemKind;
        private final String documentNumber;
        /** Credit notes: the invoice they are against. */
        private final String againstInvoiceNumber;
        private final String description;
        private final String amountDisplay;
        private final String servicePeriod;
        private final String reason;
        /** Full link to the billing page on the institute's own admin host; null = no link. */
        private final String billingLink;
        /** VACADEMY mode only. */
        private final String tradeName;
        private final String supportEmail;
        /** NEUTRAL sender name / address (platform_payment_config.billing_from_*). */
        private final String fromName;
        private final String fromEmail;
        private final byte[] pdf;
        private final String pdfFileName;
    }

    /**
     * Sends a platform invoice or credit-note email to every recipient.
     *
     * @return number of recipients the email was handed to (0 on any failure; Sentry-logged)
     */
    public int sendPlatformBillingEmail(PlatformBillingEmail e) {
        if (e == null || e.getInstituteId() == null || e.getRecipients() == null || e.getRecipients().isEmpty()
                || e.getDocumentNumber() == null) {
            return 0;
        }
        List<String> to = dedupeEmails(e.getRecipients());
        if (to.isEmpty()) {
            return 0;
        }
        boolean neutral = e.getBrandMode() != BrandMode.VACADEMY;
        boolean namedSender = neutral && StringUtils.hasText(e.getFromName());
        boolean attach = !namedSender && e.getPdf() != null && e.getPdf().length > 0;
        String subject = platformBillingSubject(e);
        String body = platformBillingBody(e, attach);
        String source = e.getDocumentType() == PlatformDocumentType.CREDIT_NOTE
                ? "AI_PLATFORM_CREDIT_NOTE" : "AI_PLATFORM_INVOICE";
        try {
            if (namedSender) {
                for (String email : to) {
                    notificationService.sendHtmlEmailViaUnified(email, subject, body, e.getInstituteId(),
                            StringUtils.hasText(e.getFromEmail()) ? e.getFromEmail() : null, e.getFromName(),
                            "UTILITY_EMAIL");
                }
                return to.size();
            }
            if (attach) {
                String fileName = StringUtils.hasText(e.getPdfFileName()) ? e.getPdfFileName()
                        : e.getDocumentNumber().replace('/', '-') + ".pdf";
                String b64 = Base64.getEncoder().encodeToString(e.getPdf());
                List<AttachmentUsersDTO> users = new ArrayList<>();
                for (String email : to) {
                    AttachmentUsersDTO.AttachmentDTO att = new AttachmentUsersDTO.AttachmentDTO();
                    att.setAttachmentName(fileName);
                    att.setAttachment(b64);
                    AttachmentUsersDTO u = new AttachmentUsersDTO();
                    u.setChannelId(email);
                    u.setPlaceholders(new HashMap<>());
                    u.setAttachments(List.of(att));
                    users.add(u);
                }
                AttachmentNotificationDTO dto = AttachmentNotificationDTO.builder()
                        .body(body)
                        .subject(subject)
                        .notificationType(CommunicationType.EMAIL.name())
                        .source(source)
                        .sourceId(e.getDocumentNumber())
                        .attachmentName(fileName)
                        .emailType("UTILITY_EMAIL")
                        .users(users)
                        .build();
                notificationService.sendAttachmentEmailViaUnified(List.of(dto), e.getInstituteId());
                return to.size();
            }
            NotificationDTO notification = new NotificationDTO();
            notification.setBody(body);
            notification.setNotificationType(CommunicationType.EMAIL.name());
            notification.setSubject(subject);
            notification.setSource(source);
            notification.setSourceId(e.getDocumentNumber());
            List<NotificationToUserDTO> users = new ArrayList<>();
            for (String email : to) {
                NotificationToUserDTO u = new NotificationToUserDTO();
                u.setChannelId(email);
                u.setPlaceholders(new HashMap<>());
                users.add(u);
            }
            notification.setUsers(users);
            notificationService.sendEmailViaUnified(notification, e.getInstituteId());
            return to.size();
        } catch (Exception ex) {
            SentryLogger.SentryEventBuilder.error(ex)
                    .withMessage("Failed to send platform billing email")
                    .withTag("notification.type", "EMAIL")
                    .withTag("email.type", source)
                    .withTag("institute.id", e.getInstituteId())
                    .withTag("document.number", e.getDocumentNumber())
                    .withTag("operation", "sendPlatformBillingEmail")
                    .send();
            return 0;
        }
    }

    static List<String> dedupeEmails(List<String> raw) {
        java.util.LinkedHashMap<String, String> seen = new java.util.LinkedHashMap<>();
        for (String r : raw) {
            if (!StringUtils.hasText(r)) {
                continue;
            }
            String t = r.trim();
            if (!t.contains("@")) {
                continue;
            }
            seen.putIfAbsent(t.toLowerCase(Locale.ROOT), t);
        }
        return new ArrayList<>(seen.values());
    }

    static String platformBillingSubject(PlatformBillingEmail e) {
        String base;
        if (e.getDocumentType() == PlatformDocumentType.CREDIT_NOTE) {
            base = "Credit note " + e.getDocumentNumber()
                    + (StringUtils.hasText(e.getAgainstInvoiceNumber()) ? " for invoice " + e.getAgainstInvoiceNumber() : "");
        } else if ("AI_SUBSCRIPTION".equals(e.getItemKind())) {
            base = "Your AI plan payment is confirmed: tax invoice " + e.getDocumentNumber();
        } else {
            base = "Your AI credits are ready: tax invoice " + e.getDocumentNumber();
        }
        boolean vacademyBrand = e.getBrandMode() == BrandMode.VACADEMY;
        if (vacademyBrand && StringUtils.hasText(e.getTradeName())) {
            return e.getTradeName().trim() + ": " + base;
        }
        return base;
    }

    static String platformBillingBody(PlatformBillingEmail e, boolean attached) {
        boolean vacademyBrand = e.getBrandMode() == BrandMode.VACADEMY
                && StringUtils.hasText(e.getTradeName());
        boolean creditNote = e.getDocumentType() == PlatformDocumentType.CREDIT_NOTE;
        boolean subscription = "AI_SUBSCRIPTION".equals(e.getItemKind());
        String inst = StringUtils.hasText(e.getInstituteName()) ? htmlEscape(e.getInstituteName()) : "your institute";
        String doc = creditNote ? "credit note" : "tax invoice";

        StringBuilder sb = new StringBuilder(2_000);
        sb.append("<!DOCTYPE html><html><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;\">")
          .append("<div style=\"max-width:560px;margin:24px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;\">");
        if (vacademyBrand) {
            sb.append("<div style=\"font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;\">")
              .append(htmlEscape(e.getTradeName().trim())).append("</div>");
        }
        sb.append("<h2 style=\"margin:0 0 16px;color:#111827;\">")
          .append(creditNote ? "Credit note issued" : "Payment received").append("</h2>");
        if (creditNote) {
            sb.append("<p>A credit note has been issued to <strong>").append(inst).append("</strong>")
              .append(StringUtils.hasText(e.getAgainstInvoiceNumber())
                      ? " against tax invoice <strong>" + htmlEscape(e.getAgainstInvoiceNumber()) + "</strong>" : "")
              .append(".</p>");
        } else {
            sb.append("<p>Thank you. We have received the payment from <strong>").append(inst).append("</strong>")
              .append(subscription ? " for your AI plan." : " for AI credits.").append("</p>");
        }
        sb.append("<table style=\"width:100%;border-collapse:collapse;margin:16px 0;\">");
        row(sb, "Item", e.getDescription());
        if (StringUtils.hasText(e.getServicePeriod())) {
            row(sb, "Service period", e.getServicePeriod());
        }
        row(sb, creditNote ? "Amount credited" : "Amount paid", e.getAmountDisplay());
        row(sb, creditNote ? "Credit note number" : "Invoice number", e.getDocumentNumber());
        if (creditNote && StringUtils.hasText(e.getReason())) {
            row(sb, "Reason", e.getReason());
        }
        sb.append("</table>");
        sb.append("<p style=\"color:#6b7280;font-size:13px;margin-top:24px;\">");
        if (attached) {
            sb.append("Your GST ").append(doc).append(" <strong>").append(htmlEscape(e.getDocumentNumber()))
              .append("</strong> is attached to this email as a PDF. ");
        }
        if (StringUtils.hasText(e.getBillingLink())) {
            sb.append("You can download it at any time from <a href=\"").append(htmlEscape(e.getBillingLink()))
              .append("\">Plan &amp; billing</a> in your admin dashboard.");
        } else {
            sb.append("You can download it at any time from <strong>Plan &amp; billing</strong> in your admin dashboard.");
        }
        sb.append("</p>");
        if (StringUtils.hasText(e.getSupportEmail())) {
            sb.append("<p style=\"color:#6b7280;font-size:12px;\">Questions about this bill? Write to ")
              .append(htmlEscape(e.getSupportEmail())).append(".</p>");
        }
        sb.append("</div></body></html>");
        return sb.toString();
    }

    private static void row(StringBuilder sb, String label, String value) {
        if (!StringUtils.hasText(value)) {
            return;
        }
        sb.append("<tr><td style=\"padding:6px 0;color:#6b7280;\">").append(htmlEscape(label)).append("</td>")
          .append("<td style=\"padding:6px 0;text-align:right;font-weight:600;\">").append(htmlEscape(value))
          .append("</td></tr>");
    }

    private static String htmlEscape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
