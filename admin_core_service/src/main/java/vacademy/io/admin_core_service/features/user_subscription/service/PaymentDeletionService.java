package vacademy.io.admin_core_service.features.user_subscription.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import jakarta.servlet.http.HttpServletRequest;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;
import vacademy.io.admin_core_service.features.admin_activity_logs.repository.AdminActivityLogRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Permanently deletes a payment or an invoice — the hard delete some institutes want on top of
 * Void. OFF by default: a role may use it only when an admin has switched on
 * {@code learnerManagement.allowDeletePayments} for it under Settings → Display Settings, and
 * that is checked HERE, not just by hiding the buttons.
 *
 * <p>A delete never leaves the books wrong. A payment that still counts is voided first (see
 * {@link PaymentVoidService}: installments get their money back, invoices are unwound, the credit
 * is reversed), and only then are its rows removed. What the removal takes with it:
 * <ul>
 *   <li>its allocation rows, line items, invoice links and ledger credit/reversal pair (the pair
 *       nets to zero, so the learner's totals do not move);</li>
 *   <li>any invoice generated FROM it that no other payment shares. A bill the payment had settled
 *       is not deleted — voiding already reopened it as unpaid, because it is still owed.</li>
 * </ul>
 *
 * <p>What is refused, because a delete could not be undone cleanly:
 * <ul>
 *   <li>gateway payments (Razorpay, Stripe, …) — real money moved; refund it in the gateway;</li>
 *   <li>anything a live-class registration or a plan-change request still points at;</li>
 *   <li>an invoice with a live (PAID) payment against it — delete or void that payment first.</li>
 * </ul>
 *
 * <p>The deleted record survives in the admin activity log: a DELETE row carrying a snapshot of it
 * is written in the same transaction as the delete (not by the {@code @Auditable} aspect, whose
 * write is best-effort), and every refused attempt leaves a DELETE_BLOCKED row.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentDeletionService {

    /** The Display Settings flag, under {@code learnerManagement}. Absent means OFF. */
    public static final String ALLOW_DELETE_FLAG = "allowDeletePayments";

    private static final String ADMIN_SETTINGS_KEY = "ADMIN_DISPLAY_SETTINGS";
    private static final String TEACHER_SETTINGS_KEY = "TEACHER_DISPLAY_SETTINGS";
    private static final String ROLE_SETTINGS_KEY = "ROLE_DISPLAY_SETTINGS";
    private static final String LEARNER_MANAGEMENT = "learnerManagement";

    private static final Set<String> DELETABLE_VENDORS = Set.of("MANUAL", "OFFLINE");
    private static final Set<String> BILL_SOURCES = Set.of("ADMIN_MANUAL", "LIVE_SESSION");

    /**
     * An admin bill (as opposed to a receipt). Null-safe on purpose: about half of production's
     * invoices carry no source, and {@code Set.of(..).contains(null)} throws.
     */
    private static boolean isBill(String source) {
        return source != null && BILL_SOURCES.contains(source);
    }

    private final PaymentLogRepository paymentLogRepository;
    private final InvoiceRepository invoiceRepository;
    private final InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;
    private final PaymentVoidService paymentVoidService;
    /** Roles live in auth_service's database — admin_core has no user_role table to query. */
    private final InstituteRoleUserClient instituteRoleUserClient;
    private final InstituteSettingService instituteSettingService;
    private final AsyncAuditDispatcher auditDispatcher;
    private final AdminActivityLogRepository adminActivityLogRepository;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    // ------------------------------------------------------------------ permission

    /**
     * Whether this caller may hard-delete in this institute, resolved the way the admin app picks a
     * user's Display Settings card (getActiveRoleDisplaySettingsKey): an ADMIN reads only the admin
     * card; anyone whose roles have a custom-role card reads only those cards; everyone else reads
     * the teacher card. So the server allows exactly what the screen offers — a teacher-card grant
     * never reaches someone the app shows a custom-role card, and vice versa. Fails CLOSED — no
     * setting, a malformed blob or a lookup error all mean no.
     */
    public boolean canDelete(String userId, String instituteId) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(instituteId)) return false;
        try {
            Optional<Set<String>> roleNames = instituteRoleUserClient.findRolesOfUser(instituteId, userId);
            if (roleNames.isEmpty()) return false; // lookup failed: fail closed
            if (roleNames.get().contains("ADMIN")) {
                return flagOn(instituteSettingService.getSettingByInstituteIdAndKey(instituteId, ADMIN_SETTINGS_KEY));
            }
            Optional<Set<String>> roleIdLookup = instituteRoleUserClient.findRoleIdsOfUser(instituteId, userId);
            if (roleIdLookup.isEmpty()) return false;
            List<String> roleIds = List.copyOf(roleIdLookup.get());
            Object byRole = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, ROLE_SETTINGS_KEY);
            if (roleIds != null && byRole instanceof Map<?, ?> roles) {
                List<Object> cards = roleIds.stream().filter(id -> id != null && roles.containsKey(id))
                        .map(roles::get).map(Object.class::cast).toList();
                if (!cards.isEmpty()) {
                    return cards.stream().anyMatch(PaymentDeletionService::flagOn);
                }
            }
            return flagOn(instituteSettingService.getSettingByInstituteIdAndKey(instituteId, TEACHER_SETTINGS_KEY));
        } catch (Exception e) {
            log.warn("canDelete({}, {}) failed, treating as not allowed: {}", userId, instituteId, e.getMessage());
            return false;
        }
    }

    private static boolean flagOn(Object settings) {
        if (!(settings instanceof Map<?, ?> map)) return false;
        Object section = map.get(LEARNER_MANAGEMENT);
        return section instanceof Map<?, ?> lm && Boolean.TRUE.equals(lm.get(ALLOW_DELETE_FLAG));
    }

    private static final String TURNED_OFF_MESSAGE = "Deleting payments and invoices is turned off for your role. "
            + "An admin can turn it on under Settings → Display Settings → Learner Management.";

    // ------------------------------------------------------------------ blocked attempts

    /**
     * A refused permanent delete leaves its own row in the admin activity log. The
     * {@code @Auditable} aspect records only successful calls, and for a destructive action the
     * attempt matters too: who tried, on what, and why it was refused. Written through the async
     * dispatcher, which commits in its own transaction, so the row survives the rollback of the
     * refused request. Action {@code DELETE_BLOCKED} — never {@code DELETE} — so the log can never
     * read as if the record had gone.
     */
    private void recordBlocked(String entityType, String entityId, String instituteId,
                               String userId, String reason, int httpStatus) {
        if (!StringUtils.hasText(instituteId)) return; // admin_activity_log.institute_id is NOT NULL
        try {
            auditDispatcher.dispatch(auditRow(entityType, entityId, instituteId, userId, "DELETE_BLOCKED",
                    "tried to permanently delete " + entityType.toLowerCase() + " " + entityId
                            + " — blocked: " + reason,
                    httpStatus, null));
        } catch (Exception e) {
            log.warn("Could not record blocked delete of {} {}: {}", entityType, entityId, e.getMessage());
        }
    }

    /**
     * The activity-log row for a delete that went through. Saved in the SAME transaction as the
     * delete, so the two stand or fall together: a permanent delete that could not be recorded does
     * not happen. The before-payload is the only surviving copy of what was deleted.
     */
    private void recordDeleted(String entityType, String entityId, String instituteId, String userId,
                               String description, Map<String, Object> snapshot) {
        String before;
        try {
            before = objectMapper.writeValueAsString(snapshot);
        } catch (Exception e) {
            before = String.valueOf(snapshot);
        }
        adminActivityLogRepository.save(auditRow(entityType, entityId, instituteId, userId, "DELETE",
                description, 200, before));
    }

    private static AdminActivityLog auditRow(String entityType, String entityId, String instituteId,
                                             String userId, String action, String description,
                                             int httpStatus, String beforePayload) {
        HttpServletRequest request = currentRequest();
        Object attr = request != null ? request.getAttribute("user") : null;
        CustomUserDetails user = attr instanceof CustomUserDetails u ? u : null;
        String forwarded = request != null ? request.getHeader("X-Forwarded-For") : null;
        return AdminActivityLog.builder()
                .instituteId(instituteId)
                .actorId(user != null ? user.getUserId() : userId)
                .actorName(cap(user != null ? user.getFullName() : null))
                .actorEmail(cap(user != null ? user.getUsername() : null))
                .entityType(entityType)
                .entityId(entityId)
                .action(action)
                .httpMethod(request != null ? request.getMethod() : "DELETE")
                .endpoint(cap(request != null ? request.getRequestURI() : null))
                .description(description)
                .beforePayload(beforePayload)
                .ipAddress(cap(StringUtils.hasText(forwarded) ? forwarded.split(",")[0].trim()
                        : request != null ? request.getRemoteAddr() : null))
                .userAgent(cap(request != null ? request.getHeader("User-Agent") : null))
                .responseStatus(httpStatus)
                .build();
    }

    /** The string columns are VARCHAR(512); a long user agent must not lose the row. */
    private static String cap(String value) {
        return value != null && value.length() > 500 ? value.substring(0, 500) : value;
    }

    private static HttpServletRequest currentRequest() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }

    // ------------------------------------------------------------------ payment

    @Transactional
    public Map<String, Object> deletePayment(String paymentLogId, String instituteId, String userId) {
        if (!StringUtils.hasText(instituteId)) throw new VacademyException("instituteId is required");
        if (!canDelete(userId, instituteId)) {
            recordBlocked("PAYMENT", paymentLogId, instituteId, userId, TURNED_OFF_MESSAGE, 403);
            throw new VacademyException(TURNED_OFF_MESSAGE);
        }
        try {
            return removePayment(paymentLogId, instituteId, userId);
        } catch (VacademyException e) {
            recordBlocked("PAYMENT", paymentLogId, instituteId, userId, e.getMessage(), 400);
            throw e;
        }
    }

    private Map<String, Object> removePayment(String paymentLogId, String instituteId, String userId) {
        paymentVoidService.assertNotSubOrgAdmin(userId);
        Map<String, Object> snapshot = paymentAuditSnapshot(paymentLogId);

        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new VacademyException("Payment not found: " + paymentLogId));
        String vendor = paymentLog.getVendor() != null ? paymentLog.getVendor().trim().toUpperCase() : "";
        if (!DELETABLE_VENDORS.contains(vendor)) {
            throw new VacademyException("Only offline or manually recorded payments can be deleted. "
                    + "An online payment has to be refunded through the payment gateway.");
        }
        String status = paymentLog.getPaymentStatus() != null ? paymentLog.getPaymentStatus().toUpperCase() : "";
        if (!"PAID".equals(status) && !PaymentVoidService.VOIDED.equals(status)) {
            throw new VacademyException("Only a paid or voided payment can be deleted (status: "
                    + paymentLog.getPaymentStatus() + ")");
        }
        if (countReferences("session_guest_registrations", "payment_log_id", paymentLogId) > 0
                || countReferences("user_plan_change_request", "payment_log_id", paymentLogId) > 0) {
            throw new VacademyException("This payment is linked to a live-class registration or a plan "
                    + "change and cannot be deleted. Void it instead.");
        }

        // 1. A payment that still counts is voided first — this also checks the institute and puts
        //    the installments, invoices and ledger right. A voided one is checked here instead.
        if ("PAID".equals(status)) {
            paymentVoidService.voidPayment(paymentLogId, instituteId, "Deleted permanently", userId);
        } else {
            paymentVoidService.assertBelongsToInstitute(paymentLog, instituteId);
        }

        // 2. Work out which invoices go with it: one generated FROM this payment that no other
        //    payment shares. A bill it had settled stays — the void already reopened it.
        entityManager.flush();
        List<String> invoicesToDelete = new ArrayList<>();
        List<String> deletedInvoices = new ArrayList<>();
        for (InvoicePaymentLogMapping mapping : invoicePaymentLogMappingRepository.findAllByPaymentLogId(paymentLogId)) {
            Invoice invoice = mapping.getInvoice();
            if (invoice == null || isBill(invoice.getSource())) continue;
            boolean shared = invoicePaymentLogMappingRepository.findByInvoiceId(invoice.getId()).stream()
                    .anyMatch(m -> m.getPaymentLog() != null && !paymentLogId.equals(m.getPaymentLog().getId()));
            if (!shared) {
                invoicesToDelete.add(invoice.getId());
                deletedInvoices.add(invoice.getInvoiceNumber() != null ? invoice.getInvoiceNumber() : invoice.getId());
            }
        }
        Object amount = paymentLog.getPaymentAmount();
        String currency = paymentLog.getCurrency();

        // 3. Remove the rows with plain SQL, children before parents. Deleting through JPA would
        //    trip UserPlan.paymentLogs (CascadeType.ALL): a loaded plan re-saves the payment.
        //    Everything the void changed was flushed above, so nothing pending is lost.
        //    The ledger credit and the reversal the void posted net to zero; both go.
        execute("DELETE FROM user_account_ledger WHERE reference_id = ?1 "
                + "AND event_type IN ('CREDIT_PAYMENT', 'CREDIT_REVERSAL')", paymentLogId);
        execute("DELETE FROM student_fee_allocation_ledger WHERE payment_log_id = ?1", paymentLogId);
        execute("DELETE FROM payment_log_line_item WHERE payment_log_id = ?1", paymentLogId);
        execute("DELETE FROM invoice_payment_log_mapping WHERE payment_log_id = ?1", paymentLogId);
        for (String invoiceId : invoicesToDelete) {
            removeInvoiceRows(invoiceId);
        }
        int removed = execute("DELETE FROM payment_log WHERE id = ?1", paymentLogId);
        if (removed != 1) {
            throw new VacademyException("Payment could not be deleted, nothing was changed");
        }
        // Drop the managed copies of rows that no longer exist.
        entityManager.clear();

        snapshot.put("invoices_deleted", deletedInvoices);
        recordDeleted("PAYMENT", paymentLogId, instituteId, userId,
                "permanently deleted payment of " + amount + " " + (currency != null ? currency : "")
                        + (deletedInvoices.isEmpty() ? "" : " and invoice(s) " + String.join(", ", deletedInvoices)),
                snapshot);
        log.info("[PaymentDelete] paymentLog={} amount={} institute={} deletedBy={} invoicesDeleted={}",
                paymentLogId, amount, instituteId, userId, deletedInvoices);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("payment_log_id", paymentLogId);
        result.put("amount", amount);
        result.put("currency", currency);
        result.put("invoices_deleted", deletedInvoices);
        return result;
    }

    // ------------------------------------------------------------------ invoice

    @Transactional
    public Map<String, Object> deleteInvoice(String invoiceId, String instituteId, String userId) {
        if (!StringUtils.hasText(instituteId)) throw new VacademyException("instituteId is required");
        if (!canDelete(userId, instituteId)) {
            recordBlocked("INVOICE", invoiceId, instituteId, userId, TURNED_OFF_MESSAGE, 403);
            throw new VacademyException(TURNED_OFF_MESSAGE);
        }
        try {
            return removeInvoice(invoiceId, instituteId, userId);
        } catch (VacademyException e) {
            recordBlocked("INVOICE", invoiceId, instituteId, userId, e.getMessage(), 400);
            throw e;
        }
    }

    private Map<String, Object> removeInvoice(String invoiceId, String instituteId, String userId) {
        paymentVoidService.assertNotSubOrgAdmin(userId);

        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        if (!instituteId.equals(invoice.getInstituteId())) {
            throw new VacademyException("Invoice does not belong to this institute");
        }
        if ("LIVE_SESSION".equals(invoice.getSource())
                || countReferences("session_guest_registrations", "invoice_id", invoiceId) > 0) {
            throw new VacademyException("A live-class invoice is tied to a registration and cannot be deleted. "
                    + "Cancel it instead.");
        }
        // Any linked payment that is not finished-and-dead (FAILED / VOIDED) blocks the delete: a
        // PAID one is money received, and a pending gateway checkout could still complete — its
        // webhook would then find no invoice and book the money as a donation.
        boolean hasLivePayment = invoicePaymentLogMappingRepository.findByInvoiceId(invoiceId).stream()
                .map(InvoicePaymentLogMapping::getPaymentLog)
                .anyMatch(pl -> pl != null && !Set.of("FAILED", PaymentVoidService.VOIDED)
                        .contains(pl.getPaymentStatus() != null ? pl.getPaymentStatus().toUpperCase() : ""));
        if (hasLivePayment || "PAID".equalsIgnoreCase(invoice.getStatus())) {
            throw new VacademyException("This invoice has a payment recorded or in progress against it. "
                    + "Delete or void that payment first, then delete the invoice.");
        }
        Map<String, Object> snapshot = invoiceAuditSnapshot(invoiceId);

        String number = invoice.getInvoiceNumber() != null ? invoice.getInvoiceNumber() : invoiceId;
        String source = invoice.getSource();

        // A bill carries its own obligation in the ledger (raised, and reversed if it was
        // cancelled); it goes with the bill. Credits belong to their payments and stay.
        entityManager.flush();
        if (isBill(source)) {
            execute("DELETE FROM user_account_ledger WHERE source_type = 'ADMIN_INVOICE' AND source_id = ?1 "
                    + "AND event_type IN ('DEBIT_ACCRUAL', 'DEBIT_REVERSAL')", invoiceId);
        }
        if (removeInvoiceRows(invoiceId) != 1) {
            throw new VacademyException("Invoice could not be deleted, nothing was changed");
        }
        entityManager.clear();

        recordDeleted("INVOICE", invoiceId, instituteId, userId, "permanently deleted invoice " + number, snapshot);
        log.info("[InvoiceDelete] invoice={} ({}) source={} institute={} deletedBy={}",
                invoiceId, number, source, instituteId, userId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("invoice_id", invoiceId);
        result.put("invoice_number", number);
        return result;
    }

    /**
     * An invoice and the rows hanging off it. Returns how many invoice rows were deleted.
     *
     * <p>Its number is recorded as released first (V531 {@code invoice_released_number}), so the
     * next invoice in the same series re-issues it instead of leaving a hole in the sequence.
     * Legacy invoices with no sequence position (pre-V432) have nothing to release.
     */
    private int removeInvoiceRows(String invoiceId) {
        execute("INSERT INTO invoice_released_number (institute_id, seq_scope_key, seq_no, invoice_number) "
                + "SELECT institute_id, seq_scope_key, seq_no, invoice_number FROM invoice "
                + "WHERE id = ?1 AND seq_no IS NOT NULL AND seq_scope_key IS NOT NULL "
                + "ON CONFLICT (institute_id, seq_scope_key, seq_no) DO NOTHING", invoiceId);
        execute("DELETE FROM invoice_line_item WHERE invoice_id = ?1", invoiceId);
        execute("DELETE FROM invoice_payment_log_mapping WHERE invoice_id = ?1", invoiceId);
        return execute("DELETE FROM invoice WHERE id = ?1", invoiceId);
    }

    private int execute(String sql, String id) {
        return entityManager.createNativeQuery(sql).setParameter(1, id).executeUpdate();
    }

    /** Rows in a table with no foreign key onto payments/invoices that still point at this id. */
    private long countReferences(String table, String column, String id) {
        Object n = entityManager
                .createNativeQuery("SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?1")
                .setParameter(1, id)
                .getSingleResult();
        return n instanceof Number num ? num.longValue() : 0L;
    }

    // ------------------------------------------------------------------ a course's whole history

    /**
     * What deleting one enrolment's payment history would remove. {@code blocker} is set when it
     * cannot be done, and says why; nothing is deleted then.
     */
    public record PlanHistory(int payments, BigDecimal paidAmount, int installments, int invoices,
                              String blocker) {}

    /** Plan payments that are offline/manual and settled — deleted one by one through {@link #removePayment}. */
    private static final String REMOVABLE_PAYMENTS = "SELECT id FROM payment_log WHERE user_plan_id = ?1 "
            + "AND UPPER(TRIM(COALESCE(vendor, ''))) IN ('MANUAL', 'OFFLINE') "
            + "AND UPPER(COALESCE(payment_status, '')) IN ('PAID', 'VOIDED')";

    /**
     * The invoices that belong to this enrolment and nothing else: its own plan invoice, invoices
     * of its installments, and receipts made from its payments. A bill an admin raised by hand is
     * not part of the course, and an invoice another enrolment's payment also points at is kept.
     */
    private static final String PLAN_INVOICES = "SELECT i.id FROM invoice i WHERE i.institute_id = ?2 AND ("
            + "(i.source = 'USER_PLAN' AND i.source_id = ?1) "
            + "OR (i.source = 'STUDENT_FEE_PAYMENT' AND i.source_id IN "
            + "(SELECT id FROM student_fee_payment WHERE user_plan_id = ?1)) "
            + "OR ((i.source IS NULL OR i.source NOT IN ('ADMIN_MANUAL', 'LIVE_SESSION')) AND EXISTS "
            + "(SELECT 1 FROM invoice_payment_log_mapping m JOIN payment_log pl ON pl.id = m.payment_log_id "
            + "WHERE m.invoice_id = i.id AND pl.user_plan_id = ?1))) "
            + "AND NOT EXISTS (SELECT 1 FROM invoice_payment_log_mapping m JOIN payment_log pl "
            + "ON pl.id = m.payment_log_id WHERE m.invoice_id = i.id "
            + "AND (pl.user_plan_id IS NULL OR pl.user_plan_id <> ?1))";

    /**
     * The other courses of this enrolment's admission package that are not being removed with it.
     * Only enrolments that still exist count.
     */
    private static final String PACKAGE_COURSES_LEFT_OUT = "SELECT COALESCE(p.package_name, apc.package_session_id) "
            + "FROM admission_package_course apc "
            + "JOIN admission_package_course mine ON mine.admission_package_id = apc.admission_package_id "
            + "AND mine.user_plan_id = :plan "
            + "LEFT JOIN package_session ps ON ps.id = apc.package_session_id "
            + "LEFT JOIN package p ON p.id = ps.package_id "
            + "WHERE apc.user_plan_id NOT IN (:together) "
            + "AND EXISTS (SELECT 1 FROM user_plan up WHERE up.id = apc.user_plan_id) "
            + "ORDER BY apc.position";

    /**
     * Receipts of this enrolment's payments that also cover a payment outside the enrolments being
     * removed. Bills raised by hand are not receipts: the void reopens them.
     */
    private static final String RECEIPTS_SHARED_OUTSIDE = "SELECT DISTINCT COALESCE(i.invoice_number, i.id) "
            + "FROM invoice i JOIN invoice_payment_log_mapping m ON m.invoice_id = i.id "
            + "JOIN payment_log pl ON pl.id = m.payment_log_id "
            + "WHERE pl.user_plan_id = :plan "
            + "AND (i.source IS NULL OR i.source NOT IN ('ADMIN_MANUAL', 'LIVE_SESSION')) "
            + "AND EXISTS (SELECT 1 FROM invoice_payment_log_mapping m2 JOIN payment_log pl2 "
            + "ON pl2.id = m2.payment_log_id WHERE m2.invoice_id = i.id "
            + "AND (pl2.user_plan_id IS NULL OR pl2.user_plan_id NOT IN (:together)))";

    /** Receipts of this enrolment's payments that also cover another of the enrolments removed with it. */
    private static final String RECEIPTS_SHARED_WITHIN = "SELECT DISTINCT i.id "
            + "FROM invoice i JOIN invoice_payment_log_mapping m ON m.invoice_id = i.id "
            + "JOIN payment_log pl ON pl.id = m.payment_log_id "
            + "WHERE pl.user_plan_id = :plan "
            + "AND (i.source IS NULL OR i.source NOT IN ('ADMIN_MANUAL', 'LIVE_SESSION')) "
            + "AND EXISTS (SELECT 1 FROM invoice_payment_log_mapping m2 JOIN payment_log pl2 "
            + "ON pl2.id = m2.payment_log_id WHERE m2.invoice_id = i.id "
            + "AND pl2.user_plan_id <> :plan AND pl2.user_plan_id IN (:together))";

    /**
     * Counts what {@link #deletePlanHistory} would remove and checks it can. Refused when real money
     * came in online (it has to be refunded in the gateway, the same rule as a single delete), or
     * when a referral reward, access pass, plan change or live-class registration still points at
     * the enrolment or one of its payments.
     *
     * <p>{@code removedTogether} are the enrolments deleted with this one (it included). An
     * admission package's courses share their receipts, so a package can only go as a whole: refused
     * while one of its courses is left out, and while a receipt also covers a payment of an
     * enrolment that stays.
     */
    public PlanHistory previewPlanHistory(String userPlanId, String instituteId, Collection<String> removedTogether) {
        Set<String> together = new HashSet<>(removedTogether);
        together.add(userPlanId);
        List<?> online = entityManager.createNativeQuery("SELECT COALESCE(vendor, 'UNKNOWN'), payment_amount "
                        + "FROM payment_log WHERE user_plan_id = ?1 AND UPPER(COALESCE(payment_status, '')) = 'PAID' "
                        + "AND UPPER(TRIM(COALESCE(vendor, ''))) NOT IN ('MANUAL', 'OFFLINE')")
                .setParameter(1, userPlanId).getResultList();
        String blocker = null;
        if (!online.isEmpty()) {
            Object[] first = (Object[]) online.get(0);
            blocker = online.size() + " online payment(s) (" + first[0] + " " + first[1]
                    + (online.size() > 1 ? ", …" : "") + ") were made for this course. Online payments cannot "
                    + "be deleted — refund them through the payment gateway, or remove the course without "
                    + "deleting the payment history.";
        } else if (countPlanReferences("referral_benefit_logs", userPlanId) > 0
                || countPlanReferences("access_pass_grant", userPlanId) > 0
                || countPlanReferences("user_plan_change_request", userPlanId) > 0
                // removePayment refuses these too; caught here so nothing is terminated first
                || count("SELECT COUNT(*) FROM user_plan_change_request WHERE payment_log_id IN "
                        + "(SELECT id FROM payment_log WHERE user_plan_id = ?1)", userPlanId) > 0) {
            blocker = "This course is linked to a referral reward, access pass or plan change, "
                    + "so its payment history cannot be deleted. Remove the course without deleting it.";
        } else if (count("SELECT COUNT(*) FROM session_guest_registrations WHERE payment_log_id IN "
                + "(SELECT id FROM payment_log WHERE user_plan_id = ?1)", userPlanId) > 0) {
            blocker = "A payment of this course is linked to a live-class registration, so the payment history "
                    + "cannot be deleted. Remove the course without deleting it.";
        } else {
            List<String> leftOut = names(PACKAGE_COURSES_LEFT_OUT, userPlanId, together);
            if (!leftOut.isEmpty()) {
                blocker = "This course is part of an admission package. Its payment history can only be deleted "
                        + "together with the whole package — also select " + String.join(", ", leftOut)
                        + ", or remove the course without deleting the payment history.";
            } else {
                List<String> shared = names(RECEIPTS_SHARED_OUTSIDE, userPlanId, together);
                if (!shared.isEmpty()) {
                    blocker = "Receipt " + String.join(", ", shared) + " of this course also covers a payment "
                            + "of another course, so its payment history cannot be deleted on its own. "
                            + "Remove the course without deleting the payment history.";
                }
            }
        }
        Object paid = entityManager.createNativeQuery("SELECT COALESCE(SUM(payment_amount), 0) FROM payment_log "
                        + "WHERE user_plan_id = ?1 AND UPPER(COALESCE(payment_status, '')) = 'PAID'")
                .setParameter(1, userPlanId).getSingleResult();
        int invoices = entityManager.createNativeQuery(PLAN_INVOICES)
                .setParameter(1, userPlanId).setParameter(2, instituteId).getResultList().size()
                // + the package receipts it shares with the courses removed with it
                + names(RECEIPTS_SHARED_WITHIN, userPlanId, together).size();
        return new PlanHistory(
                (int) count("SELECT COUNT(*) FROM payment_log WHERE user_plan_id = ?1", userPlanId),
                paid instanceof Number n ? BigDecimal.valueOf(n.doubleValue()) : BigDecimal.ZERO,
                (int) count("SELECT COUNT(*) FROM student_fee_payment WHERE user_plan_id = ?1", userPlanId),
                invoices, blocker);
    }

    /**
     * Removes everything money-related about one enrolment, so it shows nowhere — the learner's
     * Payment History tab, Manage Payments, invoices, the ledger: its payments, installments,
     * invoices, ledger rows and finally the plan itself. Called when an admin hard-terminates a
     * course and ticks "delete payment history"; the access side (the INVITED mapping that lets the
     * learner be enrolled again) is left alone, only its pointer to the deleted plan is cleared.
     *
     * <p>Same permission and the same refusals as a single payment delete, all or nothing: each
     * settled payment goes through {@link #removePayment} (void first, so a bill it paid is reopened,
     * and its own DELETE row in the activity log), then the rest is removed with plain SQL,
     * children before parents. A DELETE row for the plan carries a snapshot of it.
     *
     * <p>{@code removedTogether} are the enrolments removed in the same transaction (see
     * {@link #previewPlanHistory}). A receipt they share goes with the last of them: until then
     * another payment still holds it.
     */
    @Transactional
    public Map<String, Object> deletePlanHistory(String userPlanId, String instituteId, String userId,
                                                 Collection<String> removedTogether) {
        if (!StringUtils.hasText(instituteId)) throw new VacademyException("instituteId is required");
        if (!canDelete(userId, instituteId)) {
            recordBlocked("USER_PLAN", userPlanId, instituteId, userId, TURNED_OFF_MESSAGE, 403);
            throw new VacademyException(TURNED_OFF_MESSAGE);
        }
        try {
            return removePlanHistory(userPlanId, instituteId, userId, removedTogether);
        } catch (VacademyException e) {
            recordBlocked("USER_PLAN", userPlanId, instituteId, userId, e.getMessage(), 400);
            throw e;
        }
    }

    private Map<String, Object> removePlanHistory(String userPlanId, String instituteId, String userId,
                                                  Collection<String> removedTogether) {
        paymentVoidService.assertNotSubOrgAdmin(userId);
        PlanHistory history = previewPlanHistory(userPlanId, instituteId, removedTogether);
        if (history.blocker() != null) throw new VacademyException(history.blocker());
        Map<String, Object> snapshot = planAuditSnapshot(userPlanId);
        if (snapshot.isEmpty()) throw new VacademyException("Enrolment plan not found: " + userPlanId);

        // 1. Settled offline/manual payments, one by one (each voids first and logs its own DELETE).
        entityManager.flush();
        List<?> settled = entityManager.createNativeQuery(REMOVABLE_PAYMENTS)
                .setParameter(1, userPlanId).getResultList();
        for (Object id : settled) {
            removePayment(String.valueOf(id), instituteId, userId);
        }

        // 2. Invoices of this enrolment that are still there, then the payments that never
        //    settled (pending / failed checkouts — no money) and what hangs off them.
        List<String> invoiceIds = entityManager.createNativeQuery(PLAN_INVOICES)
                .setParameter(1, userPlanId).setParameter(2, instituteId).getResultList()
                .stream().map(String::valueOf).toList();
        String planLogs = "(SELECT id FROM payment_log WHERE user_plan_id = ?1)";
        execute("DELETE FROM user_account_ledger WHERE reference_id IN " + planLogs, userPlanId);
        execute("DELETE FROM student_fee_allocation_ledger WHERE payment_log_id IN " + planLogs, userPlanId);
        execute("DELETE FROM payment_log_line_item WHERE payment_log_id IN " + planLogs, userPlanId);
        execute("DELETE FROM invoice_payment_log_mapping WHERE payment_log_id IN " + planLogs, userPlanId);
        for (String invoiceId : invoiceIds) {
            execute("DELETE FROM user_account_ledger WHERE invoice_id = ?1", invoiceId);
            removeInvoiceRows(invoiceId);
        }

        // 3. The ledger rows booked against the plan and its installments (accruals, discounts,
        //    splits, the cancellation reversal), then the installments themselves.
        String planBills = "(SELECT id FROM student_fee_payment WHERE user_plan_id = ?1)";
        execute("DELETE FROM user_account_ledger WHERE source_id = ?1 OR source_id IN " + planBills, userPlanId);
        execute("UPDATE student_fee_payment SET current_adjustment_history_id = NULL WHERE user_plan_id = ?1",
                userPlanId);
        execute("DELETE FROM student_fee_adjustment_history WHERE student_fee_payment_id IN " + planBills,
                userPlanId);
        execute("DELETE FROM student_fee_allocation_ledger WHERE student_fee_payment_id IN " + planBills,
                userPlanId);
        int installments = execute("DELETE FROM student_fee_payment WHERE user_plan_id = ?1", userPlanId);
        int unsettledPayments = execute("DELETE FROM payment_log WHERE user_plan_id = ?1", userPlanId);

        // 4. The plan. Rows that only point at it (enrolment mappings, access log, referral link)
        //    lose the pointer; the blocking references were refused in the preview.
        execute("UPDATE student_session_institute_group_mapping SET user_plan_id = NULL WHERE user_plan_id = ?1",
                userPlanId);
        execute("UPDATE learner_access_log SET user_plan_id = NULL WHERE user_plan_id = ?1", userPlanId);
        execute("UPDATE referral_mapping SET user_plan_id = NULL WHERE user_plan_id = ?1", userPlanId);
        // Its place in an admission package (the preview made sure the rest of the package goes in
        // this transaction too); the package itself goes with its last course.
        List<?> packages = entityManager.createNativeQuery(
                        "SELECT admission_package_id FROM admission_package_course WHERE user_plan_id = ?1")
                .setParameter(1, userPlanId).getResultList();
        execute("DELETE FROM admission_package_course WHERE user_plan_id = ?1", userPlanId);
        for (Object packageId : packages) {
            execute("DELETE FROM admission_package WHERE id = ?1 AND NOT EXISTS "
                    + "(SELECT 1 FROM admission_package_course WHERE admission_package_id = ?1)", String.valueOf(packageId));
        }
        if (execute("DELETE FROM user_plan WHERE id = ?1", userPlanId) != 1) {
            throw new VacademyException("Payment history could not be deleted, nothing was changed");
        }
        entityManager.clear();

        snapshot.put("payments_deleted", settled.size() + unsettledPayments);
        snapshot.put("paid_amount_deleted", history.paidAmount());
        snapshot.put("installments_deleted", installments);
        snapshot.put("invoices_deleted", invoiceIds.size());
        recordDeleted("USER_PLAN", userPlanId, instituteId, userId,
                "permanently deleted the payment history of a removed course: " + (settled.size() + unsettledPayments)
                        + " payment(s) worth " + history.paidAmount() + ", " + installments + " installment(s)",
                snapshot);
        log.info("[PlanHistoryDelete] userPlan={} institute={} deletedBy={} payments={} installments={}",
                userPlanId, instituteId, userId, settled.size() + unsettledPayments, installments);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user_plan_id", userPlanId);
        result.put("payments_deleted", settled.size() + unsettledPayments);
        result.put("paid_amount_deleted", history.paidAmount());
        result.put("installments_deleted", installments);
        return result;
    }

    /**
     * The enrolments whose payment history can only be deleted together with this one: the other
     * courses of its admission package, and enrolments whose payments share a receipt with its.
     */
    public List<String> linkedPlans(String userPlanId) {
        return entityManager.createNativeQuery("SELECT apc.user_plan_id FROM admission_package_course apc "
                        + "JOIN admission_package_course mine ON mine.admission_package_id = apc.admission_package_id "
                        + "AND mine.user_plan_id = ?1 WHERE apc.user_plan_id <> ?1 "
                        + "UNION SELECT pl2.user_plan_id FROM payment_log pl "
                        + "JOIN invoice_payment_log_mapping m ON m.payment_log_id = pl.id "
                        + "JOIN invoice i ON i.id = m.invoice_id "
                        + "JOIN invoice_payment_log_mapping m2 ON m2.invoice_id = i.id "
                        + "JOIN payment_log pl2 ON pl2.id = m2.payment_log_id "
                        + "WHERE pl.user_plan_id = ?1 AND pl2.user_plan_id <> ?1 "
                        + "AND (i.source IS NULL OR i.source NOT IN ('ADMIN_MANUAL', 'LIVE_SESSION'))")
                .setParameter(1, userPlanId).getResultList()
                .stream().map(String::valueOf).toList();
    }

    private List<String> names(String sql, String userPlanId, Collection<String> together) {
        return entityManager.createNativeQuery(sql)
                .setParameter("plan", userPlanId).setParameter("together", List.copyOf(together)).getResultList()
                .stream().map(String::valueOf).toList();
    }

    private long countPlanReferences(String table, String userPlanId) {
        return count("SELECT COUNT(*) FROM " + table + " WHERE user_plan_id = ?1", userPlanId);
    }

    private long count(String sql, String id) {
        Object n = entityManager.createNativeQuery(sql).setParameter(1, id).getSingleResult();
        return n instanceof Number num ? num.longValue() : 0L;
    }

    private Map<String, Object> planAuditSnapshot(String userPlanId) {
        Map<String, Object> snap = new LinkedHashMap<>();
        List<?> rows = entityManager.createNativeQuery("SELECT id, user_id, status, enroll_invite_id, "
                        + "payment_option_id, plan_id, created_at, start_date, end_date FROM user_plan WHERE id = ?1")
                .setParameter(1, userPlanId).getResultList();
        if (rows.isEmpty()) return snap;
        Object[] r = (Object[]) rows.get(0);
        String[] keys = {"id", "user_id", "status", "enroll_invite_id", "payment_option_id", "plan_id",
                "created_at", "start_date", "end_date"};
        for (int i = 0; i < keys.length; i++) {
            snap.put(keys[i], r[i] != null ? String.valueOf(r[i]) : null);
        }
        return snap;
    }

    // ------------------------------------------------------------------ audit

    /** What is about to be deleted — stored as the activity log's before-payload. */
    public Map<String, Object> paymentAuditSnapshot(String paymentLogId) {
        Map<String, Object> snap = new LinkedHashMap<>();
        paymentLogRepository.findById(paymentLogId).ifPresent(pl -> {
            snap.put("id", pl.getId());
            snap.put("user_id", pl.getUserId());
            snap.put("amount", pl.getPaymentAmount());
            snap.put("currency", pl.getCurrency());
            snap.put("vendor", pl.getVendor());
            snap.put("payment_status", pl.getPaymentStatus());
            snap.put("date", pl.getDate());
            snap.put("user_plan_id", pl.getUserPlan() != null ? pl.getUserPlan().getId() : null);
            snap.put("payment_specific_data", pl.getPaymentSpecificData());
        });
        return snap;
    }

    public Map<String, Object> invoiceAuditSnapshot(String invoiceId) {
        Map<String, Object> snap = new LinkedHashMap<>();
        invoiceRepository.findById(invoiceId).ifPresent(inv -> {
            snap.put("id", inv.getId());
            snap.put("invoice_number", inv.getInvoiceNumber());
            snap.put("user_id", inv.getUserId());
            snap.put("status", inv.getStatus());
            snap.put("source", inv.getSource());
            snap.put("total_amount", inv.getTotalAmount());
            snap.put("currency", inv.getCurrency());
            snap.put("invoice_date", inv.getInvoiceDate());
        });
        return snap;
    }
}
