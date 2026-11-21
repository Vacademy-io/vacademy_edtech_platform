package vacademy.io.admin_core_service.features.enrollment_policy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.AnnotatedBeanDefinition;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.core.type.MethodMetadata;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.enrollment_policy.scheduler.PackageSessionScheduler;
import vacademy.io.admin_core_service.features.enrollment_policy.service.PackageSessionEnrolmentService;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalChargeService;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The enrolment-policy sweep and renewal charges run only from their schedulers, which apply
 * the per-institute settings. No HTTP endpoint triggers them directly.
 */
class EnrollmentPolicyManualTriggerRemovedTest {

    private static final String REMOVED_BASE = "/admin-core-service/v1/enrollment-policy/test";

    private static final List<String> MAPPING_ANNOTATIONS = List.of(
            "org.springframework.web.bind.annotation.RequestMapping",
            "org.springframework.web.bind.annotation.GetMapping",
            "org.springframework.web.bind.annotation.PostMapping",
            "org.springframework.web.bind.annotation.PutMapping",
            "org.springframework.web.bind.annotation.PatchMapping",
            "org.springframework.web.bind.annotation.DeleteMapping");

    @Test
    void noControllerIsMappedUnderTheRemovedPath() {
        assertTrue(mappedPaths().stream().noneMatch(p -> p.startsWith(REMOVED_BASE)),
                "endpoints still mapped under " + REMOVED_BASE);
    }

    /** Positive control: the scan does see method-level paths of existing controllers. */
    @Test
    void scanFindsKnownPaths() {
        List<String> paths = mappedPaths();
        assertTrue(paths.contains("/admin-core-service/open/v1/learner-study-library/slides"));
        assertTrue(paths.contains("/admin-core-service/enrollment-policy/package-session/{packageSessionId}"));
    }

    private static List<String> mappedPaths() {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        scanner.addIncludeFilter(new AnnotationTypeFilter(org.springframework.stereotype.Controller.class));
        Set<BeanDefinition> controllers = scanner.findCandidateComponents("vacademy.io.admin_core_service");
        assertFalse(controllers.isEmpty(), "scan found no controllers");

        List<String> mapped = new ArrayList<>();
        for (BeanDefinition definition : controllers) {
            AnnotationMetadata metadata = ((AnnotatedBeanDefinition) definition).getMetadata();
            List<String> bases = paths(metadata.getAnnotationAttributes(RequestMapping.class.getName()));
            if (bases.isEmpty()) {
                bases = List.of("");
            }
            for (String annotation : MAPPING_ANNOTATIONS) {
                for (MethodMetadata method : metadata.getAnnotatedMethods(annotation)) {
                    for (String base : bases) {
                        List<String> subPaths = paths(method.getAnnotationAttributes(annotation));
                        for (String sub : subPaths.isEmpty() ? List.of("") : subPaths) {
                            mapped.add(base + sub);
                        }
                    }
                }
            }
        }
        return mapped;
    }

    @Test
    void wholeTableSweepAndDirectChargeAreGone() {
        assertFalse(hasMethod(PackageSessionScheduler.class, "processPackageSessionExpiries"));
        assertFalse(hasMethod(PackageSessionEnrolmentService.class, "processActiveEnrollments"));
        assertFalse(hasMethod(RenewalChargeService.class, "chargeNow"));
    }

    @Test
    void scheduledInstituteGatedPathRemains() {
        assertTrue(hasMethod(PackageSessionScheduler.class, "processPackageSessionRenewals"));
        assertTrue(hasMethod(PackageSessionEnrolmentService.class, "processActiveEnrollmentsForInstitutes"));
    }

    private static boolean hasMethod(Class<?> type, String name) {
        return Arrays.stream(type.getDeclaredMethods()).map(Method::getName).anyMatch(name::equals);
    }

    private static List<String> paths(Map<String, Object> attributes) {
        List<String> out = new ArrayList<>();
        if (attributes == null) {
            return out;
        }
        for (String key : List.of("value", "path")) {
            if (attributes.get(key) instanceof String[] values) {
                out.addAll(Arrays.asList(values));
            }
        }
        return out;
    }
}
