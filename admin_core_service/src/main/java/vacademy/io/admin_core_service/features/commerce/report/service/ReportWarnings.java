package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The warnings of one answer. The same code and reference is kept once; at most
 * {@value #MAX_PER_CODE} per code are listed, the rest folded into one "and N more" warning of
 * that code (with no reference). A warning is never dropped silently.
 */
public final class ReportWarnings {

    public static final int MAX_PER_CODE = 100;

    public static final String CANCELLED_AFTER_MONTH = "CANCELLED_AFTER_MONTH";
    public static final String HSN_MISSING = "HSN_MISSING";
    public static final String HSN_SHORT = "HSN_SHORT";
    public static final String UQC_UNKNOWN = "UQC_UNKNOWN";
    public static final String SCALE_UNKNOWN = "SCALE_UNKNOWN";
    public static final String QTY_ROUNDED = "QTY_ROUNDED";
    public static final String NOT_A_TAX_INVOICE = "NOT_A_TAX_INVOICE";
    public static final String ZERO_RATE_SPLIT_UNKNOWN = "ZERO_RATE_SPLIT_UNKNOWN";
    public static final String GSTR1_DOES_NOT_ADD_UP = "GSTR1_DOES_NOT_ADD_UP";
    public static final String SERIES_GAP = "SERIES_GAP";
    public static final String REGISTER_DOES_NOT_ADD_UP = "REGISTER_DOES_NOT_ADD_UP";
    public static final String HSN_DOES_NOT_ADD_UP = "HSN_DOES_NOT_ADD_UP";
    public static final String NUMBER_NOT_PARSED = "NUMBER_NOT_PARSED";
    /** A GST report cut to one GSTIN left out documents that carry no seller GSTIN. */
    public static final String NO_GSTIN = "NO_GSTIN";
    /** Bill-book pages between the first page of the book and the highest page entered have no bill. */
    public static final String BILL_BOOK_PAGES_NOT_ENTERED = "BILL_BOOK_PAGES_NOT_ENTERED";
    /** A document with no number series is not in the documents-issued table. */
    public static final String DOCUMENT_WITHOUT_SERIES = "DOCUMENT_WITHOUT_SERIES";
    /** A bill reissued with the buyer's GSTIN is counted once (the first bill; the reissue pair left out). */
    public static final String REISSUE_COUNTED_ONCE = "REISSUE_COUNTED_ONCE";
    /** COD is shown at the order amount: courier deductions and short remittances are not in this view. */
    public static final String COD_GROSS = "COD_GROSS";

    private final List<ReportDtos.Warning> listed = new ArrayList<>();
    private final Set<String> seen = new HashSet<>();
    private final Map<String, Integer> perCode = new LinkedHashMap<>();
    private final Map<String, Integer> folded = new LinkedHashMap<>();

    public void add(String code, String message, String ref) {
        if (!seen.add(code + "\u0000" + ref)) {
            return;
        }
        int count = perCode.merge(code, 1, Integer::sum);
        if (count > MAX_PER_CODE) {
            folded.merge(code, 1, Integer::sum);
            return;
        }
        listed.add(new ReportDtos.Warning(code, message, ref));
    }

    public boolean has(String code) {
        return perCode.containsKey(code);
    }

    public List<ReportDtos.Warning> list() {
        List<ReportDtos.Warning> out = new ArrayList<>(listed);
        folded.forEach((code, more) -> out.add(new ReportDtos.Warning(code, "and " + more + " more", null)));
        return out;
    }
}
