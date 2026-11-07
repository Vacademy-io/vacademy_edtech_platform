package vacademy.io.admin_core_service.features.credits.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformBillingProfileRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.common.institute.entity.Institute;

import java.time.Instant;
import java.util.Locale;

/**
 * The buyer's GST identity for bills from the platform (F4, critique #2), stored in
 * {@code platform_billing_profile}. {@code institutes.gstin} / {@code institutes.state_code}
 * are never written here: they also drive the institute's own learner receipts.
 *
 * <p>Read rule ({@link #resolve}): a profile field that is set wins; an institute with no
 * profile row (every institute before V590) falls back to the legacy {@code institutes} values,
 * read-only, so its first order after this change is priced and invoiced exactly as before.
 */
@Slf4j
@Service
public class PlatformBillingProfileService {

    /** The identity an order freezes onto {@code platform_payment} (the invoice reads only that). */
    public record BuyerIdentity(String legalName, String gstin, String stateCode, String address, String billingEmail) {}

    private final PlatformBillingProfileRepository repository;

    public PlatformBillingProfileService(PlatformBillingProfileRepository repository) {
        this.repository = repository;
    }

    /** The profile row, if any. */
    public PlatformBillingProfile find(String instituteId) {
        return instituteId == null ? null : repository.findById(instituteId).orElse(null);
    }

    /** Profile fields with the legacy {@code institutes} fallback (see the class comment). */
    public BuyerIdentity resolve(Institute institute) {
        PlatformBillingProfile p = institute == null ? null : find(institute.getId());
        if (p == null) {
            return new BuyerIdentity(
                    institute == null ? null : safe(institute.getInstituteName()),
                    institute == null ? null : blankToNull(institute.getGstin()),
                    institute == null ? null : blankToNull(institute.getStateCode()),
                    institute == null ? null : buildInstituteAddress(institute),
                    institute == null ? null : blankToNull(institute.getEmail()));
        }
        return new BuyerIdentity(
                StringUtils.hasText(p.getLegalName()) ? p.getLegalName().trim() : safe(institute.getInstituteName()),
                blankToNull(p.getGstin()),
                blankToNull(p.getStateCode()),
                StringUtils.hasText(p.getAddress()) ? p.getAddress().trim() : buildInstituteAddress(institute),
                StringUtils.hasText(p.getBillingEmail()) ? p.getBillingEmail().trim() : blankToNull(institute.getEmail()));
    }

    /**
     * The credit-pack top-up fields (same semantics as the pre-V590 code that wrote
     * {@code institutes}): both blank = leave what is stored; a GSTIN fixes the state to its
     * prefix; an explicit empty GSTIN with a state = unregistered buyer in that state. The first
     * write for an institute starts from its legacy values so nothing it had is lost.
     *
     * @throws TaxResolver.TaxException INVALID_GSTIN, INVALID_STATE or STATE_GSTIN_MISMATCH
     */
    public PlatformBillingProfile applyOrderFields(Institute institute, String gstinRaw, String stateCodeRaw,
            String actorUserId) {
        String gstin = gstinRaw == null ? null : gstinRaw.trim().toUpperCase(Locale.ROOT);
        String stateCode = stateCodeRaw == null ? null : stateCodeRaw.trim();
        PlatformBillingProfile existing = find(institute.getId());
        if ((gstin == null || gstin.isEmpty()) && (stateCode == null || stateCode.isEmpty())) {
            return existing;
        }
        // Validates format and GSTIN/state agreement; returns the effective state.
        String resolvedState = TaxResolver.resolveBuyerState(gstin, stateCode);

        PlatformBillingProfile p = existing != null ? existing : seedFromInstitute(institute);
        if (gstin != null && !gstin.isEmpty()) {
            p.setGstin(gstin);
        } else if (gstinRaw != null) {
            p.setGstin(null); // explicit empty = the buyer is now unregistered
        }
        if (resolvedState != null) {
            if (p.getGstin() != null && !p.getGstin().startsWith(resolvedState)) {
                throw new TaxResolver.TaxException(TaxResolver.STATE_GSTIN_MISMATCH,
                        "State code " + resolvedState + " does not match the saved GSTIN "
                                + p.getGstin() + "; send the GSTIN too, or an empty GSTIN");
            }
            p.setStateCode(resolvedState);
        }
        p.setUpdatedBy(actorUserId);
        p.setUpdatedAt(Instant.now());
        return repository.save(p);
    }

    /**
     * Full replace from the billing-profile form (storefront {@code PUT billing-profile}).
     * Blank fields are stored as NULL; the GSTIN fixes the state.
     */
    public PlatformBillingProfile upsert(String instituteId, String legalName, String gstinRaw, String stateCodeRaw,
            String address, String billingEmail, String actorUserId) {
        String gstin = gstinRaw == null ? null : gstinRaw.trim().toUpperCase(Locale.ROOT);
        String state = TaxResolver.resolveBuyerState(gstin, stateCodeRaw);
        PlatformBillingProfile p = find(instituteId);
        if (p == null) {
            p = new PlatformBillingProfile();
            p.setInstituteId(instituteId);
        }
        p.setLegalName(clip(legalName, 255));
        p.setGstin(StringUtils.hasText(gstin) ? gstin : null);
        p.setStateCode(state);
        p.setAddress(blankToNull(address));
        p.setBillingEmail(clip(billingEmail, 255));
        p.setUpdatedBy(actorUserId);
        p.setUpdatedAt(Instant.now());
        return repository.save(p);
    }

    private PlatformBillingProfile seedFromInstitute(Institute institute) {
        PlatformBillingProfile p = new PlatformBillingProfile();
        p.setInstituteId(institute.getId());
        String legacyGstin = blankToNull(institute.getGstin());
        String legacyState = blankToNull(institute.getStateCode());
        try {
            String s = TaxResolver.resolveBuyerState(legacyGstin, legacyState);
            p.setGstin(legacyGstin == null ? null : legacyGstin.toUpperCase(Locale.ROOT));
            p.setStateCode(s);
        } catch (RuntimeException e) {
            // Legacy values that would fail the table's CHECKs are not copied.
            log.info("Not seeding billing profile of {} from inconsistent legacy GST fields", institute.getId());
            if (legacyState != null && IndianStates.isValidCode(legacyState)) {
                p.setStateCode(legacyState);
            }
        }
        return p;
    }

    /** Same address string the legacy invoice built from the institute row. */
    public static String buildInstituteAddress(Institute b) {
        if (b == null) return null;
        StringBuilder sb = new StringBuilder();
        appendIfPresent(sb, b.getAddress());
        appendIfPresent(sb, b.getCity());
        appendIfPresent(sb, b.getState());
        appendIfPresent(sb, b.getPinCode());
        appendIfPresent(sb, b.getCountry());
        String addr = sb.toString().trim();
        return addr.isEmpty() ? null : addr;
    }

    private static void appendIfPresent(StringBuilder sb, String s) {
        if (s == null || s.isBlank()) return;
        if (sb.length() > 0) sb.append(", ");
        sb.append(s.trim());
    }

    private static String safe(String s) {
        return s == null || s.isBlank() ? "Institute" : s.trim();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String clip(String s, int max) {
        String t = blankToNull(s);
        return t == null ? null : (t.length() > max ? t.substring(0, max) : t);
    }
}
