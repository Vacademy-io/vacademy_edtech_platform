package vacademy.io.admin_core_service.features.commerce.storefront.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

/**
 * Reads {@link StorefrontSettings} of an institute; a read that fails gives the defaults.
 *
 * <p>The base language has one home, the institute's site: when the site names one
 * ({@link StorefrontSiteLocale}) it is used, whatever {@code COMMERCE_SETTING.baseLocale}
 * says. That key is only the fallback for a shop that has no site yet.
 */
@Slf4j
@Component
public class CommerceStorefrontSettings {

    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;
    private final StorefrontSiteLocale siteLocale;

    public CommerceStorefrontSettings(InstituteSettingService instituteSettingService, ObjectMapper objectMapper,
                                      StorefrontSiteLocale siteLocale) {
        this.instituteSettingService = instituteSettingService;
        this.objectMapper = objectMapper;
        this.siteLocale = siteLocale;
    }

    public StorefrontSettings read(String instituteId) {
        StorefrontSettings stored = readStored(instituteId);
        try {
            return stored.withBaseLocale(siteLocale.baseLocale(instituteId));
        } catch (RuntimeException e) {
            log.warn("Could not read the site language of institute {}; the shop setting applies: {}", instituteId,
                    e.getMessage());
            return stored;
        }
    }

    private StorefrontSettings readStored(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId,
                    CommerceStockSettings.SETTING_KEY);
            return data == null ? StorefrontSettings.defaults()
                    : StorefrontSettings.parse(objectMapper.valueToTree(data));
        } catch (RuntimeException e) {
            log.warn("Could not read the storefront settings of institute {}; defaults apply: {}", instituteId,
                    e.getMessage());
            return StorefrontSettings.defaults();
        }
    }
}
