package vacademy.io.admin_core_service.features.catalog_api;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.course.dto.CourseDTO;
import vacademy.io.admin_core_service.features.study_library.dto.LevelDTOWithDetails;
import vacademy.io.admin_core_service.features.study_library.dto.SessionDTOWithDetails;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.dto.SessionDTO;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogRow;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.FolderNode;
import vacademy.io.admin_core_service.features.catalog_api.rules.SiteConfig;
import vacademy.io.admin_core_service.features.catalogue_folder.dto.FolderLibraryDTOs.TreeResponse;
import vacademy.io.admin_core_service.features.course.dto.CourseDTOWithDetails;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageInviteMappingResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageResponse;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Prod-shaped fixtures (Brahm Varchas, institute 2719d8d1-…, read 2026-10-15 from the public
 * endpoints the hosted site calls, trimmed) and a small catalogue-row builder.
 */
public final class CatalogTestData {

    public static final String BV_INSTITUTE = "2719d8d1-43fd-4f9f-97af-a5b067d770a6";
    public static final String BV_LIBRARY = "904e2152-f6b8-4c49-bfa0-e8849d13825f";

    public static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private CatalogTestData() {
    }

    public static JsonNode json(String name) {
        try (InputStream in = CatalogTestData.class.getResourceAsStream("/catalog_api/" + name)) {
            if (in == null) throw new IllegalStateException("missing fixture " + name);
            return MAPPER.readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** bv_search_v2.json: the open v2 search rows, through the real DTO and its row mapping. */
    public static List<CatalogRow> bvRows() {
        List<CatalogRow> out = new ArrayList<>();
        for (JsonNode n : json("bv_search_v2.json").get("content")) {
            out.add(CatalogRow.from(MAPPER.convertValue(n, PackageDetailV2DTO.class)));
        }
        return out;
    }

    public static SiteConfig bvSite() {
        return SiteConfig.parse("store", json("bv_catalogue_store.json").get("catalogue_json").asText(), MAPPER);
    }

    public static List<FolderNode> bvTree() {
        TreeResponse tree = MAPPER.convertValue(json("bv_folder_tree.json"), TreeResponse.class);
        return FolderNode.fromAll(tree.getRoots());
    }

    /** bv_product_page_forbvy.json (PaymentPlanDTO has no Jackson constructor, so plans are built). */
    public static ProductPageResponse bvProductPage() {
        JsonNode root = json("bv_product_page_forbvy.json").deepCopy();
        List<ProductPageInviteMappingResponse> mappings = new ArrayList<>();
        for (JsonNode m : root.get("mappings")) {
            JsonNode plan = m.get("payment_plan");
            ((com.fasterxml.jackson.databind.node.ObjectNode) m).remove("payment_plan");
            ProductPageInviteMappingResponse mapping = MAPPER.convertValue(m, ProductPageInviteMappingResponse.class);
            if (plan != null && plan.isObject()) {
                mapping.setPaymentPlan(PaymentPlanDTO.builder()
                        .id(plan.path("id").asText())
                        .actualPrice(plan.path("actual_price").asDouble())
                        .elevatedPrice(plan.path("elevated_price").asDouble())
                        .currency(plan.path("currency").asText())
                        .build());
            }
            mappings.add(mapping);
        }
        ((com.fasterxml.jackson.databind.node.ObjectNode) root).remove("mappings");
        ProductPageResponse page = MAPPER.convertValue(root, ProductPageResponse.class);
        page.setMappings(mappings);
        return page;
    }

    /**
     * bv_course_init_7c12a9ec.json as the DTO course-init returns. The DTOs have no Jackson
     * constructors (they are only ever serialised), so they are assembled by hand; the course
     * itself is a mock carrying the fixture's course_page_json.
     */
    public static CourseDTOWithDetails bvCourseInit(String coursePageJson, List<UserDTO> levelInstructors) {
        JsonNode root = json("bv_course_init_7c12a9ec.json").get(0);
        CourseDTO course = Mockito.mock(CourseDTO.class);
        Mockito.when(course.getId()).thenReturn(root.path("course").path("id").asText());
        Mockito.when(course.getCoursePageJson()).thenReturn(coursePageJson);
        List<SessionDTOWithDetails> sessions = new ArrayList<>();
        for (JsonNode s : root.get("sessions")) {
            SessionDTO session = MAPPER.convertValue(s.get("session_dto"), SessionDTO.class);
            List<LevelDTOWithDetails> levels = new ArrayList<>();
            for (JsonNode l : s.get("level_with_details")) {
                Level level = new Level(l.get("id").asText(), l.get("name").asText(), 0, "ACTIVE", null, null, null);
                levels.add(new LevelDTOWithDetails(level, List.of(), levelInstructors));
            }
            sessions.add(new SessionDTOWithDetails(session, levels));
        }
        return new CourseDTOWithDetails(course, sessions);
    }

    // ── row builder ─────────────────────────────────────────────────────────────

    public static Row row(String packageId, String packageSessionId) {
        return new Row(packageId, packageSessionId);
    }

    public static final class Row {
        private final String packageId;
        private final String packageSessionId;
        private String title = "Course";
        private String level = "default";
        private String tags;
        private double price;
        private Double elevated;
        private String currency = "INR";
        private String availability = "AVAILABLE";
        private CatalogRow.ComingSoon comingSoon;
        private String description;
        private String image;
        private Instant createdAt;

        Row(String packageId, String packageSessionId) {
            this.packageId = packageId;
            this.packageSessionId = packageSessionId;
        }

        public Row title(String v) { this.title = v; return this; }
        public Row level(String v) { this.level = v; return this; }
        public Row tags(String v) { this.tags = v; return this; }
        public Row price(double v) { this.price = v; return this; }
        public Row elevated(Double v) { this.elevated = v; return this; }
        public Row availability(String v) { this.availability = v; return this; }
        public Row comingSoon(String launchDate) { this.comingSoon = new CatalogRow.ComingSoon(launchDate, null); return this; }
        public Row description(String v) { this.description = v; return this; }
        public Row image(String v) { this.image = v; return this; }
        public Row createdAt(String iso) { this.createdAt = Instant.parse(iso); return this; }

        public CatalogRow build() {
            return new CatalogRow(packageId, packageSessionId, title, level, null, null, tags, price, elevated,
                    currency, "inv-" + packageSessionId, availability, comingSoon, description, null, null, null,
                    image, null, List.of(), 0.0, createdAt);
        }
    }
}
