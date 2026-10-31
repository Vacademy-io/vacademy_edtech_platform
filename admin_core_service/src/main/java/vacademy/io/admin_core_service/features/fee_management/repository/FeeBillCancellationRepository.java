package vacademy.io.admin_core_service.features.fee_management.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeBillCancellation;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface FeeBillCancellationRepository extends JpaRepository<FeeBillCancellation, String> {

    /** The open (not reopened) cancellation of each of these bills. */
    List<FeeBillCancellation> findByStudentFeePaymentIdInAndReopenedAtIsNull(Collection<String> studentFeePaymentIds);

    List<FeeBillCancellation> findByBatchIdAndReopenedAtIsNull(String batchId);

    Optional<FeeBillCancellation> findFirstByStudentFeePaymentIdAndReopenedAtIsNullOrderByCancelledAtDesc(
            String studentFeePaymentId);
}
