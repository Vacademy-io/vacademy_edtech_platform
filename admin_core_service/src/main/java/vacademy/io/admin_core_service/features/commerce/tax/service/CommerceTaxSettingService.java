package vacademy.io.admin_core_service.features.commerce.tax.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxSetting;
import vacademy.io.admin_core_service.features.commerce.tax.enums.InvoiceAt;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxClassRepository;
import vacademy.io.admin_core_service.features.commerce.tax.repository.CommerceTaxSettingRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.util.LinkedHashMap;
import java.util.Map;

import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.enumValue;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.require;
import static vacademy.io.admin_core_service.features.commerce.tax.service.CommerceInputRules.trimToNull;

/**
 * The institute's tax settings (commerce.tax.mode,
 * commerce.tax.slabBasis, commerce.roundTotalTo, commerce.invoiceAt). They live in
 * {@code commerce_tax_setting}, one row per institute, not in the shared institute settings
 * blob, so a save here cannot overwrite another screen's settings.
 */
@Service
@RequiredArgsConstructor
public class CommerceTaxSettingService {

    static final int DEFAULT_FY_START_MONTH = 4;

    private final CommerceTaxSettingRepository settingRepository;
    private final CommerceTaxClassRepository taxClassRepository;
    private final CommerceAuditService auditService;

    /** The settings code reads. Never null; {@code configured} is false when nothing was saved. */
    @Transactional(readOnly = true)
    public CommerceTaxContext context(String instituteId) {
        return settingRepository.findByInstituteId(instituteId)
                .map(CommerceTaxSettingService::toContext)
                .orElseGet(CommerceTaxSettingService::defaults);
    }

    @Transactional(readOnly = true)
    public TaxSettingDTO get(String instituteId) {
        return toDto(context(instituteId));
    }

    /** Creates the row on the first save. A null field keeps its value. */
    @Transactional
    public TaxSettingDTO update(String instituteId, String actorUserId, TaxSettingDTO request) {
        require(request != null, "request body is required");
        CommerceTaxSetting setting = settingRepository.findByInstituteId(instituteId).orElse(null);
        CommerceTaxContext before = setting == null ? defaults() : toContext(setting);
        if (setting == null) {
            setting = new CommerceTaxSetting();
            setting.setInstituteId(instituteId);
            apply(setting, before);
        }

        TaxMode mode = enumValue(TaxMode.class, request.getTaxMode(), "tax_mode");
        if (mode != null) {
            setting.setTaxMode(mode.name());
        }
        SlabBasis basis = enumValue(SlabBasis.class, request.getSlabBasis(), "slab_basis");
        if (basis != null) {
            setting.setSlabBasis(basis.name());
        }
        SlabCompare compare = enumValue(SlabCompare.class, request.getSlabCompare(), "slab_compare");
        if (compare != null) {
            setting.setSlabCompare(compare.name());
        }
        RoundTotalTo roundTo = enumValue(RoundTotalTo.class, request.getRoundTotalTo(), "round_total_to");
        if (roundTo != null) {
            setting.setRoundTotalTo(roundTo.name());
        }
        InvoiceAt invoiceAt = enumValue(InvoiceAt.class, request.getInvoiceAt(), "invoice_at");
        if (invoiceAt != null) {
            setting.setInvoiceAt(invoiceAt.name());
        }
        if (request.getSellerGstin() != null) {
            setting.setSellerGstin(GstinValidator.normalise(request.getSellerGstin()));
        }
        if (request.getSellerStateCode() != null) {
            setting.setSellerStateCode(trimToNull(request.getSellerStateCode()));
        }
        if (request.getSellerLegalName() != null) {
            setting.setSellerLegalName(trimToNull(request.getSellerLegalName()));
        }
        if (request.getSellerAddress() != null) {
            setting.setSellerAddress(trimToNull(request.getSellerAddress()));
        }
        if (request.getFyStartMonth() != null) {
            require(request.getFyStartMonth() >= 1 && request.getFyStartMonth() <= 12,
                    "fy_start_month must be between 1 and 12");
            setting.setFyStartMonth(request.getFyStartMonth());
        }
        validate(instituteId, setting, before);

        setting = settingRepository.save(setting);
        CommerceTaxContext after = toContext(setting);
        auditService.record(instituteId, actorUserId, null, "TAX_SETTING_CHANGED", "TAX_SETTING", setting.getId(),
                CommerceInputRules.json(auditView(before)), CommerceInputRules.json(auditView(after)), null);
        return toDto(after);
    }

    private void validate(String instituteId, CommerceTaxSetting setting, CommerceTaxContext before) {
        String gstin = setting.getSellerGstin();
        require(gstin == null || GstinValidator.isValid(gstin), "seller_gstin is not a valid GSTIN");
        String state = setting.getSellerStateCode();
        require(state == null || state.matches("^[0-9]{2}$"), "seller_state_code must be the two-digit GST state code");
        if (gstin != null) {
            if (state == null) {
                setting.setSellerStateCode(GstinValidator.stateCode(gstin));
            } else {
                require(state.equals(GstinValidator.stateCode(gstin)),
                        "seller_state_code does not match the state in seller_gstin");
            }
        }
        if (TaxMode.REGULAR.name().equals(setting.getTaxMode())) {
            require(gstin != null, "a seller GSTIN is required in REGULAR tax mode");
            // Invariant: every ACTIVE product has a tax class in REGULAR mode.
            if (before.getMode() != TaxMode.REGULAR
                    && taxClassRepository.countActiveProductsWithoutTaxClass(instituteId) > 0) {
                throw new ConflictException("TAX_CLASS_MISSING: some published products have no tax class;"
                        + " give each one a tax class before switching to REGULAR tax mode");
            }
        }
    }

    private static void apply(CommerceTaxSetting setting, CommerceTaxContext context) {
        setting.setTaxMode(context.getMode().name());
        setting.setSlabBasis(context.getSlabBasis().name());
        setting.setSlabCompare(context.getSlabCompare().name());
        setting.setRoundTotalTo(context.getRoundTotalTo().name());
        setting.setInvoiceAt(context.getInvoiceAt().name());
        setting.setFyStartMonth(context.getFyStartMonth());
    }

    static CommerceTaxContext defaults() {
        return CommerceTaxContext.builder()
                .configured(false)
                .mode(TaxMode.UNREGISTERED)
                .slabBasis(SlabBasis.NET_UNIT_PRICE)
                .slabCompare(SlabCompare.TAX_EXCLUSIVE)
                .roundTotalTo(RoundTotalTo.NONE)
                .invoiceAt(InvoiceAt.PACKED)
                .fyStartMonth(DEFAULT_FY_START_MONTH)
                .build();
    }

    static CommerceTaxContext toContext(CommerceTaxSetting setting) {
        return CommerceTaxContext.builder()
                .configured(true)
                .mode(TaxMode.valueOf(setting.getTaxMode()))
                .slabBasis(SlabBasis.valueOf(setting.getSlabBasis()))
                .slabCompare(SlabCompare.valueOf(setting.getSlabCompare()))
                .roundTotalTo(RoundTotalTo.valueOf(setting.getRoundTotalTo()))
                .invoiceAt(InvoiceAt.valueOf(setting.getInvoiceAt()))
                .sellerGstin(setting.getSellerGstin())
                .sellerStateCode(setting.getSellerStateCode())
                .sellerLegalName(setting.getSellerLegalName())
                .sellerAddress(setting.getSellerAddress())
                .fyStartMonth(setting.getFyStartMonth() == null ? DEFAULT_FY_START_MONTH : setting.getFyStartMonth())
                .build();
    }

    private static TaxSettingDTO toDto(CommerceTaxContext context) {
        if (!context.isConfigured()) {
            // Nothing saved yet: no field is shown as if someone had chosen it. The defaults
            // the code works with are in defaults() and are written on the first save.
            return TaxSettingDTO.builder().configured(false).build();
        }
        return TaxSettingDTO.builder()
                .configured(context.isConfigured())
                .taxMode(context.getMode().name())
                .slabBasis(context.getSlabBasis().name())
                .slabCompare(context.getSlabCompare().name())
                .roundTotalTo(context.getRoundTotalTo().name())
                .invoiceAt(context.getInvoiceAt().name())
                .sellerGstin(context.getSellerGstin())
                .sellerStateCode(context.getSellerStateCode())
                .sellerLegalName(context.getSellerLegalName())
                .sellerAddress(context.getSellerAddress())
                .fyStartMonth(context.getFyStartMonth())
                .build();
    }

    private static Map<String, Object> auditView(CommerceTaxContext context) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("tax_mode", context.getMode().name());
        view.put("slab_basis", context.getSlabBasis().name());
        view.put("slab_compare", context.getSlabCompare().name());
        view.put("round_total_to", context.getRoundTotalTo().name());
        view.put("invoice_at", context.getInvoiceAt().name());
        view.put("seller_gstin", context.getSellerGstin());
        view.put("seller_state_code", context.getSellerStateCode());
        view.put("fy_start_month", context.getFyStartMonth());
        return view;
    }
}
