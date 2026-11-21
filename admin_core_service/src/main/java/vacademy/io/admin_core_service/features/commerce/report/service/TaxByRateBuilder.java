package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.NoteLine;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Tax by rate (contract section 2.3): rate × location × channel in three blocks: live tax
 * invoices, credit notes (location and channel of their invoice), net (invoices − notes).
 */
final class TaxByRateBuilder {

    private record Key(BigDecimal rate, String location, String channel) implements Comparable<Key> {
        @Override
        public int compareTo(Key o) {
            int c = rate.compareTo(o.rate);
            if (c != 0) {
                return c;
            }
            c = nz(location).compareTo(nz(o.location));
            return c != 0 ? c : nz(channel).compareTo(nz(o.channel));
        }

        private static String nz(String s) {
            return s == null ? "" : s;
        }
    }

    private final Map<Key, TaxSums> invoices = new TreeMap<>();
    private final Map<Key, TaxSums> notes = new TreeMap<>();

    void invoiceLine(InvoiceLine line) {
        Key key = new Key(ReportTable.rate(line.rate()), line.locationCode(), line.channel());
        invoices.computeIfAbsent(key, k -> new TaxSums()).add(1, line.taxable(), line.cgst(), line.sgst(),
                line.igst(), line.cess());
    }

    void noteLine(NoteLine line) {
        Key key = new Key(ReportTable.rate(line.rate()), line.locationCode(), line.channel());
        notes.computeIfAbsent(key, k -> new TaxSums()).add(1, line.taxable(), line.cgst(), line.sgst(),
                line.igst(), line.cess());
    }

    List<ReportDtos.Section> sections() {
        Map<Key, TaxSums> net = new TreeMap<>();
        for (Key key : new TreeSet<>(invoices.keySet())) {
            net.computeIfAbsent(key, k -> new TaxSums()).add(1, invoices.get(key));
        }
        for (Map.Entry<Key, TaxSums> e : notes.entrySet()) {
            net.computeIfAbsent(e.getKey(), k -> new TaxSums()).add(-1, e.getValue());
        }
        List<ReportDtos.Section> out = new ArrayList<>();
        out.add(section("invoices", "Invoices", "इनवॉइस", invoices));
        out.add(section("credit_notes", "Credit notes", "क्रेडिट नोट", notes));
        out.add(section("net", "Net", "शुद्ध", net));
        return out;
    }

    /** The net block's sums over every row (the cross-check with GSTR-1 and HSN). */
    TaxSums netTotal() {
        TaxSums total = new TaxSums();
        invoices.values().forEach(s -> total.add(1, s));
        notes.values().forEach(s -> total.add(-1, s));
        return total;
    }

    private static ReportDtos.Section section(String key, String label, String labelHi, Map<Key, TaxSums> groups) {
        List<Map<String, Object>> rows = new ArrayList<>();
        TaxSums total = new TaxSums();
        for (Map.Entry<Key, TaxSums> e : groups.entrySet()) {
            Map<String, Object> row = ReportTable.row();
            row.put("rate", e.getKey().rate());
            row.put("location", e.getKey().location());
            row.put("channel", e.getKey().channel());
            e.getValue().putInto(row);
            row.put("total_tax", ReportTable.money(e.getValue().tax()));
            rows.add(row);
            total.add(1, e.getValue());
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        total.putInto(totals);
        totals.put("total_tax", ReportTable.money(total.tax()));
        return new ReportDtos.Section(key, label, labelHi, ReportTable.dto(GstColumns.TAX_BY_RATE), rows, totals);
    }
}
