package vacademy.io.notification_service.features.email_otp.service;

import org.junit.jupiter.api.Test;
import vacademy.io.common.product.ProductConfigDTO;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OtpBrandTest {

    @Test
    void theSenderComesFromTheProductsSettings() {
        OtpBrand brand = OtpBrand.of(ProductConfigDTO.builder().displayName("Evalezy").fromName("Evalezy Team")
                .fromEmail("new@evalezy.com").themeColor("#111111").websiteUrl("https://e.com").build());
        assertEquals("Evalezy Team <new@evalezy.com>", brand.from());
        assertEquals("new@evalezy.com", brand.contactEmail());
        assertEquals("#111111", brand.theme());
    }
}
