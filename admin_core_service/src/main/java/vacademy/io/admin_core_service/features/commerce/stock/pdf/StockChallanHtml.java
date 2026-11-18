package vacademy.io.admin_core_service.features.commerce.stock.pdf;

import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentHtml;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommercePdfRenderer;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * The delivery challan of a transfer as XHTML for {@link CommercePdfRenderer} (A4). English text
 * only: openhtmltopdf does not shape Devanagari yet, so an item name or a place that contains it
 * prints the SKU or the location code instead. Every value is escaped.
 */
public final class StockChallanHtml {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);

    private StockChallanHtml() {
    }

    /** One place on the challan. */
    public record Place(String code, String name, String address, String stateCode, String gstin) {
    }

    /** One line: quantities in base units, values per base unit. */
    public record Line(String sku, String itemName, String variantName, String hsnCode, int quantity, int qtyScale,
                       String unit, BigDecimal unitValue) {
    }

    /**
     * @param externalDocument the number of the external document for a transfer between two
     *                         GSTINs (then the title is "STOCK TRANSFER NOTE"); null for a challan
     */
    public record Challan(String documentNumber, LocalDate documentDate, String transferNumber,
                          String externalDocument, Place from, Place to, List<Line> lines, String ewayBillNo,
                          String note) {
    }

    public static String build(Challan challan) {
        String money = CommercePdfRenderer.unicodeFontAvailable() ? "₹" : "Rs. ";
        boolean external = challan.externalDocument() != null;
        StringBuilder out = new StringBuilder(4096);
        out.append("<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"en\"><head>")
                .append("<meta charset=\"UTF-8\"/><title>").append(esc(challan.documentNumber())).append("</title>")
                .append("<style>")
                .append("@page { size: A4; margin: 14mm 12mm 16mm 12mm; }")
                .append("body { font-family: 'DejaVu Sans', sans-serif; font-size: 9pt; color: #111111; }")
                .append("h1 { font-size: 14pt; margin: 0 0 1mm 0; text-align: center; letter-spacing: 1px; }")
                .append(".sub { text-align: center; font-size: 8pt; color: #444444; margin-bottom: 4mm; }")
                .append("table { width: 100%; border-collapse: collapse; }")
                .append(".head td { vertical-align: top; padding: 0 0 3mm 0; }")
                .append(".box { border: 1px solid #999999; padding: 2mm; }")
                .append(".label { font-size: 7.5pt; color: #555555; text-transform: uppercase; }")
                .append(".name { font-size: 10.5pt; font-weight: bold; }")
                .append(".grid th, .grid td { border: 1px solid #999999; padding: 1.4mm 1.6mm; }")
                .append(".grid th { background: #eeeeee; font-size: 8pt; text-align: left; }")
                .append(".grid tr { page-break-inside: avoid; }")
                .append(".num { text-align: right; white-space: nowrap; }")
                .append(".small { font-size: 8pt; color: #333333; }")
                .append(".sign td { height: 22mm; vertical-align: bottom; border: 1px solid #999999; padding: 2mm; }")
                .append("</style></head><body>");
        out.append("<h1>").append(external ? "STOCK TRANSFER NOTE" : "DELIVERY CHALLAN").append("</h1>");
        out.append("<div class=\"sub\">Purpose: transfer of goods between own places of business (not a sale)");
        if (external) {
            out.append("<br/>Document: External invoice ").append(esc(challan.externalDocument()));
        }
        out.append("</div>");

        out.append("<table class=\"head\"><tr><td style=\"width: 50%; padding-right: 2mm;\">");
        place(out, "From", challan.from());
        out.append("</td><td style=\"width: 50%; padding-left: 2mm;\">");
        place(out, "To", challan.to());
        out.append("</td></tr></table>");

        out.append("<table class=\"head\"><tr><td><div class=\"box\"><table>");
        fact(out, external ? "Document no." : "Challan no.", challan.documentNumber());
        fact(out, "Date", challan.documentDate() == null ? null : challan.documentDate().format(DATE));
        fact(out, "Transfer no.", challan.transferNumber());
        fact(out, "E-way bill no.", challan.ewayBillNo());
        out.append("</table></div></td></tr></table>");

        out.append("<table class=\"grid\"><tr><th>S.No</th><th>SKU</th><th>Item</th><th>HSN</th>")
                .append("<th class=\"num\">Quantity</th><th class=\"num\">Value per unit</th>")
                .append("<th class=\"num\">Value</th></tr>");
        int number = 0;
        BigDecimal total = BigDecimal.ZERO;
        boolean anyValue = false;
        for (Line line : challan.lines()) {
            number++;
            int scale = Math.max(line.qtyScale(), 1);
            BigDecimal perDisplayUnit = line.unitValue() == null ? null
                    : line.unitValue().multiply(BigDecimal.valueOf(scale));
            BigDecimal value = line.unitValue() == null ? null
                    : line.unitValue().multiply(BigDecimal.valueOf(line.quantity())).setScale(2, RoundingMode.HALF_UP);
            if (value != null) {
                total = total.add(value);
                anyValue = true;
            }
            out.append("<tr><td>").append(number).append("</td><td>").append(esc(line.sku())).append("</td><td>")
                    .append(esc(englishOr(line.itemName(), line.sku())));
            String variant = englishOr(line.variantName(), null);
            if (variant != null && !variant.equals(line.itemName()) && !variant.equals(line.sku())) {
                out.append("<div class=\"small\">").append(esc(variant)).append("</div>");
            }
            out.append("</td><td>").append(esc(line.hsnCode())).append("</td><td class=\"num\">")
                    .append(esc(quantity(line.quantity(), scale, line.unit()))).append("</td><td class=\"num\">")
                    .append(perDisplayUnit == null ? "-" : money + indian(perDisplayUnit)).append("</td><td class=\"num\">")
                    .append(value == null ? "-" : money + indian(value)).append("</td></tr>");
        }
        out.append("<tr><td colspan=\"6\" class=\"num\"><b>Total value</b></td><td class=\"num\"><b>")
                .append(anyValue ? money + indian(total) : "-").append("</b></td></tr></table>");

        if (challan.note() != null && !challan.note().isBlank()) {
            out.append("<p class=\"small\">Note: ").append(esc(englishOr(challan.note(), ""))).append("</p>");
        }
        out.append("<table class=\"sign\" style=\"margin-top: 6mm;\"><tr>")
                .append("<td style=\"width: 50%;\"><div class=\"label\">Dispatched by (name, sign)</div></td>")
                .append("<td style=\"width: 50%;\"><div class=\"label\">Received by (name, sign, date)</div></td>")
                .append("</tr></table>");
        out.append("</body></html>");
        return out.toString();
    }

    private static void place(StringBuilder out, String label, Place place) {
        out.append("<div class=\"box\"><div class=\"label\">").append(label).append("</div>");
        if (place != null) {
            out.append("<div class=\"name\">").append(esc(englishOr(place.name(), place.code()))).append("</div>");
            String address = englishOr(place.address(), null);
            if (address != null) {
                out.append("<div>").append(esc(address)).append("</div>");
            }
            if (place.stateCode() != null) {
                out.append("<div>State code: ").append(esc(place.stateCode())).append("</div>");
            }
            if (place.gstin() != null) {
                out.append("<div>GSTIN: ").append(esc(place.gstin())).append("</div>");
            }
        }
        out.append("</div>");
    }

    private static void fact(StringBuilder out, String label, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        out.append("<tr><td class=\"label\">").append(esc(label)).append("</td><td class=\"num\"><b>")
                .append(esc(value)).append("</b></td></tr>");
    }

    /** {@code text}, or {@code fallback} when the text is empty or holds Devanagari. */
    public static String englishOr(String text, String fallback) {
        if (text == null || text.isBlank() || hasDevanagari(text)) {
            return fallback;
        }
        return text;
    }

    public static boolean hasDevanagari(String text) {
        return text != null && text.codePoints().anyMatch(cp -> cp >= 0x0900 && cp <= 0x097F);
    }

    /** {@code 15} base units of a scale-10 item in MTR: "1.5 MTR". */
    public static String quantity(int baseUnits, int qtyScale, String unit) {
        BigDecimal shown = BigDecimal.valueOf(baseUnits)
                .divide(BigDecimal.valueOf(Math.max(qtyScale, 1)), 3, RoundingMode.HALF_UP).stripTrailingZeros();
        String number = shown.scale() < 0 ? shown.setScale(0).toPlainString() : shown.toPlainString();
        return unit == null || unit.isBlank() ? number : number + " " + unit;
    }

    /** Indian digit grouping with two decimals: 1234567.5 gives "12,34,567.50". */
    public static String indian(BigDecimal amount) {
        BigDecimal scaled = amount.setScale(2, RoundingMode.HALF_UP);
        String sign = scaled.signum() < 0 ? "-" : "";
        String plain = scaled.abs().toPlainString();
        int dot = plain.indexOf('.');
        String whole = plain.substring(0, dot);
        String fraction = plain.substring(dot);
        StringBuilder grouped = new StringBuilder();
        if (whole.length() <= 3) {
            grouped.append(whole);
        } else {
            String head = whole.substring(0, whole.length() - 3);
            String tail = whole.substring(whole.length() - 3);
            StringBuilder pairs = new StringBuilder();
            for (int i = head.length(); i > 0; i -= 2) {
                int start = Math.max(i - 2, 0);
                pairs.insert(0, head.substring(start, i)).insert(0, start > 0 ? "," : "");
            }
            grouped.append(pairs).append(',').append(tail);
        }
        return sign + grouped + fraction;
    }

    private static String esc(String value) {
        return CommerceDocumentHtml.esc(value);
    }
}
