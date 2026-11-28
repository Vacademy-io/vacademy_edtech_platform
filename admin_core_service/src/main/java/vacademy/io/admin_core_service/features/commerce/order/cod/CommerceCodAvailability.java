package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

/**
 * Whether cash on delivery can be placed online: the deployment switch
 * {@code commerce.cod.placement-enabled} (env {@code COMMERCE_COD_PLACEMENT_ENABLED}, default
 * false) <b>and</b> the shop's own {@code cod.enabled}. The checkout config, the cart price, the
 * pincode check and checkout itself all read this one answer, so no page offers COD that
 * checkout would refuse.
 */
@Component
public class CommerceCodAvailability {

    private final boolean placementEnabled;

    public CommerceCodAvailability(@Value("${commerce.cod.placement-enabled:false}") boolean placementEnabled) {
        this.placementEnabled = placementEnabled;
    }

    /** The switch off: what a deployment without the property gets. */
    public static CommerceCodAvailability off() {
        return new CommerceCodAvailability(false);
    }

    /** The deployment allows COD placement (the shop must still switch it on). */
    public boolean placementEnabled() {
        return placementEnabled;
    }

    /** COD can be placed for a shop with these settings. */
    public boolean effective(StorefrontSettings.Cod cod) {
        return placementEnabled && cod != null && cod.enabled();
    }

    /**
     * The shop's COD settings with {@code enabled} replaced by the effective answer: what
     * {@link CodEligibility#check} is given, so that a switched-off deployment answers
     * {@code COD_DISABLED}.
     */
    public StorefrontSettings.Cod effectiveCod(StorefrontSettings.Cod cod) {
        if (cod == null) {
            return null;
        }
        return cod.withEnabled(effective(cod));
    }
}
