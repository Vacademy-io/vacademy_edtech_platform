package vacademy.io.admin_core_service.features.commerce.common;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * Refusals that keep course tooling and legacy writers off shop products. A product's variants
 * all sit on level and session DEFAULT, which the course tooling cannot tell apart, and its
 * price, invite, stock and order lines have their own writers in Commerce.
 *
 * <p>A package is a shop product when it has a {@code commerce_product} row, and a package
 * session is a variant when it has a {@code commerce_variant} row. The package type alone does
 * not decide it: {@code PRODUCT} is also a course type that bulk course creation can write, and
 * such a course stays a course. Where the type is at hand it is used only to skip the lookup.
 */
@Component
public class CommerceLegacyGuard {

    /** Level and session rows shared by every institute. */
    public static final Set<String> SHARED_LEVEL_AND_SESSION_IDS = Set.of("DEFAULT", "INVITED");

    private final CommerceProductRepository productRepository;
    private final CommerceVariantRepository variantRepository;

    public CommerceLegacyGuard(CommerceProductRepository productRepository,
                               CommerceVariantRepository variantRepository) {
        this.productRepository = productRepository;
        this.variantRepository = variantRepository;
    }

    public boolean isProduct(PackageEntity packageEntity) {
        return packageEntity != null && isProduct(packageEntity.getId(), packageEntity.getPackageType());
    }

    public boolean isProduct(String packageId, String packageType) {
        return StringUtils.hasText(packageId)
                && CommercePackageTypes.isCommerce(packageType)
                && productRepository.existsByPackageId(packageId);
    }

    /** For callers that know the type of the session's package: no lookup unless it is PRODUCT. */
    public boolean isVariantSession(String packageSessionId, String packageType) {
        return CommercePackageTypes.isCommerce(packageType) && isVariantSession(packageSessionId);
    }

    public boolean isVariantSession(String packageSessionId) {
        return StringUtils.hasText(packageSessionId) && variantRepository.existsByPackageSessionId(packageSessionId);
    }

    /** Throws 400 when the package is a shop product. {@code action} completes "Cannot ...". */
    public void refuseProduct(PackageEntity packageEntity, String action) {
        if (isProduct(packageEntity)) {
            throw refusal(action);
        }
    }

    public void refuseVariantSession(String packageSessionId, String packageType, String action) {
        if (isVariantSession(packageSessionId, packageType)) {
            throw refusal(action);
        }
    }

    public void refuseVariantSession(String packageSessionId, String action) {
        if (isVariantSession(packageSessionId)) {
            throw refusal(action);
        }
    }

    /** Throws 400 when any of the package sessions is a variant. One query for the whole list. */
    public void refuseVariantSessions(Collection<String> packageSessionIds, String action) {
        List<String> ids = clean(packageSessionIds);
        if (!ids.isEmpty() && !variantRepository.findVariantSessionIdsIn(ids).isEmpty()) {
            throw refusal(action);
        }
    }

    /** Throws 400 when any of the invites sells a variant. */
    public void refuseCommerceInvites(Collection<String> enrollInviteIds, String action) {
        List<String> ids = clean(enrollInviteIds);
        if (!ids.isEmpty() && !variantRepository.findCommerceInviteIdsIn(ids).isEmpty()) {
            throw refusal(action);
        }
    }

    /** Throws 400 when any of the invite-to-session link rows belongs to a variant. */
    public void refuseVariantLinks(Collection<String> linkIds, String action) {
        List<String> ids = clean(linkIds);
        if (!ids.isEmpty() && !variantRepository.findVariantLinkIdsIn(ids).isEmpty()) {
            throw refusal(action);
        }
    }

    private static List<String> clean(Collection<String> ids) {
        if (ids == null) {
            return List.of();
        }
        return ids.stream().filter(StringUtils::hasText).map(String::trim).distinct().toList();
    }

    private static VacademyException refusal(String action) {
        return new VacademyException(HttpStatus.BAD_REQUEST,
                "Cannot " + action + ": this is a shop product and is managed in Commerce.");
    }

    public static boolean isSharedLevelOrSessionId(String id) {
        return id != null && SHARED_LEVEL_AND_SESSION_IDS.contains(id.trim().toUpperCase());
    }

    /** Throws 400 when the list names a level or session row that every institute shares. */
    public static void refuseSharedLevelOrSessionIds(Collection<String> ids, String what) {
        if (ids == null) {
            return;
        }
        for (String id : ids) {
            if (isSharedLevelOrSessionId(id)) {
                throw new VacademyException(HttpStatus.BAD_REQUEST,
                        "The " + what + " " + id.trim() + " is shared by all institutes and cannot be changed or deleted.");
            }
        }
    }
}
