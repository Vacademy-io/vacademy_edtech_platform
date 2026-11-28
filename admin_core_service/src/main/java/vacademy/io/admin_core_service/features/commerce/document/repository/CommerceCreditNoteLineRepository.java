package vacademy.io.admin_core_service.features.commerce.document.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNoteLine;

import java.util.Collection;
import java.util.List;

public interface CommerceCreditNoteLineRepository extends JpaRepository<CommerceCreditNoteLine, String> {

    List<CommerceCreditNoteLine> findByInstituteIdAndCreditNoteIdOrderByCreatedAtAsc(String instituteId,
                                                                                  String creditNoteId);

    List<CommerceCreditNoteLine> findByInstituteIdAndCreditNoteIdIn(String instituteId,
                                                                   Collection<String> creditNoteIds);
}
