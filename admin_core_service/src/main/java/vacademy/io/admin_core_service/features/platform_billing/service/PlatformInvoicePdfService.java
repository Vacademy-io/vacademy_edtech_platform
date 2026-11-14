package vacademy.io.admin_core_service.features.platform_billing.service;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Renders platform tax documents to a single-page A4 PDF: the GST tax invoice for a
 * {@link PlatformInvoice} and the GST credit note for a {@link PlatformCreditNote}.
 *
 * Rendered on demand from the persisted rows — nothing is uploaded to S3, so documents that
 * pre-date this renderer are downloadable too. Same openhtmltopdf-pdfbox + bundled DejaVuSans
 * approach as the student fee invoice pipeline, so "₹" renders.
 *
 * <h3>Brand (owner decisions D1/D2)</h3>
 * <ul>
 *   <li>{@link BrandMode#VACADEMY}: the trade name (and logo, when {@code brand_logo_url} is a
 *       reachable https PNG/JPEG) next to the legal supplier.</li>
 *   <li>{@link BrandMode#NEUTRAL}: the legal supplier only — its name, address and GSTIN, which
 *       Rule 46 requires. No trade name, no logo, no brand word anywhere (text, footer or PDF
 *       metadata).</li>
 * </ul>
 * The mode is the one frozen on the invoice / credit note, else the payment's, else the
 * institute's current mode; unknown = NEUTRAL.
 *
 * <h3>Other rules</h3>
 * The status badge comes from the payment (PAID, or PAID (OFFLINE) for a manual payment; none
 * otherwise) instead of a hard-coded PAID (F6). The footer depends on the item kind. Series-v2
 * documents print their date in Asia/Kolkata from the stored instant; legacy INV-AICRED invoices
 * print exactly as they always did.
 */
@Slf4j
@Service
public class PlatformInvoicePdfService {

    private static final String FONT_RESOURCE = "/fonts/DejaVuSans.ttf";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);

    static final String FOOTER_SUBSCRIPTION = "Subscription to hosted AI software services for the service period "
            + "stated. Usage outside the plan is billed separately as AI credits.";
    static final String FOOTER_PACK_NEUTRAL = "Prepaid AI credits for hosted AI software services. Credits are "
            + "non-transferable and non-refundable once consumed.";
    /** Pre-V590 pack footer, kept for VACADEMY-brand pack invoices. */
    static final String FOOTER_PACK_VACADEMY_TEMPLATE = "Supply of AI credits for use on the %s platform. "
            + "Credits are non-transferable and non-refundable once consumed.";

    private final PlatformInvoiceRepository invoiceRepository;
    private final PlatformInvoiceLineItemRepository lineItemRepository;

    @Autowired(required = false)
    private PlatformPaymentRepository paymentRepository;
    @Autowired(required = false)
    private PlatformPaymentConfigService configService;
    @Autowired(required = false)
    private BrandModeService brandModeService;

    private final Map<String, Object[]> logoCache = new ConcurrentHashMap<>();
    private static final long LOGO_TTL_MILLIS = 60 * 60_000L;
    private static final int LOGO_MAX_BYTES = 512 * 1024;

    public PlatformInvoicePdfService(
            PlatformInvoiceRepository invoiceRepository,
            PlatformInvoiceLineItemRepository lineItemRepository) {
        this.invoiceRepository = invoiceRepository;
        this.lineItemRepository = lineItemRepository;
    }

    /** Test seam. */
    void setCollaborators(PlatformPaymentRepository paymentRepository, PlatformPaymentConfigService configService,
                          BrandModeService brandModeService) {
        this.paymentRepository = paymentRepository;
        this.configService = configService;
        this.brandModeService = brandModeService;
    }

    // ─────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────

    public byte[] renderPdf(String invoiceId) {
        PlatformInvoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        return renderPdf(invoice);
    }

    public byte[] renderPdf(PlatformInvoice invoice) {
        List<PlatformInvoiceLineItem> lines = lineItemRepository.findByPlatformInvoiceId(invoice.getId());
        PlatformPayment payment = payment(invoice.getPlatformPaymentId());
        BrandMode mode = brandFor(invoice.getBrandMode(), invoice.getBuyerInstituteId(), payment);
        return toPdf(buildHtml(invoice, lines, payment, brandIdentity(mode)), invoice.getInvoiceNumber());
    }

    public byte[] renderCreditNotePdf(PlatformCreditNote note) {
        PlatformInvoice original = invoiceRepository.findById(note.getInvoiceId()).orElse(null);
        BrandMode mode = brandFor(note.getBrandMode(), note.getBuyerInstituteId(),
                payment(note.getPlatformPaymentId()));
        return toPdf(buildCreditNoteHtml(note, original, brandIdentity(mode)), note.getCreditNoteNumber());
    }

    /** Download / attachment name; "/" in a v2 number is not allowed in a file name. */
    public String fileName(PlatformInvoice invoice) {
        return safeFileName(invoice.getInvoiceNumber()) + ".pdf";
    }

    public String fileName(PlatformCreditNote note) {
        return safeFileName(note.getCreditNoteNumber()) + ".pdf";
    }

    static String safeFileName(String number) {
        return number == null ? "document" : number.replace('/', '-');
    }

    // ─────────────────────────────────────────────────────────────────
    // Brand
    // ─────────────────────────────────────────────────────────────────

    /** What the document may show about the seller's brand. */
    record BrandIdentity(BrandMode mode, String tradeName, String logoDataUri) {
        static BrandIdentity neutral() {
            return new BrandIdentity(BrandMode.NEUTRAL, null, null);
        }

        boolean vacademy() {
            return mode == BrandMode.VACADEMY && tradeName != null && !tradeName.isBlank();
        }
    }

    BrandMode brandFor(String frozen, String instituteId, PlatformPayment payment) {
        BrandMode m = BrandMode.parse(frozen);
        if (m != null) {
            return m;
        }
        String paymentMode = payment == null ? null : payment.getBrandMode();
        if (brandModeService != null) {
            return brandModeService.resolve(instituteId, paymentMode);
        }
        BrandMode p = BrandMode.parse(paymentMode);
        return p != null ? p : BrandMode.NEUTRAL;
    }

    BrandIdentity brandIdentity(BrandMode mode) {
        if (mode != BrandMode.VACADEMY) {
            return BrandIdentity.neutral();
        }
        PlatformPaymentConfig cfg = null;
        try {
            cfg = configService == null ? null : configService.load();
        } catch (Exception e) {
            log.debug("platform_payment_config unavailable for brand identity: {}", e.getMessage());
        }
        String trade = cfg != null && notBlank(cfg.getTradeName()) ? cfg.getTradeName().trim() : "Vacademy";
        String logo = cfg == null ? null : logoDataUri(cfg.getBrandLogoUrl());
        return new BrandIdentity(BrandMode.VACADEMY, trade, logo);
    }

    /**
     * Fetches the configured logo once an hour (3 s timeout, https, PNG/JPEG, at most 512 KB) and
     * inlines it as a data URI, so rendering never depends on the network beyond that. Any
     * failure renders the document without a logo.
     */
    String logoDataUri(String url) {
        if (!notBlank(url) || !url.trim().toLowerCase(Locale.ROOT).startsWith("https://")) {
            return null;
        }
        String key = url.trim();
        long now = System.currentTimeMillis();
        Object[] hit = logoCache.get(key);
        if (hit != null && (long) hit[0] > now) {
            return (String) hit[1];
        }
        String value = null;
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
                    .followRedirects(HttpClient.Redirect.NORMAL).build();
            HttpResponse<byte[]> resp = client.send(HttpRequest.newBuilder(URI.create(key))
                    .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
            String type = resp.headers().firstValue("content-type").orElse("").toLowerCase(Locale.ROOT);
            byte[] body = resp.body();
            if (resp.statusCode() == 200 && body != null && body.length > 0 && body.length <= LOGO_MAX_BYTES
                    && (type.startsWith("image/png") || type.startsWith("image/jpeg"))) {
                String mime = type.startsWith("image/png") ? "image/png" : "image/jpeg";
                value = "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(body);
            }
        } catch (Exception e) {
            log.warn("Brand logo fetch failed ({}); rendering without it", e.getMessage());
        }
        logoCache.put(key, new Object[] { now + (value == null ? 10 * 60_000L : LOGO_TTL_MILLIS), value });
        return value;
    }

    private PlatformPayment payment(String id) {
        if (paymentRepository == null || id == null) {
            return null;
        }
        try {
            return paymentRepository.findById(id).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // PDF
    // ─────────────────────────────────────────────────────────────────

    private byte[] toPdf(String xhtml, String number) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            for (String family : new String[] { "DejaVu Sans", "sans-serif", "Arial", "Helvetica" }) {
                builder.useFont(() -> fontStream(), family);
            }
            builder.withHtmlContent(xhtml, "file:///");
            builder.useDefaultPageSize(210f, 297f, PdfRendererBuilder.PageSizeUnits.MM);
            builder.toStream(out);
            builder.run();
            return out.toByteArray();
        } catch (Exception e) {
            log.error("Failed to render platform document PDF {}: {}", number, e.getMessage(), e);
            throw new VacademyException("Failed to render invoice PDF: " + e.getMessage());
        }
    }

    private static InputStream fontStream() {
        return PlatformInvoicePdfService.class.getResourceAsStream(FONT_RESOURCE);
    }

    // ─────────────────────────────────────────────────────────────────
    // HTML (hand-built XHTML — every dynamic value passes through esc())
    // ─────────────────────────────────────────────────────────────────

    /** Legacy signature (no payment, brand-neutral); kept for callers and tests. */
    String buildHtml(PlatformInvoice inv, List<PlatformInvoiceLineItem> lines) {
        return buildHtml(inv, lines, null, BrandIdentity.neutral());
    }

    String buildHtml(PlatformInvoice inv, List<PlatformInvoiceLineItem> lines, PlatformPayment payment,
                     BrandIdentity brand) {
        boolean export = Boolean.TRUE.equals(inv.getIsExport());
        boolean intra = (inv.getCgstAmountMinor() != null && inv.getCgstAmountMinor() > 0)
                || (inv.getSgstAmountMinor() != null && inv.getSgstAmountMinor() > 0);
        String cur = inv.getCurrency() == null ? "INR" : inv.getCurrency();
        boolean b2b = notBlank(inv.getBuyerGstin());
        boolean subscription = inv.getSourceKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION;

        StringBuilder sb = new StringBuilder(8_000);
        head(sb, inv.getInvoiceNumber());

        // Header
        sb.append("<table class=\"row\"><tr><td>");
        brandBlock(sb, brand);
        sb.append("<h1>TAX INVOICE</h1>")
          .append("<div class=\"muted\" style=\"margin-top:4px;\">")
          .append(export ? "Export of services — zero-rated under GST"
                         : (b2b ? "B2B supply — GST registered recipient" : "B2C supply"))
          .append("</div></td><td class=\"r\">");
        String badge = badge(payment);
        if (badge != null) {
            sb.append("<span class=\"badge\">").append(esc(badge)).append("</span>");
        }
        sb.append("<table class=\"kv\" style=\"margin-left:auto;margin-top:8px;\">")
          .append(kv("Invoice No.", inv.getInvoiceNumber()))
          .append(kv("Invoice Date", invoiceDateText(inv)))
          .append(kv("Place of Supply", placeOfSupplyLabel(inv.getPlaceOfSupply(), export)))
          .append(kv("Payment Ref.", inv.getPlatformPaymentId()));
        String period = servicePeriodText(inv.getServicePeriodStart(), inv.getServicePeriodEnd());
        if (period != null) {
            sb.append(kv("Service Period", period));
        }
        sb.append("</table></td></tr></table>");

        parties(sb, brand, inv.getSupplierLegalName(), inv.getSupplierAddress(), inv.getSupplierGstin(),
                inv.getSupplierStateCode(), inv.getBuyerLegalName(), inv.getBuyerAddress(), inv.getBuyerGstin(),
                inv.getBuyerStateCode());

        // Line items
        itemsHeader(sb, export, intra);
        int i = 1;
        for (PlatformInvoiceLineItem l : lines) {
            itemRow(sb, i++, l.getDescription(), l.getHsnSacCode(), qty(l.getQuantity()), l.getBaseAmountMinor(),
                    l.getCgstAmountMinor(), l.getCgstRateBps(), l.getSgstAmountMinor(), l.getSgstRateBps(),
                    l.getIgstAmountMinor(), l.getIgstRateBps(), l.getTotalAmountMinor(), cur, export, intra);
        }
        sb.append("</tbody></table>");

        totals(sb, inv.getBaseAmountMinor(), inv.getCgstAmountMinor(), inv.getSgstAmountMinor(),
                inv.getIgstAmountMinor(), inv.getTotalAmountMinor(), cur, export, intra, "Total");

        // Footer
        String kindLine = subscription ? FOOTER_SUBSCRIPTION
                : (brand.vacademy() ? String.format(FOOTER_PACK_VACADEMY_TEMPLATE, brand.tradeName())
                                    : FOOTER_PACK_NEUTRAL);
        sb.append("<div class=\"foot\">")
          .append("<div>").append(esc(kindLine)).append("</div>")
          .append("<div style=\"margin-top:4px;\">")
          .append(export ? "Zero-rated export of services under Section 16 of the IGST Act, 2017. "
                         : (intra ? "Intra-state supply — CGST + SGST charged. " : "Inter-state supply — IGST charged. "))
          .append("Tax is payable on reverse charge basis: No.</div>")
          .append("<div style=\"margin-top:4px;\">This is a computer-generated invoice and does not require a physical signature.</div>")
          .append("</div>");

        sb.append("</body></html>");
        return sb.toString();
    }

    String buildCreditNoteHtml(PlatformCreditNote cn, PlatformInvoice original, BrandIdentity brand) {
        String cur = cn.getCurrency() == null ? "INR" : cn.getCurrency();
        boolean export = "EXPORT".equalsIgnoreCase(cn.getTaxHead()) || "96".equals(cn.getPlaceOfSupply());
        boolean intra = "CGST_SGST".equalsIgnoreCase(cn.getTaxHead());
        String originalDate = original != null ? invoiceDateText(original)
                : (cn.getInvoiceIssuedAt() == null ? "" : cn.getInvoiceIssuedAt()
                        .atZone(PlatformDocumentSequenceService.IST).format(DATE_FMT));

        StringBuilder sb = new StringBuilder(8_000);
        head(sb, cn.getCreditNoteNumber());

        sb.append("<table class=\"row\"><tr><td>");
        brandBlock(sb, brand);
        sb.append("<h1>CREDIT NOTE</h1>")
          .append("<div class=\"muted\" style=\"margin-top:4px;\">Issued under Section 34 of the CGST Act, 2017</div>")
          .append("</td><td class=\"r\">")
          .append("<table class=\"kv\" style=\"margin-left:auto;margin-top:8px;\">")
          .append(kv("Credit Note No.", cn.getCreditNoteNumber()))
          .append(kv("Credit Note Date", cn.getIssuedAt() == null ? ""
                  : cn.getIssuedAt().atZone(PlatformDocumentSequenceService.IST).format(DATE_FMT)))
          .append(kv("Against Invoice", cn.getInvoiceNumber()))
          .append(kv("Invoice Date", originalDate))
          .append(kv("Place of Supply", placeOfSupplyLabel(cn.getPlaceOfSupply(), export)));
        if (notBlank(cn.getVendorRefundId())) {
            sb.append(kv("Refund Ref.", cn.getVendorRefundId()));
        }
        sb.append("</table></td></tr></table>");

        parties(sb, brand, cn.getSupplierLegalName(), cn.getSupplierAddress(), cn.getSupplierGstin(),
                cn.getSupplierStateCode(), cn.getBuyerLegalName(), cn.getBuyerAddress(), cn.getBuyerGstin(),
                cn.getBuyerStateCode());

        itemsHeader(sb, export, intra);
        itemRow(sb, 1, cn.getDescription(), cn.getHsnSacCode(), "1", cn.getBaseAmountMinor(),
                cn.getCgstAmountMinor(), cn.getCgstRateBps(), cn.getSgstAmountMinor(), cn.getSgstRateBps(),
                cn.getIgstAmountMinor(), cn.getIgstRateBps(), cn.getTotalAmountMinor(), cur, export, intra);
        sb.append("</tbody></table>");

        totals(sb, cn.getBaseAmountMinor(), cn.getCgstAmountMinor(), cn.getSgstAmountMinor(),
                cn.getIgstAmountMinor(), cn.getTotalAmountMinor(), cur, export, intra, "Total credit");

        sb.append("<div class=\"muted\" style=\"margin-top:10px;\">Reason: <b>")
          .append(esc(nz(cn.getReason(), "Refund"))).append("</b></div>");

        sb.append("<div class=\"foot\">")
          .append("<div>Credit note against tax invoice ").append(esc(cn.getInvoiceNumber()))
          .append(originalDate.isEmpty() ? "" : " dated " + esc(originalDate))
          .append(". The taxable value and tax shown above reduce that invoice.</div>")
          .append("<div style=\"margin-top:4px;\">")
          .append(export ? "Zero-rated export of services. "
                         : (intra ? "Intra-state supply — CGST + SGST reversed. " : "Inter-state supply — IGST reversed. "))
          .append("Tax is payable on reverse charge basis: No.</div>")
          .append("<div style=\"margin-top:4px;\">This is a computer-generated credit note and does not require a physical signature.</div>")
          .append("</div>");

        sb.append("</body></html>");
        return sb.toString();
    }

    // ── shared fragments ──

    private static void head(StringBuilder sb, String title) {
        sb.append("<!DOCTYPE html><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><meta charset=\"UTF-8\"/>")
          .append("<title>").append(esc(title)).append("</title>")
          .append("<style>")
          .append("@page{size:A4;margin:18mm 16mm;}")
          .append("body{font-family:'DejaVu Sans',sans-serif;font-size:10.5px;color:#111827;margin:0;}")
          .append("h1{font-size:20px;margin:0;letter-spacing:.5px;}")
          .append(".muted{color:#6b7280;}")
          .append(".row{width:100%;border-collapse:collapse;}")
          .append(".row td{vertical-align:top;padding:0;}")
          .append(".box{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;}")
          .append(".label{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:4px;}")
          .append(".kv td{padding:2px 0;}")
          .append(".kv td.k{color:#6b7280;padding-right:14px;white-space:nowrap;}")
          .append("table.items{width:100%;border-collapse:collapse;margin-top:16px;}")
          .append("table.items th{background:#f3f4f6;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#374151;padding:7px 8px;border:1px solid #e5e7eb;text-align:left;}")
          .append("table.items td{padding:8px;border:1px solid #e5e7eb;}")
          .append(".r{text-align:right;} .c{text-align:center;}")
          .append("table.totals{border-collapse:collapse;margin-top:12px;width:62mm;margin-left:auto;}")
          .append("table.totals td{padding:4px 6px;}")
          .append("table.totals tr.grand td{border-top:2px solid #111827;font-weight:bold;font-size:12px;padding-top:7px;}")
          .append(".badge{display:inline-block;border:1px solid #374151;color:#374151;border-radius:4px;padding:2px 7px;font-size:9px;font-weight:bold;letter-spacing:.5px;}")
          .append(".brand{font-size:13px;font-weight:bold;margin-bottom:6px;}")
          .append(".foot{margin-top:26px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:9px;color:#6b7280;}")
          .append("</style></head><body>");
    }

    /** VACADEMY only: logo + trade name above the title. NEUTRAL: nothing. */
    private static void brandBlock(StringBuilder sb, BrandIdentity brand) {
        if (!brand.vacademy()) {
            return;
        }
        sb.append("<div class=\"brand\">");
        if (brand.logoDataUri() != null) {
            sb.append("<img src=\"").append(esc(brand.logoDataUri()))
              .append("\" alt=\"\" style=\"height:26px;vertical-align:middle;margin-right:8px;\"/>");
        }
        sb.append(esc(brand.tradeName())).append("</div>");
    }

    private static void parties(StringBuilder sb, BrandIdentity brand,
                                String supName, String supAddr, String supGstin, String supState,
                                String buyName, String buyAddr, String buyGstin, String buyState) {
        boolean b2b = notBlank(buyGstin);
        sb.append("<table class=\"row\" style=\"margin-top:18px;\"><tr>")
          .append("<td style=\"width:50%;padding-right:6px;\"><div class=\"box\">")
          .append("<div class=\"label\">Supplier</div>")
          .append("<div style=\"font-weight:bold;font-size:12px;\">").append(esc(supName)).append("</div>");
        if (brand.vacademy()) {
            sb.append("<div class=\"muted\">Trade name: ").append(esc(brand.tradeName())).append("</div>");
        }
        sb.append("<div class=\"muted\" style=\"margin-top:3px;white-space:pre-line;\">").append(esc(supAddr)).append("</div>")
          .append("<div style=\"margin-top:6px;\"><span class=\"muted\">GSTIN:</span> <b>").append(esc(nz(supGstin, "—"))).append("</b></div>")
          .append("<div><span class=\"muted\">State code:</span> ").append(esc(nz(supState, "—"))).append("</div>")
          .append("</div></td>")
          .append("<td style=\"width:50%;padding-left:6px;\"><div class=\"box\">")
          .append("<div class=\"label\">Bill To</div>")
          .append("<div style=\"font-weight:bold;font-size:12px;\">").append(esc(buyName)).append("</div>")
          .append("<div class=\"muted\" style=\"margin-top:3px;\">").append(esc(nz(buyAddr, ""))).append("</div>")
          .append("<div style=\"margin-top:6px;\"><span class=\"muted\">GSTIN:</span> <b>")
          .append(b2b ? esc(buyGstin) : "Unregistered").append("</b></div>")
          .append("<div><span class=\"muted\">State code:</span> ").append(esc(nz(buyState, "—")));
        String stateName = IndianStates.nameFor(buyState);
        if (stateName != null) {
            sb.append(" (").append(esc(stateName)).append(")");
        }
        sb.append("</div></div></td></tr></table>");
    }

    private static void itemsHeader(StringBuilder sb, boolean export, boolean intra) {
        sb.append("<table class=\"items\"><thead><tr>")
          .append("<th style=\"width:4%\">#</th><th>Description</th><th class=\"c\" style=\"width:9%\">HSN/SAC</th>")
          .append("<th class=\"c\" style=\"width:6%\">Qty</th><th class=\"r\" style=\"width:14%\">Taxable Value</th>");
        if (export) {
            sb.append("<th class=\"c\" style=\"width:9%\">GST</th>");
        } else if (intra) {
            sb.append("<th class=\"r\" style=\"width:12%\">CGST</th><th class=\"r\" style=\"width:12%\">SGST</th>");
        } else {
            sb.append("<th class=\"r\" style=\"width:14%\">IGST</th>");
        }
        sb.append("<th class=\"r\" style=\"width:14%\">Total</th></tr></thead><tbody>");
    }

    private static void itemRow(StringBuilder sb, int i, String description, String sac, String qty, Long base,
                                Long cgst, Integer cgstBps, Long sgst, Integer sgstBps, Long igst, Integer igstBps,
                                Long total, String cur, boolean export, boolean intra) {
        sb.append("<tr><td class=\"c\">").append(i).append("</td>")
          .append("<td>").append(esc(description)).append("</td>")
          .append("<td class=\"c\">").append(esc(nz(sac, ""))).append("</td>")
          .append("<td class=\"c\">").append(esc(qty)).append("</td>")
          .append("<td class=\"r\">").append(money(base, cur)).append("</td>");
        if (export) {
            sb.append("<td class=\"c\">0%</td>");
        } else if (intra) {
            sb.append("<td class=\"r\">").append(money(cgst, cur))
              .append("<div class=\"muted\">@ ").append(pct(cgstBps)).append("</div></td>")
              .append("<td class=\"r\">").append(money(sgst, cur))
              .append("<div class=\"muted\">@ ").append(pct(sgstBps)).append("</div></td>");
        } else {
            sb.append("<td class=\"r\">").append(money(igst, cur))
              .append("<div class=\"muted\">@ ").append(pct(igstBps)).append("</div></td>");
        }
        sb.append("<td class=\"r\"><b>").append(money(total, cur)).append("</b></td></tr>");
    }

    private static void totals(StringBuilder sb, Long base, Long cgst, Long sgst, Long igst, Long total, String cur,
                               boolean export, boolean intra, String totalLabel) {
        sb.append("<table class=\"totals\">")
          .append(tot("Taxable value", money(base, cur), false));
        if (export) {
            sb.append(tot("GST (export, 0%)", money(0L, cur), false));
        } else if (intra) {
            sb.append(tot("CGST", money(cgst, cur), false))
              .append(tot("SGST", money(sgst, cur), false));
        } else {
            sb.append(tot("IGST", money(igst, cur), false));
        }
        sb.append(tot(totalLabel, money(total, cur), true))
          .append("</table>");
        sb.append("<div class=\"muted\" style=\"margin-top:10px;\">Amount in words: <b>")
          .append(esc(amountInWords(total, cur))).append("</b></div>");
    }

    /** PAID / PAID (OFFLINE) from the payment; nothing when the payment is unknown or unpaid. */
    static String badge(PlatformPayment p) {
        if (p == null || p.getPaymentStatus() == null) {
            return null;
        }
        PlatformPaymentResult r = p.getPaymentStatus();
        if (r != PlatformPaymentResult.PAID && r != PlatformPaymentResult.PARTIALLY_REFUNDED
                && r != PlatformPaymentResult.REFUNDED) {
            return null;
        }
        return "MANUAL".equalsIgnoreCase(p.getVendor()) ? "PAID (OFFLINE)" : "PAID";
    }

    /**
     * The printed invoice date. v2-series invoices with a stored instant print the Asia/Kolkata
     * date (the same calendar their FY comes from); legacy invoices print as they always did.
     */
    public static String invoiceDateText(PlatformInvoice inv) {
        if (inv.getIssuedAtTz() != null && PlatformDocumentSequenceService.isSeriesV2(inv.getInvoiceNumber())) {
            return inv.getIssuedAtTz().atZone(PlatformDocumentSequenceService.IST).format(DATE_FMT);
        }
        return inv.getIssuedAt() == null ? "" : inv.getIssuedAt().format(DATE_FMT);
    }

    /** "01 Nov 2026 to 30 Nov 2026" in IST (end is exclusive, so the last day is end - 1 s). */
    static String servicePeriodText(Instant start, Instant end) {
        if (start == null || end == null) {
            return null;
        }
        return start.atZone(PlatformDocumentSequenceService.IST).format(DATE_FMT) + " to "
                + end.minusSeconds(1).atZone(PlatformDocumentSequenceService.IST).format(DATE_FMT);
    }

    /** UTC wall-clock of a legacy invoice as an instant (prod JVM runs in UTC). */
    static Instant legacyInstant(PlatformInvoice inv) {
        if (inv.getIssuedAtTz() != null) {
            return inv.getIssuedAtTz();
        }
        return inv.getIssuedAt() == null ? null : inv.getIssuedAt().toInstant(ZoneOffset.UTC);
    }

    // ─────────────────────────────────────────────────────────────────
    // Formatting helpers
    // ─────────────────────────────────────────────────────────────────

    private static String kv(String k, String v) {
        return "<tr><td class=\"k\">" + esc(k) + "</td><td class=\"r\"><b>" + esc(nz(v, "")) + "</b></td></tr>";
    }

    private static String tot(String k, String v, boolean grand) {
        return "<tr" + (grand ? " class=\"grand\"" : "") + "><td class=\"muted\">" + esc(k)
                + "</td><td class=\"r\">" + v + "</td></tr>";
    }

    static String money(Long minor, String cur) {
        long m = minor == null ? 0L : minor;
        BigDecimal major = BigDecimal.valueOf(m).movePointLeft(2).setScale(2, RoundingMode.HALF_UP);
        String num = "INR".equalsIgnoreCase(cur) ? indianGroup(major) : String.format(Locale.US, "%,.2f", major);
        String sym = "INR".equalsIgnoreCase(cur) ? "₹" : "USD".equalsIgnoreCase(cur) ? "$" : (cur + " ");
        return esc(sym + num);
    }

    /** 1234567.89 → 12,34,567.89 (Indian lakh/crore grouping). */
    static String indianGroup(BigDecimal v) {
        String plain = v.toPlainString();
        String intPart = plain.contains(".") ? plain.substring(0, plain.indexOf('.')) : plain;
        String frac = plain.contains(".") ? plain.substring(plain.indexOf('.')) : ".00";
        boolean neg = intPart.startsWith("-");
        if (neg) intPart = intPart.substring(1);
        if (intPart.length() <= 3) return (neg ? "-" : "") + intPart + frac;
        String last3 = intPart.substring(intPart.length() - 3);
        String rest = intPart.substring(0, intPart.length() - 3);
        StringBuilder sb = new StringBuilder();
        while (rest.length() > 2) {
            sb.insert(0, "," + rest.substring(rest.length() - 2));
            rest = rest.substring(0, rest.length() - 2);
        }
        sb.insert(0, rest);
        return (neg ? "-" : "") + sb + "," + last3 + frac;
    }

    private static String pct(Integer bps) {
        if (bps == null) return "0%";
        BigDecimal p = BigDecimal.valueOf(bps).movePointLeft(2).stripTrailingZeros();
        return p.toPlainString() + "%";
    }

    private static String qty(BigDecimal q) {
        return q == null ? "1" : q.stripTrailingZeros().toPlainString();
    }

    private static String placeOfSupplyLabel(String code, boolean export) {
        if (export || "96".equals(code)) return "Outside India (96)";
        if (code == null) return "—";
        String name = IndianStates.nameFor(code);
        return name == null ? code : name + " (" + code + ")";
    }

    static String amountInWords(Long minor, String cur) {
        long m = minor == null ? 0L : minor;
        long whole = m / 100;
        long frac = m % 100;
        boolean inr = "INR".equalsIgnoreCase(cur);
        String unit = inr ? "Rupees" : "Dollars";
        String sub = inr ? "Paise" : "Cents";
        StringBuilder sb = new StringBuilder();
        sb.append(unit).append(' ').append(whole == 0 ? "Zero" : (inr ? indianWords(whole) : westernWords(whole)));
        if (frac > 0) sb.append(" and ").append(westernWords(frac)).append(' ').append(sub);
        sb.append(" Only");
        return sb.toString();
    }

    private static final String[] ONES = { "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen" };
    private static final String[] TENS = { "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety" };

    private static String upToThousand(long n) {
        StringBuilder sb = new StringBuilder();
        if (n >= 100) { sb.append(ONES[(int) (n / 100)]).append(" Hundred"); n %= 100; if (n > 0) sb.append(' '); }
        if (n >= 20) { sb.append(TENS[(int) (n / 10)]); n %= 10; if (n > 0) sb.append(' ').append(ONES[(int) n]); }
        else if (n > 0) sb.append(ONES[(int) n]);
        return sb.toString();
    }

    private static String indianWords(long n) {
        StringBuilder sb = new StringBuilder();
        long crore = n / 10_000_000; n %= 10_000_000;
        long lakh = n / 100_000; n %= 100_000;
        long thousand = n / 1000; n %= 1000;
        if (crore > 0) sb.append(indianWords(crore)).append(" Crore ");
        if (lakh > 0) sb.append(upToThousand(lakh)).append(" Lakh ");
        if (thousand > 0) sb.append(upToThousand(thousand)).append(" Thousand ");
        if (n > 0) sb.append(upToThousand(n));
        return sb.toString().trim();
    }

    private static String westernWords(long n) {
        StringBuilder sb = new StringBuilder();
        long million = n / 1_000_000; n %= 1_000_000;
        long thousand = n / 1000; n %= 1000;
        if (million > 0) sb.append(upToThousand(million)).append(" Million ");
        if (thousand > 0) sb.append(upToThousand(thousand)).append(" Thousand ");
        if (n > 0) sb.append(upToThousand(n));
        return sb.toString().trim();
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }
    private static String nz(String s, String d) { return notBlank(s) ? s : d; }

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (char c : s.toCharArray()) {
            switch (c) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }
}
