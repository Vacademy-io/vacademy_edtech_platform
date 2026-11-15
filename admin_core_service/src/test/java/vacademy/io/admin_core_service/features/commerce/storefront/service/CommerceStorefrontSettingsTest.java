package vacademy.io.admin_core_service.features.commerce.storefront.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontViews;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The base language of a shop is the one of its site; the shop setting is only the fallback. */
class CommerceStorefrontSettingsTest {

    private static final String INSTITUTE = "inst-1";

    private InstituteSettingService settingService;
    private StorefrontSiteLocale siteLocale;
    private CommerceStorefrontSettings reader;

    @BeforeEach
    void setUp() {
        settingService = mock(InstituteSettingService.class);
        siteLocale = mock(StorefrontSiteLocale.class);
        reader = new CommerceStorefrontSettings(settingService, new ObjectMapper(), siteLocale);
    }

    @Test
    void aHindiFirstSiteMakesTheShopHindiFirstAlthoughTheShopSettingIsUnset() {
        when(settingService.getSettingByInstituteIdAndKey(INSTITUTE, CommerceStockSettings.SETTING_KEY))
                .thenReturn(Map.of("lowStockThreshold", 5));
        when(siteLocale.baseLocale(INSTITUTE)).thenReturn("hi");

        StorefrontSettings settings = reader.read(INSTITUTE);

        assertEquals("hi", settings.baseLocale());
        assertEquals(5, settings.lowStockThreshold());
        // Hindi owns the bare address, English carries ?lang=en: what the site itself serves.
        assertEquals("/p/khadi-kurta", StorefrontViews.productPath("khadi-kurta", "hi", settings.baseLocale()));
        assertEquals("/p/khadi-kurta?lang=en", StorefrontViews.productPath("khadi-kurta", "en", settings.baseLocale()));
    }

    @Test
    void theSiteWinsOverADifferentShopSetting() {
        when(settingService.getSettingByInstituteIdAndKey(INSTITUTE, CommerceStockSettings.SETTING_KEY))
                .thenReturn(Map.of("baseLocale", "en", "mediaTags", List.of("real", "RENDER")));
        when(siteLocale.baseLocale(INSTITUTE)).thenReturn("hi");

        StorefrontSettings settings = reader.read(INSTITUTE);

        assertEquals("hi", settings.baseLocale());
        assertEquals(List.of("REAL", "RENDER"), settings.mediaTags());
    }

    @Test
    void withoutASiteOrWhenTheSiteCannotBeReadTheShopSettingApplies() {
        when(settingService.getSettingByInstituteIdAndKey(INSTITUTE, CommerceStockSettings.SETTING_KEY))
                .thenReturn(Map.of("baseLocale", "hi"));
        when(siteLocale.baseLocale(INSTITUTE)).thenReturn(null);
        assertEquals("hi", reader.read(INSTITUTE).baseLocale());

        when(siteLocale.baseLocale(INSTITUTE)).thenThrow(new IllegalStateException("database down"));
        assertEquals("hi", reader.read(INSTITUTE).baseLocale());
    }

    @Test
    void theSiteLanguageIsReadFromItsGlobalSettings() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        assertEquals("hi", StorefrontSiteLocale.parse(mapper.readTree(
                "{\"globalSettings\":{\"i18n\":{\"enabled\":true,\"defaultLocale\":\"HI\"}}}")));
        assertEquals("pt-br", StorefrontSiteLocale.parse(mapper.readTree(
                "{\"globalSettings\":{\"i18n\":{\"defaultLocale\":\"pt_BR\"}}}")));
        assertNull(StorefrontSiteLocale.parse(mapper.readTree("{\"globalSettings\":{}}")));
        assertNull(StorefrontSiteLocale.parse(mapper.readTree(
                "{\"globalSettings\":{\"i18n\":{\"defaultLocale\":\"<script>\"}}}")));
        assertNull(StorefrontSiteLocale.parse(null));
    }
}
