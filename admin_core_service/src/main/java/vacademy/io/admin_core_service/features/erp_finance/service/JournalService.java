package vacademy.io.admin_core_service.features.erp_finance.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalEntry;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalLine;
import vacademy.io.admin_core_service.features.erp_finance.repository.JournalEntryRepository;
import vacademy.io.admin_core_service.features.erp_finance.repository.JournalLineRepository;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollAdjustment;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryComponent;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollRun;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollEntryStatus;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollAdjustmentRepository;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryComponentRepository;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryRepository;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentType;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * The ERP journal (Phase F4) — payroll's bridge into accounting, and the seed
 * of the future GL module. {@link #postPayrollJournal} runs on payroll
 * APPROVAL and produces one balanced double entry for the run:
 *
 *   Dr  salary expense (per EARNING component's gl_account_code, default 5100)
 *   Dr  overtime/other earnings 5110, reimbursements 5120
 *   Dr  employer statutory expense 5150
 *   Cr  salaries payable 2100 (net pay)
 *   Cr  statutory payable 2110 (employee deductions + employer contributions)
 *   Cr  TDS payable 2120
 *   Cr  employee loans receivable 1210 (EMI recovered)
 *   Dr/Cr 5999 payroll adjustment plug (net-pay floor clamps only)
 *
 * HELD entries are excluded (they are not payable). Variable-pay adjustments
 * already exist as components, so the "other earnings" line is the residual
 * (overtime) only — no double counting. Rejecting an APPROVED run posts a
 * mirror-image reversing entry. Idempotent per run via the V484 partial unique.
 */
@Service
public class JournalService {

    private static final Logger log = LoggerFactory.getLogger(JournalService.class);

    public static final String SOURCE_HR_PAYROLL = "HR_PAYROLL";

    private static final String ACC_SALARY_EXPENSE = "5100";
    private static final String ACC_OTHER_EARNINGS = "5110";
    private static final String ACC_REIMBURSEMENT = "5120";
    private static final String ACC_EMPLOYER_STATUTORY = "5150";
    private static final String ACC_SALARIES_PAYABLE = "2100";
    private static final String ACC_STATUTORY_PAYABLE = "2110";
    private static final String ACC_TDS_PAYABLE = "2120";
    private static final String ACC_LOANS_RECEIVABLE = "1210";
    private static final String ACC_PLUG = "5999";

    private static final Map<String, String> ACCOUNT_NAMES = Map.of(
            ACC_SALARY_EXPENSE, "Salary Expense",
            ACC_OTHER_EARNINGS, "Overtime & Other Earnings",
            ACC_REIMBURSEMENT, "Reimbursement Expense",
            ACC_EMPLOYER_STATUTORY, "Employer Statutory Expense",
            ACC_SALARIES_PAYABLE, "Salaries Payable",
            ACC_STATUTORY_PAYABLE, "Statutory Payable",
            ACC_TDS_PAYABLE, "TDS Payable",
            ACC_LOANS_RECEIVABLE, "Employee Loans Receivable",
            ACC_PLUG, "Payroll Adjustment (plug)");

    @Autowired
    private JournalEntryRepository journalEntryRepository;

    @Autowired
    private JournalLineRepository journalLineRepository;

    @Autowired
    private PayrollEntryRepository payrollEntryRepository;

    @Autowired
    private PayrollEntryComponentRepository payrollEntryComponentRepository;

    @Autowired
    private PayrollAdjustmentRepository payrollAdjustmentRepository;

    /** Posts the run's journal; a second call for the same run is a no-op (returns the existing id). */
    @Transactional
    public String postPayrollJournal(PayrollRun run, String userId) {
        Optional<JournalEntry> existing = journalEntryRepository
                .findFirstBySourceModuleAndSourceIdAndStatusAndReversalOfEntryIdIsNull(
                        SOURCE_HR_PAYROLL, run.getId(), "POSTED");
        if (existing.isPresent()) {
            return existing.get().getId();
        }

        List<PayrollEntry> entries = payrollEntryRepository
                .findByPayrollRunIdOrderByEmployeeEmployeeCodeAsc(run.getId());

        // Aggregation buckets: account -> amount
        Map<String, BigDecimal> debits = new LinkedHashMap<>();
        Map<String, BigDecimal> credits = new LinkedHashMap<>();
        Map<String, String> accountNames = new HashMap<>(ACCOUNT_NAMES);

        BigDecimal netPayable = BigDecimal.ZERO;
        BigDecimal loanRecovered = BigDecimal.ZERO;
        BigDecimal reimbursements = BigDecimal.ZERO;
        BigDecimal otherEarningsTotal = BigDecimal.ZERO;
        List<String> includedEntryIds = new ArrayList<>();

        for (PayrollEntry entry : entries) {
            if (PayrollEntryStatus.HELD.name().equals(entry.getStatus())) {
                continue; // held pay is not payable — posts when released and re-approved
            }
            includedEntryIds.add(entry.getId());
            netPayable = netPayable.add(nvl(entry.getNetPay()));
            loanRecovered = loanRecovered.add(nvl(entry.getLoanDeduction()));
            reimbursements = reimbursements.add(nvl(entry.getReimbursements()));
            otherEarningsTotal = otherEarningsTotal.add(nvl(entry.getOtherEarnings()));

            for (PayrollEntryComponent comp : payrollEntryComponentRepository.findByPayrollEntryId(entry.getId())) {
                SalaryComponent def = comp.getComponent();
                BigDecimal amount = nvl(comp.getAmount());
                if (amount.signum() == 0) continue;
                String type = comp.getComponentType();
                String code = def != null && def.getCode() != null ? def.getCode().toUpperCase() : "";
                String override = def != null ? def.getGlAccountCode() : null;

                if (ComponentType.EARNING.name().equals(type)) {
                    add(debits, pick(override, ACC_SALARY_EXPENSE), amount);
                    if (override != null) accountNames.putIfAbsent(override, def.getName());
                } else if (ComponentType.DEDUCTION.name().equals(type)) {
                    String account = pick(override, "TDS".equals(code) ? ACC_TDS_PAYABLE : ACC_STATUTORY_PAYABLE);
                    add(credits, account, amount);
                    if (override != null) accountNames.putIfAbsent(override, def.getName());
                } else if (ComponentType.EMPLOYER_CONTRIBUTION.name().equals(type)) {
                    add(debits, pick(override, ACC_EMPLOYER_STATUTORY), amount);
                    add(credits, ACC_STATUTORY_PAYABLE, amount);
                }
            }
        }

        // Adjustments are materialized as components above; the residual of
        // otherEarnings beyond adjustment earnings is overtime.
        BigDecimal adjEarnings = BigDecimal.ZERO;
        if (!includedEntryIds.isEmpty()) {
            for (String entryId : includedEntryIds) {
                for (PayrollAdjustment adj : payrollAdjustmentRepository.findByPayrollEntryId(entryId)) {
                    if ("EARNING".equals(adj.getType())) adjEarnings = adjEarnings.add(nvl(adj.getAmount()));
                }
            }
        }
        BigDecimal overtimeResidual = otherEarningsTotal.subtract(adjEarnings);
        if (overtimeResidual.signum() > 0) add(debits, ACC_OTHER_EARNINGS, overtimeResidual);
        if (reimbursements.signum() > 0) add(debits, ACC_REIMBURSEMENT, reimbursements);
        if (netPayable.signum() > 0) add(credits, ACC_SALARIES_PAYABLE, netPayable);
        if (loanRecovered.signum() > 0) add(credits, ACC_LOANS_RECEIVABLE, loanRecovered);

        BigDecimal totalDr = debits.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalCr = credits.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal imbalance = totalDr.subtract(totalCr);
        if (imbalance.abs().compareTo(new BigDecimal("0.01")) >= 0) {
            // Net-pay floor clamps (negative nets raised to zero) surface here.
            if (imbalance.signum() < 0) add(debits, ACC_PLUG, imbalance.negate());
            else add(credits, ACC_PLUG, imbalance);
            log.warn("Payroll journal for run {} needed a {} plug of {}", run.getId(),
                    imbalance.signum() < 0 ? "debit" : "credit", imbalance.abs());
            totalDr = debits.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
            totalCr = credits.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        }

        JournalEntry entry = new JournalEntry();
        entry.setInstituteId(run.getInstituteId());
        entry.setEntryDate(LocalDate.now());
        entry.setPeriodMonth(run.getMonth());
        entry.setPeriodYear(run.getYear());
        entry.setSourceModule(SOURCE_HR_PAYROLL);
        entry.setSourceId(run.getId());
        entry.setReference("PAYROLL-" + run.getMonth() + "/" + run.getYear()
                + ("REGULAR".equals(run.getRunType()) || run.getRunType() == null ? "" : "-" + run.getRunType()));
        entry.setMemo("Payroll " + run.getMonth() + "/" + run.getYear() + " (" + includedEntryIds.size() + " employees)");
        entry.setCurrency(run.getCurrency() != null ? run.getCurrency() : "INR");
        entry.setStatus("POSTED");
        entry.setTotalDebit(totalDr);
        entry.setTotalCredit(totalCr);
        entry.setCreatedBy(userId);
        entry = journalEntryRepository.save(entry);

        int lineNo = 1;
        for (Map.Entry<String, BigDecimal> d : debits.entrySet()) {
            saveLine(entry, lineNo++, d.getKey(), accountNames.getOrDefault(d.getKey(), d.getKey()),
                    d.getValue(), BigDecimal.ZERO);
        }
        for (Map.Entry<String, BigDecimal> c : credits.entrySet()) {
            saveLine(entry, lineNo++, c.getKey(), accountNames.getOrDefault(c.getKey(), c.getKey()),
                    BigDecimal.ZERO, c.getValue());
        }
        return entry.getId();
    }

    /** Mirror-image reversal when an APPROVED run is rejected; no-op if never posted. */
    @Transactional
    public void reversePayrollJournal(PayrollRun run, String userId) {
        Optional<JournalEntry> postedOpt = journalEntryRepository
                .findFirstBySourceModuleAndSourceIdAndStatusAndReversalOfEntryIdIsNull(
                        SOURCE_HR_PAYROLL, run.getId(), "POSTED");
        if (postedOpt.isEmpty()) {
            return;
        }
        JournalEntry posted = postedOpt.get();

        JournalEntry reversal = new JournalEntry();
        reversal.setInstituteId(posted.getInstituteId());
        reversal.setEntryDate(LocalDate.now());
        reversal.setPeriodMonth(posted.getPeriodMonth());
        reversal.setPeriodYear(posted.getPeriodYear());
        reversal.setSourceModule(SOURCE_HR_PAYROLL);
        reversal.setSourceId(run.getId());
        reversal.setReference("REVERSAL-" + posted.getReference());
        reversal.setMemo("Reversal of journal " + posted.getId() + " (payroll run rejected)");
        reversal.setCurrency(posted.getCurrency());
        reversal.setStatus("POSTED");
        reversal.setReversalOfEntryId(posted.getId());
        reversal.setTotalDebit(posted.getTotalCredit());
        reversal.setTotalCredit(posted.getTotalDebit());
        reversal.setCreatedBy(userId);
        reversal = journalEntryRepository.save(reversal);

        int lineNo = 1;
        for (JournalLine line : journalLineRepository.findByJournalEntryIdOrderByLineNoAsc(posted.getId())) {
            saveLine(reversal, lineNo++, line.getGlAccountCode(), line.getGlAccountName(),
                    nvl(line.getCredit()), nvl(line.getDebit()));
        }

        posted.setStatus("REVERSED");
        journalEntryRepository.save(posted);
    }

    private void saveLine(JournalEntry entry, int lineNo, String account, String name,
                          BigDecimal debit, BigDecimal credit) {
        JournalLine line = new JournalLine();
        line.setJournalEntry(entry);
        line.setLineNo(lineNo);
        line.setGlAccountCode(account);
        line.setGlAccountName(name);
        line.setDebit(debit);
        line.setCredit(credit);
        journalLineRepository.save(line);
    }

    private static void add(Map<String, BigDecimal> bucket, String account, BigDecimal amount) {
        bucket.merge(account, amount, BigDecimal::add);
    }

    private static String pick(String override, String fallback) {
        return override != null && !override.isBlank() ? override : fallback;
    }

    private static BigDecimal nvl(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }
}
