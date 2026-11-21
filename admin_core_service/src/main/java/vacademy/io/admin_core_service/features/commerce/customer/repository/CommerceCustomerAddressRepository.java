package vacademy.io.admin_core_service.features.commerce.customer.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomerAddress;

import java.util.List;
import java.util.Optional;

public interface CommerceCustomerAddressRepository extends JpaRepository<CommerceCustomerAddress, String> {

    List<CommerceCustomerAddress> findByInstituteIdAndCustomerIdAndStatusOrderByIsDefaultDescCreatedAtDesc(
            String instituteId, String customerId, String status);

    Optional<CommerceCustomerAddress> findByIdAndInstituteIdAndCustomerId(String id, String instituteId,
                                                                          String customerId);

    long countByInstituteIdAndCustomerIdAndStatus(String instituteId, String customerId, String status);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_customer_address SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND customer_id = :customerId AND is_default
            """, nativeQuery = true)
    int clearDefault(@Param("instituteId") String instituteId, @Param("customerId") String customerId);
}
