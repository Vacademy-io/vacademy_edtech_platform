package vacademy.io.admin_core_service.features.erp_finance.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.erp_finance.entity.JournalLine;

import java.util.List;

@Repository
public interface JournalLineRepository extends JpaRepository<JournalLine, String> {

    List<JournalLine> findByJournalEntryIdOrderByLineNoAsc(String journalEntryId);

    List<JournalLine> findByJournalEntryIdInOrderByJournalEntryIdAscLineNoAsc(List<String> entryIds);
}
