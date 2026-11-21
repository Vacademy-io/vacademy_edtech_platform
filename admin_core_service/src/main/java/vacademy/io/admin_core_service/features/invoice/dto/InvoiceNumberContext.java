package vacademy.io.admin_core_service.features.invoice.dto;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDate;
import java.util.function.Supplier;

/**
 * Everything {@link vacademy.io.admin_core_service.features.invoice.util.InvoiceNumberFormatter}
 * can substitute into an invoice number.
 *
 * <p>All the eagerly-populated fields are free: invoice-number generation runs AFTER
 * {@code buildInvoiceData}, so the institute, learner, date and payment values are already
 * in memory and the context costs no extra queries.
 *
 * <p>The two {@link Supplier} fields are the exceptions — {@code enrollment_no} and the
 * package/course context each need a DB read that no existing invoice code performs. They
 * are suppliers so the read only happens when the institute's configured format actually
 * contains one of those tokens; the formatter memoises the result so a format using two
 * package tokens still issues one query.
 */
@Data
@Builder
public class InvoiceNumberContext {

    private String instituteId;

    // ── Institute (free) ────────────────────────────────────────────────────
    private String instituteName;
    /** Admin-set short code; the formatter derives one from the name when blank. */
    private String instituteCode;
    private String instituteStateCode;
    private String instituteCity;
    private String instituteState;
    private String instituteCountry;
    private String subdomain;

    // ── Learner (free) ──────────────────────────────────────────────────────
    private String learnerName;
    private String learnerState;

    // ── Date (free) ─────────────────────────────────────────────────────────
    private LocalDate date;

    // ── Transaction (free) ──────────────────────────────────────────────────
    private String currency;
    private String paymentVendor;
    private String planName;
    /** {@code invoice.source} — USER_PLAN / ADMIN_INVOICE / LIVE_SESSION / fee receipt. */
    private String docType;

    /**
     * Optional counter namespace. When set, the allocation reads and writes
     * {@code "<namespace>:<scopeKey>"} instead of the bare scope key, giving this kind of
     * document its own independent sequence.
     *
     * <p>Used by proforma invoices: a proforma is not a tax document, so it must never
     * consume a number out of the institute's real invoice series — a proforma that is
     * cancelled or never paid would otherwise leave a permanent hole in a numbered tax
     * series, which is exactly what tax authorities do not allow. It gets its own tidy
     * {@code PRO:*} counter instead, and only draws a real number when it is paid and
     * becomes an actual invoice.
     *
     * <p>Null (the default) means the document numbers out of the institute's main series.
     */
    private String seqNamespace;

    // ── Lazy: only invoked when the format needs them ───────────────────────
    private Supplier<String> enrollmentNumberSupplier;
    private Supplier<InvoicePackageContextProjection> packageContextSupplier;
    /**
     * The learner's value of a custom field (by field id), for picking a numbering series.
     * Only called when the institute has series configured; null when there is no learner.
     */
    private java.util.function.Function<String, String> learnerFieldLookup;

    /** Sample context used by the settings preview so admins never burn a real number. */
    public static InvoiceNumberContext sample(String instituteId, String instituteName, String instituteCode) {
        return InvoiceNumberContext.builder()
                .instituteId(instituteId)
                .instituteName(instituteName)
                .instituteCode(instituteCode)
                .instituteStateCode("27")
                .instituteCity("Mumbai")
                .instituteState("Maharashtra")
                .instituteCountry("India")
                .subdomain("acme")
                .learnerName("Rahul Sharma")
                .learnerState("Maharashtra")
                .date(LocalDate.now())
                .currency("INR")
                .paymentVendor("RAZORPAY")
                .planName("Annual Plan")
                .docType("USER_PLAN")
                .enrollmentNumberSupplier(() -> "482910")
                .packageContextSupplier(InvoiceNumberContext::samplePackageContext)
                .build();
    }

    /** Stand-in package context so {@code {{course_name}}} & co. render in the preview. */
    private static InvoicePackageContextProjection samplePackageContext() {
        return new InvoicePackageContextProjection() {
            @Override public String getPackageId() { return "sample-package"; }
            @Override public String getPackageName() { return "Physics 101"; }
            @Override public String getLevelId() { return "sample-level"; }
            @Override public String getLevelName() { return "Beginner"; }
            @Override public String getSessionId() { return "sample-session"; }
            @Override public String getSessionName() { return "2026"; }
        };
    }
}
