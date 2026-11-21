package vacademy.io.admin_core_service.features.telephony.persistence.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;

import java.util.List;
import java.util.Optional;

@Repository
public interface TelephonyCounsellorEndpointRepository
        extends JpaRepository<TelephonyCounsellorEndpoint, String> {

    /** Outbound: counsellor → their extension/DID for a provider. */
    Optional<TelephonyCounsellorEndpoint> findByCounsellorUserIdAndProviderType(
            String counsellorUserId, String providerType);

    /**
     * Promotion: an Airtel extension → the counsellor it belongs to, within the institute the
     * call record was attributed to. Extensions are only unique inside one Airtel account, so
     * a global lookup could file one institute's call under another institute's counsellor
     * (or fail outright when two rows matched). A list, so a duplicate left over from before
     * the per-institute uniqueness check reads as ambiguous rather than throwing.
     */
    List<TelephonyCounsellorEndpoint> findByInstituteIdAndProviderTypeAndExtensionAndEnabledTrue(
            String instituteId, String providerType, String extension);

    /** Promotion: an Airtel sourceUserId → the counsellor (alternate key), per institute. */
    List<TelephonyCounsellorEndpoint> findByInstituteIdAndProviderTypeAndProviderUserIdAndEnabledTrue(
            String instituteId, String providerType, String providerUserId);

    /** Uniqueness of an extension inside one institute (enabled or not). */
    List<TelephonyCounsellorEndpoint> findByInstituteIdAndProviderTypeAndExtension(
            String instituteId, String providerType, String extension);

    List<TelephonyCounsellorEndpoint> findByInstituteIdAndProviderType(
            String instituteId, String providerType);
}
