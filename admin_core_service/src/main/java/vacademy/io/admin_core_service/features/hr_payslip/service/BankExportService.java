package vacademy.io.admin_core_service.features.hr_payslip.service;

import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeBankDetail;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollRun;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollEntryStatus;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryRepository;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollRunRepository;
import vacademy.io.admin_core_service.features.hr_payslip.dto.BankExportDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.BankExportRequestDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.BankExportResultDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.FileDownloadDTO;
import vacademy.io.admin_core_service.features.hr_payslip.entity.BankExportLog;
import vacademy.io.admin_core_service.features.hr_payslip.repository.BankExportLogRepository;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.Month;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
public class BankExportService {

    private static final String[] SPREADSHEET_HEADERS = {
            "Sr.No", "Employee Code", "Employee Name", "Account No", "IFSC",
            "Bank Name", "Net Pay", "Currency", "Email"
    };

    @Autowired
    private BankExportLogRepository bankExportLogRepository;

    @Autowired
    private PayrollRunRepository payrollRunRepository;

    @Autowired
    private PayrollEntryRepository payrollEntryRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrFileStorageService fileStorageService;

    @Autowired
    private UserRepository userRepository;

    /** One included line of the export file. */
    private static class ExportRow {
        String employeeCode;
        String name;
        String accountNo;
        String ifsc;
        String bankName;
        BigDecimal netPay;
        String currency;
        String email;
    }

    @Transactional
    public BankExportResultDTO generateBankExport(BankExportRequestDTO requestDTO, String userId, String instituteId) {
        PayrollRun run = payrollRunRepository.findById(requestDTO.getPayrollRunId())
                .orElseThrow(() -> new VacademyException("Payroll run not found"));
        hrAccessGuard.requireInstituteMatch(run.getInstituteId(), instituteId, "Payroll run");

        // Validate payroll run status before generating bank export
        String runStatus = run.getStatus();
        if (!"APPROVED".equals(runStatus) && !"PAID".equals(runStatus)) {
            throw new VacademyException("Bank export can only be generated for APPROVED or PAID payroll runs. Current status: " + runStatus);
        }

        String format = requestDTO.getFormat() != null ? requestDTO.getFormat().toUpperCase() : "CSV";
        if (!List.of("CSV", "XLSX", "HDFC", "ICICI", "SBI").contains(format)) {
            throw new VacademyException("Unsupported bank export format: " + format
                    + ". Supported: CSV, XLSX, HDFC, ICICI, SBI");
        }

        // Get all CALCULATED/PAID (not HELD) payroll entries for the run
        List<PayrollEntry> entries = payrollEntryRepository
                .findByPayrollRunIdOrderByEmployeeEmployeeCodeAsc(requestDTO.getPayrollRunId());

        List<PayrollEntry> eligibleEntries = entries.stream()
                .filter(e -> PayrollEntryStatus.CALCULATED.name().equals(e.getStatus())
                        || PayrollEntryStatus.PAID.name().equals(e.getStatus()))
                .collect(Collectors.toList());

        if (eligibleEntries.isEmpty()) {
            throw new VacademyException("No eligible payroll entries found for bank export");
        }

        Map<String, User> userMap = buildUserMap(eligibleEntries);

        // Split into included rows vs skipped (missing/blank bank details).
        // Entries with no usable account number or IFSC are EXCLUDED from the file
        // — a payment file with blank account columns would be rejected (or worse,
        // silently mis-processed) by the bank portal.
        List<ExportRow> rows = new ArrayList<>();
        List<BankExportResultDTO.SkippedEntryDTO> skipped = new ArrayList<>();
        BigDecimal totalAmount = BigDecimal.ZERO;

        for (PayrollEntry entry : eligibleEntries) {
            String employeeCode = entry.getEmployee().getEmployeeCode() != null
                    ? entry.getEmployee().getEmployeeCode() : entry.getEmployee().getId();
            EmployeeBankDetail bank = entry.getBankAccount();

            String skipReason = null;
            if (bank == null) {
                skipReason = "No bank account on file";
            } else if (!StringUtils.hasText(bank.getAccountNumber())) {
                skipReason = "Missing bank account number";
            } else if (!StringUtils.hasText(bank.getIfscCode())) {
                skipReason = "Missing IFSC code";
            }
            if (skipReason != null) {
                skipped.add(BankExportResultDTO.SkippedEntryDTO.builder()
                        .employeeCode(employeeCode)
                        .reason(skipReason)
                        .build());
                continue;
            }

            User user = userMap.get(entry.getEmployee().getUserId());

            ExportRow row = new ExportRow();
            row.employeeCode = employeeCode;
            // Account holder name from the bank detail wins (that's what the bank
            // matches against); fall back to the platform user's full name.
            row.name = StringUtils.hasText(bank.getAccountHolderName())
                    ? bank.getAccountHolderName()
                    : (user != null && StringUtils.hasText(user.getFullName()) ? user.getFullName() : employeeCode);
            row.accountNo = bank.getAccountNumber();
            row.ifsc = bank.getIfscCode();
            row.bankName = bank.getBankName() != null ? bank.getBankName() : "";
            row.netPay = entry.getNetPay() != null ? entry.getNetPay() : BigDecimal.ZERO;
            row.currency = entry.getCurrency() != null ? entry.getCurrency() : "INR";
            row.email = user != null && user.getEmail() != null ? user.getEmail() : "";
            rows.add(row);

            totalAmount = totalAmount.add(row.netPay);
        }

        if (rows.isEmpty()) {
            throw new VacademyException("All eligible entries are missing bank details — nothing to export. Skipped: "
                    + skipped.size());
        }

        String narration = "SAL " + monthAbbrev(run.getMonth()) + " " + run.getYear();
        byte[] fileBytes = switch (format) {
            case "XLSX" -> buildXlsx(rows);
            case "HDFC", "ICICI", "SBI" -> buildBankTextFile(format, rows, narration)
                    .getBytes(StandardCharsets.UTF_8);
            default -> buildCsv(rows).getBytes(StandardCharsets.UTF_8);
        };

        String fileName = "bank_export_" + format.toLowerCase() + "_" + run.getMonth() + "_" + run.getYear()
                + "." + fileExtension(format);

        // Persist the file to media_service so the export is re-downloadable
        FileDetailsDTO fileDetails = fileStorageService.uploadBytes(fileName, contentTypeFor(format), fileBytes);

        BankExportLog exportLog = new BankExportLog();
        exportLog.setPayrollRun(run);
        exportLog.setInstituteId(run.getInstituteId());
        exportLog.setFileName(fileName);
        exportLog.setFormat(format);
        exportLog.setTotalRecords(rows.size());
        exportLog.setTotalAmount(totalAmount);
        exportLog.setGeneratedBy(userId);
        exportLog.setGeneratedAt(LocalDateTime.now());
        exportLog.setCurrency(run.getCurrency() != null ? run.getCurrency() : "INR");
        exportLog.setFileId(fileDetails.getId());

        exportLog = bankExportLogRepository.save(exportLog);

        if (!skipped.isEmpty()) {
            // hr_bank_export_log has no excluded-count column; total_records holds the
            // INCLUDED count and the exclusions are logged + returned to the caller.
            log.warn("[BANK-EXPORT] Export {} for run {}: {} entries included, {} excluded for missing bank details: {}",
                    exportLog.getId(), run.getId(), rows.size(), skipped.size(),
                    skipped.stream().map(s -> s.getEmployeeCode() + " (" + s.getReason() + ")")
                            .collect(Collectors.joining(", ")));
        }

        return BankExportResultDTO.builder()
                .export(toDTO(exportLog))
                .skipped(skipped)
                .skippedCount(skipped.size())
                .build();
    }

    @Transactional(readOnly = true)
    public List<BankExportDTO> getBankExports(String payrollRunId, String instituteId) {
        PayrollRun run = payrollRunRepository.findById(payrollRunId)
                .orElseThrow(() -> new VacademyException("Payroll run not found"));
        hrAccessGuard.requireInstituteMatch(run.getInstituteId(), instituteId, "Payroll run");
        List<BankExportLog> logs = bankExportLogRepository.findByPayrollRunIdOrderByCreatedAtDesc(payrollRunId);
        return logs.stream().map(this::toDTO).collect(Collectors.toList());
    }

    /** Streams a previously generated export file back from media_service. HR admin only (enforced at controller). */
    @Transactional(readOnly = true)
    public FileDownloadDTO downloadBankExport(String id, String instituteId) {
        BankExportLog exportLog = bankExportLogRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Bank export not found"));
        hrAccessGuard.requireInstituteMatch(exportLog.getInstituteId(), instituteId, "Bank export");

        byte[] bytes = fileStorageService.downloadBytes(exportLog.getFileId());
        if (bytes == null || bytes.length == 0) {
            throw new VacademyException("Bank export file is no longer available — regenerate the export");
        }
        String format = exportLog.getFormat() != null ? exportLog.getFormat() : "CSV";
        String fileName = exportLog.getFileName() != null ? exportLog.getFileName()
                : "bank_export." + fileExtension(format);
        return FileDownloadDTO.builder()
                .fileName(fileName)
                .contentType(contentTypeFor(format))
                .bytes(bytes)
                .build();
    }

    // -----------------------------------------------------------------------
    // File builders
    // -----------------------------------------------------------------------

    private String buildCsv(List<ExportRow> rows) {
        StringBuilder csv = new StringBuilder();
        csv.append(String.join(",", SPREADSHEET_HEADERS)).append("\n");
        int srNo = 1;
        for (ExportRow row : rows) {
            csv.append(srNo++).append(",")
                    .append(escapeCSV(row.employeeCode)).append(",")
                    .append(escapeCSV(row.name)).append(",")
                    .append(escapeCSV(row.accountNo)).append(",")
                    .append(escapeCSV(row.ifsc)).append(",")
                    .append(escapeCSV(row.bankName)).append(",")
                    .append(row.netPay.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()).append(",")
                    .append(escapeCSV(row.currency)).append(",")
                    .append(escapeCSV(row.email))
                    .append("\n");
        }
        return csv.toString();
    }

    /** Real XLSX workbook (Apache POI): bold header row, autosized columns, same columns as CSV. */
    private byte[] buildXlsx(List<ExportRow> rows) {
        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            Sheet sheet = wb.createSheet("Bank Export");

            CellStyle headerStyle = wb.createCellStyle();
            Font headerFont = wb.createFont();
            headerFont.setBold(true);
            headerStyle.setFont(headerFont);

            Row header = sheet.createRow(0);
            for (int c = 0; c < SPREADSHEET_HEADERS.length; c++) {
                Cell cell = header.createCell(c);
                cell.setCellValue(SPREADSHEET_HEADERS[c]);
                cell.setCellStyle(headerStyle);
            }

            int rowIdx = 1;
            for (ExportRow row : rows) {
                Row r = sheet.createRow(rowIdx);
                r.createCell(0).setCellValue(rowIdx);
                r.createCell(1).setCellValue(row.employeeCode);
                r.createCell(2).setCellValue(row.name);
                // Account numbers as text — numeric cells would lose leading zeros
                r.createCell(3).setCellValue(row.accountNo);
                r.createCell(4).setCellValue(row.ifsc);
                r.createCell(5).setCellValue(row.bankName);
                r.createCell(6).setCellValue(row.netPay.doubleValue());
                r.createCell(7).setCellValue(row.currency);
                r.createCell(8).setCellValue(row.email);
                rowIdx++;
            }

            for (int c = 0; c < SPREADSHEET_HEADERS.length; c++) {
                sheet.autoSizeColumn(c);
            }

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            return out.toByteArray();
        } catch (Exception e) {
            log.error("[BANK-EXPORT] Failed to build XLSX workbook", e);
            throw new VacademyException("Failed to build XLSX export: " + e.getMessage());
        }
    }

    /**
     * v1 bank payment-file templates — simple fixed-column text layouts.
     *
     * IMPORTANT: these are v1 placeholders using the commonly documented column
     * orders. Each bank's corporate portal (HDFC ENet, ICICI CIB, SBI CMP) has an
     * exact upload spec (column order, date columns, debit-account column, header/
     * trailer records) that MUST be verified against the institute's bank portal
     * before live salary uploads. Payment mode is fixed to NEFT; narration is
     * "SAL <MON YYYY>".
     */
    private String buildBankTextFile(String format, List<ExportRow> rows, String narration) {
        StringBuilder sb = new StringBuilder();
        for (ExportRow row : rows) {
            String amount = row.netPay.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString();
            switch (format) {
                // HDFC (ENet-style): Mode, Beneficiary Name, Account, IFSC, Amount, Narration
                case "HDFC" -> sb.append("NEFT").append(",")
                        .append(sanitizeBankField(row.name)).append(",")
                        .append(sanitizeBankField(row.accountNo)).append(",")
                        .append(sanitizeBankField(row.ifsc)).append(",")
                        .append(amount).append(",")
                        .append(sanitizeBankField(narration)).append("\r\n");
                // ICICI (CIB-style): Mode, Account, Beneficiary Name, IFSC, Amount, Narration
                case "ICICI" -> sb.append("NEFT").append(",")
                        .append(sanitizeBankField(row.accountNo)).append(",")
                        .append(sanitizeBankField(row.name)).append(",")
                        .append(sanitizeBankField(row.ifsc)).append(",")
                        .append(amount).append(",")
                        .append(sanitizeBankField(narration)).append("\r\n");
                // SBI (CMP-style): Beneficiary Name, Account, IFSC, Amount, Mode, Narration
                case "SBI" -> sb.append(sanitizeBankField(row.name)).append(",")
                        .append(sanitizeBankField(row.accountNo)).append(",")
                        .append(sanitizeBankField(row.ifsc)).append(",")
                        .append(amount).append(",")
                        .append("NEFT").append(",")
                        .append(sanitizeBankField(narration)).append("\r\n");
                default -> throw new VacademyException("Unsupported bank text format: " + format);
            }
        }
        return sb.toString();
    }

    /** Bank upload fields are comma-delimited with no quoting — strip delimiters/newlines. */
    private String sanitizeBankField(String value) {
        if (value == null) return "";
        return value.replace(",", " ").replace("\n", " ").replace("\r", " ").trim();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private Map<String, User> buildUserMap(List<PayrollEntry> entries) {
        List<String> userIds = entries.stream()
                .map(e -> e.getEmployee().getUserId())
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());
        if (userIds.isEmpty()) {
            return new HashMap<>();
        }
        return userRepository.findByIdIn(userIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a));
    }

    private static String monthAbbrev(Integer month) {
        if (month == null || month < 1 || month > 12) {
            return String.valueOf(month);
        }
        return Month.of(month).getDisplayName(TextStyle.SHORT, Locale.ENGLISH).toUpperCase(Locale.ENGLISH);
    }

    private static String fileExtension(String format) {
        return switch (format) {
            case "XLSX" -> "xlsx";
            case "HDFC", "ICICI", "SBI" -> "txt";
            default -> "csv";
        };
    }

    private static String contentTypeFor(String format) {
        return switch (format) {
            case "XLSX" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "HDFC", "ICICI", "SBI" -> "text/plain";
            default -> "text/csv";
        };
    }

    private String escapeCSV(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    private BankExportDTO toDTO(BankExportLog log) {
        return BankExportDTO.builder()
                .id(log.getId())
                .payrollRunId(log.getPayrollRun().getId())
                .instituteId(log.getInstituteId())
                .fileId(log.getFileId())
                .fileName(log.getFileName())
                .format(log.getFormat())
                .totalRecords(log.getTotalRecords())
                .totalAmount(log.getTotalAmount())
                .generatedBy(log.getGeneratedBy())
                .generatedAt(log.getGeneratedAt())
                .currency(log.getCurrency() != null ? log.getCurrency() : "INR")
                .build();
    }
}
