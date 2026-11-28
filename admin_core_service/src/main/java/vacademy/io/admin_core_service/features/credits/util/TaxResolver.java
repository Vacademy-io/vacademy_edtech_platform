package vacademy.io.admin_core_service.features.credits.util;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.credits.dto.TaxBreakup;
import vacademy.io.admin_core_service.features.platform_billing.enums.TaxHead;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.Locale;

/**
 * GST breakup for a platform sale line (AI credit packs and AI subscriptions).
 *
 * <h3>Legacy credit-pack rule — {@link #resolveTax(Institute, String, long, String)}</h3>
 * Unchanged so existing pack prices and orders stay byte-identical:
 * <pre>
 *   INR + buyer state == supplier state  -> CGST 9% + SGST 9%   (intra-state)
 *   INR + buyer state != supplier state  -> IGST 18%             (inter-state)
 *   USD or any non-INR (export)          -> 0%, place_of_supply="96"
 *   INR + no buyer state                 -> IGST 18%, place of supply = supplier state
 * </pre>
 *
 * <h3>Buyer-snapshot rule — {@link #resolveForBuyer}</h3>
 * Used for subscriptions (always) and for packs when the caller opts in. It works only from the
 * buyer identity the caller froze at order time — never from the {@code institutes} row:
 * <ul>
 *   <li>Buyer state: the GSTIN prefix when a GSTIN is given (Section 12(2)(a) IGST Act), else the
 *       state the buyer picked (Circular 242/36/2024-GST: always record the recipient's state for
 *       online services). Place of supply = buyer state.</li>
 *   <li>Missing state: refused with {@link TaxException} {@code BUYER_STATE_REQUIRED} when
 *       required (subscriptions always; packs behind {@code billing.buyer_state.required}). When not
 *       required, the legacy fallback above applies (IGST, place of supply = supplier state).</li>
 *   <li>Export is decided by the buyer's <b>country</b>, not the currency (Section 2(6) IGST Act):
 *       an Indian institute paying in USD is still a taxable domestic supply. Subscriptions are
 *       INR-only and domestic-only in v1.</li>
 *   <li>Tax = round-half-up(base x 18%) once, then split (CGST = floor(tax / 2), SGST takes the
 *       odd paisa), so the total never depends on the tax head.</li>
 *   <li>Tax-inclusive prices: base = round(total / 1.18), tax = total - base, so the buyer pays
 *       exactly the listed price (no 1 paisa drift).</li>
 * </ul>
 */
@Component
public class TaxResolver {

    public static final int GST_HALF_RATE_BPS = 900;     // 9.00% — CGST/SGST each leg
    public static final int GST_FULL_RATE_BPS = 1800;    // 18.00% — IGST or combined
    public static final String EXPORT_PLACE_OF_SUPPLY = "96";

    /** Machine-readable refusal; the facade maps it to a 422 with {@link #getCode()}. */
    public static class TaxException extends VacademyException {
        private final String code;

        public TaxException(String code, String message) {
            super(HttpStatus.UNPROCESSABLE_ENTITY, message);
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }

    public static final String BUYER_STATE_REQUIRED = "BUYER_STATE_REQUIRED";
    public static final String INVALID_GSTIN = "INVALID_GSTIN";
    public static final String INVALID_STATE = "INVALID_STATE";
    public static final String STATE_GSTIN_MISMATCH = "STATE_GSTIN_MISMATCH";
    public static final String CURRENCY_NOT_SUPPORTED = "CURRENCY_NOT_SUPPORTED";
    public static final String EXPORT_NOT_SUPPORTED = "EXPORT_NOT_SUPPORTED";

    // ─────────────────────────────────────────────────────────────────
    // Legacy credit-pack path (unchanged)
    // ─────────────────────────────────────────────────────────────────

    public TaxBreakup resolveTax(
            Institute institute,
            String currency,
            long baseAmountMinor,
            String supplierStateCode) {

        if (!CurrencyResolver.INR.equalsIgnoreCase(currency)) {
            // Export / non-INR — zero-rated.
            return TaxBreakup.builder()
                    .baseAmountMinor(baseAmountMinor)
                    .taxAmountMinor(0L)
                    .totalAmountMinor(baseAmountMinor)
                    .placeOfSupply(EXPORT_PLACE_OF_SUPPLY)
                    .isExport(true)
                    .build();
        }

        String buyerStateCode = institute == null ? null : institute.getStateCode();
        boolean intraState = supplierStateCode != null
                && buyerStateCode != null
                && supplierStateCode.equalsIgnoreCase(buyerStateCode);

        long taxAmount;
        long cgst;
        long sgst;
        long igst;
        int cgstBps;
        int sgstBps;
        int igstBps;

        if (intraState) {
            cgst = roundHalfUp(baseAmountMinor, GST_HALF_RATE_BPS);
            sgst = roundHalfUp(baseAmountMinor, GST_HALF_RATE_BPS);
            igst = 0L;
            cgstBps = GST_HALF_RATE_BPS;
            sgstBps = GST_HALF_RATE_BPS;
            igstBps = 0;
            taxAmount = cgst + sgst;
        } else {
            cgst = 0L;
            sgst = 0L;
            igst = roundHalfUp(baseAmountMinor, GST_FULL_RATE_BPS);
            cgstBps = 0;
            sgstBps = 0;
            igstBps = GST_FULL_RATE_BPS;
            taxAmount = igst;
        }

        return TaxBreakup.builder()
                .baseAmountMinor(baseAmountMinor)
                .taxAmountMinor(taxAmount)
                .totalAmountMinor(baseAmountMinor + taxAmount)
                .cgstRateBps(cgstBps)
                .cgstAmountMinor(cgst)
                .sgstRateBps(sgstBps)
                .sgstAmountMinor(sgst)
                .igstRateBps(igstBps)
                .igstAmountMinor(igst)
                .placeOfSupply(buyerStateCode != null ? buyerStateCode : supplierStateCode)
                .isExport(false)
                .build();
    }

    // ─────────────────────────────────────────────────────────────────
    // Buyer-snapshot path (subscriptions; packs when opted in)
    // ─────────────────────────────────────────────────────────────────

    /** The buyer identity frozen at order time. All fields optional except as the rules require. */
    public record BuyerTaxIdentity(String stateCode, String gstin, String country) {}

    /** What is being sold, which fixes the strictness of the rules. */
    public enum SaleKind {
        /** INR only, domestic only, buyer state always required. */
        SUBSCRIPTION,
        /** Buyer state required only when the caller says so (billing.buyer_state.required). */
        CREDIT_PACK
    }

    /**
     * Resolves the buyer's GST state from a GSTIN and/or a picked state code.
     *
     * @return the 2-digit state code, or {@code null} when neither is given
     * @throws TaxException INVALID_GSTIN, INVALID_STATE or STATE_GSTIN_MISMATCH
     */
    public static String resolveBuyerState(String gstinRaw, String stateCodeRaw) {
        String gstin = gstinRaw == null ? null : gstinRaw.trim().toUpperCase(Locale.ROOT);
        String state = stateCodeRaw == null ? null : stateCodeRaw.trim();
        if (state != null && state.length() == 1 && Character.isDigit(state.charAt(0))) {
            state = "0" + state;
        }
        if (gstin != null && !gstin.isEmpty()) {
            if (!IndianStates.isValidGstin(gstin)) {
                throw new TaxException(INVALID_GSTIN, "Invalid GSTIN: " + gstin);
            }
            String prefix = gstin.substring(0, 2);
            if (state != null && !state.isEmpty() && !state.equals(prefix)) {
                throw new TaxException(STATE_GSTIN_MISMATCH,
                        "State code " + state + " does not match GSTIN state prefix " + prefix);
            }
            return prefix;
        }
        if (state == null || state.isEmpty()) {
            return null;
        }
        if (!IndianStates.isValidCode(state)) {
            throw new TaxException(INVALID_STATE, "Invalid GST state code: " + state);
        }
        return state;
    }

    /**
     * GST for one line, from the frozen buyer identity.
     *
     * @param amountMinor   the base (tax-exclusive) amount, or the total when {@code taxInclusive}
     * @param stateRequired refuse a missing buyer state (forced true for subscriptions)
     */
    public TaxBreakup resolveForBuyer(
            SaleKind kind,
            BuyerTaxIdentity buyer,
            String currency,
            long amountMinor,
            boolean taxInclusive,
            String supplierStateCode,
            boolean stateRequired) {
        if (amountMinor < 0) {
            throw new VacademyException("Amount must not be negative");
        }
        boolean subscription = kind == SaleKind.SUBSCRIPTION;
        boolean inr = CurrencyResolver.INR.equalsIgnoreCase(currency);
        if (subscription && !inr) {
            throw new TaxException(CURRENCY_NOT_SUPPORTED, "AI subscriptions are billed in INR only");
        }
        String country = buyer == null ? null : buyer.country();
        boolean foreignBuyer = isForeignCountry(country);
        if (subscription && foreignBuyer) {
            throw new TaxException(EXPORT_NOT_SUPPORTED, "AI subscriptions are available to Indian buyers only");
        }

        if (foreignBuyer) {
            // Export of services: zero-rated, place of supply outside India (96).
            return TaxBreakup.builder()
                    .baseAmountMinor(amountMinor)
                    .taxAmountMinor(0L)
                    .totalAmountMinor(amountMinor)
                    .placeOfSupply(EXPORT_PLACE_OF_SUPPLY)
                    .isExport(true)
                    .build();
        }

        String buyerState = resolveBuyerState(
                buyer == null ? null : buyer.gstin(), buyer == null ? null : buyer.stateCode());
        if (buyerState == null && (subscription || stateRequired)) {
            throw new TaxException(BUYER_STATE_REQUIRED,
                    "The buyer's GST state is required (place of supply, Circular 242/2024)");
        }
        boolean intra = buyerState != null && supplierStateCode != null
                && supplierStateCode.equalsIgnoreCase(buyerState);
        String placeOfSupply = buyerState != null ? buyerState : supplierStateCode;

        long base;
        long tax;
        if (taxInclusive) {
            base = baseFromInclusive(amountMinor, GST_FULL_RATE_BPS);
            tax = amountMinor - base;
        } else {
            base = amountMinor;
            tax = roundHalfUp(base, GST_FULL_RATE_BPS);
        }
        return split(base, tax, intra, placeOfSupply);
    }

    /** Builds the breakup for a known base and tax under one head (used for snapshots too). */
    public static TaxBreakup split(long base, long tax, boolean intra, String placeOfSupply) {
        if (intra) {
            long cgst = tax / 2;
            long sgst = tax - cgst;
            return TaxBreakup.builder()
                    .baseAmountMinor(base)
                    .taxAmountMinor(tax)
                    .totalAmountMinor(base + tax)
                    .cgstRateBps(GST_HALF_RATE_BPS)
                    .cgstAmountMinor(cgst)
                    .sgstRateBps(GST_HALF_RATE_BPS)
                    .sgstAmountMinor(sgst)
                    .igstRateBps(0)
                    .igstAmountMinor(0L)
                    .placeOfSupply(placeOfSupply)
                    .isExport(false)
                    .build();
        }
        return TaxBreakup.builder()
                .baseAmountMinor(base)
                .taxAmountMinor(tax)
                .totalAmountMinor(base + tax)
                .cgstRateBps(0)
                .cgstAmountMinor(0L)
                .sgstRateBps(0)
                .sgstAmountMinor(0L)
                .igstRateBps(GST_FULL_RATE_BPS)
                .igstAmountMinor(tax)
                .placeOfSupply(placeOfSupply)
                .isExport(false)
                .build();
    }

    /** The head a breakup was computed under, for {@code platform_payment.tax_head}. */
    public static TaxHead taxHeadOf(TaxBreakup t) {
        if (t == null) {
            return null;
        }
        if (t.isExport()) {
            return TaxHead.EXPORT;
        }
        if (t.getCgstRateBps() > 0 || t.getSgstRateBps() > 0) {
            return TaxHead.CGST_SGST;
        }
        return TaxHead.IGST;
    }

    /** round-half-up(total x 10000 / (10000 + rate)): the taxable value inside an inclusive price. */
    public static long baseFromInclusive(long totalMinor, int rateBps) {
        long denominator = 10_000L + rateBps;
        return (totalMinor * 10_000L * 2 + denominator) / (denominator * 2);
    }

    /** Blank or India (IN / IND / "India") is domestic; anything else is a foreign buyer. */
    static boolean isForeignCountry(String country) {
        if (country == null || country.isBlank()) {
            return false;
        }
        String c = country.trim().toUpperCase(Locale.ROOT);
        return !(c.equals("IN") || c.equals("IND") || c.equals("INDIA") || c.equals("BHARAT"));
    }

    /** amount * (rateBps / 10000) with banker's-style HALF_UP rounding. */
    private static long roundHalfUp(long amountMinor, int rateBps) {
        // (amount * rate + 5000) / 10000 — integer division, half rounds up
        long product = amountMinor * (long) rateBps;
        return (product + 5000L) / 10000L;
    }
}
