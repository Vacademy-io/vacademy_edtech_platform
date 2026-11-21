package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierLedgerRepository;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceSupplierRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * A supplier's statement for a date range: the balance before the range, every row in it with
 * the running balance, and the balance at its end. At most {@link #ROW_CAP} rows; above that the
 * answer says {@code truncated} and has no closing balance (the screen asks for a shorter range).
 */
@Service
public class SupplierStatementService {

    public static final int ROW_CAP = 5000;
    static final int MAX_DAYS = 366;
    static final String REPEATABLE_READ_SQL = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ";

    private final CommerceSupplierRepository supplierRepository;
    private final CommerceSupplierLedgerRepository ledgerRepository;
    private final StockClock clock;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate readOnly;

    public SupplierStatementService(CommerceSupplierRepository supplierRepository,
                                    CommerceSupplierLedgerRepository ledgerRepository,
                                    StockClock clock,
                                    JdbcTemplate jdbc,
                                    PlatformTransactionManager transactionManager) {
        this.supplierRepository = supplierRepository;
        this.ledgerRepository = ledgerRepository;
        this.clock = clock;
        this.jdbc = jdbc;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** The statement answer; amounts are strings with two places. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatementView {
        private String supplierId;
        private LocalDate from;
        private LocalDate to;
        private String opening;
        private List<StatementRow> rows;
        /** Null when {@code truncated}. */
        private String closing;
        private boolean truncated;
    }

    /** One ledger row of a statement. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StatementRow {
        private String id;
        private LocalDate bookDate;
        private String type;
        private String amount;
        private String documentNumber;
        private String referenceType;
        private String referenceId;
        private String locationId;
        private String note;
        private String reversesEntryId;
        private LocalDateTime createdAt;
        private String runningBalance;
    }

    /**
     * {@code from} defaults to the start of the financial year (1 April) of {@code to}; {@code to}
     * defaults to today.
     *
     * @throws InvalidRequestException 400 VALIDATION when {@code from} is after {@code to} or the range is over a year
     * @throws VacademyException       404 NOT_FOUND when the supplier is not one of the institute's
     */
    public StatementView statement(String instituteId, String supplierId, LocalDate from, LocalDate to) {
        LocalDate end = to != null ? to : clock.today(instituteId);
        LocalDate start = from != null ? from : financialYearStart(end);
        if (start.isAfter(end)) {
            throw new InvalidRequestException("VALIDATION: from must not be after to");
        }
        if (ChronoUnit.DAYS.between(start, end) + 1 > MAX_DAYS) {
            throw new InvalidRequestException("VALIDATION: a statement covers at most one year (366 days)");
        }
        return readOnly.execute(status -> build(instituteId, supplierId, start, end));
    }

    private StatementView build(String instituteId, String supplierId, LocalDate from, LocalDate to) {
        // One snapshot for the opening balance and the rows. Transaction-scoped (safe under transaction pooling);
        // it must be the first statement of the transaction.
        jdbc.execute(REPEATABLE_READ_SQL);
        if (supplierId == null || supplierRepository.findByInstituteIdAndId(instituteId, supplierId).isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "NOT_FOUND: no such supplier");
        }
        BigDecimal opening = orZero(ledgerRepository.sumBefore(instituteId, supplierId, from));
        List<CommerceSupplierLedgerEntry> found = ledgerRepository.rowsBetween(instituteId, supplierId, from, to,
                ROW_CAP + 1);
        boolean truncated = found.size() > ROW_CAP;
        List<CommerceSupplierLedgerEntry> shown = truncated ? found.subList(0, ROW_CAP) : found;
        BigDecimal running = opening;
        List<StatementRow> rows = new ArrayList<>(shown.size());
        for (CommerceSupplierLedgerEntry e : shown) {
            running = running.add(orZero(e.getAmount()));
            rows.add(new StatementRow(e.getId(), e.getBookDate(), e.getType(), money(e.getAmount()),
                    e.getDocumentNumber(), e.getReferenceType(), e.getReferenceId(), e.getLocationId(), e.getNote(),
                    e.getReversesEntryId(), e.getCreatedAt(), money(running)));
        }
        return new StatementView(supplierId, from, to, money(opening), rows, truncated ? null : money(running),
                truncated);
    }

    /** 1 April of the financial year {@code day} falls in (India: April to March). */
    static LocalDate financialYearStart(LocalDate day) {
        int year = day.getMonthValue() >= 4 ? day.getYear() : day.getYear() - 1;
        return LocalDate.of(year, 4, 1);
    }

    private static BigDecimal orZero(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    static String money(BigDecimal value) {
        return orZero(value).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
