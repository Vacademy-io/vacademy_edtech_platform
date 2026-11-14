package vacademy.io.admin_core_service.features.user_account.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_account.dto.UserAccountLedgerEntryDTO;
import vacademy.io.admin_core_service.features.user_account.dto.UserAccountSummaryDTO;
import vacademy.io.admin_core_service.features.user_account.entity.UserAccountLedger;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;

import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserAccountLedgerService {

    private final UserAccountLedgerRepository repository;
    private final InvoiceRepository invoiceRepository;
    private final PaymentLogRepository paymentLogRepository;

    // ── public event-recording API ────────────────────────────────────────────

    /** Called when a new payment obligation is created. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordDebitAccrual(String userId, String instituteId,
                                   BigDecimal amount, String currency,
                                   LocalDate dueDate,
                                   String sourceType, String sourceId,
                                   String invoiceId, String remarks) {
        recordDebitAccrual(userId, instituteId, amount, currency, dueDate,
                sourceType, sourceId, invoiceId, remarks, null, null);
    }

    /**
     * Discounted-obligation variant: {@code amount} is the NET the learner owes;
     * {@code grossAmount}/{@code discountAmount} carry the list price and the
     * coupon/discount so the transaction line can render the breakdown
     * (gross struck through → net). Pass nulls when no discount applies.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordDebitAccrual(String userId, String instituteId,
                                   BigDecimal amount, String currency,
                                   LocalDate dueDate,
                                   String sourceType, String sourceId,
                                   String invoiceId, String remarks,
                                   BigDecimal grossAmount, BigDecimal discountAmount) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        save(userId, instituteId, "DEBIT_ACCRUAL", amount, currency,
                dueDate, sourceType, sourceId, invoiceId, null, remarks,
                grossAmount, discountAmount);
    }

    /**
     * Reverses an obligation that was voided before any money moved — a cancelled admin
     * invoice, a duplicated accrual. Nets out of "total accrued" rather than counting as a
     * credit: the learner never owed it and never paid it, so booking it as a CREDIT_*
     * (which is what the invoice-reject path did) both left the accrual standing at its
     * full amount and reported the void as money received.
     *
     * @param dueDate the ORIGINAL obligation's due date, so the reversal cancels it out of
     *                the past-due bucket as well as the total
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordDebitReversal(String userId, String instituteId,
                                    BigDecimal amount, String currency,
                                    LocalDate dueDate,
                                    String sourceType, String sourceId,
                                    String invoiceId, String remarks) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        save(userId, instituteId, "DEBIT_REVERSAL", amount, currency,
                dueDate, sourceType, sourceId, invoiceId, null, remarks);
    }

    /**
     * Called when a payment is confirmed (gateway success or manual offline).
     *
     * <p>Idempotent on {@code paymentLogId}: the same payment can reach us from more than
     * one place (the SCHOOL webhook and the enrollment-confirmation path both observe the
     * same PaymentLog), and crediting it twice halves the learner's reported balance.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordCreditPayment(String userId, String instituteId,
                                    BigDecimal amount, String currency,
                                    String sourceType, String sourceId,
                                    String paymentLogId, String invoiceId, String remarks) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        if (paymentLogId != null
                && repository.existsByReferenceIdAndEventType(paymentLogId, "CREDIT_PAYMENT")) {
            log.debug("Skipping duplicate CREDIT_PAYMENT for paymentLog={} (user={})", paymentLogId, userId);
            return;
        }
        save(userId, instituteId, "CREDIT_PAYMENT", amount, currency,
                null, sourceType, sourceId, invoiceId, paymentLogId, remarks);
    }

    /**
     * An obligation raised and settled in the same instant — a subscription renewal, where
     * the learner is charged for the next period with no prior pending bill to match against.
     *
     * <p>Posts BOTH halves: the {@code DEBIT_ACCRUAL} for what was billed and the
     * {@code CREDIT_PAYMENT} for what was collected. Crediting alone would inflate Total Paid
     * against an accrual that was never raised (renewals reuse the same UserPlan, so
     * {@code createUserPlan}'s accrual does not fire again) and drive the balance negative;
     * skipping both — which is what renewals did — kept the balance right by accident while
     * leaving every renewal invisible in the Transaction History and understating the
     * learner's lifetime billing.
     *
     * <p>Both rows carry the PaymentLog in {@code reference_id} and are idempotent on it, so
     * a retried webhook re-posts neither. Accrual and payment land together or not at all.
     *
     * @param dueDate when the charge fell due, or null for an immediate charge
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordSettledCharge(String userId, String instituteId,
                                    BigDecimal amount, String currency,
                                    LocalDate dueDate,
                                    String sourceType, String sourceId,
                                    String paymentLogId, String remarks) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        if (paymentLogId != null
                && repository.existsByReferenceIdAndEventType(paymentLogId, "DEBIT_ACCRUAL")) {
            log.debug("Skipping duplicate settled charge for paymentLog={} (user={})", paymentLogId, userId);
            return;
        }
        // reference_id normally carries the PaymentLog on CREDIT rows only; putting it on the
        // accrual too is what makes this pair replay-safe.
        save(userId, instituteId, "DEBIT_ACCRUAL", amount, currency,
                dueDate, sourceType, sourceId, null, paymentLogId, remarks);
        // The payment may already have been credited through another path (e.g. the
        // plan-payment credit) — never book the same money twice.
        if (paymentLogId != null
                && repository.existsByReferenceIdAndEventType(paymentLogId, "CREDIT_PAYMENT")) {
            return;
        }
        save(userId, instituteId, "CREDIT_PAYMENT", amount, currency,
                null, sourceType, sourceId, null, paymentLogId, remarks);
    }

    /** Called when a full fee waiver is granted. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordCreditWaiver(String userId, String instituteId,
                                   BigDecimal amount, String currency,
                                   String sourceType, String sourceId,
                                   String adjustmentHistoryId, String remarks) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        save(userId, instituteId, "CREDIT_WAIVER", amount, currency,
                null, sourceType, sourceId, null, adjustmentHistoryId, remarks);
    }

    /** Called when a partial concession is applied. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordCreditAdjustment(String userId, String instituteId,
                                       BigDecimal amount, String currency,
                                       String sourceType, String sourceId,
                                       String adjustmentHistoryId, String remarks) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        save(userId, instituteId, "CREDIT_ADJUSTMENT", amount, currency,
                null, sourceType, sourceId, null, adjustmentHistoryId, remarks);
    }

    /** Called when a penalty is added to a fee bill. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordDebitPenalty(String userId, String instituteId,
                                   BigDecimal amount, String currency,
                                   String sourceType, String sourceId,
                                   String adjustmentHistoryId, String remarks) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) return;
        save(userId, instituteId, "DEBIT_PENALTY", amount, currency,
                null, sourceType, sourceId, null, adjustmentHistoryId, remarks);
    }

    /**
     * Takes a voided payment back out of "total paid": one CREDIT_REVERSAL per CREDIT_PAYMENT
     * that was booked for the payment log, same amount, same source.
     *
     * <p>Unlike the recorders above this joins the CALLER's transaction and lets failures
     * propagate. A void is all-or-nothing: a reversal that survived a rolled-back void would
     * understate what the learner has paid, and one that silently failed would leave the
     * voided money counted as received. Idempotent on the payment log.
     *
     * @return the amount reversed (zero when nothing had been credited or it was already done)
     */
    @Transactional
    public BigDecimal reverseCreditsForVoidedPayment(String paymentLogId, String remarks) {
        if (paymentLogId == null || repository.existsByReferenceIdAndEventType(paymentLogId, "CREDIT_REVERSAL")) {
            return BigDecimal.ZERO;
        }
        BigDecimal total = BigDecimal.ZERO;
        for (UserAccountLedger credit : repository.findByReferenceIdAndEventType(paymentLogId, "CREDIT_PAYMENT")) {
            repository.save(UserAccountLedger.builder()
                    .userId(credit.getUserId())
                    .instituteId(credit.getInstituteId())
                    .eventType("CREDIT_REVERSAL")
                    .amount(credit.getAmount())
                    .currency(credit.getCurrency())
                    .sourceType(credit.getSourceType())
                    .sourceId(credit.getSourceId())
                    .invoiceId(credit.getInvoiceId())
                    .referenceId(paymentLogId)
                    .remarks(remarks)
                    .build());
            total = total.add(credit.getAmount());
        }
        return total;
    }

    // ── read API ──────────────────────────────────────────────────────────────

    public UserAccountSummaryDTO getSummary(String userId, String instituteId) {
        BigDecimal totalAccrued = repository.sumDebits(userId, instituteId);
        BigDecimal totalPaid    = repository.sumCredits(userId, instituteId);
        BigDecimal pastDue      = repository.sumPastDueDebits(userId, instituteId);

        // Supplement with admin invoices that pre-date the ledger integration
        // (invoices with no corresponding DEBIT_ACCRUAL entry yet)
        BigDecimal extraAccruals = invoiceRepository.sumUnledgeredAdminInvoiceAccruals(userId, instituteId);
        BigDecimal extraPayments = invoiceRepository.sumUnledgeredAdminInvoicePayments(userId, instituteId);
        if (extraAccruals != null) totalAccrued = totalAccrued.add(extraAccruals);
        if (extraPayments != null) totalPaid    = totalPaid.add(extraPayments);

        // Same for fee plans that pre-date the ledger (migrated installments): their ledger
        // rows are only the new payments and discount/split deltas, so they are swapped for
        // the installment figures. Left alone, one recorded payment showed Accrued 0 / Due 0.
        // Only once the learner HAS ledger rows: with an empty ledger the summary stays zero
        // and the payment-history screen keeps building it from the invoice list, as before.
        if (repository.existsByUserIdAndInstituteId(userId, instituteId)) {
            List<Object[]> preLedgerRows = repository.sumPreLedgerFeePlans(userId, instituteId);
            if (preLedgerRows != null && !preLedgerRows.isEmpty() && preLedgerRows.get(0) != null) {
                Object[] r = preLedgerRows.get(0);
                totalAccrued = totalAccrued.add(num(r[0]).subtract(num(r[3])));
                totalPaid    = totalPaid.add(num(r[1]).subtract(num(r[4])));
                pastDue      = pastDue.add(num(r[2]).subtract(num(r[5])));
            }
        }

        // Reversals can push a net figure below zero when an obligation was voided after
        // the money had already been recognised elsewhere — never report a negative total.
        totalAccrued = totalAccrued.max(BigDecimal.ZERO);
        BigDecimal balance = totalAccrued.subtract(totalPaid).max(BigDecimal.ZERO);

        // Past Due = the still-unsettled slice of what was already due. Allocation is
        // oldest-first everywhere in the product, so collected money retires past-due
        // obligations before upcoming ones; and it can never exceed the whole balance.
        BigDecimal overdue = pastDue.subtract(totalPaid).max(BigDecimal.ZERO).min(balance);

        return UserAccountSummaryDTO.builder()
                .userId(userId)
                .instituteId(instituteId)
                .totalAccrued(totalAccrued)
                .totalPaid(totalPaid)
                .balance(balance)
                .overdue(overdue)
                .currency(resolveLedgerCurrency(userId, instituteId))
                .build();
    }

    /**
     * Currency to report the summary in: whatever this learner's most recent ledger entry was
     * booked in. INR only when the ledger is empty, in which case every figure is zero anyway.
     */
    private String resolveLedgerCurrency(String userId, String instituteId) {
        try {
            List<String> currencies = repository.findLedgerCurrencies(
                    userId, instituteId, PageRequest.of(0, 1));
            if (!currencies.isEmpty() && currencies.get(0) != null && !currencies.get(0).isBlank()) {
                return currencies.get(0).trim().toUpperCase();
            }
        } catch (Exception e) {
            log.warn("Could not resolve ledger currency for user {} institute {}: {}",
                    userId, instituteId, e.getMessage());
        }
        return "INR";
    }

    /** A native-query number column as BigDecimal (Postgres numeric arrives as BigDecimal). */
    private static BigDecimal num(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        return new BigDecimal(v.toString());
    }

    public Page<UserAccountLedgerEntryDTO> getLedger(String userId, String instituteId, Pageable pageable) {
        Page<UserAccountLedger> page = repository
                .findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId, pageable);
        Map<String, PaymentLog> paymentLogs = paymentLogsBehindCredits(page.getContent());
        return page.map(entry -> {
            UserAccountLedgerEntryDTO dto = toDTO(entry);
            PaymentLog paymentLog = "CREDIT_PAYMENT".equals(entry.getEventType())
                    ? paymentLogs.get(entry.getReferenceId())
                    : null;
            if (paymentLog != null) {
                dto.setPaymentStatus(paymentLog.getPaymentStatus());
                dto.setPaymentVendor(paymentLog.getVendor());
            }
            return dto;
        });
    }

    /** One batched lookup for the page — best-effort, the ledger renders without it. */
    private Map<String, PaymentLog> paymentLogsBehindCredits(List<UserAccountLedger> entries) {
        try {
            Set<String> ids = entries.stream()
                    .filter(e -> "CREDIT_PAYMENT".equals(e.getEventType()) && e.getReferenceId() != null)
                    .map(UserAccountLedger::getReferenceId)
                    .collect(Collectors.toSet());
            if (ids.isEmpty()) return Map.of();
            return paymentLogRepository.findAllById(ids).stream()
                    .collect(Collectors.toMap(PaymentLog::getId, pl -> pl, (a, b) -> a));
        } catch (Exception e) {
            log.warn("Could not load payment logs behind ledger credits: {}", e.getMessage());
            return Map.of();
        }
    }

    // ── private ───────────────────────────────────────────────────────────────

    private void save(String userId, String instituteId, String eventType,
                      BigDecimal amount, String currency, LocalDate dueDate,
                      String sourceType, String sourceId,
                      String invoiceId, String referenceId, String remarks) {
        save(userId, instituteId, eventType, amount, currency, dueDate,
                sourceType, sourceId, invoiceId, referenceId, remarks, null, null);
    }

    private void save(String userId, String instituteId, String eventType,
                      BigDecimal amount, String currency, LocalDate dueDate,
                      String sourceType, String sourceId,
                      String invoiceId, String referenceId, String remarks,
                      BigDecimal grossAmount, BigDecimal discountAmount) {
        try {
            UserAccountLedger entry = UserAccountLedger.builder()
                    .userId(userId)
                    .instituteId(instituteId)
                    .eventType(eventType)
                    .amount(amount)
                    .currency(currency != null ? currency : "INR")
                    .dueDate(dueDate)
                    .sourceType(sourceType)
                    .sourceId(sourceId)
                    .invoiceId(invoiceId)
                    .referenceId(referenceId)
                    .remarks(remarks)
                    .grossAmount(grossAmount)
                    .discountAmount(discountAmount)
                    .build();
            repository.save(entry);
        } catch (Exception e) {
            // Never let ledger writes fail the calling transaction
            log.error("Failed to write user_account_ledger entry [{}] for user={} institute={}: {}",
                    eventType, userId, instituteId, e.getMessage(), e);
        }
    }

    private UserAccountLedgerEntryDTO toDTO(UserAccountLedger e) {
        return UserAccountLedgerEntryDTO.builder()
                .id(e.getId())
                .eventType(e.getEventType())
                .amount(e.getAmount())
                .currency(e.getCurrency())
                .dueDate(e.getDueDate())
                .sourceType(e.getSourceType())
                .sourceId(e.getSourceId())
                .invoiceId(e.getInvoiceId())
                .referenceId(e.getReferenceId())
                .remarks(e.getRemarks())
                .createdAt(e.getCreatedAt())
                .grossAmount(e.getGrossAmount())
                .discountAmount(e.getDiscountAmount())
                .build();
    }
}
