package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierLedgerType;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The only writer of {@code commerce_supplier_ledger}.
 *
 * <p>One idempotency key is one row per institute, forever. A repeat with the same content is
 * answered with the first row and writes nothing; a repeat with other content is refused (409
 * {@code IDEMPOTENCY_KEY_REUSED}); a post inside a transaction that rolls back leaves nothing, so
 * the key can be used again. The insert is {@code ON CONFLICT DO NOTHING}, not a caught unique
 * violation, so the caller's transaction stays usable and a concurrent insert of the same key is
 * waited for before deciding.
 *
 * <p>Every post locks the supplier row first ({@code SELECT ... FOR UPDATE}): posts to one supplier
 * run one after another, which makes the reversal arithmetic safe. A caller that also locks
 * supplier documents must lock the supplier before them. The period lock is not checked here; the
 * document service asks it with the document's date before posting.
 */
@Service
public class SupplierLedgerService {

    /** {@code KIND:<rest>}: 2-20 capitals or underscores, a colon, then 1-79 safe characters. */
    static final Pattern KEY = Pattern.compile("^[A-Z_]{2,20}:[A-Za-z0-9:._-]{1,79}$");
    static final BigDecimal MAX_AMOUNT = new BigDecimal("9999999999.99");
    private static final int MAX_KEY = 100;

    private final CommerceSupplierLedgerRepository ledgerRepository;
    private final CommerceSupplierRepository supplierRepository;

    public SupplierLedgerService(CommerceSupplierLedgerRepository ledgerRepository,
                                 CommerceSupplierRepository supplierRepository) {
        this.ledgerRepository = ledgerRepository;
        this.supplierRepository = supplierRepository;
    }

    /**
     * Writes one ledger row, or answers the row an earlier post with the same key wrote.
     * MANDATORY: the row commits or rolls back with the document that caused it.
     *
     * @throws InvalidRequestException 400 VALIDATION for a malformed post (sign, places, key shape, lengths)
     * @throws VacademyException       404 NOT_FOUND when the supplier is not one of the institute's
     * @throws ConflictException       409 INVALID_REVERSAL or IDEMPOTENCY_KEY_REUSED
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public SupplierLedgerResult post(SupplierLedgerPost p) {
        BigDecimal amount = validate(p);
        String inst = p.instituteId();

        if (supplierRepository.lockForPosting(inst, p.supplierId()).isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "NOT_FOUND: no such supplier");
        }

        // A repeat is answered before the reversal arithmetic, which would count the first row.
        Optional<CommerceSupplierLedgerEntry> earlier =
                ledgerRepository.findByInstituteIdAndIdempotencyKey(inst, p.idempotencyKey());
        if (earlier.isPresent()) {
            return repeat(earlier.get(), p, amount);
        }

        if (p.reversesEntryId() != null) {
            checkReversal(p, amount);
        }

        String id = UUID.randomUUID().toString();
        int inserted = ledgerRepository.insertIfAbsent(id, inst, p.supplierId(), p.bookDate(), p.type().name(),
                amount, p.referenceType(), p.referenceId(), p.documentNumber(), p.locationId(), p.note(),
                p.actorUserId(), p.reversesEntryId(), p.idempotencyKey());
        if (inserted == 1) {
            CommerceSupplierLedgerEntry entry = ledgerRepository.findByInstituteIdAndId(inst, id)
                    .orElseThrow(() -> new IllegalStateException("supplier ledger: inserted row not found"));
            return new SupplierLedgerResult(entry, true);
        }
        // The key was taken by a post that committed while this one waited (another supplier's lock).
        CommerceSupplierLedgerEntry first = ledgerRepository.findByInstituteIdAndIdempotencyKey(inst, p.idempotencyKey())
                .orElseThrow(() -> new IllegalStateException("supplier ledger: key taken but row not found"));
        return repeat(first, p, amount);
    }

    // ------------------------------------------------------------------ rules

    /** The pure checks; answers the amount with two places. */
    static BigDecimal validate(SupplierLedgerPost p) {
        if (p == null) {
            throw invalid("the ledger post is required");
        }
        requireText(p.instituteId(), "institute_id", 36);
        requireText(p.supplierId(), "supplier_id", 36);
        if (p.bookDate() == null) {
            throw invalid("book_date is required");
        }
        if (p.type() == null) {
            throw invalid("type is required");
        }
        if (p.amount() == null) {
            throw invalid("amount is required");
        }
        String key = p.idempotencyKey();
        if (key == null || key.isBlank()) {
            throw invalid("idempotency_key is required");
        }
        if (key.length() > MAX_KEY || !KEY.matcher(key).matches()) {
            throw invalid("idempotency_key must look like KIND:<id> (letters, digits and : . _ -)");
        }
        BigDecimal amount = p.amount();
        if (amount.signum() == 0) {
            throw invalid("amount cannot be zero");
        }
        if (amount.stripTrailingZeros().scale() > 2) {
            throw invalid("amount has more than two decimal places");
        }
        if (amount.abs().compareTo(MAX_AMOUNT) > 0) {
            throw invalid("amount is larger than 9,999,999,999.99");
        }
        maxLength(p.referenceType(), "reference_type", 32);
        maxLength(p.referenceId(), "reference_id", 36);
        maxLength(p.documentNumber(), "document_number", 64);
        maxLength(p.locationId(), "location_id", 36);
        maxLength(p.note(), "note", 500);
        maxLength(p.actorUserId(), "actor_user_id", 36);
        maxLength(p.reversesEntryId(), "reverses_entry_id", 36);
        if (p.reversesEntryId() == null) {
            checkSign(p.type(), amount.signum());
        }
        return amount.setScale(2, RoundingMode.UNNECESSARY);
    }

    /** The sign a row of each type has when it reverses nothing. */
    static void checkSign(SupplierLedgerType type, int signum) {
        switch (type) {
            case BILL, EXPENSE, REFUND_RECEIVED -> {
                if (signum < 0) {
                    throw invalid(type + " must be positive");
                }
            }
            case DEBIT_NOTE, PAYMENT, TDS -> {
                if (signum > 0) {
                    throw invalid(type + " must be negative");
                }
            }
            case OPENING, SETTLEMENT, SET_OFF -> {
                // Either sign: payable or advance; a difference either way.
            }
        }
    }

    /**
     * The original is a row of this institute and supplier, of the same type, not itself a
     * reversal; the amount has the opposite sign and, with the earlier reversals of it, does not
     * exceed it. Serialised by the supplier lock.
     */
    private void checkReversal(SupplierLedgerPost p, BigDecimal amount) {
        CommerceSupplierLedgerEntry original = ledgerRepository
                .findByInstituteIdAndId(p.instituteId(), p.reversesEntryId())
                .orElseThrow(() -> invalidReversal("the entry to reverse does not exist"));
        if (!p.supplierId().equals(original.getSupplierId())) {
            throw invalidReversal("the entry to reverse belongs to another supplier");
        }
        if (!p.type().name().equals(original.getType())) {
            throw invalidReversal("a reversal has the type of the entry it reverses");
        }
        if (original.getReversesEntryId() != null) {
            throw invalidReversal("a reversal cannot be reversed; post a new entry instead");
        }
        if (amount.signum() == original.getAmount().signum()) {
            throw invalidReversal("a reversal has the opposite sign of the entry it reverses");
        }
        BigDecimal reversed = ledgerRepository.sumReversalsOf(p.instituteId(), original.getId());
        BigDecimal left = original.getAmount().abs().subtract(reversed == null ? BigDecimal.ZERO : reversed.abs());
        if (amount.abs().compareTo(left) > 0) {
            throw invalidReversal("only " + left.setScale(2, RoundingMode.HALF_UP).toPlainString()
                    + " of the entry is left to reverse");
        }
    }

    private static SupplierLedgerResult repeat(CommerceSupplierLedgerEntry first, SupplierLedgerPost p,
                                               BigDecimal amount) {
        boolean same = Objects.equals(first.getSupplierId(), p.supplierId())
                && Objects.equals(first.getType(), p.type().name())
                && first.getAmount() != null && first.getAmount().compareTo(amount) == 0
                && Objects.equals(first.getBookDate(), p.bookDate())
                && Objects.equals(first.getReferenceType(), p.referenceType())
                && Objects.equals(first.getReferenceId(), p.referenceId())
                && Objects.equals(first.getReversesEntryId(), p.reversesEntryId());
        if (!same) {
            throw new ConflictException("IDEMPOTENCY_KEY_REUSED: this key was already used for another ledger entry");
        }
        return new SupplierLedgerResult(first, false);
    }

    private static void requireText(String value, String field, int max) {
        if (value == null || value.isBlank()) {
            throw invalid(field + " is required");
        }
        maxLength(value, field, max);
    }

    private static void maxLength(String value, String field, int max) {
        if (value != null && value.length() > max) {
            throw invalid(field + " is longer than " + max + " characters");
        }
    }

    private static InvalidRequestException invalid(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }

    private static ConflictException invalidReversal(String message) {
        return new ConflictException("INVALID_REVERSAL: " + message);
    }
}
