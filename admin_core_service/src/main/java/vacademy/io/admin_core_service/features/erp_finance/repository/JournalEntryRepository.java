package vacademy.io.admin_core_service.features.erp_finance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalEntry;

import java.util.List;
import java.util.Optional;

@Repository
public interface JournalEntryRepository extends JpaRepository<JournalEntry, String> {

    List<JournalEntry> findByInstituteIdAndPeriodYearAndPeriodMonthOrderByEntryDateAsc(
            String instituteId, Integer periodYear, Integer periodMonth);

    Optional<JournalEntry> findFirstBySourceModuleAndSourceIdAndStatusAndReversalOfEntryIdIsNull(
            String sourceModule, String sourceId, String status);

    Optional<JournalEntry> findByIdAndInstituteId(String id, String instituteId);
}
