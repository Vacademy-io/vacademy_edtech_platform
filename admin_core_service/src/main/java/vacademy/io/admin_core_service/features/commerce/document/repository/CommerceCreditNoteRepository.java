package vacademy.io.admin_core_service.features.commerce.document.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface CommerceCreditNoteRepository extends JpaRepository<CommerceCreditNote, String> {

    Optional<CommerceCreditNote> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceCreditNote> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    Page<CommerceCreditNote> findByInstituteId(String instituteId, Pageable pageable);

    Page<CommerceCreditNote> findByInstituteIdAndInvoiceId(String instituteId, String invoiceId, Pageable pageable);

    List<CommerceCreditNote> findByInstituteIdAndInvoiceIdOrderByCreatedAtAsc(String instituteId, String invoiceId);

    /** Credit notes whose PDF was never stored, for the retry job. */
    @Query("SELECT c FROM CommerceCreditNote c WHERE c.pdfFileId IS NULL"
            + " AND c.createdAt >= :since AND c.createdAt <= :until ORDER BY c.createdAt ASC")
    List<CommerceCreditNote> findWithoutPdf(@Param("since") LocalDateTime since, @Param("until") LocalDateTime until,
                                            Pageable pageable);

    @Modifying
    @Query("UPDATE CommerceCreditNote c SET c.pdfFileId = :pdfFileId WHERE c.id = :id AND c.pdfFileId IS NULL")
    int setPdfFileIdIfMissing(@Param("id") String id, @Param("pdfFileId") String pdfFileId);
}
