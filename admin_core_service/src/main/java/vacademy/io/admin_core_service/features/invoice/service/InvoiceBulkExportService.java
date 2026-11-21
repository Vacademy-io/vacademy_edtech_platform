package vacademy.io.admin_core_service.features.invoice.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceExportRow;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceIssueOnPaymentLog;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Bulk "download every invoice for this period" export behind Manage Payments.
 *
 * <p>Split in two so a refusal (nothing in the window, too many) is an ordinary error response:
 * {@link #plan} runs before a single byte is written, {@link #writeZip} then streams the archive
 * straight to the response — PDFs are fetched a few at a time and never held all at once.
 *
 * <p>What goes in: every live (non-REJECTED) invoice whose invoice date falls in the window,
 * collapsed to one invoice per payment. A payment that carries several invoices (concurrent
 * generation for a single payment log) keeps its FIRST-issued one — the number the learner was
 * emailed first — and the extras are left out but listed in the manifest, so the pack can be
 * reconciled against the invoice series without anything disappearing silently.
 *
 * <p>The archive ends with {@code invoices.csv}: one row per invoice considered, with the file
 * it was saved as, or why it isn't there.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InvoiceBulkExportService {

    /** Largest number of invoices one archive will hold. Beyond this, ask for a shorter range. */
    public static final int MAX_INVOICES = 1000;

    /** PDFs fetched concurrently. Enough to hide S3 latency without hammering media_service. */
    private static final int FETCH_PARALLELISM = 6;

    /** Invoices fetched per round; written in order once the whole round has arrived. */
    private static final int FETCH_ROUND = FETCH_PARALLELISM * 4;

    /** IN-clause chunk for the duplicate and user lookups. */
    private static final int LOOKUP_CHUNK = 500;

    /** Stand-ins for an open-ended window; the query needs real values to type its parameters. */
    private static final LocalDateTime OPEN_START = LocalDateTime.of(1970, 1, 1, 0, 0);
    private static final LocalDateTime OPEN_END = LocalDateTime.of(9999, 12, 31, 23, 59, 59);

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final InvoiceRepository invoiceRepository;
    private final InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;
    private final InvoiceService invoiceService;
    private final AuthService authService;

    /** What the archive will contain, decided before the response starts. */
    public record ExportPlan(List<InvoiceExportRow> included,
                             Map<String, String> duplicateOf,
                             List<InvoiceExportRow> duplicates,
                             Map<String, UserDTO> users) {
    }

    public ExportPlan plan(String instituteId, LocalDateTime startDate, LocalDateTime endDate) {
        List<InvoiceExportRow> rows = invoiceRepository.findForBulkExport(
                instituteId,
                startDate != null ? startDate : OPEN_START,
                endDate != null ? endDate : OPEN_END,
                PageRequest.of(0, MAX_INVOICES + 1));
        if (rows.isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No invoices were issued in this period.");
        }
        if (rows.size() > MAX_INVOICES) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "More than " + MAX_INVOICES + " invoices were issued in this period. "
                            + "Pick a shorter date range and download it in parts.");
        }

        Map<String, String> duplicateOf = findDuplicates(instituteId, rows);
        List<InvoiceExportRow> included = new ArrayList<>();
        List<InvoiceExportRow> duplicates = new ArrayList<>();
        for (InvoiceExportRow row : rows) {
            (duplicateOf.containsKey(row.getId()) ? duplicates : included).add(row);
        }
        return new ExportPlan(included, duplicateOf, duplicates, resolveUsers(rows));
    }

    public void writeZip(ExportPlan plan, OutputStream out) throws IOException {
        List<String[]> manifest = new ArrayList<>();
        Set<String> usedNames = new HashSet<>();
        ExecutorService pool = Executors.newFixedThreadPool(FETCH_PARALLELISM);
        try (ZipOutputStream zip = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            List<InvoiceExportRow> included = plan.included();
            for (int from = 0; from < included.size(); from += FETCH_ROUND) {
                List<InvoiceExportRow> round = included.subList(from, Math.min(from + FETCH_ROUND, included.size()));
                List<CompletableFuture<byte[]>> pdfs = round.stream()
                        .map(row -> CompletableFuture.supplyAsync(() -> fetchPdf(row), pool))
                        .toList();
                for (int i = 0; i < round.size(); i++) {
                    InvoiceExportRow row = round.get(i);
                    byte[] pdf = pdfs.get(i).join();
                    if (pdf == null) {
                        manifest.add(manifestRow(row, plan.users(), "", "PDF could not be generated — download it from the payment's invoice preview"));
                        continue;
                    }
                    String name = uniqueName(fileNameFor(row), usedNames);
                    zip.putNextEntry(new ZipEntry(name));
                    zip.write(pdf);
                    zip.closeEntry();
                    manifest.add(manifestRow(row, plan.users(), name, ""));
                }
                zip.flush();
            }
            for (InvoiceExportRow row : plan.duplicates()) {
                manifest.add(manifestRow(row, plan.users(), "",
                        "Not included — duplicate of " + plan.duplicateOf().get(row.getId())
                                + " (same payment)"));
            }

            zip.putNextEntry(new ZipEntry("invoices.csv"));
            zip.write(toCsv(manifest).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * invoice id → number of the first-issued invoice on the same payment, for every invoice in
     * {@code rows} that is NOT the first issued on one of its payments.
     */
    private Map<String, String> findDuplicates(String instituteId, List<InvoiceExportRow> rows) {
        List<String> ids = rows.stream().map(InvoiceExportRow::getId).toList();
        Map<String, List<InvoiceIssueOnPaymentLog>> byPaymentLog = new HashMap<>();
        for (int from = 0; from < ids.size(); from += LOOKUP_CHUNK) {
            List<String> chunk = ids.subList(from, Math.min(from + LOOKUP_CHUNK, ids.size()));
            for (InvoiceIssueOnPaymentLog issue : invoicePaymentLogMappingRepository
                    .findLiveInvoicesSharingPaymentLogs(instituteId, chunk)) {
                byPaymentLog.computeIfAbsent(issue.getPaymentLogId(), k -> new ArrayList<>()).add(issue);
            }
        }

        Comparator<InvoiceIssueOnPaymentLog> firstIssued = Comparator
                .comparing(InvoiceIssueOnPaymentLog::getInvoiceDate, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(InvoiceIssueOnPaymentLog::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(InvoiceIssueOnPaymentLog::getInvoiceNumber, Comparator.nullsLast(Comparator.naturalOrder()));

        Map<String, String> duplicateOf = new HashMap<>();
        for (List<InvoiceIssueOnPaymentLog> issues : byPaymentLog.values()) {
            Set<String> distinct = issues.stream().map(InvoiceIssueOnPaymentLog::getInvoiceId).collect(Collectors.toSet());
            if (distinct.size() < 2) continue;
            InvoiceIssueOnPaymentLog keeper = issues.stream().min(firstIssued).orElseThrow();
            for (InvoiceIssueOnPaymentLog issue : issues) {
                if (!issue.getInvoiceId().equals(keeper.getInvoiceId())) {
                    duplicateOf.putIfAbsent(issue.getInvoiceId(), keeper.getInvoiceNumber());
                }
            }
        }
        return duplicateOf;
    }

    /** Learner name / email / phone for the manifest. Never fails the export — blanks instead. */
    private Map<String, UserDTO> resolveUsers(List<InvoiceExportRow> rows) {
        List<String> userIds = rows.stream().map(InvoiceExportRow::getUserId)
                .filter(StringUtils::hasText).distinct().toList();
        Map<String, UserDTO> users = new HashMap<>();
        for (int from = 0; from < userIds.size(); from += LOOKUP_CHUNK) {
            List<String> chunk = userIds.subList(from, Math.min(from + LOOKUP_CHUNK, userIds.size()));
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(chunk)) {
                    users.put(u.getId(), u);
                }
            } catch (Exception e) {
                log.warn("[invoice-zip] could not resolve {} learner names: {}", chunk.size(), e.getMessage());
            }
        }
        return users;
    }

    /**
     * The invoice's PDF, regenerating it first when none is stored — the same path the single
     * download takes. Null when it can't be produced; the manifest records that.
     */
    private byte[] fetchPdf(InvoiceExportRow row) {
        try {
            String url = invoiceService.resolveOrRegeneratePdfUrl(row.getId());
            if (!StringUtils.hasText(url)) return null;
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(30000);
            if (conn.getResponseCode() != 200) {
                log.warn("[invoice-zip] PDF fetch for invoice {} returned {}", row.getId(), conn.getResponseCode());
                return null;
            }
            try (InputStream is = conn.getInputStream();
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                is.transferTo(baos);
                return baos.toByteArray();
            }
        } catch (Exception e) {
            log.warn("[invoice-zip] PDF fetch for invoice {} failed: {}", row.getId(), e.getMessage());
            return null;
        }
    }

    /** {@code PRO-ACME/2026-27/0007} → {@code PRO-ACME_2026-27_0007.pdf}. */
    private static String fileNameFor(InvoiceExportRow row) {
        String base = StringUtils.hasText(row.getInvoiceNumber()) ? row.getInvoiceNumber() : row.getId();
        return base.replaceAll("[^A-Za-z0-9._-]", "_") + ".pdf";
    }

    private static String uniqueName(String name, Set<String> used) {
        if (used.add(name)) return name;
        String stem = name.substring(0, name.length() - ".pdf".length());
        for (int n = 2; ; n++) {
            String candidate = stem + "-" + n + ".pdf";
            if (used.add(candidate)) return candidate;
        }
    }

    private static String[] manifestRow(InvoiceExportRow row, Map<String, UserDTO> users, String file, String note) {
        UserDTO user = users.get(row.getUserId());
        return new String[]{
                row.getInvoiceNumber(),
                row.getInvoiceDate() != null ? row.getInvoiceDate().format(DATE) : "",
                user != null ? user.getFullName() : "",
                user != null ? user.getEmail() : "",
                user != null ? user.getMobileNumber() : "",
                row.getStatus(),
                row.getSource(),
                row.getTotalAmount() != null ? row.getTotalAmount().toPlainString() : "",
                row.getCurrency(),
                file,
                note,
        };
    }

    private static String toCsv(List<String[]> rows) {
        StringBuilder sb = new StringBuilder("﻿"); // BOM, so Excel reads ₹ and names correctly
        sb.append("Invoice Number,Invoice Date,Learner,Email,Phone,Status,Source,Amount,Currency,File,Note\r\n");
        for (String[] row : rows) {
            for (int i = 0; i < row.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(csvCell(row[i]));
            }
            sb.append("\r\n");
        }
        return sb.toString();
    }

    private static String csvCell(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            return '"' + value.replace("\"", "\"\"") + '"';
        }
        return value;
    }
}
