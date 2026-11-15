package vacademy.io.admin_core_service.features.commerce;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.beans.factory.support.BeanDefinitionRegistryPostProcessor;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.AfterAll;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageRequest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.catalogue.controller.CommerceProductController;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeValueDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.CollectionDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductStatusRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceAttributeService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkAddCourseRequestDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkAddCourseResponseDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseBatchDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseInventoryConfigDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseItemDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCoursePaymentConfigDTO;
import vacademy.io.admin_core_service.features.course.dto.bulk.BulkCourseResultDTO;
import vacademy.io.admin_core_service.features.course.service.BulkCourseService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.institute.manager.InstituteInitManager;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.learner.service.LearnerDashBoardService;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithCourseDTO;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithSessionDTO;
import vacademy.io.admin_core_service.features.level.service.LevelService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.BatchService;
import vacademy.io.admin_core_service.features.packages.service.LearnerPackageService;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;
import vacademy.io.admin_core_service.features.packages.service.PackageService;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.admin_core_service.features.session.service.SessionService;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of the M1 commerce backend: the real
 * application context on a real Postgres whose schema came from the Flyway files.
 *
 * <p>Not part of the default build. The name ends in IT, which surefire's default patterns do not
 * pick up; a run that selects classes with an exclusion-only {@code -Dtest='!X'} does pick it up,
 * and then every test here is skipped, because COMMERCE_IT_PG_URL is not set. It runs only when
 * that variable names a local throwaway database that already holds the migrated schema. Run it
 * by name:
 * <pre>
 * COMMERCE_IT_PG_URL=jdbc:postgresql://127.0.0.1:55439/m1b mvn -pl admin_core_service -am test -o \
 *   -Dsentry.skip=true -Dsurefire.failIfNoSpecifiedTests=false -Dtest=CommerceM1DatabaseProofIT \
 *   -Denvironment=stage
 * </pre>
 * No properties file is needed: {@link #database} forces the datasource to that local database
 * (user COMMERCE_IT_PG_USER, default postgres; password COMMERCE_IT_PG_PASSWORD, default empty),
 * points every outside URL of the profile at a closed local port, and keeps Quartz and the
 * polling jobs off. The one outside service the proof needs, the user lookup of auth_service, is
 * answered by a stub in this JVM on 127.0.0.1.
 * It writes rows and leaves them there, so never point it at a shared database.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceM1DatabaseProofIT {

    /** No scheduled job runs during the proof: jobs call other services and write on their own. */
    @TestConfiguration
    static class LocalOnly {
        @Bean
        static BeanDefinitionRegistryPostProcessor noScheduledJobs() {
            return (BeanDefinitionRegistry registry) -> {
                String name = "org.springframework.context.annotation.internalScheduledAnnotationProcessor";
                if (registry.containsBeanDefinition(name)) {
                    registry.removeBeanDefinition(name);
                }
            };
        }

        /** Records every call on a Spring Data repository, so the proof can say which queries ran. */
        @Bean
        static org.springframework.beans.factory.config.BeanPostProcessor repositoryCallRecorder() {
            return new org.springframework.beans.factory.config.BeanPostProcessor() {
                @Override
                public Object postProcessAfterInitialization(Object bean, String beanName) {
                    if (bean instanceof org.springframework.data.repository.Repository
                            && bean instanceof org.springframework.aop.framework.Advised advised && !advised.isFrozen()) {
                        advised.addAdvice(0, (org.aopalliance.intercept.MethodInterceptor) call -> {
                            REPOSITORY_CALLS.add(key(call.getMethod()));
                            return call.proceed();
                        });
                    }
                    return bean;
                }
            };
        }
    }

    private static final java.util.Set<String> REPOSITORY_CALLS = java.util.concurrent.ConcurrentHashMap.newKeySet();

    private static String key(java.lang.reflect.Method method) {
        return method.getDeclaringClass().getSimpleName() + "." + method.getName() + "/" + method.getParameterCount();
    }

    private static final String CLOSED_PORT = "http://127.0.0.1:9";

    private static String envOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null ? fallback : value;
    }

    /**
     * Everything that could reach another machine is pinned here, so the run is local whatever
     * the command line says: the datasource, every property of the profile whose value is an
     * http(s) URL, the known URL keys that come from the environment, and the job switches.
     */
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String url = System.getenv("COMMERCE_IT_PG_URL");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.read.url", () -> url);
        registry.add("spring.datasource.username", () -> envOr("COMMERCE_IT_PG_USER", "postgres"));
        registry.add("spring.datasource.password", () -> envOr("COMMERCE_IT_PG_PASSWORD", ""));
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "8");
        registry.add("spring.datasource.hikari.minimum-idle", () -> "1");

        java.util.Set<String> urlKeys = new java.util.TreeSet<>(List.of(
                "notification.server.baseurl", "media.server.baseurl", "media.service.baseurl",
                "assessment.server.baseurl", "community.server.baseurl", "ai.service.url", "tool.executor.base-url",
                "bbb.callback.base-url", "transcription.callback.base-url", "telephony.webhook.callback-base",
                "telephony.exotel.base-url", "telephony.plivo.base-url", "payment.webhook.baseurl",
                "payment.cashfree.default-return-url", "cashfree.secureid.base-url", "razorpay.platform.api-base",
                "regional.pricing.fx.url", "short.link.base.url", "openrouter.base.url", "isoquant.base.url",
                "aavtaar.base-url", "meta.whatsapp.api.base.url", "classroom.console.base-url",
                "assignment.ai-evaluation.callback-base-url", "cloud.front.url"));
        java.util.Set<String> formatKeys = new java.util.TreeSet<>(List.of("regional.pricing.geoip.url"));
        for (String file : List.of("application.properties", "application-stage.properties")) {
            java.util.Properties shipped = new java.util.Properties();
            try (java.io.InputStream in = CommerceM1DatabaseProofIT.class.getClassLoader().getResourceAsStream(file)) {
                if (in != null) {
                    shipped.load(in);
                }
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
            for (String key : shipped.stringPropertyNames()) {
                String value = shipped.getProperty(key);
                if (key.startsWith("spring.datasource") || key.equals("auth.server.baseurl")) {
                    continue;
                }
                if (value.contains("http://") || value.contains("https://")) {
                    (value.contains("%s") ? formatKeys : urlKeys).add(key);
                }
            }
        }
        urlKeys.removeAll(formatKeys);
        urlKeys.forEach(key -> registry.add(key, () -> CLOSED_PORT));
        formatKeys.forEach(key -> registry.add(key, () -> CLOSED_PORT + "/%s"));
        registry.add("telephony.vacademy-ai.bot-base-url", () -> "");
        // The user lookup of auth_service is the one remote call the HTTP part of the proof needs.
        registry.add("auth.server.baseurl", CommerceM1DatabaseProofIT::authStubUrl);

        for (String off : List.of("transcription.reconciliation.enabled", "telephony.airtel.s3.enabled",
                "telephony.ai.queue.enabled", "meta.lead.polling.enabled", "meta.connector.monitor.enabled",
                "sentry.logs.enabled", "spring.quartz.auto-startup", "spring.flyway.postgresql.transactional-lock")) {
            registry.add(off, () -> "false");
        }
        registry.add("spring.flyway.connect-retries", () -> "0");
        // As production: Hibernate neither changes nor checks the schema at boot.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("application.my.username", () -> "local-user");
        registry.add("application.my.password", () -> "local-only");
        for (String blank : List.of("cloudflare.api.token", "cloudflare.zone.id", "ai.service.internal-token", "sentry.dsn")) {
            registry.add(blank, () -> "");
        }
        for (String dummy : List.of("openrouter.api.key", "isoquant.api.key", "transcription.callback.secret")) {
            registry.add(dummy, () -> "local-only");
        }
        registry.add("sentry.traces-sample-rate", () -> "0");
        registry.add("logging.level.org.springframework.security", () -> "WARN");
        registry.add("logging.level.org.springframework.web", () -> "WARN");
        registry.add("logging.level.org.hibernate.SQL", () -> "OFF");
    }

    // ----------------------------------------------- stand-in for auth_service

    private static com.sun.net.httpserver.HttpServer authStub;
    private static final Map<String, vacademy.io.common.auth.entity.User> STUB_USERS = new java.util.concurrent.ConcurrentHashMap<>();
    private static final Map<String, List<vacademy.io.common.auth.entity.UserRole>> STUB_ROLES = new java.util.concurrent.ConcurrentHashMap<>();
    private static final List<String> STUB_LOOKUPS = java.util.Collections.synchronizedList(new ArrayList<>());

    private static synchronized String authStubUrl() {
        if (authStub == null) {
            try {
                authStub = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
            authStub.createContext(vacademy.io.common.auth.constants.AuthConstant.userServiceRoute,
                    CommerceM1DatabaseProofIT::answerUserLookup);
            authStub.start();
        }
        return "http://127.0.0.1:" + authStub.getAddress().getPort();
    }

    /**
     * GET /auth-service/v1/internal/user as auth_service answers it. The body of
     * UserDetailsCacheService.getCustomUserDetails (auth_service, lines 33-49) is repeated here
     * on an in-memory user store: the two repository reads are replaced by map lookups, and the
     * revoked-staff rule and the institute scoping of the authorities are the same shared
     * classes auth_service calls (UserRoleService, CustomUserDetails). The answer is the JSON
     * shape admin_core parses (UserServiceDTO).
     */
    private static void answerUserLookup(com.sun.net.httpserver.HttpExchange exchange) throws IOException {
        String userName = "";
        String rawQuery = exchange.getRequestURI().getRawQuery();
        for (String pair : (rawQuery == null ? "" : rawQuery).split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals("userName")) {
                userName = java.net.URLDecoder.decode(pair.substring(eq + 1), java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        int status = 200;
        String body;
        try {
            String trimmed = userName.trim();
            String usernameWithoutInstitute = trimmed;
            String instituteId = null;
            String[] split = trimmed.split("@", 2);
            if (split.length == 2) {
                instituteId = split[0];
                usernameWithoutInstitute = split[1];
            }
            vacademy.io.common.auth.entity.User user = STUB_USERS.get(usernameWithoutInstitute);
            if (user == null) {
                throw new IllegalStateException("could not found user..!!");
            }
            List<vacademy.io.common.auth.entity.UserRole> userRoles = STUB_ROLES.get(usernameWithoutInstitute);
            if (vacademy.io.common.auth.service.UserRoleService.isStaffAccessRevoked(userRoles, instituteId)) {
                throw new IllegalStateException("access to this institute has been disabled for this user");
            }
            CustomUserDetails details = new CustomUserDetails(user, instituteId, userRoles);
            Map<String, Object> json = new LinkedHashMap<>();
            json.put("username", details.getUsername());
            json.put("userId", details.getUserId());
            json.put("fullName", details.getFullName());
            json.put("rootUser", details.isRootUser());
            json.put("authorities", details.getAuthorities().stream().map(a -> a.getAuthority()).toList());
            body = new ObjectMapper().writeValueAsString(json);
            STUB_LOOKUPS.add(trimmed + " -> authorities " + json.get("authorities"));
        } catch (RuntimeException e) {
            status = 500;
            body = "{\"error\":\"lookup refused\"}";
            STUB_LOOKUPS.add(userName + " -> refused: " + e.getMessage());
        }
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (java.io.OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    /** A stand-in user: one role per institute, never more. */
    private static vacademy.io.common.auth.entity.User stubUser(String username, boolean rootUser, String... instituteAndRole) {
        vacademy.io.common.auth.entity.User user = new vacademy.io.common.auth.entity.User();
        user.setId(username);
        user.setUsername(username);
        user.setFullName("Proof " + username);
        user.setEmail(username + "@example.invalid");
        user.setRootUser(rootUser);
        List<vacademy.io.common.auth.entity.UserRole> roles = new ArrayList<>();
        for (int i = 0; i + 1 < instituteAndRole.length; i += 2) {
            vacademy.io.common.auth.entity.Role role = new vacademy.io.common.auth.entity.Role();
            role.setId(UUID.randomUUID().toString());
            role.setName(instituteAndRole[i + 1]);
            vacademy.io.common.auth.entity.UserRole userRole = new vacademy.io.common.auth.entity.UserRole();
            userRole.setId(UUID.randomUUID().toString());
            userRole.setUser(user);
            userRole.setRole(role);
            userRole.setInstituteId(instituteAndRole[i]);
            userRole.setStatus("ACTIVE");
            roles.add(userRole);
        }
        STUB_USERS.put(username, user);
        STUB_ROLES.put(username, roles);
        return user;
    }

    @Autowired
    private JdbcTemplate db;
    @Autowired
    private EntityManagerFactory entityManagerFactory;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private CapabilityResolver capabilityResolver;
    @Autowired
    private CommerceProductController productController;
    @Autowired
    private CommerceProductService productService;
    @Autowired
    private CommerceAttributeService attributeService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceCollectionService collectionService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService mediaService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.security.CommerceStaffService staffService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.security.CommercePinService pinService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.security.repository.CommerceRateLimitRepository rateLimitRepository;
    @Autowired
    private BulkCourseService bulkCourseService;
    @Autowired
    private PackageService packageService;
    @Autowired
    private BatchService batchService;
    @Autowired
    private OpenPackageService openPackageService;
    @Autowired
    private LearnerPackageService learnerPackageService;
    @Autowired
    private LearnerDashBoardService learnerDashBoardService;
    @Autowired
    private InstituteInitManager instituteInitManager;
    @Autowired
    private PackageRepository packageRepository;
    @Autowired
    private PackageSessionRepository packageSessionRepository;
    @Autowired
    private PaymentOptionService paymentOptionService;
    @Autowired
    private EnrollInviteService enrollInviteService;
    @Autowired
    private LevelService levelService;
    @Autowired
    private SessionService sessionService;
    @Autowired
    private StockHoldService stockHoldService;
    @Autowired
    private UserPlanService userPlanService;
    @Autowired
    private PaymentLogService paymentLogService;
    @Autowired
    private UserPlanRepository userPlanRepository;
    @Autowired
    private PaymentPlanRepository paymentPlanRepository;
    @Autowired
    private PaymentOptionRepository paymentOptionRepository;
    @Autowired
    private EnrollInviteRepository enrollInviteRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository paymentLogRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.PaymentDashboardRepository paymentDashboardRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.audience.service.RevenueReportService revenueReportService;
    @Autowired
    private vacademy.io.admin_core_service.features.hr_incentive.repository.CrmIncentiveRevenueRepository crmIncentiveRevenueRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository instituteStudentRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.audience.repository.LeadMergeDao leadMergeDao;
    @Autowired
    private vacademy.io.admin_core_service.features.audience.service.AdmissionCourseDao admissionCourseDao;
    @Autowired
    private vacademy.io.admin_core_service.features.audience.service.PipelineReportService pipelineReportService;
    @Autowired
    private vacademy.io.admin_core_service.features.audience.service.CustomReportService customReportService;
    @Autowired
    private vacademy.io.admin_core_service.features.learner.service.LearnerEnrollRequestService learnerEnrollRequestService;
    @Autowired
    private vacademy.io.admin_core_service.features.enroll_invite.service.EnrollmentFormService enrollmentFormService;
    @Autowired
    private vacademy.io.admin_core_service.features.institute_learner.service.AdminDirectEnrollService adminDirectEnrollService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService approvalService;
    @Autowired
    private vacademy.io.admin_core_service.features.enrollment_policy.scheduler.PackageSessionScheduler packageSessionScheduler;
    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.repository.CollectionDashboardRepository collectionDashboardRepository;
    @Autowired
    private vacademy.io.admin_core_service.features.erp_finance.repository.FinanceReportQueryRepository financeReportQueryRepository;
    @Autowired
    private vacademy.io.common.auth.service.JwtService jwtService;
    @Autowired
    private org.springframework.context.ApplicationContext applicationContext;
    @org.springframework.boot.test.web.server.LocalServerPort
    private int port;

    // Outside services. Mocked so nothing leaves this machine, and so the commerce path can be
    // shown to call none of them.
    @MockBean
    private AuthService authService;
    @MockBean
    private WorkflowTriggerService workflowTriggerService;
    @MockBean
    private PaymentNotificatonService paymentNotificatonService;
    @MockBean
    private DynamicNotificationService dynamicNotificationService;
    @MockBean
    private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean
    private InvoiceService invoiceService;

    // Two institutes, new for every run.
    private final String instA = UUID.randomUUID().toString();
    private final String instB = UUID.randomUUID().toString();
    private final String run = instA.substring(0, 8);
    private CustomUserDetails adminA;
    private CustomUserDetails adminB;

    // Legacy courses of institute A, made by the bulk course service as it runs today.
    private String coursePkg, courseBatch, courseInvite, courseOption;
    private String typedPkg, typedBatch, typedInvite, typedOption;
    private String sparePkg, spareBatch, spareInvite, spareOption;
    private String coursePkgB;

    // The shop product of institute A.
    private String sizeAttr, sizeS, sizeM, sizeL;
    private String productPkg;
    private final Map<String, VariantResponse> variantBySku = new LinkedHashMap<>();
    /** Ids of the second (made-to-order) product, once it exists. */
    private final List<String> otherShopIds = new ArrayList<>();

    private Path evidence;

    @BeforeAll
    void openEvidence() throws IOException {
        String path = System.getenv("COMMERCE_IT_EVIDENCE");
        evidence = Path.of(path != null && !path.isBlank() ? path : "target/commerce-m1-proof-evidence.txt");
        Files.writeString(evidence, "", StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    }

    private void note(String line) {
        try {
            Files.writeString(evidence, line + "\n", StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Runs a query and writes its rows to the evidence file. */
    private List<Map<String, Object>> sql(String title, String query, Object... args) {
        List<Map<String, Object>> rows = db.queryForList(query, args);
        note("-- " + title);
        note("   " + query.replaceAll("\\s+", " ").trim() + (args.length > 0 ? "   args=" + List.of(args) : ""));
        if (rows.isEmpty()) {
            note("   (0 rows)");
        }
        rows.forEach(row -> note("   " + row));
        return rows;
    }

    private long count(String title, String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        note("-- " + title + ": " + n + "   [" + query.replaceAll("\\s+", " ").trim()
                + (args.length > 0 ? "   args=" + List.of(args) : "") + "]");
        return n == null ? 0 : n;
    }

    // ------------------------------------------------------------------ (h)

    @Test
    @Order(1)
    void h_flywayChainRanAndTheApplicationStarts() {
        note("== (h) Flyway chain and application start");
        long applied = count("flyway migrations applied and successful",
                "SELECT count(*) FROM flyway_schema_history WHERE success");
        sql("commerce migrations in the Flyway history",
                "SELECT version, description, success FROM flyway_schema_history WHERE version IN ('679','680') ORDER BY 1");
        assertTrue(applied >= 609, "the whole chain is applied");
        assertEquals(2, db.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version IN ('679','680') AND success", Long.class));
        int entities = entityManagerFactory.getMetamodel().getEntities().size();
        note("-- application context started; mapped entities=" + entities);
        assertTrue(entities > 300);
        sql("cost columns of commerce_variant",
                "SELECT column_name, numeric_precision, numeric_scale, is_nullable FROM information_schema.columns "
                        + "WHERE table_name = 'commerce_variant' AND column_name IN ('cost_price','standard_cost') ORDER BY 1");
        assertEquals(2, db.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_name = 'commerce_variant' "
                + "AND column_name IN ('cost_price','standard_cost') AND numeric_precision = 14 AND numeric_scale = 4 AND is_nullable = 'YES'",
                Long.class), "both cost columns are NUMERIC(14,4), nullable");
        commerceColumnsMatchTheEntities();
    }

    private static String snake(String camel) {
        return camel.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase();
    }

    /**
     * Hibernate's own validation only compares column presence and type family. This compares,
     * for every mapped column of every commerce entity, what the entity declares with what the
     * migration created: NOT NULL, length, precision and scale.
     */
    private void commerceColumnsMatchTheEntities() {
        List<String> wrong = new ArrayList<>();
        List<String> stricterInDatabase = new ArrayList<>();
        int tables = 0;
        int columns = 0;
        for (jakarta.persistence.metamodel.EntityType<?> entity : entityManagerFactory.getMetamodel().getEntities()) {
            Class<?> type = entity.getJavaType();
            jakarta.persistence.Table table = type.getAnnotation(jakarta.persistence.Table.class);
            if (!type.getName().contains(".features.commerce.") || table == null) {
                continue;
            }
            tables++;
            Map<String, Map<String, Object>> actual = new LinkedHashMap<>();
            db.queryForList("SELECT column_name, is_nullable, data_type, character_maximum_length, numeric_precision, numeric_scale, column_default "
                    + "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", table.name())
                    .forEach(row -> actual.put(String.valueOf(row.get("column_name")), row));
            for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
                for (java.lang.reflect.Field field : c.getDeclaredFields()) {
                    jakarta.persistence.Column column = field.getAnnotation(jakarta.persistence.Column.class);
                    if (column == null) {
                        continue;
                    }
                    String name = column.name().isEmpty() ? snake(field.getName()) : column.name();
                    String where = table.name() + "." + name;
                    Map<String, Object> row = actual.get(name);
                    if (row == null) {
                        wrong.add(where + ": no such column");
                        continue;
                    }
                    columns++;
                    boolean nullableInDb = "YES".equals(row.get("is_nullable"));
                    if (!column.nullable() && nullableInDb) {
                        wrong.add(where + ": the entity says NOT NULL, the column is nullable");
                    }
                    if (column.nullable() && !nullableInDb && row.get("column_default") == null
                            && field.getAnnotation(jakarta.persistence.Id.class) == null) {
                        stricterInDatabase.add(where);
                    }
                    Object length = row.get("character_maximum_length");
                    if (field.getType() == String.class && length != null && column.columnDefinition().isEmpty()
                            && column.length() != 255 && column.length() != ((Number) length).intValue()) {
                        wrong.add(where + ": entity length " + column.length() + ", column length " + length);
                    }
                    if (column.precision() > 0 && (!Integer.valueOf(column.precision()).equals(row.get("numeric_precision"))
                            || !Integer.valueOf(column.scale()).equals(row.get("numeric_scale")))) {
                        wrong.add(where + ": entity NUMERIC(" + column.precision() + "," + column.scale() + "), column NUMERIC("
                                + row.get("numeric_precision") + "," + row.get("numeric_scale") + ")");
                    }
                }
            }
        }
        note("-- entity against migration, commerce tables: tables=" + tables + " mapped columns compared=" + columns
                + " mismatches=" + wrong.size() + " " + wrong);
        note("-- columns that are NOT NULL without a default in the database while the entity does not say so (" 
                + stricterInDatabase.size() + "): " + stricterInDatabase);
        sql("constraints on the commerce tables, by kind (p primary key, u unique, c check, f foreign key)",
                "SELECT contype::text AS kind, count(*) FROM pg_constraint WHERE conrelid::regclass::text LIKE 'commerce\\_%' GROUP BY 1 ORDER BY 1");
        sql("unique indexes on the commerce tables",
                "SELECT tablename, indexname FROM pg_indexes WHERE tablename LIKE 'commerce\\_%' AND indexdef LIKE 'CREATE UNIQUE%' ORDER BY 1, 2");
        assertEquals(42, tables, "the 16 commerce tables of M1, the 13 of stock, tax and documents, "
                + "the shipping rule, the 3 of the import, the 6 of orders and customers (V685) "
                + "and the gateway order, OTP challenge and payment exception (V686)");
        assertTrue(wrong.isEmpty(), "entity and migration disagree: " + wrong);
    }

    // ------------------------------------------------------------- plumbing

    private static CustomUserDetails principal(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Proof User");
        dto.setRootUser(false);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    /** The clientId header of the request being served; the guards read it. */
    private static void requestFrom(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /** Spring resets the mocks after every test, so the stand-in for auth_service is set up each time. */
    @BeforeEach
    void authServiceAnswersLocally() {
        when(authService.getUsersFromAuthServiceWithPasswordByUserId(anyString())).thenAnswer(call -> {
            UserDTO user = new UserDTO();
            user.setId(call.getArgument(0));
            user.setEmail(call.getArgument(0) + "@example.invalid");
            user.setFullName("Proof Learner");
            return user;
        });
        when(authService.getUsersFromAuthServiceByUserIds(org.mockito.ArgumentMatchers.anyList())).thenAnswer(call -> {
            List<UserDTO> users = new ArrayList<>();
            for (Object id : (List<?>) call.getArgument(0)) {
                UserDTO user = new UserDTO();
                user.setId(String.valueOf(id));
                user.setEmail(id + "@example.invalid");
                user.setFullName("Proof Learner");
                users.add(user);
            }
            return users;
        });
    }

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    private <T> T inTransaction(Supplier<T> work) {
        return new TransactionTemplate(transactionManager).execute(status -> work.get());
    }

    private String dump(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    private List<String> variantSessionIds() {
        return variantBySku.values().stream().map(VariantResponse::getPackageSessionId).toList();
    }

    private String ps(String sku) {
        return variantBySku.get(sku).getPackageSessionId();
    }

    private void refreshVariants(ProductResponse product) {
        variantBySku.clear();
        product.getVariants().forEach(v -> variantBySku.put(v.getSku(), v));
    }

    private static String in(List<String> ids) {
        return ids.stream().map(id -> "'" + id + "'").collect(java.util.stream.Collectors.joining(","));
    }

    /** Row counts of everything a product owns, legacy and commerce. */
    private Map<String, Long> productRowCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        String sessions = "(SELECT id FROM package_session WHERE package_id = '" + productPkg + "')";
        counts.put("package", db.queryForObject("SELECT count(*) FROM package WHERE id = ?", Long.class, productPkg));
        counts.put("package_institute", db.queryForObject(
                "SELECT count(*) FROM package_institute WHERE package_id = ?", Long.class, productPkg));
        counts.put("package_session", db.queryForObject(
                "SELECT count(*) FROM package_session WHERE package_id = ?", Long.class, productPkg));
        counts.put("link", db.queryForObject(
                "SELECT count(*) FROM package_session_learner_invitation_to_payment_option WHERE package_session_id IN "
                        + sessions, Long.class));
        counts.put("enroll_invite", db.queryForObject(
                "SELECT count(DISTINCT enroll_invite_id) FROM package_session_learner_invitation_to_payment_option "
                        + "WHERE package_session_id IN " + sessions, Long.class));
        counts.put("payment_option", db.queryForObject(
                "SELECT count(*) FROM payment_option WHERE source = 'PACKAGE_SESSION' AND source_id IN " + sessions,
                Long.class));
        counts.put("payment_plan", db.queryForObject(
                "SELECT count(*) FROM payment_plan WHERE payment_option_id IN (SELECT id FROM payment_option "
                        + "WHERE source = 'PACKAGE_SESSION' AND source_id IN " + sessions + ")", Long.class));
        counts.put("commerce_product", db.queryForObject(
                "SELECT count(*) FROM commerce_product WHERE package_id = ?", Long.class, productPkg));
        counts.put("commerce_product_translation", db.queryForObject(
                "SELECT count(*) FROM commerce_product_translation WHERE package_id = ?", Long.class, productPkg));
        counts.put("commerce_variant", db.queryForObject(
                "SELECT count(*) FROM commerce_variant WHERE package_id = ?", Long.class, productPkg));
        counts.put("commerce_product_option", db.queryForObject(
                "SELECT count(*) FROM commerce_product_option WHERE package_id = ?", Long.class, productPkg));
        counts.put("commerce_variant_option_value", db.queryForObject(
                "SELECT count(*) FROM commerce_variant_option_value WHERE package_session_id IN " + sessions,
                Long.class));
        return counts;
    }

    private void legacyStatusEvidence(String title) {
        sql(title + ": package",
                "SELECT package_name, package_type, status FROM package WHERE id = ?", productPkg);
        sql(title + ": package_session, invite and link of each variant",
                "SELECT cv.sku, cv.status AS variant_status, ps.status AS session_status, ei.status AS invite_status, "
                        + "l.status AS link_status, po.status AS option_status, pp.status AS plan_status, pp.actual_price "
                        + "FROM commerce_variant cv JOIN package_session ps ON ps.id = cv.package_session_id "
                        + "JOIN package_session_learner_invitation_to_payment_option l ON l.package_session_id = ps.id "
                        + "JOIN enroll_invite ei ON ei.id = l.enroll_invite_id "
                        + "JOIN payment_option po ON po.id = l.payment_option_id "
                        + "JOIN payment_plan pp ON pp.payment_option_id = po.id "
                        + "WHERE cv.package_id = ? ORDER BY cv.position", productPkg);
    }

    // ---------------------------------------------------------------- seed

    @Test
    @Order(2)
    void seed_twoInstitutesAndLegacyCoursesMadeByTheBulkCourseService() {
        note("");
        note("== seed: institutes " + instA + " (A) and " + instB + " (B)");
        db.update("INSERT INTO institutes (id, name) VALUES (?, ?), (?, ?)",
                instA, "Proof Institute A " + run, instB, "Proof Institute B " + run);
        // The shared DEFAULT and INVITED rows exist in production; no migration creates them, and
        // the bulk course service cannot (its fallback saves a row with a generated id).
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        adminA = principal("admin-a-" + run, "ADMIN");
        adminB = principal("admin-b-" + run, "ADMIN");
        // For the HTTP part: the secret this service signs its internal calls with, and the
        // stand-in users, one role per institute.
        db.update("INSERT INTO client_secret_key (client_name, secret_key) VALUES ('admin_core_service', 'local-only') ON CONFLICT DO NOTHING");
        stubUser("admin-a-" + run, false, instA, "ADMIN");
        stubUser("admin-b-" + run, true, instB, "ADMIN");
        stubUser("student-a-" + run, true, instA, "STUDENT");
        stubUser("manager-a-" + run, true, instA, "COMMERCE_STORE_MANAGER");
        stubUser("both-" + run, true, instA, "STUDENT", instB, "ADMIN");
        requestFrom(instA);
        BulkCoursePaymentConfigDTO paid500 = BulkCoursePaymentConfigDTO.builder()
                .paymentType("ONE_TIME").price(500.0).currency("INR").validityInDays(30).build();
        BulkCoursePaymentConfigDTO paid300 = BulkCoursePaymentConfigDTO.builder()
                .paymentType("ONE_TIME").price(300.0).currency("INR").validityInDays(30).build();
        BulkCourseItemDTO course = BulkCourseItemDTO.builder().courseName("Biology Basics " + run)
                .courseType("COURSE").paymentConfig(paid500).publishToCatalogue(true)
                .inventoryConfig(BulkCourseInventoryConfigDTO.builder().maxSlots(10).availableSlots(10).build())
                .batches(List.of(new BulkCourseBatchDTO())).build();
        // What the admin bulk-create screen writes today when "Product" is picked as course type.
        BulkCourseItemDTO typed = BulkCourseItemDTO.builder().courseName("Typed Product Course " + run)
                .courseType("PRODUCT").paymentConfig(paid300).publishToCatalogue(true).batches(List.of(new BulkCourseBatchDTO())).build();
        BulkCourseItemDTO spare = BulkCourseItemDTO.builder().courseName("Spare Course " + run)
                .courseType("COURSE").paymentConfig(paid300).batches(List.of(new BulkCourseBatchDTO())).build();
        BulkAddCourseResponseDTO made = bulkCourseService.bulkAddCourses(
                BulkAddCourseRequestDTO.builder().courses(List.of(course, typed, spare)).build(), instA, adminA);
        note("-- BulkCourseService result for A: " + dump(made));
        assertEquals(3, made.getSuccessCount(), dump(made));
        BulkCourseResultDTO r0 = made.getResults().get(0);
        coursePkg = r0.getCourseId();
        courseBatch = r0.getPackageSessionIds().get(0);
        courseInvite = r0.getEnrollInviteIds().get(0);
        courseOption = r0.getPaymentOptionId();
        BulkCourseResultDTO r1 = made.getResults().get(1);
        typedPkg = r1.getCourseId();
        typedBatch = r1.getPackageSessionIds().get(0);
        typedInvite = r1.getEnrollInviteIds().get(0);
        typedOption = r1.getPaymentOptionId();
        BulkCourseResultDTO r2 = made.getResults().get(2);
        sparePkg = r2.getCourseId();
        spareBatch = r2.getPackageSessionIds().get(0);
        spareInvite = r2.getEnrollInviteIds().get(0);
        spareOption = r2.getPaymentOptionId();

        requestFrom(instB);
        BulkAddCourseResponseDTO madeB = bulkCourseService.bulkAddCourses(BulkAddCourseRequestDTO.builder()
                .courses(List.of(BulkCourseItemDTO.builder().courseName("Course Of B " + run).courseType("COURSE")
                        .paymentConfig(paid300).batches(List.of(new BulkCourseBatchDTO())).build())).build(),
                instB, adminB);
        assertEquals(1, madeB.getSuccessCount(), dump(madeB));
        coursePkgB = madeB.getResults().get(0).getCourseId();

        sql("legacy courses of A as the bulk service wrote them",
                "SELECT p.package_name, p.package_type, p.status, "
                        + "(SELECT count(*) FROM package_session ps WHERE ps.package_id = p.id) AS sessions, "
                        + "(SELECT count(*) FROM commerce_product cp WHERE cp.package_id = p.id) AS commerce_rows "
                        + "FROM package p JOIN package_institute pi ON pi.package_id = p.id WHERE pi.institute_id = ? "
                        + "ORDER BY p.package_name", instA);
        sql("shared level and session rows", "SELECT 'level' AS t, id, status FROM level WHERE id IN ('DEFAULT','INVITED') "
                + "UNION ALL SELECT 'session', id, status FROM session WHERE id IN ('DEFAULT','INVITED') ORDER BY 1, 2");
    }

    // ------------------------------------------------------------------ (a)

    private ProductRequest kurtaRequest() {
        List<VariantRequest> variants = new ArrayList<>();
        variants.add(VariantRequest.builder().sku("KK-S-" + run).name("Small").price(new BigDecimal("1200.00"))
                .mrp(new BigDecimal("1500.00")).optionValues(Map.of(sizeAttr, sizeS)).build());
        variants.add(VariantRequest.builder().sku("KK-M-" + run).name("Medium").price(new BigDecimal("1250.00"))
                .optionValues(Map.of(sizeAttr, sizeM)).build());
        variants.add(VariantRequest.builder().sku("KK-L-" + run).name("Large").price(new BigDecimal("1300.50"))
                .costPrice(new BigDecimal("640.25")).optionValues(Map.of(sizeAttr, sizeL)).build());
        return ProductRequest.builder().externalRef("ext-kurta-" + run)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name("Khadi Kurta " + run)
                        .shortDescription("Hand-spun").build()))
                .optionAttributeIds(List.of(sizeAttr)).variants(variants).build();
    }

    @Test
    @Order(3)
    void a_oneCallCreatesAProductWithThreeVariantsAndExactlyTheRowsOfSection3_1() {
        note("");
        note("== (a) create a product with three variants in one call");
        requestFrom(instA);

        // Commerce is off until the institute holds the module row.
        CommerceAccessDeniedException off = assertThrows(CommerceAccessDeniedException.class,
                () -> productController.list(instA, null, null, null, false, 0, 20, adminA));
        note("-- before the entitlement row, the controller refuses: " + off.getMessage());
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true), (?, 'commerce', true)",
                instA, instB);
        capabilityResolver.evict(instA);
        capabilityResolver.evict(instB);

        AttributeDTO size = attributeService.create(instA, adminA.getUserId(),
                AttributeDTO.builder().code("size").nameI18n(Map.of("en", "Size")).kind("SIZE").build());
        sizeAttr = size.getId();
        sizeS = attributeService.createValue(instA, adminA.getUserId(), sizeAttr,
                AttributeValueDTO.builder().code("s").labelI18n(Map.of("en", "S")).build()).getId();
        sizeM = attributeService.createValue(instA, adminA.getUserId(), sizeAttr,
                AttributeValueDTO.builder().code("m").labelI18n(Map.of("en", "M")).build()).getId();
        sizeL = attributeService.createValue(instA, adminA.getUserId(), sizeAttr,
                AttributeValueDTO.builder().code("l").labelI18n(Map.of("en", "L")).build()).getId();

        long invitedBefore = count("INVITED package sessions in the whole database before the save",
                "SELECT count(*) FROM package_session WHERE status = 'INVITED' OR level_id = 'INVITED' OR session_id = 'INVITED'");
        long formsBefore = count("learner invitation forms before the save", "SELECT count(*) FROM learner_invitation");

        // Through the real controller: access guard, then the service, one transaction.
        ProductResponse created = productController.save(kurtaRequest(), instA, adminA).getBody();
        assertNotNull(created);
        productPkg = created.getPackageId();
        refreshVariants(created);
        assertEquals("DRAFT", created.getStatus());
        assertEquals(3, variantBySku.size());

        Map<String, Long> counts = productRowCounts();
        note("-- rows owned by the product: " + counts);
        Map<String, Long> expected = new LinkedHashMap<>();
        expected.put("package", 1L);
        expected.put("package_institute", 1L);
        expected.put("package_session", 3L);
        expected.put("link", 3L);
        expected.put("enroll_invite", 3L);
        expected.put("payment_option", 3L);
        expected.put("payment_plan", 3L);
        expected.put("commerce_product", 1L);
        expected.put("commerce_product_translation", 1L);
        expected.put("commerce_variant", 3L);
        expected.put("commerce_product_option", 1L);
        expected.put("commerce_variant_option_value", 3L);
        assertEquals(expected, counts);

        sql("package", "SELECT id, package_name, package_type, status, is_course_published_to_catalaouge, version_number, created_by_user_id FROM package WHERE id = ?", productPkg);
        sql("package_institute", "SELECT institute_id FROM package_institute WHERE package_id = ?", productPkg);
        List<Map<String, Object>> sessions = sql("package_session (one per variant)",
                "SELECT id, level_id, session_id, name, status, max_seats, available_slots, is_parent, is_org_associated, version "
                        + "FROM package_session WHERE package_id = ? ORDER BY name", productPkg);
        assertEquals(3, sessions.size());
        assertTrue(sessions.stream().allMatch(r -> "DEFAULT".equals(r.get("level_id")) && "DEFAULT".equals(r.get("session_id"))));
        assertEquals(3, sessions.stream().map(r -> r.get("name")).distinct().count(), "distinct variant names");
        assertTrue(sessions.stream().allMatch(r -> Integer.valueOf(0).equals(r.get("max_seats"))
                && Integer.valueOf(0).equals(r.get("available_slots"))), "TRACKED starts at 0 / 0");
        sql("enroll_invite (one per variant)",
                "SELECT ei.name, ei.status, ei.tag, ei.vendor, ei.currency, ei.learner_access_days, ei.institute_id, "
                        + "(ei.invite_code IS NOT NULL) AS has_code, ei.short_url, ei.is_bundled "
                        + "FROM enroll_invite ei WHERE ei.id IN (SELECT enroll_invite_id FROM package_session_learner_invitation_to_payment_option "
                        + "WHERE package_session_id IN (SELECT id FROM package_session WHERE package_id = ?)) ORDER BY ei.name", productPkg);
        sql("link rows", "SELECT l.status, (l.enroll_invite_id IS NOT NULL) AS invite, (l.payment_option_id IS NOT NULL) AS option "
                + "FROM package_session_learner_invitation_to_payment_option l WHERE l.package_session_id IN "
                + "(SELECT id FROM package_session WHERE package_id = ?)", productPkg);
        List<Map<String, Object>> plans = sql("payment_option and payment_plan with the price",
                "SELECT po.name, po.type, po.source, po.status AS option_status, po.require_approval, pp.actual_price, pp.elevated_price, "
                        + "pp.currency, pp.validity_in_days, pp.status AS plan_status "
                        + "FROM payment_option po JOIN payment_plan pp ON pp.payment_option_id = po.id "
                        + "WHERE po.source = 'PACKAGE_SESSION' AND po.source_id IN (SELECT id FROM package_session WHERE package_id = ?) "
                        + "ORDER BY pp.actual_price", productPkg);
        assertEquals(List.of(1200.0, 1250.0, 1300.5), plans.stream().map(r -> ((Number) r.get("actual_price")).doubleValue()).toList());
        assertTrue(plans.stream().allMatch(r -> r.get("validity_in_days") == null), "no validity, so the plan never ends");
        sql("commerce_product", "SELECT institute_id, slug, stock_mode, unit, qty_scale, qty_step, status, published_at, external_ref FROM commerce_product WHERE package_id = ?", productPkg);
        sql("commerce_product_translation", "SELECT locale, name, short_description, search_text FROM commerce_product_translation WHERE package_id = ?", productPkg);
        sql("commerce_variant", "SELECT sku, stock_policy, status, position, cost_price, standard_cost, (package_session_id IS NOT NULL) AS has_session FROM commerce_variant WHERE package_id = ? ORDER BY position", productPkg);
        sql("commerce_product_option", "SELECT attribute_id, position FROM commerce_product_option WHERE package_id = ?", productPkg);
        sql("commerce_variant_option_value", "SELECT cv.sku, av.code AS value_code FROM commerce_variant_option_value ov "
                + "JOIN commerce_variant cv ON cv.package_session_id = ov.package_session_id "
                + "JOIN commerce_attribute_value av ON av.id = ov.attribute_value_id WHERE cv.package_id = ? ORDER BY cv.position", productPkg);
        sql("commerce_audit rows of the save", "SELECT kind, reference_type, actor_user_id FROM commerce_audit WHERE institute_id = ? ORDER BY created_at", instA);

        assertEquals(invitedBefore, count("INVITED package sessions after the save (must be unchanged)",
                "SELECT count(*) FROM package_session WHERE status = 'INVITED' OR level_id = 'INVITED' OR session_id = 'INVITED'"));
        assertEquals(0, count("INVITED sessions under the product",
                "SELECT count(*) FROM package_session WHERE package_id = ? AND (status = 'INVITED' OR level_id = 'INVITED')", productPkg));
        assertEquals(formsBefore, count("learner invitation forms after the save (must be unchanged)",
                "SELECT count(*) FROM learner_invitation"));

        note("-- draft product: legacy rows are hidden");
        legacyStatusEvidence("draft");
        assertEquals("DELETED", db.queryForObject("SELECT status FROM package WHERE id = ?", String.class, productPkg));
        legacyReadersShowNoShopRows("draft");
    }

    // ------------------------------------------------------------------ (d)

    /**
     * Runs the legacy course and batch readers of institute A. The product and its variants
     * must be absent from each; when {@code coursesExpected}, the ordinary course and the
     * PRODUCT-typed course (no commerce rows) must be present.
     */
    private void legacyReadersShowNoShopRows(String phase) {
        requestFrom(instA);
        Map<String, Supplier<Object>> readers = new LinkedHashMap<>();
        readers.put("admin course list: PackageService.getcourseCatalogDetail",
                () -> packageService.getcourseCatalogDetail(new LearnerPackageFilterDTO(), instA, 0, 200));
        readers.put("admin course list, search by name 'Kurta': PackageService.getcourseCatalogDetail", () -> {
            LearnerPackageFilterDTO byName = new LearnerPackageFilterDTO();
            byName.setSearchByName("Kurta");
            return packageService.getcourseCatalogDetail(byName, instA, 0, 200);
        });
        readers.put("course search: BatchService.searchPackagesByInstitute",
                () -> batchService.searchPackagesByInstitute(instA, List.of(), List.of(), List.of(), null,
                        PageRequest.of(0, 200)));
        readers.put("catalogue v2: OpenPackageService.getLearnerPackageDetailV2",
                () -> openPackageService.getLearnerPackageDetailV2(new LearnerPackageFilterDTO(), instA, 0, 200));
        readers.put("catalogue v2, search by name 'Kurta'", () -> {
            LearnerPackageFilterDTO byName = new LearnerPackageFilterDTO();
            byName.setSearchByName("Kurta");
            return openPackageService.getLearnerPackageDetailV2(byName, instA, 0, 200);
        });
        readers.put("institute init payload with batches: InstituteInitManager.getInstituteDetails",
                () -> instituteInitManager.getInstituteDetails(instA, true));
        readers.put("batch list: InstituteInitManager.getPaginatedPackageSessions",
                () -> instituteInitManager.getPaginatedPackageSessions(instA, 0, 200, null, null, null, null, null,
                        null, null, List.of("ACTIVE", "HIDDEN", "DELETED", "DRAFT")));
        readers.put("batch summary: InstituteInitManager.getBatchesSummary",
                () -> instituteInitManager.getBatchesSummary(instA, List.of("ACTIVE", "HIDDEN", "DELETED", "DRAFT")));
        readers.put("PackageSessionRepository.findPackageSessionsByInstituteId (all statuses)",
                () -> packageSessionRepository.findPackageSessionsByInstituteId(instA,
                        List.of("ACTIVE", "HIDDEN", "DELETED", "DRAFT")).stream()
                        .map(ps -> ps.getId() + ":" + ps.getPackageEntity().getId()).toList());
        readers.put("PackageRepository.findDistinctPackagesByInstituteIdAndStatuses (all statuses)",
                () -> packageRepository.findDistinctPackagesByInstituteIdAndStatuses(instA,
                        List.of("ACTIVE", "DELETED", "DRAFT"), List.of("ACTIVE", "HIDDEN", "DELETED")).stream()
                        .map(pkg -> pkg.getId()).toList());

        List<String> shopIds = new ArrayList<>(variantSessionIds());
        shopIds.add(productPkg);
        shopIds.addAll(otherShopIds);
        note("-- (d) legacy readers, product is " + phase);
        // The catalogue readers want the published flag, which a product never has. It is forced on
        // here, by SQL, so that only the commerce exclusion keeps the product out of them.
        db.update("UPDATE package SET is_course_published_to_catalaouge = true WHERE id = ?", productPkg);
        try {
            runReaders(readers, shopIds);
        } finally {
            db.update("UPDATE package SET is_course_published_to_catalaouge = false WHERE id = ?", productPkg);
        }
        long courses = packageRepository.countDistinctPackagesByInstituteId(instA);
        note("   PackageRepository.countDistinctPackagesByInstituteId = " + courses + " (3 legacy courses, product not counted)");
        assertEquals(3, courses);
    }

    private void runReaders(Map<String, Supplier<Object>> readers, List<String> shopIds) {
        for (Map.Entry<String, Supplier<Object>> reader : readers.entrySet()) {
            String out = dump(reader.getValue().get());
            boolean hasCourse = out.contains(coursePkg);
            boolean hasTyped = out.contains(typedPkg);
            List<String> leaked = shopIds.stream().filter(out::contains).toList();
            note("   " + reader.getKey() + ": course=" + hasCourse + " typedProductCourse=" + hasTyped
                    + " shopIdsFound=" + leaked.size() + " (" + out.length() + " chars)");
            assertTrue(leaked.isEmpty(), reader.getKey() + " shows shop rows " + leaked);
            if (!reader.getKey().contains("Kurta")) {
                assertTrue(hasCourse, reader.getKey() + " lost the ordinary course");
                assertTrue(hasTyped, reader.getKey() + " lost the PRODUCT-typed course");
            }
        }
    }

    // ------------------------------------------------------------------ (b)

    @Test
    @Order(4)
    void b_updateIsIdempotent_priceReachesThePlan_duplicateOptionsRefused() {
        note("");
        note("== (b) update, publish, price change, duplicate option set");
        requestFrom(instA);
        Map<String, Long> before = productRowCounts();
        List<Map<String, Object>> versionsBefore = db.queryForList(
                "SELECT id, version, status FROM package_session WHERE package_id = ? ORDER BY id", productPkg);
        long auditBefore = db.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'VARIANT_PRICE_CHANGED'", Long.class, instA);

        // The same request again: external_ref names the product, so it is an update.
        ProductResponse again = productController.save(kurtaRequest(), instA, adminA).getBody();
        assertEquals(productPkg, again.getPackageId());
        Map<String, Long> after = productRowCounts();
        note("-- row counts before the repeated save: " + before);
        note("-- row counts after the repeated save:  " + after);
        assertEquals(before, after);
        assertEquals(versionsBefore, db.queryForList(
                "SELECT id, version, status FROM package_session WHERE package_id = ? ORDER BY id", productPkg),
                "a repeated save must not touch package_session (version unchanged)");
        note("-- package_session id/version/status unchanged by the repeated save: " + versionsBefore);
        assertEquals(1, count("products of A with this external_ref",
                "SELECT count(*) FROM commerce_product WHERE institute_id = ? AND external_ref = ?", instA, "ext-kurta-" + run));
        assertEquals(auditBefore, db.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ? AND kind = 'VARIANT_PRICE_CHANGED'", Long.class, instA),
                "same prices: no price audit row");

        // Publish.
        ProductResponse live = productController.changeStatus(productPkg, new ProductStatusRequest("ACTIVE"), instA, adminA).getBody();
        refreshVariants(live);
        assertEquals("ACTIVE", live.getStatus());
        legacyStatusEvidence("published");
        assertEquals(3, count("ACTIVE package sessions of the product",
                "SELECT count(*) FROM package_session WHERE package_id = ? AND status = 'ACTIVE'", productPkg));
        assertEquals("ACTIVE", db.queryForObject("SELECT status FROM package WHERE id = ?", String.class, productPkg));

        // Price change on one variant.
        String medium = "KK-M-" + run;
        productService.updateVariant(instA, adminA.getUserId(), ps(medium),
                VariantRequest.builder().price(new BigDecimal("1400.00")).build());
        List<Map<String, Object>> prices = sql("payment_plan after the price change of " + medium,
                "SELECT cv.sku, pp.actual_price, pp.elevated_price FROM commerce_variant cv "
                        + "JOIN package_session_learner_invitation_to_payment_option l ON l.package_session_id = cv.package_session_id "
                        + "JOIN payment_plan pp ON pp.payment_option_id = l.payment_option_id WHERE cv.package_id = ? ORDER BY cv.position", productPkg);
        assertEquals(List.of(1200.0, 1400.0, 1300.5), prices.stream().map(r -> ((Number) r.get("actual_price")).doubleValue()).toList());
        sql("audit row of the price change", "SELECT kind, reference_type, reference_id, new_value_json::text AS detail FROM commerce_audit "
                + "WHERE institute_id = ? AND kind = 'VARIANT_PRICE_CHANGED'", instA);
        assertEquals(after, productRowCounts(), "a price change adds no legacy row");

        // A fourth variant with the option values of an existing one.
        Map<String, Long> beforeDuplicate = productRowCounts();
        RuntimeException refused = assertThrows(RuntimeException.class, () -> productService.saveVariants(instA,
                adminA.getUserId(), productPkg, List.of(VariantRequest.builder().sku("KK-M2-" + run)
                        .price(new BigDecimal("999.00")).optionValues(Map.of(sizeAttr, sizeM)).build())));
        note("-- duplicate option set refused: " + refused.getClass().getSimpleName() + ": " + refused.getMessage());
        assertTrue(refused.getMessage().contains("same option values"), refused.getMessage());
        assertEquals(beforeDuplicate, productRowCounts(), "the refused save rolled back every row it wrote");
        assertEquals(0, count("rows left behind by the refused variant",
                "SELECT (SELECT count(*) FROM commerce_variant WHERE sku = ?) + (SELECT count(*) FROM payment_option WHERE name LIKE ?)",
                "KK-M2-" + run, "%KK-M2-" + run + "%"));

        legacyReadersShowNoShopRows("ACTIVE (published)");
        assertEquals(1, productService.list(instA, "ACTIVE", null, null, 0, 20).getTotalElements());
        assertEquals(0, productService.list(instA, "DRAFT", null, null, 0, 20).getTotalElements());
    }

    // ------------------------------------------------------------------ (c)

    @Test
    @Order(5)
    void c_anotherInstituteCannotReadOrChangeTheProduct() {
        note("");
        note("== (c) tenancy: institute B against the product of A");
        Map<String, Object> rowBefore = db.queryForMap("SELECT status, slug, updated_at FROM commerce_product WHERE package_id = ?", productPkg);
        List<Map<String, Object>> plansBefore = db.queryForList("SELECT pp.id, pp.actual_price FROM payment_plan pp JOIN payment_option po ON po.id = pp.payment_option_id "
                + "WHERE po.source_id IN (" + in(variantSessionIds()) + ") ORDER BY pp.id");
        String small = ps("KK-S-" + run);

        // B's admin, B's header, A's institute id in the URL: the guard refuses.
        requestFrom(instB);
        CommerceAccessDeniedException denied = assertThrows(CommerceAccessDeniedException.class,
                () -> productController.get(productPkg, instA, adminB));
        note("-- B's admin asks for instituteId=A: " + denied.getMessage());
        assertThrows(CommerceAccessDeniedException.class,
                () -> productController.changeStatus(productPkg, new ProductStatusRequest("ARCHIVED"), instA, adminB));
        // A's header forged on B's token is the same case for the guard only if auth_service minted
        // the authorities for A; that is outside this service and is not exercised here.

        // B's admin in B's own institute, with A's ids: not found, nothing written.
        assertThrows(ResourceNotFoundException.class, () -> productController.get(productPkg, instB, adminB));
        assertThrows(ResourceNotFoundException.class, () -> productController.update(productPkg,
                ProductRequest.builder().brand("stolen").build(), instB, adminB));
        assertThrows(ResourceNotFoundException.class,
                () -> productController.changeStatus(productPkg, new ProductStatusRequest("ARCHIVED"), instB, adminB));
        assertThrows(ResourceNotFoundException.class, () -> productService.updateVariant(instB, adminB.getUserId(), small,
                VariantRequest.builder().price(new BigDecimal("1.00")).build()));
        assertThrows(ResourceNotFoundException.class, () -> productService.getVariant(instB, small));
        assertThrows(ResourceNotFoundException.class, () -> productService.saveVariants(instB, adminB.getUserId(), productPkg,
                List.of(VariantRequest.builder().sku("B-" + run).build())));
        assertEquals(0, productController.list(instB, null, null, null, false, 0, 20, adminB).getBody().getTotalElements());
        note("-- B's admin in B: get, update, status, variant update, variant read, variant add all answer 'not found'; list is empty");

        // B cannot adopt A's product by sending A's external_ref: it gets its own draft or a refusal, never A's rows.
        // B cannot use A's attribute in its own product.
        RuntimeException foreignAttribute = assertThrows(RuntimeException.class, () -> productController.save(
                ProductRequest.builder().translations(List.of(ProductTranslationDTO.builder().locale("en").name("B thing " + run).build()))
                        .optionAttributeIds(List.of(sizeAttr))
                        .variants(List.of(VariantRequest.builder().sku("B-1-" + run).optionValues(Map.of(sizeAttr, sizeS)).build()))
                        .build(), instB, adminB));
        note("-- B uses A's attribute id: " + foreignAttribute.getMessage());
        assertEquals(0, count("commerce rows of B after the refused save",
                "SELECT (SELECT count(*) FROM commerce_product WHERE institute_id = ?) + (SELECT count(*) FROM commerce_variant WHERE institute_id = ?)", instB, instB));
        assertEquals(1, count("packages of B (its one course; the refused product left none)",
                "SELECT count(*) FROM package_institute WHERE institute_id = ?", instB));

        assertEquals(rowBefore, db.queryForMap("SELECT status, slug, updated_at FROM commerce_product WHERE package_id = ?", productPkg));
        assertEquals(plansBefore, db.queryForList("SELECT pp.id, pp.actual_price FROM payment_plan pp JOIN payment_option po ON po.id = pp.payment_option_id "
                + "WHERE po.source_id IN (" + in(variantSessionIds()) + ") ORDER BY pp.id"));
        sql("the product row after every attempt by B (unchanged)",
                "SELECT status, slug, brand, updated_at FROM commerce_product WHERE package_id = ?", productPkg);
        requestFrom(instA);
    }

    // ------------------------------------------------------- (d) learner side

    @Test
    @Order(6)
    void d_learnerReadersShowNoShopRowsEvenWithAnEnrolmentRowOnAVariant() {
        note("");
        note("== (d) learner-side readers");
        requestFrom(instA);
        String learner = "learner-d-" + run;
        // An ACTIVE enrolment in the ordinary course, in the PRODUCT-typed course, and (forced by
        // SQL, no code path writes it) on a variant: the readers must still leave the product out.
        for (String session : List.of(courseBatch, typedBatch, ps("KK-S-" + run))) {
            db.update("INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, institute_id, status, type, enrolled_date) "
                    + "VALUES (?, ?, ?, ?, 'ACTIVE', 'PACKAGE_SESSION', now())", UUID.randomUUID().toString(), learner, session, instA);
        }
        CustomUserDetails learnerUser = principal(learner, "STUDENT");

        List<String> counted = packageRepository.findDistinctPackagesByUserIdAndInstituteId(learner, instA,
                List.of("ACTIVE"), List.of("ACTIVE", "HIDDEN"), List.of("ACTIVE")).stream().map(p -> p.getId()).toList();
        note("-- raw repository rows for the dashboard tile (before the service filter): hasProduct=" + counted.contains(productPkg) + " size=" + counted.size());
        Integer tile = learnerDashBoardService.getLearnerDashBoardDetail(instA, List.of(), learnerUser).getCourses();
        note("-- LearnerDashBoardService.getLearnerDashBoardDetail courses = " + tile + " (ordinary course + PRODUCT-typed course)");
        assertEquals(2, tile);

        String myCourses = String.valueOf(learnerPackageService.getLearnerPackageDetail(new LearnerPackageFilterDTO(), learner, instA, 0, 200)
                .getContent().stream().map(d -> d.getId() + ":" + d.getPackageSessionId()).toList());
        note("-- LearnerPackageService.getLearnerPackageDetail: course=" + myCourses.contains(coursePkg)
                + " typedProductCourse=" + myCourses.contains(typedPkg) + " product=" + myCourses.contains(productPkg)
                + " rows=" + myCourses);
        assertTrue(myCourses.contains(coursePkg) && myCourses.contains(typedPkg));
        assertFalse(myCourses.contains(productPkg));
        assertTrue(variantSessionIds().stream().noneMatch(myCourses::contains));

        // The learner's own course list (admin learner page): with the forced row on the variant
        // still there, the reader returns the two course rows and not the variant row.
        db.update("INSERT INTO student (id, user_id, username, full_name, mobile_number) VALUES (?, ?, ?, 'Proof Learner', '9000000001')",
                UUID.randomUUID().toString(), learner, learner);
        List<String> studentRows = instituteStudentRepository.getStudentWithInstituteAndUserId(learner, instA).stream()
                .map(java.util.Arrays::toString).toList();
        assertEquals(3, count("enrolment rows of the learner in the database (course, typed course, variant)",
                "SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ? AND institute_id = ?", learner, instA));
        note("-- InstituteStudentRepository.getStudentWithInstituteAndUserId: rows=" + studentRows.size()
                + " course=" + studentRows.stream().anyMatch(r -> r.contains(courseBatch))
                + " typedProductCourse=" + studentRows.stream().anyMatch(r -> r.contains(typedBatch))
                + " variant=" + studentRows.stream().anyMatch(r -> r.contains(ps("KK-S-" + run))));
        assertEquals(2, studentRows.size(), "the two courses, not the variant");
        assertTrue(studentRows.stream().anyMatch(r -> r.contains(courseBatch)) && studentRows.stream().anyMatch(r -> r.contains(typedBatch)));
        assertTrue(studentRows.stream().noneMatch(r -> r.contains(ps("KK-S-" + run))));

        db.update("DELETE FROM student_session_institute_group_mapping WHERE user_id = ? AND package_session_id = ?", learner, ps("KK-S-" + run));
    }

    // ------------------------------------------------------------------ (e)

    /** The legacy services run inside the request's open session in production; a transaction stands in for it. */
    private void legacy(Runnable call) {
        inTransaction(() -> {
            call.run();
            return null;
        });
    }

    private void refused400(String what, Runnable call) {
        VacademyException refused = assertThrows(VacademyException.class, () -> legacy(call), what);
        note("   refused (" + refused.getStatus().value() + ") " + what + ": " + refused.getMessage());
        assertEquals(400, refused.getStatus().value(), what);
    }

    @Test
    @Order(7)
    void e_legacyWritersRefuseShopRowsAndStillWorkForACourse() {
        note("");
        note("== (e) legacy writers");
        requestFrom(instA);
        VariantResponse small = variantBySku.get("KK-S-" + run);
        List<Map<String, Object>> shopBefore = db.queryForList(
                "SELECT ps.id, ps.status, ps.name, ei.status AS invite, po.status AS opt, po.name AS opt_name, pp.actual_price "
                        + "FROM package_session ps JOIN package_session_learner_invitation_to_payment_option l ON l.package_session_id = ps.id "
                        + "JOIN enroll_invite ei ON ei.id = l.enroll_invite_id JOIN payment_option po ON po.id = l.payment_option_id "
                        + "JOIN payment_plan pp ON pp.payment_option_id = po.id WHERE ps.package_id = ? ORDER BY ps.id", productPkg);
        Map<String, Long> countsBefore = productRowCounts();

        note("-- against the shop product");
        refused400("payment option edit", () -> paymentOptionService.editPaymentOption(
                PaymentOptionDTO.builder().id(small.getPaymentOptionId()).name("cheap").type("ONE_TIME").build()));
        refused400("payment option delete", () -> paymentOptionService.deletePaymentOption(List.of(small.getPaymentOptionId()), adminA));
        refused400("second payment option on a variant", () -> paymentOptionService.savePaymentOption(
                PaymentOptionDTO.builder().source("PACKAGE_SESSION").sourceId(small.getPackageSessionId()).name("second").type("ONE_TIME").build(), adminA));
        refused400("invite delete", () -> enrollInviteService.deleteEnrollInvites(List.of(small.getEnrollInviteId())));
        refused400("batch delete", () -> batchService.deletePackageSession(new String[]{small.getPackageSessionId()}, adminA));
        AddLevelWithCourseDTO newLevel = new AddLevelWithCourseDTO();
        newLevel.setNewLevel(true);
        newLevel.setLevelName("Level for product " + run);
        refused400("level add on the product", () -> levelService.addLevel(newLevel, productPkg, "DEFAULT", instA, adminA));
        AddLevelWithSessionDTO levelOfProduct = new AddLevelWithSessionDTO();
        levelOfProduct.setPackageId(productPkg);
        levelOfProduct.setNewLevel(false);
        levelOfProduct.setId("DEFAULT");
        AddNewSessionDTO sessionOnProduct = new AddNewSessionDTO();
        sessionOnProduct.setNewSession(true);
        sessionOnProduct.setSessionName("Session for product " + run);
        sessionOnProduct.setStatus("ACTIVE");
        sessionOnProduct.setLevels(List.of(levelOfProduct));
        refused400("session add on the product", () -> sessionService.addNewSession(sessionOnProduct, instA, adminA));
        refused400("delete of the shared DEFAULT level", () -> levelService.deleteLevels(List.of("DEFAULT"), instA, adminA));
        refused400("delete of the shared DEFAULT session", () -> sessionService.deleteSessions(List.of("DEFAULT"), instA, adminA));

        assertEquals(shopBefore, db.queryForList(
                "SELECT ps.id, ps.status, ps.name, ei.status AS invite, po.status AS opt, po.name AS opt_name, pp.actual_price "
                        + "FROM package_session ps JOIN package_session_learner_invitation_to_payment_option l ON l.package_session_id = ps.id "
                        + "JOIN enroll_invite ei ON ei.id = l.enroll_invite_id JOIN payment_option po ON po.id = l.payment_option_id "
                        + "JOIN payment_plan pp ON pp.payment_option_id = po.id WHERE ps.package_id = ? ORDER BY ps.id", productPkg));
        assertEquals(countsBefore, productRowCounts());
        legacyStatusEvidence("after every refused legacy write (unchanged)");
        sql("shared rows after the refused deletes", "SELECT 'level' AS t, id, status FROM level WHERE id = 'DEFAULT' UNION ALL SELECT 'session', id, status FROM session WHERE id = 'DEFAULT'");
        assertEquals(0, count("sessions for the refused 'Session for product'", "SELECT count(*) FROM session WHERE session_name = ?", "Session for product " + run));

        note("-- the same writers on an ordinary course");
        PaymentOption spare = paymentOptionRepository.findById(spareOption).orElseThrow();
        legacy(() -> paymentOptionService.editPaymentOption(PaymentOptionDTO.builder().id(spareOption)
                .name("Spare renamed " + run).type(spare.getType()).build()));
        sql("payment option edit on a course", "SELECT name, type, status FROM payment_option WHERE id = ?", spareOption);
        assertEquals("Spare renamed " + run, db.queryForObject("SELECT name FROM payment_option WHERE id = ?", String.class, spareOption));

        AddLevelWithCourseDTO courseLevel = new AddLevelWithCourseDTO();
        courseLevel.setNewLevel(true);
        courseLevel.setLevelName("Level One " + run);
        courseLevel.setDurationInDays(30);
        String levelId = inTransaction(() -> levelService.addLevel(courseLevel, sparePkg, "DEFAULT", instA, adminA));
        sql("level add on a course", "SELECT ps.level_id, ps.session_id, ps.status FROM package_session ps WHERE ps.package_id = ? AND ps.level_id = ?", sparePkg, levelId);
        assertEquals(1, db.queryForObject("SELECT count(*) FROM package_session WHERE package_id = ? AND level_id = ? AND status = 'ACTIVE'", Long.class, sparePkg, levelId));

        AddLevelWithSessionDTO levelOfCourse = new AddLevelWithSessionDTO();
        levelOfCourse.setPackageId(sparePkg);
        levelOfCourse.setNewLevel(false);
        levelOfCourse.setId(levelId);
        AddNewSessionDTO sessionOnCourse = new AddNewSessionDTO();
        sessionOnCourse.setNewSession(true);
        sessionOnCourse.setSessionName("Session 2027 " + run);
        sessionOnCourse.setStatus("ACTIVE");
        sessionOnCourse.setLevels(List.of(levelOfCourse));
        String sessionId = inTransaction(() -> sessionService.addNewSession(sessionOnCourse, instA, adminA));
        sql("session add on a course", "SELECT ps.level_id, ps.session_id, ps.status FROM package_session ps WHERE ps.package_id = ? AND ps.session_id = ?", sparePkg, sessionId);
        assertEquals(1, db.queryForObject("SELECT count(*) FROM package_session WHERE package_id = ? AND session_id = ? AND status = 'ACTIVE'", Long.class, sparePkg, sessionId));

        legacy(() -> sessionService.deleteSessions(List.of(sessionId), instA, adminA));
        sql("session delete on a course", "SELECT s.status AS session_status, ps.status AS batch_status FROM session s JOIN package_session ps ON ps.session_id = s.id WHERE s.id = ?", sessionId);
        assertEquals("DELETED", db.queryForObject("SELECT status FROM session WHERE id = ?", String.class, sessionId));
        legacy(() -> levelService.deleteLevels(List.of(levelId), instA, adminA));
        sql("level delete on a course", "SELECT l.status AS level_status, ps.status AS batch_status, ps.session_id FROM level l JOIN package_session ps ON ps.level_id = l.id WHERE l.id = ?", levelId);
        assertEquals("DELETED", db.queryForObject("SELECT status FROM level WHERE id = ?", String.class, levelId));

        legacy(() -> enrollInviteService.deleteEnrollInvites(List.of(spareInvite)));
        assertEquals("DELETED", db.queryForObject("SELECT status FROM enroll_invite WHERE id = ?", String.class, spareInvite));
        legacy(() -> batchService.deletePackageSession(new String[]{spareBatch}, adminA));
        assertEquals("DELETED", db.queryForObject("SELECT status FROM package_session WHERE id = ?", String.class, spareBatch));
        sql("invite delete and batch delete on a course", "SELECT (SELECT status FROM enroll_invite WHERE id = ?) AS invite_status, (SELECT status FROM package_session WHERE id = ?) AS batch_status", spareInvite, spareBatch);

        // None of it reached the product.
        assertEquals(countsBefore, productRowCounts());
        assertEquals(3, count("ACTIVE variant sessions after the course deletes",
                "SELECT count(*) FROM package_session WHERE package_id = ? AND status = 'ACTIVE'", productPkg));
    }

    // -------------------------------------------------------------- (f), (g)

    private Map<String, Object> slots() {
        Map<String, Object> out = new LinkedHashMap<>();
        db.queryForList("SELECT cv.sku, ps.available_slots FROM commerce_variant cv JOIN package_session ps "
                + "ON ps.id = cv.package_session_id WHERE cv.package_id = ? ORDER BY cv.position", productPkg)
                .forEach(row -> out.put(String.valueOf(row.get("sku")).replace("-" + run, ""), row.get("available_slots")));
        return out;
    }

    private void slotsAre(String step, int small, int medium, int large) {
        Map<String, Object> now = slots();
        note("   available_slots after " + step + ": " + now);
        assertEquals(Map.of("KK-S", small, "KK-M", medium, "KK-L", large), now, step);
    }

    /** What a checkout line does today: a PENDING_FOR_PAYMENT plan on the variant's own invite. */
    private UserPlan commercePlan(String buyer, VariantResponse variant, int quantity) {
        return inTransaction(() -> {
            PaymentPlan plan = paymentPlanRepository.findById(variant.getPaymentPlanId()).orElseThrow();
            EnrollInvite invite = enrollInviteRepository.findById(variant.getEnrollInviteId()).orElseThrow();
            PaymentOption option = paymentOptionRepository.findById(variant.getPaymentOptionId()).orElseThrow();
            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(plan.getActualPrice() * quantity);
            payment.setCurrency("INR");
            return userPlanService.createUserPlan(buyer, plan, null, invite, option, payment, "PENDING_FOR_PAYMENT",
                    null, null, null, null, quantity);
        });
    }

    private long calls(Object mock) {
        return mockingDetails(mock).getInvocations().size();
    }

    @Test
    @Order(8)
    void f_g_stockHoldsAndThePaidPathOfACommercePlan_thenACoursePaymentStillEnrols() {
        note("");
        note("== (f) stock holds on variants");
        requestFrom(instA);
        VariantResponse small = variantBySku.get("KK-S-" + run);
        VariantResponse medium = variantBySku.get("KK-M-" + run);
        VariantResponse large = variantBySku.get("KK-L-" + run);
        String buyer = "buyer-" + run;

        // Nothing writes stock until the ledger of WP-03 exists, so the receipt is done by SQL.
        db.update("UPDATE package_session SET max_seats = 10, available_slots = 10 WHERE id IN (?, ?)",
                small.getPackageSessionId(), medium.getPackageSessionId());
        slotsAre("the SQL receipt of 10 Small and 10 Medium", 10, 10, 0);

        List<StockHold> abandoned = stockHoldService.hold(instA, Map.of(small.getPackageSessionId(), 2), StockHoldKind.PURCHASE);
        assertEquals(1, abandoned.size());
        slotsAre("hold of 2 Small", 8, 10, 0);
        UserPlan plan1 = commercePlan(buyer, small, 2);
        String log1 = paymentLogService.createPaymentLog(buyer, 2400.0, "RAZORPAY", "RAZORPAY", "INR", plan1, "order-1-" + run);
        stockHoldService.attach(abandoned, buyer, plan1.getId(), log1);
        assertEquals(1, stockHoldService.releaseForOrder(log1));
        slotsAre("release of the unpaid order", 10, 10, 0);

        ConflictException none = assertThrows(ConflictException.class,
                () -> stockHoldService.hold(instA, Map.of(large.getPackageSessionId(), 1), StockHoldKind.PURCHASE));
        note("   hold of 1 Large (0 in stock) refused: " + none.getMessage());
        slotsAre("the refused hold", 10, 10, 0);

        assertTrue(stockHoldService.hold(instB, Map.of(small.getPackageSessionId(), 1), StockHoldKind.PURCHASE).isEmpty(),
                "institute B cannot hold A's variant");
        slotsAre("institute B trying to hold A's Small", 10, 10, 0);

        List<StockHold> paidHold = stockHoldService.hold(instA, Map.of(small.getPackageSessionId(), 2), StockHoldKind.PURCHASE);
        List<StockHold> otherHold = stockHoldService.hold(instA, Map.of(medium.getPackageSessionId(), 1), StockHoldKind.PURCHASE);
        slotsAre("hold of 2 Small (order 2) and 1 Medium (order 3)", 8, 9, 0);
        UserPlan plan2 = commercePlan(buyer, small, 2);
        String log2 = paymentLogService.createPaymentLog(buyer, 2400.0, "RAZORPAY", "RAZORPAY", "INR", plan2, "order-2-" + run);
        stockHoldService.attach(paidHold, buyer, plan2.getId(), log2);
        UserPlan plan3 = commercePlan(buyer, medium, 1);
        String log3 = paymentLogService.createPaymentLog(buyer, 1400.0, "RAZORPAY", "RAZORPAY", "INR", plan3, "order-3-" + run);
        stockHoldService.attach(otherHold, buyer, plan3.getId(), log3);

        note("");
        note("== (g) the PAID path of a commerce plan");
        long ledgerBefore = count("fee-ledger rows of the buyer before payment (3 plans created, none accrued)",
                "SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer);
        assertEquals(0, ledgerBefore);
        reset(workflowTriggerService, paymentNotificatonService, dynamicNotificationService, asyncEnrollmentEmailService, invoiceService);
        long authCallsBefore = calls(authService);

        inTransaction(() -> {
            paymentLogService.updatePaymentLog(log2, "SUCCESS", "PAID", "{\"gateway\":\"proof\"}");
            userPlanService.applyOperationsOnFirstPayment(userPlanRepository.findById(plan2.getId()).orElseThrow());
            return null;
        });

        sql("user_plan rows of the buyer",
                "SELECT up.status, up.quantity, up.start_date IS NOT NULL AS started, up.end_date, up.source, cv.sku "
                        + "FROM user_plan up JOIN package_session_learner_invitation_to_payment_option l ON l.enroll_invite_id = up.enroll_invite_id "
                        + "JOIN commerce_variant cv ON cv.package_session_id = l.package_session_id WHERE up.user_id = ? ORDER BY up.created_at", buyer);
        sql("payment_log rows of the buyer",
                "SELECT pl.status, pl.payment_status, pl.payment_amount, pl.vendor, pl.currency, (pl.user_plan_id IS NOT NULL) AS has_plan "
                        + "FROM payment_log pl WHERE pl.user_id = ? ORDER BY pl.created_at", buyer);
        sql("stock_hold rows of the buyer",
                "SELECT cv.sku, sh.kind, sh.quantity, sh.status, (sh.user_plan_id IS NOT NULL) AS has_plan, (sh.payment_log_id IS NOT NULL) AS has_log "
                        + "FROM stock_hold sh JOIN commerce_variant cv ON cv.package_session_id = sh.package_session_id WHERE sh.user_id = ? ORDER BY sh.created_at", buyer);
        assertEquals("ACTIVE", db.queryForObject("SELECT status FROM user_plan WHERE id = ?", String.class, plan2.getId()));
        assertNull(db.queryForObject("SELECT end_date FROM user_plan WHERE id = ?", java.sql.Timestamp.class, plan2.getId()));
        assertEquals("PAID", db.queryForObject("SELECT payment_status FROM payment_log WHERE id = ?", String.class, log2));
        assertEquals("SOLD", db.queryForObject("SELECT status FROM stock_hold WHERE user_plan_id = ?", String.class, plan2.getId()));
        assertEquals("HELD", db.queryForObject("SELECT status FROM stock_hold WHERE user_plan_id = ?", String.class, plan3.getId()));
        slotsAre("payment of order 2 (the hold is sold, nothing is taken twice)", 8, 9, 0);

        assertEquals(0, count("enrolment rows of the buyer", "SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ?", buyer));
        assertEquals(0, count("enrolment rows on any variant session",
                "SELECT count(*) FROM student_session_institute_group_mapping WHERE package_session_id IN (" + in(variantSessionIds()) + ")"));
        assertEquals(0, count("fee-ledger rows of the buyer after payment", "SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer));
        assertEquals(0, count("legacy invoices mapped to the paid log", "SELECT count(*) FROM invoice_payment_log_mapping WHERE payment_log_id = ?", log2));
        note("-- calls on the collaborators during the commerce payment: workflowTriggerService=" + calls(workflowTriggerService)
                + " paymentNotificatonService=" + calls(paymentNotificatonService) + " dynamicNotificationService=" + calls(dynamicNotificationService)
                + " asyncEnrollmentEmailService=" + calls(asyncEnrollmentEmailService) + " invoiceService=" + calls(invoiceService)
                + " authService=" + (calls(authService) - authCallsBefore));
        assertEquals(0, calls(workflowTriggerService), "no workflow trigger");
        assertEquals(0, calls(paymentNotificatonService), "no payment mail");
        assertEquals(0, calls(dynamicNotificationService), "no enrolment notification");
        assertEquals(0, calls(asyncEnrollmentEmailService), "no credentials mail");
        assertEquals(0, calls(invoiceService), "no course invoice");
        assertEquals(0, calls(authService) - authCallsBefore, "no user lookup for a mail");

        List<String> orphans = userPlanRepository.findPaidActivePlansWithoutEnrollment().stream().map(UserPlan::getId).toList();
        note("-- 04:30 job query findPaidActivePlansWithoutEnrollment lists " + orphans.size() + " plan(s); the paid commerce plan is "
                + (orphans.contains(plan2.getId()) ? "LISTED" : "not listed"));
        assertFalse(orphans.contains(plan2.getId()));
        assertEquals(1, count("the same query without the commerce exclusion would list the plan",
                "SELECT count(*) FROM user_plan up JOIN enroll_invite ei ON ei.id = up.enroll_invite_id WHERE up.status = 'ACTIVE' AND up.id = ? "
                        + "AND EXISTS (SELECT 1 FROM payment_log pl WHERE pl.user_plan_id = up.id AND pl.payment_status = 'PAID') "
                        + "AND NOT EXISTS (SELECT 1 FROM student_session_institute_group_mapping m WHERE m.user_id = up.user_id "
                        + "AND m.institute_id = ei.institute_id AND m.status = 'ACTIVE')", plan2.getId()));

        // A second PAID event for the same log changes nothing.
        inTransaction(() -> {
            paymentLogService.updatePaymentLog(log2, "SUCCESS", "PAID", "{\"gateway\":\"proof\"}");
            userPlanService.applyOperationsOnFirstPayment(userPlanRepository.findById(plan2.getId()).orElseThrow());
            return null;
        });
        slotsAre("a repeated PAID event", 8, 9, 0);

        // The legacy plan actions refuse a shop order line.
        refused400("cancel of the commerce plan from the course screens", () -> userPlanService.cancelUserPlan(plan2.getId(), false));

        note("");
        note("== (g) the gateway webhook path (PaymentLogService.updatePaymentLog by order id) for order 3");
        reset(workflowTriggerService, paymentNotificatonService, dynamicNotificationService, asyncEnrollmentEmailService, invoiceService);
        paymentLogService.updatePaymentLog("order-3-" + run, "PAID", instA);
        sql("plan, log and hold of order 3 after the webhook path",
                "SELECT up.status AS plan_status, pl.payment_status, sh.status AS hold_status FROM user_plan up "
                        + "JOIN payment_log pl ON pl.user_plan_id = up.id JOIN stock_hold sh ON sh.user_plan_id = up.id WHERE up.id = ?", plan3.getId());
        assertEquals("ACTIVE", db.queryForObject("SELECT status FROM user_plan WHERE id = ?", String.class, plan3.getId()));
        assertEquals("SOLD", db.queryForObject("SELECT status FROM stock_hold WHERE user_plan_id = ?", String.class, plan3.getId()));
        slotsAre("payment of order 3 through the webhook path", 8, 9, 0);
        assertEquals(0, count("enrolment rows of the buyer after the webhook path", "SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ?", buyer));
        assertEquals(0, count("fee-ledger rows of the buyer after the webhook path", "SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer));
        assertFalse(userPlanRepository.findPaidActivePlansWithoutEnrollment().stream().anyMatch(p -> p.getId().equals(plan3.getId())));
        // Recorded, not asserted: the webhook path has no commerce branch yet (WP-12).
        note("-- OBSERVED on the webhook path (known open, WP-12): workflowTriggerService=" + calls(workflowTriggerService)
                + " " + mockingDetails(workflowTriggerService).getInvocations().stream().map(i -> i.getMethod().getName() + "(" + i.getArguments()[0] + ")").toList()
                + " paymentNotificatonService=" + calls(paymentNotificatonService)
                + " " + mockingDetails(paymentNotificatonService).getInvocations().stream().map(i -> i.getMethod().getName()).toList()
                + " invoiceService=" + calls(invoiceService)
                + " " + mockingDetails(invoiceService).getInvocations().stream().map(i -> i.getMethod().getName()).toList()
                + " dynamicNotificationService=" + calls(dynamicNotificationService)
                + " asyncEnrollmentEmailService=" + calls(asyncEnrollmentEmailService));

        coursePaymentStillEnrols("an ordinary course", coursePkg, courseBatch, courseInvite, courseOption, 500.0, true);
        coursePaymentStillEnrols("the PRODUCT-typed course with no commerce rows", typedPkg, typedBatch, typedInvite, typedOption, 300.0, false);
        slotsAre("the two course payments (variants untouched)", 8, 9, 0);
    }

    /** The legacy paid enrolment, with the INVITED row the learner enrol form writes before payment. */
    private void coursePaymentStillEnrols(String label, String pkg, String batch, String inviteId, String optionId,
                                          double price, boolean seatsTracked) {
        coursePaymentStillEnrols(label, pkg, batch, inviteId, optionId, price, seatsTracked,
                "learner-" + (seatsTracked ? "g" : "t") + "-" + run, false);
    }

    /** The payment log as it is stored once the Razorpay order exists (PaymentService.updatePaymentLogHelper). */
    private String gatewayShapedLog(String userId, double amount, UserPlan plan, String orderId) {
        String logId = paymentLogService.createPaymentLog(userId, amount, "RAZORPAY", "RAZORPAY", "INR", plan, orderId);
        PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
        request.setAmount(amount);
        request.setCurrency("INR");
        request.setOrderId(orderId);
        request.setInstituteId(instA);
        request.setEmail(userId + "@example.invalid");
        request.setVendor("RAZORPAY");
        request.setVendorId("RAZORPAY");
        vacademy.io.common.payment.dto.PaymentResponseDTO response = new vacademy.io.common.payment.dto.PaymentResponseDTO();
        response.setOrderId(orderId);
        response.setStatus("created");
        Map<String, Object> responseData = new java.util.HashMap<>();
        responseData.put("razorpayOrderId", orderId);
        responseData.put("paymentStatus", "PAYMENT_PENDING");
        responseData.put("amount", amount);
        response.setResponseData(responseData);
        Map<String, Object> logData = new java.util.HashMap<>();
        logData.put("response", response);
        logData.put("originalRequest", request);
        paymentLogService.updatePaymentLog(logId, "ACTIVE", "PAYMENT_PENDING",
                vacademy.io.admin_core_service.features.common.util.JsonUtil.toJson(logData));
        return logId;
    }

    private String callNames(Object mock) {
        return calls(mock) + " " + mockingDetails(mock).getInvocations().stream().map(i -> i.getMethod().getName()).toList();
    }

    private void coursePaymentStillEnrols(String label, String pkg, String batch, String inviteId, String optionId,
                                          double price, boolean seatsTracked, String learner, boolean viaWebhook) {
        note("");
        note("== (g) control: a payment for " + label + " in the same database still enrols"
                + (viaWebhook ? " (gateway webhook path, gateway-shaped log)" : ""));
        String invitedSession = db.queryForObject("SELECT id FROM package_session WHERE package_id = ? AND status = 'INVITED'", String.class, pkg);
        String coursePlanId = db.queryForObject("SELECT id FROM payment_plan WHERE payment_option_id = ?", String.class, optionId);
        sql("the course", "SELECT package_type, status, (SELECT count(*) FROM commerce_product cp WHERE cp.package_id = p.id) AS commerce_rows FROM package p WHERE id = ?", pkg);
        UserPlan learnerPlan = inTransaction(() -> {
            PaymentPlan coursePlan = paymentPlanRepository.findById(coursePlanId).orElseThrow();
            EnrollInvite invite = enrollInviteRepository.findById(inviteId).orElseThrow();
            PaymentOption option = paymentOptionRepository.findById(optionId).orElseThrow();
            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(price);
            payment.setCurrency("INR");
            return userPlanService.createUserPlan(learner, coursePlan, null, invite, option, payment, "PENDING_FOR_PAYMENT");
        });
        db.update("INSERT INTO student_session_institute_group_mapping (id, user_id, package_session_id, destination_package_session_id, "
                        + "institute_id, status, type, user_plan_id, enrolled_date) VALUES (?, ?, ?, ?, ?, 'INVITED', 'PACKAGE_SESSION', ?, now())",
                UUID.randomUUID().toString(), learner, invitedSession, batch, instA, learnerPlan.getId());
        String learnerLog = viaWebhook ? gatewayShapedLog(learner, price, learnerPlan, "order-" + learner)
                : paymentLogService.createPaymentLog(learner, price, "RAZORPAY", "RAZORPAY", "INR", learnerPlan, "order-" + learner);
        reset(workflowTriggerService, paymentNotificatonService, dynamicNotificationService, asyncEnrollmentEmailService, invoiceService);
        authServiceAnswersLocally();
        Integer slotsBefore = db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class, batch);
        if (viaWebhook) {
            paymentLogService.updatePaymentLog("order-" + learner, "PAID", instA);
        } else {
            inTransaction(() -> {
                paymentLogService.updatePaymentLog(learnerLog, "SUCCESS", "PAID", "{\"gateway\":\"proof\"}");
                userPlanService.applyOperationsOnFirstPayment(userPlanRepository.findById(learnerPlan.getId()).orElseThrow());
                return null;
            });
        }
        sql("plan of the learner", "SELECT status, end_date IS NOT NULL AS has_end_date, (end_date::date - start_date::date) AS days FROM user_plan WHERE id = ?", learnerPlan.getId());
        sql("enrolment rows of the learner", "SELECT m.status, m.type, (m.package_session_id = ?) AS on_course_batch, (m.user_plan_id = ?) AS on_paid_plan, m.expiry_date IS NOT NULL AS has_expiry "
                + "FROM student_session_institute_group_mapping m WHERE m.user_id = ? ORDER BY m.created_at", batch, learnerPlan.getId(), learner);
        sql("fee-ledger rows of the learner", "SELECT event_type, amount, currency, source_type FROM user_account_ledger WHERE user_id = ? ORDER BY created_at", learner);
        Integer slotsAfter = db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class, batch);
        note("-- batch available_slots " + slotsBefore + " -> " + slotsAfter + (seatsTracked ? "" : " (this batch has no seat limit)"));
        note("-- calls on the collaborators during the course payment: workflowTriggerService=" + calls(workflowTriggerService)
                + " paymentNotificatonService=" + calls(paymentNotificatonService) + " dynamicNotificationService=" + calls(dynamicNotificationService)
                + " asyncEnrollmentEmailService=" + calls(asyncEnrollmentEmailService) + " invoiceService=" + calls(invoiceService));
        if (viaWebhook) {
            note("-- on the webhook path for a course: workflowTriggerService=" + callNames(workflowTriggerService)
                    + " paymentNotificatonService=" + callNames(paymentNotificatonService) + " invoiceService=" + callNames(invoiceService));
            assertEquals("PAID", db.queryForObject("SELECT payment_status FROM payment_log WHERE id = ?", String.class, learnerLog));
            assertTrue(calls(paymentNotificatonService) > 0, "the payment confirmation mail goes out for a course on the webhook path");
            assertTrue(mockingDetails(invoiceService).getInvocations().stream()
                    .anyMatch(i -> i.getMethod().getName().equals("generateInvoiceWithResult")), "the course invoice is generated");
        }
        assertEquals("ACTIVE", db.queryForObject("SELECT status FROM user_plan WHERE id = ?", String.class, learnerPlan.getId()));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ? AND package_session_id = ? "
                + "AND status = 'ACTIVE' AND user_plan_id = ?", Long.class, learner, batch, learnerPlan.getId()), "the learner is enrolled in the batch on the paid plan");
        assertEquals(2, db.queryForObject("SELECT count(*) FROM user_account_ledger WHERE user_id = ?", Long.class, learner), "accrual and payment in the fee ledger");
        if (seatsTracked) {
            assertEquals(slotsBefore - 1, slotsAfter, "the course seat is taken");
        }
        assertTrue(calls(workflowTriggerService) > 0, "the enrolment workflow trigger fires for a course");
        assertTrue(calls(dynamicNotificationService) + calls(asyncEnrollmentEmailService) > 0, "the enrolment mails go out for a course");
        assertFalse(userPlanRepository.findPaidActivePlansWithoutEnrollment().stream().anyMatch(p -> p.getId().equals(learnerPlan.getId())));
    }

    // ------------------------------------------------ (c) over HTTP

    private String tokenFor(String username) {
        return jwtService.generateToken(STUB_USERS.get(username), STUB_ROLES.get(username), List.of());
    }

    /** One real HTTP request to this application's own port. The token is never written anywhere. */
    private java.net.http.HttpResponse<String> http(String method, String pathAndQuery, String username, String clientId, String jsonBody) {
        try {
            java.net.http.HttpRequest.Builder request = java.net.http.HttpRequest
                    .newBuilder(java.net.URI.create("http://127.0.0.1:" + port + pathAndQuery))
                    .header("Content-Type", "application/json");
            if (username != null) {
                request.header("Authorization", "Bearer " + (username.startsWith("raw:") ? username.substring(4) : tokenFor(username)));
            }
            if (clientId != null) {
                request.header("clientId", clientId);
            }
            request.method(method, jsonBody == null ? java.net.http.HttpRequest.BodyPublishers.noBody()
                    : java.net.http.HttpRequest.BodyPublishers.ofString(jsonBody));
            return java.net.http.HttpClient.newHttpClient().send(request.build(), java.net.http.HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private java.net.http.HttpResponse<String> httpCase(String label, int expected, String method, String pathAndQuery,
                                                        String username, String clientId, String jsonBody) {
        java.net.http.HttpResponse<String> response = http(method, pathAndQuery, username, clientId, jsonBody);
        String body = response.body() == null ? "" : response.body().replaceAll("\\s+", " ");
        String shown = pathAndQuery.replace(instA, "{A}").replace(instB, "{B}").replace(productPkg, "{product}");
        // The product's name, not its id: a refusal echoes the request URL, which may hold the id.
        boolean productData = body.contains("Khadi Kurta " + run);
        note("   " + response.statusCode() + " " + method + " " + shown + " | " + label + " | productDataInBody=" + productData
                + " | " + (response.statusCode() == 200 ? "(" + body.length() + " chars)" : body.substring(0, Math.min(body.length(), 160))));
        if (expected == 401) {
            assertTrue(response.statusCode() == 401 || response.statusCode() == 403, label + ": " + response.statusCode());
        } else {
            assertEquals(expected, response.statusCode(), label + ": " + body);
        }
        if (expected != 200) {
            assertFalse(productData, label + ": a refused request must not carry the product");
        }
        return response;
    }

    @Test
    @Order(50)
    void c_overHttp_aRealTokenIsScopedToTheInstituteOfTheClientIdHeader() {
        note("");
        note("== (c) over HTTP: the embedded server, the real security filter chain (JwtAuthFilter), signed tokens,");
        note("   UserDetailsServiceImpl calling the auth_service user lookup (answered by the stand-in in this JVM)");
        String base = "/admin-core-service/commerce/v1";
        String a = "admin-a-" + run;
        String b = "admin-b-" + run;
        String student = "student-a-" + run;
        String manager = "manager-a-" + run;
        String both = "both-" + run;
        String small = ps("KK-S-" + run);
        Map<String, Object> productBefore = db.queryForMap("SELECT status, slug, brand, updated_at FROM commerce_product WHERE package_id = ?", productPkg);
        Double priceBefore = db.queryForObject("SELECT pp.actual_price FROM payment_plan pp WHERE pp.id = ?", Double.class,
                variantBySku.get("KK-S-" + run).getPaymentPlanId());
        STUB_LOOKUPS.clear();

        String listA = base + "/products?instituteId=" + instA;
        assertTrue(httpCase("A's admin, clientId A", 200, "GET", listA, a, instA, null).body().contains("Khadi Kurta " + run),
                "A's admin sees the product over HTTP");
        httpCase("THE ATTACK: B's admin token, clientId A, instituteId A", 403, "GET", listA, b, instA, null);
        httpCase("B's admin token, clientId B, instituteId A", 403, "GET", listA, b, instB, null);
        httpCase("B's admin token, no clientId header, instituteId A", 403, "GET", listA, b, null, null);
        assertFalse(httpCase("B's admin in B", 200, "GET", base + "/products?instituteId=" + instB, b, instB, null).body().contains("Khadi Kurta " + run));
        httpCase("B's admin token, clientId A: read the product", 403, "GET", base + "/products/" + productPkg + "?instituteId=" + instA, b, instA, null);
        httpCase("B's admin token, clientId A: archive the product", 403, "POST",
                base + "/products/" + productPkg + "/status?instituteId=" + instA, b, instA, "{\"status\":\"ARCHIVED\"}");
        httpCase("B's admin token, clientId A: reprice a variant", 403, "PUT",
                base + "/variants/" + small + "?instituteId=" + instA, b, instA, "{\"price\":1}");
        httpCase("B's admin token, clientId B, B's institute, A's product id", 404, "GET",
                base + "/products/" + productPkg + "?instituteId=" + instB, b, instB, null);
        httpCase("no token", 401, "GET", listA, null, instA, null);
        httpCase("a token this service did not sign", 401, "GET", listA, "raw:eyJhbGciOiJIUzI1NiJ9.e30.not-a-signature", instA, null);
        httpCase("a learner of A (STUDENT)", 403, "GET", listA, student, instA, null);
        httpCase("learner in A who is ADMIN in B, clientId A", 403, "GET", listA, both, instA, null);
        httpCase("the same person in B", 200, "GET", base + "/products?instituteId=" + instB, both, instB, null);
        httpCase("A's store manager (commerce role only)", 200, "GET", listA, manager, instA, null);

        note("   -- the other commerce controllers: A's admin, then B's admin token with clientId A");
        for (String path : List.of(base + "/attributes?instituteId=" + instA, base + "/collections?instituteId=" + instA,
                base + "/collections/tree?instituteId=" + instA, base + "/variants?instituteId=" + instA + "&packageId=" + productPkg,
                base + "/media?instituteId=" + instA + "&packageId=" + productPkg, base + "/staff/pin?instituteId=" + instA,
                base + "/staff/locations?instituteId=" + instA + "&userId=cashier-" + run)) {
            httpCase("A's admin", 200, "GET", path, a, instA, null);
            httpCase("B's admin token, clientId A", 403, "GET", path, b, instA, null);
        }

        List<String> lookups = new ArrayList<>(STUB_LOOKUPS);
        note("   -- what the auth_service stand-in answered (institute@user -> authorities):");
        lookups.stream().map(l -> l.replace(instA, "{A}").replace(instB, "{B}")).distinct().forEach(l -> note("      " + l));
        assertTrue(lookups.contains(instA + "@" + b + " -> authorities []"),
                "B's admin under clientId A resolves to no authority: " + lookups);
        assertTrue(lookups.contains(instA + "@" + a + " -> authorities [ADMIN]"), lookups.toString());
        assertTrue(lookups.contains(instA + "@" + both + " -> authorities [STUDENT]"), lookups.toString());

        assertEquals(productBefore, db.queryForMap("SELECT status, slug, brand, updated_at FROM commerce_product WHERE package_id = ?", productPkg),
                "nothing B sent changed the product");
        assertEquals(priceBefore, db.queryForObject("SELECT pp.actual_price FROM payment_plan pp WHERE pp.id = ?", Double.class,
                variantBySku.get("KK-S-" + run).getPaymentPlanId()));
        requestFrom(instA);
    }

    // ------------------------------------- (g) webhook path, gateway-shaped logs

    @Test
    @Order(55)
    void g_webhookPathWithGatewayShapedLogs_measuredForAShopOrderAndACourse() {
        note("");
        note("== (g) the gateway webhook path with payment logs shaped as the Razorpay flow stores them");
        requestFrom(instA);
        String buyer = "buyer-" + run;
        VariantResponse medium = variantBySku.get("KK-M-" + run);
        List<StockHold> hold = stockHoldService.hold(instA, Map.of(medium.getPackageSessionId(), 1), StockHoldKind.PURCHASE);
        slotsAre("hold of 1 Medium (order 4)", 8, 8, 0);
        UserPlan plan4 = commercePlan(buyer, medium, 1);
        String log4 = gatewayShapedLog(buyer, 1400.0, plan4, "order-4-" + run);
        stockHoldService.attach(hold, buyer, plan4.getId(), log4);
        sql("the stored gateway data of order 4 (keys only)",
                "SELECT jsonb_exists(payment_specific_data::jsonb, 'response') AS has_response, jsonb_exists(payment_specific_data::jsonb, 'originalRequest') AS has_request, "
                        + "payment_specific_data::jsonb -> 'originalRequest' ->> 'order_id' AS order_id FROM payment_log WHERE id = ?", log4);
        reset(workflowTriggerService, paymentNotificatonService, dynamicNotificationService, asyncEnrollmentEmailService, invoiceService);
        authServiceAnswersLocally();

        paymentLogService.updatePaymentLog("order-4-" + run, "PAID", instA);

        assertEquals("PAID", db.queryForObject("SELECT payment_status FROM payment_log WHERE id = ?", String.class, log4));
        assertEquals("ACTIVE", db.queryForObject("SELECT status FROM user_plan WHERE id = ?", String.class, plan4.getId()));
        assertEquals("SOLD", db.queryForObject("SELECT status FROM stock_hold WHERE user_plan_id = ?", String.class, plan4.getId()));
        slotsAre("payment of order 4 through the webhook path", 8, 8, 0);
        assertEquals(0, count("enrolment rows of the buyer after order 4", "SELECT count(*) FROM student_session_institute_group_mapping WHERE user_id = ?", buyer));
        assertEquals(0, count("fee-ledger rows of the buyer after order 4", "SELECT count(*) FROM user_account_ledger WHERE user_id = ?", buyer));
        assertFalse(userPlanRepository.findPaidActivePlansWithoutEnrollment().stream().anyMatch(p -> p.getId().equals(plan4.getId())));
        // Recorded, not asserted: the commerce branch of this path is WP-12.
        note("-- OBSERVED for a shop order on the webhook path (open until WP-12): workflowTriggerService=" + callNames(workflowTriggerService)
                + " " + mockingDetails(workflowTriggerService).getInvocations().stream().map(i -> String.valueOf(i.getArguments()[0])).toList()
                + " invoiceService=" + callNames(invoiceService)
                + " paymentNotificatonService=" + callNames(paymentNotificatonService)
                + " dynamicNotificationService=" + calls(dynamicNotificationService)
                + " asyncEnrollmentEmailService=" + calls(asyncEnrollmentEmailService));

        coursePaymentStillEnrols("an ordinary course", coursePkg, courseBatch, courseInvite, courseOption, 500.0, true,
                "learner-w-" + run, true);
        slotsAre("the course payment on the webhook path (variants untouched)", 8, 8, 0);
    }

    // ------------------------- legacy enrol flow, approval, the 04:30 job, stale edit

    @Test
    @Order(60)
    void u_legacyEnrolRefusesAVariant_approvalReadsTheRole_theJobRuns_aStaleEditCannotOverwriteStock() {
        note("");
        note("== legacy enrol flow against a published variant");
        requestFrom(instA);
        VariantResponse small = variantBySku.get("KK-S-" + run);
        sql("the variant's invite as a learner link would find it",
                "SELECT status, tag, (invite_code IS NOT NULL AND invite_code <> '') AS has_code FROM enroll_invite WHERE id = ?", small.getEnrollInviteId());
        long plansBefore = db.queryForObject("SELECT count(*) FROM user_plan", Long.class);
        long enrolmentsBefore = db.queryForObject("SELECT count(*) FROM student_session_institute_group_mapping", Long.class);
        long authCallsBefore = calls(authService);

        Supplier<vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO> request = () -> {
            vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO enrol = new vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO();
            enrol.setInstituteId(instA);
            UserDTO walkIn = new UserDTO();
            walkIn.setEmail("walk-in-" + run + "@example.invalid");
            walkIn.setFullName("Walk In");
            enrol.setUser(walkIn);
            enrol.setLearnerPackageSessionEnroll(new vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO());
            return enrol;
        };
        vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO onVariantInvite = request.get();
        onVariantInvite.getLearnerPackageSessionEnroll().setEnrollInviteId(small.getEnrollInviteId());
        onVariantInvite.getLearnerPackageSessionEnroll().setPackageSessionIds(List.of(small.getPackageSessionId()));
        onVariantInvite.getLearnerPackageSessionEnroll().setPaymentOptionId(small.getPaymentOptionId());
        onVariantInvite.getLearnerPackageSessionEnroll().setPlanId(small.getPaymentPlanId());
        refused400("learner enrol through the variant's own invite", () -> learnerEnrollRequestService.recordLearnerRequest(onVariantInvite));

        vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO variantOnCourseInvite = request.get();
        variantOnCourseInvite.getLearnerPackageSessionEnroll().setEnrollInviteId(typedInvite);
        variantOnCourseInvite.getLearnerPackageSessionEnroll().setPackageSessionIds(List.of(small.getPackageSessionId()));
        refused400("learner enrol in a variant session through a course invite", () -> learnerEnrollRequestService.recordLearnerRequest(variantOnCourseInvite));

        vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitDTO form =
                new vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitDTO();
        form.setEnrollInviteId(small.getEnrollInviteId());
        form.setInstituteId(instA);
        refused400("enrolment form (step 1) on the variant's invite", () -> enrollmentFormService.submitEnrollmentForm(form));

        refused400("admin direct enrol on the variant's invite", () -> adminDirectEnrollService.adminEnrollLearner(onVariantInvite, adminA));
        refused400("admin direct enrol in a variant session through a course invite",
                () -> adminDirectEnrollService.adminEnrollLearner(variantOnCourseInvite, adminA));

        assertEquals(plansBefore, db.queryForObject("SELECT count(*) FROM user_plan", Long.class), "no plan written");
        assertEquals(enrolmentsBefore, db.queryForObject("SELECT count(*) FROM student_session_institute_group_mapping", Long.class), "no enrolment row written");
        assertEquals(0, calls(authService) - authCallsBefore, "no user was created in auth_service for the refused requests");
        note("   after the five refusals: user_plan rows " + plansBefore + " (unchanged), enrolment rows " + enrolmentsBefore
                + " (unchanged), calls to auth_service 0");

        // Control: the same entry with a course invite is not stopped by the commerce check.
        vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO onCourse = request.get();
        onCourse.getLearnerPackageSessionEnroll().setEnrollInviteId(typedInvite);
        onCourse.getLearnerPackageSessionEnroll().setPackageSessionIds(List.of(typedBatch));
        String courseOutcome;
        try {
            legacy(() -> learnerEnrollRequestService.recordLearnerRequest(onCourse));
            courseOutcome = "completed";
        } catch (RuntimeException e) {
            courseOutcome = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()).replaceAll("\\s+", " ");
        }
        note("   control, the same entry with the PRODUCT-typed course's invite and batch: " + courseOutcome
                + " | calls to auth_service " + (calls(authService) - authCallsBefore));
        assertFalse(courseOutcome.contains("shop product"), courseOutcome);
        assertTrue(calls(authService) - authCallsBefore > 0, "the course request got past the commerce check and reached user creation");

        note("");
        note("== CommerceApprovalService.approve: the approver's role is read from auth_service on every call");
        String managerId = "manager-a-" + run;
        String cashier = "cashier-" + run;
        String location = "loc-approve-" + run;
        staffService.setOwnPin(instA, managerId, "739104");
        staffService.setLocations(instA, adminA.getUserId(), managerId, List.of(location));
        java.util.function.BiFunction<String, String, Object> approve = (loc, pin) -> inTransaction(() -> approvalService.approve(
                instA, loc, cashier, managerId, pin, "PRICE_OVERRIDE", "ORDER", "ref-" + run, new BigDecimal("150.00"), "damaged box").getId());
        when(authService.getInstituteRoles(org.mockito.ArgumentMatchers.eq(instA), org.mockito.ArgumentMatchers.anyList()))
                .thenReturn(Map.of(managerId, List.of("COMMERCE_STORE_MANAGER")));
        Object approvalId = approve.apply(location, "739104");
        sql("the approval row", "SELECT action, reference_type, requested_by = ? AS by_cashier, approved_by = ? AS by_manager, amount, reason "
                + "FROM commerce_approval WHERE id = ?", cashier, managerId, approvalId);
        assertEquals(1, db.queryForObject("SELECT count(*) FROM commerce_approval WHERE institute_id = ?", Long.class, instA));
        assertThrows(CommerceAccessDeniedException.class, () -> approve.apply("loc-other-" + run, "739104"), "a manager of another location");
        assertThrows(CommerceAccessDeniedException.class, () -> approve.apply(location, "111222"), "a wrong PIN");
        when(authService.getInstituteRoles(org.mockito.ArgumentMatchers.eq(instA), org.mockito.ArgumentMatchers.anyList()))
                .thenReturn(Map.of(managerId, List.of("STUDENT")));
        CommerceAccessDeniedException demoted = assertThrows(CommerceAccessDeniedException.class, () -> approve.apply(location, "739104"));
        when(authService.getInstituteRoles(org.mockito.ArgumentMatchers.eq(instA), org.mockito.ArgumentMatchers.anyList())).thenReturn(Map.of());
        assertThrows(CommerceAccessDeniedException.class, () -> approve.apply(location, "739104"), "a failed role lookup");
        assertThrows(org.springframework.transaction.IllegalTransactionStateException.class, () -> approvalService.approve(
                instA, location, cashier, managerId, "739104", "PRICE_OVERRIDE", "ORDER", "ref-" + run, BigDecimal.ONE, "x"),
                "an approval outside the action's transaction");
        note("-- right PIN after the role was taken away: " + demoted.getMessage()
                + " | other location, wrong PIN, failed lookup: refused | outside a transaction: IllegalTransactionStateException");
        assertEquals(1, count("approval rows of A after the refused attempts", "SELECT count(*) FROM commerce_approval WHERE institute_id = ?", instA));

        note("");
        note("== the 04:30 job itself (PackageSessionScheduler.reportPaidPlansWithoutEnrollment), run once by hand");
        ch.qos.logback.classic.Logger jobLogger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
                vacademy.io.admin_core_service.features.enrollment_policy.scheduler.PackageSessionScheduler.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> captured = new ch.qos.logback.core.read.ListAppender<>();
        captured.start();
        jobLogger.addAppender(captured);
        try {
            packageSessionScheduler.reportPaidPlansWithoutEnrollment();
        } finally {
            jobLogger.detachAppender(captured);
        }
        List<String> jobLines = captured.list.stream().map(e -> e.getLevel() + " " + e.getFormattedMessage()).toList();
        long paidShopPlans = count("PAID ACTIVE commerce plans of the buyer with no enrolment row (what the job must not report)",
                "SELECT count(*) FROM user_plan up WHERE up.user_id = ? AND up.status = 'ACTIVE' AND EXISTS "
                        + "(SELECT 1 FROM payment_log pl WHERE pl.user_plan_id = up.id AND pl.payment_status = 'PAID')", "buyer-" + run);
        jobLines.forEach(line -> note("   job log: " + (line.length() > 300 ? line.substring(0, 300) + "..." : line)));
        assertEquals(3, paidShopPlans);
        assertEquals(1, jobLines.size(), "the job writes one line");
        assertFalse(jobLines.get(0).contains("buyer-" + run), "the job must not report the shop buyer");
        assertFalse(jobLines.get(0).contains("Integrity check failed"), jobLines.get(0));

        note("");
        note("== a product edit that overlaps a checkout hold");
        String mediumSession = ps("KK-M-" + run);
        Map<String, Object> rowBefore = db.queryForMap("SELECT name, available_slots, version FROM package_session WHERE id = ?", mediumSession);
        RuntimeException stale = assertThrows(RuntimeException.class, () -> inTransaction(() -> {
            vacademy.io.common.institute.entity.session.PackageSession row = packageSessionRepository.findById(mediumSession).orElseThrow();
            // A checkout hold commits on another connection while the editor still holds the row it read.
            java.util.concurrent.CompletableFuture.runAsync(
                    () -> stockHoldService.hold(instA, Map.of(mediumSession, 1), StockHoldKind.PURCHASE)).join();
            row.setName(row.getName() + " (edited)");
            packageSessionRepository.saveAndFlush(row);
            return null;
        }));
        Map<String, Object> rowAfter = db.queryForMap("SELECT name, available_slots, version FROM package_session WHERE id = ?", mediumSession);
        note("-- row before: " + rowBefore + " | the stale save: " + stale.getClass().getSimpleName() + " | row after: " + rowAfter);
        assertTrue(stale.getClass().getSimpleName().contains("OptimisticLock"), stale.toString());
        assertEquals(rowBefore.get("name"), rowAfter.get("name"), "the stale edit wrote nothing");
        assertEquals(((Number) rowBefore.get("available_slots")).intValue() - 1, ((Number) rowAfter.get("available_slots")).intValue(),
                "the hold's stock change survived");
        slotsAre("the overlapping edit (the hold of 1 Medium stands)", 8, 7, 0);

        note("");
        note("== unique keys and CHECK constraints of the commerce tables, tried directly");
        String copyVariant = "INSERT INTO commerce_variant SELECT (jsonb_populate_record(NULL::commerce_variant, to_jsonb(cv) || "
                + "jsonb_build_object('id', ?::text, 'package_session_id', ?::text, 'sku', ?::text, 'label_code', NULL, 'barcode', NULL))).* "
                + "FROM commerce_variant cv WHERE cv.package_session_id = ?";
        String smallSession = small.getPackageSessionId();
        Map<String, Runnable> violations = new LinkedHashMap<>();
        violations.put("a second variant with the same SKU in the institute (uq_commerce_variant_sku)",
                () -> db.update(copyVariant, UUID.randomUUID().toString(), UUID.randomUUID().toString(), "KK-S-" + run, smallSession));
        violations.put("a second commerce_variant row for one package_session (uq_commerce_variant_package_session)",
                () -> db.update(copyVariant, UUID.randomUUID().toString(), smallSession, "OTHER-" + run, smallSession));
        violations.put("a second product with the same slug in the institute (uq_commerce_product_slug)",
                () -> db.update("INSERT INTO commerce_product SELECT (jsonb_populate_record(NULL::commerce_product, to_jsonb(cp) || "
                        + "jsonb_build_object('id', ?::text, 'package_id', ?::text, 'external_ref', NULL))).* FROM commerce_product cp WHERE cp.package_id = ?",
                        UUID.randomUUID().toString(), UUID.randomUUID().toString(), productPkg));
        violations.put("a second commerce_product row for one package (uq_commerce_product_package)",
                () -> db.update("INSERT INTO commerce_product SELECT (jsonb_populate_record(NULL::commerce_product, to_jsonb(cp) || "
                        + "jsonb_build_object('id', ?::text, 'slug', ?::text, 'external_ref', NULL))).* FROM commerce_product cp WHERE cp.package_id = ?",
                        UUID.randomUUID().toString(), "other-" + run, productPkg));
        violations.put("a variant status outside the list (ck_commerce_variant_status)",
                () -> db.update("UPDATE commerce_variant SET status = 'NONSENSE' WHERE package_session_id = ?", smallSession));
        violations.put("a product stock mode outside the list (ck_commerce_product_stock_mode)",
                () -> db.update("UPDATE commerce_product SET stock_mode = 'NONSENSE' WHERE package_id = ?", productPkg));
        violations.put("a variant without a SKU (NOT NULL)",
                () -> db.update("UPDATE commerce_variant SET sku = NULL WHERE package_session_id = ?", smallSession));
        for (Map.Entry<String, Runnable> violation : violations.entrySet()) {
            org.springframework.dao.DataIntegrityViolationException refused = assertThrows(
                    org.springframework.dao.DataIntegrityViolationException.class, () -> violation.getValue().run(), violation.getKey());
            String message = String.valueOf(refused.getMostSpecificCause().getMessage()).replaceAll("\\s+", " ");
            note("   refused by the database: " + violation.getKey() + " -> " + message.substring(0, Math.min(message.length(), 150)));
            String constraint = violation.getKey().contains("(NOT NULL)") ? "sku"
                    : violation.getKey().substring(violation.getKey().indexOf('(') + 1, violation.getKey().indexOf(')'));
            assertTrue(message.contains(constraint), violation.getKey() + ": " + message);
        }
        assertEquals(3, db.queryForObject("SELECT count(*) FROM commerce_variant WHERE package_id = ?", Long.class, productPkg));
    }

    // ------------------------------------- money and report readers (d)

    /**
     * Every legacy query that was given a commerce exclusion, run once on real tables. By now the
     * database holds three PAID commerce plans of the buyer (2 x Small, 1 x Medium, 1 x Medium =
     * 5200.00) and three PAID course plans (500.00, 300.00, 500.00 = 1300.00). The buyer and the
     * three course learners are all CONVERTED leads of one counsellor, so every report that
     * counts lead money would show 6500.00 without the exclusion. A reader that returns money or
     * plans must show the course rows and none of the buyer's.
     */
    @Test
    @Order(80)
    void d_moneyAndReportReadersRunAndLeaveCommerceOut() {
        note("");
        note("== (d) money and report readers that carry the commerce exclusion");
        requestFrom(instA);
        String buyer = "buyer-" + run;
        String learner = "learner-g-" + run;
        String counsellor = "counsellor-" + run;
        for (String lead : List.of(buyer, learner, "learner-t-" + run, "learner-w-" + run)) {
            db.update("INSERT INTO user_lead_profile (user_id, institute_id, conversion_status, best_source_type, assigned_counselor_id, "
                    + "assigned_counselor_name, converted_at) VALUES (?, ?, 'CONVERTED', 'WEBSITE', ?, 'Proof Counsellor', now())", lead, instA, counsellor);
        }
        assertEquals(6500.0, db.queryForObject("SELECT sum(pl.payment_amount) FROM payment_log pl JOIN user_lead_profile ulp "
                + "ON ulp.user_id = pl.user_id AND ulp.institute_id = ? WHERE pl.payment_status = 'PAID' AND ulp.conversion_status = 'CONVERTED'",
                Double.class, instA), 0.001, "control: PAID money of the four converted leads, shop and course together");
        note("-- control: PAID money of the four converted leads with no exclusion = 6500.0 (1300.0 course + 5200.0 shop)");
        List<String> buyerPlans = db.queryForList("SELECT id FROM user_plan WHERE user_id = ?", String.class, buyer);
        List<String> buyerLogs = db.queryForList("SELECT id FROM payment_log WHERE user_id = ?", String.class, buyer);
        String learnerPlan = db.queryForObject("SELECT id FROM user_plan WHERE user_id = ?", String.class, learner);
        sql("paid money in the database, by kind",
                "SELECT CASE WHEN EXISTS (SELECT 1 FROM package_session_learner_invitation_to_payment_option l JOIN commerce_variant cv "
                        + "ON cv.package_session_id = l.package_session_id WHERE l.enroll_invite_id = up.enroll_invite_id) THEN 'commerce' ELSE 'course' END AS kind, "
                        + "count(*) AS paid_logs, sum(pl.payment_amount) AS amount FROM payment_log pl JOIN user_plan up ON up.id = pl.user_plan_id "
                        + "JOIN enroll_invite ei ON ei.id = up.enroll_invite_id WHERE ei.institute_id = ? AND pl.payment_status = 'PAID' GROUP BY 1 ORDER BY 1", instA);
        java.time.LocalDateTime from = java.time.LocalDateTime.now().minusDays(2);
        java.time.LocalDateTime to = java.time.LocalDateTime.now().plusDays(2);
        java.sql.Timestamp fromTs = java.sql.Timestamp.valueOf(from);
        java.sql.Timestamp toTs = java.sql.Timestamp.valueOf(to);
        String day0 = java.time.LocalDate.now().minusDays(2).toString();
        String day1 = java.time.LocalDate.now().plusDays(1).toString();

        Map<String, Supplier<Object>> readers = new LinkedHashMap<>();
        readers.put("UserPlanRepository.findAllByUserIdInAndInstituteIdAndStatusIn",
                () -> userPlanRepository.findAllByUserIdInAndInstituteIdAndStatusIn(List.of(buyer, learner), instA,
                        List.of("ACTIVE", "PENDING_FOR_PAYMENT")).stream().map(UserPlan::getId).toList());
        readers.put("UserPlanRepository.findAllByStatusInAndInstituteIdIn",
                () -> userPlanRepository.findAllByStatusInAndInstituteIdIn(List.of("ACTIVE", "PENDING_FOR_PAYMENT"), List.of(instA))
                        .stream().map(UserPlan::getId).toList());
        readers.put("UserPlanRepository.findPaidActivePlansWithoutEnrollment",
                () -> userPlanRepository.findPaidActivePlansWithoutEnrollment().stream().map(UserPlan::getId).toList());
        readers.put("membership list: UserPlanService.getMembershipDetails", () -> {
            vacademy.io.admin_core_service.features.user_subscription.dto.MembershipFilterDTO filter =
                    new vacademy.io.admin_core_service.features.user_subscription.dto.MembershipFilterDTO();
            filter.setInstituteId(instA);
            return userPlanService.getMembershipDetails(filter, 0, 50);
        });
        readers.put("admin Payments list: PaymentLogService.getPaymentLogsForInstitute",
                () -> paymentLogService.getPaymentLogsForInstitute(vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogFilterRequestDTO
                        .builder().instituteId(instA).startDateInUtc(from).endDateInUtc(to).build(), 0, 50));
        readers.put("admin Payments summary: PaymentLogService.getPaymentLogSummary",
                () -> paymentLogService.getPaymentLogSummary(vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogFilterRequestDTO
                        .builder().instituteId(instA).startDateInUtc(from).endDateInUtc(to).build()));
        readers.put("billing summary: PaymentLogService.getBillingSummary",
                () -> paymentLogService.getBillingSummary(vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryRequestDTO
                        .builder().instituteId(instA).startDateInUtc(from).endDateInUtc(to).build()));
        readers.put("payment dashboard: PaymentDashboardRepository.collectedBreakdown",
                () -> paymentDashboardRepository.collectedBreakdown(instA, from, to, true, List.of("-")).stream()
                        .map(this::dump).toList());
        readers.put("CRM revenue: RevenueReportService.getRevenue",
                () -> revenueReportService.getRevenue(instA, day0, day1, null, null, adminA.getUserId()));
        readers.put("CRM revenue payments: RevenueReportService.getRevenuePayments",
                () -> invokeRevenuePayments(day0, day1));
        readers.put("CRM cohorts: RevenueReportService.getCohortAnalysis",
                () -> revenueReportService.getCohortAnalysis(instA, day0, day1, null, null, adminA.getUserId()));
        readers.put("HR incentive revenue: CrmIncentiveRevenueRepository.findCounsellorRevenue",
                () -> crmIncentiveRevenueRepository.findCounsellorRevenue(instA, fromTs, toTs, null).stream().map(this::dump).toList());
        readers.put("abandoned carts: StudentSessionInstituteGroupMappingRepository.findAbandonedCartPlans",
                () -> studentSessionInstituteGroupMappingRepository.findAbandonedCartPlans(instA, List.of("ACTIVE", "INVITED"), 0, 30)
                        .stream().map(java.util.Arrays::toString).toList());
        readers.put("EnrollInviteRepository.findLatestActiveInviteForLearner (buyer)",
                () -> enrollInviteRepository.findLatestActiveInviteForLearner(buyer, instA).map(EnrollInvite::getId).orElse("none"));
        readers.put("LeadMergeDao.hasPlan (buyer)", () -> leadMergeDao.hasPlan(instA, buyer));
        readers.put("AdmissionCourseDao.personHasCourse (buyer)", () -> admissionCourseDao.personHasCourse(instA, buyer));

        List<String> failed = new ArrayList<>();
        for (Map.Entry<String, Supplier<Object>> reader : readers.entrySet()) {
            String out;
            try {
                out = inTransaction(() -> dump(reader.getValue().get()));
            } catch (RuntimeException e) {
                Throwable root = e;
                while (root.getCause() != null) {
                    root = root.getCause();
                }
                note("   FAILED " + reader.getKey() + ": " + root.getClass().getSimpleName() + ": "
                        + String.valueOf(root.getMessage()).replaceAll("\\s+", " "));
                failed.add(reader.getKey());
                continue;
            }
            long commerceIds = java.util.stream.Stream.concat(buyerPlans.stream(), buyerLogs.stream()).filter(out::contains).count();
            boolean buyerSeen = out.contains(buyer);
            note("   ran " + reader.getKey() + ": commercePlanOrLogIds=" + commerceIds + " buyerSeen=" + buyerSeen
                    + " coursePlanSeen=" + out.contains(learnerPlan) + " -> " + (out.length() > 260 ? out.substring(0, 260) + "..." : out));
            assertEquals(0, commerceIds, reader.getKey() + " shows a commerce plan or payment");
            assertFalse(buyerSeen, reader.getKey() + " shows the buyer");
        }
        assertTrue(failed.isEmpty(), "readers that failed to run: " + failed);

        // The figures, not only the ids: 800.00 of course money, never the 3800.00 of shop money.
        var billing = paymentLogService.getBillingSummary(vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryRequestDTO
                .builder().instituteId(instA).startDateInUtc(from).endDateInUtc(to).build());
        var summary = paymentLogService.getPaymentLogSummary(vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogFilterRequestDTO
                .builder().instituteId(instA).startDateInUtc(from).endDateInUtc(to).build());
        note("-- billing summary: collected=" + billing.getCollected() + " totalBilled=" + billing.getTotalBilled()
                + " livePlanCount=" + billing.getLivePlanCount() + " planCount=" + billing.getPlanCount());
        note("-- payments summary: totalAmount=" + summary.getTotalAmount() + " planNames=" + summary.getPaymentPlanNames());
        double collectedByDay = paymentLogRepository.getCollectionSummary(instA, "-", true, from, to, "UTC").stream()
                .mapToDouble(row -> ((Number) row.getAmount()).doubleValue()).sum();
        note("-- collection by day (PaymentLogRepository.getCollectionSummary), summed: " + collectedByDay);
        assertEquals(1300.0, collectedByDay, 0.001, "collection by day must not hold shop money");
        assertEquals(1300.0, billing.getCollected(), 0.001, "billing summary 'collected' must not hold shop money");
        assertEquals(3L, billing.getLivePlanCount(), "live plans are the three course plans");
        assertEquals(1300.0, summary.getTotalAmount(), 0.001);
        // Control for the plan filter: the same list with no exclusion holds the variant plans.
        List<String> allPlanNames = db.queryForList("SELECT DISTINCT pp.name FROM payment_log pl JOIN user_plan up ON up.id = pl.user_plan_id "
                + "JOIN payment_plan pp ON pp.id = up.plan_id JOIN enroll_invite ei ON ei.id = up.enroll_invite_id "
                + "WHERE ei.institute_id = ? AND pp.name IS NOT NULL", String.class, instA);
        long variantNames = allPlanNames.stream().filter(name -> name.contains("Khadi Kurta")).count();
        note("-- control: plan names of the institute's payment logs with no exclusion: " + allPlanNames.size()
                + ", of which variant plans: " + variantNames + " " + allPlanNames);
        assertTrue(variantNames >= 2, "without the exclusion the filter would list variant plans: " + allPlanNames);
        assertTrue(summary.getPaymentPlanNames().stream().noneMatch(name -> name.contains("Khadi Kurta")),
                "the plan filter of the Payments screen must not list variant plans: " + summary.getPaymentPlanNames());
        assertEquals(false, leadMergeDao.hasPlan(instA, buyer));
        assertEquals(true, leadMergeDao.hasPlan(instA, learner), "a course plan still counts");

        // ---- the readers that need a lead, a counsellor or a student row to show anything
        note("-- lead-money readers: each must show 1300.0 and never 6500.0 or 5200.0");
        Map<String, String> leadMoney = new LinkedHashMap<>();
        leadMoney.put("RevenueReportService.getRevenue", dump(revenueReportService.getRevenue(instA, day0, day1, null, null, adminA.getUserId())));
        leadMoney.put("RevenueReportService.getRevenuePayments", dump(invokeRevenuePayments(day0, day1)));
        leadMoney.put("RevenueReportService.getCohortAnalysis", dump(revenueReportService.getCohortAnalysis(instA, day0, day1, null, null, adminA.getUserId())));
        leadMoney.put("PipelineReportService.getSourcePerformance", dump(pipelineReportService.getSourcePerformance(instA, day0, day1, null, null, null, adminA.getUserId())));
        org.springframework.beans.BeanWrapperImpl custom = new org.springframework.beans.BeanWrapperImpl(
                new vacademy.io.admin_core_service.features.audience.dto.reports.custom.CustomReportRequest());
        custom.setPropertyValue("instituteId", instA);
        custom.setPropertyValue("fromDate", day0);
        custom.setPropertyValue("toDate", day1);
        custom.setPropertyValue("dimensions", List.of("source_type"));
        custom.setPropertyValue("measures", List.of("leads", "revenue"));
        leadMoney.put("CustomReportService.run", dump(customReportService.run(
                (vacademy.io.admin_core_service.features.audience.dto.reports.custom.CustomReportRequest) custom.getWrappedInstance(), adminA.getUserId())));
        for (Map.Entry<String, String> reader : leadMoney.entrySet()) {
            String out = reader.getValue();
            note("   " + reader.getKey() + ": has1300=" + out.contains("1300") + " has6500=" + out.contains("6500") + " has5200=" + out.contains("5200")
                    + " buyerSeen=" + out.contains(buyer) + " -> " + (out.length() > 300 ? out.substring(0, 300) + "..." : out));
            assertTrue(out.contains("1300"), reader.getKey() + " lost the course money: " + out);
            assertFalse(out.contains("6500") || out.contains("5200"), reader.getKey() + " shows shop money: " + out);
            assertFalse(out.contains(buyer), reader.getKey() + " shows the buyer");
        }
        String forecast = dump(revenueReportService.getForecast(instA, null, null, adminA.getUserId()));
        note("   RevenueReportService.getForecast (ran; a projection, no fixed figure to assert): "
                + (forecast.length() > 200 ? forecast.substring(0, 200) + "..." : forecast));
        List<String> byCounsellor = crmIncentiveRevenueRepository.findCounsellorRevenue(instA, fromTs, toTs, null).stream()
                .map(r -> r.getCounsellorId() + ":" + r.getRevenue().doubleValue() + ":" + r.getPayingLeads() + ":" + r.getPayments()).toList();
        note("   CrmIncentiveRevenueRepository.findCounsellorRevenue (counsellor:revenue:payingLeads:payments): " + byCounsellor);
        assertEquals(List.of(counsellor + ":1300.0:3:3"), byCounsellor);

        // Engagement daily report, influenced revenue: the buyer and a course learner were both messaged yesterday.
        String engine = "engine-" + run;
        for (String member : List.of(buyer, learner)) {
            String memberId = UUID.randomUUID().toString();
            db.update("INSERT INTO engagement_member (id, engine_id, institute_id, user_id, next_action_at) VALUES (?, ?, ?, ?, now())",
                    memberId, engine, instA, member);
            db.update("INSERT INTO engagement_action (id, engine_id, member_id, institute_id, kind, status, dispatched_at) "
                    + "VALUES (?, ?, ?, ?, 'MESSAGE', 'SENT', now() - interval '1 day')", UUID.randomUUID().toString(), engine, memberId, instA);
        }
        String influenced;
        try {
            Object dao = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(applicationContext.getBean(
                    Class.forName("vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao")));
            java.lang.reflect.Method influencedPayments = dao.getClass().getDeclaredMethod("influencedPayments",
                    org.springframework.jdbc.core.namedparam.MapSqlParameterSource.class);
            influencedPayments.setAccessible(true);
            influenced = String.valueOf(influencedPayments.invoke(dao, new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
                    .addValue("instituteId", instA).addValue("engineIds", List.of(engine)).addValue("from", fromTs).addValue("to", toTs)));
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e.getCause() != null ? e.getCause() : e);
        }
        note("   EngagementDailyReportDao.influencedPayments (EngagementDailyReportSql.INFLUENCED_REVENUE): learnerSeen=" + influenced.contains(learner)
                + " buyerSeen=" + influenced.contains(buyer) + " -> " + influenced);
        assertTrue(influenced.contains(learner), "the course learner's payment is influenced revenue");
        assertFalse(influenced.contains(buyer), "the shop buyer's payments are not");

        // "Latest invite of a learner" and "has a course": each with its control.
        assertEquals("none", enrollInviteRepository.findLatestActiveInviteForLearner(buyer, instA).map(EnrollInvite::getId).orElse("none"));
        assertEquals(courseInvite, enrollInviteRepository.findLatestActiveInviteForLearner(learner, instA).map(EnrollInvite::getId).orElse("none"));
        assertTrue(count("control: plans of the buyer on an ACTIVE invite with a code (what the reader would return with no exclusion)",
                "SELECT count(*) FROM user_plan up JOIN enroll_invite ei ON ei.id = up.enroll_invite_id WHERE up.user_id = ? AND ei.institute_id = ? "
                        + "AND ei.status = 'ACTIVE' AND ei.invite_code IS NOT NULL AND ei.invite_code <> ''", buyer, instA) > 0);
        assertFalse(admissionCourseDao.personHasCourse(instA, buyer));
        assertTrue(admissionCourseDao.personHasCourse(instA, learner));
        assertTrue(count("control: open plans of the buyer through the institute's invites (personHasCourse would be true with no exclusion)",
                "SELECT count(*) FROM user_plan up JOIN enroll_invite ei ON ei.id = up.enroll_invite_id AND ei.institute_id = ? WHERE up.user_id = ? "
                        + "AND up.status NOT IN ('TERMINATED', 'CANCELED', 'CANCELLED', 'DELETED', 'EXPIRED', 'PAYMENT_FAILED')", instA, buyer) > 0);
        String audienceId = UUID.randomUUID().toString();
        String leadOfBuyer = UUID.randomUUID().toString();
        String leadOfLearner = UUID.randomUUID().toString();
        db.update("INSERT INTO audience (id, institute_id, campaign_name) VALUES (?, ?, ?)", audienceId, instA, "Proof campaign " + run);
        db.update("INSERT INTO audience_response (id, audience_id, user_id, source_type) VALUES (?, ?, ?, 'WEBSITE'), (?, ?, ?, 'WEBSITE')",
                leadOfBuyer, audienceId, buyer, leadOfLearner, audienceId, learner);
        Map<String, Boolean> courseByLead = admissionCourseDao.courseByResponse(instA, List.of(leadOfBuyer, leadOfLearner));
        note("   AdmissionCourseDao: personHasCourse buyer=false learner=true; courseByResponse buyer's lead=" + courseByLead.get(leadOfBuyer)
                + " learner's lead=" + courseByLead.get(leadOfLearner) + "; findLatestActiveInviteForLearner buyer=none learner=course invite");
        assertEquals(Map.of(leadOfBuyer, false, leadOfLearner, true), courseByLead);

        // Fee-management cash-in (CollectionDashboardRepositoryImpl, FinanceReportQueryRepository): these sum
        // student_fee_allocation_ledger rows, which only a fee-plan (CPO) payment writes. A shop payment has none.
        assertEquals(0, count("fee-allocation rows on the buyer's payment logs",
                "SELECT count(*) FROM student_fee_allocation_ledger WHERE payment_log_id IN (" + in(buyerLogs) + ")"));
        String feeModes = collectionDashboardRepository.getPaymentModeBreakdown(instA, null, false, List.of()).stream()
                .map(java.util.Arrays::toString).toList().toString();
        BigDecimal feeCash = financeReportQueryRepository.collectedRevenue(instA, from, to);
        note("   fee-management cash-in: CollectionDashboardRepositoryImpl.getPaymentModeBreakdown=" + feeModes
                + " FinanceReportQueryRepository.collectedRevenue=" + feeCash);
        assertEquals(0, feeCash.compareTo(BigDecimal.ZERO));
        assertEquals("[]", feeModes);

        // Abandoned carts: one person left a shop line unpaid, another left a course unpaid.
        String cartShop = "cart-shop-" + run;
        String cartCourse = "cart-course-" + run;
        for (String person : List.of(cartShop, cartCourse)) {
            db.update("INSERT INTO student (id, user_id, username, full_name, mobile_number) VALUES (?, ?, ?, 'Proof Cart', '9000000002')",
                    UUID.randomUUID().toString(), person, person);
        }
        commercePlan(cartShop, variantBySku.get("KK-S-" + run), 1);
        inTransaction(() -> {
            PaymentOption option = paymentOptionRepository.findById(typedOption).orElseThrow();
            PaymentPlan coursePlan = paymentPlanRepository.findById(db.queryForObject(
                    "SELECT id FROM payment_plan WHERE payment_option_id = ?", String.class, typedOption)).orElseThrow();
            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(300.0);
            payment.setCurrency("INR");
            return userPlanService.createUserPlan(cartCourse, coursePlan, null, enrollInviteRepository.findById(typedInvite).orElseThrow(),
                    option, payment, "PENDING_FOR_PAYMENT");
        });
        List<String> carts = studentSessionInstituteGroupMappingRepository.findAbandonedCartPlans(instA, List.of("PENDING_FOR_PAYMENT"), 0, 30)
                .stream().map(java.util.Arrays::toString).toList();
        note("   findAbandonedCartPlans: rows=" + carts.size() + " courseCart=" + carts.stream().anyMatch(r -> r.contains(cartCourse))
                + " shopCart=" + carts.stream().anyMatch(r -> r.contains(cartShop)));
        assertEquals(1, carts.size(), carts.toString());
        assertTrue(carts.get(0).contains(cartCourse));

        // The clamped decrement used by legacy enrolment paths skips a variant and still works on a course batch.
        String small = ps("KK-S-" + run);
        int onVariant = inTransaction(() -> packageSessionRepository.decrementAvailableSlotsClamped(small, 1));
        int onCourse = inTransaction(() -> packageSessionRepository.decrementAvailableSlotsClamped(courseBatch, 1));
        note("-- PackageSessionRepository.decrementAvailableSlotsClamped: rows changed on a variant=" + onVariant + ", on a course batch=" + onCourse);
        assertEquals(0, onVariant);
        assertEquals(1, onCourse);
        slotsAre("the clamped decrement on a variant", 8, 7, 0);
    }

    private Object invokeRevenuePayments(String day0, String day1) {
        // The method has paging arguments after the six shared ones; found by reflection so this
        // test does not pin their exact list.
        for (java.lang.reflect.Method m : revenueReportService.getClass().getMethods()) {
            if (m.getName().equals("getRevenuePayments")) {
                Object[] args = new Object[m.getParameterCount()];
                Class<?>[] types = m.getParameterTypes();
                Object[] first = {instA, day0, day1, null, null, adminA.getUserId()};
                for (int i = 0; i < args.length; i++) {
                    if (i < first.length) {
                        args[i] = first[i];
                    } else if (types[i] == int.class || types[i] == Integer.class) {
                        args[i] = i == first.length ? 0 : 20;
                    } else if (types[i] == boolean.class) {
                        args[i] = false;
                    }
                }
                try {
                    return m.invoke(revenueReportService, args);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    throw e.getCause() instanceof RuntimeException r ? r : new IllegalStateException(e.getCause());
                } catch (IllegalAccessException e) {
                    throw new IllegalStateException(e);
                }
            }
        }
        throw new IllegalStateException("getRevenuePayments not found");
    }

    // ------------------------- every legacy repository query with a commerce fragment

    private Object argumentFor(String name, Class<?> type) {
        String n = name.toLowerCase();
        long day = 24L * 3600 * 1000;
        boolean upper = n.startsWith("to") || n.contains("end") || n.contains("until") || n.contains("before");
        if (org.springframework.data.domain.Pageable.class.isAssignableFrom(type)) {
            return PageRequest.of(0, 50);
        }
        if (type == org.springframework.data.domain.Sort.class) {
            return org.springframework.data.domain.Sort.unsorted();
        }
        if (java.util.Collection.class.isAssignableFrom(type)) {
            if (n.contains("status") || n.contains("operation")) {
                return List.of("ACTIVE", "HIDDEN", "DRAFT", "DELETED", "INVITED", "PENDING_FOR_PAYMENT");
            }
            if (n.contains("packagesession")) {
                return List.of(courseBatch, typedBatch);
            }
            if (n.contains("package") || n.contains("course")) {
                return List.of(coursePkg, typedPkg);
            }
            if (n.contains("institute")) {
                return List.of(instA);
            }
            if (n.contains("user")) {
                return List.of("learner-g-" + run, "buyer-" + run);
            }
            return List.of("none");
        }
        if (type == String.class) {
            if (n.contains("institute")) {
                return instA;
            }
            if (n.contains("user")) {
                return "learner-g-" + run;
            }
            if (n.contains("packagesession")) {
                return courseBatch;
            }
            if (n.contains("package") || n.contains("course")) {
                return coursePkg;
            }
            if (n.equals("sessionid") || n.equals("levelid")) {
                return "DEFAULT";
            }
            if (n.contains("status")) {
                return "ACTIVE";
            }
            if (n.equals("tz") || n.contains("zone")) {
                return "UTC";
            }
            return null;
        }
        if (type == boolean.class || type == Boolean.class) {
            return false;
        }
        if (type == int.class || type == Integer.class) {
            return n.contains("limit") || n.contains("size") || n.contains("max") ? 50 : 0;
        }
        if (type == long.class || type == Long.class) {
            return 0L;
        }
        if (type == double.class || type == Double.class) {
            return 0.0;
        }
        if (type == java.time.LocalDateTime.class) {
            return upper ? java.time.LocalDateTime.now().plusDays(2) : java.time.LocalDateTime.now().minusDays(2);
        }
        if (type == java.time.LocalDate.class) {
            return upper ? java.time.LocalDate.now().plusDays(2) : java.time.LocalDate.now().minusDays(2);
        }
        if (type == java.sql.Timestamp.class || type == java.util.Date.class) {
            return new java.sql.Timestamp(System.currentTimeMillis() + (upper ? 2 * day : -2 * day));
        }
        return null;
    }

    /**
     * The claim "every legacy query that was given a commerce fragment has run on Postgres",
     * checked by the machine: every {@code @Query} of a non-commerce repository whose text names a
     * commerce table is listed by reflection, and each must have been called through its
     * repository bean during this run (the recorder in {@link LocalOnly}). The ones no earlier
     * test reached are called here, with arguments chosen by parameter name.
     */
    @Test
    @Order(82)
    void d_everyLegacyRepositoryQueryThatCarriesACommerceFragmentHasRun() {
        note("");
        note("== (d) every @Query of a legacy repository that names a commerce table");
        requestFrom(instA);
        java.util.regex.Pattern marker = java.util.regex.Pattern.compile("commerce_variant|commerce_product|CommerceVariant|CommerceProduct");
        Map<String, java.lang.reflect.Method> carriers = new java.util.TreeMap<>();
        Map<String, Object> beanOf = new java.util.HashMap<>();
        for (Object repository : applicationContext.getBeansOfType(org.springframework.data.repository.Repository.class).values()) {
            for (Class<?> type : org.springframework.aop.framework.AopProxyUtils.proxiedUserInterfaces(repository)) {
                if (!type.getName().startsWith("vacademy.io.") || type.getName().contains(".features.commerce.")) {
                    continue;
                }
                for (java.lang.reflect.Method method : type.getMethods()) {
                    org.springframework.data.jpa.repository.Query query = method.getAnnotation(org.springframework.data.jpa.repository.Query.class);
                    if (query != null && marker.matcher(query.value() + " " + query.countQuery()).find()) {
                        carriers.put(key(method), method);
                        beanOf.put(key(method), repository);
                    }
                }
            }
        }
        List<String> shopIds = new ArrayList<>(variantSessionIds());
        shopIds.add(productPkg);
        List<String> failed = new ArrayList<>();
        int reachedEarlier = 0;
        int calledHere = 0;
        int courseSeenHere = 0;
        // Published flag forced on, as in the reader tests, so only the commerce exclusion hides the product.
        db.update("UPDATE package SET is_course_published_to_catalaouge = true WHERE id = ?", productPkg);
        try {
            for (Map.Entry<String, java.lang.reflect.Method> carrier : carriers.entrySet()) {
                java.lang.reflect.Method method = carrier.getValue();
                if (REPOSITORY_CALLS.contains(carrier.getKey())) {
                    reachedEarlier++;
                    note("   ran in an earlier test: " + carrier.getKey());
                    continue;
                }
                Object[] args = new Object[method.getParameterCount()];
                List<String> names = new ArrayList<>();
                for (int i = 0; i < args.length; i++) {
                    String name = method.getParameters()[i].getName();
                    for (java.lang.annotation.Annotation annotation : method.getParameterAnnotations()[i]) {
                        if (annotation instanceof org.springframework.data.repository.query.Param param) {
                            name = param.value();
                        }
                    }
                    names.add(name);
                    args[i] = argumentFor(name, method.getParameterTypes()[i]);
                }
                try {
                    String out = inTransaction(() -> {
                        try {
                            Object result = method.invoke(beanOf.get(carrier.getKey()), args);
                            if (result instanceof org.springframework.data.domain.Page<?> page) {
                                result = page.getContent();
                            }
                            if (result instanceof java.util.Optional<?> optional) {
                                result = optional.orElse(null);
                            }
                            if (result instanceof java.util.Collection<?> rows) {
                                StringBuilder text = new StringBuilder("rows=" + rows.size() + " ");
                                for (Object row : rows) {
                                    text.append(row instanceof Object[] array ? java.util.Arrays.deepToString(array) : dump(row)).append(' ');
                                }
                                return text.toString();
                            }
                            return dump(result);
                        } catch (java.lang.reflect.InvocationTargetException e) {
                            throw e.getCause() instanceof RuntimeException r ? r : new IllegalStateException(e.getCause());
                        } catch (IllegalAccessException e) {
                            throw new IllegalStateException(e);
                        }
                    });
                    calledHere++;
                    boolean courseSeen = out.contains(coursePkg) || out.contains(courseBatch) || out.contains(typedPkg) || out.contains(typedBatch);
                    courseSeenHere += courseSeen ? 1 : 0;
                    List<String> leaked = shopIds.stream().filter(out::contains).toList();
                    note("   called here: " + carrier.getKey() + names + " courseSeen=" + courseSeen + " shopIdsFound=" + leaked.size()
                            + " -> " + (out.length() > 120 ? out.substring(0, 120) + "..." : out));
                    assertTrue(leaked.isEmpty(), carrier.getKey() + " shows shop rows " + leaked);
                } catch (RuntimeException e) {
                    Throwable root = e;
                    while (root.getCause() != null) {
                        root = root.getCause();
                    }
                    note("   FAILED " + carrier.getKey() + names + ": " + root.getClass().getSimpleName() + ": "
                            + String.valueOf(root.getMessage()).replaceAll("\\s+", " "));
                    failed.add(carrier.getKey());
                }
            }
        } finally {
            db.update("UPDATE package SET is_course_published_to_catalaouge = false WHERE id = ?", productPkg);
        }
        List<String> neverRan = carriers.keySet().stream().filter(k -> !REPOSITORY_CALLS.contains(k)).toList();
        note("-- legacy repository queries that name a commerce table: " + carriers.size() + "; reached by an earlier test: " + reachedEarlier
                + "; called here: " + calledHere + " (" + courseSeenHere + " of them returned a course row); failed: " + failed.size()
                + "; never ran: " + neverRan.size());
        assertTrue(carriers.size() >= 40, "the list of carriers looks too short: " + carriers.keySet());
        assertTrue(failed.isEmpty(), "queries that failed on Postgres: " + failed);
        assertTrue(neverRan.isEmpty(), "queries that never ran: " + neverRan);
    }

    // --------------------------------------- the other M1 commerce services

    @Test
    @Order(85)
    void x_collectionsMediaSearchPinAndRateLimitRunOnRealTables() {
        note("");
        note("== extra: the other M1 commerce services on real tables");
        requestFrom(instA);
        String actor = adminA.getUserId();

        assertEquals(1, productService.list(instA, null, "KURTA", null, 0, 20).getTotalElements(), "search by name");
        assertEquals(1, productService.list(instA, null, "kk-m-" + run, null, 0, 20).getTotalElements(), "search by sku");
        assertEquals(0, productService.list(instA, null, "no-such-thing", null, 0, 20).getTotalElements());
        assertEquals(0, productService.list(instB, null, "kurta", null, 0, 20).getTotalElements(), "B finds nothing");
        assertEquals(3, productService.listVariants(instA, productPkg, 0, 20).getTotalElements());

        CollectionDTO parent = collectionService.create(instA, actor, CollectionDTO.builder().kind("CATEGORY")
                .slug("clothing-" + run).nameI18n(Map.of("en", "Clothing", "hi", "Kapde")).build());
        CollectionDTO child = collectionService.create(instA, actor, CollectionDTO.builder().kind("CATEGORY")
                .parentId(parent.getId()).slug("kurtas-" + run).nameI18n(Map.of("en", "Kurtas")).returnWindowDays(7).build());
        productService.update(instA, actor, productPkg, ProductRequest.builder().collectionIds(List.of(child.getId()))
                .attributeValueIds(List.of(sizeM)).build());
        assertEquals(1, productService.list(instA, null, null, child.getId(), 0, 20).getTotalElements(), "filter by collection");
        assertEquals(0, productService.list(instA, null, null, parent.getId(), 0, 20).getTotalElements());
        assertEquals(List.of(productPkg), collectionService.products(instA, child.getId()));
        assertEquals(1, collectionService.tree(instA).size());
        assertThrows(RuntimeException.class, () -> collectionService.get(instB, child.getId()));
        sql("collections and membership", "SELECT c.slug, c.kind, c.name_i18n::text AS name, (c.parent_id IS NOT NULL) AS has_parent, c.return_window_days, "
                + "(SELECT count(*) FROM commerce_product_collection pc WHERE pc.collection_id = c.id) AS products "
                + "FROM commerce_collection c WHERE c.institute_id = ? ORDER BY c.created_at", instA);
        sql("facet rows of the product", "SELECT av.code FROM commerce_product_attribute_value f JOIN commerce_attribute_value av ON av.id = f.attribute_value_id WHERE f.package_id = ?", productPkg);

        ProductMediaDTO first = mediaService.attach(instA, actor, ProductMediaDTO.builder().packageId(productPkg)
                .mediaId(UUID.randomUUID().toString()).kind("IMAGE").altI18n(Map.of("en", "Front")).width(800).height(1000).build());
        ProductMediaDTO second = mediaService.attach(instA, actor, ProductMediaDTO.builder().packageId(productPkg)
                .packageSessionId(ps("KK-S-" + run)).mediaId(UUID.randomUUID().toString()).build());
        mediaService.reorder(instA, actor, productPkg, List.of(second.getId(), first.getId()));
        assertEquals(2, mediaService.list(instA, productPkg, 0, 20).getTotalElements());
        assertThrows(RuntimeException.class, () -> mediaService.attach(instB, adminB.getUserId(),
                ProductMediaDTO.builder().packageId(productPkg).mediaId(UUID.randomUUID().toString()).build()));
        sql("media rows", "SELECT kind, position, (package_session_id IS NOT NULL) AS on_variant, alt_i18n::text AS alt, width, height "
                + "FROM commerce_product_media WHERE package_id = ? ORDER BY position", productPkg);

        // One variant archived: only its legacy rows are hidden; then it comes back.
        String largeSession = ps("KK-L-" + run);
        productService.updateVariant(instA, actor, largeSession, VariantRequest.builder().status("ARCHIVED").build());
        sql("after archiving the Large variant only", "SELECT cv.sku, cv.status AS variant_status, ps.status AS session_status FROM commerce_variant cv "
                + "JOIN package_session ps ON ps.id = cv.package_session_id WHERE cv.package_id = ? ORDER BY cv.position", productPkg);
        assertEquals("DELETED", db.queryForObject("SELECT status FROM package_session WHERE id = ?", String.class, largeSession));
        assertEquals(2, db.queryForObject("SELECT count(*) FROM package_session WHERE package_id = ? AND status = 'ACTIVE'", Long.class, productPkg));
        productService.updateVariant(instA, actor, largeSession, VariantRequest.builder().status("ACTIVE").build());
        assertEquals(3, db.queryForObject("SELECT count(*) FROM package_session WHERE package_id = ? AND status = 'ACTIVE'", Long.class, productPkg));

        // A made-to-order product: one UNTRACKED variant, no options, published in the same call.
        ProductResponse madeToOrder = productService.save(instA, actor, ProductRequest.builder().status("ACTIVE")
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name("Custom Stole " + run).build()))
                .variants(List.of(VariantRequest.builder().sku("CS-1-" + run).stockPolicy("UNTRACKED").leadTimeDays(10)
                        .price(new BigDecimal("900.00")).build())).build());
        String untracked = madeToOrder.getVariants().get(0).getPackageSessionId();
        otherShopIds.add(madeToOrder.getPackageId());
        otherShopIds.add(untracked);
        legacyReadersShowNoShopRows("ACTIVE, with a second ACTIVE product beside it");
        sql("the UNTRACKED variant's package_session (both stock columns must be NULL, not the column default 0)",
                "SELECT status, max_seats, available_slots FROM package_session WHERE id = ?", untracked);
        assertNull(db.queryForObject("SELECT max_seats FROM package_session WHERE id = ?", Integer.class, untracked));
        assertNull(db.queryForObject("SELECT available_slots FROM package_session WHERE id = ?", Integer.class, untracked));
        assertTrue(stockHoldService.hold(instA, Map.of(untracked, 5), StockHoldKind.PURCHASE).isEmpty(), "unlimited: nothing to hold");
        assertEquals(2, productService.list(instA, "ACTIVE", null, null, 0, 20).getTotalElements());

        // Institute B may use the same SKU and slug as A; the two never meet.
        requestFrom(instB);
        ProductResponse ofB = productController.save(ProductRequest.builder()
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name("Khadi Kurta " + run).build()))
                .variants(List.of(VariantRequest.builder().sku("KK-S-" + run).price(new BigDecimal("10.00")).build())).build(),
                instB, adminB).getBody();
        sql("same slug and SKU in two institutes", "SELECT (cp.institute_id = ?) AS is_a, cp.slug, cv.sku, cp.status FROM commerce_product cp "
                + "JOIN commerce_variant cv ON cv.package_id = cp.package_id WHERE cv.sku = ? ORDER BY 1", instA, "KK-S-" + run);
        assertEquals(1, productController.list(instB, null, null, null, false, 0, 20, adminB).getBody().getTotalElements());
        requestFrom(instA);
        assertThrows(ResourceNotFoundException.class, () -> productController.get(ofB.getPackageId(), instA, adminA));
        assertEquals(ofB.getPackageId(), db.queryForObject("SELECT package_id FROM package_institute WHERE institute_id = ? AND package_id = ?",
                String.class, instB, ofB.getPackageId()));
        // A's own duplicate SKU is still refused.
        RuntimeException duplicateSku = assertThrows(RuntimeException.class, () -> productService.save(instA, actor, ProductRequest.builder()
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name("Copy " + run).build()))
                .variants(List.of(VariantRequest.builder().sku("KK-S-" + run).build())).build()));
        note("-- duplicate SKU inside A refused: " + duplicateSku.getMessage());
        assertEquals(0, count("packages left by the refused duplicate", "SELECT count(*) FROM package WHERE package_name = ?", "Copy " + run));

        staffService.setOwnPin(instA, actor, "482917");
        assertTrue(staffService.hasPin(instA, actor));
        pinService.verify(instA, actor, "482917");
        assertThrows(CommerceAccessDeniedException.class, () -> pinService.verify(instA, actor, "111222"));
        assertThrows(CommerceAccessDeniedException.class, () -> pinService.verify(instB, actor, "482917"), "a PIN is per institute");
        sql("PIN row after one right and one wrong try (the hash is not shown)",
                "SELECT (pin_hash IS NOT NULL AND pin_hash <> '482917') AS hashed, failed_attempts, lock_count, locked_until FROM commerce_staff_pin WHERE institute_id = ? AND user_id = ?", instA, actor);
        for (int i = 0; i < 5; i++) {
            assertThrows(CommerceAccessDeniedException.class, () -> pinService.verify(instA, actor, "111222"));
        }
        CommerceAccessDeniedException locked = assertThrows(CommerceAccessDeniedException.class, () -> pinService.verify(instA, actor, "482917"));
        note("-- the right PIN after too many wrong tries: " + locked.getMessage());
        sql("PIN row after the lock", "SELECT failed_attempts, lock_count, (locked_until > now()) AS locked_now FROM commerce_staff_pin WHERE institute_id = ? AND user_id = ?", instA, actor);
        sql("audit rows of the PIN", "SELECT kind, count(*) FROM commerce_audit WHERE institute_id = ? AND kind LIKE '%PIN%' GROUP BY 1 ORDER BY 1", instA);

        List<String> locations = staffService.setLocations(instA, actor, "cashier-" + run, List.of("loc-1-" + run, "loc-2-" + run));
        assertEquals(2, locations.size());
        assertEquals(2, count("staff location rows", "SELECT count(*) FROM commerce_staff_location WHERE institute_id = ? AND user_id = ?", instA, "cashier-" + run));

        java.util.Date window = new java.util.Date(System.currentTimeMillis() / 60000 * 60000);
        Integer hit1 = inTransaction(() -> rateLimitRepository.hit(UUID.randomUUID().toString(), instA, "checkout", "ip-1", window));
        Integer hit2 = inTransaction(() -> rateLimitRepository.hit(UUID.randomUUID().toString(), instA, "checkout", "ip-1", window));
        note("-- rate limit counter (native upsert): first hit=" + hit1 + ", second hit=" + hit2);
        assertEquals(1, hit1);
        assertEquals(2, hit2);
        assertEquals(1, count("rate limit rows for the window", "SELECT count(*) FROM commerce_rate_limit WHERE institute_id = ?", instA));
    }

    // -------------------------------------------------------- (b) archive

    @Test
    @Order(90)
    void b_archiveHidesTheProductAndKeepsEveryRow() {
        note("");
        note("== (b) archive");
        requestFrom(instA);
        Map<String, Long> before = productRowCounts();
        ProductResponse archived = productController.changeStatus(productPkg, new ProductStatusRequest("ARCHIVED"), instA, adminA).getBody();
        assertEquals("ARCHIVED", archived.getStatus());
        legacyStatusEvidence("archived");
        assertEquals(before, productRowCounts(), "archiving removes no row");
        assertEquals("DELETED", db.queryForObject("SELECT status FROM package WHERE id = ?", String.class, productPkg));
        assertEquals(3, count("package sessions of the product now DELETED",
                "SELECT count(*) FROM package_session WHERE package_id = ? AND status = 'DELETED'", productPkg));
        assertEquals(0, count("ACTIVE invites or link rows of the product",
                "SELECT count(*) FROM package_session_learner_invitation_to_payment_option l JOIN enroll_invite ei ON ei.id = l.enroll_invite_id "
                        + "WHERE l.package_session_id IN (" + in(variantSessionIds()) + ") AND (l.status = 'ACTIVE' OR ei.status = 'ACTIVE')"));
        assertEquals(1, productService.list(instA, "ACTIVE", null, null, 0, 20).getTotalElements(), "only the made-to-order product is left on sale");
        assertEquals(1, productService.list(instA, "ARCHIVED", null, null, 0, 20).getTotalElements());
        slotsAre("archiving (stock is not touched)", 8, 7, 0);
        legacyReadersShowNoShopRows("ARCHIVED");
        // The buyer's paid plan is still not on the 04:30 list.
        assertEquals(0, userPlanRepository.findPaidActivePlansWithoutEnrollment().stream()
                .filter(p -> p.getUserId().equals("buyer-" + run)).count());
    }
}
