package vacademy.io.admin_core_service.features.commerce.document.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;

import java.util.List;
import java.util.Optional;

public interface CommerceDocumentSeriesRepository extends JpaRepository<CommerceDocumentSeries, String> {

    Optional<CommerceDocumentSeries> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceDocumentSeries> findByInstituteIdAndPrefixAndFinancialYear(String instituteId, String prefix,
                                                                               String financialYear);

    Page<CommerceDocumentSeries> findByInstituteId(String instituteId, Pageable pageable);

    List<CommerceDocumentSeries> findByInstituteIdAndDocumentTypeAndFinancialYearAndStatus(
            String instituteId, String documentType, String financialYear, String status);

    /** Every series of a document type, whatever its year or status; a handful of rows per institute. */
    List<CommerceDocumentSeries> findByInstituteIdAndDocumentType(String instituteId, String documentType);

    /** Every ACTIVE series of a document type, whatever its year; a handful of rows per institute. */
    List<CommerceDocumentSeries> findByInstituteIdAndDocumentTypeAndStatus(String instituteId, String documentType,
                                                                          String status);

    /**
     * Takes the row lock on the series and returns its next value. The lock is held until the
     * surrounding transaction ends, so this must run inside the document transaction. Native
     * and scalar on purpose: an entity read could hand back a stale copy from the persistence
     * context. Null when the row is not an ACTIVE SYSTEM series of the institute.
     */
    @Query(value = "SELECT next_value FROM commerce_document_series"
            + " WHERE id = :seriesId AND institute_id = :instituteId"
            + " AND status = 'ACTIVE' AND kind = 'SYSTEM' FOR UPDATE", nativeQuery = true)
    Long lockNextValue(@Param("instituteId") String instituteId, @Param("seriesId") String seriesId);

    /** Called only while {@link #lockNextValue} holds the row. */
    @Modifying
    @Query(value = "UPDATE commerce_document_series SET next_value = :nextValue, updated_at = CURRENT_TIMESTAMP"
            + " WHERE id = :seriesId", nativeQuery = true)
    int storeNextValue(@Param("seriesId") String seriesId, @Param("nextValue") long nextValue);

    /**
     * Opens the same series for a new financial year, starting at 1. Two issuers can reach the
     * first document of a year together; the unique key on (institute, prefix, year) lets one
     * insert win and the other do nothing, without failing the transaction.
     */
    @Modifying
    @Query(value = "INSERT INTO commerce_document_series (id, institute_id, seller_gstin, location_id, register_id,"
            + " channel, document_type, kind, prefix, financial_year, next_value, status)"
            + " SELECT :newId, s.institute_id, s.seller_gstin, s.location_id, s.register_id, s.channel,"
            + " s.document_type, s.kind, s.prefix, :financialYear, 1, 'ACTIVE'"
            + " FROM commerce_document_series s WHERE s.id = :sourceId AND s.institute_id = :instituteId"
            + " ON CONFLICT (institute_id, prefix, financial_year) DO NOTHING", nativeQuery = true)
    int openForYear(@Param("instituteId") String instituteId, @Param("sourceId") String sourceId,
                    @Param("newId") String newId, @Param("financialYear") String financialYear);
}
