package vacademy.io.admin_core_service.features.commerce.storefront.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;

/**
 * The feature check of the public shop routes: {@link CommerceAccessGuard#requireFeature} for
 * the institute of the API key, answered in the Catalogue API error shape. An institute without
 * the feature gets 403 {@code commerce_not_enabled} and no data.
 */
@Component
@RequiredArgsConstructor
public class StorefrontFeatureGate {

    private final CommerceAccessGuard guard;

    public void require(String instituteId, CommerceFeature feature) {
        try {
            guard.requireFeature(instituteId, feature);
        } catch (CommerceAccessDeniedException e) {
            throw new CatalogApiException(HttpStatus.FORBIDDEN, "commerce_not_enabled",
                    "The shop is not enabled for this institute.");
        }
    }

    public boolean has(String instituteId, CommerceFeature feature) {
        try {
            guard.requireFeature(instituteId, feature);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
