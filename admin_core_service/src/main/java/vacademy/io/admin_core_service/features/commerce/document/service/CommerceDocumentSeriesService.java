package vacademy.io.admin_core_service.features.commerce.document.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentChannel;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesKind;
import vacademy.io.admin_core_service.features.commerce.document.enums.SeriesStatus;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.enumValue;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.require;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.trimToNull;

/**
 * Setup of document series and bill books. A series is fixed once created (prefix, year, type,
 * place): only its status changes, so the numbers it has issued always read the same way.
 */
@Service
@RequiredArgsConstructor
public class CommerceDocumentSeriesService {

    /** GST allows letters, digits, slash and hyphen in a document number. */
    private static final Pattern PREFIX = Pattern.compile("^[A-Z0-9][A-Z0-9/-]{0,5}$");
    private static final Pattern FINANCIAL_YEAR = Pattern.compile("^[0-9]{4}(-[0-9]{2})?$");

    private final CommerceDocumentSeriesRepository seriesRepository;
    private final InvoiceRepository invoiceRepository;
    private final CommerceTaxSettingService taxSettingService;
    private final CommerceSellerLookup sellerLookup;
    private final DocumentClock clock;
    private final CommerceAuditService auditService;

    /** The POS registers (WP-42); resolved lazily so the document package needs no POS bean. */
    private ObjectProvider<PosRegisterRepository> registerRepository;

    @Autowired(required = false)
    public void setRegisterRepository(ObjectProvider<PosRegisterRepository> registerRepository) {
        this.registerRepository = registerRepository;
    }

    @Transactional(readOnly = true)
    public Page<DocumentSeriesDTO> list(String instituteId, int page, int size) {
        return seriesRepository.findByInstituteId(instituteId, CommerceInputRules.page(page, size,
                        Sort.by(Sort.Order.desc("financialYear"), Sort.Order.asc("documentType"),
                                Sort.Order.asc("prefix"))))
                .map(CommerceDocumentSeriesService::toDto);
    }

    @Transactional(readOnly = true)
    public DocumentSeriesDTO get(String instituteId, String seriesId) {
        return toDto(requireSeries(instituteId, seriesId));
    }

    @Transactional
    public DocumentSeriesDTO create(String instituteId, String actorUserId, DocumentSeriesDTO request) {
        require(request != null, "request body is required");
        DocumentType documentType = enumValue(DocumentType.class, request.getDocumentType(), "document_type");
        require(documentType != null, "document_type is required");
        SeriesKind kind = enumValue(SeriesKind.class, request.getKind(), "kind");
        if (kind == null) {
            kind = SeriesKind.SYSTEM;
        }
        DocumentChannel channel = enumValue(DocumentChannel.class, request.getChannel(), "channel");
        if (channel == null) {
            channel = DocumentChannel.ALL;
        }
        String prefix = trimToNull(request.getPrefix());
        require(prefix != null, "prefix is required");
        prefix = prefix.toUpperCase(Locale.ROOT);
        require(PREFIX.matcher(prefix).matches(),
                "prefix is 1 to 6 characters: letters, digits, slash and hyphen, starting with a letter or digit");

        String financialYear = trimToNull(request.getFinancialYear());
        if (financialYear == null) {
            financialYear = FinancialYear.of(clock.today(instituteId),
                    taxSettingService.context(instituteId).getFyStartMonth());
        }
        require(FINANCIAL_YEAR.matcher(financialYear).matches(), "financial_year looks like 2026-27 or 2026");

        String sellerGstin = GstinValidator.normalise(request.getSellerGstin());
        require(sellerGstin == null || GstinValidator.isValid(sellerGstin), "seller_gstin is not a valid GSTIN");

        String locationId = trimToNull(request.getLocationId());
        if (locationId != null) {
            require(sellerLookup.locationBelongsToInstitute(instituteId, locationId),
                    "location_id is not a location of this institute");
        }
        // A register's own series: a SYSTEM series of the register's location, for counter sales.
        String registerId = trimToNull(request.getRegisterId());
        if (registerId != null) {
            requireRegisterOf(instituteId, registerId, locationId);
            require(channel == DocumentChannel.POS || channel == DocumentChannel.ALL,
                    "VALIDATION: a register series has the channel POS or ALL");
            require(kind == SeriesKind.SYSTEM, "VALIDATION: a register series is a SYSTEM series, not a bill book");
        }

        CommerceDocumentSeries series = new CommerceDocumentSeries();
        series.setInstituteId(instituteId);
        series.setDocumentType(documentType.name());
        series.setKind(kind.name());
        series.setChannel(channel.name());
        series.setPrefix(prefix);
        series.setFinancialYear(financialYear);
        series.setSellerGstin(sellerGstin);
        series.setLocationId(locationId);
        series.setRegisterId(registerId);
        series.setStatus(SeriesStatus.ACTIVE.name());

        if (kind == SeriesKind.MANUAL_BOOK) {
            require(documentType != DocumentType.CREDIT_NOTE, "a bill book cannot be a credit note series");
            require(locationId != null, "a bill book belongs to a location: location_id is required");
            require(request.getBookFrom() != null && request.getBookTo() != null,
                    "book_from and book_to are required for a bill book");
            require(request.getBookFrom() >= 1 && request.getBookTo() >= request.getBookFrom(),
                    "book_to cannot be below book_from, and both start at 1");
            series.setBookFrom(request.getBookFrom());
            series.setBookTo(request.getBookTo());
            series.setNextValue(1L);
            require(DocumentNumberAllocator.format(prefix, financialYear, request.getBookTo()).length()
                    <= DocumentNumberAllocator.MAX_NUMBER_LENGTH, "book_to is too large for a 16-character number");
        } else {
            require(request.getBookFrom() == null && request.getBookTo() == null,
                    "book_from and book_to are only for a bill book");
            long start = request.getNextValue() == null ? 1L : request.getNextValue();
            require(start >= 1, "next_value starts at 1");
            require(DocumentNumberAllocator.format(prefix, financialYear, start).length()
                    <= DocumentNumberAllocator.MAX_NUMBER_LENGTH, "next_value is too large for a 16-character number");
            series.setNextValue(start);
        }

        if (seriesRepository.findByInstituteIdAndPrefixAndFinancialYear(instituteId, prefix, financialYear)
                .isPresent()) {
            throw new ConflictException("A series with the prefix " + prefix + " already exists for " + financialYear);
        }
        // invoice.invoice_number is unique per institute across the old numbering too. A commerce
        // number that met an old one would fail at issue time, every time; refuse the prefix now.
        String numberStart = prefix + FinancialYear.token(financialYear) + "-";
        if (documentType != DocumentType.CREDIT_NOTE
                && invoiceRepository.existsByInstituteIdAndInvoiceNumberStartingWith(instituteId, numberStart)) {
            throw new ConflictException("SERIES_PREFIX_IN_USE: existing invoice numbers already start with "
                    + numberStart + "; choose another prefix");
        }

        series = seriesRepository.save(series);
        auditService.record(instituteId, actorUserId, locationId, "DOCUMENT_SERIES_CREATED", "DOCUMENT_SERIES",
                series.getId(), null, CommerceInputRules.json(auditView(series)), null);
        return toDto(series);
    }

    /** Close or reopen. Nothing else about a series can change. */
    @Transactional
    public DocumentSeriesDTO setStatus(String instituteId, String actorUserId, String seriesId, String status) {
        SeriesStatus wanted = enumValue(SeriesStatus.class, status, "status");
        require(wanted != null, "status is required");
        CommerceDocumentSeries series = requireSeries(instituteId, seriesId);
        if (!wanted.name().equals(series.getStatus())) {
            String before = CommerceInputRules.json(auditView(series));
            series.setStatus(wanted.name());
            series = seriesRepository.save(series);
            auditService.record(instituteId, actorUserId, series.getLocationId(), "DOCUMENT_SERIES_STATUS",
                    "DOCUMENT_SERIES", series.getId(), before, CommerceInputRules.json(auditView(series)), null);
        }
        return toDto(series);
    }

    /** 400 unless the register is a register of this institute at {@code locationId}. */
    private void requireRegisterOf(String instituteId, String registerId, String locationId) {
        PosRegisterRepository registers = registerRepository == null ? null : registerRepository.getIfAvailable();
        PosRegister register = registers == null ? null
                : registers.findByInstituteIdAndId(instituteId, registerId).orElse(null);
        require(register != null && locationId != null && locationId.equals(register.getLocationId()),
                "VALIDATION: register_id is not a register of this location");
    }

    private CommerceDocumentSeries requireSeries(String instituteId, String seriesId) {
        return seriesRepository.findByInstituteIdAndId(instituteId, seriesId)
                .orElseThrow(() -> new ResourceNotFoundException("Document series not found"));
    }

    private static DocumentSeriesDTO toDto(CommerceDocumentSeries series) {
        boolean system = SeriesKind.SYSTEM.name().equals(series.getKind());
        return DocumentSeriesDTO.builder()
                .id(series.getId())
                .sellerGstin(series.getSellerGstin())
                .locationId(series.getLocationId())
                .registerId(series.getRegisterId())
                .channel(series.getChannel())
                .documentType(series.getDocumentType())
                .kind(series.getKind())
                .prefix(series.getPrefix())
                .financialYear(series.getFinancialYear())
                .nextValue(system ? series.getNextValue() : null)
                .bookFrom(series.getBookFrom())
                .bookTo(series.getBookTo())
                .status(series.getStatus())
                .nextNumberPreview(system && series.getNextValue() != null
                        ? DocumentNumberAllocator.format(series.getPrefix(), series.getFinancialYear(),
                                series.getNextValue())
                        : null)
                .build();
    }

    private static Map<String, Object> auditView(CommerceDocumentSeries series) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("document_type", series.getDocumentType());
        view.put("kind", series.getKind());
        view.put("prefix", series.getPrefix());
        view.put("financial_year", series.getFinancialYear());
        view.put("channel", series.getChannel());
        view.put("location_id", series.getLocationId());
        if (series.getRegisterId() != null) {
            view.put("register_id", series.getRegisterId());
        }
        view.put("seller_gstin", series.getSellerGstin());
        view.put("book_from", series.getBookFrom());
        view.put("book_to", series.getBookTo());
        view.put("status", series.getStatus());
        return view;
    }
}
