package vacademy.io.admin_core_service.features.fee_management.service;

import org.springframework.scheduling.annotation.Async;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.styledxmlparser.jsoup.Jsoup;
import com.itextpdf.styledxmlparser.jsoup.nodes.Document;
import com.itextpdf.styledxmlparser.jsoup.nodes.Entities;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.TemplateService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberAllocation;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberContext;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceNumberService;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.dto.InMemoryMultipartFile;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.util.Comparator;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Service for generating and sending school fee receipts as PDF email
 * attachments.
 * Triggered after offline payment during school enrollment.
 *
 * This service is completely independent of InvoiceService (course invoices).
 * It reads from student_fee_payment table and generates a fee-specific receipt.
 */
@Slf4j
@Service
public class SchoolFeeReceiptService {

    @Autowired
    private AdjustmentResolver adjustmentResolver;

    private BigDecimal computeAdjustmentEffect(StudentFeePayment bill) {
        return adjustmentResolver.computeAdjustmentEffect(bill);
    }

    private BigDecimal computeConcession(StudentFeePayment bill) {
        return adjustmentResolver.computeConcession(bill);
    }

    private BigDecimal computePenalty(StudentFeePayment bill) {
        return adjustmentResolver.computePenalty(bill);
    }

    private static final String SCHOOL_FEE_RECEIPT_TEMPLATE_TYPE = "SCHOOL_FEE_RECEIPT";
    private static final String RECEIPT_PREFIX = "RCT";
    // DATE_FORMATTER removed with the hardcoded RCT-yyyyMMdd-NNNN receipt number —
    // the date portion now comes from the institute's configured format tokens.
    private static final DateTimeFormatter DISPLAY_DATE_FORMATTER = DateTimeFormatter.ofPattern("dd MMM yyyy");

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @Autowired
    private AssignedFeeValueRepository assignedFeeValueRepository;

    @Autowired
    private FeeTypeRepository feeTypeRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    // Receipt numbers follow the same admin-configured strategy as invoice numbers.
    @Autowired
    private InvoiceNumberService invoiceNumberService;

    @Autowired
    private AuthService authService;

    @Autowired
    private TemplateService templateService;

    @Autowired
    private InstituteSettingService instituteSettingService;

    @Autowired
    private MediaService mediaService;

    @Autowired
    private InvoiceRepository invoiceRepository;

    @Autowired
    private InvoiceLineItemRepository invoiceLineItemRepository;

    @Autowired
    @Lazy
    private NotificationService notificationService;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository customFieldValuesRepository;

    /**
     * Generate a school fee receipt PDF and send it via email.
     * This is the only public method — called from SchoolEnrollService after FIFO
     * allocation.
     *
     * @param userId        Student's user ID
     * @param userPlanId    The user plan ID (links to student_fee_payment rows)
     * @param paymentLogId  The payment log ID for this transaction
     * @param instituteId   The institute ID
     * @param amountPaid    Amount paid in this transaction
     * @param transactionId Manual payment reference (e.g., "CASH-001")
     * @param paymentMode   Payment mode (e.g., "OFFLINE")
     */
    @Async
    @Transactional
    public void generateAndSendReceipt(String userId, String userPlanId, String paymentLogId,
            String instituteId, BigDecimal amountPaid, String transactionId, String paymentMode) {
        try {
            log.info("Starting school fee receipt generation for userId: {}, userPlanId: {}, instituteId: {}",
                    userId, userPlanId, instituteId);

            // 1. Check if invoice email is enabled
            Institute institute = instituteRepository.findById(instituteId)
                    .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

            Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
            boolean sendEmail = Boolean.TRUE.equals(invoiceSettings.get("sendInvoiceEmail"));
            String currency = (String) invoiceSettings.getOrDefault("currency", "INR");

            // 2. Fetch student info
            UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(userId)).get(0);
            if (user == null) {
                log.warn("User not found for receipt generation: {}", userId);
                return;
            }

            // 3. Fetch all fee installments for this user plan
            List<StudentFeePayment> feePayments = studentFeePaymentRepository.findByUserPlanId(userPlanId);
            if (feePayments == null || feePayments.isEmpty()) {
                log.warn("No fee payments found for userPlanId: {}", userPlanId);
                return;
            }

            // Sort fees chronologically (earliest due date first) to match FIFO allocation order
            feePayments.sort(Comparator.comparing(StudentFeePayment::getDueDate, 
                    Comparator.nullsLast(Comparator.naturalOrder())));

            // 4. Build receipt data
            BigDecimal totalExpected = BigDecimal.ZERO;
            BigDecimal totalPaid = BigDecimal.ZERO;
            BigDecimal totalConcession = BigDecimal.ZERO;
            BigDecimal totalPenalty = BigDecimal.ZERO;

            for (StudentFeePayment fp : feePayments) {
                totalExpected = totalExpected
                        .add(fp.getAmountExpected() != null ? fp.getAmountExpected() : BigDecimal.ZERO);
                totalPaid = totalPaid.add(fp.getAmountPaid() != null ? fp.getAmountPaid() : BigDecimal.ZERO);
                totalConcession = totalConcession.add(computeConcession(fp));
                totalPenalty = totalPenalty.add(computePenalty(fp));
            }
            BigDecimal balanceDue = totalExpected.add(totalPenalty).subtract(totalConcession).subtract(totalPaid);

            // 5. Generate receipt number
            InvoiceNumberAllocation receiptAllocation = generateReceiptNumber(instituteId, userId, firstUserPlanId(feePayments));
            String receiptNumber = receiptAllocation.number();

            // 6. Load school fee receipt template
            String templateHtml = loadSchoolFeeReceiptTemplate(instituteId);

            // 7. Replace placeholders (includes fee table HTML)
            String filledTemplate = replacePlaceholders(templateHtml, user, institute, feePayments,
                    receiptNumber, amountPaid, transactionId, paymentMode,
                    totalExpected, totalPaid, totalConcession, totalPenalty, balanceDue, currency);

            // 8. Generate PDF
            byte[] pdfBytes = generatePdfFromHtml(filledTemplate);

            // 9. Upload to S3
            String pdfFileId = uploadReceiptToS3(pdfBytes, receiptNumber, instituteId);

            // 10. Save to invoice table
            Invoice invoice = saveReceipt(userId, instituteId, receiptAllocation, pdfFileId,
                    amountPaid, totalExpected, totalPaid, totalConcession, totalPenalty, balanceDue, currency,
                    "STUDENT_FEE_PAYMENT", feePayments.get(0).getId());

            // 11. Save line items (one per installment)
            saveLineItems(invoice, feePayments, currency);

            log.info("School fee receipt generated successfully: {}", receiptNumber);

            // 12. Send email if enabled
            if (sendEmail) {
                try {
                    sendReceiptEmail(invoice, user, institute, instituteId, pdfBytes, receiptNumber);
                } catch (Exception e) {
                    log.error("Failed to send receipt email for receipt: {}. Receipt generation succeeded.",
                            receiptNumber, e);
                }
            } else {
                log.debug("Receipt email disabled by institute setting for institute: {}", instituteId);
            }

        } catch (Exception e) {
            log.error("Error generating school fee receipt for userId: {}, userPlanId: {}",
                    userId, userPlanId, e);
            // Don't throw — receipt failure should never break enrollment
        }
    }

    /**
     * Overloaded method for fee allocation flow.
     * Generates receipt ONLY for the specific installments that were paid in this transaction.
     *
     * @param userId              Student's user ID
     * @param paymentLogId        The payment log ID for this transaction
     * @param instituteId         The institute ID
     * @param amountPaid          Amount paid in this transaction
     * @param transactionId       Manual payment reference (e.g., "CASH-001")
     * @param paymentMode         Payment mode (e.g., "OFFLINE")
     * @param paidInstallmentIds  List of student_fee_payment IDs that were paid/partially paid in this allocation
     */
    @Transactional
    public String generateAndSendReceipt(String userId, String paymentLogId,
            String instituteId, BigDecimal amountPaid, String transactionId, String paymentMode,
            List<String> paidInstallmentIds) {
        try {
            log.info("Starting school fee receipt generation for userId: {}, instituteId: {}, installments: {}",
                    userId, instituteId, paidInstallmentIds.size());

            if (paidInstallmentIds == null || paidInstallmentIds.isEmpty()) {
                log.warn("No paid installment IDs provided for receipt generation");
                return null;
            }

            // 1. Check if invoice email is enabled
            Institute institute = instituteRepository.findById(instituteId)
                    .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

            Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
            boolean sendEmail = Boolean.TRUE.equals(invoiceSettings.get("sendInvoiceEmail"));
            String currency = (String) invoiceSettings.getOrDefault("currency", "INR");

            // 2. Fetch student info
            UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(userId)).get(0);
            if (user == null) {
                log.warn("User not found for receipt generation: {}", userId);
                return null;
            }

            // 3. Fetch ONLY the specific fee installments that were paid in this allocation
            List<StudentFeePayment> feePayments = studentFeePaymentRepository.findAllById(paidInstallmentIds);
            if (feePayments == null || feePayments.isEmpty()) {
                log.warn("No fee payments found for provided installment IDs");
                return null;
            }

            // Sort fees chronologically (earliest due date first)
            feePayments.sort(Comparator.comparing(StudentFeePayment::getDueDate, 
                    Comparator.nullsLast(Comparator.naturalOrder())));

            // 4. Build receipt data (only for paid installments)
            BigDecimal totalExpected = BigDecimal.ZERO;
            BigDecimal totalPaid = BigDecimal.ZERO;
            BigDecimal totalConcession = BigDecimal.ZERO;
            BigDecimal totalPenalty = BigDecimal.ZERO;

            for (StudentFeePayment fp : feePayments) {
                totalExpected = totalExpected
                        .add(fp.getAmountExpected() != null ? fp.getAmountExpected() : BigDecimal.ZERO);
                totalPaid = totalPaid.add(fp.getAmountPaid() != null ? fp.getAmountPaid() : BigDecimal.ZERO);
                totalConcession = totalConcession.add(computeConcession(fp));
                totalPenalty = totalPenalty.add(computePenalty(fp));
            }
            BigDecimal balanceDue = totalExpected.add(totalPenalty).subtract(totalConcession).subtract(totalPaid);

            // 5. Generate receipt number
            InvoiceNumberAllocation receiptAllocation = generateReceiptNumber(instituteId, userId, firstUserPlanId(feePayments));
            String receiptNumber = receiptAllocation.number();

            // 6. Load school fee receipt template
            String templateHtml = loadSchoolFeeReceiptTemplate(instituteId);

            // 7. Replace placeholders (includes fee table HTML)
            String filledTemplate = replacePlaceholders(templateHtml, user, institute, feePayments,
                    receiptNumber, amountPaid, transactionId, paymentMode,
                    totalExpected, totalPaid, totalConcession, totalPenalty, balanceDue, currency);

            // 8. Generate PDF
            byte[] pdfBytes = generatePdfFromHtml(filledTemplate);

            // 9. Upload to S3
            String pdfFileId = uploadReceiptToS3(pdfBytes, receiptNumber, instituteId);

            // 10. Save to invoice table
            Invoice invoice = saveReceipt(userId, instituteId, receiptAllocation, pdfFileId,
                    amountPaid, totalExpected, totalPaid, totalConcession, totalPenalty, balanceDue, currency,
                    "STUDENT_FEE_PAYMENT", feePayments.get(0).getId());

            // 11. Save line items (only for paid installments)
            saveLineItems(invoice, feePayments, currency);

            log.info("School fee receipt generated successfully: {} for {} installments",
                    receiptNumber, feePayments.size());

            // 12. Send email if enabled
            if (sendEmail) {
                try {
                    sendReceiptEmail(invoice, user, institute, instituteId, pdfBytes, receiptNumber);
                } catch (Exception e) {
                    log.error("Failed to send receipt email for receipt: {}. Receipt generation succeeded.",
                            receiptNumber, e);
                }
            } else {
                log.debug("Receipt email disabled by institute setting for institute: {}", instituteId);
            }

            return invoice.getId();

        } catch (Exception e) {
            log.error("Error generating school fee receipt for userId: {}, instituteId: {}",
                    userId, instituteId, e);
            // Don't throw — receipt failure should never break allocation
            return null;
        }
    }

    /**
     * Generate an invoice/statement PDF for admin-selected installments (no payment required).
     * Shows current status of each installment (PAID, PENDING, PARTIAL_PAID, etc.).
     * Returns the S3 file ID of the generated PDF.
     */
    @Transactional
    public String generateInvoiceForInstallments(String userId, String instituteId,
                                                  List<String> installmentIds) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
        String currency = (String) invoiceSettings.getOrDefault("currency", "INR");

        UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(userId)).get(0);
        if (user == null) {
            throw new VacademyException("User not found: " + userId);
        }

        List<StudentFeePayment> feePayments = studentFeePaymentRepository.findAllById(installmentIds);
        if (feePayments == null || feePayments.isEmpty()) {
            throw new VacademyException("No installments found for the provided IDs");
        }

        feePayments.sort(Comparator.comparing(StudentFeePayment::getDueDate,
                Comparator.nullsLast(Comparator.naturalOrder())));

        BigDecimal totalExpected = BigDecimal.ZERO;
        BigDecimal totalPaid = BigDecimal.ZERO;
        BigDecimal totalConcession = BigDecimal.ZERO;
        BigDecimal totalPenalty = BigDecimal.ZERO;

        for (StudentFeePayment fp : feePayments) {
            totalExpected = totalExpected
                    .add(fp.getAmountExpected() != null ? fp.getAmountExpected() : BigDecimal.ZERO);
            totalPaid = totalPaid.add(fp.getAmountPaid() != null ? fp.getAmountPaid() : BigDecimal.ZERO);
            totalConcession = totalConcession.add(computeConcession(fp));
            totalPenalty = totalPenalty.add(computePenalty(fp));
        }
        BigDecimal balanceDue = totalExpected.add(totalPenalty).subtract(totalConcession).subtract(totalPaid);

        InvoiceNumberAllocation receiptAllocation = generateReceiptNumber(instituteId, userId, firstUserPlanId(feePayments));
        String receiptNumber = receiptAllocation.number();
        String templateHtml = loadSchoolFeeReceiptTemplate(instituteId);

        String filledTemplate = replacePlaceholders(templateHtml, user, institute, feePayments,
                receiptNumber, totalPaid, receiptNumber, "STATEMENT",
                totalExpected, totalPaid, totalConcession, totalPenalty, balanceDue, currency);

        byte[] pdfBytes = generatePdfFromHtml(filledTemplate);
        String pdfFileId = uploadReceiptToS3(pdfBytes, receiptNumber, instituteId);

        // Save invoice record
        saveReceipt(userId, instituteId, receiptAllocation, pdfFileId,
                totalPaid, totalExpected, totalPaid, totalConcession, totalPenalty, balanceDue, currency,
                "STUDENT_FEE_PAYMENT", feePayments.get(0).getId());

        return pdfFileId;
    }

    // ─── Invoice Settings ────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Map<String, Object> getInvoiceSettings(Institute institute) {
        try {
            Object settingData = instituteSettingService.getSettingData(institute, "INVOICE_SETTING");
            if (settingData instanceof Map) {
                Map<String, Object> map = (Map<String, Object>) settingData;
                if (!map.containsKey("sendInvoiceEmail")) {
                    map.put("sendInvoiceEmail", false);
                }
                return map;
            }
        } catch (Exception e) {
            log.warn("Could not load invoice settings for institute: {}. Using defaults.", institute.getId(), e);
        }
        Map<String, Object> defaults = new HashMap<>();
        defaults.put("sendInvoiceEmail", false);
        defaults.put("currency", "INR");
        return defaults;
    }

    // ─── Receipt Number ──────────────────────────────────────────────────────

    /**
     * Fee receipts follow the institute's configured invoice-number strategy
     * ({@code INVOICE_SETTING.numbering}), with {@code {{doc_type}}} rendering as
     * {@value #RECEIPT_PREFIX} so a single format can distinguish a receipt from an
     * enrollment invoice.
     *
     * <p>Replaces a prefix-derived counter ({@code countByInvoiceNumberStartingWith}) that
     * silently restarted from 1 whenever the prefix changed — and would have restarted on
     * every format change once numbering became configurable.
     */
    /** The user plan the paid installments belong to (they come from one plan). */
    private static String firstUserPlanId(List<StudentFeePayment> feePayments) {
        return feePayments == null ? null : feePayments.stream()
                .map(StudentFeePayment::getUserPlanId).filter(StringUtils::hasText).findFirst().orElse(null);
    }

    private InvoiceNumberAllocation generateReceiptNumber(String instituteId, String userId, String userPlanId) {
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                institute != null ? getInvoiceSettings(institute) : null);

        // A receipt must stay visibly distinct from an invoice. The institute's format only
        // carries that distinction if it uses {{doc_type}} — the default format does not, so
        // without this fallback every receipt would silently be numbered "INV-…" the moment
        // this feature shipped. Falling back to the legacy RCT- shape keeps today's numbers
        // exactly and lets admins opt in by adding {{doc_type}} to their format.
        // An institute that numbers per learner (numberingSeries, e.g. one series per branch)
        // wants these receipts in the same series as its invoices, so its own format is kept
        // and the learner picks the series. Everyone else gets the RCT- shape exactly as before.
        boolean perLearnerSeries = !config.getSeries().isEmpty() && StringUtils.hasText(userId);
        if (!config.usesDocType() && !perLearnerSeries) {
            config = config.withFormat(RECEIPT_PREFIX + "-{{YYYYMMDD}}-{{seq}}");
        }

        InvoiceNumberContext context = InvoiceNumberContext.builder()
                // The value pinned on the enrolment first, so every installment of a course
                // stays in one series; then the learner's profile or latest lead.
                .learnerFieldLookup(perLearnerSeries
                        ? fieldId -> {
                            String pinned = StringUtils.hasText(userPlanId)
                                    ? customFieldValuesRepository.findLatestValueForEnrollment(fieldId, userPlanId)
                                    : null;
                            return pinned != null ? pinned : customFieldValuesRepository.findLatestValueForUser(fieldId, userId);
                        }
                        : null)
                .instituteId(instituteId)
                .instituteName(institute != null ? institute.getInstituteName() : null)
                .instituteCode(config.getInstituteCode())
                .instituteStateCode(institute != null ? institute.getStateCode() : null)
                .instituteCity(institute != null ? institute.getCity() : null)
                .instituteState(institute != null ? institute.getState() : null)
                .instituteCountry(institute != null ? institute.getCountry() : null)
                .subdomain(institute != null ? institute.getSubdomain() : null)
                .date(LocalDate.now())
                .docType(RECEIPT_PREFIX)
                .build();

        InvoiceNumberAllocation allocation = invoiceNumberService.generate(config, context);
        log.debug("Generated receipt number: {}", allocation.number());
        return allocation;
    }

    // ─── Template Loading ────────────────────────────────────────────────────

    private String loadSchoolFeeReceiptTemplate(String instituteId) {
        try {
            var templates = templateService.getTemplatesByInstituteAndType(instituteId,
                    SCHOOL_FEE_RECEIPT_TEMPLATE_TYPE);
            if (!templates.isEmpty()) {
                String content = templates.get(0).getContent();
                if (StringUtils.hasText(content)) {
                    log.debug("Loaded school fee receipt template for institute: {}", instituteId);
                    return content;
                }
            }
        } catch (Exception e) {
            log.warn("Could not load school fee receipt template for institute: {}", instituteId, e);
        }

        log.info("Using default school fee receipt template for institute: {}", instituteId);
        return getDefaultReceiptTemplate();
    }

    /**
     * Default HTML template for school fee receipt.
     * Used when no institute-specific template exists in the templates table.
     */
    private String getDefaultReceiptTemplate() {
        return """
                <!DOCTYPE html>
                <html xmlns="http://www.w3.org/1999/xhtml">
                <head>
                    <meta charset="UTF-8" />
                    <style>
                        @page { margin: 15mm; size: A4; }
                        body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; margin: 0; padding: 0; }
                        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #2c5282; padding-bottom: 15px; }
                        .header h1 { margin: 0; color: #2c5282; font-size: 22px; }
                        .header h2 { margin: 5px 0 0 0; color: #555; font-size: 14px; font-weight: normal; }
                        .institute-info { text-align: center; font-size: 12px; color: #666; margin-bottom: 5px; }
                        .receipt-meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px; }
                        .receipt-meta-left, .receipt-meta-right { width: 48%; }
                        .receipt-meta-right { text-align: right; }
                        .label { color: #888; font-size: 11px; text-transform: uppercase; }
                        .value { font-weight: bold; font-size: 13px; }
                        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                        th { background-color: #2c5282; color: white; padding: 10px 8px; text-align: left; font-size: 12px; }
                        td { padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
                        tr:nth-child(even) { background-color: #f7fafc; }
                        .status-PAID { color: #38a169; font-weight: bold; }
                        .status-PARTIAL_PAID { color: #d69e2e; font-weight: bold; }
                        .status-PENDING { color: #e53e3e; font-weight: bold; }
                        .totals { margin-top: 15px; text-align: right; font-size: 13px; }
                        .totals-row { display: flex; justify-content: flex-end; margin: 4px 0; }
                        .totals-label { width: 150px; text-align: right; color: #666; margin-right: 15px; }
                        .totals-value { width: 100px; text-align: right; font-weight: bold; }
                        .grand-total { font-size: 15px; border-top: 2px solid #2c5282; padding-top: 8px; margin-top: 8px; }
                        .payment-info { margin-top: 20px; padding: 12px; background-color: #ebf8ff; border-radius: 6px; font-size: 12px; }
                        .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #e2e8f0; padding-top: 10px; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        {{institute_logo}}
                        <h1>{{institute_name}}</h1>
                        <div class="institute-info">{{institute_address}}</div>
                        <h2>Fee Receipt</h2>
                    </div>

                    <table style="width:100%; border:none; margin-bottom: 15px; background-color: #f7fafc; padding: 12px;">
                        <tr style="background:none;">
                            <td style="border:none; padding:8px; width:50%; vertical-align:top;">
                                <span class="label">Receipt No</span><br/>
                                <span class="value">{{receipt_number}}</span>
                            </td>
                            <td style="border:none; padding:8px; width:50%; vertical-align:top;">
                                <span class="label">Date</span><br/>
                                <span class="value">{{receipt_date}}</span>
                            </td>
                        </tr>
                        <tr style="background:none;">
                            <td style="border:none; padding:8px;">
                                <span class="label">Student Name</span><br/>
                                <span class="value">{{student_name}}</span>
                            </td>
                            <td style="border:none; padding:8px;">
                                <span class="label">Class</span><br/>
                                <span class="value">{{package_name}}</span>
                            </td>
                        </tr>
                        <tr style="background:none;">
                            <td style="border:none; padding:8px;">
                                <span class="label">Parent Name</span><br/>
                                <span class="value">{{parent_name}}</span>
                            </td>
                            <td style="border:none; padding:8px;">
                                <span class="label">Section</span><br/>
                                <span class="value">{{session_name}}</span>
                            </td>
                        </tr>
                        <tr style="background:none;">
                            <td style="border:none; padding:8px;">
                                <span class="label">Academic Year</span><br/>
                                <span class="value">{{session}}</span>
                            </td>
                            <td style="border:none; padding:8px;">
                                <span class="label">Payment Mode</span><br/>
                                <span class="value">{{payment_mode}}</span>
                            </td>
                        </tr>
                    </table>

                    {{fee_table}}

                    <div class="totals">
                        <div class="totals-row">
                            <span class="totals-label">Total Expected:</span>
                            <span class="totals-value">{{currency_symbol}} {{total_expected}}</span>
                        </div>
                        <div class="totals-row" style="{{TOTAL_CONCESSION_ROW_STYLE}}">
                            <span class="totals-label">Concession:</span>
                            <span class="totals-value">- {{currency_symbol}} {{total_concession}}</span>
                        </div>
                        <div class="totals-row" style="{{TOTAL_PENALTY_ROW_STYLE}}">
                            <span class="totals-label">Penalty:</span>
                            <span class="totals-value">+ {{currency_symbol}} {{total_penalty}}</span>
                        </div>
                        <div class="totals-row">
                            <span class="totals-label">Total Paid:</span>
                            <span class="totals-value">{{currency_symbol}} {{total_paid}}</span>
                        </div>
                        <div class="totals-row grand-total">
                            <span class="totals-label">Outstanding:</span>
                            <span class="totals-value">{{currency_symbol}} {{balance_due}}</span>
                        </div>
                    </div>

                    <div class="payment-info">
                        <strong>Payment Details:</strong><br/>
                        Amount Paid: {{currency_symbol}} {{amount_paid_now}} |
                        Mode: {{payment_mode}} |
                        Transaction ID: {{transaction_id}}
                    </div>

                    <div class="footer">
                        This is a computer-generated receipt. | {{institute_name}}
                    </div>
                </body>
                </html>
                """;
    }

    // ─── Placeholder Replacement ─────────────────────────────────────────────

    private String replacePlaceholders(String template, UserDTO user, Institute institute,
            List<StudentFeePayment> feePayments, String receiptNumber,
            BigDecimal amountPaid, String transactionId, String paymentMode,
            BigDecimal totalExpected, BigDecimal totalPaid,
            BigDecimal totalConcession, BigDecimal totalPenalty,
            BigDecimal balanceDue, String currency) {

        String currencySymbol = getCurrencySymbol(currency);
        String receiptDate = LocalDateTime.now().format(DISPLAY_DATE_FORMATTER);
        String studentName = user.getFullName() != null ? user.getFullName() : user.getEmail();
        String instituteName = institute.getInstituteName() != null ? institute.getInstituteName() : "";
        String instituteAddress = buildInstituteAddress(institute);
        String logoHtml = buildInstituteLogoHtml(institute);
        String logoUrl = buildInstituteLogoUrl(institute);
        boolean showConcession = totalConcession != null && totalConcession.signum() > 0;
        boolean showPenalty = totalPenalty != null && totalPenalty.signum() > 0;
        boolean showAdjustmentColumn = showConcession || showPenalty;
        String feeTableHtml = buildFeeTableHtml(feePayments, currency, showAdjustmentColumn);
        ReceiptEnrichment enrichment = enrichReceiptFromEnrollment(user.getId(), institute.getId());
        String safeTransactionId = transactionId != null ? transactionId : "N/A";
        String safePaymentMode = paymentMode != null ? paymentMode : "OFFLINE";

        String replaced = template
                // Existing (lowercase) placeholders
                .replace("{{institute_logo}}", logoHtml)
                .replace("{{institute_name}}", instituteName)
                .replace("{{institute_address}}", instituteAddress)
                .replace("{{receipt_number}}", receiptNumber)
                .replace("{{receipt_date}}", receiptDate)
                .replace("{{student_name}}", studentName)
                .replace("{{student_email}}", user.getEmail() != null ? user.getEmail() : "")
                .replace("{{package_name}}", enrichment.packageName())
                .replace("{{session_name}}", enrichment.sectionName())
                .replace("{{session}}", enrichment.academicSessionLabel())
                .replace("{{parent_name}}", enrichment.parentName())
                .replace("{{admission_no}}", enrichment.admissionNo())
                .replace("{{enrollment_code}}", enrichment.enrollmentCode())
                .replace("{{fee_table}}", feeTableHtml)
                .replace("{{total_expected}}", totalExpected.toPlainString())
                .replace("{{total_paid}}", totalPaid.toPlainString())
                .replace("{{total_concession}}", totalConcession.toPlainString())
                .replace("{{total_penalty}}", totalPenalty.toPlainString())
                .replace("{{total_discount}}", totalConcession.toPlainString())
                .replace("{{balance_due}}", balanceDue.toPlainString())
                .replace("{{amount_paid_now}}", amountPaid.toPlainString())
                .replace("{{transaction_id}}", safeTransactionId)
                .replace("{{payment_mode}}", safePaymentMode)
                .replace("{{currency}}", currency)
                .replace("{{currency_symbol}}", currencySymbol)
                // New DB template (uppercase) placeholders
                .replace("{{SCHOOL_LOGO_URL}}", logoUrl)
                .replace("{{SCHOOL_NAME}}", instituteName)
                .replace("{{SCHOOL_ADDRESS}}", instituteAddress)
                .replace("{{RECEIPT_NO}}", receiptNumber)
                .replace("{{TRANSACTION_ID}}", safeTransactionId)
                .replace("{{TRANSACTION_DATE}}", receiptDate)
                .replace("{{STUDENT_NAME}}", studentName)
                .replace("{{ADMISSION_NO}}", enrichment.admissionNo())
                .replace("{{PARENT_NAME}}", enrichment.parentName())
                .replace("{{CLASS}}", enrichment.packageName())
                .replace("{{ENROLLMENT_CODE}}", enrichment.enrollmentCode())
                .replace("{{SECTION}}", enrichment.sectionName())
                .replace("{{ACADEMIC_YEAR}}", enrichment.academicSessionLabel())
                .replace("{{PAYMENT_MODE}}", safePaymentMode)
                .replace("{{PAYMENT_METHOD}}", safePaymentMode)
                .replace("{{TRANSACTION_REFERENCE}}", safeTransactionId)
                .replace("{{RECEIVED_BY}}", "Cash")
                .replace("{{REMARKS}}", "Paid")
                .replace("{{FEE_TABLE}}", feeTableHtml)
                .replace("{{TOTAL_EXPECTED_FEE}}", currencySymbol + " " + totalExpected.toPlainString())
                .replace("{{TOTAL_CONCESSION}}", currencySymbol + " " + totalConcession.toPlainString())
                .replace("{{TOTAL_PENALTY}}", currencySymbol + " " + totalPenalty.toPlainString())
                .replace("{{TOTAL_DISCOUNT}}", currencySymbol + " " + totalConcession.toPlainString())
                .replace("{{TOTAL_CONCESSION_ROW_STYLE}}", showConcession ? "" : "display: none;")
                .replace("{{TOTAL_PENALTY_ROW_STYLE}}", showPenalty ? "" : "display: none;")
                .replace("{{TOTAL_PAID_ALL_TIME}}", currencySymbol + " " + totalPaid.toPlainString())
                .replace("{{CURRENT_BALANCE_DUE}}", currencySymbol + " " + balanceDue.toPlainString())
                .replace("{{OUTSTANDING}}", currencySymbol + " " + balanceDue.toPlainString())
                .replace("{{AMOUNT_PAID_NOW}}", currencySymbol + " " + amountPaid.toPlainString());

        return applyIndexedFeeRowPlaceholders(replaced, feePayments, currencySymbol);
    }

    private record ReceiptEnrichment(String packageName, String sectionName, String academicSessionLabel,
            String parentName, String enrollmentCode, String admissionNo) {
    }

    /**
     * Class / section / academic year from student_session_institute_group_mapping → package_session;
     * parent name from audience_response (student or parent user id).
     */
    private ReceiptEnrichment enrichReceiptFromEnrollment(String userId, String instituteId) {
        String packageName = "";
        String sectionName = "";
        String academicSessionLabel = "";
        String parentName = "";
        String enrollmentCode = "";
        String admissionNo = "";

        if (StringUtils.hasText(userId) && StringUtils.hasText(instituteId)) {
            try {
                List<StudentSessionInstituteGroupMapping> mappings = studentSessionInstituteGroupMappingRepository
                        .findActiveMappingsWithFetchedPackageSession(userId, instituteId);
                if (!mappings.isEmpty()) {
                    StudentSessionInstituteGroupMapping mapping = mappings.get(0);
                    if (StringUtils.hasText(mapping.getInstituteEnrolledNumber())) {
                        enrollmentCode = mapping.getInstituteEnrolledNumber();
                    }
                    PackageSession ps = mapping.getPackageSession();
                    if (ps != null) {
                        if (ps.getName() != null) {
                            sectionName = ps.getName();
                        }
                        if (ps.getPackageEntity() != null && ps.getPackageEntity().getPackageName() != null) {
                            packageName = ps.getPackageEntity().getPackageName();
                        }
                        if (ps.getSession() != null && ps.getSession().getSessionName() != null) {
                            academicSessionLabel = ps.getSession().getSessionName();
                        }
                    }
                }
            } catch (Exception e) {
                log.debug("Could not load package/session for fee receipt (user={}, institute={}): {}",
                        userId, instituteId, e.getMessage());
            }
            try {
                parentName = resolveParentName(userId);
            } catch (Exception e) {
                log.debug("Could not load parent name for fee receipt (user={}): {}", userId, e.getMessage());
            }
            try {
                admissionNo = resolveAdmissionNo(userId);
            } catch (Exception e) {
                log.debug("Could not load admission number for fee receipt (user={}): {}", userId, e.getMessage());
            }
        }

        return new ReceiptEnrichment(packageName, sectionName, academicSessionLabel, parentName, enrollmentCode,
                admissionNo);
    }

    private String resolveParentName(String userId) {
        List<AudienceResponse> responses = audienceResponseRepository.findByUserIdOrStudentUserId(userId, userId);
        if (responses == null || responses.isEmpty()) {
            return "";
        }
        return responses.stream()
                .filter(ar -> StringUtils.hasText(ar.getParentName()))
                .max(Comparator.comparing(AudienceResponse::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(AudienceResponse::getParentName)
                .orElse("");
    }

    private String resolveAdmissionNo(String userId) {
        List<Student> students = instituteStudentRepository.findByUserId(userId);
        if (students == null || students.isEmpty()) {
            return "";
        }
        return students.stream()
                .filter(s -> StringUtils.hasText(s.getAdmissionNo()))
                .max(Comparator.comparing(Student::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(this::buildAdmissionNoWithYear)
                .orElse("");
    }

    private String buildAdmissionNoWithYear(Student student) {
        String admissionNo = student.getAdmissionNo();
        if (!StringUtils.hasText(admissionNo)) {
            return "";
        }
        if (student.getDateOfAdmission() == null) {
            return admissionNo;
        }
        int year = student.getDateOfAdmission()
                .toInstant()
                .atZone(java.time.ZoneId.systemDefault())
                .toLocalDate()
                .getYear();
        return admissionNo + " / " + year;
    }

    private String buildInstituteAddress(Institute institute) {
        StringBuilder sb = new StringBuilder();
        if (StringUtils.hasText(institute.getAddress()))
            sb.append(institute.getAddress());
        if (StringUtils.hasText(institute.getCity())) {
            if (sb.length() > 0)
                sb.append(", ");
            sb.append(institute.getCity());
        }
        if (StringUtils.hasText(institute.getState())) {
            if (sb.length() > 0)
                sb.append(", ");
            sb.append(institute.getState());
        }
        if (StringUtils.hasText(institute.getPinCode())) {
            if (sb.length() > 0)
                sb.append(" - ");
            sb.append(institute.getPinCode());
        }
        return sb.toString();
    }

    private String buildInstituteLogoHtml(Institute institute) {
        String logoUrl = buildInstituteLogoUrl(institute);
        if (StringUtils.hasText(logoUrl)) {
            return "<img src=\"" + logoUrl + "\" alt=\"Logo\" style=\"max-height: 60px; max-width: 200px;\" />";
        }
        return "";
    }

    private String buildInstituteLogoUrl(Institute institute) {
        if (StringUtils.hasText(institute.getLogoFileId())) {
            try {
                String logoUrl = mediaService.getFilePublicUrlByIdWithoutExpiry(institute.getLogoFileId());
                if (StringUtils.hasText(logoUrl)) {
                    return logoUrl;
                }
                // Fallback for older setups where public URL endpoint is unavailable.
                logoUrl = mediaService.getFileUrlById(institute.getLogoFileId());
                if (StringUtils.hasText(logoUrl)) {
                    return logoUrl;
                }
            } catch (Exception e) {
                log.debug("Could not load institute logo: {}", e.getMessage());
            }
        }
        return "";
    }

    private String applyIndexedFeeRowPlaceholders(String template, List<StudentFeePayment> feePayments,
            String currencySymbol) {
        String result = template;
        int index = 1;
        for (StudentFeePayment fp : feePayments) {
            BigDecimal expected = fp.getAmountExpected() != null ? fp.getAmountExpected() : BigDecimal.ZERO;
            BigDecimal paid = fp.getAmountPaid() != null ? fp.getAmountPaid() : BigDecimal.ZERO;
            BigDecimal adjustmentEffect = computeAdjustmentEffect(fp);
            BigDecimal balance = expected.add(adjustmentEffect).subtract(paid);
            BigDecimal concession = computeConcession(fp);
            BigDecimal penalty = computePenalty(fp);
            String adjustmentDisplay;
            String adjustmentTypeLabel;
            if (concession.signum() > 0) {
                adjustmentDisplay = "- " + currencySymbol + " " + concession.toPlainString() + " (Concession)";
                adjustmentTypeLabel = "Concession";
            } else if (penalty.signum() > 0) {
                adjustmentDisplay = "+ " + currencySymbol + " " + penalty.toPlainString() + " (Penalty)";
                adjustmentTypeLabel = "Penalty";
            } else {
                adjustmentDisplay = "";
                adjustmentTypeLabel = "";
            }
            String status = fp.getStatus() != null ? fp.getStatus() : "PENDING";
            String statusLabel = status.replace("_", " ");
            String statusClass = switch (status) {
                case "PAID" -> "badge-paid";
                case "PARTIAL_PAID" -> "badge-partial";
                default -> "badge-unpaid";
            };
            String dueDate = fp.getDueDate() != null
                    ? new java.text.SimpleDateFormat("dd MMM yyyy").format(fp.getDueDate())
                    : "N/A";
            String feeType = resolveFeeTypeName(fp);

            result = result
                    .replace("{{FEE_SR_NO_" + index + "}}", String.valueOf(index))
                    .replace("{{FEE_TYPE_" + index + "}}", feeType)
                    .replace("{{FEE_DUE_DATE_" + index + "}}", dueDate)
                    .replace("{{FEE_AMOUNT_EXPECTED_" + index + "}}", currencySymbol + " " + expected.toPlainString())
                    .replace("{{FEE_DISCOUNT_" + index + "}}", currencySymbol + " " + concession.toPlainString())
                    .replace("{{FEE_CONCESSION_" + index + "}}", currencySymbol + " " + concession.toPlainString())
                    .replace("{{FEE_PENALTY_" + index + "}}", currencySymbol + " " + penalty.toPlainString())
                    .replace("{{FEE_ADJUSTMENT_" + index + "}}", adjustmentDisplay)
                    .replace("{{FEE_ADJUSTMENT_TYPE_" + index + "}}", adjustmentTypeLabel)
                    .replace("{{FEE_AMOUNT_PAID_" + index + "}}", currencySymbol + " " + paid.toPlainString())
                    .replace("{{FEE_BALANCE_" + index + "}}", currencySymbol + " " + balance.toPlainString())
                    .replace("{{FEE_OUTSTANDING_" + index + "}}", currencySymbol + " " + balance.toPlainString())
                    .replace("{{FEE_STATUS_CLASS_" + index + "}}", statusClass)
                    .replace("{{FEE_STATUS_LABEL_" + index + "}}", statusLabel);
            index++;
        }
        return result;
    }

    private String resolveFeeTypeName(StudentFeePayment fp) {
        String feeTypeName = "Facility Fee";
        if (StringUtils.hasText(fp.getAsvId())) {
            try {
                AssignedFeeValue afv = assignedFeeValueRepository.findById(fp.getAsvId()).orElse(null);
                if (afv != null) {
                    FeeType feeType = feeTypeRepository.findById(afv.getFeeTypeId()).orElse(null);
                    if (feeType != null) {
                        feeTypeName = feeType.getName();
                    }
                }
            } catch (Exception e) {
                log.warn("Could not fetch fee type name for ASV ID: {}", fp.getAsvId(), e);
            }
        }
        return feeTypeName;
    }

    // ─── Fee Table HTML ──────────────────────────────────────────────────────

    /**
     * @param showAdjustmentColumn when false, no adjustment column is rendered (no approved concession or penalty exists).
     */
    private String buildFeeTableHtml(List<StudentFeePayment> feePayments, String currency,
            boolean showAdjustmentColumn) {
        String currencySymbol = getCurrencySymbol(currency);
        StringBuilder sb = new StringBuilder();
        sb.append("<table>");
        sb.append("<tr>")
                .append("<th>#</th>")
                .append("<th>Fee Type</th>")
                .append("<th>Due Date</th>")
                .append("<th>Amount Expected</th>");
        if (showAdjustmentColumn) {
            sb.append("<th>Adjustment</th>");
        }
        sb.append("<th>Amount Paid</th>")
                .append("<th>Outstanding</th>")
                .append("<th>Status</th>")
                .append("</tr>");

        int index = 1;
        for (StudentFeePayment fp : feePayments) {
            BigDecimal expected = fp.getAmountExpected() != null ? fp.getAmountExpected() : BigDecimal.ZERO;
            BigDecimal paid = fp.getAmountPaid() != null ? fp.getAmountPaid() : BigDecimal.ZERO;
            BigDecimal adjustmentEffect = computeAdjustmentEffect(fp);
            BigDecimal balance = expected.add(adjustmentEffect).subtract(paid);
            BigDecimal concession = computeConcession(fp);
            BigDecimal penalty = computePenalty(fp);
            String adjustmentCell;
            if (concession.signum() > 0) {
                adjustmentCell = "<span style=\"color:#047857;\">- " + currencySymbol + " "
                        + concession.toPlainString() + " (Concession)</span>";
            } else if (penalty.signum() > 0) {
                adjustmentCell = "<span style=\"color:#b91c1c;\">+ " + currencySymbol + " "
                        + penalty.toPlainString() + " (Penalty)</span>";
            } else {
                adjustmentCell = "-";
            }
            String status = fp.getStatus() != null ? fp.getStatus() : "PENDING";
            String dueDate = fp.getDueDate() != null
                    ? new java.text.SimpleDateFormat("dd MMM yyyy").format(fp.getDueDate())
                    : "N/A";

            String feeTypeName = "Facility Fee"; // Default fallback
            if (StringUtils.hasText(fp.getAsvId())) {
                try {
                    AssignedFeeValue afv = assignedFeeValueRepository.findById(fp.getAsvId()).orElse(null);
                    if (afv != null) {
                        FeeType feeType = feeTypeRepository.findById(afv.getFeeTypeId()).orElse(null);
                        if (feeType != null) {
                            feeTypeName = feeType.getName();
                        }
                    }
                } catch (Exception e) {
                    log.warn("Could not fetch fee type name for ASV ID: {}", fp.getAsvId(), e);
                }
            }

            sb.append("<tr>")
                    .append("<td>").append(index++).append("</td>")
                    .append("<td>").append(feeTypeName).append("</td>")
                    .append("<td>").append(dueDate).append("</td>")
                    .append("<td>").append(currencySymbol).append(" ").append(expected.toPlainString()).append("</td>");
            if (showAdjustmentColumn) {
                sb.append("<td>").append(adjustmentCell).append("</td>");
            }
            sb.append("<td>").append(currencySymbol).append(" ").append(paid.toPlainString()).append("</td>")
                    .append("<td>").append(currencySymbol).append(" ").append(balance.toPlainString()).append("</td>")
                    .append("<td class=\"status-").append(status).append("\">").append(status.replace("_", " "))
                    .append("</td>")
                    .append("</tr>");
        }

        sb.append("</table>");
        return sb.toString();
    }

    // ─── PDF Generation ──────────────────────────────────────────────────────

    private byte[] generatePdfFromHtml(String htmlContent) {
        try {
            String htmlWithCss;
            boolean isCompleteHtml = htmlContent.trim().toLowerCase().startsWith("<!doctype") ||
                    htmlContent.trim().toLowerCase().startsWith("<html");

            if (isCompleteHtml) {
                htmlWithCss = htmlContent;
            } else {
                htmlWithCss = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"/></head><body>" +
                        htmlContent + "</body></html>";
            }

            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();

            builder.useFont(() -> {
                try {
                    return this.getClass().getResourceAsStream("/fonts/Arial.ttf");
                } catch (Exception e) {
                    return null;
                }
            }, "Arial");

            String baseUri = "file:///";
            builder.withHtmlContent(sanitizeToXhtml(htmlWithCss), baseUri);
            builder.useDefaultPageSize(210f, 297f, PdfRendererBuilder.PageSizeUnits.MM); // A4 portrait

            builder.toStream(outputStream);
            builder.run();

            return outputStream.toByteArray();
        } catch (Exception e) {
            log.error("Error generating PDF from HTML for school fee receipt", e);
            throw new VacademyException("Failed to generate receipt PDF: " + e.getMessage());
        }
    }

    private String sanitizeToXhtml(String html) {
        // Fix common HTML entities that openhtmltopdf XML parser rejects
        String sanitizedHtml = html
                .replace("&copy;", "&#169;")
                .replace("&nbsp;", "&#160;")
                .replace("&mdash;", "&#8212;")
                .replace("&ndash;", "&#8211;")
                .replace("&reg;", "&#174;");

        Document doc = Jsoup.parse(sanitizedHtml);
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml);
        doc.outputSettings().escapeMode(Entities.EscapeMode.xhtml);
        return doc.html();
    }

    // ─── S3 Upload ───────────────────────────────────────────────────────────

    private String uploadReceiptToS3(byte[] pdfBytes, String receiptNumber, String instituteId) {
        try {
            String fileName = "receipt_" + receiptNumber + ".pdf";
            MultipartFile multipartFile = new InMemoryMultipartFile(
                    fileName, fileName, "application/pdf", pdfBytes);

            FileDetailsDTO fileDetails = mediaService.uploadFileV2(multipartFile);
            if (fileDetails != null && fileDetails.getId() != null) {
                log.debug("Receipt PDF uploaded to S3. File ID: {}", fileDetails.getId());
                return fileDetails.getId();
            } else {
                throw new VacademyException("Failed to upload receipt PDF to S3");
            }
        } catch (Exception e) {
            log.error("Error uploading receipt PDF to S3", e);
            throw new VacademyException("Failed to upload receipt PDF: " + e.getMessage());
        }
    }

    // ─── Save to DB ──────────────────────────────────────────────────────────

    private Invoice saveReceipt(String userId, String instituteId, InvoiceNumberAllocation allocation,
            String pdfFileId, BigDecimal amountPaid,
            BigDecimal totalExpected, BigDecimal totalPaid,
            BigDecimal totalConcession, BigDecimal totalPenalty,
            BigDecimal balanceDue, String currency,
            String source, String sourceId) {
        Invoice invoice = new Invoice();
        invoice.setInvoiceNumber(allocation.number());
        // The sequence position must be persisted alongside the number — it IS the
        // institute's counter, so a receipt saved without it is invisible to the next
        // allocation and its number would eventually be handed out again.
        invoice.setSeqNo(allocation.seqNo());
        invoice.setSeqScopeKey(allocation.scopeKey());
        invoice.setUserId(userId);
        invoice.setInstituteId(instituteId);
        invoice.setInvoiceDate(LocalDateTime.now());
        invoice.setDueDate(LocalDateTime.now());
        invoice.setSubtotal(totalExpected);
        invoice.setDiscountAmount(totalConcession);
        invoice.setTaxAmount(BigDecimal.ZERO);
        invoice.setTotalAmount(amountPaid);
        invoice.setCurrency(currency);
        invoice.setStatus("GENERATED");
        invoice.setPdfFileId(pdfFileId);
        invoice.setTaxIncluded(false);
        invoice.setSource(source);
        invoice.setSourceId(sourceId);

        // Save receipt metadata as JSON
        try {
            Map<String, Object> receiptData = new HashMap<>();
            receiptData.put("type", "SCHOOL_FEE_RECEIPT");
            receiptData.put("totalExpected", totalExpected);
            receiptData.put("totalPaid", totalPaid);
            receiptData.put("totalConcession", totalConcession);
            receiptData.put("totalPenalty", totalPenalty);
            receiptData.put("balanceDue", balanceDue);
            receiptData.put("amountPaidNow", amountPaid);
            ObjectMapper objectMapper = new ObjectMapper();
            invoice.setInvoiceDataJson(objectMapper.writeValueAsString(receiptData));
        } catch (Exception e) {
            log.warn("Failed to serialize receipt data to JSON", e);
        }

        invoice = invoiceRepository.save(invoice);
        log.debug("School fee receipt saved to database: {}", allocation.number());
        return invoice;
    }

    private void saveLineItems(Invoice invoice, List<StudentFeePayment> feePayments, String currency) {
        int index = 1;
        for (StudentFeePayment fp : feePayments) {
            InvoiceLineItem lineItem = new InvoiceLineItem();
            lineItem.setInvoice(invoice);
            lineItem.setItemType("FEE_INSTALLMENT");
            lineItem.setDescription("Installment #" + index + " (Due: "
                    + (fp.getDueDate() != null
                            ? new java.text.SimpleDateFormat("dd MMM yyyy").format(fp.getDueDate())
                            : "N/A")
                    + ")");
            lineItem.setQuantity(1);
            lineItem.setUnitPrice(fp.getAmountExpected() != null ? fp.getAmountExpected() : BigDecimal.ZERO);
            lineItem.setAmount(fp.getAmountPaid() != null ? fp.getAmountPaid() : BigDecimal.ZERO);
            lineItem.setSourceId(fp.getId());
            invoiceLineItemRepository.save(lineItem);
            index++;
        }
    }

    // ─── Email Sending ───────────────────────────────────────────────────────

    private void sendReceiptEmail(Invoice invoice, UserDTO user, Institute institute,
            String instituteId, byte[] pdfBytes, String receiptNumber) {
        try {
            if (user == null || !StringUtils.hasText(user.getEmail())) {
                log.warn("Cannot send receipt email: user or email is null for receipt: {}", receiptNumber);
                return;
            }

            // Load email template
            String subject = "Your Fee Receipt " + receiptNumber;
            String body;

            var emailTemplates = templateService.getTemplatesByInstituteAndType(instituteId, "EMAIL");
            var invoiceEmailTemplate = emailTemplates.stream()
                    .filter(t -> "Invoice Email".equals(t.getName()))
                    .findFirst();

            if (invoiceEmailTemplate.isPresent()) {
                subject = invoiceEmailTemplate.get().getSubject() != null
                        ? invoiceEmailTemplate.get().getSubject()
                        : subject;
                body = invoiceEmailTemplate.get().getContent() != null
                        ? invoiceEmailTemplate.get().getContent()
                        : buildDefaultReceiptEmailBody(user, receiptNumber);
            } else {
                body = buildDefaultReceiptEmailBody(user, receiptNumber);
            }

            // Replace placeholders in email
            String learnerName = user.getFullName() != null ? user.getFullName() : user.getEmail();
            body = body.replace("{{invoice_number}}", receiptNumber)
                    .replace("{{learner_name}}", learnerName)
                    .replace("{{invoice_pdf_link}}", "Please find your fee receipt attached to this email.");
            subject = subject.replace("{{invoice_number}}", receiptNumber)
                    .replace("{{learner_name}}", learnerName);

            // Build attachment
            String attachmentName = "receipt_" + receiptNumber + ".pdf";
            AttachmentUsersDTO.AttachmentDTO attachmentDTO = new AttachmentUsersDTO.AttachmentDTO();
            attachmentDTO.setAttachmentName(attachmentName);
            attachmentDTO.setAttachment(Base64.getEncoder().encodeToString(pdfBytes));

            AttachmentUsersDTO toUser = new AttachmentUsersDTO();
            toUser.setChannelId(user.getEmail());
            toUser.setUserId(user.getId());
            toUser.setPlaceholders(Map.of("email", user.getEmail()));
            toUser.setAttachments(List.of(attachmentDTO));

            AttachmentNotificationDTO attachmentNotification = AttachmentNotificationDTO.builder()
                    .body(body)
                    .subject(subject)
                    .notificationType("EMAIL")
                    .source("SCHOOL_FEE_RECEIPT")
                    .sourceId(invoice.getId())
                    .users(List.of(toUser))
                    .build();

            notificationService.sendAttachmentEmailViaUnified(List.of(attachmentNotification), instituteId);
            log.info("School fee receipt email sent to {} for receipt: {}", user.getEmail(), receiptNumber);

        } catch (Exception e) {
            log.error("Error sending school fee receipt email", e);
            // Don't throw — email failure shouldn't fail receipt generation
        }
    }

    private String buildDefaultReceiptEmailBody(UserDTO user, String receiptNumber) {
        String learnerName = user.getFullName() != null ? user.getFullName() : "Student";
        return "<html><body>"
                + "<p>Dear " + learnerName + ",</p>"
                + "<p>Please find your fee receipt " + receiptNumber + " attached to this email.</p>"
                + "<p>Thank you for your payment.</p>"
                + "<p>Regards,<br/>Accounts Department</p>"
                + "</body></html>";
    }

    // ─── Currency Helper ─────────────────────────────────────────────────────

    private String getCurrencySymbol(String currencyCode) {
        if (currencyCode == null)
            return "₹";
        return switch (currencyCode.toUpperCase()) {
            case "INR" -> "₹";
            case "USD" -> "$";
            case "EUR" -> "€";
            case "GBP" -> "£";
            default -> currencyCode;
        };
    }
}
