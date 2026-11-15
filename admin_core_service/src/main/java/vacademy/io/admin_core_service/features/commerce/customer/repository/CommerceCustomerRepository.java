package vacademy.io.admin_core_service.features.commerce.customer.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;

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
}
