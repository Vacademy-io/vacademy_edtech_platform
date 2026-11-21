package vacademy.io.notification_service.features.notification_log.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.notification_log.entity.EmailAddressMapping;

import java.util.List;

public interface EmailAddressMappingRepository extends JpaRepository<EmailAddressMapping, String> {

    /**
     * Every institute that has this address active. Several can: the unique key is (address, institute),
     * so two institutes adding the same sender each get a row.
     */
    List<EmailAddressMapping> findAllByEmailAddressIgnoreCaseAndIsActiveTrue(String emailAddress);

    /** Active inbound-enabled addresses for an institute. Used to scope email inbox + stats. */
    List<EmailAddressMapping> findAllByInstituteIdAndIsActiveTrue(String instituteId);

    boolean existsByInstituteIdAndIsActiveTrue(String instituteId);

    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO email_address_mapping (id, email_address, institute_id, email_type, is_active, created_at, updated_at)
            VALUES (:id, :emailAddress, :instituteId, :emailType, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (email_address, institute_id) DO UPDATE SET
                email_type = EXCLUDED.email_type,
                is_active = true,
                updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    void upsert(
            @Param("id") String id,
            @Param("emailAddress") String emailAddress,
            @Param("instituteId") String instituteId,
            @Param("emailType") String emailType
    );

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE email_address_mapping
            SET is_active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId
              AND email_type = :emailType
              AND is_active = true
            """, nativeQuery = true)
    int deactivateByInstituteIdAndEmailType(
            @Param("instituteId") String instituteId,
            @Param("emailType") String emailType
    );

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE email_address_mapping
            SET is_active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId
              AND LOWER(email_address) = LOWER(:emailAddress)
              AND is_active = true
            """, nativeQuery = true)
    int deactivateByInstituteIdAndEmailAddress(
            @Param("instituteId") String instituteId,
            @Param("emailAddress") String emailAddress
    );
}
