package vacademy.io.admin_core_service.features.invoice.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberContext;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberingDTOs;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.enums.InvoiceSeqScope;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

/**
 * Read-side support for the invoice-numbering settings screen: preview a candidate format
 * and describe the current state.
 *
 * <p>Writes are deliberately NOT here — the numbering block is saved through the existing
 * generic institute-settings endpoint along with the rest of {@code INVOICE_SETTING}, which
 * is a full overwrite of the stored JSON. Splitting the write out would mean two round-trips
 * that can clobber each other.
 */
@Slf4j
@Service
public class InvoiceNumberingSettingsService {

    private static final int SAMPLE_COUNT = 3;

    @Autowired
    private InvoiceNumberService invoiceNumberService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private InstituteSettingService instituteSettingService;

    @Autowired
    private InvoiceRepository invoiceRepository;

    /** Validate + render samples for a format the admin is still editing (nothing consumed). */
    public InvoiceNumberingDTOs.PreviewResponse preview(InvoiceNumberingDTOs.PreviewRequest request) {
        Institute institute = loadInstitute(request.getInstituteId());
        InvoiceNumberConfig candidate = toConfig(request);
        return invoiceNumberService.previewSamples(
                candidate, previewContext(institute, candidate), SAMPLE_COUNT);
    }

    /** What the institute uses today, and how much history a change would sit on top of. */
    public InvoiceNumberingDTOs.NumberingState currentState(String instituteId) {
        Institute institute = loadInstitute(instituteId);
        InvoiceNumberConfig current = InvoiceNumberConfig.fromInvoiceSettings(readInvoiceSettings(institute));

        Optional<Invoice> latest = invoiceRepository.findTopByInstituteIdOrderByCreatedAtDesc(instituteId);
        var sample = invoiceNumberService.previewSamples(
                current, previewContext(institute, current), 1);

        return InvoiceNumberingDTOs.NumberingState.builder()
                .currentFormat(current.getFormat())
                .seqScope(current.getSeqScope().name())
                .currentExample(sample.getSamples().isEmpty() ? "" : sample.getSamples().get(0))
                .lastIssuedNumber(latest.map(Invoice::getInvoiceNumber).orElse(null))
                .nextSequence(sample.getNextSequence())
                .existingInvoiceCount(invoiceRepository.countByInstituteId(instituteId))
                .build();
    }

    /**
     * Preview context: the institute's REAL values for everything that is free, and
     * representative stand-ins for the learner/course values that vary per invoice — so the
     * sample looks like this institute's numbers rather than a generic placeholder.
     */
    private InvoiceNumberContext previewContext(Institute institute, InvoiceNumberConfig config) {
        InvoiceNumberContext sample = InvoiceNumberContext.sample(
                institute.getId(), institute.getInstituteName(), config.getInstituteCode());
        sample.setInstituteStateCode(firstNonBlank(institute.getStateCode(), sample.getInstituteStateCode()));
        sample.setInstituteCity(firstNonBlank(institute.getCity(), sample.getInstituteCity()));
        sample.setInstituteState(firstNonBlank(institute.getState(), sample.getInstituteState()));
        sample.setInstituteCountry(firstNonBlank(institute.getCountry(), sample.getInstituteCountry()));
        sample.setSubdomain(firstNonBlank(institute.getSubdomain(), sample.getSubdomain()));
        sample.setDate(LocalDate.now());
        return sample;
    }

    private InvoiceNumberConfig toConfig(InvoiceNumberingDTOs.PreviewRequest request) {
        InvoiceNumberConfig defaults = InvoiceNumberConfig.legacyDefault();
        return InvoiceNumberConfig.builder()
                .format(StringUtils.hasText(request.getFormat()) ? request.getFormat() : defaults.getFormat())
                .seqPadding(request.getSeqPadding() != null ? request.getSeqPadding() : defaults.getSeqPadding())
                .seqScope(InvoiceSeqScope.fromSetting(request.getSeqScope()))
                .instituteCode(request.getInstituteCode() != null ? request.getInstituteCode() : "")
                .fyStartMonth(request.getFyStartMonth() != null
                        ? request.getFyStartMonth() : defaults.getFyStartMonth())
                .sanitizeTokens(request.getSanitizeTokens() == null || request.getSanitizeTokens())
                .startFrom(request.getStartFrom() != null ? Math.max(0, request.getStartFrom()) : 0)
                .neverReuseDeletedNumbers(request.getNeverReuseDeletedNumbers() == null
                        || request.getNeverReuseDeletedNumbers())
                .build();
    }

    private Institute loadInstitute(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        return instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readInvoiceSettings(Institute institute) {
        try {
            Object settingData = instituteSettingService.getSettingData(institute, "INVOICE_SETTING");
            return settingData instanceof Map ? (Map<String, Object>) settingData : null;
        } catch (Exception e) {
            log.warn("Could not load invoice settings for institute {}: {}", institute.getId(), e.getMessage());
            return null;
        }
    }

    private static String firstNonBlank(String preferred, String fallback) {
        return StringUtils.hasText(preferred) ? preferred : fallback;
    }
}
