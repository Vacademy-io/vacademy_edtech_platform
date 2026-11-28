package vacademy.io.admin_core_service.features.commerce.returns.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturnLine;

import java.util.Collection;
import java.util.List;

public interface CommerceReturnLineRepository extends JpaRepository<CommerceReturnLine, String> {

    List<CommerceReturnLine> findByReturnIdOrderByCreatedAtAscIdAsc(String returnId);

    List<CommerceReturnLine> findByReturnIdIn(Collection<String> returnIds);
}
