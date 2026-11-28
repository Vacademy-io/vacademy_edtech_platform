package vacademy.io.admin_core_service.features.commerce.document.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesStatus;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Picks the series for a document and takes its next number, inside the caller's transaction.
 * It never opens a transaction of its own: a
 * number taken in a separate transaction would survive the rollback of its document and leave
 * a gap. The series row is the last lock a flow takes, so callers ask
 * for the number after every other row they lock.
 */
@Service
@RequiredArgsConstructor
public class CommerceDocumentNumberService {

    private final CommerceDocumentSeriesRepository seriesRepository;

    /**
     * The next number of the series that fits the document. On the first document of a new
     * financial year the series of the year before are opened for the new year, starting at 1.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public DocumentNumberAllocator.Allocation allocate(String instituteId, DocumentType documentType,
                                                       String financialYear, String sellerGstin,
                                                       String locationId, String registerId, String channel) {
        CommerceDocumentSeries series = pick(instituteId, documentType, financialYear, sellerGstin, locationId,
                registerId, channel)
                .orElseThrow(() -> new ConflictException("SERIES_NOT_CONFIGURED: no active "
                        + documentType.name() + " series fits this document; add one under document series"));
        return new DocumentNumberAllocator(new DocumentNumberAllocator.CounterStore() {
            @Override
            public Long lockNextValue(String institute, String seriesId) {
                return seriesRepository.lockNextValue(institute, seriesId);
            }

            @Override
            public void storeNextValue(String seriesId, long nextValue) {
                seriesRepository.storeNextValue(seriesId, nextValue);
            }
        }).allocate(instituteId, series.getId(), series.getPrefix(), series.getFinancialYear());
    }

    /**
     * The series for the document. Before choosing, every ACTIVE SYSTEM series of the latest
     * earlier year that has no row yet in the wanted year is opened for it, starting at 1. All
     * of them, not only the one this document would use: otherwise the first document of April
     * decides which series exist, and a general series opened by an online order would take
     * over from the series of a store whose first sale comes later. A series closed in the
     * wanted year has a row there and is not opened again.
     */
    private Optional<CommerceDocumentSeries> pick(String instituteId, DocumentType documentType,
                                                  String financialYear, String sellerGstin, String locationId,
                                                  String registerId, String channel) {
        String active = SeriesStatus.ACTIVE.name();
        String system = SeriesKind.SYSTEM.name();
        int wantedYear = FinancialYear.startYear(financialYear);
        List<CommerceDocumentSeries> all = seriesRepository.findByInstituteIdAndDocumentType(instituteId,
                documentType.name());
        Set<String> prefixesOfWantedYear = all.stream()
                .filter(s -> financialYear.equals(s.getFinancialYear()))
                .map(CommerceDocumentSeries::getPrefix).collect(Collectors.toSet());
        List<CommerceDocumentSeries> earlier = all.stream()
                .filter(s -> active.equals(s.getStatus()) && system.equals(s.getKind()))
                .filter(s -> FinancialYear.startYear(s.getFinancialYear()) < wantedYear)
                .toList();
        Optional<Integer> latestYear = earlier.stream()
                .map(s -> FinancialYear.startYear(s.getFinancialYear())).max(Comparator.naturalOrder());
        boolean opened = false;
        if (latestYear.isPresent()) {
            // In prefix order, so two issuers that open several series never wait on each other
            // in a circle.
            List<CommerceDocumentSeries> sources = earlier.stream()
                    .sorted(Comparator.comparing(CommerceDocumentSeries::getPrefix)).toList();
            for (CommerceDocumentSeries source : sources) {
                if (FinancialYear.startYear(source.getFinancialYear()) == latestYear.get()
                        && !prefixesOfWantedYear.contains(source.getPrefix())) {
                    // Two issuers can reach the first document of a year together; the unique
                    // key lets one insert win and the other do nothing.
                    seriesRepository.openForYear(instituteId, source.getId(), UUID.randomUUID().toString(),
                            financialYear);
                    opened = true;
                }
            }
        }
        List<CommerceDocumentSeries> candidates = opened
                ? seriesRepository.findByInstituteIdAndDocumentTypeAndFinancialYearAndStatus(
                        instituteId, documentType.name(), financialYear, active)
                : all.stream().filter(s -> financialYear.equals(s.getFinancialYear())
                        && active.equals(s.getStatus())).toList();
        return SeriesPicker.pick(candidates, sellerGstin, locationId, registerId, channel);
    }
}
