package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariant;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceVariantRepository extends JpaRepository<CommerceVariant, String> {

    Optional<CommerceVariant> findByInstituteIdAndPackageSessionId(String instituteId, String packageSessionId);

    Optional<CommerceVariant> findByInstituteIdAndSku(String instituteId, String sku);

    Optional<CommerceVariant> findByInstituteIdAndBarcode(String instituteId, String barcode);

    List<CommerceVariant> findByInstituteIdAndPackageIdOrderByPositionAsc(String instituteId, String packageId);

    List<CommerceVariant> findByInstituteIdAndPackageIdIn(String instituteId, Collection<String> packageIds);

    Page<CommerceVariant> findByInstituteIdAndPackageId(String instituteId, String packageId, Pageable pageable);

    // The reads below answer "is this legacy row a shop variant?" for the guards on legacy
    // code. They return no data, so they carry no institute filter: the caller has only the id.

    boolean existsByPackageSessionId(String packageSessionId);

    @Query("SELECT v.packageSessionId FROM CommerceVariant v WHERE v.packageSessionId IN :packageSessionIds")
    List<String> findVariantSessionIdsIn(@Param("packageSessionIds") Collection<String> packageSessionIds);

    /** How many variants the invite sells, whatever the status of the link rows. */
    @Query("""
            SELECT COUNT(v) FROM CommerceVariant v, PackageSessionLearnerInvitationToPaymentOption l
            WHERE l.enrollInvite.id = :enrollInviteId
              AND v.packageSessionId = l.packageSession.id
            """)
    long countVariantsOnInvite(@Param("enrollInviteId") String enrollInviteId);

    @Query("""
            SELECT DISTINCT l.enrollInvite.id FROM PackageSessionLearnerInvitationToPaymentOption l, CommerceVariant v
            WHERE l.enrollInvite.id IN :enrollInviteIds
              AND v.packageSessionId = l.packageSession.id
            """)
    List<String> findCommerceInviteIdsIn(@Param("enrollInviteIds") Collection<String> enrollInviteIds);

    /** Of the given invite-to-session link rows, those that belong to a variant. */
    @Query("""
            SELECT l.id FROM PackageSessionLearnerInvitationToPaymentOption l, CommerceVariant v
            WHERE l.id IN :linkIds
              AND v.packageSessionId = l.packageSession.id
            """)
    List<String> findVariantLinkIdsIn(@Param("linkIds") Collection<String> linkIds);
}
