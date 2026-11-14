package vacademy.io.admin_core_service.boot;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.SimpleBeanDefinitionRegistry;
import org.springframework.context.annotation.ClassPathBeanDefinitionScanner;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

/**
 * Two @Component classes with the same simple name in different packages get the same default
 * bean name, and Spring refuses to start (ConflictingBeanDefinitionException) — which no unit
 * test that builds classes by hand ever sees. 2026-10-13: features.capabilities and
 * features.institute both had an InstituteModuleService and the admin-core rollout crash-looped.
 * This runs the same component scan as the app, without a database or a context refresh.
 */
class BeanNameUniquenessTest {

    @Test
    void componentScanHasNoBeanNameClashes() {
        SimpleBeanDefinitionRegistry registry = new SimpleBeanDefinitionRegistry();
        ClassPathBeanDefinitionScanner scanner = new ClassPathBeanDefinitionScanner(registry);
        assertDoesNotThrow(() -> scanner.scan("vacademy.io.admin_core_service"));
    }
}
