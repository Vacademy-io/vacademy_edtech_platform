package vacademy.io.admin_core_service.features.commerce.accounts.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierSecret;

import java.util.List;
import java.util.Optional;

/**
 * Encrypted supplier identifiers. Only the reveal path loads the entity; everything else reads
 * {@code pan_last4} through {@link #findLast4}.
 */
public interface CommerceSupplierSecretRepository extends JpaRepository<CommerceSupplierSecret, String> {

    Optional<CommerceSupplierSecret> findByInstituteIdAndSupplierId(String instituteId, String supplierId);

    /** The last four characters of the stored PAN, for the masked display; empty when none is stored. */
    @Query("SELECT s.panLast4 FROM CommerceSupplierSecret s WHERE s.instituteId = :instituteId"
            + " AND s.supplierId = :supplierId")
    Optional<String> findLast4(@Param("instituteId") String instituteId, @Param("supplierId") String supplierId);

    /** Removes the stored PAN of a supplier; answers the rows removed (0 or 1). Needs a transaction. */
    @Modifying
    @Query("DELETE FROM CommerceSupplierSecret s WHERE s.instituteId = :instituteId AND s.supplierId = :supplierId")
    int deleteByInstituteIdAndSupplierId(@Param("instituteId") String instituteId,
                                         @Param("supplierId") String supplierId);

    /** {@code [key_id, count]} per key id of the institute's stored values (for the encryption status). */
    @Query("SELECT s.keyId, COUNT(s) FROM CommerceSupplierSecret s WHERE s.instituteId = :instituteId"
            + " GROUP BY s.keyId ORDER BY s.keyId")
    List<Object[]> countByKeyId(@Param("instituteId") String instituteId);

    /**
     * Stores or replaces the PAN of a supplier in one statement ({@code supplier_id} is unique).
     * {@code id} is used only when the row is new. Needs a transaction.
     */
    @Modifying
    @Query(value = """
            INSERT INTO commerce_supplier_secret
                (id, institute_id, supplier_id, pan_encrypted, key_id, pan_hash, pan_last4, updated_by)
            VALUES (:id, :instituteId, :supplierId, :panEncrypted, :keyId, :panHash, :panLast4,
                CAST(:updatedBy AS VARCHAR))
            ON CONFLICT (supplier_id)
            DO UPDATE SET pan_encrypted = EXCLUDED.pan_encrypted, key_id = EXCLUDED.key_id,
                pan_hash = EXCLUDED.pan_hash, pan_last4 = EXCLUDED.pan_last4,
                updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
            WHERE commerce_supplier_secret.institute_id = EXCLUDED.institute_id
            """, nativeQuery = true)
    int upsert(@Param("id") String id,
               @Param("instituteId") String instituteId,
               @Param("supplierId") String supplierId,
               @Param("panEncrypted") String panEncrypted,
               @Param("keyId") String keyId,
               @Param("panHash") String panHash,
               @Param("panLast4") String panLast4,
               @Param("updatedBy") String updatedBy);
}
