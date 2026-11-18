package vacademy.io.admin_core_service.features.commerce.document.pdf;

import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.service.AmountInWords;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRow;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * Fills the commerce document template. One template serves the four documents:
 * <ul>
 *   <li>TAX INVOICE (REGULAR mode): HSN and taxable value per line, one tax row per rate, an HSN
 *       summary, the buyer GSTIN when the sale is B2B.</li>
 *   <li>BILL OF SUPPLY (COMPOSITION mode): no tax columns or rows, with the composition
 *       declaration.</li>
 *   <li>INVOICE (UNREGISTERED mode): a plain invoice, no GSTIN, no tax.</li>
 *   <li>CREDIT NOTE: the same layout as the invoice it is against.</li>
 * </ul>
 * English text only for now; see the follow-up note on {@link CommercePdfRenderer}. Every value
 * is escaped, so the result is always well-formed XHTML.
 */
public final class CommerceDocumentHtml {

    private static final String TEMPLATE_RESOURCE = "/templates/commerce/commerce_document.html";
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);
    private static final String TEMPLATE = loadTemplate();

    private CommerceDocumentHtml() {
    }

    public static String build(DocumentView view) {
        boolean tax = view.getTaxHead() != null && view.getTaxHead() != TaxHead.NONE;
        boolean igst = view.getTaxHead() == TaxHead.IGST;
        String money = "INR".equalsIgnoreCase(view.getCurrency()) || view.getCurrency() == null
                ? (CommercePdfRenderer.unicodeFontAvailable() ? "₹" : "Rs. ")
                : esc(view.getCurrency()) + " ";

        return TEMPLATE
                .replace("{{title}}", title(view.getDocumentType()))
                .replace("{{number}}", esc(view.getNumber()))
                .replace("{{subtitle}}", subtitle(view))
                .replace("{{cancelled_block}}", view.isCancelled() ? "<div class=\"cancelled\">CANCELLED</div>" : "")
                .replace("{{seller_name}}", esc(view.getSellerName()))
                .replace("{{seller_address}}", multiline(view.getSellerAddress()))
                .replace("{{seller_tax_lines}}", sellerTaxLines(view))
                .replace("{{document_facts}}", documentFacts(view))
                .replace("{{buyer_name}}", esc(view.getBuyerName() == null ? "Customer" : view.getBuyerName()))
                .replace("{{buyer_lines}}", buyerLines(view))
                .replace("{{ship_to}}", shipTo(view))
                .replace("{{line_header}}", lineHeader(tax))
                .replace("{{line_rows}}", lineRows(view.getLines(), tax, money))
                .replace("{{tax_tables}}", tax ? taxTables(view, igst, money) : "")
                .replace("{{amount_in_words}}", esc(AmountInWords.rupees(view.getTotal())))
                .replace("{{notes}}", notes(view))
                .replace("{{total_rows}}", totalRows(view, tax, igst, money))
                .replace("{{footer}}", "This is a computer-generated document and needs no signature.");
    }

    static String title(DocumentType type) {
        return switch (type) {
            case TAX_INVOICE -> "TAX INVOICE";
            case BILL_OF_SUPPLY -> "BILL OF SUPPLY";
            case INVOICE -> "INVOICE";
            case CREDIT_NOTE -> "CREDIT NOTE";
            case DELIVERY_CHALLAN -> "DELIVERY CHALLAN";
        };
    }

    private static String subtitle(DocumentView view) {
        if (view.getDocumentType() == DocumentType.CREDIT_NOTE) {
            String against = "Against invoice " + esc(view.getAgainstInvoiceNumber());
            return view.getAgainstInvoiceDate() == null ? against
                    : against + " dated " + view.getAgainstInvoiceDate().format(DATE);
        }
        if (view.getDocumentType() == DocumentType.TAX_INVOICE) {
            return view.getBuyerGstin() != null ? "Original for recipient (B2B)" : "Original for recipient";
        }
        return "Original for recipient";
    }

    private static String sellerTaxLines(DocumentView view) {
        StringBuilder out = new StringBuilder();
        if (view.getSellerGstin() != null) {
            out.append("<div>GSTIN: ").append(esc(view.getSellerGstin())).append("</div>");
        }
        if (view.getSellerStateCode() != null) {
            out.append("<div>State code: ").append(esc(view.getSellerStateCode())).append("</div>");
        }
        return out.toString();
    }

    private static String documentFacts(DocumentView view) {
        StringBuilder out = new StringBuilder();
        String numberLabel = view.getDocumentType() == DocumentType.CREDIT_NOTE ? "Credit note no." : "Invoice no.";
        fact(out, numberLabel, view.getNumber());
        fact(out, "Date", view.getDate() == null ? null : view.getDate().format(DATE));
        fact(out, "Order no.", view.getOrderNumber());
        fact(out, "Place of supply (state code)", view.getPlaceOfSupplyState());
        return out.toString();
    }

    private static void fact(StringBuilder out, String label, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        out.append("<tr><td class=\"label\">").append(esc(label)).append("</td><td class=\"num\"><b>")
                .append(esc(value)).append("</b></td></tr>");
    }

    private static String buyerLines(DocumentView view) {
        StringBuilder out = new StringBuilder();
        if (view.getBillingAddress() != null) {
            out.append("<div>").append(multiline(view.getBillingAddress())).append("</div>");
        }
        if (view.getBuyerPhone() != null) {
            out.append("<div>Phone: ").append(esc(view.getBuyerPhone())).append("</div>");
        }
        if (view.getBuyerEmail() != null) {
            out.append("<div>Email: ").append(esc(view.getBuyerEmail())).append("</div>");
        }
        if (view.getBuyerGstin() != null) {
            out.append("<div><b>GSTIN: ").append(esc(view.getBuyerGstin())).append("</b></div>");
        }
        return out.toString();
    }

    private static String shipTo(DocumentView view) {
        String address = view.getShippingAddress() != null ? view.getShippingAddress() : view.getBillingAddress();
        return address == null ? "<div class=\"small\">Handed over at the counter</div>"
                : "<div>" + multiline(address) + "</div>";
    }

    private static String lineHeader(boolean tax) {
        StringBuilder out = new StringBuilder("<th style=\"width: 5%;\">#</th><th>Item</th>");
        if (tax) {
            out.append("<th style=\"width: 9%;\">HSN</th>");
        }
        out.append("<th class=\"num\" style=\"width: 10%;\">Qty</th>")
                .append("<th class=\"num\" style=\"width: 12%;\">Price</th>")
                .append("<th class=\"num\" style=\"width: 10%;\">Discount</th>");
        if (tax) {
            out.append("<th class=\"num\" style=\"width: 12%;\">Taxable</th>")
                    .append("<th class=\"num\" style=\"width: 7%;\">Tax %</th>");
        }
        out.append("<th class=\"num\" style=\"width: 13%;\">Amount</th>");
        return out.toString();
    }

    private static String lineRows(List<DocumentView.Line> lines, boolean tax, String money) {
        StringBuilder out = new StringBuilder();
        int index = 1;
        for (DocumentView.Line line : lines) {
            int scale = Math.max(1, line.getQtyScale());
            BigDecimal quantity = BigDecimal.valueOf(line.getQuantity())
                    .divide(BigDecimal.valueOf(scale), 3, RoundingMode.HALF_UP).stripTrailingZeros();
            BigDecimal price = line.getUnitPrice() == null ? null
                    : line.getUnitPrice().multiply(BigDecimal.valueOf(scale));
            out.append("<tr><td>").append(index++).append("</td><td>").append(esc(line.getDescription()));
            if (line.getSku() != null) {
                out.append("<div class=\"small\">SKU ").append(esc(line.getSku())).append("</div>");
            }
            out.append("</td>");
            if (tax) {
                out.append("<td>").append(esc(line.getHsnCode())).append("</td>");
            }
            out.append("<td class=\"num\">").append(quantity.toPlainString())
                    .append(line.getUnit() == null ? "" : " " + esc(line.getUnit())).append("</td>")
                    .append("<td class=\"num\">").append(amount(price, money)).append("</td>")
                    .append("<td class=\"num\">").append(amountOrDash(line.getDiscount(), money)).append("</td>");
            if (tax) {
                out.append("<td class=\"num\">").append(amount(line.getTaxableValue(), money)).append("</td>")
                        .append("<td class=\"num\">").append(percent(line.getRatePercent())).append("</td>");
            }
            out.append("<td class=\"num\">").append(amount(line.getAmount(), money)).append("</td></tr>\n");
        }
        return out.toString();
    }

    /** The tax rows, one per rate, and the HSN summary. */
    private static String taxTables(DocumentView view, boolean igst, String money) {
        StringBuilder out = new StringBuilder();
        out.append("<div class=\"label\">Tax by rate</div>").append(rateTable(view.getRateRows(), false, igst, money));
        if (view.getHsnRows() != null && !view.getHsnRows().isEmpty()) {
            out.append("<div class=\"gap\"></div><div class=\"label\">HSN summary</div>")
                    .append(rateTable(view.getHsnRows(), true, igst, money));
        }
        return out.toString();
    }

    private static String rateTable(List<TaxRateRow> rows, boolean withHsn, boolean igst, String money) {
        boolean cess = rows != null && rows.stream().anyMatch(r -> r.getCess() != null && r.getCess().signum() != 0);
        StringBuilder out = new StringBuilder("<table class=\"grid\"><thead><tr>");
        if (withHsn) {
            out.append("<th>HSN</th>");
        }
        out.append("<th class=\"num\">Rate</th><th class=\"num\">Taxable</th>");
        out.append(igst ? "<th class=\"num\">IGST</th>" : "<th class=\"num\">CGST</th><th class=\"num\">SGST</th>");
        if (cess) {
            out.append("<th class=\"num\">Cess</th>");
        }
        out.append("<th class=\"num\">Tax</th></tr></thead><tbody>");
        if (rows != null) {
            for (TaxRateRow row : rows) {
                out.append("<tr>");
                if (withHsn) {
                    out.append("<td>").append(esc(row.getHsnCode())).append("</td>");
                }
                out.append("<td class=\"num\">").append(percent(row.getRatePercent())).append("</td>")
                        .append("<td class=\"num\">").append(amount(row.getTaxableValue(), money)).append("</td>");
                if (igst) {
                    out.append("<td class=\"num\">").append(amount(row.getIgst(), money)).append("</td>");
                } else {
                    out.append("<td class=\"num\">").append(amount(row.getCgst(), money)).append("</td>")
                            .append("<td class=\"num\">").append(amount(row.getSgst(), money)).append("</td>");
                }
                if (cess) {
                    out.append("<td class=\"num\">").append(amount(row.getCess(), money)).append("</td>");
                }
                out.append("<td class=\"num\">").append(amount(row.getTaxAmount(), money)).append("</td></tr>");
            }
        }
        return out.append("</tbody></table>").toString();
    }

    private static String totalRows(DocumentView view, boolean tax, boolean igst, String money) {
        StringBuilder out = new StringBuilder();
        if (tax) {
            total(out, "Taxable value", view.getTaxableValue(), money, false);
            if (igst) {
                total(out, "IGST", view.getIgst(), money, false);
            } else {
                total(out, "CGST", view.getCgst(), money, false);
                total(out, "SGST", view.getSgst(), money, false);
            }
            if (view.getCess() != null && view.getCess().signum() != 0) {
                total(out, "Cess", view.getCess(), money, false);
            }
        }
        if (view.getRoundOff() != null && view.getRoundOff().signum() != 0) {
            total(out, "Round off", view.getRoundOff(), money, false);
        }
        total(out, view.getDocumentType() == DocumentType.CREDIT_NOTE ? "Credit total" : "Total", view.getTotal(),
                money, true);
        return out.toString();
    }

    private static void total(StringBuilder out, String label, BigDecimal value, String money, boolean grand) {
        out.append(grand ? "<tr class=\"grand\">" : "<tr>").append("<td>").append(esc(label))
                .append("</td><td class=\"num\">").append(amount(value, money)).append("</td></tr>");
    }

    private static String notes(DocumentView view) {
        StringBuilder out = new StringBuilder();
        if (view.getDocumentType() == DocumentType.BILL_OF_SUPPLY) {
            out.append("<div class=\"note\">Composition taxable person, not eligible to collect tax on supplies.</div>");
        }
        if (view.getDocumentType() == DocumentType.TAX_INVOICE || view.getDocumentType() == DocumentType.CREDIT_NOTE) {
            if (view.getTaxHead() != null && view.getTaxHead() != TaxHead.NONE) {
                out.append("<div class=\"note\">Prices include tax. The tax shown is included in the amounts.</div>");
            }
        }
        if (view.getReplacesInvoiceNumber() != null) {
            out.append("<div class=\"note\">This invoice replaces invoice ")
                    .append(esc(view.getReplacesInvoiceNumber())).append(".</div>");
        }
        if (view.getReason() != null) {
            out.append("<div class=\"note\">Reason: ").append(esc(view.getReason())).append("</div>");
        }
        return out.toString();
    }

    // ------------------------------------------------------------------ text helpers

    private static String amount(BigDecimal value, String money) {
        if (value == null) {
            return "";
        }
        BigDecimal scaled = value.setScale(2, RoundingMode.HALF_UP);
        return (scaled.signum() < 0 ? "-" : "") + money + scaled.abs().toPlainString();
    }

    private static String amountOrDash(BigDecimal value, String money) {
        return value == null || value.signum() == 0 ? "-" : amount(value, money);
    }

    private static String percent(BigDecimal value) {
        if (value == null) {
            return "";
        }
        BigDecimal stripped = value.stripTrailingZeros();
        return (stripped.scale() < 0 ? stripped.setScale(0) : stripped).toPlainString() + "%";
    }

    private static String multiline(String value) {
        return esc(value).replace("\n", "<br/>");
    }

    /** XML text escape. Control characters that XML 1.0 forbids are dropped. */
    public static String esc(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                // A brace is escaped so that no value can spell a template placeholder.
                case '{' -> out.append("&#123;");
                case '\r' -> { }
                default -> {
                    if (c >= 0x20 || c == '\n' || c == '\t') {
                        out.append(c);
                    }
                }
            }
        }
        return out.toString();
    }

    private static String loadTemplate() {
        try (InputStream in = CommerceDocumentHtml.class.getResourceAsStream(TEMPLATE_RESOURCE)) {
            if (in == null) {
                throw new IllegalStateException("commerce document template is missing: " + TEMPLATE_RESOURCE);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("commerce document template could not be read", e);
        }
    }
}
