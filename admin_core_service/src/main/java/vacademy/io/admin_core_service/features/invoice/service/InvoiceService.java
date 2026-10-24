package vacademy.io.admin_core_service.features.invoice.service;

import vacademy.io.admin_core_service.features.invoice.util.InvoiceDefaultTemplatePicker;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.styledxmlparser.jsoup.Jsoup;
import com.itextpdf.styledxmlparser.jsoup.nodes.Document;
import com.itextpdf.styledxmlparser.jsoup.nodes.Entities;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.TemplateService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.*;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.admin_core_service.features.invoice.enums.InvoicePdfPlacement;
import vacademy.io.admin_core_service.features.payments.service.PaymentService;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLogLineItem;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.common.util.TemplateConditionals;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.invoice.dto.InvoicePackageContextProjection;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberAllocation;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberContext;
import vacademy.io.admin_core_service.features.session.dto.BatchInstituteProjection;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogLineItemRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.dto.InMemoryMultipartFile;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.common.util.PostalAddressFormatter;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class InvoiceService {

    @Autowired
    private vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService offlinePaymentDetailsService;

    @Autowired
    private InvoiceRepository invoiceRepository;

    @Autowired
    private InvoiceLineItemRepository invoiceLineItemRepository;

    @Autowired
    @org.springframework.context.annotation.Lazy
    private vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService adminDiscountService;

    @Autowired
    private InvoiceBillingProfileService invoiceBillingProfileService;

    @Autowired
    private InvoiceInstituteProfileService invoiceInstituteProfileService;

    @Autowired
    private vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private TemplateService templateService;

    @Autowired
    private InstituteRepository instituteRepository;

    // Owns invoice-number allocation (sequence + the institute's configured format).
    @Autowired
    private InvoiceNumberService invoiceNumberService;

    // Self-proxy: saveInvoiceWithMultiplePaymentLogs needs REQUIRES_NEW to honour its own
    // transaction boundary, and a direct internal call would bypass the Spring proxy and
    // silently run in the caller's transaction. @Lazy breaks the self-referential cycle.
    @Autowired
    @Lazy
    private InvoiceService self;

    @Autowired
    private AuthService authService;

    @Autowired
    private MediaService mediaService;

    @Autowired
    private PaymentLogLineItemRepository paymentLogLineItemRepository;

    @Autowired
    private InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository userPlanRepository;

    // Installment line items name themselves after their fee type ("Registration Fee",
    // "GP Rating Course Installments") rather than the course. student_fee_payment.fee_type_id
    // is never populated by the generator, so the name is resolved the long way round:
    // sfp.asv_id → assigned_fee_value.fee_type_id → fee_type.name.
    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository assignedFeeValueRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository feeTypeRepository;

    // Used by buildSfpInvoiceDTOs() to walk SFP → PaymentLog → Invoice so the synthetic
    // installment rows can carry the real Invoice's pdf_file_id / pdf_url. Avoids the
    // "No PDF" state on PAID/PARTIAL rows that actually have a persisted invoice.
    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository studentFeeAllocationLedgerRepository;

    @Autowired
    private StudentSessionRepository studentSessionRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository admissionPackageCourseRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository packageSessionInvitationRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.invoice.util.CourseTagResolver courseTagResolver;

    @Autowired
    private InstituteSettingService instituteSettingService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private vacademy.io.admin_core_service.features.notification_service.service.BillingContactRecipientResolver billingContactRecipientResolver;

    @Autowired
    private vacademy.io.admin_core_service.features.notification_service.service.InvoiceAdminCopyRecipientResolver invoiceAdminCopyRecipientResolver;

    @Autowired
    @Lazy
    private PaymentService paymentService;

    @Autowired
    private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository appliedCouponDiscountRepository;

    // Manual / offline payment recording on admin invoices ("Mark Paid" button).
    // Mirrors the CPO side-view offline flow but tied to an Invoice instead of a
    // UserPlan — userPlan is null on the resulting PaymentLog because admin invoices
    // aren't bound to an enrollment.
    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService paymentLogService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;

    // Paid live sessions: when a LIVE_SESSION invoice settles we flip the linked
    // registration's payment_status here. Repository-only dependency so the
    // live_session service layer never forms a bean cycle with InvoiceService.
    @Autowired
    private vacademy.io.admin_core_service.features.live_session.repository.SessionGuestRegistrationRepository sessionGuestRegistrationRepository;

    // Same no-cycle rule: read the session's payment option (per-session gateway
    // choice) via the repository, not LiveSessionPaymentService.
    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository paymentOptionRepositoryForVendor;

    @Value("${default.learner.portal.url:https://learner.vacademy.io}")
    private String learnerPortalUrl;

    @Value("${default.learner.portal.invoice.pay.path:/pay/invoice}")
    private String invoicePayPath;

    /** Type for institute invoice PDF layout templates (how line items, totals, etc. are shown in the PDF — like default_invoice.html). Not email templates. */
    private static final String INVOICE_TEMPLATE_TYPE = "INVOICE";
    private static final String INVOICE_STATUS_GENERATED = "GENERATED";

    /**
     * Builds the description text shown on a discount/coupon invoice line item.
     * For COUPON-type rows we look up the actual coupon code (e.g. "SAVE20") via
     * the line item's source_id (FK to AppliedCouponDiscount) so the receipt
     * cites the redeemed code instead of a generic "Discount: coupon" label.
     * Falls back to the legacy "Discount: <source>" string if anything is
     * missing — we never want a malformed lookup to break invoice generation.
     */
    private String buildDiscountDescription(PaymentLogLineItem item) {
        String source = item.getSource();
        String type = item.getType();
        // Admin-granted discount: the grant reason is an internal note, never printed.
        if ("ADMIN_DISCOUNT".equals(type)) {
            return "Discount";
        }
        boolean looksLikeCoupon = (type != null && type.toUpperCase().contains("COUPON"))
                || (source != null && source.toLowerCase().contains("coupon"));
        if (looksLikeCoupon && item.getSourceId() != null) {
            try {
                String code = appliedCouponDiscountRepository.findById(item.getSourceId())
                        .map(acd -> acd.getCouponCode() != null ? acd.getCouponCode().getCode() : null)
                        .orElse(null);
                if (code != null && !code.isBlank()) {
                    return "Coupon " + code;
                }
            } catch (Exception e) {
                log.warn("Failed to resolve coupon code for invoice line item {}: {}",
                        item.getId(), e.getMessage());
            }
        }
        return source != null ? "Discount: " + source : "Discount";
    }
    private static final String INVOICE_STATUS_PENDING_PAYMENT = "PENDING_PAYMENT";
    private static final String INVOICE_STATUS_PAID = "PAID";
    // Invoice raised automatically for a paid live-session registration;
    // source_id = session_guest_registrations.id.
    private static final String INVOICE_SOURCE_LIVE_SESSION = "LIVE_SESSION";
    // Terminal "voided" status: the admin created the invoice in error (wrong amount,
    // wrong learner, …). The payment link stops working and it can never be marked
    // paid again; it stays in the list for record-keeping. See rejectInvoice().
    private static final String INVOICE_STATUS_REJECTED = "REJECTED";
    // Shared, reused for the invoice_data_json read/merge helpers below — ObjectMapper is
    // thread-safe and expensive to construct; avoid a fresh instance per call/per invoice row.
    private static final ObjectMapper INVOICE_JSON_MAPPER = new ObjectMapper();
    // Values for the {{doc_type}} invoice-number token — short by design, since they sit
    // inside a length-capped number rather than being displayed on their own.
    // (DEFAULT_INVOICE_PREFIX / DATE_FORMATTER went with the hardcoded INV-yyyyMMdd-NNNN
    // generator; the prefix and date are now format tokens the admin controls.)
    private static final String DOC_TYPE_ENROLLMENT = "INV";
    private static final String DOC_TYPE_ADMIN = "ADM";
    private static final String DOC_TYPE_LIVE_SESSION = "LS";

    /**
     * Doc type and counter namespace for proforma invoices. The namespace is what keeps a
     * proforma out of the institute's real invoice series — see
     * {@code InvoiceNumberContext.seqNamespace}.
     */
    private static final String DOC_TYPE_PROFORMA = "PRO";

    /** {@code invoice_data_json} keys carrying proforma state. See {@link #finalizeProformaOnPayment}. */
    private static final String JSON_KEY_PROFORMA = "proforma";
    private static final String JSON_KEY_PROFORMA_DOC_TYPE = "proformaDocType";
    private static final String JSON_KEY_PROFORMA_NUMBER = "proformaNumber";
    private static final String JSON_KEY_FINALIZED_AT = "finalizedAt";

    private static final String DOCUMENT_TITLE_INVOICE = "INVOICE";
    private static final String DOCUMENT_TITLE_PROFORMA = "PROFORMA INVOICE";

    private static final String DOCUMENT_NUMBER_LABEL_INVOICE = "Invoice Number";
    private static final String DOCUMENT_NUMBER_LABEL_PROFORMA = "Proforma Number";

    /** Learner-facing noun for the document, for emails and alerts. */
    private static final String DOCUMENT_NOUN_INVOICE = "invoice";
    private static final String DOCUMENT_NOUN_PROFORMA = "proforma invoice";

    private static final DateTimeFormatter DISPLAY_DATE_FORMATTER = DateTimeFormatter.ofPattern("dd MMM yyyy");

    // ── Editable-placeholder support (admin invoice preview / overrides) ──────────────
    // Matches {{placeholder}} tokens (lowercase + underscore) in an invoice template.
    private static final java.util.regex.Pattern PLACEHOLDER_PATTERN =
            java.util.regex.Pattern.compile("\\{\\{([a-z_]+)\\}\\}");

    /**
     * Text placeholders an admin may override per-invoice. Anything NOT in this set
     * (derived amounts, currency, HTML blocks like line_items / institute_logo, and the
     * date fields which travel as real timestamps) is ignored if it appears in the
     * overrides map — this whitelist is the security boundary for what admin-supplied
     * text can reach the template.
     */
    private static final Set<String> EDITABLE_OVERRIDE_KEYS = Set.of(
            "invoice_number", "user_name", "user_email", "user_address", "user_tax_info",
            "place_of_supply", "institute_name", "institute_address", "institute_contact",
            "tax_label", "tax_rate", "country", "country_code", "tax_registration_number",
            "hsn_code", "notes",
            "course_name", "course_code", "user_mobile", "institute_tagline",
            "parent_name", "year_group", "billing_month", "billing_year", "institute_email");

    /**
     * Overrides that only make sense for a single billed user. Stripped for bulk
     * (multi-user) creation so one user's identity / invoice number can't bleed onto
     * everyone else's invoice (and to avoid unique-invoice-number collisions).
     */
    private static final Set<String> USER_SCOPED_OVERRIDE_KEYS = Set.of(
            "invoice_number", "user_name", "user_email", "user_address", "user_tax_info",
            "place_of_supply", "parent_name", "year_group");

    /** Display metadata for a template placeholder, powering the review/preview panel. */
    private record PlaceholderMeta(String label, String group, boolean editable, String inputType) {}

    /**
     * Ordered metadata for every placeholder the review panel can surface. Only the
     * entries whose key actually appears in the institute's template are returned by
     * {@link #computeResolvedValues}. Insertion order drives display grouping.
     */
    private static final LinkedHashMap<String, PlaceholderMeta> PLACEHOLDER_META = new LinkedHashMap<>();
    static {
        PLACEHOLDER_META.put("invoice_number", new PlaceholderMeta("Invoice Number", "INVOICE", true, "text"));
        PLACEHOLDER_META.put("invoice_date", new PlaceholderMeta("Invoice Date", "INVOICE", true, "date"));
        PLACEHOLDER_META.put("due_date", new PlaceholderMeta("Due Date", "INVOICE", true, "date"));
        // The month a monthly fee invoice is for. Read off the due date, not the invoice date:
        // a schedule billed in advance is raised in the previous month but falls due in the one
        // it pays for. {{billing_period}} is the two together and follows any edit to either.
        PLACEHOLDER_META.put("billing_month", new PlaceholderMeta("Billing Month", "INVOICE", true, "text"));
        PLACEHOLDER_META.put("billing_year", new PlaceholderMeta("Billing Year", "INVOICE", true, "text"));
        PLACEHOLDER_META.put("billing_period",
                new PlaceholderMeta("Billing Period (month + year)", "INVOICE", false, "text"));
        PLACEHOLDER_META.put("user_name", new PlaceholderMeta("Billed To", "BILL TO", true, "text"));
        PLACEHOLDER_META.put("user_email", new PlaceholderMeta("Email", "BILL TO", true, "text"));
        // For a learner who is a child, the invoice is addressed to the parent. Both default to
        // the learner's own custom fields (see learnerProfilePlaceholderFor) and are editable.
        PLACEHOLDER_META.put("parent_name", new PlaceholderMeta("Parent / Guardian", "BILL TO", true, "text"));
        PLACEHOLDER_META.put("year_group", new PlaceholderMeta("Year Group / Class", "BILL TO", true, "text"));
        PLACEHOLDER_META.put("user_address", new PlaceholderMeta("Address", "BILL TO", true, "textarea"));
        PLACEHOLDER_META.put("user_tax_info", new PlaceholderMeta("Tax ID (GSTIN/VAT)", "BILL TO", true, "text"));
        PLACEHOLDER_META.put("place_of_supply", new PlaceholderMeta("Place of Supply", "BILL TO", true, "text"));
        PLACEHOLDER_META.put("institute_name", new PlaceholderMeta("Institute Name", "INSTITUTE", true, "text"));
        PLACEHOLDER_META.put("institute_address", new PlaceholderMeta("Institute Address", "INSTITUTE", true, "textarea"));
        PLACEHOLDER_META.put("institute_contact", new PlaceholderMeta("Institute Contact", "INSTITUTE", true, "text"));
        PLACEHOLDER_META.put("institute_email", new PlaceholderMeta("Institute Email", "INSTITUTE", true, "text"));
        PLACEHOLDER_META.put("institute_tagline",
                new PlaceholderMeta("Institute Tagline", "INSTITUTE", true, "text"));
        PLACEHOLDER_META.put("tax_label", new PlaceholderMeta("Tax Label", "TAX", true, "text"));
        PLACEHOLDER_META.put("tax_rate", new PlaceholderMeta("Tax Rate", "TAX", true, "text"));
        PLACEHOLDER_META.put("country", new PlaceholderMeta("Country", "TAX", true, "text"));
        PLACEHOLDER_META.put("country_code", new PlaceholderMeta("Country Code", "TAX", true, "text"));
        PLACEHOLDER_META.put("tax_registration_number", new PlaceholderMeta("Tax Registration No.", "TAX", true, "text"));
        PLACEHOLDER_META.put("hsn_code", new PlaceholderMeta("HSN/SAC Code", "TAX", true, "text"));
        PLACEHOLDER_META.put("subtotal", new PlaceholderMeta("Subtotal", "AMOUNTS", false, "text"));
        // The gross (pre-discount) price and the discount taken off it. Templates need both to
        // show "original → less discount → total"; without them a discounted invoice can only
        // print the net and leaves the reader no way to see a discount was applied.
        PLACEHOLDER_META.put("plan_price", new PlaceholderMeta("Original Price", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("discount_amount", new PlaceholderMeta("Discount", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("discount_row", new PlaceholderMeta("Discount Line (hidden when none)", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("tax_amount", new PlaceholderMeta("Tax Amount", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("total_amount", new PlaceholderMeta("Total", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("totals_rows",
                new PlaceholderMeta("Totals block (amount, discount, tax, paid)", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("currency", new PlaceholderMeta("Currency", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("notes", new PlaceholderMeta("Notes", "NOTES", true, "textarea"));
        // A fee receipt answers "where does this payment leave me", which an invoice does not:
        // Money here is NOT editable, for the same reason subtotal and total_amount are not: a
        // receipt that can be retyped is a receipt that can contradict the ledger. Only the
        // descriptive fields are editable, and those are whitelisted in EDITABLE_OVERRIDE_KEYS
        // so that an admin edit actually reaches the PDF instead of being silently dropped.
        // the course price, what was already paid, what is still owed and the next installment.
        // Registered here so the template editor offers them and an admin can override any one
        // on a single receipt. Derived in buildReceiptFigures from the learner fee schedule.
        PLACEHOLDER_META.put("course_name", new PlaceholderMeta("Course Name", "RECEIPT", true, "text"));
        PLACEHOLDER_META.put("course_code", new PlaceholderMeta("Course Code", "RECEIPT", true, "text"));
        PLACEHOLDER_META.put("course_code_bracketed",
                new PlaceholderMeta("Course Code in brackets (hidden when none)", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("user_mobile", new PlaceholderMeta("Mobile No.", "RECEIPT", true, "text"));
        PLACEHOLDER_META.put("course_fees", new PlaceholderMeta("Course Fees", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("total_fees", new PlaceholderMeta("Total Fees", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("previous_paid", new PlaceholderMeta("Total Previous Paid", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("fees_paid_now", new PlaceholderMeta("Fees Paid Now", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("total_fees_due", new PlaceholderMeta("Total Fees Due", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("total_amount_paid", new PlaceholderMeta("Total Amount Paid", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("next_installment_amount",
                new PlaceholderMeta("Next Installment Amount", "RECEIPT", false, "text"));
        PLACEHOLDER_META.put("next_installment_date",
                new PlaceholderMeta("Next Installment Due On", "RECEIPT", false, "date"));
        PLACEHOLDER_META.put("amount_in_words", new PlaceholderMeta("Amount In Words", "RECEIPT", false, "text"));
        // Only the mode ("Cash", "Cheque"): {{payment_method}} also names the account the money
        // went into, which an institute may not want printed on a learner's receipt.
        PLACEHOLDER_META.put("payment_mode", new PlaceholderMeta("Payment Mode", "RECEIPT", false, "text"));
        // Single-item invoice layouts (one row: description / qty / unit price / amount) and the
        // customer-details names an email-editor template uses. The aliases resolve to the same
        // values as their canonical keys (customer_name = user_name, total = total_amount, ...);
        // the item fields come from the plan line, see primaryLineItem. Read-only: the canonical
        // keys are the editable ones.
        PLACEHOLDER_META.put("customer_name", new PlaceholderMeta("Customer Name", "BILL TO", false, "text"));
        PLACEHOLDER_META.put("customer_email", new PlaceholderMeta("Customer Email", "BILL TO", false, "text"));
        PLACEHOLDER_META.put("practice_name", new PlaceholderMeta("Practice / Clinic Name", "BILL TO", false, "text"));
        PLACEHOLDER_META.put("job_title", new PlaceholderMeta("Job Title", "BILL TO", false, "text"));
        PLACEHOLDER_META.put("state", new PlaceholderMeta("State", "BILL TO", false, "text"));
        PLACEHOLDER_META.put("customer_country", new PlaceholderMeta("Customer Country", "BILL TO", false, "text"));
        PLACEHOLDER_META.put("date_issued", new PlaceholderMeta("Date Issued", "INVOICE", false, "date"));
        PLACEHOLDER_META.put("date_paid", new PlaceholderMeta("Date Paid", "INVOICE", false, "date"));
        PLACEHOLDER_META.put("abn", new PlaceholderMeta("ABN (Tax Registration No.)", "TAX", false, "text"));
        PLACEHOLDER_META.put("invoice_item_description",
                new PlaceholderMeta("Item Description", "ITEM", false, "text"));
        PLACEHOLDER_META.put("invoice_item_tag", new PlaceholderMeta("Course Tags", "ITEM", false, "text"));
        PLACEHOLDER_META.put("qty", new PlaceholderMeta("Quantity", "ITEM", false, "text"));
        PLACEHOLDER_META.put("unit_price", new PlaceholderMeta("Unit Price", "ITEM", false, "text"));
        PLACEHOLDER_META.put("amount", new PlaceholderMeta("Item Amount", "ITEM", false, "text"));
        PLACEHOLDER_META.put("total", new PlaceholderMeta("Total", "AMOUNTS", false, "text"));
        PLACEHOLDER_META.put("balance_due", new PlaceholderMeta("Balance Due", "AMOUNTS", false, "text"));
    }

    /**
     * Unicode font for the invoice PDF. Candidates are checked in order; the first
     * one present on the classpath is embedded (under the family names templates
     * use) so glyphs like the rupee sign (₹) render. If NONE is present, the PDF
     * falls back to the base-14 font (current behavior) and currency symbols fall
     * back to ASCII — so this is fully backward compatible.
     *
     * To enable the real symbols, drop a Unicode TTF (e.g. NotoSans-Regular.ttf or
     * DejaVuSans.ttf) into src/main/resources/fonts/.
     */
    private static final String[] INVOICE_FONT_CANDIDATES = {
            "/fonts/NotoSans-Regular.ttf",
            "/fonts/DejaVuSans.ttf",
    };
    private static final String RESOLVED_INVOICE_FONT_PATH = resolveInvoiceFontResource();
    private static final boolean UNICODE_INVOICE_FONT_AVAILABLE = RESOLVED_INVOICE_FONT_PATH != null;

    private static String resolveInvoiceFontResource() {
        for (String path : INVOICE_FONT_CANDIDATES) {
            try (java.io.InputStream is = InvoiceService.class.getResourceAsStream(path)) {
                if (is != null) {
                    return path;
                }
            } catch (Exception ignored) {
                // try next candidate
            }
        }
        return null;
    }

    /**
     * Looks up the Invoice by id and returns a usable presigned PDF URL. If the row's
     * {@code pdf_file_id} is null (typical when local-dev S3 upload failed at create
     * time), regenerates the PDF, persists the new fileId, and returns the URL — so
     * subsequent reads hit the fast path. Returns null only when the invoice doesn't
     * exist or regeneration fails.
     *
     * <p>This is the single canonical "give me a downloadable PDF for this invoice"
     * path. {@code /v1/invoices/{invoiceId}/download} routes through here; the listing
     * surfaces real invoice ids on synthetic SFP rows (see {@link #buildSfpInvoiceDTOs})
     * so the same endpoint serves both real-Invoice and SFP-derived listings.
     */
    @Transactional
    public String resolveOrRegeneratePdfUrl(String invoiceId) {
        if (invoiceId == null || invoiceId.isBlank()) return null;
        Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
        if (invoice == null) return null;
        if (StringUtils.hasText(invoice.getPdfFileId())) {
            String url = mediaService.getFilePublicUrlById(invoice.getPdfFileId());
            if (StringUtils.hasText(url)) return url;
        }
        // Missing or unresolvable fileId → regenerate on demand.
        String regenFileId = regenerateInvoicePdf(invoice);
        if (!StringUtils.hasText(regenFileId)) return null;
        invoice.setPdfFileId(regenFileId);
        invoiceRepository.save(invoice);
        return mediaService.getFilePublicUrlById(regenFileId);
    }

    /**
     * Rebuilds the invoice PDF from the persisted Invoice's data and re-uploads to S3.
     * Returns the new file id, or null if any step fails. Caller is responsible for
     * persisting the new id on the Invoice row.
     */
    /**
     * Rewrites tax-inclusive line prices to their taxable value so the item column adds up to the
     * subtotal, leaving the tax to be stated once in the totals block.
     *
     * <p>Scales proportionally rather than dividing each line by (1 + rate) independently: with
     * several lines, per-line division rounds each one and the roundings need not sum back to the
     * subtotal the totals block prints. The last line absorbs the remainder, so item total ==
     * subtotal exactly, to the paisa.
     *
     * <p>Leaves everything alone when the gross is zero or negative (nothing meaningful to split)
     * and when a line carries no amount.
     */
    private void restateLineItemsNetOfTax(List<InvoiceLineItemData> items, BigDecimal subtotal) {
        if (items == null || items.isEmpty() || subtotal == null) return;
        BigDecimal gross = BigDecimal.ZERO;
        for (InvoiceLineItemData item : items) {
            if (item.getAmount() != null) gross = gross.add(item.getAmount());
        }
        if (gross.compareTo(BigDecimal.ZERO) <= 0) return;

        BigDecimal allocated = BigDecimal.ZERO;
        for (int i = 0; i < items.size(); i++) {
            InvoiceLineItemData item = items.get(i);
            if (item.getAmount() == null) continue;
            BigDecimal net = (i == items.size() - 1)
                    ? subtotal.subtract(allocated)
                    : item.getAmount().multiply(subtotal).divide(gross, 2, RoundingMode.HALF_UP);
            allocated = allocated.add(net);
            item.setAmount(net);
            Integer qty = item.getQuantity();
            item.setUnitPrice(qty != null && qty > 0
                    ? net.divide(BigDecimal.valueOf(qty), 2, RoundingMode.HALF_UP)
                    : net);
        }
    }

    private String regenerateInvoicePdf(Invoice invoice) {
        try {
            List<PaymentLog> paymentLogs = invoicePaymentLogMappingRepository
                    .findPaymentLogsByInvoiceId(invoice.getId());
            // Discriminate on UserPlan presence, NOT list emptiness: an admin invoice gains a
            // MANUAL/gateway PaymentLog mapping (with userPlan=null) once payment is initiated or
            // marked paid, so emptiness would wrongly route it to the enrollment builder — which
            // dereferences userPlan and NPEs. Treat it as an admin invoice unless at least one
            // mapped log carries a real UserPlan.
            boolean hasEnrollmentLog = paymentLogs.stream().anyMatch(pl -> pl.getUserPlan() != null);
            InvoiceData invoiceData;
            if (!hasEnrollmentLog) {
                // Admin invoice — rebuild from the persisted row + line items + stored overrides
                // so the PDF regenerates with the admin's edits (independent of payment state).
                invoiceData = buildInvoiceDataFromPersistedInvoice(invoice);
                if (invoiceData == null || invoiceData.getLineItems() == null
                        || invoiceData.getLineItems().isEmpty()) {
                    return null;
                }
            } else {
                // Enrollment invoice — reuse the same builder path generateInvoice uses.
                invoiceData = buildInvoiceDataFromMultiplePaymentLogs(
                        paymentLogs, invoice.getInstituteId());
                // Preserve the original invoice number and date; this is a PDF refresh, not a new
                // bill. The builder stamps "now", so a receipt regenerated days later showed the
                // regeneration day as its receipt date.
                invoiceData.setInvoiceNumber(invoice.getInvoiceNumber());
                if (invoice.getInvoiceDate() != null) {
                    invoiceData.setInvoiceDate(invoice.getInvoiceDate());
                }
                // Carry forward any admin overrides / notes stored for this invoice.
                applyStoredOverrides(invoice, invoiceData);
            }
            String templateHtml = loadInvoiceTemplate(invoice.getInstituteId());
            String filledTemplate = replaceTemplatePlaceholders(templateHtml, invoiceData);
            byte[] pdfBytes = generatePdfFromHtml(filledTemplate);
            return uploadInvoiceToS3(pdfBytes, invoice.getInvoiceNumber(), invoice.getInstituteId());
        } catch (Exception e) {
            log.warn("regenerateInvoicePdf failed for invoice {}: {}", invoice.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * Result of invoice generation: the persisted {@link Invoice}, the freshly-rendered PDF bytes,
     * and whether an invoice already existed for this payment log.
     *
     * <p>{@code pdfBytes} is {@code null} when {@link #isAlreadyExisted()} is true (a duplicate /
     * retried webhook — we do not re-render the PDF in that case) or when generation produced no
     * PDF. Callers that want to attach the PDF elsewhere (e.g. the payment-confirmation email) must
     * null-check it.</p>
     */
    public static class InvoiceGenerationResult {
        private final Invoice invoice;
        private final byte[] pdfBytes;
        private final boolean alreadyExisted;
        /**
         * How many payment logs this invoice covers — i.e. how many courses one
         * order bought. The confirmation email needs it to say "4 courses" rather
         * than implying the total belongs to the single course its own log names.
         */
        private final int paymentLogCount;

        public InvoiceGenerationResult(Invoice invoice, byte[] pdfBytes, boolean alreadyExisted) {
            this(invoice, pdfBytes, alreadyExisted, 1);
        }

        public InvoiceGenerationResult(Invoice invoice, byte[] pdfBytes, boolean alreadyExisted,
                int paymentLogCount) {
            this.invoice = invoice;
            this.pdfBytes = pdfBytes;
            this.alreadyExisted = alreadyExisted;
            this.paymentLogCount = Math.max(1, paymentLogCount);
        }

        public int getPaymentLogCount() {
            return paymentLogCount;
        }

        public Invoice getInvoice() {
            return invoice;
        }

        public byte[] getPdfBytes() {
            return pdfBytes;
        }

        public boolean isAlreadyExisted() {
            return alreadyExisted;
        }
    }

    /**
     * Main method to generate invoice after payment confirmation
     * This method supports multiple payment logs for a single invoice (v2
     * multi-package enrollments)
     */
    @Transactional
    public Invoice generateInvoice(UserPlan userPlan, PaymentLog paymentLog, String instituteId) {
        return generateInvoice(userPlan, paymentLog, instituteId, true);
    }

    /**
     * Overload that controls whether the invoice email is sent. The online CPO/SCHOOL payment
     * webhook generates the invoice purely so a real, downloadable {@code INV-} record exists,
     * but it already sends its own fee receipt — so it passes {@code sendEmail=false} to avoid a
     * duplicate learner email. All existing callers use the 3-arg overload and keep emailing.
     *
     * @param sendEmail whether to email the generated invoice PDF to the learner
     */
    @Transactional
    public Invoice generateInvoice(UserPlan userPlan, PaymentLog paymentLog, String instituteId, boolean sendEmail) {
        return generateInvoiceWithResult(userPlan, paymentLog, instituteId, sendEmail).getInvoice();
    }

    /**
     * Same as {@link #generateInvoice(UserPlan, PaymentLog, String, boolean)} but also returns the
     * freshly-rendered PDF bytes so callers can attach the invoice to a different email (e.g. the
     * payment-confirmation email when {@code INVOICE_SETTING.invoicePdfPlacement =
     * PAYMENT_CONFIRMATION_EMAIL}). {@code pdfBytes} is null when the invoice already existed
     * (duplicate webhook) — see {@link InvoiceGenerationResult#isAlreadyExisted()}.
     */
    @Transactional
    public InvoiceGenerationResult generateInvoiceWithResult(UserPlan userPlan, PaymentLog paymentLog,
            String instituteId, boolean sendEmail) {
        try {
            log.info("Starting invoice generation for userPlanId: {}, paymentLogId: {}, instituteId: {}",
                    userPlan.getId(), paymentLog.getId(), instituteId);

            // Check if this payment log is already part of an invoice
            if (invoicePaymentLogMappingRepository.existsByPaymentLogId(paymentLog.getId())) {
                log.info("Payment log {} is already part of an invoice. Skipping invoice generation.",
                        paymentLog.getId());
                return new InvoiceGenerationResult(findInvoiceByPaymentLogId(paymentLog.getId()), null, true);
            }

            // Check if this is a v2 multi-package enrollment (has shared order ID)
            List<PaymentLog> paymentLogs = findRelatedPaymentLogsForMultiPackage(paymentLog, instituteId);

            log.info("Generating invoice for {} payment log(s) - {} multi-package enrollment detected",
                    paymentLogs.size(), paymentLogs.size() > 1 ? "v2" : "single");

            // 1. Build invoice data from payment log(s)
            InvoiceData invoiceData = buildInvoiceDataFromMultiplePaymentLogs(paymentLogs, instituteId);

            // 2. Generate invoice number and set it in invoice data
            allocateInvoiceNumber(instituteId, invoiceData, DOC_TYPE_ENROLLMENT);

            // 3. Load institute-specific template
            String templateHtml = loadInvoiceTemplate(instituteId);

            // 4-7. Render the PDF, upload it and save the invoice — retrying with the next
            // number if two concurrent webhooks allocated the same one. The number is baked
            // into both the PDF and the S3 filename, so a retry has to redo all of it; this
            // only fires on a genuine same-instant race (the allocator already skips numbers
            // that are visibly taken).
            RenderedInvoice rendered = renderAndSaveWithCollisionRetry(
                    instituteId, invoiceData, templateHtml, paymentLogs, DOC_TYPE_ENROLLMENT);
            Invoice invoice = rendered.invoice();
            byte[] pdfBytes = rendered.pdfBytes();
            String invoiceNumber = invoice.getInvoiceNumber();

            // 8. Send email with PDF attached (don't fail if email fails)
            if (sendEmail) {
                try {
                    sendInvoiceEmail(invoice, invoiceData.getUser(), instituteId, pdfBytes);
                } catch (Exception e) {
                    log.error("Failed to send invoice email for invoice: {}. Invoice generation will continue.",
                            invoiceNumber, e);
                }
            }

            log.info("Invoice generated successfully: {} with {} payment log(s)",
                    invoiceNumber, paymentLogs.size());
            return new InvoiceGenerationResult(invoice, pdfBytes, false, paymentLogs.size());

        } catch (Exception e) {
            log.error("Error generating invoice for userPlanId: {}, paymentLogId: {}",
                    userPlan.getId(), paymentLog.getId(), e);
            throw new VacademyException("Failed to generate invoice: " + e.getMessage(), e);
        }
    }

    /**
     * Find invoice by payment log ID
     */
    private Invoice findInvoiceByPaymentLogId(String paymentLogId) {
        List<InvoicePaymentLogMapping> mappings = invoicePaymentLogMappingRepository
                .findByPaymentLog(paymentLogRepository.findById(paymentLogId)
                        .orElseThrow(() -> new VacademyException("Payment log not found: " + paymentLogId)));
        if (mappings.isEmpty()) {
            throw new VacademyException("Invoice not found for payment log: " + paymentLogId);
        }
        return mappings.get(0).getInvoice();
    }

    /**
     * Find related payment logs that should be grouped in the same invoice
     * This method detects v2 multi-package enrollments by checking for payment logs
     * with the same order ID
     *
     * @param paymentLog  The payment log to check for related logs
     * @param instituteId The institute ID
     * @return List of payment logs that should be grouped together (single log if
     *         no related logs found)
     */
    /** Visible for testing. */
    List<PaymentLog> findRelatedPaymentLogsForMultiPackage(PaymentLog paymentLog, String instituteId) {
        try {
            // Check if this payment log has payment_specific_data with order_id
            String orderId = extractOrderIdFromPaymentLog(paymentLog);

            if (orderId != null && (isMultiPackageOrderId(orderId) || isParentChildOrderId(orderId))) {
                log.debug("Detected multi-course order ID: {} for payment log: {}", orderId, paymentLog.getId());

                // Find all payment logs with the same order ID that are PAID and not already
                // invoiced
                List<PaymentLog> relatedLogs = paymentLogRepository.findAllByOrderIdInOriginalRequest(orderId);

                // Filter out logs that are already invoiced and ensure they have correct status
                List<PaymentLog> uninvoicedLogs = relatedLogs.stream()
                        .filter(log -> !invoicePaymentLogMappingRepository.existsByPaymentLogId(log.getId()))
                        .filter(log -> "PAID".equals(log.getPaymentStatus())) // Ensure paid status
                        // The ORDER's own log carries the gateway total and no UserPlan; it is
                        // the parent of these lines, not a line itself. Including it would put
                        // a planless log first and NPE the invoice builder.
                        .filter(log -> log.getUserPlan() != null)
                        .collect(Collectors.toList());

                if (uninvoicedLogs.size() > 1) {
                    log.info("Found {} related payment logs for one invoice with order ID: {}",
                            uninvoicedLogs.size(), orderId);
                    return uninvoicedLogs;
                }
            }
        } catch (Exception e) {
            log.warn("Error checking for related payment logs: {}", e.getMessage());
        }

        // Default: return single payment log (backward compatibility)
        log.debug("Using single payment log (no multi-package grouping): {}", paymentLog.getId());
        return List.of(paymentLog);
    }

    /**
     * Extract order ID from payment log's payment_specific_data
     */
    private String extractOrderIdFromPaymentLog(PaymentLog paymentLog) {
        try {
            if (paymentLog.getPaymentSpecificData() != null && !paymentLog.getPaymentSpecificData().isEmpty()) {
                // Parse the JSON payment_specific_data
                ObjectMapper objectMapper = new ObjectMapper();
                @SuppressWarnings("unchecked")
                Map<String, Object> paymentData = objectMapper.readValue(paymentLog.getPaymentSpecificData(),
                        Map.class);

                // Check for originalRequest -> orderId
                if (paymentData.containsKey("originalRequest")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> originalRequest = (Map<String, Object>) paymentData.get("originalRequest");
                    if (originalRequest.containsKey("order_id")) {
                        return (String) originalRequest.get("order_id");
                    }
                    if (originalRequest.containsKey("orderId")) {
                        return (String) originalRequest.get("orderId");
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Could not extract order ID from payment log {}: {}", paymentLog.getId(), e.getMessage());
        }
        return null;
    }

    /**
     * Check if order ID indicates a v2 multi-package enrollment
     * v2 API uses order IDs starting with "MP" prefix
     */
    private boolean isMultiPackageOrderId(String orderId) {
        return orderId != null && orderId.startsWith("MP");
    }

    /**
     * True when this order id names a PARENT payment log that fanned out into one
     * child log per course — the shape a product-page checkout produces.
     *
     * The legacy multi-package flow announced itself with an "MP" prefix on a
     * synthetic order id. A product-page order has no such marker: its children
     * share the parent log's UUID as their order id, so the prefix test failed and
     * every course was invoiced separately. A real ₹949 four-subject order
     * produced four invoices totalling ₹1,396 and four payment-confirmation
     * emails, none of which matched the learner's bank statement.
     *
     * Asks the data instead of a naming convention: an order is a parent when a
     * log with that id exists and records the children it paid for.
     */
    boolean isParentChildOrderId(String orderId) {
        if (!StringUtils.hasText(orderId)) {
            return false;
        }
        try {
            return paymentLogRepository.findById(orderId)
                    .map(PaymentLog::getPaymentSpecificData)
                    .filter(StringUtils::hasText)
                    .map(data -> data.contains("childPaymentLogIds"))
                    .orElse(false);
        } catch (Exception e) {
            log.debug("Could not check order {} for child payment logs: {}", orderId, e.getMessage());
            return false;
        }
    }

    /**
     * Whether each grouped log states what IT was charged, or merely repeats the
     * order total.
     *
     * The legacy multi-package flow copies the whole order total onto every child
     * (see MultiPackageLearnerEnrollService), so summing those amounts multiplies
     * the invoice by the number of courses — hence that flow's lines are priced
     * from the payment plan instead. A parent/child order allocates the real
     * total across its children, so there the log's own amount IS the truth, and
     * falling back to the plan's list price would re-inflate a discounted basket
     * back to full price.
     */
    boolean logsCarryTheirOwnAmount(List<PaymentLog> paymentLogs) {
        if (paymentLogs.size() <= 1) {
            return true;
        }
        String orderId = extractOrderIdFromPaymentLog(paymentLogs.get(0));
        // No order id at all: the payments were grouped by their caller (an admission package),
        // each for its own course's share, so each carries its own amount. Only the legacy
        // "MP" order repeats the order total on every log.
        return orderId == null || isParentChildOrderId(orderId);
    }

    /**
     * Find related payment logs that should be grouped in the same invoice
     *
     * NOTE: This legacy method is kept for backward compatibility but is now
     * replaced by
     * findRelatedPaymentLogsForMultiPackage for v2 multi-package support
     */
    @Deprecated
    private List<PaymentLog> findRelatedPaymentLogs(PaymentLog paymentLog, String instituteId) {
        return findRelatedPaymentLogsForMultiPackage(paymentLog, instituteId);
    }

    /**
     * Build invoice data from multiple PaymentLogs (for multi-batch enrollment)
     * This method works for BOTH single and multiple payment log scenarios:
     * - Single payment log: Creates invoice with 1 line item (1 plan/course)
     * - Multiple payment logs: Creates invoice with multiple line items (multiple
     * plans/courses)
     */
    private InvoiceData buildInvoiceDataFromMultiplePaymentLogs(List<PaymentLog> paymentLogs, String instituteId) {
        if (paymentLogs == null || paymentLogs.isEmpty()) {
            throw new VacademyException("Payment logs list cannot be empty");
        }
        final boolean perLogAmounts = logsCarryTheirOwnAmount(paymentLogs);

        log.debug("Building invoice data from {} payment log(s) - supports both single and multiple scenarios",
                paymentLogs.size());

        // Get first payment log for user and basic info
        PaymentLog firstPaymentLog = paymentLogs.get(0);
        String userId = firstPaymentLog.getUserId();
        if (userId == null) {
            throw new VacademyException("User ID is required in payment log");
        }

        // Fetch user
        UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(userId)).get(0);
        if (user == null) {
            throw new VacademyException("User not found: " + userId);
        }

        // Fetch institute
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        // Get invoice settings
        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
        Boolean taxIncluded = (Boolean) invoiceSettings.getOrDefault("taxIncluded", false);
        Double taxRateValue = invoiceSettings.get("taxRate") != null
                ? ((Number) invoiceSettings.get("taxRate")).doubleValue()
                : 0.0;
        // INVOICE_SETTING.taxRate is stored as a percentage (e.g. 18 for 18%) — same
        // convention createAdminInvoices uses. Convert to a fraction for the math
        // below (`1 + taxRate` divisors etc.). Skipping the /100 made the divisor
        // explode (e.g. 1 + 18 = 19) and the resulting subtotal/tax split nonsensical,
        // which is why the Add User → offline payment → generate-invoice path didn't
        // render visible tax.
        BigDecimal taxRate = BigDecimal.valueOf(taxRateValue)
                .divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP);
        String taxLabel = (String) invoiceSettings.getOrDefault("taxLabel", "Tax");

        // Per-package-type tax components (INVOICE_SETTING.country). When any components
        // are configured, tax is computed PER LINE ITEM by the line's package type
        // (falling back to the default list); otherwise the legacy single-rate path
        // (taxRate) runs unchanged so existing institutes are unaffected.
        Map<String, Object> countryConfig = asStringObjectMap(invoiceSettings.get("country"));
        List<Map<String, Object>> defaultTaxComponents = asComponentList(countryConfig.get("taxComponents"));
        Map<String, Object> taxComponentsByType = asStringObjectMap(countryConfig.get("taxComponentsByPackageType"));
        boolean hasComponentConfig = !defaultTaxComponents.isEmpty() || !taxComponentsByType.isEmpty();
        // label -> [rate, summed amount], insertion-ordered for stable rendering.
        java.util.LinkedHashMap<String, BigDecimal[]> componentAccumulator = new java.util.LinkedHashMap<>();
        BigDecimal componentSubtotalSum = BigDecimal.ZERO;
        BigDecimal componentTaxSum = BigDecimal.ZERO;

        // Aggregate data from all payment logs
        BigDecimal totalPaymentAmount = BigDecimal.ZERO;
        BigDecimal totalPlanPrice = BigDecimal.ZERO;
        BigDecimal totalDiscountAmount = BigDecimal.ZERO;
        List<InvoiceLineItemData> allLineItems = new ArrayList<>();
        // Use currency from payment log (primary source), fallback to plan currency if
        // needed
        String paymentLogCurrency = firstPaymentLog.getCurrency();
        String planCurrency = firstPaymentLog.getUserPlan() != null
                && firstPaymentLog.getUserPlan().getPaymentPlan() != null
                        ? firstPaymentLog.getUserPlan().getPaymentPlan().getCurrency()
                        : null;

        log.info("Building invoice - PaymentLog currency: '{}', Plan currency: '{}'", paymentLogCurrency, planCurrency);

        // Validate and normalize currency - filter out invalid values like "#" or
        // single characters
        String currency = normalizeAndValidateCurrency(paymentLogCurrency, planCurrency);

        log.info("Final currency used for invoice: '{}'", currency);

        String paymentMethod = invoicePaymentMethod(firstPaymentLog);
        String transactionId = invoiceTransactionId(firstPaymentLog);
        LocalDateTime paymentDate = firstPaymentLog.getDate() != null
                ? firstPaymentLog.getDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDateTime()
                : LocalDateTime.now();

        // Process each payment log
        for (PaymentLog paymentLog : paymentLogs) {
            if (paymentLog.getUserPlan() == null) {
                log.warn("Payment log {} has no user plan, skipping", paymentLog.getId());
                continue;
            }

            UserPlan userPlan = paymentLog.getUserPlan();
            PaymentPlan paymentPlan = userPlan.getPaymentPlan();
            if (paymentPlan == null) {
                log.warn("User plan {} has no payment plan, skipping", userPlan.getId());
                continue;
            }

            // Get payment log line items (discounts, coupons, etc.)
            List<PaymentLogLineItem> paymentLogLineItems = paymentLogLineItemRepository.findByPaymentLog(paymentLog);

            // Calculate plan price first (the locked regional price when the plan has one)
            BigDecimal planPrice = BigDecimal.valueOf(RegionalPriceLock.listPrice(userPlan));

            // For multi-package invoices, use the plan's actual_price (per-book price)
            // instead of paymentLog.getPaymentAmount() (which may contain the total gateway charge)
            BigDecimal paymentAmount;
            if (paymentLogs.size() > 1 && !perLogAmounts) {
                // Legacy multi-package: every child log repeats the order total, so the
                // line has to be priced from the plan or the invoice multiplies.
                paymentAmount = planPrice;
            } else if (paymentLog.getPaymentAmount() != null && paymentLog.getPaymentAmount() > 0) {
                paymentAmount = BigDecimal.valueOf(paymentLog.getPaymentAmount());
            } else {
                paymentAmount = planPrice;
            }
            totalPaymentAmount = totalPaymentAmount.add(paymentAmount);

            // Per-line tax by package type (only when components are configured).
            if (hasComponentConfig) {
                String packageType = resolvePackageType(paymentLog);
                List<Map<String, Object>> comps = effectiveTaxComponents(
                        defaultTaxComponents, taxComponentsByType, packageType);
                BigDecimal rateFraction = totalComponentRateFraction(comps);
                BigDecimal lineSubtotal = paymentAmount.divide(
                        BigDecimal.ONE.add(rateFraction), 2, RoundingMode.HALF_UP);
                componentSubtotalSum = componentSubtotalSum.add(lineSubtotal);
                BigDecimal lineTax = paymentAmount.subtract(lineSubtotal);
                componentTaxSum = componentTaxSum.add(lineTax);
                // Split THIS line's tax across its components so they add back to it exactly.
                // Computing each component off the subtotal independently rounds each one up:
                // 4,571.43 x 2.5% = 114.2857 -> 114.29 for CGST and again for SGST, which is
                // 228.58 against a tax line of 228.57. A GST invoice whose components do not
                // sum to the tax charged is wrong on its face. The last component takes the
                // remainder, which is also what a manually prepared invoice does.
                BigDecimal allocatedLineTax = BigDecimal.ZERO;
                int lastIndex = comps.size() - 1;
                for (int ci = 0; ci < comps.size(); ci++) {
                    Map<String, Object> comp = comps.get(ci);
                    String label = comp.get("label") != null ? comp.get("label").toString() : "";
                    if (label.isEmpty()) {
                        continue;
                    }
                    BigDecimal rate;
                    try {
                        rate = new BigDecimal(comp.get("rate") != null ? comp.get("rate").toString() : "0");
                    } catch (NumberFormatException e) {
                        rate = BigDecimal.ZERO;
                    }
                    BigDecimal amt = (ci == lastIndex)
                            ? lineTax.subtract(allocatedLineTax)
                            : lineSubtotal.multiply(rate)
                                    .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
                    allocatedLineTax = allocatedLineTax.add(amt);
                    final BigDecimal compRate = rate;
                    BigDecimal[] acc = componentAccumulator.computeIfAbsent(label,
                            k -> new BigDecimal[] { compRate, BigDecimal.ZERO });
                    acc[1] = acc[1].add(amt);
                }
            }

            // Calculate discount for line items display. Coupon/referral discounts arrive as
            // payment_log_line_item rows; a CPO discount lives on the fee schedule instead, so
            // fall back to that when the line items carry none.
            BigDecimal discountAmount = calculateDiscountAmount(paymentLogLineItems, planPrice);
            if (discountAmount.compareTo(BigDecimal.ZERO) <= 0 && paymentLog.getUserPlan() != null) {
                discountAmount = feeScheduleDiscount(paymentLog.getUserPlan().getId(), paymentAmount);
            }

            totalPlanPrice = totalPlanPrice.add(planPrice);
            totalDiscountAmount = totalDiscountAmount.add(discountAmount);

            // Build line items for this payment log - use payment amount
            List<InvoiceLineItemData> lineItems = buildLineItemsForPlan(
                    paymentPlan, paymentLogLineItems, paymentLog.getId(), paymentAmount, planPrice);
            allLineItems.addAll(lineItems);
        }

        // Use payment amount from payment log as the total amount
        BigDecimal totalAmount = totalPaymentAmount;

        // Calculate tax and subtotal.
        BigDecimal subtotal;
        BigDecimal taxAmount;
        String taxLineDescription;
        List<Map<String, Object>> aggregatedTaxComponents = null;

        if (hasComponentConfig) {
            // Per-line per-package-type tax, summed across the invoice.
            subtotal = componentSubtotalSum;
            taxAmount = componentTaxSum;
            taxLineDescription = taxLabel;
            aggregatedTaxComponents = new ArrayList<>();
            for (Map.Entry<String, BigDecimal[]> e : componentAccumulator.entrySet()) {
                Map<String, Object> m = new HashMap<>();
                m.put("label", e.getKey());
                m.put("rate", e.getValue()[0]);
                m.put("amount", e.getValue()[1]);
                aggregatedTaxComponents.add(m);
            }
        } else {
            // Legacy single-rate path: payment amount treated as tax-inclusive total.
            BigDecimal divisor = BigDecimal.ONE.add(taxRate);
            subtotal = totalAmount.divide(divisor, 2, RoundingMode.HALF_UP);
            taxAmount = totalAmount.subtract(subtotal);
            taxLineDescription = taxLabel + " @ " + taxRate.multiply(BigDecimal.valueOf(100)).setScale(0) + "%";
        }

        // How tax appears depends on whether the price the learner paid already contains it.
        //
        // Tax-INCLUSIVE (taxIncluded = true): the line prices ARE gross. Adding a separate tax row
        // then shows the same money twice on the face of the document -- an item column reading
        // 4,800.00 + 228.57 = 5,028.57 against a total of 4,800.00. Restate each line at its
        // taxable value instead, so the column sums to the subtotal and the tax is stated once, in
        // the totals block: 4,571.43 + 228.57 GST = 4,800.00, which is the usual GST layout.
        //
        // Tax-EXCLUSIVE (the default, and every institute that has never set taxIncluded): tax
        // genuinely sits on top of the line prices, so it keeps its own row exactly as before.
        boolean pricesIncludeTax = Boolean.TRUE.equals(taxIncluded)
                && taxAmount != null && taxAmount.compareTo(BigDecimal.ZERO) > 0;
        if (pricesIncludeTax) {
            restateLineItemsNetOfTax(allLineItems, subtotal);
        } else if (taxAmount != null && taxAmount.compareTo(BigDecimal.ZERO) > 0) {
            InvoiceLineItemData taxItem = InvoiceLineItemData.builder()
                    .itemType("TAX")
                    .description(taxLineDescription)
                    .quantity(1)
                    .unitPrice(taxAmount)
                    .amount(taxAmount)
                    .build();
            allLineItems.add(taxItem);
        }

        // Build invoice data
        InvoiceData invoiceData = InvoiceData.builder()
                .user(user)
                .institute(institute)
                .userPlan(paymentLogs.get(0).getUserPlan()) // Primary user plan for backward compatibility
                .paymentPlan(paymentLogs.get(0).getUserPlan().getPaymentPlan())
                .paymentLog(firstPaymentLog) // Primary payment log
                .paymentLogLineItems(new ArrayList<>()) // Aggregated across all logs
                .invoiceDate(LocalDateTime.now())
                .dueDate(LocalDateTime.now())
                .planPrice(totalPlanPrice)
                .discountAmount(totalDiscountAmount)
                .taxAmount(taxAmount)
                .subtotal(subtotal)
                .totalAmount(totalAmount)
                .currency(currency)
                .taxIncluded(taxIncluded)
                .taxRate(taxRate)
                .taxLabel(taxLabel)
                .paymentMethod(paymentMethod)
                .transactionId(transactionId)
                .paymentDate(paymentDate)
                .lineItems(allLineItems)
                .aggregatedTaxComponents(aggregatedTaxComponents)
                .overrides(organisationBillTo(firstPaymentLog.getUserPlan(), user))
                .receiptPaymentLogs(new ArrayList<>(paymentLogs))
                .build();

        log.debug("Invoice data built successfully from {} payment logs", paymentLogs.size());
        return invoiceData;
    }

    /**
     * BILL TO for a channel-partner (sub-org) subscription: the organisation, not the person
     * who clicked pay.
     *
     * <p>The registration wizard collects the ORGANISATION's address and stamps it on the spawned
     * sub-org institute — never on the admin's own auth user record. So the default
     * {@code {{user_address}}} (auth {@code address_line}) rendered blank on every VLE invoice,
     * and {@code {{user_name}}} named the admin rather than the company being invoiced.
     *
     * <p>Keyed on the org-level invite (tag {@code SUB_ORG}) rather than {@code UserPlan.source}:
     * learners enrolled under a partner also carry {@code source=SUB_ORG}, and they must keep
     * being billed personally. Returns null — "derive everything as before" — for every other
     * purchase, so no other institute's invoice changes.
     */
    private Map<String, String> organisationBillTo(UserPlan plan, UserDTO admin) {
        try {
            if (plan == null) {
                return null;
            }
            EnrollInvite invite = plan.getEnrollInvite();
            if (invite == null || !EnrollInviteTag.SUB_ORG.name().equals(invite.getTag())) {
                return null;
            }
            String subOrgId = StringUtils.hasText(invite.getSubOrgId()) ? invite.getSubOrgId() : plan.getSubOrgId();
            if (!StringUtils.hasText(subOrgId)) {
                return null;
            }
            Institute org = instituteRepository.findById(subOrgId).orElse(null);
            if (org == null) {
                return null;
            }

            Map<String, String> billTo = new HashMap<>();
            if (StringUtils.hasText(org.getInstituteName())) {
                billTo.put("user_name", org.getInstituteName().trim());
            }
            List<String> lines = new ArrayList<>();
            if (admin != null && StringUtils.hasText(admin.getFullName())) {
                lines.add("Attn: " + admin.getFullName().trim());
            }
            String postal = composePostalAddress(org.getAddress(), org.getCity(), org.getState(),
                    org.getPinCode(), org.getCountry());
            if (StringUtils.hasText(postal)) {
                lines.add(postal);
            }
            if (!lines.isEmpty()) {
                billTo.put("user_address", String.join("\n", lines));
            }
            return billTo.isEmpty() ? null : billTo;
        } catch (Exception e) {
            // Best-effort: a lookup failure must not stop the invoice — fall back to the user.
            log.warn("Could not resolve organisation bill-to for plan {}: {}",
                    plan.getId(), e.getMessage());
            return null;
        }
    }

    /** See {@link PostalAddressFormatter#compose}; kept here so the invoice tests read naturally. */
    static String composePostalAddress(String street, String city, String state, String pinCode,
            String country) {
        return PostalAddressFormatter.compose(street, city, state, pinCode, country);
    }

    /** See {@link PostalAddressFormatter#dedupeSegments}. */
    static String dedupeAddressSegments(String street) {
        return PostalAddressFormatter.dedupeSegments(street);
    }

    /**
     * Build line items for a single plan (used in multi-payment log scenario)
     * For multi-package enrollments, creates descriptive line items for each
     * package session
     */
    /** @param grossPlanPrice the UserPlan's list price — base, or its locked regional price */
    private List<InvoiceLineItemData> buildLineItemsForPlan(PaymentPlan paymentPlan,
            List<PaymentLogLineItem> paymentLogLineItems,
            String paymentLogId,
            BigDecimal paymentAmount,
            BigDecimal grossPlanPrice) {
        List<InvoiceLineItemData> lineItems = new ArrayList<>();

        // CPO / fee-installment payments are allocated across specific StudentFeePayment
        // installments (tracked in StudentFeeAllocationLedger). When that's the case, list the
        // installment(s) actually settled by THIS payment instead of a single course/plan line —
        // the package name was misleading on an installment invoice. Regular SUBSCRIPTION/ONE_TIME
        // payments create no ledger rows, so they fall through to the plan line item unchanged.
        // Resolved up-front because the installment lines want it too: an installment reads far
        // better as "<Course> installment 2" than a bare "Installment #2".
        String description = buildPackageSessionDescription(paymentPlan, paymentLogId);
        if (description == null || description.trim().isEmpty()) {
            description = paymentPlan != null && paymentPlan.getName() != null ? paymentPlan.getName()
                    : "Package Enrollment";
            log.warn("Using fallback description for payment log: {}", paymentLogId);
        }

        List<InvoiceLineItemData> installmentItems = buildInstallmentLineItems(paymentLogId, description);
        if (!installmentItems.isEmpty()) {
            lineItems.addAll(installmentItems);
        } else {

            // Main plan item — show GROSS plan price (actualPrice) here so the
            // discount line items can subtract from it visually. Using the net
            // gateway-captured amount instead would render as
            // "Course ₹450, Coupon −₹50" which sums to ₹400 instead of the ₹450
            // actually charged. Falls back to paymentAmount when paymentPlan is
            // unavailable so we don't blank the line.
            BigDecimal grossUnitPrice = paymentPlan != null
                    ? grossPlanPrice
                    : paymentAmount;
            InvoiceLineItemData planItem = InvoiceLineItemData.builder()
                    .itemType("PLAN")
                    .description(description.trim())
                    .quantity(1)
                    .unitPrice(grossUnitPrice)
                    .amount(grossUnitPrice)
                    .sourceId(paymentLogId) // Store payment log ID as source
                    .build();
            lineItems.add(planItem);
        }

        // Discount items for this plan
        for (PaymentLogLineItem item : paymentLogLineItems) {
            if (item.getType() != null && (item.getType().contains("DISCOUNT") ||
                    item.getType().contains("COUPON") || item.getType().contains("REFERRAL"))) {

                BigDecimal discountValue = BigDecimal.ZERO;
                if (item.getAmount() != null) {
                    if (item.getAmount() < 0) {
                        discountValue = BigDecimal.valueOf(Math.abs(item.getAmount()));
                    } else {
                        discountValue = BigDecimal.valueOf(item.getAmount());
                    }
                }

                if (discountValue.compareTo(BigDecimal.ZERO) > 0) {
                    InvoiceLineItemData discountItem = InvoiceLineItemData.builder()
                            .itemType(item.getType())
                            .description(buildDiscountDescription(item))
                            .quantity(1)
                            .unitPrice(discountValue.negate())
                            .amount(discountValue.negate())
                            .sourceId(item.getId())
                            .build();
                    lineItems.add(discountItem);
                }
            }
        }

        return lineItems;
    }

    /**
     * Builds one invoice line item per StudentFeePayment installment actually settled by the
     * given payment log, sourced from {@link StudentFeeAllocationLedger}. This is what turns a
     * CPO / fee-installment invoice from a single "course name" line into the specific
     * installments paid in that transaction.
     *
     * <p>Returns an empty list when the payment log has no ledger rows (i.e. it is not a
     * fee/CPO payment), so the caller falls back to the plan line item and regular
     * SUBSCRIPTION/ONE_TIME invoices are unaffected. Any failure here also returns empty so
     * invoice generation degrades gracefully to the plan line rather than breaking.</p>
     *
     * @param paymentLogId the payment log whose allocations should be itemized
     * @return per-installment line items (possibly empty)
     */
    /**
     * The fee type's display name for a bill, via sfp.asv_id → assigned_fee_value.fee_type_id →
     * fee_type.name. Null when the chain can't be resolved, so callers fall back to the course.
     * (student_fee_payment.fee_type_id exists but the generator never populates it, so it can't
     * be used as a shortcut here.)
     */
    private String feeTypeName(String asvId) {
        if (!StringUtils.hasText(asvId)) {
            return null;
        }
        try {
            return assignedFeeValueRepository.findById(asvId)
                    .map(afv -> afv.getFeeTypeId())
                    .filter(StringUtils::hasText)
                    .flatMap(ftId -> feeTypeRepository.findById(ftId))
                    .map(ft -> ft.getName())
                    .filter(StringUtils::hasText)
                    .orElse(null);
        } catch (Exception e) {
            log.warn("Could not resolve fee type name for assignedFeeValue {}: {}", asvId, e.getMessage());
            return null;
        }
    }

    /**
     * The list-price equivalent of what this payment allocated to a bill, i.e. the allocation
     * scaled back up by the bill's own discount ratio (original_amount / amount_expected).
     *
     * <p>Line items show gross so the invoice reads "gross, less discount, total". Taking
     * original_amount directly would overstate a part payment — a ₹3,000 payment against a
     * ₹10,000 installment would print ₹10,000 — so it is scaled by the share actually paid.
     * Falls back to the allocated amount whenever the ratio can't be computed, which keeps
     * undiscounted bills (original == expected) exactly as they were.
     */
    private BigDecimal grossForAllocation(StudentFeePayment sfp, BigDecimal allocated) {
        if (sfp == null || allocated == null || allocated.compareTo(BigDecimal.ZERO) <= 0) {
            return allocated != null ? allocated : BigDecimal.ZERO;
        }
        BigDecimal expected = sfp.getAmountExpected();
        BigDecimal original = sfp.getOriginalAmount();
        if (expected == null || original == null
                || expected.compareTo(BigDecimal.ZERO) <= 0
                || original.compareTo(expected) <= 0) {
            return allocated;
        }
        return allocated.multiply(original).divide(expected, 2, RoundingMode.HALF_UP);
    }

    /** Due date ascending, nulls last — the order the fee receipt and the side-view both use. */
    private static int compareByDueDate(StudentFeePayment a, StudentFeePayment b) {
        java.util.Date da = a.getDueDate();
        java.util.Date db = b.getDueDate();
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da.compareTo(db);
    }

    private List<InvoiceLineItemData> buildInstallmentLineItems(String paymentLogId, String courseLabel) {
        List<InvoiceLineItemData> items = new ArrayList<>();
        if (paymentLogId == null) {
            return items;
        }
        try {
            List<vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger> ledgers =
                    studentFeeAllocationLedgerRepository.findByPaymentLogId(paymentLogId);
            if (ledgers == null || ledgers.isEmpty()) {
                return items;
            }

            // A single installment can receive multiple ledger rows; sum what THIS payment
            // allocated to each, preserving first-seen order.
            Map<String, BigDecimal> allocatedBySfp = new java.util.LinkedHashMap<>();
            for (vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger ledger : ledgers) {
                if (ledger.getStudentFeePaymentId() == null) {
                    continue;
                }
                BigDecimal amt = ledger.getAmountAllocated() != null ? ledger.getAmountAllocated() : BigDecimal.ZERO;
                allocatedBySfp.merge(ledger.getStudentFeePaymentId(), amt, BigDecimal::add);
            }
            if (allocatedBySfp.isEmpty()) {
                return items;
            }

            List<StudentFeePayment> sfps = studentFeePaymentRepository.findAllById(allocatedBySfp.keySet());
            // Stable, human-friendly order: by due date ascending (mirrors the fee receipt).
            sfps.sort(InvoiceService::compareByDueDate);

            // Installment numbers must be the bill's position in the WHOLE plan, not its position
            // among the bills this payment happened to settle. Numbering per payment made the
            // second payment's line read "Installment 1" again, so two invoices for the same
            // learner both claimed to be for the first installment.
            Map<String, Integer> ordinalBySfp = new java.util.HashMap<>();
            // How many bills each fee type has on this plan. A fee type billed only once — a
            // one-off registration fee — reads better as "Registration Fee" than
            // "Registration Fee installment 1", so the number is only appended when there is
            // actually a sequence to distinguish.
            Map<String, Integer> billsPerFeeType = new java.util.HashMap<>();
            Map<String, String> feeTypeKeyBySfp = new java.util.HashMap<>();
            String userPlanId = sfps.stream()
                    .map(StudentFeePayment::getUserPlanId)
                    .filter(java.util.Objects::nonNull)
                    .findFirst().orElse(null);
            if (userPlanId != null) {
                List<StudentFeePayment> planBills = studentFeePaymentRepository.findByUserPlanId(userPlanId);
                if (planBills != null && !planBills.isEmpty()) {
                    planBills.sort(InvoiceService::compareByDueDate);
                    // Numbering runs within a fee type, not across the plan: with a registration
                    // fee plus three course installments, the course instalments should read 1..3
                    // rather than 2..4 because an unrelated fee happened to be billed first.
                    Map<String, Integer> positionPerFeeType = new java.util.HashMap<>();
                    for (StudentFeePayment bill : planBills) {
                        String key = bill.getAsvId() != null ? bill.getAsvId() : "";
                        feeTypeKeyBySfp.put(bill.getId(), key);
                        billsPerFeeType.merge(key, 1, Integer::sum);
                        int next = positionPerFeeType.merge(key, 1, Integer::sum);
                        ordinalBySfp.put(bill.getId(), next);
                    }
                }
            }

            String courseName = StringUtils.hasText(courseLabel) ? courseLabel.trim() : null;
            java.text.SimpleDateFormat dueFmt = new java.text.SimpleDateFormat("dd MMM yyyy");
            int fallbackIndex = 1;
            for (StudentFeePayment sfp : sfps) {
                BigDecimal allocated = allocatedBySfp.getOrDefault(sfp.getId(), BigDecimal.ZERO);
                String due = sfp.getDueDate() != null ? dueFmt.format(sfp.getDueDate()) : "N/A";
                int number = ordinalBySfp.getOrDefault(sfp.getId(), fallbackIndex);

                // The fee type's own name when the admin gave it one ("Registration Fee"),
                // otherwise the course. A learner's invoice should say what the money was for.
                String label = feeTypeName(sfp.getAsvId());
                if (!StringUtils.hasText(label)) {
                    label = courseName;
                }
                boolean numbered = billsPerFeeType.getOrDefault(
                        feeTypeKeyBySfp.getOrDefault(sfp.getId(), ""), 1) > 1;
                String description = (StringUtils.hasText(label)
                        ? label + (numbered ? " installment " + number : "")
                        : "Installment #" + number)
                        + " (Due: " + due + ")";

                // Line carries the GROSS, with the discount subtracted once in the totals block —
                // the usual invoice convention, and it reconciles: gross - discount = amount paid.
                // Grossed up from what this payment actually allocated rather than taken straight
                // from original_amount, so a part payment shows its own share of the list price
                // instead of the whole installment.
                items.add(InvoiceLineItemData.builder()
                        .itemType("FEE_INSTALLMENT")
                        .description(description)
                        .quantity(1)
                        .unitPrice(grossForAllocation(sfp, allocated))
                        .amount(grossForAllocation(sfp, allocated))
                        .sourceId(sfp.getId())
                        .build());
                fallbackIndex++;
            }
        } catch (Exception e) {
            log.warn("Failed to build CPO installment line items for paymentLog {}: {}. "
                    + "Falling back to plan line item.", paymentLogId, e.getMessage());
            return new ArrayList<>();
        }
        return items;
    }

    /**
     * Public entry point for "what course did this payment buy?", reusing the exact resolution
     * the invoice line item uses (enroll-invite name → batch name → plan name). The
     * payment-confirmation email fills {@code {{course_name}}} through here so the course label
     * on the mail and on the invoice can never disagree.
     *
     * <p>Kept as a method here rather than injecting InvoiceService into the notification
     * service: InvoiceService → PaymentLogService → PaymentNotificatonService already exists, so
     * the reverse edge would close a bean cycle. PaymentLogService holds both and passes the
     * resolved name down instead.
     *
     * @return the course/plan description, or null when the payment log can't be resolved
     */
    public String resolveCourseDescription(String paymentLogId) {
        if (!StringUtils.hasText(paymentLogId)) {
            return null;
        }
        try {
            PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElse(null);
            PaymentPlan paymentPlan = paymentLog != null && paymentLog.getUserPlan() != null
                    ? paymentLog.getUserPlan().getPaymentPlan()
                    : null;
            return buildPackageSessionDescription(paymentPlan, paymentLogId);
        } catch (Exception e) {
            log.warn("Could not resolve course description for payment log {}: {}", paymentLogId, e.getMessage());
            return null;
        }
    }

    /**
     * Build descriptive text for package session in invoice line item
     * For multi-package enrollments, includes level and session information
     */
    private String buildPackageSessionDescription(PaymentPlan paymentPlan, String paymentLogId) {
        try {
            // Get the payment log to access user plan and enroll invite
            PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElse(null);
            if (paymentLog == null || paymentLog.getUserPlan() == null) {
                log.warn("Payment log or user plan not found for ID: {}", paymentLogId);
                return getFallbackDescription(paymentPlan);
            }

            UserPlan userPlan = paymentLog.getUserPlan();

            // Primary source: EnrollInvite name (always available, contains book name)
            // Format: "{level} {package_name} {session_name}" e.g. "buy Blue umbrella store 1"
            if (userPlan.getEnrollInvite() != null
                    && userPlan.getEnrollInvite().getName() != null
                    && !userPlan.getEnrollInvite().getName().trim().isEmpty()) {
                String enrollInviteName = userPlan.getEnrollInvite().getName().trim();
                log.debug("Using enroll invite name for invoice line item: {}", enrollInviteName);
                return enrollInviteName;
            }

            // Fallback: try to get from package session via SSIGM
            List<StudentSessionInstituteGroupMapping> mappings = studentSessionRepository
                    .findAllByUserPlanIdAndStatusIn(userPlan.getId(),
                            List.of("ACTIVE", "INVITED", "ABANDONED_CART", "DETAILS_FILLED"));

            if (mappings != null && !mappings.isEmpty()) {
                StudentSessionInstituteGroupMapping mapping = mappings.get(0);
                String packageSessionId = null;
                if (mapping.getDestinationPackageSession() != null) {
                    packageSessionId = mapping.getDestinationPackageSession().getId();
                } else if (mapping.getPackageSession() != null) {
                    packageSessionId = mapping.getPackageSession().getId();
                }

                if (packageSessionId != null && !packageSessionId.isEmpty()) {
                    Optional<BatchInstituteProjection> batchInfoOpt = packageSessionRepository
                            .findBatchAndInstituteByPackageSessionId(packageSessionId);
                    if (batchInfoOpt.isPresent()) {
                        String batchName = batchInfoOpt.get().getBatchName();
                        if (batchName != null && !batchName.trim().isEmpty()) {
                            return batchName.trim();
                        }
                    }
                }
            }

            log.warn("Could not resolve description from enroll invite or SSIGM for payment log {}", paymentLogId);
        } catch (Exception e) {
            log.error("Error building package session description for payment log {}: {}",
                    paymentLogId, e.getMessage(), e);
        }

        // Final fallback to payment plan name
        return getFallbackDescription(paymentPlan);
    }

    /**
     * Get fallback description when package session info is not available
     */
    private String getFallbackDescription(PaymentPlan paymentPlan) {
        if (paymentPlan == null) {
            return "Package Enrollment";
        }
        String planName = paymentPlan.getName();
        String planDesc = paymentPlan.getDescription();

        if (planName != null && !planName.trim().isEmpty()) {
            if (planDesc != null && !planDesc.trim().isEmpty()) {
                return planName.trim() + " - " + planDesc.trim();
            }
            return planName.trim();
        }

        return "Package Enrollment";
    }

    /**
     * Build invoice data from UserPlan, PaymentLog, and related entities (legacy
     * method for single payment log)
     */
    private InvoiceData buildInvoiceData(UserPlan userPlan, PaymentLog paymentLog, String instituteId) {
        log.debug("Building invoice data for userPlanId: {}", userPlan.getId());

        // Fetch user
        UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(userPlan.getUserId())).get(0);
        if (user == null) {
            throw new VacademyException("User not found: " + userPlan.getUserId());
        }

        // Fetch institute
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        // Get payment plan
        PaymentPlan paymentPlan = userPlan.getPaymentPlan();
        if (paymentPlan == null) {
            throw new VacademyException("Payment plan not found for user plan: " + userPlan.getId());
        }

        // Get payment log line items (discounts, coupons, etc.)
        List<PaymentLogLineItem> paymentLogLineItems = paymentLogLineItemRepository.findByPaymentLog(paymentLog);

        // Get invoice settings from institute
        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);

        // Extract tax configuration
        Boolean taxIncluded = (Boolean) invoiceSettings.getOrDefault("taxIncluded", false);
        Double taxRateValue = invoiceSettings.get("taxRate") != null
                ? ((Number) invoiceSettings.get("taxRate")).doubleValue()
                : 0.0;
        // INVOICE_SETTING.taxRate is stored as a percentage (e.g. 18). Convert to a
        // fraction so the `1 + taxRate` divisor below resolves to e.g. 1.18 (not 19).
        // Mirrors the conversion in createAdminInvoices / buildInvoiceDataFromMultiplePaymentLogs.
        BigDecimal taxRate = BigDecimal.valueOf(taxRateValue)
                .divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP);
        String taxLabel = (String) invoiceSettings.getOrDefault("taxLabel", "Tax");

        // Use payment amount from payment log (plan price = locked regional price when set)
        BigDecimal planPrice = BigDecimal.valueOf(RegionalPriceLock.listPrice(userPlan));
        BigDecimal paymentAmount;

        if (paymentLog.getPaymentAmount() != null && paymentLog.getPaymentAmount() > 0) {
            paymentAmount = BigDecimal.valueOf(paymentLog.getPaymentAmount());
        } else {
            // Fallback to plan price if payment amount is not set
            log.warn("Payment log {} has no payment amount, using plan price {} as fallback",
                    paymentLog.getId(), planPrice);
            paymentAmount = planPrice;
        }

        // Calculate discount for line items display
        BigDecimal discountAmount = calculateDiscountAmount(paymentLogLineItems, planPrice);

        // Use payment amount as total, then calculate tax and subtotal
        BigDecimal totalAmount = paymentAmount;
        BigDecimal subtotal;
        BigDecimal taxAmount;

        if (taxIncluded) {
            // Tax is already included in payment amount
            BigDecimal divisor = BigDecimal.ONE.add(taxRate);
            subtotal = totalAmount.divide(divisor, 2, RoundingMode.HALF_UP);
            taxAmount = totalAmount.subtract(subtotal);
        } else {
            // Tax is additional, so payment amount = subtotal + tax
            BigDecimal divisor = BigDecimal.ONE.add(taxRate);
            subtotal = totalAmount.divide(divisor, 2, RoundingMode.HALF_UP);
            taxAmount = totalAmount.subtract(subtotal);
        }

        // Build line items - use package session description instead of plan name
        List<InvoiceLineItemData> lineItems = buildLineItems(paymentPlan, paymentLogLineItems,
                taxIncluded, taxRate, taxLabel, subtotal, taxAmount, totalAmount, paymentLog.getId(), planPrice);

        // Build invoice data
        InvoiceData invoiceData = InvoiceData.builder()
                .user(user)
                .institute(institute)
                .userPlan(userPlan)
                .paymentPlan(paymentPlan)
                .paymentLog(paymentLog)
                .paymentLogLineItems(paymentLogLineItems)
                .invoiceDate(LocalDateTime.now())
                .dueDate(LocalDateTime.now()) // Same as invoice date for one-time payments
                .planPrice(planPrice)
                .discountAmount(discountAmount)
                .taxAmount(taxAmount)
                .subtotal(subtotal)
                .totalAmount(totalAmount)
                .currency(getCurrencyFromPaymentLog(paymentLog, paymentPlan))
                .taxIncluded(taxIncluded)
                .taxRate(taxRate)
                .taxLabel(taxLabel)
                .paymentMethod(invoicePaymentMethod(paymentLog))
                .transactionId(invoiceTransactionId(paymentLog))
                .paymentDate(paymentLog.getDate() != null
                        ? paymentLog.getDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDateTime()
                        : LocalDateTime.now())
                .lineItems(lineItems)
                .build();

        log.debug("Invoice data built successfully");
        return invoiceData;
    }

    /**
     * Calculate total discount amount from payment log line items
     */
    /**
     * Discount for a payment against a CPO fee schedule.
     *
     * <p>A CPO discount never reaches {@code payment_log_line_item} — it is written straight onto
     * {@code student_fee_payment.amount_expected} by CpoDiscountService, leaving
     * {@code original_amount} as the pre-discount figure. So the line-item scan below finds nothing
     * and the invoice reported a zero discount while the plan price still showed the gross: a
     * ₹70,000 plan discounted to ₹62,000 printed "₹70,000" with no explanation of the ₹8,000 gap.
     *
     * <p>Apportioned by how much of the plan this payment covers, so a part payment carries its
     * share of the discount rather than the whole of it. Returns zero for plans with no fee
     * schedule (the non-CPO tracks), leaving their existing behaviour untouched.
     */
    private BigDecimal feeScheduleDiscount(String userPlanId, BigDecimal paymentAmount) {
        if (!StringUtils.hasText(userPlanId) || paymentAmount == null
                || paymentAmount.compareTo(BigDecimal.ZERO) <= 0) {
            return BigDecimal.ZERO;
        }
        try {
            List<StudentFeePayment> bills = studentFeePaymentRepository.findByUserPlanId(userPlanId);
            if (bills == null || bills.isEmpty()) {
                return BigDecimal.ZERO;
            }
            BigDecimal gross = BigDecimal.ZERO;
            BigDecimal net = BigDecimal.ZERO;
            for (StudentFeePayment bill : bills) {
                BigDecimal expected = bill.getAmountExpected() != null
                        ? bill.getAmountExpected()
                        : BigDecimal.ZERO;
                // original_amount is backfilled/@PrePersist-set, but fall back to the net so a
                // missing value reads as "no discount" rather than as a discount of the whole bill.
                BigDecimal original = bill.getOriginalAmount() != null
                        ? bill.getOriginalAmount()
                        : expected;
                gross = gross.add(original);
                net = net.add(expected);
            }
            BigDecimal totalDiscount = gross.subtract(net);
            if (totalDiscount.compareTo(BigDecimal.ZERO) <= 0 || net.compareTo(BigDecimal.ZERO) <= 0) {
                return BigDecimal.ZERO;
            }
            // Share of the discount proportional to the slice of the plan being paid for, capped
            // so a payment larger than the outstanding net can't over-report the discount.
            BigDecimal share = totalDiscount
                    .multiply(paymentAmount.min(net))
                    .divide(net, 2, RoundingMode.HALF_UP);
            return share.min(totalDiscount);
        } catch (Exception e) {
            log.warn("Could not derive fee-schedule discount for userPlan {}: {}", userPlanId, e.getMessage());
            return BigDecimal.ZERO;
        }
    }

    private BigDecimal calculateDiscountAmount(List<PaymentLogLineItem> lineItems, BigDecimal planPrice) {
        BigDecimal totalDiscount = BigDecimal.ZERO;

        for (PaymentLogLineItem item : lineItems) {
            if (item.getAmount() != null && item.getAmount() < 0) {
                // Discounts are negative amounts
                totalDiscount = totalDiscount.add(BigDecimal.valueOf(Math.abs(item.getAmount())));
            } else if (item.getAmount() != null && item.getAmount() > 0 &&
                    (item.getType() != null && (item.getType().contains("DISCOUNT") ||
                            item.getType().contains("COUPON") || item.getType().contains("REFERRAL")))) {
                // Some systems store discounts as positive amounts
                totalDiscount = totalDiscount.add(BigDecimal.valueOf(item.getAmount()));
            }
        }

        // Ensure discount doesn't exceed plan price
        return totalDiscount.min(planPrice);
    }

    /**
     * Build line items for invoice
     */
    private List<InvoiceLineItemData> buildLineItems(PaymentPlan paymentPlan,
            List<PaymentLogLineItem> paymentLogLineItems,
            Boolean taxIncluded,
            BigDecimal taxRate,
            String taxLabel,
            BigDecimal subtotal,
            BigDecimal taxAmount,
            BigDecimal totalAmount,
            String paymentLogId,
            BigDecimal grossPlanPrice) {
        List<InvoiceLineItemData> lineItems = new ArrayList<>();

        // Get package session description (package name) instead of plan name
        String description = buildPackageSessionDescription(paymentPlan, paymentLogId);

        // Ensure description is never null or empty
        if (description == null || description.trim().isEmpty()) {
            description = paymentPlan != null && paymentPlan.getName() != null ? paymentPlan.getName()
                    : "Package Enrollment";
        }

        // Main plan item — show GROSS plan price so the discount line items
        // subtract from it visually. The totalAmount passed in is the net
        // (post-discount) figure from the payment log; using that for the
        // course line would double-count the discount on the rendered
        // invoice. Falls back to totalAmount when paymentPlan is unavailable.
        BigDecimal grossUnitPrice = paymentPlan != null
                ? grossPlanPrice
                : totalAmount;
        InvoiceLineItemData planItem = InvoiceLineItemData.builder()
                .itemType("PLAN")
                .description(description.trim())
                .quantity(1)
                .unitPrice(grossUnitPrice)
                .amount(grossUnitPrice)
                .build();
        lineItems.add(planItem);

        // Discount items
        for (PaymentLogLineItem item : paymentLogLineItems) {
            if (item.getType() != null && (item.getType().contains("DISCOUNT") ||
                    item.getType().contains("COUPON") || item.getType().contains("REFERRAL"))) {

                BigDecimal discountValue = BigDecimal.ZERO;
                if (item.getAmount() != null) {
                    if (item.getAmount() < 0) {
                        discountValue = BigDecimal.valueOf(Math.abs(item.getAmount()));
                    } else {
                        discountValue = BigDecimal.valueOf(item.getAmount());
                    }
                }

                if (discountValue.compareTo(BigDecimal.ZERO) > 0) {
                    InvoiceLineItemData discountItem = InvoiceLineItemData.builder()
                            .itemType(item.getType())
                            .description(buildDiscountDescription(item))
                            .quantity(1)
                            .unitPrice(discountValue.negate())
                            .amount(discountValue.negate())
                            .sourceId(item.getId())
                            .build();
                    lineItems.add(discountItem);
                }
            }
        }

        // Tax item (if applicable)
        if (taxAmount != null && taxAmount.compareTo(BigDecimal.ZERO) > 0) {
            InvoiceLineItemData taxItem = InvoiceLineItemData.builder()
                    .itemType("TAX")
                    .description(taxLabel + " @ " + taxRate.multiply(BigDecimal.valueOf(100)).setScale(0) + "%")
                    .quantity(1)
                    .unitPrice(taxAmount)
                    .amount(taxAmount)
                    .build();
            lineItems.add(taxItem);
        }

        return lineItems;
    }

    /**
     * Get invoice settings from institute.
     * INVOICE_SETTING is a key-value in institute settings; defaults include sendInvoiceEmail: false.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> getInvoiceSettings(Institute institute) {
        try {
            Object settingData = instituteSettingService.getSettingData(institute, "INVOICE_SETTING");
            if (settingData instanceof Map) {
                Map<String, Object> map = (Map<String, Object>) settingData;
                // Ensure sendInvoiceEmail has a default when key is missing
                if (!map.containsKey("sendInvoiceEmail")) {
                    map.put("sendInvoiceEmail", false);
                }
                // Default PDF placement: keep the PDF in the dedicated invoice email (legacy behaviour)
                if (!map.containsKey("invoicePdfPlacement")) {
                    map.put("invoicePdfPlacement", InvoicePdfPlacement.INVOICE_EMAIL.name());
                }
                return map;
            }
        } catch (Exception e) {
            log.warn("Could not load invoice settings for institute: {}. Using defaults.", institute.getId(), e);
        }
        // Return default settings (default for send invoice email is false)
        Map<String, Object> defaults = new HashMap<>();
        defaults.put("taxIncluded", false);
        defaults.put("taxRate", 0.0);
        defaults.put("taxLabel", "Tax");
        defaults.put("currency", "INR");
        defaults.put("sendInvoiceEmail", false);
        defaults.put("invoicePdfPlacement", InvoicePdfPlacement.INVOICE_EMAIL.name());
        return defaults;
    }

    /**
     * Resolve where the invoice PDF should be delivered for this institute. Reads
     * {@code INVOICE_SETTING.invoicePdfPlacement}; defaults to {@link InvoicePdfPlacement#INVOICE_EMAIL}
     * when the institute, the setting, or its value is missing/unrecognised.
     */
    public InvoicePdfPlacement getInvoicePdfPlacement(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null) {
                return InvoicePdfPlacement.INVOICE_EMAIL;
            }
            Map<String, Object> settings = getInvoiceSettings(institute);
            return InvoicePdfPlacement.fromSetting(settings.get("invoicePdfPlacement"));
        } catch (Exception e) {
            log.warn("Could not resolve invoicePdfPlacement for institute {} — defaulting to INVOICE_EMAIL",
                    instituteId, e);
            return InvoicePdfPlacement.INVOICE_EMAIL;
        }
    }

    /**
     * Allocate the next invoice number for this institute, resolving every token the
     * configured format uses from {@code invoiceData}.
     *
     * <p>{@code docType} feeds the {@code {{doc_type}}} token so one configured format can
     * emit different prefixes per document kind (enrollment invoice vs admin-raised invoice
     * vs live-session invoice) instead of needing a separate setting for each.
     *
     * <p>When {@code invoiceData} is given, the sequence position is stamped onto it so it
     * reaches the saved {@code Invoice} row — that row IS the counter, so losing it would
     * make the number re-issuable. Preview/what-if paths must use
     * {@link #previewInvoiceNumber}, which reserves nothing.
     */
    private InvoiceNumberAllocation allocateInvoiceNumber(String instituteId, InvoiceData invoiceData,
                                                          String docType) {
        Institute institute = resolveInstituteForNumbering(instituteId, invoiceData);
        InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                institute != null ? getInvoiceSettings(institute) : null);
        InvoiceNumberAllocation allocation = invoiceNumberService.generate(config,
                buildInvoiceNumberContext(instituteId, institute, config, invoiceData, docType));
        applyAllocation(invoiceData, allocation);
        log.debug("Generated invoice number: {} (seq {})", allocation.number(), allocation.seqNo());
        return allocation;
    }

    /** A rendered-and-saved invoice plus the PDF bytes, so the caller can attach them to email. */
    private record RenderedInvoice(Invoice invoice, byte[] pdfBytes) {}

    /**
     * Render the invoice PDF, upload it and persist the row — retrying with the next number
     * if the insert loses a uniqueness race.
     *
     * <p>Because the counter is {@code MAX(invoice.seq_no) + 1} rather than a pre-reserved
     * ticket, two webhooks firing at the same instant for one institute can compute the same
     * number; {@code uq_invoice_institute_number} rejects the loser. The number is embedded
     * in the PDF and in the S3 object name, so recovering means re-rendering and re-uploading
     * — acceptable because the allocator has already skipped every number it could see taken,
     * leaving only true simultaneous collisions to reach here.
     *
     * <p>Retries use {@link InvoiceNumberService#nextAfterCollision} rather than a fresh
     * {@code generate}: a clash against a pre-V432 invoice (whose {@code seq_no} is NULL)
     * leaves {@code MAX(seq_no)} unchanged, so recomputing would return the same number
     * forever.
     */
    private RenderedInvoice renderAndSaveWithCollisionRetry(String instituteId, InvoiceData invoiceData,
                                                            String templateHtml, List<PaymentLog> paymentLogs,
                                                            String docType) {
        int maxAttempts = 4;
        for (int attempt = 0; ; attempt++) {
            String invoiceNumber = invoiceData.getInvoiceNumber();
            String filledTemplate = replaceTemplatePlaceholders(templateHtml, invoiceData);
            byte[] pdfBytes = generatePdfFromHtml(filledTemplate);
            String pdfFileId = uploadInvoiceToS3(pdfBytes, invoiceNumber, instituteId);
            try {
                // Through the proxy so REQUIRES_NEW applies — a direct call would run in this
                // transaction and a collision would poison it instead of being retryable.
                Invoice invoice = self.saveInvoiceWithMultiplePaymentLogs(invoiceData, invoiceNumber, pdfFileId,
                        paymentLogs, instituteId);
                return new RenderedInvoice(invoice, pdfBytes);
            } catch (DataIntegrityViolationException e) {
                if (attempt >= maxAttempts - 1) {
                    throw e;
                }
                Institute institute = resolveInstituteForNumbering(instituteId, invoiceData);
                InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                        institute != null ? getInvoiceSettings(institute) : null);
                InvoiceNumberAllocation retryAllocation = invoiceNumberService.nextAfterCollision(config,
                        buildInvoiceNumberContext(instituteId, institute, config, invoiceData, docType),
                        attempt + 1);
                log.warn("Invoice number {} collided for institute {} — retrying as {} (attempt {}).",
                        invoiceNumber, instituteId, retryAllocation.number(), attempt + 1);
                applyAllocation(invoiceData, retryAllocation);
            }
        }
    }

    /** Copy a freshly-allocated number + its sequence position onto the in-flight invoice data. */
    private void applyAllocation(InvoiceData invoiceData, InvoiceNumberAllocation allocation) {
        if (invoiceData == null) {
            return;
        }
        invoiceData.setInvoiceNumber(allocation.number());
        invoiceData.setSeqNo(allocation.seqNo());
        invoiceData.setSeqScopeKey(allocation.scopeKey());
    }

    /**
     * The number the institute WOULD issue next, without consuming it.
     *
     * <p>The admin create-invoice preview re-renders on every keystroke; allocating there
     * would burn a sequence number per edit and leave permanent gaps in a tax document
     * series.
     */
    private String previewInvoiceNumber(String instituteId, InvoiceData invoiceData, String docType) {
        Institute institute = resolveInstituteForNumbering(instituteId, invoiceData);
        InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                institute != null ? getInvoiceSettings(institute) : null);
        return invoiceNumberService.preview(config,
                buildInvoiceNumberContext(instituteId, institute, config, invoiceData, docType));
    }

    // ── Proforma ─────────────────────────────────────────────────────────────

    /**
     * Whether this institute issues unpaid invoices as proformas
     * ({@code INVOICE_SETTING.proformaEnabled}). Defaults to false, so nothing changes for
     * an institute that has not opted in.
     */
    public boolean isProformaEnabled(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null) {
                return false;
            }
            return isProformaEnabled(institute);
        } catch (Exception e) {
            log.warn("Could not resolve proformaEnabled for institute {} — treating as off", instituteId, e);
            return false;
        }
    }

    private boolean isProformaEnabled(Institute institute) {
        Object raw = getInvoiceSettings(institute).get("proformaEnabled");
        return raw instanceof Boolean b ? b : Boolean.parseBoolean(String.valueOf(raw));
    }

    /**
     * Allocate a PROFORMA number: its own series, never the institute's invoice series.
     *
     * <p>A proforma is a request for payment, not a tax document. Numbering it out of the
     * real series would mean every cancelled or never-paid proforma leaves a permanent gap
     * in a sequence that is supposed to be gapless — so it counts in its own {@code PRO:*}
     * namespace and only draws a real number when it is paid (see
     * {@link #finalizeProformaOnPayment}).
     *
     * <p>The institute's configured format is kept and simply prefixed, so
     * {@code ACME/2026-27/0007} proformas read {@code PRO-ACME/2026-27/0007}. Formats that
     * already carry {@code {{doc_type}}} render {@code PRO} through that token instead and
     * are left alone.
     *
     * <p><b>Scope of the guarantee:</b> a proforma number is unique among OUTSTANDING
     * proformas, not across all time. A row carries one {@code (seq_no, seq_scope_key)}
     * pair, and finalization re-points that pair at the real series — so the proforma
     * counter only ever sees proformas that have not yet been paid, and a number can be
     * handed out again once its previous holder became an invoice. That is deliberate and
     * harmless: nothing in tax law requires a proforma series to be gapless or permanent
     * (which is the entire reason for this feature), the unique constraint still prevents
     * two live documents sharing a number, and the number a paid invoice used to carry is
     * preserved on it as {@code proformaNumber}. Strict lifetime-monotonic proforma numbers
     * would need a dedicated column, since one row cannot record its position in two series.
     */
    private InvoiceNumberAllocation allocateProformaNumber(String instituteId, InvoiceData invoiceData) {
        Institute institute = resolveInstituteForNumbering(instituteId, invoiceData);
        InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                institute != null ? getInvoiceSettings(institute) : null);
        if (!config.usesDocType()) {
            config = config.withFormat(DOC_TYPE_PROFORMA + "-" + config.getFormat());
        }
        InvoiceNumberContext context = buildInvoiceNumberContext(
                instituteId, institute, config, invoiceData, DOC_TYPE_PROFORMA);
        context.setSeqNamespace(DOC_TYPE_PROFORMA);
        InvoiceNumberAllocation allocation = invoiceNumberService.generate(config, context);
        applyAllocation(invoiceData, allocation);
        log.info("Allocated proforma number {} (seq {} in {}) for institute {}",
                allocation.number(), allocation.seqNo(), allocation.scopeKey(), instituteId);
        return allocation;
    }

    /**
     * The proforma number this invoice was issued as before it was paid, or null if it was
     * never a proforma (or still is one — a live proforma shows its number as its own, not as
     * a back-reference to itself).
     */
    private String finalizedFromProformaNumber(Invoice invoice) {
        if (isProforma(invoice)) {
            return null;
        }
        return readInvoiceDataJsonField(invoice.getInvoiceDataJson(), JSON_KEY_PROFORMA_NUMBER);
    }

    /** Learner-facing noun for this document: "proforma invoice" while unpaid, else "invoice". */
    private String documentNoun(Invoice invoice) {
        return isProforma(invoice) ? DOCUMENT_NOUN_PROFORMA : DOCUMENT_NOUN_INVOICE;
    }

    /** Title-case form of {@link #documentNoun} for subjects and headings. */
    private String documentNounTitleCase(Invoice invoice) {
        return isProforma(invoice) ? "Proforma Invoice" : "Invoice";
    }

    /**
     * The proforma number the institute WOULD issue next, without consuming it. Mirrors
     * {@link #allocateProformaNumber} exactly — same prefixing rule, same {@code PRO:}
     * counter — so the create-invoice dialog previews the number the document will really
     * get. Previewing through the invoice series instead would show the admin a number from
     * a series the proforma is never going to touch.
     */
    private String previewProformaNumber(String instituteId, InvoiceData invoiceData) {
        Institute institute = resolveInstituteForNumbering(instituteId, invoiceData);
        InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                institute != null ? getInvoiceSettings(institute) : null);
        if (!config.usesDocType()) {
            config = config.withFormat(DOC_TYPE_PROFORMA + "-" + config.getFormat());
        }
        InvoiceNumberContext context = buildInvoiceNumberContext(
                instituteId, institute, config, invoiceData, DOC_TYPE_PROFORMA);
        context.setSeqNamespace(DOC_TYPE_PROFORMA);
        return invoiceNumberService.preview(config, context);
    }

    /**
     * True when this invoice is still an unpaid proforma.
     *
     * <p>Substring-rejects before parsing: this runs per row in {@code mapToDTO}, and an
     * invoice from an institute that never enabled proformas has no marker in its JSON at
     * all, so the parse would be pure waste on by far the common case.
     */
    private boolean isProforma(Invoice invoice) {
        String json = invoice.getInvoiceDataJson();
        if (!StringUtils.hasText(json) || !json.contains(JSON_KEY_PROFORMA)) {
            return false;
        }
        return Boolean.parseBoolean(
                String.valueOf(readInvoiceDataJsonField(json, JSON_KEY_PROFORMA)));
    }

    /**
     * Turn a paid proforma into a real invoice: allocate the actual invoice number NOW,
     * re-render the PDF under it, and record what it used to be.
     *
     * <p>This is the moment the tax document comes into existence, which is the whole point
     * of the feature — the institute's invoice series only ever advances for money that was
     * actually received, so it stays gapless no matter how many proformas were raised and
     * abandoned.
     *
     * <p>Called from both settlement paths ({@link #markInvoicePaidManually} and
     * {@link #markAdminInvoicePaidByPaymentLog}) BEFORE the status flips to PAID. Idempotent:
     * an invoice that is not a proforma — including one already finalized by an earlier
     * delivery of the same webhook — returns untouched.
     *
     * <p>Best-effort on the PDF only. If re-rendering fails the invoice still gets its real
     * number and the old proforma PDF is left in place rather than losing the number
     * allocation; {@code resolveOrRegeneratePdfUrl} re-renders it on the next download.
     */
    private Invoice finalizeProformaOnPayment(Invoice invoice) {
        if (!isProforma(invoice)) {
            return invoice;
        }
        String proformaNumber = invoice.getInvoiceNumber();
        String docType = readInvoiceDataJsonField(invoice.getInvoiceDataJson(), JSON_KEY_PROFORMA_DOC_TYPE);
        if (!StringUtils.hasText(docType)) {
            docType = DOC_TYPE_ADMIN;
        }

        UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(invoice.getUserId()))
                .stream().findFirst().orElse(UserDTO.builder().build());
        Institute institute = instituteRepository.findById(invoice.getInstituteId()).orElse(null);
        InvoiceData numberingData = numberingDataForAdminInvoice(
                institute, user, invoice.getInvoiceDate(), invoice.getCurrency());
        InvoiceNumberConfig config = InvoiceNumberConfig.fromInvoiceSettings(
                institute != null ? getInvoiceSettings(institute) : null);

        InvoiceNumberAllocation allocation =
                allocateInvoiceNumber(invoice.getInstituteId(), numberingData, docType);

        int maxAttempts = 4;
        Invoice finalized;
        for (int attempt = 0; ; attempt++) {
            try {
                finalized = self.saveFinalizedProformaNumber(
                        invoice.getId(), allocation, proformaNumber);
                break;
            } catch (DataIntegrityViolationException e) {
                if (attempt >= maxAttempts - 1) {
                    throw e;
                }
                InvoiceNumberAllocation retry = invoiceNumberService.nextAfterCollision(config,
                        buildInvoiceNumberContext(invoice.getInstituteId(), institute, config,
                                numberingData, docType),
                        attempt + 1);
                log.warn("Invoice number {} collided while finalizing proforma {} for institute {} "
                                + "— retrying as {} (attempt {}).",
                        allocation.number(), proformaNumber, invoice.getInstituteId(),
                        retry.number(), attempt + 1);
                allocation = retry;
            }
        }

        // The number was written by a DIFFERENT persistence context, so the instance the caller
        // is holding still carries the proforma number. Copy the authoritative fields across —
        // the caller saves this instance again to flip the status, and without this that save
        // would write the stale number straight back over the one just allocated.
        invoice.setInvoiceNumber(finalized.getInvoiceNumber());
        invoice.setSeqNo(finalized.getSeqNo());
        invoice.setSeqScopeKey(finalized.getSeqScopeKey());
        invoice.setInvoiceDataJson(finalized.getInvoiceDataJson());

        // Re-render under the real number. buildInvoiceDataFromPersistedInvoice reads the
        // number off the row we just saved, so the new PDF (and its S3 object name) carry it.
        try {
            String pdfFileId = regenerateInvoicePdf(invoice);
            if (StringUtils.hasText(pdfFileId)) {
                invoice.setPdfFileId(pdfFileId);
            }
        } catch (Exception e) {
            log.error("Proforma {} finalized as {} but PDF re-render failed — the stored PDF still "
                            + "shows the proforma. It regenerates on next download.",
                    proformaNumber, invoice.getInvoiceNumber(), e);
        }

        log.info("[ProformaFinalized] invoiceId={} proforma={} issuedAs={} seq={}",
                invoice.getId(), proformaNumber, invoice.getInvoiceNumber(), invoice.getSeqNo());
        return invoice;
    }

    /**
     * Writes the real invoice number onto a proforma, in its own transaction.
     *
     * <p>MUST be invoked through {@code self} (the injected proxy), not directly: the whole
     * point is the {@code REQUIRES_NEW} boundary. A duplicate-number write aborts the
     * transaction it occurs in, so running this inline would leave the caller with a dead
     * transaction and nothing to retry into.
     *
     * <p>Committing separately from the PAID flip is safe in both directions. If the caller
     * rolls back afterwards, the invoice keeps its real number but stays PENDING_PAYMENT with
     * {@code proforma=false} — and the retried webhook (or a repeated manual mark-paid,
     * which still sees PENDING_PAYMENT) skips finalization as a no-op and just flips the
     * status. No number is ever allocated twice.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Invoice saveFinalizedProformaNumber(String invoiceId, InvoiceNumberAllocation allocation,
                                               String proformaNumber) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        invoice.setInvoiceNumber(allocation.number());
        invoice.setSeqNo(allocation.seqNo());
        invoice.setSeqScopeKey(allocation.scopeKey());

        Map<String, Object> audit = new HashMap<>();
        audit.put(JSON_KEY_PROFORMA, false);
        audit.put(JSON_KEY_PROFORMA_NUMBER, proformaNumber);
        audit.put(JSON_KEY_FINALIZED_AT, LocalDateTime.now().toString());
        invoice.setInvoiceDataJson(mergeInvoiceDataJson(invoice.getInvoiceDataJson(), audit));
        // saveAndFlush so a duplicate number surfaces HERE, inside this transaction, where the
        // caller can catch it — a deferred flush would blow up in the caller instead.
        return invoiceRepository.saveAndFlush(invoice);
    }

    private Institute resolveInstituteForNumbering(String instituteId, InvoiceData invoiceData) {
        if (invoiceData != null && invoiceData.getInstitute() != null) {
            return invoiceData.getInstitute();
        }
        try {
            return instituteRepository.findById(instituteId).orElse(null);
        } catch (Exception e) {
            log.warn("Could not load institute {} for invoice numbering; "
                    + "institute-based tokens will render empty.", instituteId, e);
            return null;
        }
    }

    /**
     * Assemble the token values for the number formatter.
     *
     * <p>Everything except the last two fields is already in memory — number generation runs
     * after {@code buildInvoiceData} — so this costs no queries. {@code enrollment_no} and the
     * course/level/session tokens DO need reads no other invoice code performs, so they are
     * passed as suppliers and the formatter only invokes them when the configured format
     * actually contains those tokens.
     */
    private InvoiceNumberContext buildInvoiceNumberContext(String instituteId, Institute institute,
                                                           InvoiceNumberConfig config, InvoiceData invoiceData,
                                                           String docType) {
        UserDTO user = invoiceData != null ? invoiceData.getUser() : null;
        LocalDateTime invoiceDate = invoiceData != null ? invoiceData.getInvoiceDate() : null;
        UserPlan userPlan = invoiceData != null ? invoiceData.getUserPlan() : null;

        return InvoiceNumberContext.builder()
                .instituteId(instituteId)
                .instituteName(institute != null ? institute.getInstituteName() : null)
                .instituteCode(config.getInstituteCode())
                .instituteStateCode(institute != null ? institute.getStateCode() : null)
                .instituteCity(institute != null ? institute.getCity() : null)
                .instituteState(institute != null ? institute.getState() : null)
                .instituteCountry(institute != null ? institute.getCountry() : null)
                .subdomain(institute != null ? institute.getSubdomain() : null)
                .learnerName(user != null ? user.getFullName() : null)
                .learnerState(user != null ? user.getRegion() : null)
                .date(invoiceDate != null ? invoiceDate.toLocalDate() : LocalDate.now())
                .currency(invoiceData != null ? invoiceData.getCurrency() : null)
                .paymentVendor(invoiceData != null ? invoiceData.getPaymentMethod() : null)
                .planName(invoiceData != null && invoiceData.getPaymentPlan() != null
                        ? invoiceData.getPaymentPlan().getName() : null)
                .docType(StringUtils.hasText(docType) ? docType : DOC_TYPE_ENROLLMENT)
                .enrollmentNumberSupplier(() -> lookupEnrollmentNumber(userPlan))
                .packageContextSupplier(() -> lookupPackageContext(userPlan))
                .learnerFieldLookup(learnerFieldLookup(userPlan != null ? userPlan.getId() : null,
                        user != null ? user.getId() : null))
                .build();
    }

    /**
     * A learner's value of a custom field for picking a numbering series: the value pinned on
     * the enrolment first (so every installment of a course stays in one series), then the
     * profile, then the latest lead. Null when there is neither a plan nor a learner.
     */
    java.util.function.Function<String, String> learnerFieldLookup(String userPlanId, String userId) {
        if (!StringUtils.hasText(userPlanId) && !StringUtils.hasText(userId)) {
            return null;
        }
        return fieldId -> {
            String pinned = StringUtils.hasText(userPlanId)
                    ? customFieldValuesRepository.findLatestValueForEnrollment(fieldId, userPlanId) : null;
            return pinned != null || !StringUtils.hasText(userId)
                    ? pinned : customFieldValuesRepository.findLatestValueForUser(fieldId, userId);
        };
    }

    /**
     * {@code ssigm.institute_enrollment_number} for the learner behind this plan. Note the
     * getter is {@code getInstituteEnrolledNumber()} — the Java field name does not match the
     * column name (legacy).
     */
    private String lookupEnrollmentNumber(UserPlan userPlan) {
        StudentSessionInstituteGroupMapping mapping = lookupStudentMapping(userPlan);
        return mapping != null ? mapping.getInstituteEnrolledNumber() : null;
    }

    /** Course / level / session names, via the same projection the T&C lookup uses. */
    private InvoicePackageContextProjection lookupPackageContext(UserPlan userPlan) {
        StudentSessionInstituteGroupMapping mapping = lookupStudentMapping(userPlan);
        if (mapping == null) {
            return null;
        }
        String packageSessionId = null;
        if (mapping.getDestinationPackageSession() != null) {
            packageSessionId = mapping.getDestinationPackageSession().getId();
        } else if (mapping.getPackageSession() != null) {
            packageSessionId = mapping.getPackageSession().getId();
        }
        if (!StringUtils.hasText(packageSessionId)) {
            return null;
        }
        return packageSessionRepository.findPackageAndLevelByPackageSessionId(packageSessionId).orElse(null);
    }

    /**
     * Minimal {@link InvoiceData} carrying just what the number formatter needs for an
     * admin-raised invoice. Those are not tied to an enrollment, so there is no UserPlan —
     * {@code {{enrollment_no}}} and the course tokens resolve empty and their separators
     * collapse.
     */
    private InvoiceData numberingDataForAdminInvoice(Institute institute, UserDTO user,
                                                     LocalDateTime invoiceDate, String currency) {
        return InvoiceData.builder()
                .institute(institute)
                .user(user)
                .invoiceDate(invoiceDate)
                .currency(currency)
                .build();
    }

    private StudentSessionInstituteGroupMapping lookupStudentMapping(UserPlan userPlan) {
        if (userPlan == null) {
            return null;
        }
        List<StudentSessionInstituteGroupMapping> mappings = studentSessionRepository
                .findAllByUserPlanIdAndStatusIn(userPlan.getId(),
                        List.of("ACTIVE", "INVITED", "ABANDONED_CART", "DETAILS_FILLED"));
        return (mappings == null || mappings.isEmpty()) ? null : mappings.get(0);
    }

    /**
     * Load institute invoice PDF layout template (defines how the invoice PDF looks: line items, totals, placeholders like default_invoice.html).
     * Uses templates table with type=INVOICE (institute invoice PDF templates), not email templates.
     * If the institute has one or more INVOICE templates, the one marked default in
     * Settings &gt; Invoice is used, else the last-created one (see InvoiceDefaultTemplatePicker);
     * otherwise resources/templates/invoice/default_invoice.html is used.
     */
    private String loadInvoiceTemplate(String instituteId) {
        try {
            var templates = templateService.getTemplatesByInstituteAndType(instituteId, INVOICE_TEMPLATE_TYPE);
            log.info("Found {} INVOICE templates for institute: {}", templates.size(), instituteId);
            var chosen = templates.isEmpty() ? null : InvoiceDefaultTemplatePicker.pick(templates,
                    readDefaultInvoiceTemplateId(instituteId, InvoiceDefaultTemplatePicker.PDF_SETTING_KEY))
                    .orElse(null);
            if (chosen != null) {
                String content = chosen.getContent();
                if (StringUtils.hasText(content)) {
                    log.info("Using custom INVOICE template '{}' (id={}) for institute: {}, content length: {}",
                            chosen.getName(), chosen.getId(), instituteId,
                            content.length());
                    return content;
                } else {
                    log.warn("INVOICE template found but content is empty for institute: {}", instituteId);
                }
            }
        } catch (Exception e) {
            log.warn("Could not load institute invoice PDF template from Template entity for institute: {}", instituteId, e);
        }

        log.info("Using default invoice PDF template from resources (default_invoice.html) for institute: {}", instituteId);
        return loadDefaultInvoiceTemplateFromResources();
    }

    /**
     * The template id the admin marked default for invoices ({@code INVOICE_SETTING.<key>}),
     * or null. Never throws: a settings read failure falls back to the newest template.
     */
    private String readDefaultInvoiceTemplateId(String instituteId, String key) {
        try {
            return InvoiceDefaultTemplatePicker.defaultIdFrom(
                    instituteSettingService.getSettingByInstituteIdAndKey(instituteId, "INVOICE_SETTING"), key);
        } catch (Exception e) {
            log.warn("Could not read {} for institute {}: {}", key, instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * The invoice's arithmetic, rendered as rows: what the courses cost, what was
     * taken off, tax, and what was actually paid.
     *
     * Why a rendered block rather than more placeholders: an invoice template has
     * no conditionals, so a hard-coded "Discount" row prints an empty line on
     * every full-price invoice — which is what the seeded templates do today. It
     * also lets the rows appear only when they mean something.
     *
     * Why not just fix {{subtotal}}: that placeholder means PRE-TAX (total ÷ 1+rate)
     * and 12 of the 17 live invoice templates pair it with {{tax_amount}} to show
     * "Subtotal + Tax = Total". Redefining it as pre-DISCOUNT would silently break
     * every one of those. {{plan_price}} already carries the gross, so this block
     * reads from that and leaves the older placeholders exactly as they were.
     *
     * The gross line is omitted when nothing was discounted, because then it is
     * the same number as the total and repeating it reads as an error.
     */
    /**
     * Money as it should read on a document: two decimals, thousands grouped — "8,000.00", not
     * the "8000.0" that {@code BigDecimal.toString()} produced from a double-sourced amount.
     */
    static String money(BigDecimal value) {
        if (value == null) {
            return "0.00";
        }
        return String.format(Locale.ENGLISH, "%,.2f", value.setScale(2, RoundingMode.HALF_UP));
    }

    static String buildTotalsRowsHtml(InvoiceData invoiceData, String currencySymbol) {
        if (invoiceData == null) {
            return "";
        }
        BigDecimal gross = invoiceData.getPlanPrice();
        BigDecimal discount = invoiceData.getDiscountAmount();
        BigDecimal tax = invoiceData.getTaxAmount();
        BigDecimal total = invoiceData.getTotalAmount();
        boolean hasDiscount = discount != null && discount.compareTo(BigDecimal.ZERO) > 0
                && gross != null && total != null && gross.compareTo(total) > 0;
        boolean hasTax = tax != null && tax.compareTo(BigDecimal.ZERO) > 0;

        StringBuilder rows = new StringBuilder(
                "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" "
                        + "style=\"width:100%;font-size:13px;color:#222;\">");
        if (hasDiscount) {
            rows.append(totalsRow("Amount", currencySymbol + money(gross), false));
            rows.append(totalsRow("Discount", "-" + currencySymbol + money(discount), false));
        }
        if (hasTax) {
            String taxLabel = StringUtils.hasText(invoiceData.getTaxLabel()) ? invoiceData.getTaxLabel() : "Tax";
            rows.append(totalsRow(taxLabel, currencySymbol + money(tax), false));
        }
        rows.append(totalsRow("Total Paid",
                currencySymbol + money(total), true));
        return rows.append("</table>").toString();
    }

    private static String totalsRow(String label, String value, boolean emphasised) {
        String cell = emphasised
                ? "padding:4px 0;font-size:15px;font-weight:700;color:#124a34;"
                : "padding:2px 0;";
        return "<tr><td style=\"text-align:right;" + cell + "\">" + label + ":&nbsp;&nbsp;</td>"
                + "<td style=\"text-align:right;white-space:nowrap;" + cell + "\">" + value + "</td></tr>";
    }

    /**
     * Load default invoice PDF layout template from
     * resources/templates/invoice/default_invoice.html (same style as institute INVOICE templates).
     */
    private String loadDefaultInvoiceTemplateFromResources() {
        try {
            java.io.InputStream inputStream = this.getClass()
                    .getClassLoader()
                    .getResourceAsStream("templates/invoice/default_invoice.html");
            if (inputStream != null) {
                try (java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(inputStream, java.nio.charset.StandardCharsets.UTF_8))) {
                    StringBuilder template = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        template.append(line).append("\n");
                    }
                    log.debug("Successfully loaded default invoice template from resources");
                    return template.toString();
                }
            } else {
                log.error(
                        "Default invoice template file not found in resources/templates/invoice/default_invoice.html");
                throw new VacademyException(
                        "Default invoice template not found. Please ensure the template file exists at resources/templates/invoice/default_invoice.html");
            }
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error loading default invoice template from resources", e);
            throw new VacademyException("Failed to load default invoice template: " + e.getMessage());
        }
    }

    /**
     * Replace template placeholders with actual data
     */
    private String replaceTemplatePlaceholders(String template, InvoiceData invoiceData) {
        // {{#if key}}...{{/if}} blocks are resolved by this same substitution; see TemplateConditionals.
        String filled = TemplateConditionals.prepare(template);
        // Institutes can supply their own INVOICE template, and those predate the proforma
        // tokens. Note what this template supports so the proforma marking can be injected
        // below rather than silently not happening. Checked against the RAW template, before
        // any substitution has consumed the tokens.
        boolean templateNamesDocument = template != null
                && (template.contains("{{document_title}}")
                        || template.contains("{{document_number_label}}"));
        boolean templateShowsProformaRef = template != null
                && template.contains("{{proforma_reference}}");

        // Log whether template contains any placeholders
        boolean hasPlaceholders = filled.contains("{{");
        log.info("Invoice template has placeholders: {}, template length: {}, first 200 chars: {}",
                hasPlaceholders, filled.length(),
                filled.substring(0, Math.min(200, filled.length())));

        // Admin-supplied per-invoice overrides. When a key is present, its (HTML-escaped)
        // value is used instead of the auto-derived one. `ov` = single-line text,
        // `ovMulti` = multi-line text (newlines → <br/>) for addresses / notes. When no
        // override is present, the derived default is used verbatim (unchanged behaviour).
        final Map<String, String> overrides = invoiceData.getOverrides() != null
                ? invoiceData.getOverrides() : Collections.emptyMap();
        java.util.function.BiFunction<String, String, String> ov = (key, def) ->
                overrides.containsKey(key) ? escapeHtml(overrides.get(key)) : (def != null ? def : "");
        java.util.function.BiFunction<String, String, String> ovMulti = (key, def) ->
                overrides.containsKey(key)
                        ? escapeHtml(overrides.get(key)).replace("\n", "<br/>")
                        : (def != null ? def : "");

        // Basic invoice info
        filled = filled.replace("{{invoice_number}}",
                ov.apply("invoice_number", invoiceData.getInvoiceNumber()));
        // "PROFORMA INVOICE" while unpaid, "INVOICE" once it is a real one. Templates that
        // predate this token keep their hardcoded heading — the PRO- number prefix still
        // marks the document — so no institute's custom template breaks by not having it.
        filled = filled.replace("{{document_title}}",
                ov.apply("document_title", StringUtils.hasText(invoiceData.getDocumentTitle())
                        ? invoiceData.getDocumentTitle() : DOCUMENT_TITLE_INVOICE));
        // A proforma number is provisional — it is replaced by a real invoice number when the
        // document is paid. Labelling it "Invoice Number" would present a number that is going
        // to change as if it were the final one, which is exactly the confusion this avoids.
        filled = filled.replace("{{document_number_label}}",
                ov.apply("document_number_label", StringUtils.hasText(invoiceData.getDocumentNumberLabel())
                        ? invoiceData.getDocumentNumberLabel() : DOCUMENT_NUMBER_LABEL_INVOICE));
        // On the finalized invoice, point back at the proforma the customer already has, so the
        // two documents can be reconciled despite carrying different numbers. Empty everywhere
        // else, and a template without the token simply renders no back-reference.
        filled = filled.replace("{{proforma_reference}}",
                StringUtils.hasText(invoiceData.getProformaNumber())
                        ? "<div class=\"invoice-details-row\">"
                                + "<div class=\"invoice-details-label\">Ref. Proforma:</div>"
                                + "<div class=\"invoice-details-value\">"
                                + escapeHtml(invoiceData.getProformaNumber()) + "</div>"
                                + "</div>"
                        : "");
        filled = filled.replace("{{invoice_date}}",
                ov.apply("invoice_date", invoiceData.getInvoiceDate() != null
                        ? invoiceData.getInvoiceDate().format(DISPLAY_DATE_FORMATTER) : ""));
        filled = filled.replace("{{due_date}}",
                ov.apply("due_date", invoiceData.getDueDate() != null
                        ? invoiceData.getDueDate().format(DISPLAY_DATE_FORMATTER) : ""));

        // Institute info
        Institute institute = invoiceData.getInstitute();
        filled = filled.replace("{{institute_name}}",
                ov.apply("institute_name", institute.getInstituteName()));
        filled = filled.replace("{{institute_address}}",
                ovMulti.apply("institute_address", institute.getAddress()));
        // The line an institute prints under its name on letterheads. Held in the institute
        // description so a receipt reads from settings rather than being baked into a template.
        filled = filled.replace("{{institute_tagline}}",
                ov.apply("institute_tagline",
                        institute.getDescription() != null ? institute.getDescription() : ""));
        filled = filled.replace("{{institute_contact}}",
                ov.apply("institute_contact", institute.getMobileNumber() != null ? institute.getMobileNumber()
                        : (institute.getEmail() != null ? institute.getEmail() : "")));
        filled = filled.replace("{{institute_email}}",
                ov.apply("institute_email", institute.getEmail() != null ? institute.getEmail() : ""));

        // Billing month: month and year are edited separately, and the period is built from
        // whatever they ended up as, so the three can never disagree on one invoice.
        LocalDate billingDate = billingPeriodDate(invoiceData);
        String billingMonth = ov.apply("billing_month", billingMonthName(billingDate));
        String billingYear = ov.apply("billing_year",
                billingDate != null ? String.valueOf(billingDate.getYear()) : "");
        filled = filled.replace("{{billing_month}}", billingMonth);
        filled = filled.replace("{{billing_year}}", billingYear);
        filled = filled.replace("{{billing_period}}", (billingMonth + " " + billingYear).trim());

        // Institute logo
        String instituteLogoHtml = buildInstituteLogoHtml(institute);
        filled = filled.replace("{{institute_logo}}", instituteLogoHtml);

        // Institute theme color - replace in CSS and HTML
        // Use dark turquoise for BILL TO section and footer
        String defaultColor = "#124a34"; // Dark turquoise
        filled = filled.replace("{{theme_color}}", defaultColor);

        // Table header uses hardcoded orange color (#f78f1e) - no replacement needed

        // User info
        UserDTO user = invoiceData.getUser();
        filled = filled.replace("{{user_name}}", ov.apply("user_name", user.getFullName()));
        filled = filled.replace("{{user_email}}", ov.apply("user_email", user.getEmail()));
        filled = filled.replace("{{user_address}}", ovMulti.apply("user_address", user.getAddressLine()));
        // Buyer tax id (GSTIN/VAT) and place of supply have no auto-source on the user
        // record — they default to empty and are filled by the admin via overrides. Both
        // are substituted here so custom templates that reference them don't leak the raw
        // {{...}} token into the rendered invoice.
        filled = filled.replace("{{user_tax_info}}", ov.apply("user_tax_info", ""));
        filled = filled.replace("{{place_of_supply}}",
                ov.apply("place_of_supply", user.getRegion() != null ? user.getRegion() : ""));
        // Learner-entered custom field values, so escaped here: the override path escapes its
        // own value but passes the default through untouched.
        LearnerProfileFields lpf = usesLearnerProfileFields(template)
                ? resolveLearnerProfileFields(invoiceData)
                : LearnerProfileFields.EMPTY;
        filled = filled.replace("{{parent_name}}", ov.apply("parent_name", escapeHtml(lpf.parentName())));
        filled = filled.replace("{{year_group}}", ov.apply("year_group", escapeHtml(lpf.yearGroup())));
        // Notes (admin-entered). Overridable; defaults to the value carried on InvoiceData.
        filled = filled.replace("{{notes}}", ovMulti.apply("notes", invoiceData.getNotes()));

        // Financial info - format with currency symbol based on currency code
        String invoiceCurrency = invoiceData.getCurrency() != null ? invoiceData.getCurrency() : "INR";
        log.info("Invoice currency from invoiceData: '{}'", invoiceCurrency);
        String currencySymbol = getCurrencySymbol(invoiceCurrency);

        // Final safeguard: ensure currency symbol is never "#"
        if ("#".equals(currencySymbol) || currencySymbol == null || currencySymbol.trim().isEmpty()) {
            log.error("CRITICAL: Currency symbol is '#', null, or empty! Defaulting to ₹. Currency was: '{}'",
                    invoiceCurrency);
            currencySymbol = inrCurrencySymbol();
        }

        log.info("Currency symbol resolved: '{}' for currency code: '{}'", currencySymbol, invoiceCurrency);

        filled = filled.replace("{{subtotal}}",
                currencySymbol + money(invoiceData.getSubtotal()));

        // Original price + discount. {{discount_amount}} was being rendered literally on live
        // invoices because nothing ever substituted it — it was neither in this block nor in
        // PLACEHOLDER_META, so a template author could type it and get "{{discount_amount}}" in
        // the PDF. Both resolve to an empty string when nothing was discounted, and
        // {{discount_row}} emits the whole labelled line (or nothing), so a template can show the
        // discount only when there is one — the same shape {{tax_components}} already uses.
        BigDecimal invoiceDiscount = invoiceData.getDiscountAmount();
        boolean hasDiscount = invoiceDiscount != null && invoiceDiscount.compareTo(BigDecimal.ZERO) > 0;
        filled = filled.replace("{{plan_price}}",
                invoiceData.getPlanPrice() != null ? currencySymbol + money(invoiceData.getPlanPrice())
                        : "");
        filled = filled.replace("{{discount_amount}}",
                hasDiscount ? currencySymbol + money(invoiceDiscount) : "");
        filled = filled.replace("{{discount_row}}",
                hasDiscount
                        ? "<div class=\"invoice-discount-row\">Discount: -" + currencySymbol
                                + money(invoiceDiscount) + "</div>"
                        : "");
        filled = filled.replace("{{tax_amount}}",
                currencySymbol + money(invoiceData.getTaxAmount()));
        filled = filled.replace("{{total_amount}}",
                currencySymbol + money(invoiceData.getTotalAmount()));
        filled = filled.replace("{{currency}}", invoiceCurrency);
        // Replace currency_symbol placeholder if template uses it
        filled = filled.replace("{{currency_symbol}}", currencySymbol);

        // Payment info
        filled = filled.replace("{{payment_method}}",
                invoiceData.getPaymentMethod() != null ? invoiceData.getPaymentMethod() : "");
        filled = filled.replace("{{payment_mode}}",
                nz(invoicePaymentMode(invoiceData.getPaymentLog(), invoiceData.getPaymentMethod())));
        filled = filled.replace("{{transaction_id}}",
                invoiceData.getTransactionId() != null ? invoiceData.getTransactionId() : "");
        filled = filled.replace("{{payment_date}}",
                invoiceData.getPaymentDate() != null ? invoiceData.getPaymentDate().format(DISPLAY_DATE_FORMATTER)
                        : "");

        // Receipt figures, read off the learner fee schedule rather than this one invoice.
        // A receipt has to answer "where does this payment leave me" — what the course costs,
        // what was already paid, what is still owed and when the next installment falls due.
        // Only {{fees_paid_now}} is about this invoice alone. Every value is blank when the
        // plan has no schedule, so a template using them degrades to empty rather than zero.
        // Only reach for the fee schedule when the template actually asks for it. Most
        // institutes print an invoice, not a receipt, and they should not pay a query for
        // placeholders their template never mentions.
        ReceiptFigures rf = usesReceiptFields(template)
                ? buildReceiptFigures(invoiceData)
                : new ReceiptFigures();
        filled = filled.replace("{{course_fees}}", ov.apply("course_fees",
                rf.courseFees != null ? currencySymbol + money(rf.courseFees) : ""));
        filled = filled.replace("{{total_fees}}", ov.apply("total_fees",
                rf.totalFees != null ? currencySymbol + money(rf.totalFees) : ""));
        filled = filled.replace("{{previous_paid}}", ov.apply("previous_paid",
                rf.previousPaid != null ? currencySymbol + money(rf.previousPaid) : ""));
        filled = filled.replace("{{fees_paid_now}}", ov.apply("fees_paid_now",
                invoiceData.getTotalAmount() != null
                        ? currencySymbol + money(invoiceData.getTotalAmount()) : ""));
        filled = filled.replace("{{total_fees_due}}", ov.apply("total_fees_due",
                rf.totalDue != null ? currencySymbol + money(rf.totalDue) : ""));
        filled = filled.replace("{{total_amount_paid}}", ov.apply("total_amount_paid",
                rf.totalPaid != null ? currencySymbol + money(rf.totalPaid) : ""));
        filled = filled.replace("{{next_installment_amount}}", ov.apply("next_installment_amount",
                rf.nextInstallmentAmount != null
                        ? currencySymbol + money(rf.nextInstallmentAmount) : ""));
        filled = filled.replace("{{next_installment_date}}", ov.apply("next_installment_date",
                rf.nextInstallmentDate != null
                        ? rf.nextInstallmentDate.format(DISPLAY_DATE_FORMATTER) : ""));
        filled = filled.replace("{{amount_in_words}}", ov.apply("amount_in_words",
                amountInWords(invoiceData.getTotalAmount())));
        filled = filled.replace("{{user_mobile}}", ov.apply("user_mobile",
                user != null ? user.getMobileNumber() : ""));
        filled = filled.replace("{{course_name}}", ov.apply("course_name", rf.courseName));
        filled = filled.replace("{{course_code}}", ov.apply("course_code", rf.courseCode));
        // The bracketed form, or nothing at all. A template that writes "( {{course_code}} )"
        // prints an empty pair of brackets for every course whose plan carries no code, and
        // most do not. Same shape as {{discount_row}}: the whole fragment or none of it.
        String courseCode = overrides.containsKey("course_code")
                ? overrides.get("course_code") : rf.courseCode;
        filled = filled.replace("{{course_code_bracketed}}",
                StringUtils.hasText(courseCode) ? "( " + escapeHtml(courseCode) + " )" : "");

        // Country & tax registration details (from INVOICE_SETTING.country).
        // These let templates render the operating country, the institute's tax
        // registration number (GSTIN/VAT no.) and a breakdown of tax components.
        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
        String countryName = "";
        String countryCode = "";
        String taxRegistrationNumber = "";
        String hsnSacCode = "";
        String taxComponentsHtml = "";
        Object countryObj = invoiceSettings.get("country");
        if (countryObj instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> country = (Map<String, Object>) countryObj;
            countryName = country.get("name") != null ? country.get("name").toString() : "";
            countryCode = country.get("code") != null ? country.get("code").toString() : "";
            taxRegistrationNumber = country.get("taxRegistrationNumber") != null
                    ? country.get("taxRegistrationNumber").toString() : "";
            hsnSacCode = country.get("hsnSacCode") != null ? country.get("hsnSacCode").toString() : "";
        }
        // Tax components are computed per line item by package type during buildInvoiceData;
        // render the aggregated breakdown (label, rate %, computed amount).
        List<Map<String, Object>> aggComps = invoiceData.getAggregatedTaxComponents();
        if (aggComps != null && !aggComps.isEmpty()) {
            taxComponentsHtml = renderTaxComponentsHtml(aggComps, currencySymbol);
        }
        filled = filled.replace("{{country}}", ov.apply("country", countryName));
        filled = filled.replace("{{country_code}}", ov.apply("country_code", countryCode.toUpperCase()));
        filled = filled.replace("{{tax_registration_number}}",
                ov.apply("tax_registration_number", taxRegistrationNumber));
        filled = filled.replace("{{hsn_code}}", ov.apply("hsn_code", hsnSacCode));
        filled = filled.replace("{{tax_components}}", taxComponentsHtml);
        // Render the EFFECTIVE tax label/rate carried on invoiceData — set by the caller
        // (createAdminInvoices/previewAdminInvoice) from the actual per-invoice tax used in
        // the amount calculation, not a fresh institute-settings lookup. Using the settings
        // value here would desync the displayed rate from the real math whenever an admin
        // overrides the tax rate or disables tax for a single invoice.
        filled = filled.replace("{{tax_label}}", ov.apply("tax_label",
                invoiceData.getTaxLabel() != null ? invoiceData.getTaxLabel() : "Tax"));
        filled = filled.replace("{{tax_rate}}", ov.apply("tax_rate",
                invoiceData.getTaxRate() != null
                        ? formatRate(invoiceData.getTaxRate().multiply(BigDecimal.valueOf(100)))
                        : ""));

        // Line items table
        String lineItemsHtml = buildLineItemsHtml(invoiceData.getLineItems(), invoiceData.getCurrency());
        filled = filled.replace("{{line_items}}", lineItemsHtml);
        // A separate token rather than a change to {{line_items}}, whose 4-cell shape every
        // existing custom template depends on (see buildLineItemsHtml).
        filled = filled.replace("{{session_rows}}", buildSessionRowsHtml(invoiceData.getLineItems(), currencySymbol));

        // The whole sum, in one conditional block — see buildTotalsRowsHtml.
        filled = filled.replace("{{totals_rows}}", buildTotalsRowsHtml(invoiceData, currencySymbol));

        // Customer-details aliases and the single-row item layout used by email-editor
        // templates. Each mirrors an existing value above, so the two spellings never disagree.
        filled = filled.replace("{{customer_name}}", ov.apply("user_name", user.getFullName()));
        filled = filled.replace("{{customer_email}}", ov.apply("user_email", user.getEmail()));
        filled = filled.replace("{{date_issued}}",
                ov.apply("invoice_date", invoiceData.getInvoiceDate() != null
                        ? invoiceData.getInvoiceDate().format(DISPLAY_DATE_FORMATTER) : ""));
        filled = filled.replace("{{date_paid}}",
                invoiceData.getPaymentDate() != null ? invoiceData.getPaymentDate().format(DISPLAY_DATE_FORMATTER)
                        : "");
        filled = filled.replace("{{abn}}", ov.apply("tax_registration_number", taxRegistrationNumber));
        filled = filled.replace("{{total}}", currencySymbol + money(invoiceData.getTotalAmount()));
        filled = filled.replace("{{balance_due}}", currencySymbol + money(balanceDue(invoiceData)));
        filled = filled.replace("{{practice_name}}", escapeHtml(lpf.practiceName()));
        filled = filled.replace("{{job_title}}", escapeHtml(lpf.jobTitle()));
        filled = filled.replace("{{state}}", escapeHtml(lpf.state()));
        filled = filled.replace("{{customer_country}}", escapeHtml(lpf.country()));
        InvoiceLineItemData primaryItem = primaryLineItem(invoiceData.getLineItems());
        filled = filled.replace("{{invoice_item_description}}",
                primaryItem != null ? escapeHtml(nz(primaryItem.getDescription())) : "");
        // The course's own tags ("Vet Course"), not the plan name. Only looked up when the template
        // asks; blank when the course has none, so a {{#if invoice_item_tag}} block disappears.
        filled = filled.replace("{{invoice_item_tag}}", template != null && template.contains("{{invoice_item_tag}}")
                ? escapeHtml(courseTagResolver.tagsFor(invoiceData.getPaymentLog())) : "");
        filled = filled.replace("{{qty}}", primaryItem != null
                ? String.valueOf(primaryItem.getQuantity() != null ? primaryItem.getQuantity() : 1) : "");
        filled = filled.replace("{{unit_price}}", primaryItem != null && primaryItem.getUnitPrice() != null
                ? currencySymbol + money(primaryItem.getUnitPrice()) : "");
        filled = filled.replace("{{amount}}", primaryItem != null && primaryItem.getAmount() != null
                ? currencySymbol + money(primaryItem.getAmount()) : "");

        // Terms & Conditions
        String termsHtml = buildTermsAndConditionsHtml(invoiceData);
        if (termsHtml == null || termsHtml.trim().isEmpty()) {
            // Strip the entire wrapping block (including the heading) so we don't
            // render an orphan "Terms & Conditions" section when nothing is configured.
            filled = filled.replaceAll(
                    "(?s)<!--\\s*TERMS_AND_CONDITIONS_BLOCK\\s*-->.*?<!--\\s*/TERMS_AND_CONDITIONS_BLOCK\\s*-->",
                    "");
            filled = filled.replace("{{terms_and_conditions}}", "");
        } else {
            // Keep wrapper markers as-is (they are HTML comments, harmless in output)
            filled = filled.replace("{{terms_and_conditions}}", termsHtml);
        }

        return applyProformaFallbackMarkup(TemplateConditionals.finish(filled), invoiceData,
                templateNamesDocument, templateShowsProformaRef);
    }

    /**
     * The line a one-row invoice layout prints: the plan line, else the first line. Discount
     * and tax lines are not items, they are folded into the totals.
     */
    static InvoiceLineItemData primaryLineItem(List<InvoiceLineItemData> lineItems) {
        if (lineItems == null || lineItems.isEmpty()) {
            return null;
        }
        for (InvoiceLineItemData item : lineItems) {
            if (item != null && "PLAN".equalsIgnoreCase(item.getItemType())) {
                return item;
            }
        }
        return lineItems.get(0);
    }

    /** Nothing is owed once the invoice carries a payment date; until then, the whole total. */
    static BigDecimal balanceDue(InvoiceData invoiceData) {
        if (invoiceData == null || invoiceData.getPaymentDate() != null || invoiceData.getTotalAmount() == null) {
            return BigDecimal.ZERO;
        }
        return invoiceData.getTotalAmount();
    }

    /**
     * Marks a proforma on templates that have no proforma tokens.
     *
     * <p>A custom institute template renders whatever heading its author hardcoded, so
     * without this a proforma comes out looking exactly like a tax invoice, with a number
     * that is going to be replaced. Rather than trying to rewrite someone else's heading
     * (there is no reliable way to find it), this prepends a self-contained banner: it
     * cannot disturb the existing layout, and it states the two things the reader needs -
     * that this is not a tax invoice, and that the number is provisional.
     *
     * <p>The mirror case is a finalized invoice whose template has no
     * {@code {{proforma_reference}}}: it gets a single quiet line carrying the proforma
     * number, so the customer can still reconcile it against the document they were sent.
     *
     * <p>All styling is inline. The template's own stylesheet is unknown to us, and a
     * class-based banner would inherit rules we cannot see.
     */
    private String applyProformaFallbackMarkup(String filled, InvoiceData invoiceData,
                                               boolean templateNamesDocument,
                                               boolean templateShowsProformaRef) {
        boolean isProformaDoc = DOCUMENT_TITLE_PROFORMA.equals(invoiceData.getDocumentTitle());
        String proformaNumber = invoiceData.getProformaNumber();

        if (isProformaDoc && !templateNamesDocument) {
            String number = StringUtils.hasText(invoiceData.getInvoiceNumber())
                    ? escapeHtml(invoiceData.getInvoiceNumber()) : "";
            String banner = "<div style=\"border:2px solid #b45309;background:#fffbeb;color:#7c2d12;"
                    + "padding:10px 14px;margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;"
                    + "font-size:12px;line-height:1.5;\">"
                    + "<div style=\"font-size:16px;font-weight:bold;letter-spacing:1px;\">"
                    + "PROFORMA INVOICE</div>"
                    + "<div>This is a request for payment, not a tax invoice."
                    + (StringUtils.hasText(number)
                            ? " Reference <strong>" + number + "</strong> is provisional -"
                                    + " your final invoice number is issued once payment is received."
                            : " The final invoice number is issued once payment is received.")
                    + "</div></div>";
            return injectAfterBodyOpen(filled, banner);
        }

        if (!isProformaDoc && StringUtils.hasText(proformaNumber) && !templateShowsProformaRef) {
            String line = "<div style=\"margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;"
                    + "font-size:11px;color:#4b5563;\">Ref. Proforma: <strong>"
                    + escapeHtml(proformaNumber) + "</strong></div>";
            return injectAfterBodyOpen(filled, line);
        }

        return filled;
    }

    /**
     * Insert {@code snippet} immediately inside the document body, or at the very start when
     * the template has no {@code <body>} (some institute templates are fragments rather than
     * whole documents). Case-insensitive, and tolerant of attributes on the tag.
     */
    private String injectAfterBodyOpen(String html, String snippet) {
        if (!StringUtils.hasText(html)) {
            return snippet;
        }
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("<body[^>]*>", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(html);
        if (m.find()) {
            return html.substring(0, m.end()) + snippet + html.substring(m.end());
        }
        return snippet + html;
    }

    /**
     * Render the aggregated tax-component breakdown (computed per line item by
     * package type in buildInvoiceData) into the {{tax_components}} HTML table.
     * Each entry holds: label, rate (percent), amount (already summed). Returns an
     * empty string when nothing is configured so templates can hide the section.
     */
    private String renderTaxComponentsHtml(List<Map<String, Object>> components, String currencySymbol) {
        if (components == null || components.isEmpty()) {
            return "";
        }
        String symbol = currencySymbol != null ? currencySymbol : "";
        StringBuilder sb = new StringBuilder();
        sb.append("<table class=\"tax-components\" style=\"border-collapse:collapse;font-size:12px;\">");
        for (Map<String, Object> comp : components) {
            if (comp == null) {
                continue;
            }
            String label = comp.get("label") != null ? comp.get("label").toString() : "";
            String rate = formatRate(comp.get("rate"));
            if (label.isEmpty() && rate.isEmpty()) {
                continue;
            }
            String amount = comp.get("amount") != null ? comp.get("amount").toString() : "0";
            sb.append("<tr>")
                    .append("<td style=\"padding:2px 12px 2px 0;\">").append(escapeXmlAttributeValue(label))
                    .append("</td>")
                    .append("<td style=\"padding:2px 12px 2px 0;text-align:right;\">")
                    .append(escapeXmlAttributeValue(rate))
                    .append(rate.isEmpty() ? "" : "%")
                    .append("</td>")
                    .append("<td style=\"padding:2px 0;text-align:right;\">")
                    .append(escapeXmlAttributeValue(symbol + amount))
                    .append("</td>")
                    .append("</tr>");
        }
        sb.append("</table>");
        return sb.toString();
    }

    /** Cast a settings value to a String->Object map, or empty map. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> asStringObjectMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : new HashMap<>();
    }

    /** Cast a settings value to a list of component maps, or empty list. */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> asComponentList(Object o) {
        return o instanceof List ? (List<Map<String, Object>>) o : new ArrayList<>();
    }

    /**
     * Pick the tax components for a package type: the per-type list when configured
     * and non-empty, otherwise the institute's default list.
     */
    private List<Map<String, Object>> effectiveTaxComponents(List<Map<String, Object>> defaultComponents,
            Map<String, Object> byPackageType, String packageType) {
        if (packageType != null && byPackageType != null) {
            List<Map<String, Object>> forType = asComponentList(byPackageType.get(packageType));
            if (!forType.isEmpty()) {
                return forType;
            }
        }
        return defaultComponents;
    }

    /** Sum of component rates as a fraction (e.g. CGST 9 + SGST 9 -> 0.18). */
    private BigDecimal totalComponentRateFraction(List<Map<String, Object>> components) {
        BigDecimal total = BigDecimal.ZERO;
        if (components == null) {
            return total;
        }
        for (Map<String, Object> comp : components) {
            if (comp == null || comp.get("rate") == null) {
                continue;
            }
            try {
                total = total.add(new BigDecimal(comp.get("rate").toString()));
            } catch (NumberFormatException ignored) {
                // skip non-numeric rates
            }
        }
        return total.divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP);
    }

    /**
     * Resolve the package type for a payment log's line, via
     * UserPlan -> EnrollInvite -> PackageSessionLearnerInvitationToPaymentOption ->
     * PackageSession -> PackageEntity.packageType. Returns the first non-blank type
     * found, or null when it can't be resolved (caller falls back to default tax).
     */
    private String resolvePackageType(PaymentLog paymentLog) {
        try {
            if (paymentLog == null || paymentLog.getUserPlan() == null
                    || paymentLog.getUserPlan().getEnrollInvite() == null) {
                return null;
            }
            String enrollInviteId = paymentLog.getUserPlan().getEnrollInvite().getId();
            if (enrollInviteId == null) {
                return null;
            }
            var rows = packageSessionInvitationRepository
                    .findByEnrollInviteIdAndStatusWithPackageSession(enrollInviteId, List.of("ACTIVE"));
            for (var row : rows) {
                if (row.getPackageSession() != null && row.getPackageSession().getPackageEntity() != null) {
                    String type = row.getPackageSession().getPackageEntity().getPackageType();
                    if (type != null && !type.isBlank()) {
                        return type;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not resolve package type for payment log {}: {}",
                    paymentLog != null ? paymentLog.getId() : null, e.getMessage());
        }
        return null;
    }

    /**
     * Format a tax rate value (Number or String) into a clean display string:
     * whole numbers drop the trailing ".0" (9.0 -> "9"), others keep their value.
     */
    private String formatRate(Object rateObj) {
        if (rateObj == null) {
            return "";
        }
        try {
            double d = Double.parseDouble(rateObj.toString());
            if (d == Math.floor(d) && !Double.isInfinite(d)) {
                return String.valueOf((long) d);
            }
            return String.valueOf(d);
        } catch (NumberFormatException e) {
            return rateObj.toString();
        }
    }

    /**
     * Build institute logo HTML
     */
    private String buildInstituteLogoHtml(Institute institute) {
        if (institute.getLogoFileId() == null || institute.getLogoFileId().trim().isEmpty()) {
            // Return empty div to maintain layout structure
            return "<div class=\"logo-container\"></div>";
        }

        try {
            // Get logo URL from file ID (public URL without expiry)
            String logoUrl = mediaService.getFilePublicUrlByIdWithoutExpiry(institute.getLogoFileId());
            if (logoUrl != null && !logoUrl.trim().isEmpty()) {
                // S3 presigned URLs contain bare '&' (e.g. ?X-Amz-Algorithm=…&X-Amz-Date=…). XHTML
                // requires those written as &amp; — without this, the PDF builder's SAX parser
                // throws "The entity name must immediately follow the '&'" once the value is
                // serialized into an attribute. processImagesForPdf is supposed to inline the
                // image as base64 (which would also resolve this), but that has a silent
                // fallback: when the S3 fetch fails the raw URL stays in the document, so we
                // need the source-side escape too.
                String safeLogoUrl = escapeXmlAttributeValue(logoUrl);
                String safeAlt = escapeXmlAttributeValue(
                        (institute.getInstituteName() != null ? institute.getInstituteName() : "Logo")
                                + " Logo");
                // Inline size constraints so the logo never overflows, regardless of
                // whether the template defines .logo-container CSS (custom / sample
                // templates often don't).
                return "<div class=\"logo-container\" style=\"max-width:200px;\">"
                        + "<img src=\"" + safeLogoUrl + "\" alt=\"" + safeAlt + "\""
                        + " style=\"max-width:200px;max-height:80px;width:auto;height:auto;display:block;\" />"
                        + "</div>";
            }
        } catch (Exception e) {
            log.warn("Failed to get logo URL for institute: {}. Error: {}",
                    institute.getId(), e.getMessage());
        }

        // Return empty div to maintain layout structure
        return "<div class=\"logo-container\"></div>";
    }

    /**
     * Escape XML special characters for safe insertion into an attribute value.
     * Use whenever raw text or URLs are concatenated into an HTML attribute
     * before the document is parsed as XHTML by openhtmltopdf.
     */
    private static String escapeXmlAttributeValue(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    /**
     * Get theme color from institute (for table header)
     * Returns the actual institute theme color, or default dark green if not set
     */
    private String getInstituteThemeColor(Institute institute) {
        if (institute == null || institute.getInstituteThemeCode() == null ||
                institute.getInstituteThemeCode().trim().isEmpty()) {
            return "#1a5f3f"; // Default dark green color
        }

        String themeCode = institute.getInstituteThemeCode().trim();

        // If theme code is already a hex color, return it
        if (themeCode.startsWith("#") && themeCode.length() == 7) {
            return themeCode;
        }

        // If theme code is a hex color without #, add it
        if (themeCode.matches("^[0-9A-Fa-f]{6}$")) {
            return "#" + themeCode;
        }

        return "#1a5f3f"; // Default dark green color
    }

    /**
     * Get theme color from institute (deprecated - kept for backward compatibility)
     * 
     * @deprecated Use getInstituteThemeColor instead
     */
    @Deprecated
    private String getThemeColorFromInstitute(Institute institute) {
        return getInstituteThemeColor(institute);
    }

    /**
     * Build HTML table rows for line items
     */
    /**
     * HTML-escape an admin-supplied override value before it is spliced into the
     * invoice template. Prevents a stray {@code <}/{@code &} from breaking the XHTML the
     * PDF renderer (openhtmltopdf) requires, and neutralises any markup/script in the
     * preview HTML (which is also shown in a sandboxed iframe). The curly braces are also
     * encoded so an override value containing a {@code {{placeholder}}} token cannot be
     * re-expanded by a later substitution pass (template substitution is sequential).
     * Null → empty string.
     */
    private static String escapeHtml(String value) {
        if (value == null) return "";
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;")
                .replace("{", "&#123;")
                .replace("}", "&#125;");
    }

    private String buildLineItemsHtml(List<InvoiceLineItemData> lineItems, String currency) {
        if (lineItems == null || lineItems.isEmpty()) {
            return "<tr><td colspan='4'>No items</td></tr>";
        }

        String currencySymbol = getCurrencySymbol(currency != null ? currency : "INR");

        // Final safeguard: ensure currency symbol is never "#"
        if ("#".equals(currencySymbol) || currencySymbol == null || currencySymbol.trim().isEmpty()) {
            log.error("CRITICAL: Currency symbol is '#', null, or empty! Defaulting to ₹. Currency was: '{}'",
                    currency);
            currencySymbol = inrCurrencySymbol();
        }

        // Row shape is FIXED at 4 cells — Description | Quantity | Unit Price | Amount — matching
        // the default template's <thead>. This is plain string-templating, not a real table
        // renderer: every {{line_items}}-consuming <thead> across ALL institutes must declare
        // exactly these 4 columns in this order, or its data visibly misaligns. DO NOT add/reorder
        // cells here without auditing every existing custom INVOICE template's <thead> first — a
        // 2026-07-09 attempt to prepend a row-number cell would have fixed 3 institutes whose
        // templates already (incorrectly) expect a leading "#" column, but broken the other 7
        // whose templates correctly match this 4-column contract today.
        StringBuilder html = new StringBuilder();
        for (InvoiceLineItemData item : lineItems) {
            html.append("<tr>");
            html.append("<td>").append(item.getDescription() != null ? item.getDescription() : "").append("</td>");
            html.append("<td class=\"right text-center\" style=\"text-align:center\">")
                    .append(item.getQuantity() != null ? item.getQuantity() : 1).append("</td>");
            // Format unit price with currency symbol
            String unitPrice = money(item.getUnitPrice());
            html.append("<td class=\"right text-right\" style=\"text-align:right\">")
                    .append(currencySymbol).append(unitPrice).append("</td>");
            // Format amount with currency symbol
            String amount = money(item.getAmount());
            html.append("<td class=\"right text-right\" style=\"text-align:right\">")
                    .append(currencySymbol).append(amount).append("</td>");
            html.append("</tr>");
        }
        return html.toString();
    }

    private static final List<DateTimeFormatter> SESSION_DATE_FORMATS = java.util.stream.Stream.of(
                    "d MMM yyyy", "d MMMM yyyy", "EEE d MMM yyyy", "EEEE d MMMM yyyy",
                    "yyyy-MM-dd", "d/M/yyyy", "d-M-yyyy", "d.M.yyyy")
            .map(p -> new java.time.format.DateTimeFormatterBuilder()
                    .parseCaseInsensitive().appendPattern(p).toFormatter(Locale.ENGLISH))
            .toList();

    private static final DateTimeFormatter SESSION_DATE_DISPLAY = DateTimeFormatter.ofPattern("dd MMMM yyyy", Locale.ENGLISH);

    /** The date an admin typed into a line item, in any of the usual spellings, or null. */
    static LocalDate parseSessionDate(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String t = text.trim().replace(",", "").replaceAll("\\s+", " ");
        for (DateTimeFormatter f : SESSION_DATE_FORMATS) {
            try {
                return LocalDate.parse(t, f);
            } catch (java.time.format.DateTimeParseException ignored) {
                // try the next spelling
            }
        }
        return null;
    }

    /**
     * Line items as one row per class: Session N | Date | Subject | Day | Fee.
     *
     * <p>A line item carries only a description, so the description is read as
     * {@code "date | subject"} or {@code "date | subject | day"}. When the first part is a date
     * the day is worked out from it, so an admin types only the date and the subject. Anything
     * else is shown as typed: one part becomes the subject, and a first part that is not a date
     * is shown as the date text. The fee is the line amount.
     *
     * <p>The first cell carries {@code session-icon-1..3} in rotation so a template can give each
     * row an icon from its own CSS; the backend emits no images.
     */
    static String buildSessionRowsHtml(List<InvoiceLineItemData> lineItems, String currencySymbol) {
        if (lineItems == null || lineItems.isEmpty()) {
            return "<tr><td colspan=\"5\">No sessions</td></tr>";
        }
        StringBuilder html = new StringBuilder();
        int n = 0;
        for (InvoiceLineItemData item : lineItems) {
            n++;
            String[] parts = item.getDescription() != null ? item.getDescription().split("\\|", -1) : new String[0];
            String first = parts.length > 0 ? parts[0].trim() : "";
            String second = parts.length > 1 ? parts[1].trim() : "";
            String third = parts.length > 2 ? parts[2].trim() : "";
            LocalDate date = parseSessionDate(first);
            String dateText;
            String subject;
            String day;
            if (date != null) {
                dateText = date.format(SESSION_DATE_DISPLAY);
                subject = second;
                day = !third.isEmpty() ? third
                        : date.getDayOfWeek().getDisplayName(java.time.format.TextStyle.FULL, Locale.ENGLISH);
            } else if (parts.length <= 1) {
                dateText = "";
                subject = first;
                day = "";
            } else {
                dateText = first;
                subject = second;
                day = third;
            }
            BigDecimal amount = item.getAmount() != null ? item.getAmount() : item.getUnitPrice();
            html.append("<tr>")
                    .append("<td class=\"session-label session-icon-").append((n - 1) % 3 + 1).append("\">")
                    .append("Session ").append(n).append("</td>")
                    .append("<td class=\"session-date\">").append(escapeHtml(dateText)).append("</td>")
                    .append("<td class=\"session-subject\">").append(escapeHtml(subject)).append("</td>")
                    .append("<td class=\"session-day\">").append(escapeHtml(day)).append("</td>")
                    .append("<td class=\"session-fee\" style=\"text-align:right\">")
                    .append(currencySymbol).append(money(amount)).append("</td>")
                    .append("</tr>");
        }
        return html.toString();
    }

    /**
     * Resolve the Terms &amp; Conditions HTML for an invoice.
     *
     * Reads {@code INVOICE_SETTING.termsAndConditions} from the institute settings:
     * <pre>
     * {
     *   "default":   "&lt;ul&gt;...&lt;/ul&gt;",
     *   "byLevel":   { "buy": "...", "rent": "..." },
     *   "byPackage": { "&lt;package_uuid&gt;": "..." }
     * }
     * </pre>
     *
     * Resolution precedence per invoice (invoices are type-homogeneous, so we
     * resolve from the primary user plan): {@code byPackage[packageId]} →
     * {@code byLevel[levelName]} → {@code default}. Returns an empty string when
     * nothing matches, which lets the caller drop the surrounding section.
     */
    @SuppressWarnings("unchecked")
    private String buildTermsAndConditionsHtml(InvoiceData invoiceData) {
        if (invoiceData == null || invoiceData.getInstitute() == null) {
            return "";
        }

        Map<String, Object> invoiceSettings = getInvoiceSettings(invoiceData.getInstitute());
        Object tncRaw = invoiceSettings.get("termsAndConditions");
        if (!(tncRaw instanceof Map)) {
            return "";
        }
        Map<String, Object> tnc = (Map<String, Object>) tncRaw;

        String packageId = null;
        String levelId = null;
        String sessionId = null;

        try {
            UserPlan userPlan = invoiceData.getUserPlan();
            if (userPlan != null) {
                List<StudentSessionInstituteGroupMapping> mappings = studentSessionRepository
                        .findAllByUserPlanIdAndStatusIn(userPlan.getId(),
                                List.of("ACTIVE", "INVITED", "ABANDONED_CART", "DETAILS_FILLED"));
                if (mappings != null && !mappings.isEmpty()) {
                    StudentSessionInstituteGroupMapping mapping = mappings.get(0);
                    String packageSessionId = null;
                    if (mapping.getDestinationPackageSession() != null) {
                        packageSessionId = mapping.getDestinationPackageSession().getId();
                    } else if (mapping.getPackageSession() != null) {
                        packageSessionId = mapping.getPackageSession().getId();
                    }
                    if (packageSessionId != null && !packageSessionId.isEmpty()) {
                        Optional<InvoicePackageContextProjection> ctx = packageSessionRepository
                                .findPackageAndLevelByPackageSessionId(packageSessionId);
                        if (ctx.isPresent()) {
                            packageId = ctx.get().getPackageId();
                            levelId = ctx.get().getLevelId();
                            sessionId = ctx.get().getSessionId();
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to resolve package/level/session context for T&C lookup: {}", e.getMessage());
        }

        // 1) Per-package override
        if (packageId != null) {
            Object byPackageRaw = tnc.get("byPackage");
            if (byPackageRaw instanceof Map) {
                Object html = ((Map<String, Object>) byPackageRaw).get(packageId);
                if (html instanceof String && !((String) html).trim().isEmpty()) {
                    return (String) html;
                }
            }
        }

        // 2) Per-session fallback
        if (sessionId != null) {
            Object bySessionRaw = tnc.get("bySession");
            if (bySessionRaw instanceof Map) {
                Object html = ((Map<String, Object>) bySessionRaw).get(sessionId);
                if (html instanceof String && !((String) html).trim().isEmpty()) {
                    return (String) html;
                }
            }
        }

        // 3) Per-level fallback
        if (levelId != null) {
            Object byLevelRaw = tnc.get("byLevel");
            if (byLevelRaw instanceof Map) {
                Object html = ((Map<String, Object>) byLevelRaw).get(levelId);
                if (html instanceof String && !((String) html).trim().isEmpty()) {
                    return (String) html;
                }
            }
        }

        // 4) Institute-wide default
        Object defaultHtml = tnc.get("default");
        if (defaultHtml instanceof String && !((String) defaultHtml).trim().isEmpty()) {
            return (String) defaultHtml;
        }

        return "";
    }

    /**
     * Get currency from payment log with proper fallback
     */
    private String getCurrencyFromPaymentLog(PaymentLog paymentLog, PaymentPlan paymentPlan) {
        String paymentLogCurrency = paymentLog != null ? paymentLog.getCurrency() : null;
        String planCurrency = paymentPlan != null ? paymentPlan.getCurrency() : null;

        log.info("Getting currency - PaymentLog currency: '{}', Plan currency: '{}'", paymentLogCurrency, planCurrency);

        // Validate and normalize currency
        String currency = normalizeAndValidateCurrency(paymentLogCurrency, planCurrency);

        log.info("Final currency selected: '{}'", currency);
        return currency;
    }

    /**
     * Normalize and validate currency code, filtering out invalid values like "#"
     * or symbols
     */
    private String normalizeAndValidateCurrency(String paymentLogCurrency, String planCurrency) {
        // List of valid currency codes
        Set<String> validCurrencyCodes = Set.of("INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD", "AED");

        // Try payment log currency first
        if (paymentLogCurrency != null && !paymentLogCurrency.trim().isEmpty()) {
            String normalized = paymentLogCurrency.trim().toUpperCase();
            // Reject if it's a single character (like "#") or not a valid currency code
            if (normalized.length() >= 3
                    && (validCurrencyCodes.contains(normalized) || normalized.matches("^[A-Z]{3}$"))) {
                log.debug("Using payment log currency: '{}'", normalized);
                return normalized;
            } else {
                log.warn("Invalid payment log currency code: '{}', trying plan currency", paymentLogCurrency);
            }
        }

        // Try plan currency
        if (planCurrency != null && !planCurrency.trim().isEmpty()) {
            String normalized = planCurrency.trim().toUpperCase();
            if (normalized.length() >= 3
                    && (validCurrencyCodes.contains(normalized) || normalized.matches("^[A-Z]{3}$"))) {
                log.debug("Using plan currency: '{}'", normalized);
                return normalized;
            } else {
                log.warn("Invalid plan currency code: '{}', defaulting to INR", planCurrency);
            }
        }

        // Default to INR
        log.info("No valid currency found, defaulting to INR");
        return "INR";
    }

    /** INR symbol: the ₹ glyph when a Unicode font is embedded, else ASCII "Rs. ". */
    private String inrCurrencySymbol() {
        return UNICODE_INVOICE_FONT_AVAILABLE ? "₹" : "Rs. ";
    }

    /**
     * Get currency symbol based on currency code
     * This method ensures we never return "#" or invalid symbols
     */
    private String getCurrencySymbol(String currencyCode) {
        if (currencyCode == null || currencyCode.trim().isEmpty()) {
            log.debug("Currency code is null or empty, defaulting to INR symbol");
            return inrCurrencySymbol();
        }

        // Normalize currency code: trim whitespace and convert to uppercase
        String normalizedCurrency = currencyCode.trim().toUpperCase();

        // Reject invalid currency codes (single characters, symbols, etc.)
        if (normalizedCurrency.length() < 3 || normalizedCurrency.equals("#") ||
                normalizedCurrency.matches("^[#\\$€£¥₹]+$")) {
            log.warn("Invalid currency code detected: '{}', defaulting to INR symbol", currencyCode);
            return inrCurrencySymbol();
        }

        // Log the currency code being used for debugging
        log.debug("Getting currency symbol for currency code: '{}' (normalized: '{}')", currencyCode,
                normalizedCurrency);

        switch (normalizedCurrency) {
            case "INR":
                return inrCurrencySymbol();
            case "USD":
                return "$";
            case "EUR":
                return "€";
            case "GBP":
                return "£";
            case "JPY":
                return "¥";
            case "AUD":
                // "A$", like C$ / NZ$ / S$ below: a bare "$" reads as US dollars, and the payment
                // confirmation email (PaymentNotificatonService) already prints A$.
                return "A$";
            case "CAD":
                return "C$";
            case "SGD":
                return "S$";
            case "AED":
                return "AED "; // UAE Dirham (ASCII so it renders in the PDF font)
            // The remaining currencies the frontend's CURRENCY_OPTIONS dropdown offers
            // (frontend-admin-dashboard/src/constants/currencies.ts) — every currency
            // selectable in step 1 must resolve here, or it silently falls back to ₹
            // below. ASCII symbols throughout so no Unicode font dependency.
            case "SAR":
                return "SR "; // Saudi Riyal
            case "QAR":
                return "QR "; // Qatari Riyal
            case "HKD":
                return "HK$"; // Hong Kong Dollar
            case "NZD":
                return "NZ$"; // New Zealand Dollar
            case "CHF":
                return "CHF "; // Swiss Franc
            case "ZAR":
                return "R "; // South African Rand
            case "MYR":
                return "RM "; // Malaysian Ringgit
            default:
                log.warn("Unknown currency code: '{}', defaulting to INR symbol instead of using code as symbol",
                        normalizedCurrency);
                // Always default to INR symbol for unknown currencies to avoid showing invalid
                // symbols
                return inrCurrencySymbol();
        }
    }

    /**
     * Strip {@code @media ... screen ... { ... }} wrappers, promoting their contained CSS rules
     * to unconditional top-level rules. See the call site in {@link #generatePdfFromHtml} for
     * why: openhtmltopdf never matches a "screen" media context, so a template's screen-gated
     * rules (MJML's responsive column widths, in practice) would otherwise be silently dropped
     * in the PDF. Non-screen media blocks (e.g. {@code @media print}) are left untouched.
     * Best-effort: an unbalanced/malformed block is left as-is rather than risking corrupting
     * the rest of the document.
     */
    private String unwrapScreenMediaQueries(String html) {
        // Matches the "@media ... screen ..." prelude up to (not including) its opening '{'.
        // Deliberately broad ("screen" anywhere in the prelude) so it also catches
        // "@media screen and (min-width:480px)" and "@media only screen and (...)" variants,
        // and comma-separated lists like "@media print, screen".
        java.util.regex.Pattern mediaStart = java.util.regex.Pattern.compile(
                "@media\\s+[^{]*\\bscreen\\b[^{]*\\{", java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher m = mediaStart.matcher(html);
        StringBuilder out = new StringBuilder();
        int cursor = 0;
        while (cursor <= html.length() && m.find(cursor)) {
            int preludeStart = m.start();
            int braceOpen = m.end() - 1; // index of the matched '{'
            int depth = 1;
            int i = braceOpen + 1;
            while (i < html.length() && depth > 0) {
                char c = html.charAt(i);
                if (c == '{') depth++;
                else if (c == '}') depth--;
                i++;
            }
            if (depth != 0) {
                break; // unbalanced — bail out, leave the remainder of the document untouched
            }
            int blockEnd = i; // index just past the matching '}'
            out.append(html, cursor, preludeStart);
            out.append(html, braceOpen + 1, blockEnd - 1); // the block's inner rules, unwrapped
            cursor = blockEnd;
        }
        out.append(html.substring(cursor));
        return out.toString();
    }

    /**
     * Generate PDF from HTML
     */
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

            // MJML-compiled custom invoice templates (built via the admin template editor) gate
            // their responsive column widths (e.g. .mj-column-per-50 { width:50% !important })
            // behind `@media only screen and (min-width:480px) { ... }`. PdfRendererBuilder never
            // sets a CSS media type, so openhtmltopdf's print/no-media context never matches
            // "screen" and the whole block is silently skipped — the two-column FROM/BILL TO /
            // header layout collapses to stacked 100%-width blocks in the PDF even though the
            // identical HTML renders correctly (side-by-side) in a browser (the live preview
            // iframe, which is NOT run through this method). A PDF page is always "wide enough",
            // so unconditionally applying the desktop/screen variant is exactly what we want —
            // only the PDF path is touched; the preview HTML returned to the frontend is
            // unaffected.
            htmlWithCss = unwrapScreenMediaQueries(htmlWithCss);

            // Force the embedded Unicode font everywhere so glyphs like ₹ always render,
            // regardless of the template's own font-family (an unmatched family would fall
            // back to a base-14 font that lacks ₹ and render it as '#'). No-op when no
            // Unicode font is bundled (keeps the base-14 behavior).
            if (UNICODE_INVOICE_FONT_AVAILABLE) {
                String forceFontStyle =
                        "<style>*{font-family:'DejaVu Sans','NotoSans',sans-serif !important;}</style>";
                if (htmlWithCss.toLowerCase().contains("</head>")) {
                    htmlWithCss = htmlWithCss.replaceFirst("(?i)</head>", forceFontStyle + "</head>");
                } else if (htmlWithCss.toLowerCase().contains("<body")) {
                    htmlWithCss = htmlWithCss.replaceFirst("(?i)(<body[^>]*>)", "$1" + forceFontStyle);
                } else {
                    htmlWithCss = forceFontStyle + htmlWithCss;
                }
            }

            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();

            registerInvoicePdfFonts(builder);

            String processedHtml = processImagesForPdf(htmlWithCss);
            String sanitized = sanitizeToXhtml(processedHtml);
            // Defensive last-mile fixup: openhtmltopdf parses input strictly as XML, so any
            // remaining bare '&' (typical sources: URLs inside <style>/CDATA blocks that
            // Jsoup serializes verbatim, custom institute templates that hand-wrote a URL
            // with raw '&') would throw "The entity name must immediately follow the '&'".
            // Replace bare '&' (one not followed by a recognised entity reference) with &amp;.
            String xhtml = escapeBareAmpersands(sanitized);
            String baseUri = "file:///";

            try {
                builder.withHtmlContent(xhtml, baseUri);
                builder.useDefaultPageSize(210f, 297f, PdfRendererBuilder.PageSizeUnits.MM); // A4 portrait
                builder.toStream(outputStream);
                builder.run();
            } catch (Exception renderError) {
                // Persist the rendered HTML that failed to parse so the operator can grep for
                // the exact byte sequence at the column the SAX parser reported. This catch
                // only fires AFTER the bare-& fixup, so anything reaching here is a different
                // XML issue (unclosed tag, etc.).
                dumpHtmlForDebugging(xhtml, renderError);
                throw renderError;
            }

            return outputStream.toByteArray();
        } catch (Exception e) {
            log.error("Error generating PDF from HTML", e);
            throw new VacademyException("Failed to generate PDF: " + e.getMessage(), e);
        }
    }

    /**
     * Register the embedded Unicode font (if present) under the family names that
     * invoice templates commonly reference, so existing, custom and sample
     * templates all pick it up and render glyphs like ₹. When no font is bundled,
     * this is a no-op and the renderer uses its base-14 fallback (unchanged
     * behavior) — nothing breaks.
     */
    private void registerInvoicePdfFonts(PdfRendererBuilder builder) {
        if (!UNICODE_INVOICE_FONT_AVAILABLE) {
            return;
        }
        String[] families = { "Arial", "Helvetica", "Cairo", "sans-serif", "NotoSans", "DejaVu Sans" };
        for (String family : families) {
            builder.useFont(() -> InvoiceService.class.getResourceAsStream(RESOLVED_INVOICE_FONT_PATH), family);
        }
    }

    /**
     * Replace bare '&' (one not introducing a known XML/HTML entity) with '&amp;'.
     * Recognised forms left alone: named entities like &amp; &lt; &copy; &nbsp; &times;
     * (any '&' followed by an ASCII letter then word chars then ';'), decimal numeric
     * entities &#123; and hex numeric entities &#x1A;. Anything else, including the
     * '&X-Amz-…' query separators in S3 presigned URLs, gets escaped.
     */
    private static String escapeBareAmpersands(String xhtml) {
        if (xhtml == null) {
            return null;
        }
        return xhtml.replaceAll("&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#x[0-9A-Fa-f]+;)", "&amp;");
    }

    /**
     * Write the failing HTML to a temp file (and a snippet to the log) so the operator
     * can see exactly what tripped openhtmltopdf's parser. Best-effort — never throws.
     */
    private static void dumpHtmlForDebugging(String html, Throwable cause) {
        try {
            java.nio.file.Path dump = java.nio.file.Files.createTempFile("invoice-pdf-fail-", ".html");
            java.nio.file.Files.writeString(dump, html, java.nio.charset.StandardCharsets.UTF_8);
            log.error("Failing invoice HTML written to {} (size={} chars). Cause: {}", dump,
                    html.length(), cause.getMessage());
            // Try to surface the line/column the SAX parser blamed (format:
            // "lineNumber: 383; columnNumber: 19;") so the snippet is useful even
            // without opening the file.
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("lineNumber:\\s*(\\d+);\\s*columnNumber:\\s*(\\d+)")
                    .matcher(cause.getMessage() == null ? "" : cause.getMessage());
            if (m.find()) {
                int line = Integer.parseInt(m.group(1));
                int col = Integer.parseInt(m.group(2));
                String[] lines = html.split("\\r?\\n", -1);
                if (line - 1 < lines.length) {
                    String offending = lines[line - 1];
                    int from = Math.max(0, col - 30);
                    int to = Math.min(offending.length(), col + 30);
                    log.error("Offending content around line {} col {}: '...{}...'", line, col,
                            offending.substring(from, to));
                }
            }
        } catch (Exception dumpErr) {
            log.warn("Could not write invoice HTML debug dump: {}", dumpErr.getMessage());
        }
    }

    /**
     * Sanitize HTML to XHTML
     */
    private String sanitizeToXhtml(String html) {
        Document doc = Jsoup.parse(html);
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml);
        doc.outputSettings().escapeMode(Entities.EscapeMode.xhtml);
        return doc.html();
    }

    /**
     * Process images for PDF (convert URLs to base64)
     */
    private String processImagesForPdf(String html) {
        try {
            Document doc = Jsoup.parse(html);
            doc.select("img[src]").forEach(img -> {
                String src = img.attr("src");
                if (src != null && src.startsWith("http")) {
                    String base64 = convertUrlToBase64(src);
                    if (base64 != null) {
                        img.attr("src", base64);
                    }
                }
            });
            return doc.html();
        } catch (Exception e) {
            log.warn("Error processing images for PDF, using original HTML", e);
            return html;
        }
    }

    /**
     * Convert image URL to base64
     */
    private String convertUrlToBase64(String imageUrl) {
        try {
            java.net.URL url = new java.net.URL(imageUrl);
            java.net.HttpURLConnection connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (PDF Generator)");

            if (connection.getResponseCode() == 200) {
                try (java.io.InputStream inputStream = connection.getInputStream();
                        java.io.ByteArrayOutputStream outputStream = new java.io.ByteArrayOutputStream()) {

                    byte[] buffer = new byte[4096];
                    int bytesRead;
                    while ((bytesRead = inputStream.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, bytesRead);
                    }

                    byte[] imageBytes = outputStream.toByteArray();
                    String contentType = connection.getContentType();
                    if (contentType == null) {
                        contentType = "image/png";
                    }

                    String base64 = java.util.Base64.getEncoder().encodeToString(imageBytes);
                    return "data:" + contentType + ";base64," + base64;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to convert image URL to base64: {}", imageUrl, e);
        }
        return null;
    }

    /**
     * Upload invoice PDF to AWS S3 and return file ID
     */
    private String uploadInvoiceToS3(byte[] pdfBytes, String invoiceNumber, String instituteId) {
        try {
            String fileName = "invoice_" + invoiceNumber + ".pdf";
            MultipartFile multipartFile = new InMemoryMultipartFile(
                    fileName,
                    fileName,
                    "application/pdf",
                    pdfBytes);

            FileDetailsDTO fileDetails = mediaService.uploadFileV2(multipartFile);
            if (fileDetails != null && fileDetails.getId() != null) {
                log.debug("Invoice PDF uploaded to S3. File ID: {}, URL: {}",
                        fileDetails.getId(), fileDetails.getUrl());
                return fileDetails.getId();
            } else {
                throw new VacademyException("Failed to upload invoice PDF to S3");
            }
        } catch (Exception e) {
            log.error("Error uploading invoice PDF to S3", e);
            throw new VacademyException("Failed to upload invoice PDF: " + e.getMessage());
        }
    }

    /**
     * Save invoice to database with multiple payment logs.
     *
     * <p>Runs in its OWN transaction ({@link Propagation#REQUIRES_NEW}) so an invoice-number
     * collision can be retried. A unique-constraint violation marks its transaction
     * rollback-only; if this shared the caller's transaction, catching the exception and
     * re-saving would fail with {@code UnexpectedRollbackException} instead of retrying — see
     * {@link #renderAndSaveWithCollisionRetry}.
     *
     * <p>Consequence: the invoice, its line items and its payment-log mappings commit
     * independently of the caller. If the surrounding transaction later rolls back the invoice
     * survives. That is the safer direction here — the payment log is already committed by the
     * webhook, and the {@code existsByPaymentLogId} idempotency guard stops a retry creating a
     * second invoice.
     *
     * <p>MUST be invoked through {@code self} (the injected proxy), not directly: a private/
     * internal call bypasses the Spring proxy and the propagation would silently not apply.
     */
    /**
     * Generate an invoice for a payment once the caller's transaction has COMMITTED.
     *
     * <p>Callers that create the PaymentLog themselves — the CPO side-view offline payment, the
     * bulk-assign enrolment payment — must use this rather than calling
     * {@link #generateInvoice} inline, for two reasons:
     *
     * <ol>
     *   <li>{@link #saveInvoiceWithMultiplePaymentLogs} runs REQUIRES_NEW on the assumption its
     *       payment log is "already committed by the webhook". For an inline caller that is false:
     *       the log is still pending in the caller's uncommitted transaction, so the new
     *       transaction cannot see it and the insert dies on
     *       {@code invoice_payment_log_mapping_payment_log_id_fkey}.</li>
     *   <li>That failure then destroys the payment. Catching the exception does NOT clear the
     *       transaction's rollbackOnly flag, so the caller returns normally and the commit fails
     *       with "Transaction silently rolled back because it has been marked as rollback-only" —
     *       taking the PaymentLog, the ledger credit and the FIFO allocation with it.</li>
     * </ol>
     *
     * <p>Running after commit makes the REQUIRES_NEW assumption true and puts invoice failures
     * strictly downstream of the money: the worst case becomes a recorded payment with no invoice,
     * which can be regenerated, instead of a lost payment.
     *
     * <p>Falls through to running inline when no transaction is active, so a non-transactional
     * caller still gets its invoice.
     */
    public void generateInvoiceAfterCommit(String paymentLogId, String instituteId) {
        if (!StringUtils.hasText(paymentLogId)) {
            return;
        }
        Runnable task = () -> {
            try {
                self.generateInvoiceForCommittedPayment(paymentLogId, instituteId);
            } catch (Exception e) {
                // Deliberately swallowed: the payment is already committed and must stand even if
                // the invoice cannot be produced.
                log.error("Invoice generation failed for paymentLog {} — the payment itself is "
                        + "committed and unaffected: {}", paymentLogId, e.getMessage(), e);
            }
        };
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            task.run();
                        }
                    });
        } else {
            task.run();
        }
    }

    /**
     * One receipt for several payments recorded together — an admission package's payment split
     * across its courses. Runs after the caller's transaction commits (see
     * {@link #generateInvoiceAfterCommit}); a failure leaves the payments standing.
     */
    public void generateCombinedInvoiceAfterCommit(List<String> paymentLogIds, String instituteId) {
        if (paymentLogIds == null || paymentLogIds.isEmpty()) {
            return;
        }
        List<String> ids = new ArrayList<>(paymentLogIds);
        Runnable task = () -> {
            try {
                self.generateCombinedInvoiceForCommittedPayments(ids, instituteId);
            } catch (Exception e) {
                log.error("Combined invoice generation failed for payment logs {} — the payments are "
                        + "committed and unaffected: {}", ids, e.getMessage(), e);
            }
        };
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            task.run();
                        }
                    });
        } else {
            task.run();
        }
    }

    /**
     * {@link #generateCombinedInvoiceAfterCommit}'s work, in a fresh transaction: one invoice whose
     * lines are every course's installments these payments settled, and whose receipt figures
     * cover all of the courses. Payments already invoiced, unpaid or without a plan are left out;
     * a single remaining payment gets an ordinary invoice.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Invoice generateCombinedInvoiceForCommittedPayments(List<String> paymentLogIds, String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            log.warn("Skipping combined invoice for {}: institute id missing", paymentLogIds);
            return null;
        }
        List<PaymentLog> logs = new ArrayList<>();
        for (String id : paymentLogIds) {
            PaymentLog pl = paymentLogRepository.findById(id).orElse(null);
            if (pl == null || pl.getUserPlan() == null || !"PAID".equals(pl.getPaymentStatus())
                    || invoicePaymentLogMappingRepository.existsByPaymentLogId(pl.getId())) {
                continue;
            }
            logs.add(pl);
        }
        if (logs.isEmpty()) {
            return null;
        }
        if (logs.size() == 1) {
            return generateInvoice(logs.get(0).getUserPlan(), logs.get(0), instituteId);
        }
        InvoiceData invoiceData = buildInvoiceDataFromMultiplePaymentLogs(logs, instituteId);
        allocateInvoiceNumber(instituteId, invoiceData, DOC_TYPE_ENROLLMENT);
        String templateHtml = loadInvoiceTemplate(instituteId);
        RenderedInvoice rendered = renderAndSaveWithCollisionRetry(
                instituteId, invoiceData, templateHtml, logs, DOC_TYPE_ENROLLMENT);
        Invoice invoice = rendered.invoice();
        try {
            sendInvoiceEmail(invoice, invoiceData.getUser(), instituteId, rendered.pdfBytes());
        } catch (Exception e) {
            log.error("Failed to send combined invoice email for {}: {}", invoice.getInvoiceNumber(), e.getMessage());
        }
        log.info("Combined invoice {} generated for {} payment(s)", invoice.getInvoiceNumber(), logs.size());
        return invoice;
    }

    /**
     * Reloads the committed payment log and its plan in one fresh transaction, so nothing is
     * touched while detached, then generates the invoice.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void generateInvoiceForCommittedPayment(String paymentLogId, String instituteId) {
        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElse(null);
        if (paymentLog == null) {
            log.warn("Skipping post-commit invoice: payment log {} not found", paymentLogId);
            return;
        }
        UserPlan userPlan = paymentLog.getUserPlan();
        if (userPlan == null) {
            log.warn("Skipping post-commit invoice: payment log {} has no user plan", paymentLogId);
            return;
        }
        if (!StringUtils.hasText(instituteId)) {
            log.warn("Skipping post-commit invoice for payment log {}: institute id not resolvable", paymentLogId);
            return;
        }
        generateInvoice(userPlan, paymentLog, instituteId);
    }

    /**
     * {@link #generateInvoiceWithResult} for a payment that has ALREADY COMMITTED, reloaded in a
     * fresh transaction — the result-returning twin of {@link #generateInvoiceForCommittedPayment}
     * for callers that still need the PDF afterwards (the synchronous-gateway path attaches it to
     * the payment-confirmation email). Returns null when the log or its plan is gone.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InvoiceGenerationResult generateInvoiceWithResultForCommittedPayment(String paymentLogId,
            String instituteId, boolean sendEmail) {
        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElse(null);
        if (paymentLog == null || paymentLog.getUserPlan() == null || !StringUtils.hasText(instituteId)) {
            log.warn("Skipping post-commit invoice for payment log {}: log, plan or institute missing", paymentLogId);
            return null;
        }
        return generateInvoiceWithResult(paymentLog.getUserPlan(), paymentLog, instituteId, sendEmail);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Invoice saveInvoiceWithMultiplePaymentLogs(InvoiceData invoiceData, String invoiceNumber, String pdfFileId,
            List<PaymentLog> paymentLogs, String instituteId) {
        try {
            if (paymentLogs == null || paymentLogs.isEmpty()) {
                throw new VacademyException("Payment logs list cannot be empty");
            }

            PaymentLog firstPaymentLog = paymentLogs.get(0);

            Invoice invoice = new Invoice();
            invoice.setInvoiceNumber(invoiceNumber);
            // The sequence position must be persisted, not just the rendered number: it IS
            // the institute's counter, so an invoice saved without it is invisible to the
            // next allocation and its number would eventually be issued again.
            invoice.setSeqNo(invoiceData.getSeqNo());
            invoice.setSeqScopeKey(invoiceData.getSeqScopeKey());
            invoice.setUserId(firstPaymentLog.getUserId());
            invoice.setInstituteId(instituteId);
            invoice.setInvoiceDate(invoiceData.getInvoiceDate());
            invoice.setDueDate(invoiceData.getDueDate());
            invoice.setSubtotal(invoiceData.getSubtotal());
            invoice.setDiscountAmount(invoiceData.getDiscountAmount());
            invoice.setTaxAmount(invoiceData.getTaxAmount());
            invoice.setTotalAmount(invoiceData.getTotalAmount());
            invoice.setCurrency(invoiceData.getCurrency());
            invoice.setStatus(INVOICE_STATUS_GENERATED);
            invoice.setPdfFileId(pdfFileId);
            invoice.setTaxIncluded(invoiceData.getTaxIncluded());

            // Source tracking: point to the UserPlan that triggered this invoice
            if (firstPaymentLog.getUserPlan() != null) {
                invoice.setSource("USER_PLAN");
                invoice.setSourceId(firstPaymentLog.getUserPlan().getId());
            }

            // Save invoice data as JSON
            try {
                ObjectMapper objectMapper = new ObjectMapper();
                invoice.setInvoiceDataJson(objectMapper.writeValueAsString(invoiceData));
            } catch (Exception e) {
                log.warn("Failed to serialize invoice data to JSON", e);
            }

            invoice = invoiceRepository.save(invoice);

            // Save payment log mappings
            for (PaymentLog paymentLog : paymentLogs) {
                InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
                mapping.setInvoice(invoice);
                mapping.setPaymentLog(paymentLog);
                invoicePaymentLogMappingRepository.save(mapping);
                log.debug("Saved payment log mapping: {} -> {}", paymentLog.getId(), invoiceNumber);
            }

            // Save line items
            if (invoiceData.getLineItems() != null) {
                for (InvoiceLineItemData itemData : invoiceData.getLineItems()) {
                    InvoiceLineItem lineItem = new InvoiceLineItem();
                    lineItem.setInvoice(invoice);
                    lineItem.setItemType(itemData.getItemType());
                    lineItem.setDescription(itemData.getDescription());
                    lineItem.setQuantity(itemData.getQuantity());
                    lineItem.setUnitPrice(itemData.getUnitPrice());
                    lineItem.setAmount(itemData.getAmount());
                    lineItem.setSourceId(itemData.getSourceId());
                    invoiceLineItemRepository.save(lineItem);
                }
            }

            log.debug("Invoice saved to database: {} with {} payment logs", invoiceNumber, paymentLogs.size());
            return invoice;

        } catch (DataIntegrityViolationException e) {
            // Must escape the generic catch below: this is how an invoice-number collision
            // reports itself, and renderAndSaveWithCollisionRetry needs to see the real type
            // to retry with the next number. Wrapping it in VacademyException would make the
            // retry unreachable.
            log.warn("Invoice insert violated a constraint (likely a number collision): {}", e.getMessage());
            throw e;
        } catch (Exception e) {
            log.error("Error saving invoice to database", e);
            throw new VacademyException("Failed to save invoice: " + e.getMessage());
        }
    }

    /**
     * Save invoice to database (legacy method for single payment log)
     * 
     * @deprecated Use saveInvoiceWithMultiplePaymentLogs instead
     */
    @Deprecated
    private Invoice saveInvoice(InvoiceData invoiceData, String invoiceNumber, String pdfFileId,
            UserPlan userPlan, PaymentLog paymentLog, String instituteId) {
        try {
            Invoice invoice = new Invoice();
            invoice.setInvoiceNumber(invoiceNumber);
            // See saveInvoiceWithMultiplePaymentLogs — the sequence position is the counter.
            invoice.setSeqNo(invoiceData.getSeqNo());
            invoice.setSeqScopeKey(invoiceData.getSeqScopeKey());
            invoice.setUserId(paymentLog.getUserId());

            // Create payment log mapping for single payment log (legacy support)
            InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
            mapping.setInvoice(invoice);
            mapping.setPaymentLog(paymentLog);
            invoice.setInstituteId(instituteId);
            invoice.setInvoiceDate(invoiceData.getInvoiceDate());
            invoice.setDueDate(invoiceData.getDueDate());
            invoice.setSubtotal(invoiceData.getSubtotal());
            invoice.setDiscountAmount(invoiceData.getDiscountAmount());
            invoice.setTaxAmount(invoiceData.getTaxAmount());
            invoice.setTotalAmount(invoiceData.getTotalAmount());
            invoice.setCurrency(invoiceData.getCurrency());
            invoice.setStatus(INVOICE_STATUS_GENERATED);
            invoice.setPdfFileId(pdfFileId);
            invoice.setTaxIncluded(invoiceData.getTaxIncluded());

            // Save invoice data as JSON
            try {
                ObjectMapper objectMapper = new ObjectMapper();
                invoice.setInvoiceDataJson(objectMapper.writeValueAsString(invoiceData));
            } catch (Exception e) {
                log.warn("Failed to serialize invoice data to JSON", e);
            }

            invoice = invoiceRepository.save(invoice);

            // Save payment log mapping
            mapping.setInvoice(invoice);
            invoicePaymentLogMappingRepository.save(mapping);

            // Save line items
            if (invoiceData.getLineItems() != null) {
                for (InvoiceLineItemData itemData : invoiceData.getLineItems()) {
                    InvoiceLineItem lineItem = new InvoiceLineItem();
                    lineItem.setInvoice(invoice);
                    lineItem.setItemType(itemData.getItemType());
                    lineItem.setDescription(itemData.getDescription());
                    lineItem.setQuantity(itemData.getQuantity());
                    lineItem.setUnitPrice(itemData.getUnitPrice());
                    lineItem.setAmount(itemData.getAmount());
                    lineItem.setSourceId(itemData.getSourceId());
                    invoiceLineItemRepository.save(lineItem);
                }
            }

            log.debug("Invoice saved to database: {}", invoiceNumber);
            return invoice;

        } catch (Exception e) {
            log.error("Error saving invoice to database", e);
            throw new VacademyException("Failed to save invoice: " + e.getMessage());
        }
    }

    /** 3-arg overload for callers that do not have PDF bytes (e.g. test endpoints); uses link in body. */
    private void sendInvoiceEmail(Invoice invoice, UserDTO user, String instituteId) {
        sendInvoiceEmail(invoice, user, instituteId, null);
    }

    /**
     * Send invoice email to learner if institute setting sendInvoiceEmail is on.
     * When pdfBytes is provided, attaches the PDF to the email; otherwise includes a download link in the body.
     */
    private void sendInvoiceEmail(Invoice invoice, UserDTO user, String instituteId, byte[] pdfBytes) {
        sendInvoiceEmail(invoice, user, instituteId, pdfBytes, false);
    }

    /**
     * @param forceSend bypass the institute's sendInvoiceEmail opt-in — used for
     *                  live-session fee invoices, where receiving the invoice is
     *                  part of the product promise rather than an institute setting.
     */
    private void sendInvoiceEmail(Invoice invoice, UserDTO user, String instituteId, byte[] pdfBytes, boolean forceSend) {
        try {
            if (user == null || !StringUtils.hasText(user.getEmail())) {
                log.warn("Cannot send invoice email: user or email is null for invoice: {}", invoice.getInvoiceNumber());
                return;
            }
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null) {
                log.warn("Institute not found for invoice email: {}", instituteId);
                return;
            }
            Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
            Object sendFlag = invoiceSettings.get("sendInvoiceEmail");
            boolean sendInvoiceEmail = Boolean.TRUE.equals(sendFlag);
            if (!sendInvoiceEmail && !forceSend) {
                log.debug("Invoice email disabled by institute setting for institute: {}", instituteId);
                return;
            }

            // Say what the document actually is. A proforma emailed as "Your Invoice" reads as a
            // tax invoice, and its number is replaced the moment it is paid.
            String documentType = documentNounTitleCase(invoice);
            String subject = "Your " + documentType + " " + invoice.getInvoiceNumber();
            String body;
            boolean attachPdf = pdfBytes != null && pdfBytes.length > 0;

            // First: try INVOICE_EMAIL type templates (created via easy-email editor)
            // Uses the template marked default in Settings > Invoice, else the most recently created
            var invoiceEmailTemplates = templateService.getTemplatesByInstituteAndType(instituteId, "INVOICE_EMAIL");
            var invoiceEmailTemplate = invoiceEmailTemplates.isEmpty()
                    ? Optional.<vacademy.io.admin_core_service.features.institute.dto.template.TemplateResponse>empty()
                    : InvoiceDefaultTemplatePicker.pick(invoiceEmailTemplates,
                            readDefaultInvoiceTemplateId(instituteId, InvoiceDefaultTemplatePicker.EMAIL_SETTING_KEY));

            // Fallback: legacy EMAIL type with name "Invoice Email"
            if (invoiceEmailTemplate.isEmpty()) {
                var emailTemplates = templateService.getTemplatesByInstituteAndType(instituteId, "EMAIL");
                invoiceEmailTemplate = emailTemplates.stream()
                        .filter(t -> "Invoice Email".equals(t.getName()))
                        .findFirst();
            }

            if (invoiceEmailTemplate.isPresent()) {
                subject = invoiceEmailTemplate.get().getSubject() != null ? invoiceEmailTemplate.get().getSubject() : subject;
                body = invoiceEmailTemplate.get().getContent() != null ? invoiceEmailTemplate.get().getContent() : buildDefaultInvoiceEmailBody(invoice, user, instituteId, attachPdf);
            } else {
                body = buildDefaultInvoiceEmailBody(invoice, user, instituteId, attachPdf);
            }

            String learnerName = user.getFullName() != null ? user.getFullName() : user.getEmail();
            String invoiceNumber = invoice.getInvoiceNumber() != null ? invoice.getInvoiceNumber() : "";
            String totalAmount = invoice.getTotalAmount() != null ? invoice.getTotalAmount().toPlainString() : "0.00";
            String pdfLinkOrAttachText = attachPdf ? "Please find your invoice attached to this email." : (StringUtils.hasText(invoice.getPdfFileId()) ? mediaService.getFilePublicUrlByIdWithoutExpiry(invoice.getPdfFileId()) : "");

            // Replace all supported placeholders (both new and legacy)
            body = body.replace("{{invoice_number}}", invoiceNumber)
                    .replace("{{user_name}}", learnerName)
                    .replace("{{learner_name}}", learnerName)
                    .replace("{{total_amount}}", totalAmount)
                    .replace("{{document_type}}", documentType)
                    .replace("{{invoice_pdf_link}}", pdfLinkOrAttachText);
            subject = subject.replace("{{invoice_number}}", invoiceNumber)
                    .replace("{{user_name}}", learnerName)
                    .replace("{{learner_name}}", learnerName)
                    .replace("{{document_type}}", documentType);

            // Institute placeholders (name/address/contact) — the email template can use
            // {{institute_name}} etc., which the body-replace above did not cover.
            try {
                Institute emailInstitute = instituteRepository.findById(instituteId).orElse(null);
                if (emailInstitute != null) {
                    String instName = emailInstitute.getInstituteName() != null ? emailInstitute.getInstituteName() : "";
                    String instAddr = emailInstitute.getAddress() != null ? emailInstitute.getAddress() : "";
                    String instContact = emailInstitute.getMobileNumber() != null ? emailInstitute.getMobileNumber()
                            : (emailInstitute.getEmail() != null ? emailInstitute.getEmail() : "");
                    body = body.replace("{{institute_name}}", instName)
                            .replace("{{institute_address}}", instAddr)
                            .replace("{{institute_contact}}", instContact);
                    subject = subject.replace("{{institute_name}}", instName);
                }
            } catch (Exception e) {
                log.warn("Could not resolve institute placeholders for invoice email (institute {}): {}",
                        instituteId, e.getMessage());
            }

            if (attachPdf) {
                String attachmentName = (isProforma(invoice) ? "proforma_" : "invoice_")
                        + (invoice.getInvoiceNumber() != null ? invoice.getInvoiceNumber() : invoice.getId())
                        + ".pdf";
                AttachmentUsersDTO.AttachmentDTO attachmentDTO = new AttachmentUsersDTO.AttachmentDTO();
                attachmentDTO.setAttachmentName(attachmentName);
                attachmentDTO.setAttachment(Base64.getEncoder().encodeToString(pdfBytes));

                AttachmentUsersDTO toUser = new AttachmentUsersDTO();
                toUser.setChannelId(user.getEmail());
                toUser.setUserId(user.getId());
                toUser.setPlaceholders(Map.of("email", user.getEmail()));
                toUser.setAttachments(List.of(attachmentDTO));

                java.util.List<AttachmentUsersDTO> recipients = new java.util.ArrayList<>();
                recipients.add(toUser);
                billingContactRecipientResolver
                        .buildBillingContactAttachmentRecipient(user.getId(), instituteId, user.getEmail(), List.of(attachmentDTO))
                        .ifPresent(recipients::add);
                recipients.addAll(invoiceAdminCopyRecipientResolver.buildAdminCopyAttachmentRecipients(
                        instituteId,
                        recipients.stream().map(AttachmentUsersDTO::getChannelId).collect(Collectors.toSet()),
                        List.of(attachmentDTO)));

                AttachmentNotificationDTO attachmentDto = AttachmentNotificationDTO.builder()
                        .body(body)
                        .subject(subject)
                        .notificationType("EMAIL")
                        .source("INVOICE")
                        .sourceId(invoice.getId())
                        .users(recipients)
                        .build();

                notificationService.sendAttachmentEmailViaUnified(List.of(attachmentDto), instituteId);
                log.info("Invoice email sent to {} recipient(s) for invoice: {} (PDF attached)", recipients.size(), invoice.getInvoiceNumber());
            } else {
                NotificationDTO notificationDTO = new NotificationDTO();
                notificationDTO.setBody(body);
                notificationDTO.setSubject(subject);
                notificationDTO.setNotificationType("EMAIL");
                notificationDTO.setSource("INVOICE");
                notificationDTO.setSourceId(invoice.getId());
                NotificationToUserDTO toUser = new NotificationToUserDTO();
                toUser.setChannelId(user.getEmail());
                toUser.setUserId(user.getId());
                toUser.setPlaceholders(Map.of("email", user.getEmail()));

                java.util.List<NotificationToUserDTO> recipients = new java.util.ArrayList<>();
                recipients.add(toUser);
                billingContactRecipientResolver
                        .buildBillingContactRecipient(user.getId(), instituteId, user.getEmail())
                        .ifPresent(recipients::add);
                recipients.addAll(invoiceAdminCopyRecipientResolver.buildAdminCopyRecipients(
                        instituteId,
                        recipients.stream().map(NotificationToUserDTO::getChannelId).collect(Collectors.toSet())));
                notificationDTO.setUsers(recipients);

                notificationService.sendEmailViaUnified(notificationDTO, instituteId);
                log.info("Invoice email sent to {} recipient(s) for invoice: {} (link in body)", recipients.size(), invoice.getInvoiceNumber());
            }
        } catch (Exception e) {
            log.error("Error sending invoice email", e);
            // Don't throw - email failure shouldn't fail invoice generation
        }
    }

    private String buildDefaultInvoiceEmailBody(Invoice invoice, UserDTO user, String instituteId, boolean pdfAttached) {
        String noun = documentNoun(invoice);
        String number = invoice.getInvoiceNumber() != null ? invoice.getInvoiceNumber() : "";
        // A proforma is a request for payment, not a receipt — and its number is provisional.
        // Say both, so nobody files it as a tax invoice or quotes a number that will change.
        String proformaNote = isProforma(invoice)
                ? "<p>This is a proforma invoice — a request for payment, not a tax invoice. "
                        + "Once payment is received we will issue your invoice with its final "
                        + "invoice number.</p>"
                : "";
        if (pdfAttached) {
            return "<p>Dear " + (user.getFullName() != null ? user.getFullName() : user.getEmail()) + ",</p>"
                    + "<p>Please find your " + noun + " " + number + " attached to this email.</p>"
                    + proformaNote
                    + "<p>Thank you.</p>";
        }
        String pdfUrl = StringUtils.hasText(invoice.getPdfFileId())
                ? mediaService.getFilePublicUrlByIdWithoutExpiry(invoice.getPdfFileId())
                : "";
        return "<p>Dear " + (user.getFullName() != null ? user.getFullName() : user.getEmail()) + ",</p>"
                + "<p>Please find your " + noun + " " + number + ".</p>"
                + (StringUtils.hasText(pdfUrl) ? "<p>Download your " + noun + ": <a href=\"" + pdfUrl + "\">" + pdfUrl + "</a></p>" : "")
                + proformaNote
                + "<p>Thank you.</p>";
    }

    /**
     * Get invoice by ID
     */
    public InvoiceDTO getInvoiceById(String invoiceId) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        return mapToDTO(invoice);
    }

    /**
     * Get invoices by user ID.
     *
     * <p>After the V224 CPO unification, this also union-merges every UNPAID
     * StudentFeePayment row for the user into the response, mapped to InvoiceDTO
     * so the existing Learner Profile → Payment History panel surfaces pending
     * CPO installments alongside paid invoices in a single list — no contract
     * change for the frontend.
     *
     * <p>Paid CPO installments are NOT mirrored from SFP rows (they already exist
     * as real Invoice rows generated by {@code PaymentLogService} on PAID payment
     * webhooks).
     */
    public List<InvoiceDTO> getInvoicesByUserId(String userId) {
        return getInvoicesByUserId(userId, null);
    }

    public List<InvoiceDTO> getInvoicesByUserId(String userId, String instituteId) {
        List<Invoice> invoices = StringUtils.hasText(instituteId)
                ? invoiceRepository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId)
                : invoiceRepository.findByUserIdOrderByCreatedAtDesc(userId);
        List<InvoiceDTO> result = invoices.stream().map(this::mapToDTO).collect(Collectors.toList());

        // Synthetic per-installment rows. Dedupe vs real-Invoice rows already in
        // `result` by invoice id — buildSfpInvoiceDTOs now writes the real Invoice's
        // id onto its synthetic DTO when one exists, so we must avoid emitting both
        // the real-Invoice row AND the synthetic-with-real-id row for the same id.
        // The synthetic row is preferred because it carries the per-installment
        // status/due-date the admin actually wants to see in this listing.
        java.util.Set<String> realInvoiceIds = new java.util.HashSet<>();
        for (InvoiceDTO existing : result) {
            if (existing.getId() != null) realInvoiceIds.add(existing.getId());
        }
        java.util.Set<String> coveredInvoiceIds = new java.util.HashSet<>();
        List<InvoiceDTO> sfpRows = buildSfpInvoiceDTOs(userId, coveredInvoiceIds);
        for (InvoiceDTO sfpRow : sfpRows) {
            String id = sfpRow.getId();
            if (id != null && !id.startsWith("sfp:")) coveredInvoiceIds.add(id);
        }
        coveredInvoiceIds.retainAll(realInvoiceIds);
        if (!coveredInvoiceIds.isEmpty()) {
            result.removeIf(r -> r.getId() != null && coveredInvoiceIds.contains(r.getId()));
        }
        result.addAll(sfpRows);

        // Sort: invoices with a due_date first by due_date asc, then created_at desc.
        result.sort((a, b) -> {
            LocalDateTime ad = a.getDueDate();
            LocalDateTime bd = b.getDueDate();
            if (ad != null && bd != null) return ad.compareTo(bd);
            if (ad != null) return -1;
            if (bd != null) return 1;
            LocalDateTime ac = a.getCreatedAt();
            LocalDateTime bc = b.getCreatedAt();
            if (ac == null && bc == null) return 0;
            if (ac == null) return 1;
            if (bc == null) return -1;
            return bc.compareTo(ac);
        });
        return result;
    }

    /**
     * Synthesizes one virtual InvoiceDTO per StudentFeePayment row so the
     * payment-history tab can render every installment regardless of payment
     * state. Earlier this method only emitted unpaid rows ("DUE-*") because
     * paid installments were assumed to have a real Invoice row generated by
     * the webhook. That assumption breaks for offline-payment + dev
     * environments where PDF/S3 upload may fail and no real Invoice row gets
     * persisted — leaving paid installments invisible in the listing.
     *
     * <p>Status-prefixed invoice numbers ("PAID-*", "PARTIAL-*", "DUE-*",
     * "WAIVED-*", "OVERDUE-*") let the frontend distinguish the synthetic
     * entries from real Invoice rows. Skips DELETED rows.
     *
     * @param coveredInvoiceIds filled with every Invoice reachable from this user's installment
     *                          ledger. An installment paid in parts has a ledger row per payment,
     *                          and each of those payments has its own Invoice; the listing must
     *                          drop all of them, not just the one the installment row ends up
     *                          labelled with, or the rest are counted a second time.
     */
    private List<InvoiceDTO> buildSfpInvoiceDTOs(String userId, java.util.Set<String> coveredInvoiceIds) {
        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserId(userId);

        // Pre-build a sfpId → (realInvoiceId, pdfFileId, pdfUrl) lookup so each
        // synthetic row exposes the actual Invoice it corresponds to. Once the real
        // invoice id is on the DTO, the frontend hits the canonical
        // /v1/invoices/{invoiceId}/download endpoint — same path the manage-students
        // payment-history surface uses. The endpoint regenerates the PDF on the fly
        // when the persisted Invoice has no fileId (the dev-S3-fail case), so a
        // missing fileId at this point is fine — we still surface the real id.
        //
        // Path: SFP → StudentFeeAllocationLedger (latest by createdAt) → PaymentLog
        //       → InvoicePaymentLogMapping → Invoice. We pick the MOST RECENT
        // allocation per SFP because a partial payment can produce multiple ledger
        // rows over time; the latest one corresponds to the invoice the admin wants.
        Map<String, String[]> sfpIdToPdfInfo = new HashMap<>();
        // userPlanId -> currency, resolved in ONE query below. The synthetic rows used to
        // report "INR" unconditionally, which rendered every AUD installment with a rupee
        // symbol in the manage-students payment-history tab.
        Map<String, String> userPlanIdToCurrency = new HashMap<>();
        try {
            List<String> sfpIds = sfps.stream()
                    .map(StudentFeePayment::getId)
                    .filter(s -> s != null && !s.isBlank())
                    .collect(Collectors.toList());
            if (!sfpIds.isEmpty()) {
                List<vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger> ledgers =
                        studentFeeAllocationLedgerRepository
                                .findByStudentFeePaymentIdInOrderByCreatedAtDesc(sfpIds);
                Map<String, String> sfpIdToPaymentLogId = new HashMap<>();
                for (var ledger : ledgers) {
                    // findByStudentFeePaymentIdInOrderByCreatedAtDesc is sorted desc, so
                    // putIfAbsent keeps the most-recent PaymentLog per SFP — that is the one
                    // the row gets labelled with.
                    sfpIdToPaymentLogId.putIfAbsent(
                            ledger.getStudentFeePaymentId(), ledger.getPaymentLogId());
                }
                // Every payment in the ledger in one lookup, not one query per row.
                Map<String, Invoice> paymentLogIdToInvoice = new HashMap<>();
                List<String> ledgerPaymentLogIds = ledgers.stream()
                        .map(l -> l.getPaymentLogId())
                        .filter(id -> id != null && !id.isBlank())
                        .distinct()
                        .collect(Collectors.toList());
                if (!ledgerPaymentLogIds.isEmpty()) {
                    for (var mapping : invoicePaymentLogMappingRepository
                            .findAllByPaymentLogIdIn(ledgerPaymentLogIds)) {
                        Invoice inv = mapping.getInvoice();
                        if (inv == null || mapping.getPaymentLog() == null) continue;
                        paymentLogIdToInvoice.putIfAbsent(mapping.getPaymentLog().getId(), inv);
                        // An installment paid in parts has a ledger row per payment, and each of
                        // those payments has an Invoice of its own. The listing has to drop all of
                        // them, not only the one this installment ends up labelled with, or the
                        // rest are shown a second time beside the row that already covers them.
                        coveredInvoiceIds.add(inv.getId());
                    }
                }
                for (Map.Entry<String, String> e : sfpIdToPaymentLogId.entrySet()) {
                    Invoice inv = paymentLogIdToInvoice.get(e.getValue());
                    if (inv != null) {
                        String realInvoiceId = inv.getId();
                        String pdfFileId = inv.getPdfFileId();
                        String url = StringUtils.hasText(pdfFileId)
                                ? mediaService.getFilePublicUrlById(pdfFileId)
                                : null;
                        sfpIdToPdfInfo.put(e.getKey(),
                                new String[]{realInvoiceId, pdfFileId, url, inv.getCurrency(),
                                        inv.getInvoiceNumber(),
                                        inv.getTotalAmount() != null ? inv.getTotalAmount().toPlainString() : null});
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not enrich SFP DTOs with invoice PDFs for user {}: {}", userId, e.getMessage());
        }
        try {
            List<String> userPlanIds = sfps.stream()
                    .map(StudentFeePayment::getUserPlanId)
                    .filter(StringUtils::hasText)
                    .distinct()
                    .collect(Collectors.toList());
            if (!userPlanIds.isEmpty()) {
                for (Object[] row : userPlanRepository.findPlanCurrencyByUserPlanIds(userPlanIds)) {
                    String planId = row[0] != null ? row[0].toString() : null;
                    String planCurrency = row[1] != null ? row[1].toString() : null;
                    if (StringUtils.hasText(planId) && StringUtils.hasText(planCurrency)) {
                        userPlanIdToCurrency.put(planId, planCurrency.trim().toUpperCase());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not resolve plan currency for SFP rows of user {}: {}", userId, e.getMessage());
        }
        List<InvoiceDTO> dtos = new ArrayList<>();
        // One receipt can settle several installments: two of one course, or one of each course
        // of an admission package. It is listed once, for what it was issued for, not once per
        // installment with that installment's share (I2CAN, 2026-10-22: one admission receipt
        // read as four).
        Map<String, InvoiceDTO> receiptRows = new HashMap<>();
        Map<String, BigDecimal> receiptTotals = new HashMap<>();
        for (StudentFeePayment sfp : sfps) {
            String status = sfp.getStatus();
            if (status == null || "DELETED".equalsIgnoreCase(status)) continue;

            BigDecimal expected = sfp.getAmountExpected() != null ? sfp.getAmountExpected() : BigDecimal.ZERO;
            BigDecimal paid = sfp.getAmountPaid() != null ? sfp.getAmountPaid() : BigDecimal.ZERO;
            // Cancelled with its course: nothing is due. An unpaid one drops out of the list; one
            // with money on it stays, as the receipt for that money.
            if ("CANCELLED".equalsIgnoreCase(status)) {
                if (paid.signum() <= 0) continue;
                status = "PAID";
            }
            BigDecimal outstanding = expected.subtract(paid);

            // Amount column meaning differs by status — admins reading the row
            // want different numbers in each case:
            //   PAID         → receipt for what was actually collected
            //   PARTIAL_PAID → balance still owed (so they can see what's left)
            //   PENDING/DUE  → full bill (the obligation)
            //   OVERDUE      → balance still owed (with overdue flag)
            //   WAIVED       → zero (writeoff)
            BigDecimal displayAmount;
            switch (status.toUpperCase()) {
                case "PAID":         displayAmount = paid; break;
                case "PARTIAL_PAID": displayAmount = outstanding.signum() > 0 ? outstanding : expected; break;
                case "OVERDUE":      displayAmount = outstanding.signum() > 0 ? outstanding : expected; break;
                case "WAIVED":       displayAmount = BigDecimal.ZERO; break;
                default:             displayAmount = expected;
            }

            LocalDateTime dueDate = sfp.getDueDate() != null
                    ? sfp.getDueDate().toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDateTime()
                    : null;
            LocalDateTime createdAt = sfp.getCreatedAt();
            String prefix = invoiceNumberPrefixForStatus(status);

            String[] pdfInfo = sfpIdToPdfInfo.get(sfp.getId());
            String realInvoiceId = pdfInfo != null ? pdfInfo[0] : null;
            String pdfFileId = pdfInfo != null ? pdfInfo[1] : null;
            String pdfUrl = pdfInfo != null ? pdfInfo[2] : null;
            // The real Invoice is authoritative; otherwise the plan the installment belongs
            // to. INR only as a last resort, for rows with neither.
            String invoiceCurrency = pdfInfo != null ? pdfInfo[3] : null;
            String currency = StringUtils.hasText(invoiceCurrency)
                    ? invoiceCurrency
                    : userPlanIdToCurrency.getOrDefault(sfp.getUserPlanId(), "INR");
            // When a real Invoice exists for this SFP, expose its id so the FE's
            // existing /v1/invoices/{id}/download path can resolve (and regenerate
            // if needed) the PDF without a per-SFP endpoint. Otherwise fall back to
            // the synthetic "sfp:..." marker so the row remains uniquely-keyed.
            String dtoId = StringUtils.hasText(realInvoiceId) ? realInvoiceId : ("sfp:" + sfp.getId());
            // A settled installment already has a receipt the learner was given; show that
            // number rather than a fabricated one. Bulk-loaded institutes made this obvious —
            // every migrated receipt read as "PAID-<uuid>", so an admin matching the screen
            // against the paper receipt had nothing to match on. Only an installment with no
            // invoice behind it (anything still due) keeps the status-prefixed placeholder.
            String realInvoiceNumber = pdfInfo != null && pdfInfo.length > 4 ? pdfInfo[4] : null;
            // Only a SETTLED installment takes its receipt's number. One still owing money shows
            // its balance as the amount, and "RCPT-… · PARTIAL · ₹8,020.25" read as a receipt for
            // ₹8,020.25 when the receipt was for the ₹5,000 paid (I2CAN, 2026-10-19). It keeps its
            // own label and carries the receipt and the amount paid alongside.
            boolean settled = "PAID".equalsIgnoreCase(status) || "WAIVED".equalsIgnoreCase(status);
            boolean labelWithReceipt = settled && StringUtils.hasText(realInvoiceNumber);
            if (labelWithReceipt && receiptRows.containsKey(dtoId)) {
                InvoiceDTO first = receiptRows.get(dtoId);
                first.setSubtotal(first.getSubtotal().add(displayAmount));
                first.setTotalAmount(first.getTotalAmount().add(displayAmount));
                if (dueDate != null && (first.getDueDate() == null || dueDate.isBefore(first.getDueDate()))) {
                    first.setDueDate(dueDate);
                    first.setInvoiceDate(dueDate);
                }
                if (pdfInfo.length > 5 && pdfInfo[5] != null) {
                    receiptTotals.put(dtoId, new BigDecimal(pdfInfo[5]));
                }
                continue;
            }
            InvoiceDTO row = InvoiceDTO.builder()
                    .id(dtoId)
                    .invoiceNumber(labelWithReceipt
                            ? realInvoiceNumber
                            : (prefix + "-" + sfp.getId()))
                    .receiptNumber(!settled && StringUtils.hasText(realInvoiceNumber) ? realInvoiceNumber : null)
                    .amountPaid(!settled && paid.signum() > 0 ? paid : null)
                    .userId(sfp.getUserId())
                    .userPlanId(sfp.getUserPlanId())
                    .instituteId(sfp.getInstituteId())
                    // invoiceDate = the SFP's due date so the listing's "Date"
                    // column matches the installment due date by default.
                    // Falls back to the row's createdAt if no due date was set.
                    .invoiceDate(dueDate != null ? dueDate : createdAt)
                    .dueDate(dueDate)
                    .subtotal(displayAmount)
                    .totalAmount(displayAmount)
                    .currency(currency)
                    .status(mapSfpStatusToInvoiceStatus(status))
                    .createdAt(createdAt)
                    .updatedAt(sfp.getUpdatedAt())
                    .pdfFileId(pdfFileId)
                    .pdfUrl(pdfUrl)
                    .lineItems(java.util.Collections.emptyList())
                    .build();
            if (labelWithReceipt) {
                receiptRows.put(dtoId, row);
            }
            dtos.add(row);
        }
        // A receipt listed once shows what it was issued for: it may also have part-paid another
        // installment, which that installment's own row reports.
        receiptTotals.forEach((invoiceId, total) -> {
            InvoiceDTO row = receiptRows.get(invoiceId);
            if (total.signum() > 0 && total.compareTo(row.getTotalAmount()) > 0) {
                row.setSubtotal(total);
                row.setTotalAmount(total);
            }
        });
        return dtos;
    }

    private String invoiceNumberPrefixForStatus(String sfpStatus) {
        if (sfpStatus == null) return "DUE";
        switch (sfpStatus.toUpperCase()) {
            case "PAID":         return "PAID";
            case "PARTIAL_PAID": return "PARTIAL";
            case "OVERDUE":      return "OVERDUE";
            case "WAIVED":       return "WAIVED";
            case "PENDING":
            default:             return "DUE";
        }
    }

    private String mapSfpStatusToInvoiceStatus(String sfpStatus) {
        if (sfpStatus == null) return "PENDING";
        switch (sfpStatus.toUpperCase()) {
            case "PAID":         return "PAID";
            case "PARTIAL_PAID": return "PARTIAL";
            case "OVERDUE":      return "OVERDUE";
            case "WAIVED":       return "WAIVED";
            case "PENDING":
            default:             return "UNPAID";
        }
    }

    /**
     * Get invoices by institute ID with optional filters and pagination.
     */
    public Page<InvoiceDTO> getInvoicesByInstituteId(
            String instituteId, String userId, String status,
            LocalDateTime startDate, LocalDateTime endDate,
            int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<Invoice> invoicePage = invoiceRepository.findByInstituteIdWithFilters(
                instituteId, userId, status, startDate, endDate, pageable);
        return invoicePage.map(this::mapToDTO);
    }

    /**
     * Largest number of payment log ids one lookup will resolve. The Manage Payments table
     * asks for a page at a time (20-ish), so this is a guard against a pathological caller
     * rather than a limit anyone should hit.
     */
    private static final int MAX_PAYMENT_LOG_INVOICE_LOOKUP = 500;

    /** Chunk size for the IN clause, so a big request can't blow the driver's parameter limit. */
    private static final int PAYMENT_LOG_INVOICE_LOOKUP_CHUNK = 200;

    /**
     * Resolve which invoice covers each of the given payment logs, for the Invoice column on
     * the Manage Payments table.
     *
     * <p>Answered from {@code invoice_payment_log_mapping} — the same link the invoice itself
     * is built from — so the number shown against a payment is the number the learner was
     * actually issued, not one inferred from amounts or timestamps.
     *
     * <p>A payment log with no invoice is simply absent from the result (the caller renders a
     * dash). A payment log covered by several invoices resolves to the one worth showing: a
     * live invoice beats a voided (REJECTED) one, and the most recently issued wins after that
     * — a correction supersedes what it replaced.
     */
    public List<PaymentLogInvoiceDTO> getInvoicesForPaymentLogs(String instituteId, List<String> paymentLogIds) {
        if (!StringUtils.hasText(instituteId) || paymentLogIds == null || paymentLogIds.isEmpty()) {
            return List.of();
        }

        List<String> ids = paymentLogIds.stream()
                .filter(StringUtils::hasText)
                .distinct()
                .limit(MAX_PAYMENT_LOG_INVOICE_LOOKUP)
                .collect(Collectors.toList());
        if (ids.isEmpty()) {
            return List.of();
        }

        Map<String, PaymentLogInvoiceProjection> best = new LinkedHashMap<>();
        for (int from = 0; from < ids.size(); from += PAYMENT_LOG_INVOICE_LOOKUP_CHUNK) {
            List<String> chunk = ids.subList(from, Math.min(from + PAYMENT_LOG_INVOICE_LOOKUP_CHUNK, ids.size()));
            for (PaymentLogInvoiceProjection row : invoicePaymentLogMappingRepository
                    .findInvoiceSummariesByPaymentLogIds(instituteId, chunk)) {
                best.merge(row.getPaymentLogId(), row,
                        (existing, candidate) -> preferredInvoiceRow(existing, candidate));
            }
        }

        return best.values().stream()
                .map(row -> PaymentLogInvoiceDTO.builder()
                        .paymentLogId(row.getPaymentLogId())
                        .invoiceId(row.getInvoiceId())
                        .invoiceNumber(row.getInvoiceNumber())
                        .invoiceDate(row.getInvoiceDate())
                        .status(row.getStatus())
                        .totalAmount(row.getTotalAmount())
                        .currency(row.getCurrency())
                        .hasPdf(StringUtils.hasText(row.getPdfFileId()))
                        .build())
                .collect(Collectors.toList());
    }

    /** Which of two invoices on the same payment log the table should show. See the caller. */
    private PaymentLogInvoiceProjection preferredInvoiceRow(PaymentLogInvoiceProjection existing,
                                                            PaymentLogInvoiceProjection candidate) {
        boolean existingVoided = "REJECTED".equalsIgnoreCase(existing.getStatus());
        boolean candidateVoided = "REJECTED".equalsIgnoreCase(candidate.getStatus());
        if (existingVoided != candidateVoided) {
            return existingVoided ? candidate : existing;
        }
        return invoiceRecency(candidate).isAfter(invoiceRecency(existing)) ? candidate : existing;
    }

    /** Issue time to rank by; falls back to creation time, then to the epoch for legacy rows. */
    private LocalDateTime invoiceRecency(PaymentLogInvoiceProjection row) {
        if (row.getInvoiceDate() != null) return row.getInvoiceDate();
        if (row.getCreatedAt() != null) return row.getCreatedAt();
        return LocalDateTime.MIN;
    }

    /**
     * Test method: Manually trigger invoice generation for testing purposes
     * This method will group related payment logs (same vendor_id or time window)
     * into one invoice
     * This method is useful for testing invoice generation without going through
     * the full payment flow
     */
    public String testGenerateInvoice(String paymentLogId) {
        try {
            PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                    .orElseThrow(() -> new VacademyException("Payment log not found: " + paymentLogId));

            if (paymentLog.getUserPlan() == null) {
                throw new VacademyException("Payment log has no associated user plan");
            }

            if (paymentLog.getPaymentStatus() == null || !paymentLog.getPaymentStatus().equals("PAID")) {
                throw new VacademyException("Payment log status must be PAID. Current status: " +
                        paymentLog.getPaymentStatus());
            }

            // Get institute ID from user plan
            String instituteId = paymentLog.getUserPlan().getEnrollInvite() != null
                    ? paymentLog.getUserPlan().getEnrollInvite().getInstituteId()
                    : null;

            if (instituteId == null) {
                throw new VacademyException("Could not determine institute ID from payment log");
            }

            log.info("Test: Manually generating invoice for payment log: {} (will group related logs)", paymentLogId);
            Invoice invoice = generateInvoice(
                    paymentLog.getUserPlan(),
                    paymentLog,
                    instituteId);

            String pdfUrl = invoice.getPdfFileId() != null
                    ? mediaService.getFilePublicUrlByIdWithoutExpiry(invoice.getPdfFileId())
                    : null;
            return "Invoice generated successfully! Invoice Number: " + invoice.getInvoiceNumber() +
                    ", PDF File ID: " + invoice.getPdfFileId() +
                    (pdfUrl != null ? ", PDF URL: " + pdfUrl : "") +
                    ", Payment Logs: " + invoice.getPaymentLogMappings().size();
        } catch (Exception e) {
            log.error("Test: Failed to generate invoice for payment log: {}", paymentLogId, e);
            throw new VacademyException("Failed to generate invoice: " + e.getMessage());
        }
    }

    /**
     * Test method: Generate invoice for MULTI-PACKAGE enrollment (v2 API)
     * This method simulates the v2 API scenario where multiple payment logs have
     * the same order ID
     * and should be grouped into a single invoice with multiple line items
     */
    @Transactional
    public String testGenerateInvoiceForMultiPackage(String orderId) {
        try {
            log.info("Test: Generating invoice for multi-package enrollment with order ID: {}", orderId);

            // Find all payment logs with the same order ID
            List<PaymentLog> paymentLogs = paymentLogRepository.findAllByOrderIdInOriginalRequest(orderId);

            if (paymentLogs.isEmpty()) {
                return "No payment logs found with order ID: " + orderId;
            }

            // Filter to only PAID logs that aren't already invoiced
            List<PaymentLog> eligibleLogs = paymentLogs.stream()
                    .filter(log -> "PAID".equals(log.getPaymentStatus()))
                    .filter(log -> !invoicePaymentLogMappingRepository.existsByPaymentLogId(log.getId()))
                    .collect(Collectors.toList());

            if (eligibleLogs.isEmpty()) {
                return "No eligible payment logs found (must be PAID and not already invoiced) for order ID: "
                        + orderId;
            }

            log.info("Found {} eligible payment logs for multi-package invoice", eligibleLogs.size());

            // Use the first payment log to get institute and user info
            PaymentLog firstPaymentLog = eligibleLogs.get(0);

            if (firstPaymentLog.getUserPlan() == null) {
                throw new VacademyException("Payment log has no associated user plan");
            }

            // Get institute ID from user plan
            String instituteId = firstPaymentLog.getUserPlan().getEnrollInvite() != null
                    ? firstPaymentLog.getUserPlan().getEnrollInvite().getInstituteId()
                    : null;

            if (instituteId == null) {
                throw new VacademyException("Could not determine institute ID from payment log");
            }

            // Build invoice data from multiple payment logs
            InvoiceData invoiceData = buildInvoiceDataFromMultiplePaymentLogs(eligibleLogs, instituteId);

            // Generate invoice number
            String invoiceNumber = allocateInvoiceNumber(instituteId, invoiceData, DOC_TYPE_ENROLLMENT).number();

            // Load template
            String templateHtml = loadInvoiceTemplate(instituteId);

            // Replace placeholders
            String filledTemplate = replaceTemplatePlaceholders(templateHtml, invoiceData);

            // Generate PDF
            byte[] pdfBytes = generatePdfFromHtml(filledTemplate);

            // Upload to S3
            String pdfFileId = uploadInvoiceToS3(pdfBytes, invoiceNumber, instituteId);

            // Save invoice
            Invoice invoice = saveInvoiceWithMultiplePaymentLogs(invoiceData, invoiceNumber, pdfFileId,
                    eligibleLogs, instituteId);

            // Send email
            try {
                sendInvoiceEmail(invoice, invoiceData.getUser(), instituteId, pdfBytes);
            } catch (Exception e) {
                log.error(
                        "Failed to send invoice email for multi-package invoice: {}. Invoice generation will continue.",
                        invoiceNumber, e);
            }

            String pdfUrl = invoice.getPdfFileId() != null
                    ? mediaService.getFilePublicUrlByIdWithoutExpiry(invoice.getPdfFileId())
                    : null;
            return "Multi-package invoice generated successfully! Invoice Number: " + invoice.getInvoiceNumber() +
                    ", PDF File ID: " + invoice.getPdfFileId() + ", Package Sessions: " + eligibleLogs.size() +
                    (pdfUrl != null ? ", PDF URL: " + pdfUrl : "");
        } catch (Exception e) {
            log.error("Test: Failed to generate multi-package invoice for order ID: {}", orderId, e);
            throw new VacademyException("Failed to generate multi-package invoice: " + e.getMessage());
        }
    }

    /**
     * Test method: Generate invoice for a SINGLE payment log only (no grouping)
     * This bypasses the grouping logic and creates an invoice for just this one
     * payment log
     * Useful for testing single payment log scenarios without worrying about
     * related logs
     */
    @Transactional
    public String testGenerateInvoiceSingle(String paymentLogId) {
        try {
            PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                    .orElseThrow(() -> new VacademyException("Payment log not found: " + paymentLogId));

            if (paymentLog.getUserPlan() == null) {
                throw new VacademyException("Payment log has no associated user plan");
            }

            if (paymentLog.getPaymentStatus() == null || !paymentLog.getPaymentStatus().equals("PAID")) {
                throw new VacademyException("Payment log status must be PAID. Current status: " +
                        paymentLog.getPaymentStatus());
            }

            // Check if already invoiced
            if (invoicePaymentLogMappingRepository.existsByPaymentLogId(paymentLog.getId())) {
                Invoice existingInvoice = findInvoiceByPaymentLogId(paymentLog.getId());
                String pdfUrl = existingInvoice.getPdfFileId() != null
                        ? mediaService.getFileUrlById(existingInvoice.getPdfFileId())
                        : null;
                return "Payment log is already invoiced! Invoice Number: " + existingInvoice.getInvoiceNumber() +
                        ", PDF File ID: " + existingInvoice.getPdfFileId() +
                        (pdfUrl != null ? ", PDF URL: " + pdfUrl : "");
            }

            // Get institute ID from user plan
            String instituteId = paymentLog.getUserPlan().getEnrollInvite() != null
                    ? paymentLog.getUserPlan().getEnrollInvite().getInstituteId()
                    : null;

            if (instituteId == null) {
                throw new VacademyException("Could not determine institute ID from payment log");
            }

            log.info("Test: Generating invoice for SINGLE payment log only: {} (no grouping)", paymentLogId);

            // Build invoice data from ONLY this payment log (no grouping)
            InvoiceData invoiceData = buildInvoiceDataFromMultiplePaymentLogs(
                    List.of(paymentLog), // Only this one payment log
                    instituteId);

            // Generate invoice number and set it in invoice data
            String invoiceNumber = allocateInvoiceNumber(instituteId, invoiceData, DOC_TYPE_ENROLLMENT).number();

            // Load template
            String templateHtml = loadInvoiceTemplate(instituteId);

            // Replace placeholders
            String filledTemplate = replaceTemplatePlaceholders(templateHtml, invoiceData);

            // Generate PDF
            byte[] pdfBytes = generatePdfFromHtml(filledTemplate);

            // Upload to S3 and get file ID
            String pdfFileId = uploadInvoiceToS3(pdfBytes, invoiceNumber, instituteId);

            // Save invoice with only this payment log
            Invoice invoice = saveInvoiceWithMultiplePaymentLogs(
                    invoiceData,
                    invoiceNumber,
                    pdfFileId,
                    List.of(paymentLog), // Only this one payment log
                    instituteId);

            // Send email (async)
            try {
                sendInvoiceEmail(invoice, invoiceData.getUser(), instituteId, pdfBytes);
            } catch (Exception e) {
                log.error("Failed to send invoice email for invoice: {}. Invoice generation will continue.",
                        invoiceNumber, e);
            }

            String pdfUrl = invoice.getPdfFileId() != null
                    ? mediaService.getFilePublicUrlByIdWithoutExpiry(invoice.getPdfFileId())
                    : null;
            return "Invoice generated successfully for SINGLE payment log! Invoice Number: " +
                    invoice.getInvoiceNumber() + ", PDF File ID: " + invoice.getPdfFileId() +
                    (pdfUrl != null ? ", PDF URL: " + pdfUrl : "");
        } catch (Exception e) {
            log.error("Test: Failed to generate invoice for single payment log: {}", paymentLogId, e);
            throw new VacademyException("Failed to generate invoice: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin-created invoice: create, pay, and mark paid
    // ─────────────────────────────────────────────────────────────────────────

    /** The admin discount applied to an admin invoice: its rule, amount and audit trail. */
    private record AdminInvoiceDiscount(
            vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount rule,
            BigDecimal amount,
            Map<String, Object> audit) {
    }

    /**
     * Turns {@code request.adminDiscount} into a negative DISCOUNT line appended to the
     * request's line items, computed on the pre-discount subtotal. Everything downstream
     * (subtotal, tax, total, stored line items, PDF, preview) then reads the discounted
     * figures with no special casing. Returns null when no discount was asked for.
     */
    private AdminInvoiceDiscount applyAdminInvoiceDiscount(AdminCreateInvoiceRequestDTO request,
                                                           String adminUserId, boolean persist) {
        var req = request.getAdminDiscount();
        if (!vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService
                .isRequested(req)) {
            return null;
        }
        BigDecimal gross = request.getLineItems().stream()
                .map(item -> item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        var rule = adminDiscountService.resolveForInvoice(
                req, request.getInstituteId(), gross.doubleValue(), adminUserId, persist);
        double off = Math.min(
                vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponDiscountUtil
                        .computeDiscount(rule, gross.doubleValue()),
                gross.doubleValue());
        BigDecimal amount = BigDecimal.valueOf(off).setScale(2, java.math.RoundingMode.HALF_UP);
        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            return null;
        }

        String label = rule.getCouponCode() != null && StringUtils.hasText(rule.getCouponCode().getCode())
                ? "Coupon " + rule.getCouponCode().getCode()
                : "Discount";
        AdminInvoiceLineItemRequestDTO discountLine = new AdminInvoiceLineItemRequestDTO();
        discountLine.setDescription(label);
        discountLine.setQuantity(1);
        discountLine.setUnitPrice(amount.negate());
        discountLine.setItemType("DISCOUNT");
        List<AdminInvoiceLineItemRequestDTO> items = new ArrayList<>(request.getLineItems());
        items.add(discountLine);
        request.setLineItems(items);

        Map<String, Object> audit = new HashMap<>();
        audit.put("applied_coupon_discount_id", rule.getId());
        audit.put("mode", req.getMode());
        audit.put("discount_type", rule.getDiscountType());
        audit.put("discount_value", rule.getDiscountPoint());
        audit.put("discount_amount", amount);
        audit.put("reason", req.getReason());
        audit.put("granted_by_user_id", adminUserId);
        return new AdminInvoiceDiscount(rule, amount, audit);
    }

    /**
     * Admin creates one invoice per userId in the request (bulk or single).
     * No UserPlan or PackageSession required — line items are free-form.
     */
    @Transactional
    public List<AdminInvoicePaymentLinkResponseDTO> createAdminInvoices(AdminCreateInvoiceRequestDTO request,
                                                                        String adminUserId) {
        List<AdminInvoicePaymentLinkResponseDTO> results = new ArrayList<>();

        Institute institute = instituteRepository.findById(request.getInstituteId())
                .orElseThrow(() -> new VacademyException("Institute not found: " + request.getInstituteId()));

        // Admin discount becomes a negative DISCOUNT line, so the subtotal, tax, total,
        // stored line items and PDF below all see the discounted figures.
        AdminInvoiceDiscount adminInvoiceDiscount = applyAdminInvoiceDiscount(request, adminUserId, true);

        // Read institute invoice settings once for all users in this bulk request
        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
        // Proforma institutes raise these unpaid; the real invoice number is drawn on payment.
        boolean proformaMode = isProformaEnabled(institute);

        // Subtotal = sum of (unitPrice * quantity) from line items
        BigDecimal subtotal = request.getLineItems().stream()
                .map(item -> item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        // Tax: institute settings by default, overridable per-invoice via
        // request.taxEnabled/taxRatePercent (e.g. remove tax or use a one-off rate).
        EffectiveTax effectiveTax = computeEffectiveTax(invoiceSettings, subtotal,
                request.getTaxEnabled(), request.getTaxRatePercent());
        boolean taxIncluded = effectiveTax.taxIncluded();
        BigDecimal taxRate = effectiveTax.taxRate();
        String taxLabel = effectiveTax.taxLabel();
        BigDecimal taxAmount = effectiveTax.taxAmount();
        BigDecimal totalAmount = effectiveTax.totalAmount();

        // Per-invoice text overrides (invoice_number, party & institute details, tax label…).
        // User-scoped keys are stripped for bulk so they don't bleed across users.
        boolean singleUser = request.getUserIds().size() == 1;
        Map<String, String> baseOverrides = sanitizeOverrides(request.getOverrides(), singleUser);
        Map<String, String> currentInstituteProfile = invoiceInstituteProfileService.loadAsMap(invoiceSettings);
        // Notes: an explicit override (even "") means the admin deliberately set/cleared it —
        // never overridden by a fallback. Only absent falls through to request.notes, then the
        // institute's remembered default notes.
        String effectiveNotes = baseOverrides.containsKey("notes")
                ? baseOverrides.get("notes")
                : firstNonBlank(request.getNotes(), currentInstituteProfile.get("notes"));
        // Invoice date: admin-chosen or now.
        LocalDateTime invoiceDate = request.getInvoiceDate() != null ? request.getInvoiceDate() : LocalDateTime.now();

        // Remember institute-linked details for next time (any admin, any future invoice) —
        // institute-wide, so done once per request regardless of bulk/single. Only genuine
        // deviations are persisted (see instituteEditsFromOverrides); own transaction, so a
        // settings-save failure can never break invoice creation.
        try {
            Map<String, String> instituteEdits =
                    instituteEditsFromOverrides(baseOverrides, institute, currentInstituteProfile);
            invoiceInstituteProfileService.upsert(institute, invoiceSettings, instituteEdits);
        } catch (Exception e) {
            log.warn("Failed to persist institute invoice profile for institute {}: {}",
                    request.getInstituteId(), e.getMessage());
        }

        for (String userId : request.getUserIds()) {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users.isEmpty()) {
                log.warn("User not found for ID: {}, skipping invoice creation", userId);
                continue;
            }
            UserDTO user = users.get(0);

            // Per-user render overrides: start from the base set, then drop invoice_number
            // (the number is authoritative on the Invoice row / invoiceData, never a text
            // override) and fold in the resolved notes so they render escaped.
            Map<String, String> renderOverrides = new HashMap<>(baseOverrides);
            renderOverrides.remove("invoice_number");
            if (StringUtils.hasText(effectiveNotes)) {
                renderOverrides.put("notes", effectiveNotes);
            }

            // Invoice number: honour a unique admin override, else auto-generate.
            // Uniqueness is checked WITHIN the institute — since V432 invoice_number is
            // unique per (institute_id, invoice_number), not globally.
            InvoiceNumberAllocation allocation;
            String overrideNumber = baseOverrides.get("invoice_number");
            if (StringUtils.hasText(overrideNumber)
                    && invoiceRepository.findByInstituteIdAndInvoiceNumber(
                            request.getInstituteId(), overrideNumber.trim()).isEmpty()) {
                // An explicit override is stored unsequenced so a hand-typed number can never
                // drag the institute's counter forwards (or backwards).
                allocation = InvoiceNumberAllocation.unsequenced(overrideNumber.trim());
            } else {
                if (StringUtils.hasText(overrideNumber)) {
                    log.warn("Overridden invoice number '{}' already exists — generating a fresh number instead",
                            overrideNumber);
                }
                InvoiceData numberingData =
                        numberingDataForAdminInvoice(institute, user, invoiceDate, request.getCurrency());
                // Proforma institutes raise unpaid invoices out of a separate PRO series; the
                // real invoice number is only drawn when the money arrives.
                allocation = proformaMode
                        ? allocateProformaNumber(request.getInstituteId(), numberingData)
                        : allocateInvoiceNumber(request.getInstituteId(), numberingData, DOC_TYPE_ADMIN);
            }
            String invoiceNumber = allocation.number();

            Invoice invoice = new Invoice();
            invoice.setInvoiceNumber(invoiceNumber);
            invoice.setSeqNo(allocation.seqNo());
            invoice.setSeqScopeKey(allocation.scopeKey());
            invoice.setUserId(userId);
            invoice.setInstituteId(request.getInstituteId());
            invoice.setInvoiceDate(invoiceDate);
            invoice.setDueDate(request.getDueDate());
            invoice.setSubtotal(subtotal);
            invoice.setDiscountAmount(adminInvoiceDiscount != null ? adminInvoiceDiscount.amount() : BigDecimal.ZERO);
            if (adminInvoiceDiscount != null) {
                invoice.setDiscountGrantedByUserId(adminUserId);
                // One coupon redemption per billed learner.
                adminDiscountService.consumeCouponUse(adminInvoiceDiscount.rule());
            }
            invoice.setTaxAmount(taxAmount);
            invoice.setTotalAmount(totalAmount);
            invoice.setCurrency(request.getCurrency());
            invoice.setStatus(INVOICE_STATUS_PENDING_PAYMENT);
            invoice.setTaxIncluded(taxIncluded);
            // Source tracking: admin-created invoices point back to the billed user
            invoice.setSource("ADMIN_MANUAL");
            invoice.setSourceId(userId);

            // Persist notes + overrides so a later PDF regeneration reproduces the admin's edits.
            try {
                Map<String, Object> dataJson = new HashMap<>();
                if (StringUtils.hasText(effectiveNotes)) dataJson.put("notes", effectiveNotes);
                if (!renderOverrides.isEmpty()) dataJson.put("overrides", renderOverrides);
                if (adminInvoiceDiscount != null) {
                    dataJson.put("admin_discount", adminInvoiceDiscount.audit());
                }
                if (proformaMode) {
                    // Read back by finalizeProformaOnPayment: the flag says "still a proforma",
                    // the doc type says which real series to draw from once it is paid.
                    dataJson.put(JSON_KEY_PROFORMA, true);
                    dataJson.put(JSON_KEY_PROFORMA_DOC_TYPE, DOC_TYPE_ADMIN);
                }
                if (!dataJson.isEmpty()) {
                    invoice.setInvoiceDataJson(INVOICE_JSON_MAPPER.writeValueAsString(dataJson));
                }
            } catch (Exception ignored) {}

            invoice = invoiceRepository.save(invoice);

            // Save line items
            for (AdminInvoiceLineItemRequestDTO itemReq : request.getLineItems()) {
                BigDecimal lineAmount = itemReq.getUnitPrice().multiply(BigDecimal.valueOf(itemReq.getQuantity()));
                InvoiceLineItem lineItem = new InvoiceLineItem();
                lineItem.setInvoice(invoice);
                lineItem.setItemType(StringUtils.hasText(itemReq.getItemType()) ? itemReq.getItemType() : "SERVICE");
                lineItem.setDescription(itemReq.getDescription());
                lineItem.setQuantity(itemReq.getQuantity());
                lineItem.setUnitPrice(itemReq.getUnitPrice());
                lineItem.setAmount(lineAmount);
                invoiceLineItemRepository.save(lineItem);
            }

            // Remember the user-linked Bill-To details for next time (single-user only; for bulk
            // the user-scoped keys were stripped, so there is nothing per-user to save). Only
            // fields the admin actually CHANGED from the live user record are persisted, so an
            // unchanged field keeps tracking the record. Runs in its own transaction (REQUIRES_NEW);
            // catch so a profile failure never breaks invoice creation.
            if (singleUser) {
                try {
                    Map<String, String> currentBp =
                            invoiceBillingProfileService.loadAsMap(userId, request.getInstituteId());
                    invoiceBillingProfileService.upsert(userId, request.getInstituteId(),
                            billingEditsFromOverrides(renderOverrides, user, currentBp));
                } catch (Exception e) {
                    log.warn("Failed to persist invoice billing profile for user {}: {}",
                            userId, e.getMessage());
                }
            }

            // Ledger: debit accrual for new admin invoice obligation
            userAccountLedgerService.recordDebitAccrual(
                    userId, request.getInstituteId(),
                    totalAmount, request.getCurrency(),
                    request.getDueDate() != null ? request.getDueDate().toLocalDate() : null,
                    "ADMIN_INVOICE", invoice.getId(),
                    invoice.getId(), "Admin invoice raised");

            // Generate PDF immediately so the admin can share it
            String pdfFileId = null;
            try {
                pdfFileId = generateAndUploadAdminInvoicePdf(invoice, user, institute,
                        request.getLineItems(), subtotal, taxAmount, totalAmount,
                        request.getCurrency(), taxIncluded, taxRate, taxLabel,
                        effectiveNotes, renderOverrides);
                invoice.setPdfFileId(pdfFileId);
                invoice = invoiceRepository.save(invoice);
            } catch (Exception e) {
                log.error("Failed to generate PDF for admin invoice {}: {}", invoiceNumber, e.getMessage(), e);
            }

            String pdfUrl = pdfFileId != null ? mediaService.getFilePublicUrlByIdWithoutExpiry(pdfFileId) : null;
            String paymentLink = buildPaymentLink(institute, invoice.getId());

            // Notify the learner via in-app system alert
            try {
                String amountStr = request.getCurrency() + " " + totalAmount.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString();
                String alertNoun = proformaMode ? "Proforma Invoice" : "Invoice";
                String alertTitle = "New " + alertNoun + ": " + amountStr;
                String alertBody = "You have a new " + alertNoun.toLowerCase() + " (" + invoiceNumber + ") of " + amountStr
                        + " due by " + (request.getDueDate() != null ? request.getDueDate().toLocalDate().toString() : "N/A")
                        + ". Tap to pay: " + paymentLink;
                notificationService.createSystemAlertAnnouncement(
                        request.getInstituteId(),
                        List.of(userId),
                        alertTitle,
                        alertBody,
                        "system",
                        institute.getInstituteName() != null ? institute.getInstituteName() : "Institute",
                        "ADMIN",
                        Map.of("priority", 3, "isDismissible", true, "showBadge", true, "isActive", true));
            } catch (Exception e) {
                log.warn("Failed to send invoice system alert to user {}: {}", userId, e.getMessage());
            }

            results.add(AdminInvoicePaymentLinkResponseDTO.builder()
                    .invoiceId(invoice.getId())
                    .invoiceNumber(invoiceNumber)
                    .userId(userId)
                    .totalAmount(totalAmount)
                    .currency(request.getCurrency())
                    .status(INVOICE_STATUS_PENDING_PAYMENT)
                    .dueDate(request.getDueDate())
                    .paymentLink(paymentLink)
                    .pdfUrl(pdfUrl)
                    .build());
        }

        return results;
    }

    /**
     * Edits an admin invoice IN PLACE — line items, currency, dates, notes, per-invoice tax
     * and the editable template placeholders — then recomputes the totals and regenerates the
     * PDF under the SAME invoice number.
     *
     * <p>Only a {@code PENDING_PAYMENT} invoice may be edited. A PAID invoice represents money
     * that actually moved (and a tax document already issued), and a REJECTED one is voided —
     * for both, the correct flow is Reject + Duplicate (issue a corrected invoice), not a
     * silent in-place rewrite of a document the customer may already hold.
     *
     * <p>The billed user and institute are intentionally NOT editable: re-billing someone else
     * is a new invoice, not an edit of this one.
     */
    @Transactional
    public InvoiceDTO updateAdminInvoice(String invoiceId, String instituteId,
            AdminUpdateInvoiceRequestDTO request, CustomUserDetails userDetails) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        if (instituteId != null && !instituteId.equals(invoice.getInstituteId())) {
            throw new VacademyException("Invoice does not belong to this institute");
        }
        if (!INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) {
            throw new VacademyException("Only a PENDING_PAYMENT invoice can be edited (current status: "
                    + invoice.getStatus() + "). Reject it and create a corrected invoice instead.");
        }

        // Capture into finals: `invoice` is reassigned by the save() calls below, so it can't
        // be referenced from the lambdas.
        final String invoiceInstituteId = invoice.getInstituteId();
        final String invoiceUserId = invoice.getUserId();
        Institute institute = instituteRepository.findById(invoiceInstituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + invoiceInstituteId));
        UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(invoiceUserId))
                .stream().findFirst()
                .orElseThrow(() -> new VacademyException("Invoice user not found: " + invoiceUserId));

        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);

        BigDecimal subtotal = request.getLineItems().stream()
                .map(item -> item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        EffectiveTax effectiveTax = computeEffectiveTax(invoiceSettings, subtotal,
                request.getTaxEnabled(), request.getTaxRatePercent());

        // Single-user by definition (an invoice bills exactly one user), so user-scoped
        // overrides are honoured just like the single-user create path.
        Map<String, String> overrides = sanitizeOverrides(request.getOverrides(), true);
        Map<String, String> currentInstituteProfile = invoiceInstituteProfileService.loadAsMap(invoiceSettings);
        String effectiveNotes = overrides.containsKey("notes")
                ? overrides.get("notes")
                : firstNonBlank(request.getNotes(), currentInstituteProfile.get("notes"));

        // invoice_number is never a text override — the persisted number is authoritative and
        // an edit must not renumber the document.
        Map<String, String> renderOverrides = new HashMap<>(overrides);
        renderOverrides.remove("invoice_number");
        if (StringUtils.hasText(effectiveNotes)) {
            renderOverrides.put("notes", effectiveNotes);
        }

        // ── Apply the edit ──
        invoice.setSubtotal(subtotal);
        invoice.setTaxAmount(effectiveTax.taxAmount());
        invoice.setTotalAmount(effectiveTax.totalAmount());
        invoice.setTaxIncluded(effectiveTax.taxIncluded());
        invoice.setCurrency(request.getCurrency());
        invoice.setDueDate(request.getDueDate());
        if (request.getInvoiceDate() != null) {
            invoice.setInvoiceDate(request.getInvoiceDate());
        }

        // Persist notes + overrides (so a later PDF regeneration reproduces this edit) and stamp
        // the audit trail, without clobbering unrelated keys already in the blob (e.g. a prior
        // reject audit). mergeInvoiceDataJson is a read-modify-write over the same object.
        Map<String, Object> dataJson = new HashMap<>();
        dataJson.put("notes", StringUtils.hasText(effectiveNotes) ? effectiveNotes : "");
        dataJson.put("overrides", renderOverrides);
        dataJson.put("editedBy", userDetails != null ? userDetails.getUserId() : "system");
        dataJson.put("editedAt", LocalDateTime.now().toString());
        invoice.setInvoiceDataJson(mergeInvoiceDataJson(invoice.getInvoiceDataJson(), dataJson));

        invoice = invoiceRepository.save(invoice);

        // Replace line items wholesale — an edit redefines the whole set (rows added, removed,
        // reordered), so diffing individual rows would be more fragile than a clean rewrite.
        List<InvoiceLineItem> existingLineItems = invoiceLineItemRepository.findByInvoiceId(invoice.getId());
        if (existingLineItems != null && !existingLineItems.isEmpty()) {
            invoiceLineItemRepository.deleteAll(existingLineItems);
            // Flush the deletes before the inserts so both sets never coexist (the listing and
            // the regenerated PDF both read this table).
            invoiceLineItemRepository.flush();
        }
        for (AdminInvoiceLineItemRequestDTO itemReq : request.getLineItems()) {
            InvoiceLineItem lineItem = new InvoiceLineItem();
            lineItem.setInvoice(invoice);
            lineItem.setItemType(StringUtils.hasText(itemReq.getItemType()) ? itemReq.getItemType() : "SERVICE");
            lineItem.setDescription(itemReq.getDescription());
            lineItem.setQuantity(itemReq.getQuantity());
            lineItem.setUnitPrice(itemReq.getUnitPrice());
            lineItem.setAmount(itemReq.getUnitPrice().multiply(BigDecimal.valueOf(itemReq.getQuantity())));
            invoiceLineItemRepository.save(lineItem);
        }

        // Remember the admin's Bill-To / institute edits for next time, same as create.
        try {
            Map<String, String> currentBp =
                    invoiceBillingProfileService.loadAsMap(invoiceUserId, invoiceInstituteId);
            invoiceBillingProfileService.upsert(invoiceUserId, invoiceInstituteId,
                    billingEditsFromOverrides(renderOverrides, user, currentBp));
            invoiceInstituteProfileService.upsert(institute, invoiceSettings,
                    instituteEditsFromOverrides(overrides, institute, currentInstituteProfile));
        } catch (Exception e) {
            log.warn("Failed to persist remembered profiles while editing invoice {}: {}",
                    invoiceId, e.getMessage());
        }

        // Regenerate the PDF under the SAME invoice number. Best-effort: a render failure must
        // not roll back the edit itself — the amounts on the row are already correct, and
        // /download regenerates on demand from the persisted row anyway.
        try {
            String pdfFileId = generateAndUploadAdminInvoicePdf(invoice, user, institute,
                    request.getLineItems(), subtotal, effectiveTax.taxAmount(), effectiveTax.totalAmount(),
                    request.getCurrency(), effectiveTax.taxIncluded(), effectiveTax.taxRate(),
                    effectiveTax.taxLabel(), effectiveNotes, renderOverrides);
            // NOTE: the superseded PDF object is intentionally left in storage (media service
            // exposes no delete) — only the pointer moves. Harmless orphan.
            invoice.setPdfFileId(pdfFileId);
            invoice = invoiceRepository.save(invoice);
        } catch (Exception e) {
            log.error("Failed to regenerate PDF for edited invoice {}: {}", invoice.getInvoiceNumber(),
                    e.getMessage(), e);
        }

        log.info("[InvoiceEdit] invoiceId={} invoiceNumber={} editedBy={} newTotal={}",
                invoiceId, invoice.getInvoiceNumber(),
                userDetails != null ? userDetails.getUserId() : "system", invoice.getTotalAmount());

        return mapToDTO(invoice);
    }

    /**
     * Records a manual / offline payment against a PENDING_PAYMENT admin invoice.
     * Mirrors the CPO side-view recordOfflinePayment flow but binds to an Invoice
     * instead of a UserPlan — the resulting PaymentLog has {@code userPlan=null}
     * because admin invoices aren't tied to an enrollment.
     *
     * <p>End state: PaymentLog (vendor=MANUAL, status=SUCCESS, paymentStatus=PAID)
     * + InvoicePaymentLogMapping + invoice.status=PAID. Email is best-effort —
     * logged on failure, not rethrown.
     */
    @Transactional
    public InvoiceDTO markInvoicePaidManually(
            String invoiceId,
            vacademy.io.admin_core_service.features.invoice.dto.ManualInvoicePaymentRequestDTO request,
            CustomUserDetails userDetails) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        if (!INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) {
            throw new VacademyException("Invoice is not pending payment (status="
                    + invoice.getStatus() + ")");
        }

        String currency = StringUtils.hasText(invoice.getCurrency()) ? invoice.getCurrency() : "INR";
        double amount = invoice.getTotalAmount() != null
                ? invoice.getTotalAmount().doubleValue() : 0d;

        // How it was paid, validated against the institute's offline payment modes before
        // anything is written.
        vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService.Resolved paidVia =
                offlinePaymentDetailsService.resolve(invoice.getInstituteId(),
                        request != null ? request.getPaymentDetails() : null,
                        request != null ? request.getTransactionId() : null);

        // 1. PaymentLog — userPlan=null because admin invoices aren't bound to enrollments.
        String paymentLogId = paymentLogService.createPaymentLog(
                invoice.getUserId(),
                amount,
                vacademy.io.common.payment.enums.PaymentGateway.MANUAL.name(),
                vacademy.io.common.payment.enums.PaymentGateway.MANUAL.name(),
                currency,
                null,
                null,
                paidVia != null && paidVia.paymentDate() != null
                        ? java.sql.Date.valueOf(paidVia.paymentDate()) : new java.util.Date());

        // 2. Promote to SUCCESS/PAID + audit metadata
        Map<String, Object> paymentSpecificData = new HashMap<>();
        if (request != null && StringUtils.hasText(request.getTransactionId())) {
            paymentSpecificData.put("transaction_id", request.getTransactionId());
        }
        if (request != null && StringUtils.hasText(request.getNotes())) {
            paymentSpecificData.put("notes", request.getNotes());
        }
        paymentSpecificData.put("source", "ADMIN_INVOICE_MANUAL");
        paymentSpecificData.put("invoice_id", invoiceId);
        if (userDetails != null && StringUtils.hasText(userDetails.getUserId())) {
            paymentSpecificData.put("recorded_by", userDetails.getUserId());
        }
        try {
            paymentLogService.updatePaymentLogOnly(
                    paymentLogId,
                    vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum.SUCCESS.name(),
                    vacademy.io.common.payment.enums.PaymentStatusEnum.PAID.name(),
                    new ObjectMapper().writeValueAsString(paymentSpecificData));
        } catch (Exception e) {
            throw new VacademyException("Failed to promote payment log to SUCCESS: " + e.getMessage());
        }
        offlinePaymentDetailsService.apply(paymentLogId, paidVia,
                userDetails != null ? userDetails.getUserId() : null);

        // 3. A proforma becomes a real invoice at the moment it is paid — this is where the
        // institute's actual invoice number gets drawn. Runs before the PAID flip so the
        // number and the status land in the same transaction.
        invoice = finalizeProformaOnPayment(invoice);

        // Link PaymentLog → Invoice + flip status to PAID
        PaymentLog persistedLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new VacademyException(
                        "Payment log not found after creation: " + paymentLogId));
        InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
        mapping.setInvoice(invoice);
        mapping.setPaymentLog(persistedLog);
        invoicePaymentLogMappingRepository.save(mapping);

        invoice.setStatus("PAID");
        invoice = invoiceRepository.save(invoice);

        // Paid live session settled offline: unlock the registration too.
        unlockLiveSessionRegistrationIfNeeded(invoice, paymentLogId);

        // 5. Ledger: credit payment for the manual settlement
        userAccountLedgerService.recordCreditPayment(
                invoice.getUserId(), invoice.getInstituteId(),
                invoice.getTotalAmount(), currency,
                "ADMIN_INVOICE", invoiceId,
                paymentLogId, invoiceId, "Admin manual payment recorded");

        // 4. Best-effort confirmation email — logged-on-fail per the design doc.
        try {
            UserDTO user = authService.getUsersFromAuthServiceByUserIds(
                    List.of(invoice.getUserId())).stream().findFirst().orElse(null);
            if (user != null) {
                Institute institute = instituteRepository.findById(invoice.getInstituteId())
                        .orElse(null);
                if (institute != null) {
                    byte[] pdfBytes = StringUtils.hasText(invoice.getPdfFileId())
                            ? fetchPdfBytesFromS3(invoice.getPdfFileId()) : null;
                    sendInvoiceEmail(invoice, user, institute.getId(), pdfBytes);
                }
            }
        } catch (Exception e) {
            log.warn("Manual-payment confirmation email failed for invoice {}: {}",
                    invoiceId, e.getMessage());
        }

        return mapToDTO(invoice);
    }

    /**
     * Fires a fresh payment-due reminder for a PENDING_PAYMENT admin invoice. Re-uses
     * the same email + in-app alert path the create flow uses, with the same payment
     * link the learner already has. Safe to call repeatedly — no DB state mutation,
     * just notifications.
     *
     * <p>Both the email (gated by INVOICE_SETTING.sendInvoiceEmail) and the in-app
     * alert are best-effort: failures are logged and the call still returns 200 with
     * whichever channels succeeded so the FE can give precise feedback to the admin.
     */
    @Transactional
    public Map<String, Object> sendInvoiceReminder(String invoiceId, CustomUserDetails userDetails) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        if (!INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) {
            throw new VacademyException(
                    "Reminders can only be sent for PENDING_PAYMENT invoices (current status: "
                    + invoice.getStatus() + ")");
        }

        UserDTO user = authService.getUsersFromAuthServiceByUserIds(List.of(invoice.getUserId()))
                .stream().findFirst().orElseThrow(
                        () -> new VacademyException("Invoice user not found: " + invoice.getUserId()));
        Institute institute = instituteRepository.findById(invoice.getInstituteId())
                .orElseThrow(() -> new VacademyException(
                        "Institute not found: " + invoice.getInstituteId()));

        String paymentLink = buildPaymentLink(institute, invoice.getId());
        String currency = StringUtils.hasText(invoice.getCurrency()) ? invoice.getCurrency() : "INR";
        String amountStr = currency + " " + invoice.getTotalAmount()
                .setScale(2, java.math.RoundingMode.HALF_UP).toPlainString();

        boolean emailSent = false;
        boolean alertSent = false;

        // In-app system alert — mirrors what createAdminInvoices fires at creation
        // time, but with a "Reminder:" prefix so the learner sees this is a follow-up
        // rather than a brand-new bill.
        try {
            String dueStr = invoice.getDueDate() != null
                    ? invoice.getDueDate().toLocalDate().toString() : "N/A";
            notificationService.createSystemAlertAnnouncement(
                    invoice.getInstituteId(),
                    List.of(invoice.getUserId()),
                    "Reminder: " + documentNounTitleCase(invoice) + " " + invoice.getInvoiceNumber()
                            + " · " + amountStr,
                    "Your " + documentNoun(invoice) + " (" + invoice.getInvoiceNumber() + ") of " + amountStr
                            + " is still pending. Due " + dueStr + ". Tap to pay: " + paymentLink,
                    "system",
                    institute.getInstituteName() != null
                            ? institute.getInstituteName() : "Institute",
                    "ADMIN",
                    Map.of("priority", 3, "isDismissible", true, "showBadge", true, "isActive", true));
            alertSent = true;
        } catch (Exception e) {
            log.warn("In-app alert reminder failed for invoice {}: {}", invoiceId, e.getMessage());
        }

        // Email — gated by INVOICE_SETTING.sendInvoiceEmail (same as create-time send).
        try {
            byte[] pdfBytes = StringUtils.hasText(invoice.getPdfFileId())
                    ? fetchPdfBytesFromS3(invoice.getPdfFileId()) : null;
            sendInvoiceEmail(invoice, user, invoice.getInstituteId(), pdfBytes);
            emailSent = true;
        } catch (Exception e) {
            log.warn("Email reminder failed for invoice {}: {}", invoiceId, e.getMessage());
        }

        log.info("[InvoiceReminder] invoiceId={} email_sent={} alert_sent={} triggered_by={}",
                invoiceId, emailSent, alertSent,
                userDetails != null ? userDetails.getUserId() : "system");

        Map<String, Object> out = new HashMap<>();
        out.put("invoice_id", invoiceId);
        out.put("invoice_number", invoice.getInvoiceNumber());
        out.put("recipient_email", user.getEmail());
        out.put("email_sent", emailSent);
        out.put("alert_sent", alertSent);
        out.put("payment_link", paymentLink);
        return out;
    }

    /**
     * Voids a mistaken PENDING_PAYMENT admin invoice: flips status to REJECTED so its
     * payment link stops working and it can never be marked paid, while keeping the row
     * (and PDF) around for record-keeping. Terminal — a REJECTED invoice cannot be
     * un-rejected; the admin creates a corrected invoice instead (see "Duplicate" on the
     * frontend, which prefills a new Create-Invoice dialog from this one's line items).
     *
     * <p>Only PENDING_PAYMENT invoices can be rejected — an already-PAID invoice
     * represents money that actually moved and must be handled as a refund/credit
     * instead, not silently voided.
     */
    @Transactional
    public InvoiceDTO rejectInvoice(String invoiceId, String instituteId, String reason,
            CustomUserDetails userDetails) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        if (instituteId != null && !instituteId.equals(invoice.getInstituteId())) {
            throw new VacademyException("Invoice does not belong to this institute");
        }
        if (!INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) {
            throw new VacademyException("Only a PENDING_PAYMENT invoice can be rejected (current status: "
                    + invoice.getStatus() + ")");
        }

        invoice.setStatus(INVOICE_STATUS_REJECTED);
        // Audit trail: who voided it and when is always recorded — reason is merely optional
        // free text on top of that, not a gate on capturing the actor/timestamp.
        Map<String, Object> rejectAudit = new HashMap<>();
        rejectAudit.put("rejectedBy", userDetails != null ? userDetails.getUserId() : "system");
        rejectAudit.put("rejectedAt", LocalDateTime.now().toString());
        if (StringUtils.hasText(reason)) {
            rejectAudit.put("rejectReason", reason);
        }
        invoice.setInvoiceDataJson(mergeInvoiceDataJson(invoice.getInvoiceDataJson(), rejectAudit));
        invoice = invoiceRepository.save(invoice);

        // Reverse the DEBIT_ACCRUAL that was posted when this invoice was raised. This is a
        // DEBIT_REVERSAL, not a credit: no money moved, so the accrual has to come back OUT
        // of "total accrued". Booking it as a CREDIT_ADJUSTMENT (as this did) left the
        // cancelled invoice's amount standing in Total Accrued and simultaneously inflated
        // Total Paid by the same figure. The original due date rides along so the reversal
        // also cancels the obligation out of the past-due bucket.
        userAccountLedgerService.recordDebitReversal(
                invoice.getUserId(), invoice.getInstituteId(),
                invoice.getTotalAmount(),
                StringUtils.hasText(invoice.getCurrency()) ? invoice.getCurrency() : "INR",
                invoice.getDueDate() != null ? invoice.getDueDate().toLocalDate() : null,
                "ADMIN_INVOICE", invoice.getId(),
                invoice.getId(),
                "Invoice cancelled" + (StringUtils.hasText(reason) ? ": " + reason : ""));

        log.info("[InvoiceReject] invoiceId={} invoiceNumber={} rejectedBy={} reason={}",
                invoiceId, invoice.getInvoiceNumber(),
                userDetails != null ? userDetails.getUserId() : "system", reason);

        return mapToDTO(invoice);
    }

    /**
     * Unwinds the invoices tied to a payment an admin has voided (recorded by mistake). Two
     * kinds are told apart by source, because they mean opposite things:
     * <ul>
     *   <li>A BILL raised before the payment (ADMIN_MANUAL / LIVE_SESSION — it carries its own
     *       DEBIT_ACCRUAL) is still owed. It loses its link to the voided payment and goes back
     *       to PENDING_PAYMENT, so the Due figures count it again and it can be paid again.</li>
     *   <li>An invoice generated FROM the payment documents money that never arrived. It is
     *       voided as REJECTED — the same terminal state as a cancelled admin invoice — and
     *       keeps its link so the audit trail still shows which payment it belonged to.</li>
     * </ul>
     * No ledger rows are written here; the caller reverses the payment's own credit.
     *
     * @return how many invoices were changed
     */
    @Transactional
    public int unwindInvoicesForVoidedPayment(String paymentLogId, String reason, String voidedBy) {
        List<InvoicePaymentLogMapping> mappings =
                invoicePaymentLogMappingRepository.findAllByPaymentLogId(paymentLogId);
        int touched = 0;
        for (InvoicePaymentLogMapping mapping : mappings) {
            Invoice invoice = mapping.getInvoice();
            if (invoice == null || INVOICE_STATUS_REJECTED.equalsIgnoreCase(invoice.getStatus())) {
                continue;
            }
            Map<String, Object> audit = new HashMap<>();
            audit.put("voidedPaymentLogId", paymentLogId);
            audit.put("voidedBy", StringUtils.hasText(voidedBy) ? voidedBy : "system");
            audit.put("voidedAt", LocalDateTime.now().toString());
            if (StringUtils.hasText(reason)) {
                audit.put("voidReason", reason);
            }

            boolean isBill = "ADMIN_MANUAL".equals(invoice.getSource())
                    || INVOICE_SOURCE_LIVE_SESSION.equals(invoice.getSource());
            if (isBill) {
                invoicePaymentLogMappingRepository.delete(mapping);
                // Another, still-valid payment may cover the same bill; only reopen it if not.
                boolean stillPaid = invoicePaymentLogMappingRepository.findByInvoiceId(invoice.getId()).stream()
                        .map(InvoicePaymentLogMapping::getPaymentLog)
                        .anyMatch(pl -> pl != null
                                && !paymentLogId.equals(pl.getId())
                                && INVOICE_STATUS_PAID.equalsIgnoreCase(pl.getPaymentStatus()));
                if (!stillPaid) {
                    invoice.setStatus(INVOICE_STATUS_PENDING_PAYMENT);
                }
            } else {
                invoice.setStatus(INVOICE_STATUS_REJECTED);
            }
            invoice.setInvoiceDataJson(mergeInvoiceDataJson(invoice.getInvoiceDataJson(), audit));
            invoiceRepository.save(invoice);
            touched++;
            log.info("[PaymentVoid] invoice {} ({}) -> {} after payment {} was voided",
                    invoice.getInvoiceNumber(), invoice.getSource(), invoice.getStatus(), paymentLogId);
        }
        return touched;
    }

    /**
     * Merge additional keys into the invoice's {@code invoice_data_json} blob without
     * clobbering whatever is already there (e.g. persisted notes/overrides from create
     * time) — read-modify-write over the same JSON object shape {@code applyStoredOverrides}
     * expects. Best-effort: returns the original JSON unchanged if parsing fails.
     */
    @SuppressWarnings("unchecked")
    private String mergeInvoiceDataJson(String existingJson, Map<String, Object> additions) {
        try {
            Map<String, Object> merged = StringUtils.hasText(existingJson)
                    ? new HashMap<>(INVOICE_JSON_MAPPER.readValue(existingJson, Map.class))
                    : new HashMap<>();
            merged.putAll(additions);
            return INVOICE_JSON_MAPPER.writeValueAsString(merged);
        } catch (Exception e) {
            log.warn("Failed to merge invoice_data_json, leaving unchanged: {}", e.getMessage());
            return existingJson;
        }
    }

    /** Read a single string field out of {@code invoice_data_json}, or null if absent/unparseable. */
    @SuppressWarnings("unchecked")
    /** The reason saved under {@code admin_discount} by createAdminInvoices, or null. */
    private String readAdminDiscountReason(String json) {
        if (!StringUtils.hasText(json)) return null;
        try {
            Map<String, Object> parsed = INVOICE_JSON_MAPPER.readValue(json, Map.class);
            Object discount = parsed.get("admin_discount");
            if (discount instanceof Map<?, ?> d && d.get("reason") != null) {
                return d.get("reason").toString();
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private String readInvoiceDataJsonField(String json, String key) {
        if (!StringUtils.hasText(json)) return null;
        try {
            Map<String, Object> parsed = INVOICE_JSON_MAPPER.readValue(json, Map.class);
            Object value = parsed.get(key);
            return value != null ? value.toString() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Initiates gateway payment for an admin-created invoice.
     * Creates PaymentLog (userPlan=null) and links it to the invoice.
     */
    @Transactional
    public PaymentResponseDTO initiatePaymentForAdminInvoice(String invoiceId, String instituteId,
            CustomUserDetails userDetails) {
        return initiatePaymentForAdminInvoice(invoiceId, instituteId, userDetails, null);
    }

    /**
     * @param clientData optional vendor-specific payment data collected by the payment
     *                   page (Stripe payment_method_id + return_url, eWay encrypted card,
     *                   Cashfree/PhonePe return URLs, ...). Required for gateways whose
     *                   initiation cannot run server-side alone (Stripe, eWay); ignored
     *                   fields like amount/currency/vendor stay server-authoritative
     *                   from the invoice + institute config.
     */
    /**
     * Gateway for one invoice: LIVE_SESSION invoices may carry a per-session
     * vendor choice (stored in the session payment option's metadata JSON by the
     * wizard); anything else — or an unconfigured/inactive choice — charges via
     * the institute default (latest ACTIVE mapping). Repository-only lookups,
     * same no-cycle rule as the registration flip above.
     */
    private InstitutePaymentGatewayMappingService.VendorInfo resolveVendorForInvoice(
            Invoice invoice, String instituteId) {
        try {
            if ("LIVE_SESSION".equalsIgnoreCase(invoice.getSource())
                    && StringUtils.hasText(invoice.getSourceId())) {
                String sessionId = sessionGuestRegistrationRepository.findById(invoice.getSourceId())
                        .map(reg -> reg.getSessionId())
                        .orElse(null);
                if (sessionId != null) {
                    String chosen = paymentOptionRepositoryForVendor
                            .findFirstBySourceAndSourceIdAndStatusOrderByCreatedAtDesc(
                                    "LIVE_SESSION", sessionId, "ACTIVE")
                            .map(option -> readVendorFromOptionMetadata(
                                    option.getPaymentOptionMetadataJson()))
                            .orElse(null);
                    if (StringUtils.hasText(chosen)) {
                        String normalized = chosen.trim().toUpperCase();
                        boolean activeForInstitute = institutePaymentGatewayMappingService
                                .getAllVendorsForInstitute(instituteId).stream()
                                .anyMatch(v -> normalized.equalsIgnoreCase(v.getVendor()));
                        if (activeForInstitute) {
                            return new InstitutePaymentGatewayMappingService.VendorInfo(
                                    normalized, normalized);
                        }
                        log.warn("Session-chosen gateway {} is not ACTIVE for institute {}; "
                                + "falling back to the default", normalized, instituteId);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Per-session vendor resolution failed for invoice {}; using institute default: {}",
                    invoice.getId(), e.getMessage());
        }
        return institutePaymentGatewayMappingService.getLatestVendorInfoForInstitute(instituteId);
    }

    private String readVendorFromOptionMetadata(String metadataJson) {
        if (!StringUtils.hasText(metadataJson)) {
            return null;
        }
        try {
            return new ObjectMapper().readTree(metadataJson).path("vendor").asText(null);
        } catch (Exception e) {
            return null;
        }
    }

    public PaymentResponseDTO initiatePaymentForAdminInvoice(String invoiceId, String instituteId,
            CustomUserDetails userDetails, PaymentInitiationRequestDTO clientData) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));

        if (!invoice.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Invoice does not belong to this institute");
        }
        if (!INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) {
            throw new VacademyException("This invoice is " + invoice.getStatus()
                    + " and can no longer be paid");
        }

        // Gateway: a live-session fee may carry a per-session vendor choice (stored
        // on the session's payment option); everything else charges through the
        // institute default (latest ACTIVE mapping).
        InstitutePaymentGatewayMappingService.VendorInfo vendorInfo =
                resolveVendorForInvoice(invoice, instituteId);

        PaymentInitiationRequestDTO paymentRequest = new PaymentInitiationRequestDTO();
        paymentRequest.setAmount(invoice.getTotalAmount().doubleValue());
        paymentRequest.setCurrency(invoice.getCurrency());
        paymentRequest.setVendor(vendorInfo.getVendor());
        paymentRequest.setVendorId(vendorInfo.getVendorId());
        paymentRequest.setInstituteId(instituteId);
        paymentRequest.setDescription("Admin Invoice " + invoice.getInvoiceNumber());

        // Fetch full UserDTO for gateway customer creation
        String userId = invoice.getUserId();
        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
        if (users.isEmpty()) {
            throw new VacademyException("User not found: " + userId);
        }
        UserDTO user = users.get(0);
        if (StringUtils.hasText(user.getEmail())) {
            paymentRequest.setEmail(user.getEmail());
        }

        // Merge the vendor-specific payloads the payment page collected (card /
        // payment-method data). Amount, currency, vendor and email above remain
        // server-authoritative — the client cannot override what is charged.
        if (clientData != null) {
            paymentRequest.setStripeRequest(clientData.getStripeRequest());
            paymentRequest.setEwayRequest(clientData.getEwayRequest());
            paymentRequest.setRazorpayRequest(clientData.getRazorpayRequest());
            paymentRequest.setCashfreeRequest(clientData.getCashfreeRequest());
            paymentRequest.setPhonePeRequest(clientData.getPhonePeRequest());
            paymentRequest.setPayPalRequest(clientData.getPayPalRequest());
        }

        // Create PaymentLog with userPlan=null
        String paymentLogId = createAdminInvoicePaymentLog(userId, invoice.getTotalAmount().doubleValue(),
                vendorInfo.getVendor(), vendorInfo.getVendorId(), invoice.getCurrency());

        paymentRequest.setOrderId(paymentLogId);

        // Link PaymentLog → Invoice
        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new VacademyException("PaymentLog not found after creation"));
        InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
        mapping.setInvoice(invoice);
        mapping.setPaymentLog(paymentLog);
        invoicePaymentLogMappingRepository.save(mapping);

        // Call gateway
        PaymentResponseDTO response = paymentService.makePayment(
                vendorInfo.getVendor(), instituteId, user, paymentRequest);

        // Update PaymentLog with gateway response
        Map<String, Object> logData = new HashMap<>();
        logData.put("response", response);
        logData.put("originalRequest", paymentRequest);
        String paymentStatus = response.getResponseData() != null
                ? (String) response.getResponseData().get("paymentStatus")
                : null;
        if (!StringUtils.hasText(paymentStatus)) {
            paymentStatus = "PAYMENT_PENDING";
        }
        paymentLog.setStatus("ACTIVE");
        paymentLog.setPaymentStatus(paymentStatus);
        try {
            paymentLog.setPaymentSpecificData(new ObjectMapper().writeValueAsString(logData));
        } catch (Exception ignored) {}
        paymentLogRepository.save(paymentLog);

        // Synchronous confirmation (eWay always; Stripe when no 3DS challenge): NO
        // webhook follows, so the paid-side effects must run here — invoice → PAID,
        // ledger credit, invoice email, and the live-session registration unlock.
        // Without this the money is captured but the invoice/registration stay
        // PENDING forever. Webhook gateways still confirm asynchronously as before
        // (markAdminInvoicePaidByPaymentLog is idempotent, so a late duplicate
        // webhook is harmless).
        if (vacademy.io.common.payment.enums.PaymentStatusEnum.PAID.name().equalsIgnoreCase(paymentStatus)) {
            try {
                markAdminInvoicePaidByPaymentLog(paymentLogId, instituteId);
            } catch (Exception e) {
                log.error("Sync-paid post-processing failed for invoice {} (paymentLog {}): {}",
                        invoiceId, paymentLogId, e.getMessage(), e);
            }
        }

        response.setOrderId(paymentLogId);
        return response;
    }

    /**
     * Raises a PENDING_PAYMENT invoice for a paid live-session registration
     * (source=LIVE_SESSION, source_id=registration id). Reuses the admin-invoice
     * plumbing end-to-end — numbering, institute tax settings, PDF, ledger — and is
     * settled through the same open /pay/invoice flow; on PAID,
     * {@link #markAdminInvoicePaidByPaymentLog} also flips the registration.
     */
    @Transactional
    public Invoice createLiveSessionInvoice(String userId, String instituteId, String sessionTitle,
            String registrationId, BigDecimal price, String currency) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));
        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
        if (users.isEmpty()) {
            throw new VacademyException("User not found: " + userId);
        }
        UserDTO user = users.get(0);

        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);
        BigDecimal subtotal = price.setScale(2, RoundingMode.HALF_UP);
        EffectiveTax tax = computeEffectiveTax(invoiceSettings, subtotal, null, null);

        // Raised unpaid, so it follows the institute's proforma policy like an admin invoice:
        // the real number is only drawn once the registration is actually paid for.
        boolean proformaMode = isProformaEnabled(institute);
        InvoiceData numberingData =
                numberingDataForAdminInvoice(institute, user, LocalDateTime.now(), currency);
        InvoiceNumberAllocation allocation = proformaMode
                ? allocateProformaNumber(instituteId, numberingData)
                : allocateInvoiceNumber(instituteId, numberingData, DOC_TYPE_LIVE_SESSION);

        Invoice invoice = new Invoice();
        invoice.setInvoiceNumber(allocation.number());
        invoice.setSeqNo(allocation.seqNo());
        invoice.setSeqScopeKey(allocation.scopeKey());
        invoice.setUserId(userId);
        invoice.setInstituteId(instituteId);
        invoice.setInvoiceDate(LocalDateTime.now());
        // Payable immediately; the short due window only matters for display.
        invoice.setDueDate(LocalDateTime.now().plusDays(2));
        invoice.setSubtotal(subtotal);
        invoice.setDiscountAmount(BigDecimal.ZERO);
        invoice.setTaxAmount(tax.taxAmount());
        invoice.setTotalAmount(tax.totalAmount());
        invoice.setCurrency(currency);
        invoice.setStatus(INVOICE_STATUS_PENDING_PAYMENT);
        invoice.setTaxIncluded(tax.taxIncluded());
        invoice.setSource(INVOICE_SOURCE_LIVE_SESSION);
        invoice.setSourceId(registrationId);
        if (proformaMode) {
            Map<String, Object> proformaState = new HashMap<>();
            proformaState.put(JSON_KEY_PROFORMA, true);
            proformaState.put(JSON_KEY_PROFORMA_DOC_TYPE, DOC_TYPE_LIVE_SESSION);
            invoice.setInvoiceDataJson(
                    mergeInvoiceDataJson(invoice.getInvoiceDataJson(), proformaState));
        }
        invoice = invoiceRepository.save(invoice);

        AdminInvoiceLineItemRequestDTO lineReq = new AdminInvoiceLineItemRequestDTO();
        lineReq.setDescription(sessionTitle);
        lineReq.setQuantity(1);
        lineReq.setUnitPrice(subtotal);
        lineReq.setItemType("LIVE_SESSION");

        InvoiceLineItem lineItem = new InvoiceLineItem();
        lineItem.setInvoice(invoice);
        lineItem.setItemType("LIVE_SESSION");
        lineItem.setDescription(lineReq.getDescription());
        lineItem.setQuantity(1);
        lineItem.setUnitPrice(subtotal);
        lineItem.setAmount(subtotal);
        invoiceLineItemRepository.save(lineItem);

        userAccountLedgerService.recordDebitAccrual(
                userId, instituteId, invoice.getTotalAmount(), currency,
                invoice.getDueDate().toLocalDate(),
                INVOICE_SOURCE_LIVE_SESSION, invoice.getId(),
                invoice.getId(), "Live class fee invoice raised");

        try {
            String pdfFileId = generateAndUploadAdminInvoicePdf(invoice, user, institute,
                    List.of(lineReq), subtotal, tax.taxAmount(), tax.totalAmount(),
                    currency, tax.taxIncluded(), tax.taxRate(), tax.taxLabel(),
                    null, Map.of());
            invoice.setPdfFileId(pdfFileId);
            invoice = invoiceRepository.save(invoice);
        } catch (Exception e) {
            log.error("Failed to generate PDF for live-session invoice {}: {}",
                    invoice.getInvoiceNumber(), e.getMessage(), e);
        }
        return invoice;
    }

    /**
     * Returns the invoice if it can still be settled for the expected charge —
     * PENDING_PAYMENT with matching subtotal + currency. A stale pending invoice
     * (the session's price/currency changed since it was raised) is voided so the
     * caller can raise a fresh one. PAID/REJECTED/missing → null.
     */
    @Transactional
    public Invoice findPayableInvoice(String invoiceId, BigDecimal expectedSubtotal, String expectedCurrency) {
        Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
        if (invoice == null || !INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) {
            return null;
        }
        boolean matches = invoice.getSubtotal() != null
                && expectedSubtotal != null
                && invoice.getSubtotal().compareTo(expectedSubtotal) == 0
                && expectedCurrency != null
                && expectedCurrency.equalsIgnoreCase(invoice.getCurrency());
        if (matches) {
            return invoice;
        }
        invoice.setStatus(INVOICE_STATUS_REJECTED);
        invoiceRepository.save(invoice);
        log.info("Voided stale invoice {} — expected {} {}, invoice had {} {}",
                invoice.getInvoiceNumber(), expectedSubtotal, expectedCurrency,
                invoice.getSubtotal(), invoice.getCurrency());
        return null;
    }

    /**
     * Called by webhook handlers when a PaymentLog with no UserPlan (admin invoice)
     * is marked as PAID. Updates the linked invoice status and sends email.
     */
    @Transactional
    public void markAdminInvoicePaidByPaymentLog(String paymentLogId, String instituteId) {
        InvoicePaymentLogMapping mapping = invoicePaymentLogMappingRepository
                .findFirstByPaymentLogId(paymentLogId).orElse(null);
        if (mapping == null) {
            log.info("No admin invoice found for paymentLogId={}, skipping markAdminInvoicePaid", paymentLogId);
            return;
        }

        // Load the invoice directly (not via lazy proxy) so Hibernate tracks it as a
        // managed entity in the current persistence context before we mutate its status.
        String invoiceId = mapping.getInvoice().getId();
        Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
        if (invoice == null) {
            log.warn("Invoice {} not found for paymentLogId={}, skipping", invoiceId, paymentLogId);
            return;
        }
        if (INVOICE_STATUS_PAID.equals(invoice.getStatus())) {
            log.info("Invoice {} already marked as PAID, skipping", invoice.getId());
            return;
        }
        if (INVOICE_STATUS_REJECTED.equals(invoice.getStatus())) {
            // The admin voided this invoice — a late/retried gateway webhook must never
            // resurrect it to PAID. Reject is terminal; this is the single point where money
            // is actually recognized for admin invoices, so the guard belongs here.
            log.warn("Ignoring PAID webhook for REJECTED invoice {} (paymentLogId={}) — invoice was voided",
                    invoice.getId(), paymentLogId);
            return;
        }

        // A proforma becomes a real invoice at the moment it is paid — draw the institute's
        // actual invoice number before flipping the status.
        invoice = finalizeProformaOnPayment(invoice);

        invoice.setStatus(INVOICE_STATUS_PAID);
        invoiceRepository.saveAndFlush(invoice);
        log.info("Admin invoice {} marked as PAID via paymentLogId={}", invoice.getInvoiceNumber(), paymentLogId);

        boolean isLiveSessionInvoice = INVOICE_SOURCE_LIVE_SESSION.equals(invoice.getSource());

        // Ledger: credit payment for the gateway-settled invoice, labeled by origin
        // so it balances the matching debit accrual (ADMIN_INVOICE vs LIVE_SESSION).
        userAccountLedgerService.recordCreditPayment(
                invoice.getUserId(), invoice.getInstituteId(),
                invoice.getTotalAmount(),
                StringUtils.hasText(invoice.getCurrency()) ? invoice.getCurrency() : "INR",
                isLiveSessionInvoice ? INVOICE_SOURCE_LIVE_SESSION : "ADMIN_INVOICE", invoice.getId(),
                paymentLogId, invoice.getId(), "Gateway payment received");

        // Paid live session: unlock the registration this invoice was raised for.
        unlockLiveSessionRegistrationIfNeeded(invoice, paymentLogId);

        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(invoice.getUserId()));
            if (!users.isEmpty()) {
                byte[] pdfBytes = invoice.getPdfFileId() != null
                        ? fetchPdfBytesFromS3(invoice.getPdfFileId())
                        : null;
                // Live-session payers must always receive their invoice — the feature
                // promises it — so bypass the institute's sendInvoiceEmail opt-in there.
                sendInvoiceEmail(invoice, users.get(0), instituteId, pdfBytes, isLiveSessionInvoice);
            }
        } catch (Exception e) {
            log.error("Failed to send paid invoice email for invoice {}: {}", invoice.getId(), e.getMessage(), e);
        }
    }

    /**
     * Paid live sessions: an invoice with source=LIVE_SESSION going PAID (via
     * gateway webhook, sync payment, or admin manual settlement) must also flip
     * the linked session registration to PAID — that is what unlocks joining.
     */
    private void unlockLiveSessionRegistrationIfNeeded(Invoice invoice, String paymentLogId) {
        if (!INVOICE_SOURCE_LIVE_SESSION.equals(invoice.getSource())) {
            return;
        }
        sessionGuestRegistrationRepository.findFirstByInvoiceId(invoice.getId())
                .or(() -> StringUtils.hasText(invoice.getSourceId())
                        ? sessionGuestRegistrationRepository.findById(invoice.getSourceId())
                        : Optional.empty())
                .ifPresent(registration -> {
                    registration.setPaymentStatus("PAID");
                    registration.setPaymentLogId(paymentLogId);
                    registration.setPaymentAmount(invoice.getTotalAmount());
                    registration.setPaymentCurrency(invoice.getCurrency());
                    sessionGuestRegistrationRepository.save(registration);
                    log.info("Live-session registration {} marked PAID via invoice {}",
                            registration.getId(), invoice.getInvoiceNumber());
                });
    }

    private String createAdminInvoicePaymentLog(String userId, double amount, String vendor, String vendorId,
            String currency) {
        PaymentLog log = new PaymentLog();
        log.setStatus("INITIATED");
        log.setPaymentAmount(amount);
        log.setUserId(userId);
        log.setPaymentStatus(null);
        log.setVendor(vendor);
        log.setVendorId(vendorId);
        log.setDate(new java.util.Date());
        log.setCurrency(currency);
        log.setUserPlan(null);
        return paymentLogRepository.save(log).getId();
    }

    private String generateAndUploadAdminInvoicePdf(Invoice invoice, UserDTO user, Institute institute,
            List<AdminInvoiceLineItemRequestDTO> lineItems,
            BigDecimal subtotal, BigDecimal taxAmount, BigDecimal totalAmount,
            String currency, Boolean taxIncluded, BigDecimal taxRate, String taxLabel,
            String notes, Map<String, String> overrides) {
        List<InvoiceLineItemData> lineItemData =
                buildAdminLineItemData(lineItems, taxAmount, taxIncluded, taxRate, taxLabel);

        InvoiceData invoiceData = InvoiceData.builder()
                .user(user)
                .institute(institute)
                .invoiceNumber(invoice.getInvoiceNumber())
                // Taken from the row rather than a parameter so the heading can never
                // disagree with what the invoice actually is.
                .documentTitle(isProforma(invoice) ? DOCUMENT_TITLE_PROFORMA : DOCUMENT_TITLE_INVOICE)
                .documentNumberLabel(isProforma(invoice)
                        ? DOCUMENT_NUMBER_LABEL_PROFORMA : DOCUMENT_NUMBER_LABEL_INVOICE)
                .proformaNumber(finalizedFromProformaNumber(invoice))
                .invoiceDate(invoice.getInvoiceDate())
                .dueDate(invoice.getDueDate())
                .subtotal(subtotal)
                .discountAmount(BigDecimal.ZERO)
                .taxAmount(taxAmount)
                .totalAmount(totalAmount)
                .currency(currency)
                .taxIncluded(taxIncluded)
                .taxRate(taxRate)
                .taxLabel(taxLabel)
                .paymentMethod("")
                .transactionId("")
                .paymentDate(LocalDateTime.now())
                .lineItems(lineItemData)
                .notes(notes)
                .overrides(overrides)
                .build();

        String templateHtml = loadInvoiceTemplate(institute.getId());
        String filled = replaceTemplatePlaceholders(templateHtml, invoiceData);
        byte[] pdfBytes = generatePdfFromHtml(filled);
        return uploadInvoiceToS3(pdfBytes, invoice.getInvoiceNumber(), institute.getId());
    }

    /**
     * Build the template line-item list for an admin invoice: one row per request item,
     * plus a synthetic TAX row when the institute charges tax exclusively (so the table
     * visibly shows the tax the totals include). Shared by create + preview so both render
     * identically.
     */
    /** Effective per-invoice tax outcome — see {@link #computeEffectiveTax}. */
    private record EffectiveTax(
            boolean taxIncluded, BigDecimal taxRate, String taxLabel,
            BigDecimal taxAmount, BigDecimal totalAmount) {}

    /**
     * Resolve the tax actually applied to ONE admin invoice: institute settings are the
     * default, but the request can override the rate or turn tax off entirely for just
     * this invoice. Shared by {@link #createAdminInvoices} and {@link #previewAdminInvoice}
     * so the rendered preview and the created invoice can never disagree on the math.
     *
     * @param requestTaxEnabled null/true = apply tax (rate below); false = no tax at all —
     *                          total_amount == subtotal, taxAmount = 0.
     * @param requestTaxRatePercent null = use the institute's INVOICE_SETTING taxRate;
     *                          otherwise this percentage (e.g. 18 for 18%) is used instead.
     */
    private EffectiveTax computeEffectiveTax(Map<String, Object> invoiceSettings, BigDecimal subtotal,
            Boolean requestTaxEnabled, BigDecimal requestTaxRatePercent) {
        String taxLabel = invoiceSettings.get("taxLabel") != null
                ? invoiceSettings.get("taxLabel").toString() : "Tax";

        if (Boolean.FALSE.equals(requestTaxEnabled)) {
            // Tax removed entirely for this invoice — taxRate=null (not ZERO) so
            // replaceTemplatePlaceholders blanks {{tax_rate}}, and label is blank too, so a
            // template with a fixed "Tax ({{tax_rate}}%)" row doesn't print "Tax (0%)" on an
            // invoice that has no tax section at all.
            return new EffectiveTax(false, null, "", BigDecimal.ZERO, subtotal);
        }

        boolean taxIncluded = Boolean.TRUE.equals(invoiceSettings.get("taxIncluded"));
        BigDecimal ratePercent = requestTaxRatePercent != null
                ? requestTaxRatePercent
                : BigDecimal.valueOf(invoiceSettings.get("taxRate") != null
                        ? ((Number) invoiceSettings.get("taxRate")).doubleValue() : 0.0);
        BigDecimal taxRate = ratePercent.divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP);

        BigDecimal taxAmount;
        BigDecimal totalAmount;
        if (taxIncluded) {
            BigDecimal divisor = BigDecimal.ONE.add(taxRate);
            BigDecimal netSubtotal = subtotal.divide(divisor, 2, RoundingMode.HALF_UP);
            taxAmount = subtotal.subtract(netSubtotal);
            totalAmount = subtotal;
        } else {
            taxAmount = subtotal.multiply(taxRate).setScale(2, RoundingMode.HALF_UP);
            totalAmount = subtotal.add(taxAmount);
        }
        return new EffectiveTax(taxIncluded, taxRate, taxLabel, taxAmount, totalAmount);
    }

    private List<InvoiceLineItemData> buildAdminLineItemData(List<AdminInvoiceLineItemRequestDTO> lineItems,
            BigDecimal taxAmount, Boolean taxIncluded, BigDecimal taxRate, String taxLabel) {
        List<InvoiceLineItemData> lineItemData = lineItems.stream()
                .map(item -> InvoiceLineItemData.builder()
                        .itemType(StringUtils.hasText(item.getItemType()) ? item.getItemType() : "SERVICE")
                        .description(item.getDescription())
                        .quantity(item.getQuantity())
                        .unitPrice(item.getUnitPrice())
                        .amount(item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
                        .build())
                .collect(Collectors.toList());

        if (taxAmount != null && taxAmount.compareTo(BigDecimal.ZERO) > 0
                && !Boolean.TRUE.equals(taxIncluded)) {
            lineItemData.add(InvoiceLineItemData.builder()
                    .itemType("TAX")
                    .description(buildTaxLineDescription(taxLabel, taxRate))
                    .quantity(1)
                    .unitPrice(taxAmount)
                    .amount(taxAmount)
                    .build());
        }
        return lineItemData;
    }

    private String buildTaxLineDescription(String taxLabel, BigDecimal taxRate) {
        // formatRate trims to a whole number when the rate IS whole (e.g. "18"), but keeps
        // decimals otherwise (e.g. "12.5") — rounding to 0dp here would print "Tax @ 13%" for a
        // 12.5% override while the line's actual amount is computed at 12.5%.
        BigDecimal ratePct = (taxRate != null ? taxRate : BigDecimal.ZERO).multiply(BigDecimal.valueOf(100));
        return (StringUtils.hasText(taxLabel) ? taxLabel : "Tax") + " @ " + formatRate(ratePct) + "%";
    }

    /**
     * Keep only whitelisted, non-blank-key overrides. Drops any non-editable key
     * (amounts, HTML blocks, dates) and — for bulk requests — user-scoped keys. This is
     * the trust boundary: only these keys can carry admin text into the template.
     */
    private Map<String, String> sanitizeOverrides(Map<String, String> raw, boolean singleUser) {
        Map<String, String> out = new HashMap<>();
        if (raw == null || raw.isEmpty()) return out;
        for (Map.Entry<String, String> e : raw.entrySet()) {
            String key = e.getKey();
            if (key == null || !EDITABLE_OVERRIDE_KEYS.contains(key)) continue;
            if (!singleUser && USER_SCOPED_OVERRIDE_KEYS.contains(key)) continue;
            out.put(key, e.getValue() != null ? e.getValue() : "");
        }
        return out;
    }

    private String nz(String s) {
        return s != null ? s : "";
    }

    /** First non-blank value, or "" if all are blank. */
    private String firstNonBlank(String... values) {
        if (values != null) {
            for (String v : values) {
                if (StringUtils.hasText(v)) return v;
            }
        }
        return "";
    }

    /**
     * From the submitted overrides, keep only the user-linked Bill-To fields that GENUINELY
     * DEVIATE from what the admin was actually shown (any previously-saved pin, else the live
     * user record). The FE always sends the fully-seeded override map whether or not the admin
     * touched anything, so this comparison is what makes the "remember" feature correct — see
     * {@link #addDeviationEdit}.
     */
    private Map<String, String> billingEditsFromOverrides(Map<String, String> overrides, UserDTO user,
            Map<String, String> currentBp) {
        Map<String, String> edits = new HashMap<>();
        if (overrides == null || user == null) return edits;
        addDeviationEdit(edits, overrides, "user_name", user.getFullName(), currentBp.get("user_name"));
        addDeviationEdit(edits, overrides, "user_email", user.getEmail(), currentBp.get("user_email"));
        addDeviationEdit(edits, overrides, "user_address", user.getAddressLine(), currentBp.get("user_address"));
        addDeviationEdit(edits, overrides, "user_tax_info", "", currentBp.get("user_tax_info")); // no record source
        addDeviationEdit(edits, overrides, "place_of_supply", user.getRegion(), currentBp.get("place_of_supply"));
        return edits;
    }

    /**
     * From the submitted overrides, keep only the institute-linked fields (institute_name,
     * institute_address, institute_contact, notes) that genuinely DEVIATE from what the admin
     * was actually shown — mirrors {@link #billingEditsFromOverrides}. Notes have no external
     * "record" to compare against (raw baseline ""), so they reduce to "differs from the
     * previously-saved default" — {@link #addDeviationEdit} handles that uniformly.
     */
    private Map<String, String> instituteEditsFromOverrides(Map<String, String> overrides, Institute institute,
            Map<String, String> currentIp) {
        Map<String, String> edits = new HashMap<>();
        if (overrides == null || institute == null) return edits;
        addDeviationEdit(edits, overrides, "institute_name", institute.getInstituteName(),
                currentIp.get("institute_name"));
        addDeviationEdit(edits, overrides, "institute_address", institute.getAddress(),
                currentIp.get("institute_address"));
        addDeviationEdit(edits, overrides, "institute_contact",
                firstNonBlank(institute.getMobileNumber(), institute.getEmail()),
                currentIp.get("institute_contact"));
        addDeviationEdit(edits, overrides, "notes", "", currentIp.get("notes"));
        return edits;
    }

    /**
     * Decide whether to persist a deviation for one "remembered default" field, given what the
     * admin submitted, the RAW source-of-truth baseline (the user/institute record — {@code ""}
     * when no such record exists, e.g. notes), and any CURRENTLY-PINNED override that was
     * actually shown as the default this time.
     *
     * <ul>
     *   <li>Key absent from {@code overrides} → the template didn't surface it → leave storage
     *       untouched (don't wipe a value saved via a different template).
     *   <li>Submitted matches what was actually SHOWN (the pin if one exists, else the raw
     *       record) → the admin didn't change anything → no-op. This is the fix for a real bug:
     *       comparing only against the raw record (ignoring an existing pin) makes "pin matches
     *       what's shown" look identical to "matches the record," so re-submitting an
     *       already-corrected, unedited value would silently DELETE the correction on every
     *       subsequent invoice.
     *   <li>Submitted matches the RAW record (and differs from the pin) → the admin explicitly
     *       reverted to the record → clear the pin ({@code ""}).
     *   <li>Otherwise → a genuinely new value → pin it.
     * </ul>
     */
    private void addDeviationEdit(Map<String, String> edits, Map<String, String> overrides,
            String key, String rawBaseline, String currentPin) {
        if (!overrides.containsKey(key)) return;
        String submitted = overrides.get(key);
        String shown = firstNonBlank(currentPin, rawBaseline);
        if (nz(submitted).trim().equals(nz(shown).trim())) return; // unchanged from what was shown
        edits.put(key, nz(submitted).trim().equals(nz(rawBaseline).trim()) ? "" : submitted);
    }

    /**
     * Renders a non-persisting preview of an admin invoice: fills the institute's
     * template with the request's line items + any overrides, and returns the rendered
     * HTML plus the resolved value of every editable placeholder the template uses.
     * Consumes no invoice number and writes nothing.
     */
    public AdminInvoicePreviewResponseDTO previewAdminInvoice(AdminCreateInvoiceRequestDTO request) {
        Institute institute = instituteRepository.findById(request.getInstituteId())
                .orElseThrow(() -> new VacademyException("Institute not found: " + request.getInstituteId()));

        // Same discount line create would add — computed, never persisted or redeemed.
        applyAdminInvoiceDiscount(request, null, false);

        // Billed user = first id in the request (the dialog is single-user). Missing user
        // still previews with blank party fields the admin can fill via overrides.
        UserDTO user = null;
        if (request.getUserIds() != null && !request.getUserIds().isEmpty()) {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(
                    List.of(request.getUserIds().get(0)));
            if (!users.isEmpty()) user = users.get(0);
        }
        if (user == null) user = UserDTO.builder().build();

        // Prefill the user-linked Bill-To fields from the remembered billing profile (if any),
        // so the admin doesn't re-type them for a returning customer.
        String billedUserId = (request.getUserIds() != null && !request.getUserIds().isEmpty())
                ? request.getUserIds().get(0) : null;
        Map<String, String> billingProfile = billedUserId != null
                ? invoiceBillingProfileService.loadAsMap(billedUserId, request.getInstituteId())
                : Collections.emptyMap();

        Map<String, Object> invoiceSettings = getInvoiceSettings(institute);

        BigDecimal subtotal = request.getLineItems().stream()
                .map(item -> item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        // Same effective-tax resolution createAdminInvoices uses, so the preview's numbers
        // and rendered {{tax_rate}}/{{tax_label}} can never disagree with what create persists.
        EffectiveTax effectiveTax = computeEffectiveTax(invoiceSettings, subtotal,
                request.getTaxEnabled(), request.getTaxRatePercent());
        boolean taxIncluded = effectiveTax.taxIncluded();
        BigDecimal taxRate = effectiveTax.taxRate();
        String taxLabel = effectiveTax.taxLabel();
        BigDecimal taxAmount = effectiveTax.taxAmount();
        BigDecimal totalAmount = effectiveTax.totalAmount();

        boolean singleUser = request.getUserIds() != null && request.getUserIds().size() == 1;
        Map<String, String> userOverrides = sanitizeOverrides(request.getOverrides(), singleUser);
        String effectiveNotes = userOverrides.containsKey("notes")
                ? userOverrides.get("notes")
                : firstNonBlank(request.getNotes(), invoiceInstituteProfileService.loadAsMap(invoiceSettings).get("notes"));

        // Resolve the invoice number exactly like createAdminInvoices: honour a unique admin
        // override, else the number that would be issued next. This keeps the preview's
        // rendered {{invoice_number}} equal to what create will actually assign.
        //
        // MUST use previewInvoiceNumber, not generateInvoiceNumber: this endpoint re-renders
        // on every keystroke in the create-invoice dialog, and allocating here would consume
        // a sequence number per edit — permanent gaps in a tax document series.
        //
        // Uniqueness is scoped to the institute (invoice_number is unique per institute since
        // V432, not globally). When previewing an EDIT the invoice's own number is already in
        // the DB — that is not a collision, so a match on the invoice being edited counts as
        // available.
        String overrideNumber = userOverrides.get("invoice_number");
        boolean numberAvailable = StringUtils.hasText(overrideNumber)
                && invoiceRepository
                        .findByInstituteIdAndInvoiceNumber(request.getInstituteId(), overrideNumber.trim())
                        .map(existing -> existing.getId().equals(request.getEditingInvoiceId()))
                        .orElse(true);
        // Proforma institutes raise this unpaid, so preview the PROFORMA series — otherwise
        // the dialog promises an invoice number the created document will not carry, and the
        // number appears to change out from under the admin.
        boolean proformaMode = isProformaEnabled(institute);
        InvoiceData previewNumberingData = numberingDataForAdminInvoice(institute, user,
                request.getInvoiceDate() != null ? request.getInvoiceDate() : LocalDateTime.now(),
                request.getCurrency());
        String invoiceNumber = numberAvailable
                ? overrideNumber.trim()
                : (proformaMode
                        ? previewProformaNumber(request.getInstituteId(), previewNumberingData)
                        : previewInvoiceNumber(request.getInstituteId(), previewNumberingData,
                                DOC_TYPE_ADMIN));

        InvoiceData invoiceData = InvoiceData.builder()
                .user(user)
                .institute(institute)
                .invoiceNumber(invoiceNumber)
                .documentTitle(proformaMode ? DOCUMENT_TITLE_PROFORMA : DOCUMENT_TITLE_INVOICE)
                .documentNumberLabel(proformaMode
                        ? DOCUMENT_NUMBER_LABEL_PROFORMA : DOCUMENT_NUMBER_LABEL_INVOICE)
                .invoiceDate(request.getInvoiceDate() != null ? request.getInvoiceDate() : LocalDateTime.now())
                .dueDate(request.getDueDate())
                .subtotal(subtotal)
                .discountAmount(BigDecimal.ZERO)
                .taxAmount(taxAmount)
                .totalAmount(totalAmount)
                .currency(request.getCurrency())
                .taxIncluded(taxIncluded)
                .taxRate(taxRate)
                .taxLabel(taxLabel)
                .paymentMethod("")
                .transactionId("")
                .paymentDate(LocalDateTime.now())
                .lineItems(buildAdminLineItemData(request.getLineItems(), taxAmount, taxIncluded, taxRate, taxLabel))
                .notes(effectiveNotes)
                .billingProfile(billingProfile)
                .build();

        // Render EVERY editable placeholder through the escaping override path (defaults merged
        // under the admin's edits) so the preview HTML matches the created PDF byte-for-byte —
        // including the seed frame, where the admin has edited nothing. invoice_number is driven
        // by invoiceData (collision-resolved above), notes are folded in escaped. Mirrors the
        // renderOverrides createAdminInvoices builds.
        String templateHtml = loadInvoiceTemplate(request.getInstituteId());
        Map<String, String> defaults = computeDefaultTextValues(invoiceData, invoiceSettings, templateHtml);
        Map<String, String> renderOverrides = new HashMap<>(userOverrides);
        for (String key : EDITABLE_OVERRIDE_KEYS) {
            if (!renderOverrides.containsKey(key) && defaults.containsKey(key)) {
                renderOverrides.put(key, defaults.get(key));
            }
        }
        renderOverrides.remove("invoice_number");
        if (StringUtils.hasText(effectiveNotes)) renderOverrides.put("notes", effectiveNotes);
        invoiceData.setOverrides(renderOverrides);

        String html = replaceTemplatePlaceholders(templateHtml, invoiceData);
        List<AdminInvoicePreviewResponseDTO.PlaceholderValue> resolved =
                computeResolvedValues(invoiceData, templateHtml, invoiceSettings);

        return AdminInvoicePreviewResponseDTO.builder().html(html).resolvedValues(resolved).build();
    }

    /**
     * For each placeholder the template actually contains (and that we know how to label),
     * produce its current value — the override when supplied, else the auto-derived value.
     * Values are RAW (unescaped) so the UI can seed editable inputs; the preview HTML is
     * separately escaped by {@link #replaceTemplatePlaceholders}.
     */
    private List<AdminInvoicePreviewResponseDTO.PlaceholderValue> computeResolvedValues(
            InvoiceData invoiceData, String templateHtml, Map<String, Object> invoiceSettings) {
        Set<String> present = new HashSet<>();
        java.util.regex.Matcher m = PLACEHOLDER_PATTERN.matcher(templateHtml != null ? templateHtml : "");
        while (m.find()) present.add(m.group(1));

        Map<String, String> defaults = computeDefaultTextValues(invoiceData, invoiceSettings, templateHtml);
        Map<String, String> overrides = invoiceData.getOverrides() != null
                ? invoiceData.getOverrides() : Collections.emptyMap();

        List<AdminInvoicePreviewResponseDTO.PlaceholderValue> out = new ArrayList<>();
        for (Map.Entry<String, PlaceholderMeta> entry : PLACEHOLDER_META.entrySet()) {
            String key = entry.getKey();
            if (!present.contains(key)) continue;
            PlaceholderMeta meta = entry.getValue();
            // invoice_number falls back to the derived (freshly generated) value on preview.
            String value = (meta.editable() && overrides.containsKey(key))
                    ? overrides.get(key) : defaults.getOrDefault(key, "");
            out.add(AdminInvoicePreviewResponseDTO.PlaceholderValue.builder()
                    .key(key)
                    .label(meta.label())
                    .group(meta.group())
                    .editable(meta.editable())
                    .inputType(meta.inputType())
                    .value(value != null ? value : "")
                    .build());
        }
        return out;
    }

    /** Auto-derived (pre-override) value for each editable/derived text placeholder. */
    @SuppressWarnings("unchecked")
    private Map<String, String> computeDefaultTextValues(InvoiceData invoiceData, Map<String, Object> invoiceSettings,
            String templateHtml) {
        Map<String, String> d = new HashMap<>();
        UserDTO user = invoiceData.getUser();
        Institute institute = invoiceData.getInstitute();
        // Remembered billing details (if any) win over the raw user record for the
        // user-linked fields, so a previously-entered Bill-To prefills next time.
        Map<String, String> bp = invoiceData.getBillingProfile() != null
                ? invoiceData.getBillingProfile() : Collections.emptyMap();

        d.put("invoice_number", nz(invoiceData.getInvoiceNumber()));
        d.put("invoice_date", invoiceData.getInvoiceDate() != null
                ? invoiceData.getInvoiceDate().toLocalDate().toString() : "");
        d.put("due_date", invoiceData.getDueDate() != null
                ? invoiceData.getDueDate().toLocalDate().toString() : "");

        d.put("user_name", firstNonBlank(bp.get("user_name"), user != null ? user.getFullName() : null));
        d.put("user_email", firstNonBlank(bp.get("user_email"), user != null ? user.getEmail() : null));
        d.put("user_address", firstNonBlank(bp.get("user_address"), user != null ? user.getAddressLine() : null));
        d.put("place_of_supply", firstNonBlank(bp.get("place_of_supply"), user != null ? user.getRegion() : null));
        d.put("user_tax_info", nz(bp.get("user_tax_info")));

        // Institute-level defaults: a previously-saved override (INVOICE_SETTING) wins over
        // the institute's raw record, so a corrected name/address/contact prefills for every
        // future invoice from any admin — see InvoiceInstituteProfileService.
        Map<String, String> ip = invoiceInstituteProfileService.loadAsMap(invoiceSettings);
        if (institute != null) {
            d.put("institute_name", firstNonBlank(ip.get("institute_name"), institute.getInstituteName()));
            d.put("institute_address", firstNonBlank(ip.get("institute_address"), institute.getAddress()));
            d.put("institute_contact", firstNonBlank(ip.get("institute_contact"),
                    institute.getMobileNumber(), institute.getEmail()));
        }

        if (institute != null) {
            d.put("institute_tagline", nz(institute.getDescription()));
            d.put("institute_email", nz(institute.getEmail()));
        }
        d.put("user_mobile", user != null ? nz(user.getMobileNumber()) : "");

        LocalDate billingDate = billingPeriodDate(invoiceData);
        String billingMonth = billingMonthName(billingDate);
        String billingYear = billingDate != null ? String.valueOf(billingDate.getYear()) : "";
        d.put("billing_month", billingMonth);
        d.put("billing_year", billingYear);
        d.put("billing_period", (billingMonth + " " + billingYear).trim());
        // Only templates that print them pay for the custom-field read; the rest get blanks.
        LearnerProfileFields lpf = usesLearnerProfileFields(templateHtml)
                ? resolveLearnerProfileFields(invoiceData)
                : LearnerProfileFields.EMPTY;
        d.put("parent_name", lpf.parentName());
        d.put("year_group", lpf.yearGroup());
        d.put("practice_name", lpf.practiceName());
        d.put("job_title", lpf.jobTitle());
        d.put("state", lpf.state());
        d.put("customer_country", lpf.country());

        // Seed the receipt fields too, so the review step shows what the PDF will actually
        // print rather than an empty box next to every amount.
        String recCur = getCurrencySymbol(invoiceData.getCurrency() != null ? invoiceData.getCurrency() : "INR");
        ReceiptFigures rfd = buildReceiptFigures(invoiceData);  // review step: always shown
        d.put("course_name", nz(rfd.courseName));
        d.put("course_code", nz(rfd.courseCode));
        d.put("course_fees", rfd.courseFees != null ? recCur + money(rfd.courseFees) : "");
        d.put("total_fees", rfd.totalFees != null ? recCur + money(rfd.totalFees) : "");
        d.put("previous_paid", rfd.previousPaid != null ? recCur + money(rfd.previousPaid) : "");
        d.put("fees_paid_now", invoiceData.getTotalAmount() != null
                ? recCur + money(invoiceData.getTotalAmount()) : "");
        d.put("total_fees_due", rfd.totalDue != null ? recCur + money(rfd.totalDue) : "");
        d.put("total_amount_paid", rfd.totalPaid != null ? recCur + money(rfd.totalPaid) : "");
        d.put("next_installment_amount", rfd.nextInstallmentAmount != null
                ? recCur + money(rfd.nextInstallmentAmount) : "");
        d.put("next_installment_date", rfd.nextInstallmentDate != null
                ? rfd.nextInstallmentDate.format(DISPLAY_DATE_FORMATTER) : "");
        d.put("amount_in_words", amountInWords(invoiceData.getTotalAmount()));
        d.put("payment_mode", nz(invoicePaymentMode(invoiceData.getPaymentLog(), invoiceData.getPaymentMethod())));

        // Effective (possibly per-invoice-overridden) tax, not the raw institute default —
        // matches what replaceTemplatePlaceholders renders and what create will persist.
        d.put("tax_label", invoiceData.getTaxLabel() != null ? invoiceData.getTaxLabel() : "Tax");
        d.put("tax_rate", invoiceData.getTaxRate() != null
                ? formatRate(invoiceData.getTaxRate().multiply(BigDecimal.valueOf(100))) : "");
        Object countryObj = invoiceSettings.get("country");
        if (countryObj instanceof Map) {
            Map<String, Object> c = (Map<String, Object>) countryObj;
            d.put("country", c.get("name") != null ? c.get("name").toString() : "");
            d.put("country_code", c.get("code") != null ? c.get("code").toString().toUpperCase() : "");
            d.put("tax_registration_number", c.get("taxRegistrationNumber") != null
                    ? c.get("taxRegistrationNumber").toString() : "");
            d.put("hsn_code", c.get("hsnSacCode") != null ? c.get("hsnSacCode").toString() : "");
        }

        String sym = getCurrencySymbol(invoiceData.getCurrency() != null ? invoiceData.getCurrency() : "INR");
        d.put("subtotal", sym + (invoiceData.getSubtotal() != null ? invoiceData.getSubtotal().toString() : "0.00"));
        // Mirrors the placeholder block in fillTemplate: empty rather than "0.00" when nothing was
        // discounted, so a template that prints them unconditionally shows a blank, not a false zero.
        BigDecimal disc = invoiceData.getDiscountAmount();
        boolean discApplies = disc != null && disc.compareTo(BigDecimal.ZERO) > 0;
        d.put("plan_price", invoiceData.getPlanPrice() != null ? sym + invoiceData.getPlanPrice().toString() : "");
        d.put("discount_amount", discApplies ? sym + disc.toString() : "");
        d.put("discount_row", discApplies
                ? "<div class=\"invoice-discount-row\">Discount: -" + sym + disc.toString() + "</div>"
                : "");
        d.put("tax_amount", sym + (invoiceData.getTaxAmount() != null ? invoiceData.getTaxAmount().toString() : "0.00"));
        d.put("total_amount", sym + (invoiceData.getTotalAmount() != null ? invoiceData.getTotalAmount().toString() : "0.00"));
        d.put("currency", nz(invoiceData.getCurrency()));
        d.put("notes", nz(invoiceData.getNotes()));
        return d;
    }

    /**
     * Rebuild {@link InvoiceData} for an admin invoice (no payment-log mappings) directly
     * from the persisted row, its line items, and any stored notes/overrides — so the PDF
     * can be regenerated on demand with the admin's edits intact. Returns null if the
     * institute is gone.
     */
    private InvoiceData buildInvoiceDataFromPersistedInvoice(Invoice invoice) {
        Institute institute = instituteRepository.findById(invoice.getInstituteId()).orElse(null);
        if (institute == null) return null;

        UserDTO user;
        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(invoice.getUserId()));
        user = users.isEmpty() ? UserDTO.builder().build() : users.get(0);

        List<InvoiceLineItemData> lineItemData = invoiceLineItemRepository.findByInvoiceId(invoice.getId()).stream()
                .map(li -> InvoiceLineItemData.builder()
                        .itemType(li.getItemType())
                        .description(li.getDescription())
                        .quantity(li.getQuantity())
                        .unitPrice(li.getUnitPrice())
                        .amount(li.getAmount())
                        .build())
                .collect(Collectors.toList());

        Map<String, Object> settings = getInvoiceSettings(institute);
        // Derive the rate from the AMOUNTS ACTUALLY FROZEN on the invoice, not the institute's
        // current settings — this invoice may have used a per-invoice tax override, or the
        // institute's tax rate may have changed since creation. Re-deriving from settings would
        // silently disagree with the persisted subtotal/tax_amount/total on regeneration.
        BigDecimal subtotal = invoice.getSubtotal() != null ? invoice.getSubtotal() : BigDecimal.ZERO;
        BigDecimal taxAmount = invoice.getTaxAmount() != null ? invoice.getTaxAmount() : BigDecimal.ZERO;
        BigDecimal taxRate;
        if (taxAmount.compareTo(BigDecimal.ZERO) <= 0 || subtotal.compareTo(BigDecimal.ZERO) <= 0) {
            taxRate = null; // no tax on this invoice — matches computeEffectiveTax's "disabled" convention
        } else if (Boolean.TRUE.equals(invoice.getTaxIncluded())) {
            // taxAmount is the tax embedded within subtotal; rate = tax / (subtotal - tax).
            BigDecimal netSubtotal = subtotal.subtract(taxAmount);
            taxRate = netSubtotal.compareTo(BigDecimal.ZERO) > 0
                    ? taxAmount.divide(netSubtotal, 10, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;
        } else {
            taxRate = taxAmount.divide(subtotal, 10, RoundingMode.HALF_UP);
        }
        String taxLabel = taxRate == null ? ""
                : settings.get("taxLabel") != null ? settings.get("taxLabel").toString() : "Tax";

        // Persisted line items don't include the synthetic TAX row (only real items are
        // stored) — re-append it so the regenerated table matches the original PDF.
        if (taxAmount.compareTo(BigDecimal.ZERO) > 0
                && !Boolean.TRUE.equals(invoice.getTaxIncluded())) {
            lineItemData.add(InvoiceLineItemData.builder()
                    .itemType("TAX")
                    .description(buildTaxLineDescription(taxLabel, taxRate))
                    .quantity(1)
                    .unitPrice(taxAmount)
                    .amount(taxAmount)
                    .build());
        }

        InvoiceData data = InvoiceData.builder()
                .user(user)
                .institute(institute)
                .invoiceNumber(invoice.getInvoiceNumber())
                .documentTitle(isProforma(invoice) ? DOCUMENT_TITLE_PROFORMA : DOCUMENT_TITLE_INVOICE)
                .documentNumberLabel(isProforma(invoice)
                        ? DOCUMENT_NUMBER_LABEL_PROFORMA : DOCUMENT_NUMBER_LABEL_INVOICE)
                .proformaNumber(finalizedFromProformaNumber(invoice))
                .invoiceDate(invoice.getInvoiceDate())
                .dueDate(invoice.getDueDate())
                .subtotal(invoice.getSubtotal())
                .discountAmount(invoice.getDiscountAmount())
                .taxAmount(invoice.getTaxAmount())
                .totalAmount(invoice.getTotalAmount())
                .currency(invoice.getCurrency())
                .taxIncluded(invoice.getTaxIncluded())
                .taxRate(taxRate)
                .taxLabel(taxLabel)
                .paymentMethod("")
                .transactionId("")
                .paymentDate(invoice.getInvoiceDate())
                .lineItems(lineItemData)
                .build();
        applyStoredOverrides(invoice, data);
        return data;
    }

    /** Fold persisted notes + overrides (from invoice_data_json) onto an InvoiceData. */
    @SuppressWarnings("unchecked")
    private void applyStoredOverrides(Invoice invoice, InvoiceData data) {
        if (invoice == null || data == null || !StringUtils.hasText(invoice.getInvoiceDataJson())) return;
        try {
            Map<String, Object> json = INVOICE_JSON_MAPPER.readValue(invoice.getInvoiceDataJson(), Map.class);
            Object notes = json.get("notes");
            if (notes instanceof String && StringUtils.hasText((String) notes)) {
                data.setNotes((String) notes);
            }
            Object ov = json.get("overrides");
            if (ov instanceof Map) {
                Map<String, String> overrides = new HashMap<>();
                ((Map<String, Object>) ov).forEach((k, v) -> {
                    if (k != null && v != null) overrides.put(k.toString(), v.toString());
                });
                data.setOverrides(overrides);
            }
        } catch (Exception e) {
            log.warn("Failed to parse invoice_data_json for invoice {}: {}", invoice.getId(), e.getMessage());
        }
    }

    private byte[] fetchPdfBytesFromS3(String pdfFileId) {
        try {
            // Presigned first: deployments that keep Block Public Access on (vet) answer an
            // unsigned object URL with 403, which silently produced invoice emails with no
            // PDF attached. The permanent URL stays as a fallback for the CDN-fronted case.
            String pdfUrl = mediaService.getFilePublicUrlById(pdfFileId);
            if (!StringUtils.hasText(pdfUrl)) {
                pdfUrl = mediaService.getFilePublicUrlByIdWithoutExpiry(pdfFileId);
            }
            if (!StringUtils.hasText(pdfUrl)) return null;
            java.net.URL url = new java.net.URL(pdfUrl);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(15000);
            if (conn.getResponseCode() == 200) {
                try (java.io.InputStream is = conn.getInputStream();
                     java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
                    return out.toByteArray();
                }
            }
        } catch (Exception e) {
            log.warn("Could not fetch PDF bytes for pdfFileId={}: {}", pdfFileId, e.getMessage());
        }
        return null;
    }

    private String buildPaymentLink(Institute institute, String invoiceId) {
        String base = StringUtils.hasText(institute.getLearnerPortalBaseUrl())
                ? institute.getLearnerPortalBaseUrl()
                : learnerPortalUrl;
        if (!base.startsWith("http")) {
            base = "https://" + base;
        }
        return base.replaceAll("/$", "") + invoicePayPath + "/" + invoiceId;
    }

    /**
     * Map Invoice entity to DTO
     */
    /**
     * Only PENDING_PAYMENT admin invoices need a payment link in the listing — paid
     * invoices, refunded, and synthetic SFP-derived rows don't have a learner-facing
     * pay page. Resolves the institute via repo (mapToDTO has only the FK string).
     * Best-effort: returns null on any failure (the FE just hides the Copy Link button).
     */
    private String computePaymentLinkForListing(Invoice invoice) {
        try {
            if (invoice == null) return null;
            if (!INVOICE_STATUS_PENDING_PAYMENT.equalsIgnoreCase(invoice.getStatus())) return null;
            if (!StringUtils.hasText(invoice.getInstituteId())) return null;
            Institute inst = instituteRepository.findById(invoice.getInstituteId()).orElse(null);
            if (inst == null) return null;
            return buildPaymentLink(inst, invoice.getId());
        } catch (Exception e) {
            log.debug("computePaymentLinkForListing failed for invoice {}: {}",
                    invoice != null ? invoice.getId() : null, e.getMessage());
            return null;
        }
    }

    private InvoiceDTO mapToDTO(Invoice invoice) {
        List<InvoiceLineItemDTO> lineItemDTOs = null;
        if (invoice.getLineItems() != null) {
            lineItemDTOs = invoice.getLineItems().stream()
                    .map(item -> InvoiceLineItemDTO.builder()
                            .id(item.getId())
                            .invoiceId(item.getInvoice().getId())
                            .itemType(item.getItemType())
                            .description(item.getDescription())
                            .quantity(item.getQuantity())
                            .unitPrice(item.getUnitPrice())
                            .amount(item.getAmount())
                            .sourceId(item.getSourceId())
                            .build())
                    .collect(Collectors.toList());
        }

        // Get all payment log IDs and user plan ID from mappings
        List<String> paymentLogIds = new ArrayList<>();
        String primaryPaymentLogId = null;
        String userPlanId = null;
        // Who gave the discount, and why: an admin invoice carries it itself; an enrollment
        // invoice inherits it from the plan it bills (set when an admin discounted that plan).
        String discountGrantedBy = invoice.getDiscountGrantedByUserId();
        String discountReason = readAdminDiscountReason(invoice.getInvoiceDataJson());
        if (invoice.getPaymentLogMappings() != null && !invoice.getPaymentLogMappings().isEmpty()) {
            paymentLogIds = invoice.getPaymentLogMappings().stream()
                    .map(m -> m.getPaymentLog().getId())
                    .collect(Collectors.toList());
            primaryPaymentLogId = paymentLogIds.get(0); // First one as primary

            // Get user plan ID from first payment log (via mapping)
            if (!invoice.getPaymentLogMappings().isEmpty()) {
                PaymentLog firstPaymentLog = invoice.getPaymentLogMappings().get(0).getPaymentLog();
                if (firstPaymentLog.getUserPlan() != null) {
                    userPlanId = firstPaymentLog.getUserPlan().getId();
                    if (discountGrantedBy == null
                            && StringUtils.hasText(firstPaymentLog.getUserPlan().getDiscountGrantedByUserId())) {
                        discountGrantedBy = firstPaymentLog.getUserPlan().getDiscountGrantedByUserId();
                        var snapshot = vacademy.io.admin_core_service.features.user_subscription.dto.CouponSnapshotDTO
                                .fromJson(firstPaymentLog.getUserPlan().getAppliedCouponDiscountJson());
                        discountReason = snapshot != null ? snapshot.getGrantReason() : null;
                    }
                }
            }
        }

        return InvoiceDTO.builder()
                .id(invoice.getId())
                .invoiceNumber(invoice.getInvoiceNumber())
                .proforma(isProforma(invoice))
                .userPlanId(userPlanId) // Retrieved from payment log via mapping
                .paymentLogId(primaryPaymentLogId) // Primary payment log ID (for backward compatibility)
                .paymentLogIds(paymentLogIds) // All payment log IDs
                .userId(invoice.getUserId())
                .instituteId(invoice.getInstituteId())
                .invoiceDate(invoice.getInvoiceDate())
                .dueDate(invoice.getDueDate())
                .subtotal(invoice.getSubtotal())
                .discountAmount(invoice.getDiscountAmount())
                .discountGrantedByUserId(discountGrantedBy)
                .discountReason(discountReason)
                .taxAmount(invoice.getTaxAmount())
                .totalAmount(invoice.getTotalAmount())
                .currency(invoice.getCurrency())
                .status(invoice.getStatus())
                .pdfFileId(invoice.getPdfFileId())
                .pdfUrl(invoice.getPdfFileId() != null ? mediaService.getFilePublicUrlById(invoice.getPdfFileId()) : null) // Pre-signed URL (1-day expiry)
                                                                                                                     // URL
                                                                                                                     // from
                                                                                                                     // file
                                                                                                                     // ID
                .paymentLink(computePaymentLinkForListing(invoice))
                .taxIncluded(invoice.getTaxIncluded())
                .source(invoice.getSource())
                .sourceId(invoice.getSourceId())
                .notes(readInvoiceDataJsonField(invoice.getInvoiceDataJson(), "notes"))
                .createdAt(invoice.getCreatedAt())
                .updatedAt(invoice.getUpdatedAt())
                .lineItems(lineItemDTOs)
                .build();
    }

    public PublicInvoiceListResponse getInvoicesByEmailPublic(String email, String instituteId) {
        String normalizedEmail = email.toLowerCase().trim();
        UserDTO user = authService.getUserByEmail(normalizedEmail);
        log.info("[invoice-by-email] email='{}' resolved userId={}", normalizedEmail,
                user != null ? user.getId() : "null");
        if (user == null || user.getId() == null) {
            return new PublicInvoiceListResponse(normalizedEmail, 0, List.of());
        }
        List<InvoiceDTO> invoices = getInvoicesByUserId(user.getId(), instituteId);
        log.info("[invoice-by-email] userId={} → {} invoice(s)", user.getId(), invoices.size());
        List<PublicInvoiceDTO> publicInvoices = invoices.stream()
                .map(this::toPublicInvoiceDTO)
                .collect(Collectors.toList());
        return new PublicInvoiceListResponse(normalizedEmail, publicInvoices.size(), publicInvoices);
    }

    private PublicInvoiceDTO toPublicInvoiceDTO(InvoiceDTO dto) {
        List<PublicInvoiceLineItemDTO> items = dto.getLineItems() == null ? List.of() :
                dto.getLineItems().stream()
                        .map(li -> PublicInvoiceLineItemDTO.builder()
                                .itemType(li.getItemType())
                                .description(li.getDescription())
                                .quantity(li.getQuantity())
                                .unitPrice(li.getUnitPrice())
                                .amount(li.getAmount())
                                .build())
                        .collect(Collectors.toList());
        return PublicInvoiceDTO.builder()
                .invoiceNumber(dto.getInvoiceNumber())
                .invoiceDate(dto.getInvoiceDate())
                .status(dto.getStatus())
                .currency(dto.getCurrency())
                .subtotal(dto.getSubtotal())
                .discountAmount(dto.getDiscountAmount())
                .taxAmount(dto.getTaxAmount())
                .totalAmount(dto.getTotalAmount())
                .taxIncluded(dto.getTaxIncluded())
                .pdfUrl(dto.getPdfUrl())
                .createdAt(dto.getCreatedAt())
                .lineItems(items)
                .build();
    }

    /**
     * Everything collected on the plan including the payment this receipt is for. The schedule
     * only counts that payment once allocation has run, and that ordering differs per gateway
     * path, so the ledger decides which side of it we are on.
     */
    static BigDecimal totalCollected(BigDecimal scheduledPaid, BigDecimal thisPayment,
            boolean alreadyAllocated) {
        BigDecimal scheduled = scheduledPaid != null ? scheduledPaid : BigDecimal.ZERO;
        BigDecimal now = thisPayment != null ? thisPayment : BigDecimal.ZERO;
        return alreadyAllocated ? scheduled : scheduled.add(now);
    }

    /**
     * What the learner had paid before this receipt. Never negative: a payment recorded outside
     * the schedule would otherwise print a nonsense figure on a financial document.
     */
    static BigDecimal paidBefore(BigDecimal totalCollected, BigDecimal thisPayment) {
        BigDecimal total = totalCollected != null ? totalCollected : BigDecimal.ZERO;
        BigDecimal now = thisPayment != null ? thisPayment : BigDecimal.ZERO;
        return total.subtract(now).max(BigDecimal.ZERO);
    }

    /**
     * The date whose month a monthly invoice is for: the due date, falling back to the invoice
     * date. Fees billed in advance are raised in one month and fall due in the next, so the
     * invoice date alone would name the wrong month.
     */
    static LocalDate billingPeriodDate(InvoiceData invoiceData) {
        if (invoiceData == null) {
            return null;
        }
        if (invoiceData.getDueDate() != null) {
            return invoiceData.getDueDate().toLocalDate();
        }
        return invoiceData.getInvoiceDate() != null ? invoiceData.getInvoiceDate().toLocalDate() : null;
    }

    /** "October", or "" without a date. English, to match the dd MMM yyyy dates on the PDF. */
    static String billingMonthName(LocalDate date) {
        return date != null ? date.getMonth().getDisplayName(java.time.format.TextStyle.FULL, Locale.ENGLISH) : "";
    }

    /** Learner-profile values as the learner's own custom fields hold them; "" when absent. */
    record LearnerProfileFields(String parentName, String yearGroup, String practiceName, String jobTitle,
                                String state, String country) {
        static final LearnerProfileFields EMPTY = new LearnerProfileFields("", "", "", "", "", "");
    }

    /**
     * Which invoice placeholder a learner custom field feeds, by its display name, or null.
     * Institutes name these fields freely ("Parent Name", "Guardian's Name", "Year Group",
     * "Grade"), so this matches on meaning rather than an exact key. A parent's email or
     * phone also mentions "parent" and must not be taken for the name.
     */
    static String learnerProfilePlaceholderFor(String fieldName) {
        if (fieldName == null) {
            return null;
        }
        String n = fieldName.toLowerCase(Locale.ENGLISH).replaceAll("[^a-z ]", " ").replaceAll("\\s+", " ").trim();
        if (n.contains("parent") || n.contains("guardian")) {
            for (String notAName : List.of("email", "mail", "phone", "mobile", "number", "contact",
                    "whatsapp", "occupation", "address", "relation")) {
                if (n.contains(notAName)) {
                    return null;
                }
            }
            return "parent_name";
        }
        if (n.contains("year group") || Set.of("year", "grade", "class", "standard", "school year",
                "year level").contains(n)) {
            return "year_group";
        }
        // A practice-membership customer is a person at a clinic: "Clinic Name", "Practice Name".
        if (Set.of("clinic name", "practice name", "clinic", "practice").contains(n)) {
            return "practice_name";
        }
        if (Set.of("job title", "job role", "designation").contains(n)) {
            return "job_title";
        }
        // Exact names only: "State" must not catch "Statement" or "Estate Name".
        if (Set.of("state", "state territory", "state province", "province").contains(n)) {
            return "state";
        }
        if (Set.of("country", "country of residence").contains(n)) {
            return "customer_country";
        }
        return null;
    }

    private static final List<String> LEARNER_PROFILE_PLACEHOLDERS = List.of("{{parent_name}}", "{{year_group}}",
            "{{practice_name}}", "{{job_title}}", "{{state}}", "{{customer_country}}");

    /** Whether a template asks for a value that needs the learner's custom fields. */
    static boolean usesLearnerProfileFields(String template) {
        if (template == null || template.isEmpty()) {
            return false;
        }
        for (String token : LEARNER_PROFILE_PLACEHOLDERS) {
            if (template.contains(token)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Parent name, year group, practice, job title, state and country from the billed learner's custom fields in this institute.
     * The newest answer wins (the query is newest first). Never throws: a failed lookup leaves
     * the fields blank for the admin to fill in, rather than failing the invoice.
     */
    private LearnerProfileFields resolveLearnerProfileFields(InvoiceData invoiceData) {
        if (invoiceData == null || invoiceData.getUser() == null || invoiceData.getInstitute() == null
                || !StringUtils.hasText(invoiceData.getUser().getId())) {
            return LearnerProfileFields.EMPTY;
        }
        try {
            List<Object[]> rows = customFieldValuesRepository.findCustomFieldsWithKeysByUserIdsAndInstitute(
                    "USER", List.of(invoiceData.getUser().getId()), invoiceData.getInstitute().getId());
            String parentName = "";
            String yearGroup = "";
            Map<String, String> extra = new HashMap<>();
            for (Object[] row : rows) {
                // [sourceId, customFieldId, fieldKey, fieldName, fieldType, value, sourceType]
                String value = row[5] != null ? row[5].toString().trim() : "";
                if (value.isEmpty()) {
                    continue;
                }
                String target = learnerProfilePlaceholderFor(row[3] != null ? row[3].toString() : null);
                if ("parent_name".equals(target) && parentName.isEmpty()) {
                    parentName = value;
                } else if ("year_group".equals(target) && yearGroup.isEmpty()) {
                    yearGroup = value;
                } else if (target != null) {
                    extra.putIfAbsent(target, value);
                }
            }
            return new LearnerProfileFields(parentName, yearGroup, extra.getOrDefault("practice_name", ""),
                    extra.getOrDefault("job_title", ""), extra.getOrDefault("state", ""),
                    extra.getOrDefault("customer_country", ""));
        } catch (Exception e) {
            log.warn("Could not read learner-profile custom fields for user {}: {}",
                    invoiceData.getUser().getId(), e.getMessage());
            return LearnerProfileFields.EMPTY;
        }
    }

    private static final List<String> RECEIPT_PLACEHOLDERS = List.of(
            "{{course_fees}}", "{{total_fees}}", "{{previous_paid}}", "{{total_fees_due}}",
            "{{total_amount_paid}}", "{{next_installment_amount}}", "{{next_installment_date}}",
            "{{course_name}}", "{{course_code}}", "{{course_code_bracketed}}");

    /** Whether a template mentions any placeholder that needs the learner fee schedule. */
    static boolean usesReceiptFields(String template) {
        if (template == null || template.isEmpty()) {
            return false;
        }
        for (String token : RECEIPT_PLACEHOLDERS) {
            if (template.contains(token)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The figures a fee receipt needs that a single invoice does not carry: the course price,
     * what had already been paid before this payment, what is still outstanding and the next
     * installment. Derived from the learner fee schedule for the plan this invoice belongs to.
     *
     * <p>Every field is nullable. A plan with no schedule rows yields an all-null result so the
     * placeholders render empty instead of a misleading zero.
     */
    private static final class ReceiptFigures {
        private BigDecimal courseFees;
        private BigDecimal totalFees;
        private BigDecimal previousPaid;
        private BigDecimal totalPaid;
        private BigDecimal totalDue;
        private BigDecimal nextInstallmentAmount;
        private LocalDateTime nextInstallmentDate;
        private String courseName = "";
        private String courseCode = "";
    }

    /**
     * Build the receipt figures for an invoice. The schedule is the source of truth for money
     * already collected; the payment plan is the source of truth for what the course costs.
     */
    private ReceiptFigures buildReceiptFigures(InvoiceData invoiceData) {
        List<PaymentLog> covered = invoiceData.getReceiptPaymentLogs();
        java.util.LinkedHashMap<String, UserPlan> plans = new java.util.LinkedHashMap<>();
        if (covered != null) {
            for (PaymentLog pl : covered) {
                if (pl.getUserPlan() != null && pl.getUserPlan().getId() != null) {
                    plans.putIfAbsent(pl.getUserPlan().getId(), pl.getUserPlan());
                }
            }
        }
        if (invoiceData.getUserPlan() != null && invoiceData.getUserPlan().getId() != null) {
            plans.putIfAbsent(invoiceData.getUserPlan().getId(), invoiceData.getUserPlan());
        }
        addAdmissionPackagePlans(plans);
        if (plans.size() > 1) {
            List<PaymentLog> logs = covered != null && !covered.isEmpty() ? covered
                    : invoiceData.getPaymentLog() != null ? List.of(invoiceData.getPaymentLog()) : List.of();
            return buildPackageReceiptFigures(invoiceData, new ArrayList<>(plans.values()), logs);
        }
        ReceiptFigures rf = new ReceiptFigures();
        PaymentPlan plan = invoiceData.getPaymentPlan();
        if (plan != null) {
            rf.totalFees = BigDecimal.valueOf(plan.getActualPrice());
            rf.courseName = plan.getName() != null ? plan.getName() : "";
            rf.courseCode = deriveCourseCode(plan.getName());
        }
        rf.courseFees = invoiceData.getPlanPrice() != null ? invoiceData.getPlanPrice() : rf.totalFees;

        UserPlan userPlan = invoiceData.getUserPlan();
        if (userPlan == null || userPlan.getId() == null) {
            return rf;
        }
        List<StudentFeePayment> rows;
        try {
            rows = studentFeePaymentRepository.findByUserPlanId(userPlan.getId());
        } catch (Exception e) {
            log.warn("Could not load fee schedule for user plan {} while building receipt figures",
                    userPlan.getId(), e);
            return rf;
        }
        if (rows == null || rows.isEmpty()) {
            return rf;
        }

        BigDecimal paid = BigDecimal.ZERO;
        BigDecimal expected = BigDecimal.ZERO;
        for (var row : rows) {
            if (row.getAmountPaid() != null) {
                paid = paid.add(row.getAmountPaid());
            }
            if (row.getAmountExpected() != null) {
                expected = expected.add(row.getAmountExpected());
            }
        }
        BigDecimal thisPayment = invoiceData.getTotalAmount() != null
                ? invoiceData.getTotalAmount() : BigDecimal.ZERO;

        // Whether this payment is already counted in the schedule depends on whether allocation
        // has run yet, and that ordering differs per gateway path. Asking the ledger makes the
        // figures the same either way: a receipt must not report a different "previously paid"
        // because it was rendered a moment earlier.
        boolean alreadyAllocated = false;
        String paymentLogId = invoiceData.getPaymentLog() != null ? invoiceData.getPaymentLog().getId() : null;
        if (paymentLogId != null) {
            try {
                var allocations = studentFeeAllocationLedgerRepository.findByPaymentLogId(paymentLogId);
                alreadyAllocated = allocations != null && !allocations.isEmpty();
            } catch (Exception e) {
                log.warn("Could not check fee allocation for payment log {} while building receipt figures",
                        paymentLogId, e);
            }
        }
        rf.totalFees = billedTotal(rf.totalFees, expected);
        rf.totalPaid = totalCollected(paid, thisPayment, alreadyAllocated);
        rf.previousPaid = paidBefore(rf.totalPaid, thisPayment);
        BigDecimal courseTotal = rf.totalFees != null ? rf.totalFees : expected;
        rf.totalDue = courseTotal.subtract(rf.totalPaid).max(BigDecimal.ZERO);

        // The earliest installment still carrying a balance is the one the learner owes next.
        rows.stream()
                .filter(r -> r.getDueDate() != null)
                .filter(r -> !"PAID".equalsIgnoreCase(String.valueOf(r.getStatus())))
                .filter(r -> r.getAmountExpected() != null
                        && r.getAmountExpected().compareTo(
                                r.getAmountPaid() != null ? r.getAmountPaid() : BigDecimal.ZERO) > 0)
                .min(java.util.Comparator.comparing(
                        StudentFeePayment::getDueDate))
                .ifPresent(next -> {
                    rf.nextInstallmentAmount = next.getAmountExpected()
                            .subtract(next.getAmountPaid() != null ? next.getAmountPaid() : BigDecimal.ZERO);
                    rf.nextInstallmentDate = toLocalDate(next.getDueDate()).atStartOfDay();
                });
        return rf;
    }


    /**
     * Adds every course of the admission package(s) these plans belong to, so a receipt for any
     * payment towards a package — even one that only reached one of its courses — reports the
     * package's totals. Plans outside any package are left as they are.
     */
    private void addAdmissionPackagePlans(java.util.Map<String, UserPlan> plans) {
        if (plans.isEmpty()) {
            return;
        }
        try {
            java.util.Set<String> packageIds = new java.util.LinkedHashSet<>();
            for (var course : admissionPackageCourseRepository.findByUserPlanIdIn(plans.keySet())) {
                packageIds.add(course.getAdmissionPackageId());
            }
            for (String packageId : packageIds) {
                for (var course : admissionPackageCourseRepository.findByAdmissionPackageIdOrderByPositionAsc(packageId)) {
                    if (!plans.containsKey(course.getUserPlanId())) {
                        userPlanRepository.findById(course.getUserPlanId())
                                .ifPresent(up -> plans.put(up.getId(), up));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not load admission package courses for plans {} while building receipt figures",
                    plans.keySet(), e);
        }
    }

    /**
     * Receipt figures for one payment spread over several courses (an admission package): fees,
     * paid, due and the next installment cover every course on the receipt, and the course name
     * lists them all. The next installment is the earliest unpaid due date with what is owed on
     * it across the courses — the package installment the learner sees.
     */
    private ReceiptFigures buildPackageReceiptFigures(InvoiceData invoiceData, List<UserPlan> plans,
                                                      List<PaymentLog> covered) {
        ReceiptFigures rf = new ReceiptFigures();
        List<String> names = new ArrayList<>();
        BigDecimal listPrices = BigDecimal.ZERO;
        for (UserPlan up : plans) {
            PaymentPlan plan = up.getPaymentPlan();
            if (plan != null) {
                if (plan.getName() != null && !names.contains(plan.getName())) names.add(plan.getName());
                listPrices = listPrices.add(BigDecimal.valueOf(plan.getActualPrice()));
            }
        }
        rf.courseName = String.join(" + ", names);
        rf.courseCode = names.isEmpty() ? "" : deriveCourseCode(names.get(0));
        rf.totalFees = listPrices;
        rf.courseFees = invoiceData.getPlanPrice() != null ? invoiceData.getPlanPrice() : listPrices;

        List<StudentFeePayment> rows = new ArrayList<>();
        for (UserPlan up : plans) {
            try {
                rows.addAll(studentFeePaymentRepository.findByUserPlanId(up.getId()));
            } catch (Exception e) {
                log.warn("Could not load fee schedule for user plan {} while building package receipt figures",
                        up.getId(), e);
            }
        }
        rows.removeIf(r -> "CANCELLED".equalsIgnoreCase(String.valueOf(r.getStatus())));
        if (rows.isEmpty()) {
            return rf;
        }
        BigDecimal paid = BigDecimal.ZERO;
        BigDecimal expected = BigDecimal.ZERO;
        for (var row : rows) {
            if (row.getAmountPaid() != null) paid = paid.add(row.getAmountPaid());
            if (row.getAmountExpected() != null) expected = expected.add(row.getAmountExpected());
        }
        BigDecimal thisPayment = invoiceData.getTotalAmount() != null ? invoiceData.getTotalAmount() : BigDecimal.ZERO;
        boolean alreadyAllocated = true;
        for (PaymentLog pl : covered) {
            try {
                var allocations = studentFeeAllocationLedgerRepository.findByPaymentLogId(pl.getId());
                if (allocations == null || allocations.isEmpty()) {
                    alreadyAllocated = false;
                }
            } catch (Exception e) {
                alreadyAllocated = false;
            }
        }
        rf.totalFees = billedTotal(rf.totalFees, expected);
        rf.totalPaid = totalCollected(paid, thisPayment, alreadyAllocated);
        rf.previousPaid = paidBefore(rf.totalPaid, thisPayment);
        rf.totalDue = rf.totalFees.subtract(rf.totalPaid).max(BigDecimal.ZERO);

        java.util.List<StudentFeePayment> open = rows.stream()
                .filter(r -> r.getDueDate() != null)
                .filter(r -> !"PAID".equalsIgnoreCase(String.valueOf(r.getStatus())))
                .filter(r -> r.getAmountExpected() != null && r.getAmountExpected().compareTo(
                        r.getAmountPaid() != null ? r.getAmountPaid() : BigDecimal.ZERO) > 0)
                .toList();
        open.stream().map(r -> toLocalDate(r.getDueDate())).min(java.util.Comparator.naturalOrder())
                .ifPresent(first -> {
                    BigDecimal owed = open.stream()
                            .filter(r -> toLocalDate(r.getDueDate()).equals(first))
                            .map(r -> r.getAmountExpected().subtract(
                                    r.getAmountPaid() != null ? r.getAmountPaid() : BigDecimal.ZERO))
                            .reduce(BigDecimal.ZERO, BigDecimal::add);
                    rf.nextInstallmentAmount = owed;
                    rf.nextInstallmentDate = first.atStartOfDay();
                });
        return rf;
    }

    /**
     * What the learner is actually billed for the course. The schedule carries the amounts after
     * any discount or concession; the plan only knows the list price, which is {{course_fees}}.
     * Falls back to the plan price when the schedule has nothing.
     */
    static BigDecimal billedTotal(BigDecimal planPrice, BigDecimal scheduleExpected) {
        return scheduleExpected != null && scheduleExpected.signum() > 0 ? scheduleExpected : planPrice;
    }

    /**
     * A DATE column arrives as {@link java.sql.Date}, whose {@code toInstant()} throws, so the
     * subclass is converted directly and only a genuine {@link java.util.Date} goes via the zone.
     */
    private static LocalDate toLocalDate(java.util.Date date) {
        if (date instanceof java.sql.Date sqlDate) {
            return sqlDate.toLocalDate();
        }
        return date.toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate();
    }

    /**
     * Pull a short course code out of a payment plan name shaped "CODE - Full Course Name",
     * where the part before the first dash is an uppercase code. Returns an empty string when
     * the name carries no code, so a template renders nothing rather than a guess.
     */
    static String deriveCourseCode(String planName) {
        if (!StringUtils.hasText(planName)) {
            return "";
        }
        int dash = planName.indexOf(" - ");
        if (dash <= 0) {
            return "";
        }
        String candidate = planName.substring(0, dash).trim();
        return candidate.matches("[A-Z0-9_&/]{2,}") ? candidate : "";
    }

    private static final String[] WORDS_BELOW_TWENTY = {
            "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
            "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
            "EIGHTEEN", "NINETEEN" };
    private static final String[] WORDS_TENS = {
            "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY" };

    /**
     * Render an amount the way a receipt spells it out, on the Indian scale:
     * 125000 becomes "ONE LAKH TWENTY FIVE THOUSAND only". Paise are included only when present.
     * Returns an empty string for a null or negative amount.
     */
    static String amountInWords(BigDecimal amount) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) < 0) {
            return "";
        }
        BigDecimal rounded = amount.setScale(2, java.math.RoundingMode.HALF_UP);
        long rupees = rounded.longValue();
        int paise = rounded.subtract(BigDecimal.valueOf(rupees))
                .multiply(BigDecimal.valueOf(100)).setScale(0, java.math.RoundingMode.HALF_UP).intValue();
        if (rupees == 0 && paise == 0) {
            return "ZERO only";
        }
        StringBuilder sb = new StringBuilder(indianScale(rupees));
        if (paise > 0) {
            sb.append(sb.length() > 0 ? " AND " : "").append(twoDigits(paise)).append(" PAISE");
        }
        return sb.toString().trim() + " only";
    }

    /** Group a whole number into crore / lakh / thousand / hundred, as Indian receipts read it. */
    private static String indianScale(long n) {
        if (n == 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        long crore = n / 10000000;
        n %= 10000000;
        long lakh = n / 100000;
        n %= 100000;
        long thousand = n / 1000;
        n %= 1000;
        long hundred = n / 100;
        long rest = n % 100;
        if (crore > 0) {
            sb.append(indianScale(crore)).append(" CRORE ");
        }
        if (lakh > 0) {
            sb.append(twoDigits((int) lakh)).append(" LAKH ");
        }
        if (thousand > 0) {
            sb.append(twoDigits((int) thousand)).append(" THOUSAND ");
        }
        if (hundred > 0) {
            sb.append(WORDS_BELOW_TWENTY[(int) hundred]).append(" HUNDRED ");
        }
        if (rest > 0) {
            sb.append(twoDigits((int) rest)).append(" ");
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    private static String twoDigits(int n) {
        if (n < 20) {
            return WORDS_BELOW_TWENTY[n];
        }
        String tens = WORDS_TENS[n / 10];
        return n % 10 == 0 ? tens : tens + " " + WORDS_BELOW_TWENTY[n % 10];
    }


    /**
     * What the invoice prints as the payment method: for an offline payment recorded with a
     * mode, the mode as the admin chose it ("UPI · PhonePe"); otherwise the gateway, as before.
     */
    static String invoicePaymentMethod(PaymentLog paymentLog) {
        if (paymentLog == null) return null;
        if (StringUtils.hasText(paymentLog.getPaymentMode())) {
            String mode = paymentLog.getPaymentMode();
            String sub = paymentLog.getPaymentSubMode();
            if (StringUtils.hasText(paymentLog.getPaymentDetailsJson())) {
                try {
                    com.fasterxml.jackson.databind.JsonNode json =
                            new ObjectMapper().readTree(paymentLog.getPaymentDetailsJson());
                    mode = json.path("mode_label").asText(mode);
                    sub = json.path("sub_mode_label").asText(sub);
                } catch (Exception ignored) {
                    // Fall back to the codes.
                }
            }
            return StringUtils.hasText(sub) ? mode + " · " + sub : mode;
        }
        return paymentLog.getVendor();
    }

    /**
     * Just how the payment was made ("Cash", "Google Pay"), without the account that
     * {@link #invoicePaymentMethod} adds. Uses the payment log when the invoice has one, else
     * the mode part of the stored payment method; the gateway name for an online payment.
     */
    static String invoicePaymentMode(PaymentLog paymentLog, String paymentMethod) {
        if (paymentLog != null) {
            if (StringUtils.hasText(paymentLog.getPaymentMode())) {
                String mode = paymentLog.getPaymentMode();
                if (StringUtils.hasText(paymentLog.getPaymentDetailsJson())) {
                    try {
                        mode = new ObjectMapper().readTree(paymentLog.getPaymentDetailsJson())
                                .path("mode_label").asText(mode);
                    } catch (Exception ignored) {
                        // Fall back to the code.
                    }
                }
                return mode;
            }
            if (StringUtils.hasText(paymentLog.getVendor())) {
                return paymentLog.getVendor();
            }
        }
        if (!StringUtils.hasText(paymentMethod)) return null;
        int sep = paymentMethod.indexOf(" · ");
        return sep > 0 ? paymentMethod.substring(0, sep) : paymentMethod;
    }

    /** The admin's reference for an offline payment; the gateway's id otherwise. */
    static String invoiceTransactionId(PaymentLog paymentLog) {
        if (paymentLog == null) return null;
        return StringUtils.hasText(paymentLog.getPaymentReference())
                ? paymentLog.getPaymentReference()
                : paymentLog.getVendorId();
    }
}
