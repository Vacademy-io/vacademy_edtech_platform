package vacademy.io.admin_core_service.features.commerce.shipment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceShipmentRepository extends JpaRepository<CommerceShipment, String> {

    Optional<CommerceShipment> findByIdAndInstituteId(String id, String instituteId);

    List<CommerceShipment> findByOrderIdOrderByCreatedAtAsc(String orderId);

    List<CommerceShipment> findByOrderIdInOrderByCreatedAtAsc(Collection<String> orderIds);

    /** The shipment row locked FOR UPDATE; taken after the order row lock. */
    @Query(value = "SELECT s.id FROM commerce_shipment s WHERE s.id = :id AND s.institute_id = :instituteId "
            + "FOR UPDATE", nativeQuery = true)
    Optional<String> lockId(@Param("id") String id, @Param("instituteId") String instituteId);

    /** The live (not cancelled) shipment of an order, if any. */
    @Query(value = "SELECT s.id FROM commerce_shipment s WHERE s.order_id = :orderId AND s.status <> 'CANCELLED'",
            nativeQuery = true)
    Optional<String> findLiveId(@Param("orderId") String orderId);
}
