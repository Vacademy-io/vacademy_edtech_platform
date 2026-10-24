package vacademy.io.admin_core_service.features.invoice.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.invoice.enums.InvoiceSeqScope;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Typed view of {@code INVOICE_SETTING.numbering} — the admin-configured invoice
 * number strategy.
 *
 * <p>Parsing is deliberately lenient (same spirit as
 * {@link vacademy.io.admin_core_service.features.invoice.enums.InvoicePdfPlacement#fromSetting}):
 * every field falls back to a legacy default, and {@link #legacyDefault()} reproduces the
 * old hardcoded {@code INV-yyyyMMdd-0001} exactly. That means the thousands of institutes
 * with no {@code numbering} block keep their current numbering with no migration and no
 * behaviour change until someone edits the setting.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InvoiceNumberConfig {

    /** Max rendered length — {@code invoice.invoice_number} is VARCHAR(100). */
    public static final int MAX_LENGTH = 100;

    public static final String LEGACY_FORMAT = "INV-{{YYYYMMDD}}-{{seq}}";

    /** Token format string, e.g. {@code "{{institute_code}}/{{FY}}/{{seq}}"}. */
    private String format;

    /** Zero-padding width for {@code {{seq}}} when the token carries no {@code :N} modifier. */
    private int seqPadding;

    /** When the counter rolls over. */
    private InvoiceSeqScope seqScope;

    /** Admin-set short code for {@code {{institute_code}}}; blank means "derive from name". */
    private String instituteCode;

    /**
     * First month of the financial year, 1-12, for {@code {{FY}}} / {@code {{FYY}}} /
     * {@code {{FQ}}}. Defaults to 4 (April — India, UK). AU institutes use 7, calendar-year
     * regimes use 1.
     */
    private int fyStartMonth;

    /** Uppercase / strip accents / truncate the free-text tokens (name, course, …). */
    private boolean sanitizeTokens;

    /**
     * Floor for the sequence: the next number is never lower than this, so an institute
     * migrating from another accounting system can continue its existing series. Acts as a
     * floor rather than a hard set, which is what makes it safe — lowering it below what has
     * already been issued is simply ignored instead of reusing numbers. 0/null means "no floor".
     */
    private long startFrom;

    /**
     * Extra counters picked per learner, read from {@code INVOICE_SETTING.numberingSeries}
     * (outside {@code numbering}, which the settings screen rewrites from a fixed key list).
     * The first series whose rule matches the learner numbers the document from its own
     * counter; a learner no series matches stays on the main one above. Empty for every
     * institute that has not configured it.
     */
    @Builder.Default
    private List<Series> series = new ArrayList<>();

    /**
     * INVOICE_SETTING.numberingSeriesPolicy: whether the record-payment dialogs ask for the
     * series field on the first payment of an enrolment, and whether it is required. Off
     * unless set.
     */
    @Builder.Default
    private SeriesPolicy seriesPolicy = new SeriesPolicy();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SeriesPolicy {
        private boolean askOnFirstPayment;
        private boolean required;
        /** Field to ask for; blank = the first series' field. */
        private String fieldId;
    }

    /** The field the dialogs ask for, or null when there is no series. */
    public String askFieldId() {
        if (seriesPolicy != null && StringUtils.hasText(seriesPolicy.getFieldId())) {
            return seriesPolicy.getFieldId().trim();
        }
        return series == null || series.isEmpty() ? null : series.get(0).getLearnerFieldId();
    }

    /** True when the institute numbers by series and asks for the field on a first payment. */
    public boolean asksOnFirstPayment() {
        return series != null && !series.isEmpty() && seriesPolicy != null
                && seriesPolicy.isAskOnFirstPayment() && askFieldId() != null;
    }

    /**
     * One extra counter, e.g. per branch: its own format and start number, chosen when the
     * learner's value of {@link #learnerFieldId} is one of {@link #values} (case-insensitive).
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Series {
        /** Stable id (A-Z, 0-9, _, at most 16 so the counter key fits seq_scope_key); never reuse it. */
        private String key;
        private String format;
        private long startFrom;
        /** Custom field holding the learner's value, from the profile or their latest lead. */
        private String learnerFieldId;
        @Builder.Default
        private List<String> values = new ArrayList<>();

        public boolean matches(String learnerValue) {
            if (learnerValue == null || values == null) return false;
            String v = learnerValue.trim();
            return values.stream().anyMatch(x -> x != null && x.trim().equalsIgnoreCase(v));
        }
    }

    /** This config with a series' format and start number, keeping every other setting. */
    public InvoiceNumberConfig forSeries(Series s) {
        return InvoiceNumberConfig.builder()
                .format(s.getFormat())
                .seqPadding(seqPadding)
                .seqScope(seqScope)
                .instituteCode(instituteCode)
                .fyStartMonth(fyStartMonth)
                .sanitizeTokens(sanitizeTokens)
                .startFrom(Math.max(0, s.getStartFrom()))
                .build();
    }

    /** True when this format distinguishes document kinds itself (invoice vs receipt). */
    public boolean usesDocType() {
        return format != null && format.contains("{{doc_type}}");
    }

    /**
     * A copy of this config with a different format, keeping every other setting. Used by the
     * fee-receipt services to keep their {@code RCT-} / {@code APP-FEE-} prefix when the
     * institute's format has no {@code {{doc_type}}} token to carry it.
     */
    public InvoiceNumberConfig withFormat(String replacementFormat) {
        return InvoiceNumberConfig.builder()
                .format(replacementFormat)
                .seqPadding(seqPadding)
                .seqScope(seqScope)
                .instituteCode(instituteCode)
                .fyStartMonth(fyStartMonth)
                .sanitizeTokens(sanitizeTokens)
                .startFrom(startFrom)
                .build();
    }

    /** Exactly the behaviour of the old hardcoded generator. */
    public static InvoiceNumberConfig legacyDefault() {
        return InvoiceNumberConfig.builder()
                .format(LEGACY_FORMAT)
                .seqPadding(4)
                .seqScope(InvoiceSeqScope.DAILY)
                .instituteCode("")
                .fyStartMonth(4)
                .sanitizeTokens(true)
                .startFrom(0)
                .build();
    }

    /**
     * Read the {@code numbering} object out of an already-loaded {@code INVOICE_SETTING}
     * data map. Any missing, null or unparseable field falls back to the legacy default
     * rather than throwing — a malformed setting must never stop an invoice being issued.
     */
    @SuppressWarnings("unchecked")
    public static InvoiceNumberConfig fromInvoiceSettings(Map<String, Object> invoiceSettings) {
        InvoiceNumberConfig fallback = legacyDefault();
        if (invoiceSettings == null) {
            return fallback;
        }
        // Series and their policy live outside the numbering block, so they apply even to an
        // institute that never saved a numbering format of its own.
        fallback.setSeries(parseSeries(invoiceSettings.get("numberingSeries")));
        fallback.setSeriesPolicy(parsePolicy(invoiceSettings.get("numberingSeriesPolicy")));
        Object raw = invoiceSettings.get("numbering");
        if (!(raw instanceof Map)) {
            return fallback;
        }
        Map<String, Object> numbering = (Map<String, Object>) raw;

        String format = asText(numbering.get("format"), fallback.getFormat());
        int padding = clamp(asInt(numbering.get("seqPadding"), fallback.getSeqPadding()), 1, 12);
        int fyStart = clamp(asInt(numbering.get("fyStartMonth"), fallback.getFyStartMonth()), 1, 12);

        return InvoiceNumberConfig.builder()
                .format(format)
                .seqPadding(padding)
                .seqScope(InvoiceSeqScope.fromSetting(numbering.get("seqScope")))
                .instituteCode(asText(numbering.get("instituteCode"), ""))
                .fyStartMonth(fyStart)
                .sanitizeTokens(asBool(numbering.get("sanitizeTokens"), true))
                .startFrom(Math.max(0, asLong(numbering.get("startFrom"), 0)))
                .series(parseSeries(invoiceSettings.get("numberingSeries")))
                .seriesPolicy(parsePolicy(invoiceSettings.get("numberingSeriesPolicy")))
                .build();
    }

    @SuppressWarnings("unchecked")
    static SeriesPolicy parsePolicy(Object raw) {
        if (!(raw instanceof Map)) {
            return new SeriesPolicy();
        }
        Map<String, Object> m = (Map<String, Object>) raw;
        return new SeriesPolicy(asBool(m.get("askOnFirstPayment"), false), asBool(m.get("required"), false),
                asText(m.get("fieldId"), null));
    }

    /** Lenient like the rest: an entry missing its key, format or field is skipped. */
    @SuppressWarnings("unchecked")
    public static List<Series> parseSeries(Object raw) {
        List<Series> out = new ArrayList<>();
        if (!(raw instanceof List<?> list)) {
            return out;
        }
        for (Object o : list) {
            if (!(o instanceof Map)) continue;
            Map<String, Object> m = (Map<String, Object>) o;
            String key = asText(m.get("key"), "").toUpperCase(Locale.ROOT);
            String format = asText(m.get("format"), "");
            String fieldId = asText(m.get("learnerFieldId"), "");
            if (!key.matches("[A-Z0-9_]{1,16}") || format.isEmpty() || fieldId.isEmpty()) continue;
            List<String> values = new ArrayList<>();
            if (m.get("values") instanceof List<?> vs) {
                for (Object v : vs) {
                    String text = asText(v, "");
                    if (!text.isEmpty()) values.add(text);
                }
            }
            if (values.isEmpty()) continue;
            out.add(Series.builder().key(key).format(format)
                    .startFrom(Math.max(0, asLong(m.get("startFrom"), 0)))
                    .learnerFieldId(fieldId).values(values).build());
        }
        return out;
    }

    private static String asText(Object value, String fallback) {
        if (value == null) return fallback;
        String s = value.toString().trim();
        return s.isEmpty() ? fallback : s;
    }

    private static int asInt(Object value, int fallback) {
        if (value instanceof Number n) return n.intValue();
        if (value == null) return fallback;
        try {
            return Integer.parseInt(value.toString().trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long asLong(Object value, long fallback) {
        if (value instanceof Number n) return n.longValue();
        if (value == null) return fallback;
        try {
            return Long.parseLong(value.toString().trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static boolean asBool(Object value, boolean fallback) {
        if (value instanceof Boolean b) return b;
        if (value == null) return fallback;
        String s = value.toString().trim();
        if ("true".equalsIgnoreCase(s)) return true;
        if ("false".equalsIgnoreCase(s)) return false;
        return fallback;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
