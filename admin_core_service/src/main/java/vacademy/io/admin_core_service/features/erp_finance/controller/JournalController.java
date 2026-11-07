package vacademy.io.admin_core_service.features.erp_finance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalEntry;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalLine;
import vacademy.io.admin_core_service.features.erp_finance.repository.JournalEntryRepository;
import vacademy.io.admin_core_service.features.erp_finance.repository.JournalLineRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * ERP journal reads + accounting export (Phase F4). The journal is written by
 * source modules (payroll posts on approval); this controller lists periods
 * and exports a books-ready CSV (Date, Reference, Account, Name, Debit,
 * Credit, Narration) importable into Zoho Books / Tally via their CSV import
 * tooling — a native Tally XML / Zoho API push is a later slice.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/erp/finance/journal")
public class JournalController {

    @Autowired
    private JournalEntryRepository journalEntryRepository;

    @Autowired
    private JournalLineRepository journalLineRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> listJournal(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("year") Integer year,
            @RequestParam("month") Integer month,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<JournalEntry> entries = journalEntryRepository
                .findByInstituteIdAndPeriodYearAndPeriodMonthOrderByEntryDateAsc(instituteId, year, month);
        List<String> ids = entries.stream().map(JournalEntry::getId).collect(Collectors.toList());
        Map<String, List<JournalLine>> linesByEntry = ids.isEmpty() ? Map.of()
                : journalLineRepository.findByJournalEntryIdInOrderByJournalEntryIdAscLineNoAsc(ids).stream()
                        .collect(Collectors.groupingBy(l -> l.getJournalEntry().getId()));

        List<Map<String, Object>> out = entries.stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.getId());
            m.put("entry_date", e.getEntryDate());
            m.put("source_module", e.getSourceModule());
            m.put("reference", e.getReference());
            m.put("memo", e.getMemo());
            m.put("status", e.getStatus());
            m.put("currency", e.getCurrency());
            m.put("total_debit", e.getTotalDebit());
            m.put("total_credit", e.getTotalCredit());
            m.put("lines", linesByEntry.getOrDefault(e.getId(), List.of()).stream().map(l -> {
                Map<String, Object> lm = new LinkedHashMap<>();
                lm.put("line_no", l.getLineNo());
                lm.put("account_code", l.getGlAccountCode());
                lm.put("account_name", l.getGlAccountName());
                lm.put("debit", l.getDebit());
                lm.put("credit", l.getCredit());
                return lm;
            }).collect(Collectors.toList()));
            return m;
        }).collect(Collectors.toList());
        return ResponseEntity.ok(out);
    }

    @GetMapping("/export")
    @Auditable(entityType = "ERP_JOURNAL", action = "EXPORT",
            entityIdExpr = "#instituteId + ':' + #year + '-' + #month")
    public ResponseEntity<byte[]> exportJournal(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("year") Integer year,
            @RequestParam("month") Integer month,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        List<JournalEntry> entries = journalEntryRepository
                .findByInstituteIdAndPeriodYearAndPeriodMonthOrderByEntryDateAsc(instituteId, year, month);
        if (entries.isEmpty()) {
            throw new VacademyException("No journal entries for " + month + "/" + year);
        }

        StringBuilder csv = new StringBuilder("Date,Reference,Account Code,Account Name,Debit,Credit,Currency,Narration\r\n");
        for (JournalEntry e : entries) {
            for (JournalLine l : journalLineRepository.findByJournalEntryIdOrderByLineNoAsc(e.getId())) {
                csv.append(e.getEntryDate()).append(',')
                        .append(sanitize(e.getReference())).append(',')
                        .append(l.getGlAccountCode()).append(',')
                        .append(sanitize(l.getGlAccountName())).append(',')
                        .append(l.getDebit() != null ? l.getDebit().toPlainString() : "0").append(',')
                        .append(l.getCredit() != null ? l.getCredit().toPlainString() : "0").append(',')
                        .append(e.getCurrency() != null ? e.getCurrency() : "INR").append(',')
                        .append(sanitize(e.getMemo())).append("\r\n");
            }
        }
        byte[] bytes = csv.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=journal_" + month + "_" + year + ".csv")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(bytes);
    }

    private static String sanitize(String v) {
        return v == null ? "" : v.replace(',', ';').replace('\n', ' ').replace('\r', ' ');
    }
}
