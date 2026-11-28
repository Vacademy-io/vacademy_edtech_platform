package vacademy.io.admin_core_service.features.certificate.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.certificate.entity.IssuedCertificate;

import java.util.List;
import java.util.Optional;

@Repository
public interface IssuedCertificateRepository extends JpaRepository<IssuedCertificate, String> {

    /**
     * Public verification lookup. BOTH the number and the token must match —
     * certificate numbers are sequential, so a number-only finder here would
     * make the public endpoint enumerable.
     */
    Optional<IssuedCertificate> findByCertificateIdAndVerificationToken(
            String certificateId, String verificationToken);

    /**
     * The barcode's equivalent of the finder above. Same rule: the number alone
     * is never sufficient, so the short code is required too.
     */
    Optional<IssuedCertificate> findByCertificateIdAndShortCode(
            String certificateId, String shortCode);

    /**
     * Short-code-only lookup, for a scan that yields just the code (a barcode an
     * institute chose to print without the number beside it). Safe without the
     * number because the short code is the unguessable half — the number is the
     * enumerable one. Unique index guarantees at most one row.
     */
    Optional<IssuedCertificate> findByShortCode(String shortCode);

    /** Type-aware twin of the finder below, for certificate kinds that can coexist on one batch. */
    Optional<IssuedCertificate> findFirstByUserIdAndPackageSessionIdAndCertificateTypeOrderByIssuedAtDesc(
            String userId, String packageSessionId, String certificateType);

    Optional<IssuedCertificate> findFirstByUserIdAndPackageSessionIdOrderByIssuedAtDesc(
            String userId, String packageSessionId);

    /** A learner's certificates in one institute, newest first (learner + parent read path). */
    List<IssuedCertificate> findByUserIdAndInstituteIdOrderByIssuedAtDesc(String userId, String instituteId);

    /**
     * A single certificate scoped to its owner — the sub-resource ownership check.
     * The guard proves parent&rarr;child; this proves certificate&rarr;child, so a parent
     * can't download a certificate that isn't their child's.
     */
    Optional<IssuedCertificate> findByIdAndUserId(String id, String userId);
}
