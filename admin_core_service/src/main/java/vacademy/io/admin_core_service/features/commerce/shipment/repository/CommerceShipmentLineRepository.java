package vacademy.io.admin_core_service.features.commerce.shipment.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;

import java.util.Collection;
import java.util.List;

public interface CommerceShipmentLineRepository extends JpaRepository<CommerceShipmentLine, String> {

    List<CommerceShipmentLine> findByShipmentIdOrderByCreatedAtAscIdAsc(String shipmentId);

    List<CommerceShipmentLine> findByShipmentIdIn(Collection<String> shipmentIds);
}
