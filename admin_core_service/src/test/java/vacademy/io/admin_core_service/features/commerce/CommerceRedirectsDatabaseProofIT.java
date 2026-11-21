package vacademy.io.admin_core_service.features.commerce;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.storefront.redirect.SiteRedirectAdminController;
import vacademy.io.admin_core_service.features.commerce.storefront.redirect.SiteRedirectDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.redirect.SiteRedirectResolver;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Database-backed proof of the staff redirect API (WP-52 P1) on a local Postgres with the real
 * Flyway chain and the real Spring context, through the controller and the real commerce guard,
 * read back with the real public resolver. Every test works on shops of its own (a fresh
 * institute id each), so the tests do not depend on each other.
 *
 * <p>Skipped unless {@code COMMERCE_IT_PG_URL} names a database on this machine (same pattern as
 * {@link CommerceM1DatabaseProofIT}); nothing leaves the machine.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CommerceRedirectsDatabaseProofIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("commerce.order-token.secret", () -> "local-proof-only-not-a-secret");
    }

    @Autowired private JdbcTemplate db;
    @Autowired private CapabilityResolver capabilityResolver;
    @Autowired private SiteRedirectAdminController controller;
    @Autowired private SiteRedirectResolver resolver;

    @MockBean private AuthService authService;
    @MockBean private WorkflowTriggerService workflowTriggerService;
    @MockBean private InvoiceService invoiceService;
    @MockBean private PaymentNotificatonService paymentNotificatonService;
    @MockBean private DynamicNotificationService dynamicNotificationService;
    @MockBean private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean private MediaService mediaService;
    @MockBean private CommerceRenditionClient renditionClient;

    private static final String SLUG = Normalizer.normalize("लाल-साड़ी", Normalizer.Form.NFC);
    private static final String OLD_HINDI = Normalizer.normalize("पुरानी-साड़ी", Normalizer.Form.NFC);
    private static final String HEADER = "from_path,to_path,status_code,match_type\n";

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    // ---------------------------------------------------------------- helpers

    /** A new institute; with the commerce module when {@code commerce}. */
    private String shop(boolean commerce) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", id,
                "Redirects Proof " + id.substring(0, 8), "https://shop-" + id.substring(0, 8) + ".example.com");
        if (commerce) {
            db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", id);
        }
        capabilityResolver.evict(id);
        return id;
    }

    private void activeProduct(String institute, String slug) {
        db.update("INSERT INTO commerce_product (id, institute_id, package_id, slug, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
                UUID.randomUUID().toString(), institute, UUID.randomUUID().toString(), slug);
    }

    private void activeCollection(String institute, String slug) {
        db.update("INSERT INTO commerce_collection (id, institute_id, slug, name_i18n) VALUES (?, ?, ?, '{\"en\":\"x\"}'::jsonb)",
                UUID.randomUUID().toString(), institute, slug);
    }

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("staff-proof");
        dto.setUsername("staff-proof");
        dto.setFullName("Proof Staff");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    /** The clientId header of the caller's token: the institute the authorities belong to. */
    private static void as(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static MockMultipartFile csv(String body) {
        return new MockMultipartFile("file", "redirects.csv", "text/csv", (HEADER + body).getBytes(StandardCharsets.UTF_8));
    }

    private SiteRedirectDtos.RedirectImportResult validate(String shop, MockMultipartFile file) {
        as(shop);
        return controller.importRedirects(shop, "validate", null, file, user("COMMERCE_STORE_MANAGER")).getBody();
    }

    private SiteRedirectDtos.RedirectImportResult commit(String shop, MockMultipartFile file) {
        SiteRedirectDtos.RedirectImportResult checked = validate(shop, file);
        assertEquals(0, checked.getErrorCount(), String.valueOf(checked.getIssues()));
        as(shop);
        return controller.importRedirects(shop, "commit", checked.getCommitToken(), file, user("ADMIN")).getBody();
    }

    private long rows(String shop) {
        return db.queryForObject("SELECT count(*) FROM site_redirect WHERE institute_id = ?", Long.class, shop);
    }

    private long audits(String shop) {
        return db.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ?", Long.class, shop);
    }

    private Optional<SiteRedirectResolver.Redirect> resolve(String shop, String path) {
        return resolver.resolve(shop, path);
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static long timed(Runnable work) {
        long start = System.nanoTime();
        work.run();
        return (System.nanoTime() - start) / 1_000_000;
    }

    // ------------------------------------------------------------------ proof

    @Test
    void everyStoredAddressIsFoundByTheResolverInEverySpelling() {
        String shop = shop(true);
        activeProduct(shop, "red-saree");
        activeProduct(shop, SLUG);
        activeCollection(shop, "sarees");
        String encodedOld = "/hi/product/" + enc(OLD_HINDI) + "/";
        SiteRedirectDtos.RedirectImportResult result = commit(shop, csv(
                encodedOld + ",/p/" + SLUG + ",301,\n"
                        + "https://old.example/Product/Red-Saree/,/p/red-saree?lang=en,301,EXACT\n"
                        + "/product/blue-shirt/?attribute_pa_size=m,/p/red-saree?v=RS-M,301,\n"
                        + "/product/blue-shirt/,/p/red-saree,301,\n"
                        + "/hi/dummy/,,410,\n"
                        + "/product-category/,/c/sarees,301,PREFIX\n"
                        + "/product-category/sarees/old,/shop,301,PREFIX\n"));
        assertTrue(result.isCommitted());
        assertEquals(7, result.getCreated().size());
        assertEquals(7L, rows(shop));

        // The Devanagari target is stored ASCII, and reads back as the same slug.
        String target = "/p/" + enc(SLUG);
        String stored = db.queryForObject("SELECT to_path FROM site_redirect WHERE institute_id = ? AND from_path = ?",
                String.class, shop, "/hi/product/" + OLD_HINDI);
        assertEquals(target, stored);
        assertTrue(stored.chars().allMatch(c -> c > 0x20 && c < 0x7F));

        // Every spelling of the old address: as sent (upper-case hex), lower-case hex, decoded, without the slash.
        for (String path : List.of(encodedOld, encodedOld.toLowerCase(), "/hi/product/" + OLD_HINDI + "/",
                "/hi/product/" + OLD_HINDI, encodedOld.substring(0, encodedOld.length() - 1),
                "/HI/Product/" + enc(OLD_HINDI))) {
            assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, target)), resolve(shop, path), path);
        }
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/red-saree?lang=en")),
                resolve(shop, "/product/red-saree/"));
        // The query is kept on EXACT; another query falls back to the bare path.
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/red-saree?v=RS-M")),
                resolve(shop, "/product/blue-shirt/?attribute_pa_size=m"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/red-saree")),
                resolve(shop, "/product/blue-shirt/?add-to-cart=12"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(410, null)), resolve(shop, "/hi/dummy"));
        // The longest PREFIX wins.
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/c/sarees")),
                resolve(shop, "/product-category/kurtas/"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/shop")),
                resolve(shop, "/product-category/sarees/old/page/2"));
        // A PREFIX address written with its slash stops at the segment, and catches the bare address.
        assertEquals("/product-category/", db.queryForObject("SELECT from_path FROM site_redirect WHERE institute_id = ?"
                + " AND match_type = 'PREFIX' AND to_path = '/c/sarees'", String.class, shop));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/c/sarees")), resolve(shop, "/product-category"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/c/sarees")), resolve(shop, "/product-category/"));
        assertTrue(resolve(shop, "/product-categoryx/kurtas").isEmpty());
        assertTrue(resolve(shop, "/product-categories").isEmpty());
    }

    @Test
    void reviewFollowUpsHoldOnTheRealTables() {
        String shop = shop(true);
        activeProduct(shop, "x");
        // Off the site once decoded, a climbing segment, a control character in the query: refused with
        // their codes and row numbers, never a database error.
        SiteRedirectDtos.RedirectImportResult refused = validate(shop, csv(
                "/a,/%2F%2Fevil.example,301,\n"
                        + "/b,/..//evil.example,301,\n"
                        + "/c1?x=\u0000y,/p/x,301,\n"
                        + "/d,/p/x%00,301,\n"
                        + "/e/,/f/x,301,PREFIX\n/f/,/e/y,301,PREFIX\n"));
        assertEquals(List.of("OFF_SITE_TARGET", "OFF_SITE_TARGET", "INVALID_FROM_PATH", "INVALID_TO_PATH",
                        "PREFIX_LOOP", "PREFIX_LOOP"),
                refused.getIssues().stream().map(SiteRedirectDtos.RedirectIssue::getCode).toList());
        assertEquals(List.of(2, 3, 4, 5, 6, 7), refused.getIssues().stream().map(SiteRedirectDtos.RedirectIssue::getRow).toList());
        assertNull(refused.getCommitToken());

        // The old shop's own routes, which the new shop serves under the same name, and an old
        // WordPress query link on the home page: skipped with a warning; the rest goes in.
        SiteRedirectDtos.RedirectImportResult loaded = commit(shop, csv(
                "/cart/,/cart,301,\n/checkout/,/checkout,301,\n/?p=123,/p/x,301,\n"
                        + "/a?q=ख,/p/x,301,\n/product/,/shop,301,PREFIX\n/shop/page/2/,/shop,301,\n"));
        assertEquals(3, loaded.getRowsIgnored());
        assertEquals(3, loaded.getCreated().size());
        assertEquals(List.of("SELF_REDIRECT", "SELF_REDIRECT", "NEVER_LOOKED_UP", "NEVER_LOOKED_UP"),
                loaded.getIssues().stream().map(SiteRedirectDtos.RedirectIssue::getCode).toList());
        // A non-ASCII query is stored as a browser sends it and found that way.
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/x")), resolve(shop, "/a?q=%E0%A4%96"));
        assertEquals(1L, db.queryForObject("SELECT count(*) FROM site_redirect WHERE institute_id = ? AND from_path = ?",
                Long.class, shop, "/a?q=%E0%A4%96"));
        // "/product/" catches the pages under it and itself, not "/products".
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/shop")), resolve(shop, "/product/old-item/"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/shop")), resolve(shop, "/product"));
        assertTrue(resolve(shop, "/products").isEmpty());
        assertTrue(resolve(shop, "/productivity").isEmpty());
    }

    @Test
    void oneCallTakesACommitBackAndOnlyTheShopsStaffMayDoIt() {
        String shop = shop(true);
        String other = shop(true);
        commit(shop, csv("/kept,/p/one,301,\n/changed,/p/one,301,\n/gone-later,,410,\n"));
        List<Map<String, Object>> before = db.queryForList("SELECT id, from_path, to_path, status_code, match_type FROM"
                + " site_redirect WHERE institute_id = ? ORDER BY id", shop);

        SiteRedirectDtos.RedirectImportResult bad = commit(shop, csv(
                "/changed,/p/two,301,\n/gone-later,/p/two,301,\n/new-1,/p/two,301,\n/new-2/,/shop,301,PREFIX\n"));
        assertEquals(2, bad.getCreated().size());
        assertEquals(2, bad.getUpdated().size());
        assertNotNull(bad.getCommitId());
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/two")), resolve(shop, "/changed"));

        // Not for a learner, not for another institute's admin; another institute does not know the id.
        as(shop);
        assertThrows(CommerceAccessDeniedException.class, () -> controller.undo(bad.getCommitId(), shop, user("STUDENT")));
        as(other);
        assertThrows(CommerceAccessDeniedException.class, () -> controller.undo(bad.getCommitId(), shop, user("ADMIN")));
        assertThrows(ResourceNotFoundException.class, () -> controller.undo(bad.getCommitId(), other, user("ADMIN")));

        as(shop);
        SiteRedirectDtos.RedirectUndoResult undone = controller.undo(bad.getCommitId(), shop,
                user("COMMERCE_STORE_MANAGER")).getBody();
        assertEquals(2, undone.getRemoved());
        assertEquals(2, undone.getRestored());
        assertEquals(before, db.queryForList("SELECT id, from_path, to_path, status_code, match_type FROM"
                + " site_redirect WHERE institute_id = ? ORDER BY id", shop));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/one")), resolve(shop, "/changed"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(410, null)), resolve(shop, "/gone-later"));
        assertTrue(resolve(shop, "/new-1").isEmpty());
        assertEquals(1L, db.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ? "
                + "AND kind = 'REDIRECTS_UNDONE' AND reference_id = ?", Long.class, shop, bad.getCommitId()));
        // Once only.
        assertThrows(ConflictException.class, () -> controller.undo(bad.getCommitId(), shop, user("ADMIN")));

        // A commit whose rows were changed since cannot be taken back, and nothing is written.
        SiteRedirectDtos.RedirectImportResult second = commit(shop, csv("/new-3,/p/two,301,\n"));
        commit(shop, csv("/new-3,/p/three,301,\n"));
        long rowsNow = rows(shop);
        as(shop);
        assertThrows(ConflictException.class, () -> controller.undo(second.getCommitId(), shop, user("ADMIN")));
        assertEquals(rowsNow, rows(shop));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/three")), resolve(shop, "/new-3"));
    }

    @Test
    void validateWritesNothingAndWarnsAboutTargetsThatDoNotExist() {
        String shop = shop(true);
        activeProduct(shop, "red-saree");
        long auditsBefore = audits(shop);
        SiteRedirectDtos.RedirectImportResult result = validate(shop,
                csv("/a,/p/red-saree,301,\n/b,/p/missing,301,\n/cc,/c/missing,301,\n"));
        assertEquals(3, result.getToCreate());
        assertEquals(0, result.getErrorCount());
        assertEquals(2, result.getWarningCount());
        assertEquals(List.of("TARGET_PRODUCT_NOT_ACTIVE", "TARGET_COLLECTION_NOT_ACTIVE"),
                result.getIssues().stream().map(SiteRedirectDtos.RedirectIssue::getCode).toList());
        assertNotNull(result.getCommitToken());
        assertEquals(0L, rows(shop));
        assertEquals(auditsBefore, audits(shop));
    }

    @Test
    void theSameFileCommittedTwiceWritesNothingTheSecondTimeAndAnUpdateKeepsTheOldValue() {
        String shop = shop(true);
        MockMultipartFile file = csv("/a,/p/one,301,\n/b,,410,\n/c,/shop,301,PREFIX\n");
        commit(shop, file);
        SiteRedirectDtos.RedirectImportResult again = commit(shop, file);
        assertEquals(0, again.getToCreate());
        assertEquals(0, again.getToUpdate());
        assertEquals(3, again.getUnchanged());
        assertEquals(List.of(), again.getCreated());
        assertEquals(3L, rows(shop));

        SiteRedirectDtos.RedirectImportResult changed = commit(shop, csv("/a,/p/two,301,\n/b,/p/one,301,\n"));
        assertEquals(2, changed.getUpdated().size());
        SiteRedirectDtos.WrittenRow a = changed.getUpdated().stream().filter(r -> r.getFromPath().equals("/a")).findFirst().orElseThrow();
        assertEquals("/p/one", a.getOldToPath());
        assertEquals("/p/two", a.getToPath());
        SiteRedirectDtos.WrittenRow b = changed.getUpdated().stream().filter(r -> r.getFromPath().equals("/b")).findFirst().orElseThrow();
        assertEquals(410, b.getOldStatusCode());
        assertNull(b.getOldToPath());
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/one")), resolve(shop, "/b"));

        // One audit row per commit, with counts and the file's digest, never a path.
        List<Map<String, Object>> audit = db.queryForList("SELECT new_value_json::text AS v FROM commerce_audit "
                + "WHERE institute_id = ? AND kind = 'REDIRECTS_IMPORTED' ORDER BY created_at", shop);
        assertEquals(3, audit.size());
        for (Map<String, Object> entry : audit) {
            String json = String.valueOf(entry.get("v"));
            assertTrue(json.contains("file_sha256"), json);
            assertFalse(json.contains("/p/") || json.contains("/shop"), json);
        }
    }

    @Test
    void badRowsAreRefusedAndAFileWithAnErrorWritesNothing() {
        String shop = shop(true);
        activeProduct(shop, "x");
        commit(shop, csv("/stored,/p/x,301,\n/stored-gone,,410,\n"));
        SiteRedirectDtos.RedirectImportResult result = validate(shop, csv(
                "/a,/p/x,410,\n"                 // 410 with a target
                        + "/b,,301,\n"           // 301 without one
                        + "/c,//evil.example/x,301,\n"
                        + "/d,https://evil.example/,301,\n"
                        + "/e,/E/,301,\n"        // back to itself
                        + "/f,/g,301,\n/g,/p/x,301,\n"   // a chain in the file
                        + "/h,/stored-gone,301,\n"       // a chain to a stored row
                        + "/ok,/p/x,301,\n"));
        // Errors first; the row back to itself is skipped with a warning, it blocks nothing.
        assertEquals(List.of("GONE_WITH_TARGET", "TO_PATH_REQUIRED", "OFF_SITE_TARGET", "OFF_SITE_TARGET",
                        "REDIRECT_CHAIN", "REDIRECT_CHAIN", "SELF_REDIRECT"),
                result.getIssues().stream().map(SiteRedirectDtos.RedirectIssue::getCode).toList());
        assertEquals(List.of(2, 3, 4, 5, 7, 9, 6),
                result.getIssues().stream().map(SiteRedirectDtos.RedirectIssue::getRow).toList());
        assertEquals(1, result.getRowsIgnored());
        assertNull(result.getCommitToken());

        long before = rows(shop);
        as(shop);
        assertThrows(InvalidRequestException.class, () -> controller.importRedirects(shop, "commit", "rv1.any",
                csv("/a,/p/x,410,\n/ok,/p/x,301,\n"), user("ADMIN")));
        assertEquals(before, rows(shop));
        assertTrue(resolve(shop, "/ok").isEmpty());
    }

    @Test
    void aCommitAfterTheRowsChangedIsRefusedUntilValidatedAgain() {
        String shop = shop(true);
        commit(shop, csv("/a,/p/one,301,\n"));
        MockMultipartFile file = csv("/a,/p/two,301,\n/b,/p/two,301,\n");
        String token = validate(shop, file).getCommitToken();
        // Someone changes the stored row in between.
        commit(shop, csv("/a,/p/three,301,\n"));
        as(shop);
        assertThrows(ConflictException.class, () -> controller.importRedirects(shop, "commit", token, file, user("ADMIN")));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/three")), resolve(shop, "/a"));
        assertTrue(resolve(shop, "/b").isEmpty());
        // Validated again, it goes in.
        assertEquals(1, commit(shop, file).getUpdated().size());
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/two")), resolve(shop, "/a"));
    }

    @Test
    void onlyTheShopsStoreManagerOrAdminGetsIn() {
        String shop = shop(true);
        String other = shop(true);
        String noModule = shop(false);
        MockMultipartFile file = csv("/a,/p/x,301,\n");
        Map<String, Supplier<CustomUserDetails>> refused = Map.of(
                "learner", () -> user("STUDENT"),
                "shopper", () -> user(),
                "warehouse", () -> user("COMMERCE_WAREHOUSE_STAFF"),
                "cashier", () -> user("COMMERCE_POS_CASHIER"));
        for (Map.Entry<String, Supplier<CustomUserDetails>> caller : refused.entrySet()) {
            as(shop);
            CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                    () -> controller.importRedirects(shop, "validate", null, file, caller.getValue().get()), caller.getKey());
            assertTrue(List.of(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, CommerceAccessDeniedException.ACCESS_DENIED)
                    .contains(e.getCode()), caller.getKey());
            assertThrows(CommerceAccessDeniedException.class,
                    () -> controller.list(shop, null, null, null, 0, 50, caller.getValue().get()), caller.getKey());
        }
        // The admin of another institute: the token is for that institute, not this one.
        as(other);
        CommerceAccessDeniedException foreign = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.importRedirects(shop, "validate", null, file, user("ADMIN")));
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, foreign.getCode());
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.export(shop, user("ADMIN"), new MockHttpServletResponse()));
        // An institute without the module.
        as(noModule);
        CommerceAccessDeniedException off = assertThrows(CommerceAccessDeniedException.class,
                () -> controller.importRedirects(noModule, "validate", null, file, user("ADMIN")));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, off.getCode());
        assertEquals(0L, rows(shop));
    }

    @Test
    void oneInstitutesRowsNeverResolveListOrDeleteForAnother() {
        String shop = shop(true);
        String other = shop(true);
        SiteRedirectDtos.RedirectImportResult mine = commit(shop, csv("/old,/p/x,301,\n/prefix,/shop,301,PREFIX\n"));
        assertTrue(resolve(other, "/old").isEmpty());
        assertTrue(resolve(other, "/prefix/a").isEmpty());

        as(other);
        assertEquals(0L, controller.list(other, null, null, null, 0, 50, user("ADMIN")).getBody().getTotal());
        String id = mine.getCreated().get(0).getId();
        assertThrows(ResourceNotFoundException.class, () -> controller.delete(id, other, user("ADMIN")));
        assertEquals(2L, rows(shop));
        // The other shop's own row for the same address does not touch this one.
        commit(other, csv("/old,/p/y,301,\n"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/x")), resolve(shop, "/old"));
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/y")), resolve(other, "/old"));
    }

    @Test
    void listDeleteAndAnExportThatImportsBackUnchanged() throws Exception {
        String shop = shop(true);
        commit(shop, csv("/hi/product/" + OLD_HINDI + ",/p/" + SLUG + ",301,\n/b,,410,\n/c,/shop,301,PREFIX\n"));

        as(shop);
        SiteRedirectDtos.RedirectPage page = controller.list(shop, OLD_HINDI, null, null, 0, 50, user("COMMERCE_STORE_MANAGER")).getBody();
        assertEquals(1L, page.getTotal());
        // Searched with the encoded spelling too.
        assertEquals(1L, controller.list(shop, enc(SLUG), null, null, 0, 50, user("ADMIN")).getBody().getTotal());
        assertEquals(1L, controller.list(shop, null, "prefix", null, 0, 50, user("ADMIN")).getBody().getTotal());
        assertEquals(1L, controller.list(shop, null, null, 410, 0, 50, user("ADMIN")).getBody().getTotal());
        // An _ in the search is a letter, not a wildcard.
        assertEquals(0L, controller.list(shop, "_", null, null, 0, 50, user("ADMIN")).getBody().getTotal());
        assertThrows(InvalidRequestException.class, () -> controller.list(shop, null, null, null, 0, 201, user("ADMIN")));

        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.export(shop, user("ADMIN"), response);
        byte[] exported = response.getContentAsByteArray();
        String text = new String(exported, StandardCharsets.UTF_8);
        assertTrue(text.startsWith("﻿" + HEADER.trim()), text);
        assertEquals(4, text.split("\r\n").length, text);
        MockMultipartFile back = new MockMultipartFile("file", "export.csv", "text/csv", exported);
        SiteRedirectDtos.RedirectImportResult again = validate(shop, back);
        assertEquals(0, again.getToCreate());
        assertEquals(0, again.getToUpdate());
        assertEquals(3, again.getUnchanged());
        assertEquals(1L, db.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ? "
                + "AND kind = 'REDIRECTS_EXPORTED'", Long.class, shop));

        String id = db.queryForObject("SELECT id FROM site_redirect WHERE institute_id = ? AND from_path = '/b'", String.class, shop);
        as(shop);
        SiteRedirectDtos.RedirectRow removed = controller.delete(id, shop, user("COMMERCE_STORE_MANAGER")).getBody();
        assertEquals("/b", removed.getFromPath());
        assertTrue(resolve(shop, "/b").isEmpty());
        assertEquals(2L, rows(shop));
        assertThrows(ResourceNotFoundException.class, () -> controller.delete(id, shop, user("ADMIN")));
        assertEquals(1L, db.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ? "
                + "AND kind = 'REDIRECT_DELETED' AND reference_id = ?", Long.class, shop, id));
    }

    @Test
    void twentyThousandRowsGoInWithinTheLimitAndOneMoreIsRefused() {
        String shop = shop(true);
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < 20_000; i++) {
            body.append("/hi/product/").append(OLD_HINDI).append('-').append(i).append("/,/p/item-").append(i)
                    .append("?lang=en,301,\n");
        }
        MockMultipartFile file = csv(body.toString());
        assertTrue(file.getSize() <= 2 * 1024 * 1024, "the file is " + file.getSize() + " bytes");
        SiteRedirectDtos.RedirectImportResult[] checked = new SiteRedirectDtos.RedirectImportResult[1];
        long validateMs = timed(() -> checked[0] = validate(shop, file));
        assertEquals(20_000, checked[0].getToCreate());
        assertEquals(0, checked[0].getErrorCount());
        SiteRedirectDtos.RedirectImportResult[] done = new SiteRedirectDtos.RedirectImportResult[1];
        as(shop);
        long commitMs = timed(() -> done[0] = controller.importRedirects(shop, "commit", checked[0].getCommitToken(), file,
                user("ADMIN")).getBody());
        assertEquals(20_000, done[0].getCreated().size());
        assertEquals(20_000L, rows(shop));
        System.out.println("REDIRECT_PROOF_TIMING rows=20000 validate_ms=" + validateMs + " commit_ms=" + commitMs);
        assertTrue(validateMs < 30_000, "validate took " + validateMs + " ms");
        assertTrue(commitMs < 60_000, "commit took " + commitMs + " ms");
        assertEquals(Optional.of(new SiteRedirectResolver.Redirect(301, "/p/item-19999?lang=en")),
                resolve(shop, "/hi/product/" + enc(OLD_HINDI) + "-19999/"));

        MockMultipartFile tooMany = csv(body + "/one-more,/p/x,301,\n");
        assertThrows(InvalidRequestException.class, () -> validate(shop, tooMany));
        assertEquals(20_000L, rows(shop));
    }
}
