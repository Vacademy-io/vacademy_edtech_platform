package vacademy.io.admin_core_service.features.commerce.report.service;

import java.math.BigDecimal;

/**
 * Which GSTR-1 section a document line belongs to (contract section 2.5). Pure.
 *
 * <ul>
 *   <li>Only a {@code TAX_INVOICE} (and a credit note on one) is in GSTR-1; a bill of supply or a
 *       plain invoice is {@link Section#NONE}.</li>
 *   <li>A line at rate 0 is {@link Section#EXEMP}, whoever the buyer.</li>
 *   <li>Invoice with a buyer GSTIN: {@link Section#B2B}. Without: {@link Section#B2CL} when
 *       inter-state and the invoice total is above the limit, else {@link Section#B2CS}.</li>
 *   <li>Credit note with a buyer GSTIN: {@link Section#CDNR}; without, on a B2CL invoice:
 *       {@link Section#CDNUR}; on a B2CS invoice: netted into {@link Section#B2CS}.</li>
 * </ul>
 */
public final class Gstr1Classifier {

    public static final String TAX_INVOICE = "TAX_INVOICE";

    /** The sections a line can fall in. */
    public enum Section { B2B, B2CL, B2CS, EXEMP, CDNR, CDNUR, NONE }

    /** The four rows of the 0% sheet. */
    public enum ExempBucket {
        INTER_REGISTERED("Inter-State supplies to registered persons"),
        INTRA_REGISTERED("Intra-State supplies to registered persons"),
        INTER_UNREGISTERED("Inter-State supplies to unregistered persons"),
        INTRA_UNREGISTERED("Intra-State supplies to unregistered persons");

        private final String description;

        ExempBucket(String description) {
            this.description = description;
        }

        public String description() {
            return description;
        }
    }

    private Gstr1Classifier() {
    }

    /** Inter-state: the tax head says IGST, or (no head) the place of supply is not the seller's state. */
    public static boolean interState(String taxHead, String placeOfSupply, String sellerState) {
        if ("IGST".equals(taxHead)) {
            return true;
        }
        if ("CGST_SGST".equals(taxHead)) {
            return false;
        }
        return placeOfSupply != null && sellerState != null && !placeOfSupply.equals(sellerState);
    }

    /** The class of a whole invoice: B2B, B2CL or B2CS; NONE when it is not a tax invoice. */
    public static Section invoiceClass(String documentType, String buyerGstin, boolean interState,
                                       BigDecimal invoiceTotal, BigDecimal b2clLimit) {
        if (!TAX_INVOICE.equals(documentType)) {
            return Section.NONE;
        }
        if (buyerGstin != null && !buyerGstin.isBlank()) {
            return Section.B2B;
        }
        if (interState && invoiceTotal != null && invoiceTotal.compareTo(b2clLimit) > 0) {
            return Section.B2CL;
        }
        return Section.B2CS;
    }

    /** The section of one invoice line. */
    public static Section invoiceLine(String documentType, String buyerGstin, boolean interState,
                                      BigDecimal invoiceTotal, BigDecimal rate, BigDecimal b2clLimit) {
        Section invoice = invoiceClass(documentType, buyerGstin, interState, invoiceTotal, b2clLimit);
        if (invoice == Section.NONE) {
            return Section.NONE;
        }
        return isZero(rate) ? Section.EXEMP : invoice;
    }

    /**
     * The section of one credit-note line. {@code invoiceClass} is the class of the note's invoice
     * ({@link #invoiceClass}); B2CS means "netted into the B2C small rows".
     */
    public static Section noteLine(Section invoiceClass, String noteBuyerGstin, BigDecimal rate) {
        if (invoiceClass == Section.NONE) {
            return Section.NONE;
        }
        if (isZero(rate)) {
            return Section.EXEMP;
        }
        if (noteBuyerGstin != null && !noteBuyerGstin.isBlank()) {
            return Section.CDNR;
        }
        return invoiceClass == Section.B2CL ? Section.CDNUR : Section.B2CS;
    }

    /** The 0% row of a line. */
    public static ExempBucket exempBucket(boolean registered, boolean interState) {
        if (registered) {
            return interState ? ExempBucket.INTER_REGISTERED : ExempBucket.INTRA_REGISTERED;
        }
        return interState ? ExempBucket.INTER_UNREGISTERED : ExempBucket.INTRA_UNREGISTERED;
    }

    private static boolean isZero(BigDecimal rate) {
        return rate == null || rate.signum() == 0;
    }
}
