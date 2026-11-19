package vacademy.io.admin_core_service.features.commerce.report.service;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.common.CommerceUnits;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.ActiveProduct;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Membership;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.ProductLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.SalesDocument;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.date;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.integer;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.qty;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;

/**
 * Sales (contract 2.12) and products (contract 2.13). Sales are documents, not orders: live
 * invoices by their {@code document_date}; "returns" are credit notes by their own date. No
 * figure comes from an order total or a live setting; names (staff, product, collection) are
 * labels only. A bill reissued with the buyer's GSTIN counts once: one sale, no return (warning
 * {@code REISSUE_COUNTED_ONCE} names it).
 */
@Service
public class SalesReportService {

    public static final String SALES = "sales";
    public static final String PRODUCTS = "products";

    public static final List<String> SALES_GROUPS = List.of("day", "month", "channel", "location", "staff",
            "payment_method");
    public static final List<String> PRODUCT_GROUPS = List.of("variant", "product", "collection", "category");

    /** What a staff group reads for an online order (placed by the shopper, not by staff). */
    static final String ONLINE = "Online";
    static final String UNKNOWN_STAFF = "Unknown staff";
    /** The payment method (or channel) of a document with no order behind it (a paper bill entered alone). */
    static final String NO_ORDER = "NO_ORDER";
    /** Warning of the collection and category views. */
    public static final String NO_GRAND_TOTAL = "NO_GRAND_TOTAL";

    static final List<ReportTable.Column> SALES_FIGURES = List.of(
            integer("invoices", "Invoices", "इनवॉइस"),
            integer("items", "Items", "सामान"),
            money("gross", "Gross", "कुल बिक्री"),
            money("discount", "Discount", "छूट"),
            money("taxable", "Taxable value", "कर योग्य मूल्य"),
            money("tax", "Tax", "टैक्स"),
            money("round_off", "Round-off", "राउंड-ऑफ़"),
            money("net", "Net sales", "शुद्ध बिक्री"),
            integer("credit_notes", "Credit notes", "क्रेडिट नोट"),
            money("returns", "Returns", "वापसी"),
            money("net_after_returns", "Net after returns", "वापसी के बाद शुद्ध"));

    private final MoneyReportRepository repository;

    public SalesReportService(MoneyReportRepository repository) {
        this.repository = repository;
    }

    // ================================================================== sales

    /** The sales grouping: day (default), month, channel, location, staff, payment_method. */
    public static String salesGroup(String groupBy) {
        String value = groupBy == null || groupBy.isBlank() ? "day" : groupBy.trim().toLowerCase(Locale.ROOT);
        if (!SALES_GROUPS.contains(value)) {
            throw new InvalidRequestException("VALIDATION: groupBy must be one of " + String.join(", ", SALES_GROUPS));
        }
        return value;
    }

    static ReportTable salesTable(String group) {
        List<ReportTable.Column> columns = new ArrayList<>();
        switch (group) {
            case "day" -> columns.add(date("date", "Date", "तारीख़"));
            case "month" -> columns.add(text("month", "Month", "महीना"));
            case "channel" -> columns.add(text("channel", "Channel", "चैनल"));
            case "location" -> columns.add(text("location", "Location", "जगह"));
            case "staff" -> columns.add(text("staff", "Staff", "कर्मचारी"));
            default -> columns.add(text("payment_method", "Payment method", "भुगतान का तरीका"));
        }
        columns.addAll(SALES_FIGURES);
        return ReportTable.of(columns.toArray(new ReportTable.Column[0]));
    }

    /** The staff the answer names (staff grouping only). */
    public List<String> staffIds(ReportQuery q) {
        if (!"staff".equals(salesGroup(q.groupBy()))) {
            return List.of();
        }
        return repository.salesStaff(MoneyReportSupport.filter(q));
    }

    public ReportAnswer sales(ReportQuery q) {
        return buildSales(q, false, 0);
    }

    public int exportSales(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        return MoneyReportSupport.export(buildSales(q, true, maxRows), SALES, "Sales", "बिक्री", format, q.hindi(),
                out, maxRows);
    }

    ReportAnswer buildSales(ReportQuery q, boolean export, int maxRows) {
        String group = salesGroup(q.groupBy());
        ReportTable table = salesTable(group);
        DocFilter f = MoneyReportSupport.filter(q);
        Map<String, String> locations = MoneyReportSupport.locationNames(repository.locations(q.instituteId()));
        ReportAnswer a = MoneyReportSupport.answer(q, SALES);
        a.getFilters().put("group_by", group);
        Map<String, SalesSums> groups = new TreeMap<>();
        SalesSums all = new SalesSums();
        repository.salesDocuments(f, d -> {
            String key = groupKey(q, group, d, locations);
            groups.computeIfAbsent(key, k -> new SalesSums()).add(d);
            all.add(d);
        });
        ReportWarnings warnings = new ReportWarnings();
        warnReissues(f, warnings);
        MoneyReportSupport.Rows rows = new MoneyReportSupport.Rows(export, maxRows);
        String groupColumn = table.columns().get(0).key();
        groups.forEach((key, sums) -> {
            Map<String, Object> row = ReportTable.row();
            row.put(groupColumn, key);
            sums.putInto(row);
            rows.add(row);
        });
        rows.warnIfCut(warnings, SALES);
        a.setColumns(table.dto());
        a.setRows(rows.list());
        Map<String, Object> totals = MoneyReportSupport.totals();
        all.putInto(totals);
        a.setTotals(totals);
        a.setWarnings(warnings.list());
        return a;
    }

    private void warnReissues(DocFilter f, ReportWarnings warnings) {
        for (String pair : repository.reissuesInRange(f)) {
            warnings.add(ReportWarnings.REISSUE_COUNTED_ONCE, "a bill reissued with the buyer's GSTIN counts once "
                    + "(the first bill; no return): the GST registers list its credit note and new invoice", pair);
        }
    }

    static String groupKey(ReportQuery q, String group, SalesDocument d, Map<String, String> locations) {
        return switch (group) {
            case "day" -> d.day() == null ? "" : d.day().toString();
            case "month" -> d.day() == null ? "" : d.day().toString().substring(0, 7);
            case "channel" -> d.channel() == null ? NO_ORDER : d.channel();
            case "location" -> MoneyReportSupport.locationName(locations, d.locationId());
            case "staff" -> staffLabel(q, d);
            default -> d.paymentMethod() == null ? NO_ORDER : d.paymentMethod();
        };
    }

    /** POS and staff orders: the cashier or staff who placed it; an online order reads "Online". */
    static String staffLabel(ReportQuery q, SalesDocument d) {
        String channel = d.orderChannel() != null ? d.orderChannel() : d.channel();
        if ("POS".equals(channel) || "ADMIN".equals(channel)) {
            return d.staffId() == null ? UNKNOWN_STAFF : q.staffName(d.staffId());
        }
        return ONLINE;
    }

    /** The figures of one sales group. */
    static final class SalesSums {
        long invoices;
        long items;
        long notes;
        BigDecimal gross = BigDecimal.ZERO;
        BigDecimal discount = BigDecimal.ZERO;
        BigDecimal taxable = BigDecimal.ZERO;
        BigDecimal tax = BigDecimal.ZERO;
        BigDecimal roundOff = BigDecimal.ZERO;
        BigDecimal net = BigDecimal.ZERO;
        BigDecimal returns = BigDecimal.ZERO;

        void add(SalesDocument d) {
            if ("NOTE".equals(d.kind())) {
                notes++;
                returns = returns.add(d.total());
                return;
            }
            invoices++;
            items += d.items();
            gross = gross.add(d.lineAmount()).add(d.discount());
            discount = discount.add(d.discount());
            taxable = taxable.add(d.taxable());
            tax = tax.add(d.tax());
            roundOff = roundOff.add(d.roundOff());
            net = net.add(d.total());
        }

        void putInto(Map<String, Object> row) {
            row.put("invoices", invoices);
            row.put("items", items);
            row.put("gross", ReportTable.money(gross));
            row.put("discount", ReportTable.money(discount));
            row.put("taxable", ReportTable.money(taxable));
            row.put("tax", ReportTable.money(tax));
            row.put("round_off", ReportTable.money(roundOff));
            row.put("net", ReportTable.money(net));
            row.put("credit_notes", notes);
            row.put("returns", ReportTable.money(returns));
            row.put("net_after_returns", ReportTable.money(net.subtract(returns)));
        }
    }

    // ================================================================== products

    public static String productGroup(String groupBy) {
        String value = groupBy == null || groupBy.isBlank() ? "variant" : groupBy.trim().toLowerCase(Locale.ROOT);
        if (!PRODUCT_GROUPS.contains(value)) {
            throw new InvalidRequestException("VALIDATION: groupBy must be one of "
                    + String.join(", ", PRODUCT_GROUPS));
        }
        return value;
    }

    static ReportTable productsTable(String group) {
        List<ReportTable.Column> columns = new ArrayList<>();
        switch (group) {
            case "variant" -> {
                columns.add(text("product", "Product", "सामान"));
                columns.add(text("variant", "Variant", "प्रकार"));
                columns.add(text("sku", "SKU", "SKU"));
            }
            case "product" -> columns.add(text("product", "Product", "सामान"));
            case "collection" -> columns.add(text("collection", "Collection", "संग्रह"));
            default -> columns.add(text("category", "Category", "श्रेणी"));
        }
        columns.add(text("unit", "Unit", "इकाई"));
        columns.add(qty("sold", "Sold", "बिका"));
        columns.add(text("sold_text", "Sold (with unit)", "बिका (इकाई सहित)"));
        columns.add(qty("returned", "Returned", "वापस आया"));
        columns.add(text("returned_text", "Returned (with unit)", "वापस आया (इकाई सहित)"));
        columns.add(qty("net_units", "Net units", "शुद्ध मात्रा"));
        columns.add(text("net_text", "Net (with unit)", "शुद्ध (इकाई सहित)"));
        columns.add(money("net_value", "Net value (goods only)", "शुद्ध मूल्य (केवल सामान)"));
        columns.add(money("taxable", "Taxable value", "कर योग्य मूल्य"));
        columns.add(money("average_rate", "Average rate per unit", "प्रति इकाई औसत दर"));
        columns.add(text("average_rate_text", "Average rate", "औसत दर"));
        columns.add(integer("invoices", "Invoices", "इनवॉइस"));
        return ReportTable.of(columns.toArray(new ReportTable.Column[0]));
    }

    static final ReportTable NEVER_SOLD = ReportTable.of(
            text("product", "Product", "सामान"),
            text("sku", "SKU", "SKU"),
            text("unit", "Unit", "इकाई"));

    public ReportAnswer products(ReportQuery q) {
        return buildProducts(q, false, 0);
    }

    public int exportProducts(ReportQuery q, String format, OutputStream out, int maxRows) throws IOException {
        return MoneyReportSupport.export(buildProducts(q, true, maxRows), PRODUCTS, "Products", "सामान",
                format, q.hindi(), out, maxRows);
    }

    ReportAnswer buildProducts(ReportQuery q, boolean export, int maxRows) {
        String group = productGroup(q.groupBy());
        ReportTable table = productsTable(group);
        DocFilter f = MoneyReportSupport.filter(q);
        ReportWarnings warnings = new ReportWarnings();
        warnReissues(f, warnings);
        ReportAnswer a = MoneyReportSupport.answer(q, PRODUCTS);
        a.getFilters().put("group_by", group);

        Map<String, List<Membership>> membership = new LinkedHashMap<>();
        if ("collection".equals(group) || "category".equals(group)) {
            for (Membership m : repository.memberships(q.instituteId(),
                    "collection".equals(group) ? "COLLECTION" : "CATEGORY")) {
                membership.computeIfAbsent(m.packageId(), k -> new ArrayList<>()).add(m);
            }
        }

        Map<String, ProductSums> groups = new LinkedHashMap<>();
        ProductSums all = new ProductSums(null);
        Set<String> soldProducts = new HashSet<>();
        repository.productLines(f, line -> {
            if (line.qtyScale() == null) {
                warnings.add(ReportWarnings.SCALE_UNKNOWN, "a line's measuring scale is unknown; counted as 1",
                        line.documentId());
            }
            if ("INVOICE".equals(line.kind()) && line.packageId() != null) {
                soldProducts.add(line.packageId());
            }
            all.add(line);
            for (String[] key : keys(group, line, membership)) {
                groups.computeIfAbsent(key[0], k -> new ProductSums(key)).add(line);
            }
        });

        List<ProductSums> sorted = new ArrayList<>(groups.values());
        sorted.sort((x, y) -> {
            int c = y.netValue().compareTo(x.netValue());
            return c != 0 ? c : String.valueOf(x.label).compareTo(String.valueOf(y.label));
        });
        MoneyReportSupport.Rows rows = new MoneyReportSupport.Rows(export, maxRows);
        for (ProductSums sums : sorted) {
            rows.add(sums.row(group));
        }
        rows.warnIfCut(warnings, PRODUCTS);
        a.setColumns(table.dto());
        a.setRows(rows.list());

        boolean byCollection = "collection".equals(group) || "category".equals(group);
        Map<String, Object> totals = MoneyReportSupport.totals();
        if (byCollection) {
            // A product in two collections is in both rows: there is no grand total in this view.
            warnings.add(NO_GRAND_TOTAL, "a product in more than one " + group + " is counted in each; this view "
                    + "has no grand total", null);
        } else {
            totals.put("net_value", ReportTable.money(all.netValue()));
            totals.put("taxable", ReportTable.money(all.taxable));
            // Distinct invoices with goods: not the sum of the column (an invoice of two products
            // is one invoice), so it has its own key and the column's total cell stays empty.
            totals.put("distinct_invoices", (long) all.invoices.size());
            totals.put("sold_text", all.sold.text());
            totals.put("returned_text", all.returned.text());
            totals.put("net_text", all.net().text());
        }
        a.setTotals(totals);

        // Never sold: ACTIVE products with no invoice line in the range.
        List<Map<String, Object>> never = new ArrayList<>();
        for (ActiveProduct p : repository.activeProducts(q.instituteId())) {
            if (soldProducts.contains(p.packageId())) {
                continue;
            }
            Map<String, Object> row = ReportTable.row();
            row.put("product", p.productName());
            row.put("sku", p.sku());
            row.put("unit", p.unit());
            never.add(row);
        }
        Map<String, Object> neverTotals = MoneyReportSupport.totals();
        neverTotals.put("products", (long) never.size());
        if (never.size() > MoneyReportSupport.SCREEN_ROWS && !export) {
            warnings.add(MoneyReportSupport.ROWS_CUT, "showing the first " + MoneyReportSupport.SCREEN_ROWS
                    + " of " + never.size() + " rows; download the file for all of them", "never_sold");
            never = new ArrayList<>(never.subList(0, MoneyReportSupport.SCREEN_ROWS));
        }
        a.getSections().add(MoneyReportSupport.section("never_sold", "Never sold in these dates",
                "इन तारीख़ों में कभी नहीं बिका", NEVER_SOLD, never, neverTotals));
        a.setWarnings(warnings.list());
        return a;
    }

    /** The group keys of a line: one for variant and product, one per current collection otherwise. */
    static List<String[]> keys(String group, ProductLine line, Map<String, List<Membership>> membership) {
        String product = line.productName() == null ? line.packageId() : line.productName();
        return switch (group) {
            case "variant" -> List.<String[]>of(new String[]{"v:" + line.packageSessionId(), product,
                    line.variantName(), line.sku()});
            case "product" -> List.<String[]>of(new String[]{"p:" + line.packageId(), product, null, null});
            default -> {
                List<Membership> in = line.packageId() == null ? List.of()
                        : membership.getOrDefault(line.packageId(), List.of());
                if (in.isEmpty()) {
                    yield List.<String[]>of(new String[]{"c:", "(none)", null, null});
                }
                List<String[]> out = new ArrayList<>();
                for (Membership m : in) {
                    out.add(new String[]{"c:" + m.collectionId(), m.collectionName(), null, null});
                }
                yield out;
            }
        };
    }

    /** Display quantities by unit sign ("m", "pcs"): measured units add up only with their own kind. */
    static final class Units {
        final Map<String, BigDecimal> byUnit = new TreeMap<>();
        /** The scale and unit code of the first line, for the rate text. */
        int scale = 1;
        String unit;

        void add(long base, int qtyScale, String unitCode) {
            int s = Math.max(qtyScale, 1);
            BigDecimal display = BigDecimal.valueOf(base).divide(BigDecimal.valueOf(s), CommerceUnits.decimals(s),
                    RoundingMode.HALF_UP);
            byUnit.merge(key(s, unitCode), display, BigDecimal::add);
            if (unit == null) {
                scale = s;
                unit = unitCode;
            }
        }

        static String key(int scale, String unitCode) {
            if (CommerceUnits.measured(scale)) {
                String sign = CommerceUnits.sign(unitCode);
                return sign == null ? "" : sign;
            }
            return unitCode == null || unitCode.isBlank() ? "pcs" : unitCode.trim().toLowerCase(Locale.ROOT);
        }

        /** The quantity as a number when every line has one unit; null when units are mixed. */
        BigDecimal number() {
            if (byUnit.isEmpty()) {
                return BigDecimal.ZERO;
            }
            if (byUnit.size() > 1) {
                return null;
            }
            BigDecimal value = byUnit.values().iterator().next().stripTrailingZeros();
            return value.scale() < 0 ? value.setScale(0) : value;
        }

        /** "12 pcs, 34.5 m". */
        String text() {
            List<String> parts = new ArrayList<>();
            byUnit.forEach((sign, value) -> {
                BigDecimal v = value.stripTrailingZeros();
                String number = (v.scale() < 0 ? v.setScale(0) : v).toPlainString();
                parts.add(sign.isEmpty() ? number : number + " " + sign);
            });
            return parts.isEmpty() ? "0" : String.join(", ", parts);
        }

        Units minus(Units other) {
            Units out = new Units();
            out.scale = scale;
            out.unit = unit != null ? unit : other.unit;
            byUnit.forEach((k, v) -> out.byUnit.merge(k, v, BigDecimal::add));
            other.byUnit.forEach((k, v) -> out.byUnit.merge(k, v.negate(), BigDecimal::add));
            return out;
        }
    }

    /** The figures of one product group. */
    static final class ProductSums {
        final String label;
        final String variant;
        final String sku;
        final Units sold = new Units();
        final Units returned = new Units();
        BigDecimal soldValue = BigDecimal.ZERO;
        BigDecimal returnedValue = BigDecimal.ZERO;
        BigDecimal taxable = BigDecimal.ZERO;
        final Set<String> invoices = new HashSet<>();

        ProductSums(String[] key) {
            this.label = key == null ? null : key[1];
            this.variant = key == null ? null : key[2];
            this.sku = key == null ? null : key[3];
        }

        void add(ProductLine line) {
            int scale = line.qtyScale() == null ? 1 : line.qtyScale();
            if ("NOTE".equals(line.kind())) {
                returned.add(line.quantity(), scale, line.unit());
                returnedValue = returnedValue.add(line.amount());
                taxable = taxable.subtract(line.taxable());
            } else {
                sold.add(line.quantity(), scale, line.unit());
                soldValue = soldValue.add(line.amount());
                taxable = taxable.add(line.taxable());
                invoices.add(line.documentId());
            }
        }

        BigDecimal netValue() {
            return soldValue.subtract(returnedValue);
        }

        Units net() {
            return sold.minus(returned);
        }

        Map<String, Object> row(String group) {
            Map<String, Object> row = ReportTable.row();
            switch (group) {
                case "variant" -> {
                    row.put("product", label);
                    row.put("variant", variant);
                    row.put("sku", sku);
                }
                case "product" -> row.put("product", label);
                case "collection" -> row.put("collection", label);
                default -> row.put("category", label);
            }
            Units net = net();
            Units any = sold.unit != null ? sold : returned;
            row.put("unit", net.byUnit.size() > 1 ? null : any.unit);
            row.put("sold", sold.number());
            row.put("sold_text", sold.text());
            row.put("returned", returned.number());
            row.put("returned_text", returned.text());
            BigDecimal netUnits = net.number();
            row.put("net_units", netUnits);
            row.put("net_text", net.text());
            BigDecimal value = ReportTable.money(netValue());
            row.put("net_value", value);
            row.put("taxable", ReportTable.money(taxable));
            BigDecimal average = netUnits == null || netUnits.signum() == 0 ? null
                    : value.divide(netUnits, 2, RoundingMode.HALF_UP);
            row.put("average_rate", average);
            row.put("average_rate_text", average == null ? null
                    : "₹" + average.toPlainString() + CommerceUnits.rateSuffix(any.scale, any.unit));
            row.put("invoices", (long) invoices.size());
            return row;
        }
    }
}
