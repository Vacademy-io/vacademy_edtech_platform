package vacademy.io.admin_core_service.features.regional_pricing.repository;

import org.junit.jupiter.api.Test;
import org.springframework.data.repository.query.parser.PartTree;
import vacademy.io.admin_core_service.features.regional_pricing.entity.PaymentPlanRegionalPrice;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regional pricing reads go through Spring Data derived queries only (no SQL strings).
 * Spring parses every derived method name against its entity when the application starts,
 * and a bad name stops the boot. PartTree is that same parser, so a name that passes here
 * passes at startup.
 */
class RegionalPricingDerivedQueriesTest {

    @Test
    void regionalPriceRepositoryMethodsParseAgainstTheEntity() {
        List<Method> methods = Arrays.stream(PaymentPlanRegionalPriceRepository.class.getDeclaredMethods())
                .filter(m -> !m.isDefault() && !m.isSynthetic())
                .toList();
        assertEquals(3, methods.size());
        for (Method m : methods) {
            assertDoesNotThrow(() -> new PartTree(m.getName(), PaymentPlanRegionalPrice.class), m.getName());
        }
    }

    @Test
    void regionalPricingMethodsOnPaymentOptionRepositoryParse() {
        PartTree count = new PartTree("countByRegionalPricingEnabledTrue", PaymentOption.class);
        assertTrue(count.isCountProjection());
        assertDoesNotThrow(() -> new PartTree("findByRegionalPricingEnabledTrue", PaymentOption.class));
        assertDoesNotThrow(() -> PaymentOptionRepository.class.getMethod("countByRegionalPricingEnabledTrue"));
        assertDoesNotThrow(() -> PaymentOptionRepository.class.getMethod("findByRegionalPricingEnabledTrue"));
    }

    @Test
    void regionalPriceRepositoryHasNoHandWrittenQueries() {
        for (Method m : PaymentPlanRegionalPriceRepository.class.getDeclaredMethods()) {
            assertEquals(0, m.getAnnotations().length, m.getName() + " must be a plain derived query");
        }
    }
}
