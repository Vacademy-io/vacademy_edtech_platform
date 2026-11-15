package vacademy.io.admin_core_service.features.commerce.customer.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;

import java.util.Date;
import java.util.Optional;

public interface CommerceCustomerRepository extends JpaRepository<CommerceCustomer, String> {

    Optional<CommerceCustomer> findByInstituteIdAndPhone(String instituteId, String phone);

    Optional<CommerceCustomer> findByIdAndInstituteId(String id, String instituteId);

    /** A row with the phone alone when the shop has not seen the phone; else nothing. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_customer (id, institute_id, phone)
            VALUES (:id, :instituteId, :phone)
            ON CONFLICT (institute_id, phone) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") String id, @Param("instituteId") String instituteId,
                       @Param("phone") String phone);

    /**
     * Creates the customer of a phone, or fills what an existing row lacks. One statement, so
     * two first orders of one phone at the same moment end with one row. Name, e-mail and user
     * are never overwritten: a later checkout that types another name changes its order only.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_customer (id, institute_id, user_id, phone, name, email)
            VALUES (:id, :instituteId, CAST(:userId AS VARCHAR), :phone, CAST(:name AS VARCHAR),
                    CAST(:email AS VARCHAR))
            ON CONFLICT (institute_id, phone) DO UPDATE
            SET user_id = COALESCE(commerce_customer.user_id, EXCLUDED.user_id),
                name = COALESCE(commerce_customer.name, EXCLUDED.name),
                email = COALESCE(commerce_customer.email, EXCLUDED.email),
                updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    int upsert(@Param("id") String id, @Param("instituteId") String instituteId, @Param("userId") String userId,
               @Param("phone") String phone, @Param("name") String name, @Param("email") String email);

    /** What a shopper session is checked against, read fresh from the table. */
    interface SessionRow {
        String getId();

        String getPhone();

        Integer getSessionEpoch();

        Date getAnonymisedAt();
    }

    @Query(value = """
            SELECT c.id AS id, c.phone AS phone, c.session_epoch AS sessionEpoch, c.anonymised_at AS anonymisedAt
            FROM commerce_customer c WHERE c.id = :id AND c.institute_id = :instituteId
            """, nativeQuery = true)
    Optional<SessionRow> findSessionRow(@Param("id") String id, @Param("instituteId") String instituteId);

    @Query(value = """
            SELECT c.id AS id, c.phone AS phone, c.session_epoch AS sessionEpoch, c.anonymised_at AS anonymisedAt
            FROM commerce_customer c WHERE c.institute_id = :instituteId AND c.phone = :phone
            """, nativeQuery = true)
    Optional<SessionRow> findSessionRowByPhone(@Param("instituteId") String instituteId, @Param("phone") String phone);

    /** Ends every shopper session of this customer: one atomic increment. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE commerce_customer SET session_epoch = session_epoch + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND institute_id = :instituteId
            """, nativeQuery = true)
    int bumpSessionEpoch(@Param("id") String id, @Param("instituteId") String instituteId);
}
