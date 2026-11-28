package vacademy.io.admin_core_service.features.commerce.storefront.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiErrorAdvice;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.CatalogSitemapContributor;
import vacademy.io.admin_core_service.features.catalog_api.PublicCatalogApiController;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogApiService;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogLeadService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The product routes sit on the public Catalogue API: the same key check, the institute of the
 * key, the feature check, the 60 s cache and the API error shape.
 */
class PublicStorefrontCatalogControllerTest {

    private static final String BASE = "/admin-core-service/open/catalog/v1";
    private static final CatalogApiAuth.Principal READER = new CatalogApiAuth.Principal("inst-1", "key-1",
            List.of(CatalogApiAuth.SCOPE_READ));

    private CatalogApiAuth auth;
    private CommerceAccessGuard guard;
    private StorefrontCatalogService service;
    private CatalogApiService courses;
    private PublicCatalogApiController courseController;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        auth = mock(CatalogApiAuth.class);
        guard = mock(CommerceAccessGuard.class);
        service = mock(StorefrontCatalogService.class);
        courses = mock(CatalogApiService.class);
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        courseController = new PublicCatalogApiController(auth, courses, mock(CatalogLeadService.class));
        mvc = MockMvcBuilders.standaloneSetup(
                        new PublicStorefrontCatalogController(auth, new StorefrontFeatureGate(guard), service),
                        courseController)
                .setControllerAdvice(new CatalogApiErrorAdvice()).build();
    }

    private static StorefrontDtos.ProductList emptyList() {
        return StorefrontDtos.ProductList.builder().data(List.of()).total(0).page(1).pageSize(24).locale("hi").build();
    }

    @Test
    void theListingIsReadWithTheKeysInstituteAndIsCacheableForAMinute() throws Exception {
        when(service.list(eq("inst-1"), any())).thenReturn(emptyList());

        mvc.perform(get(BASE + "/products").param("q", "साड़ी").param("collection", "sarees")
                        .param("filter.colour", "red,blue").param("filter.fabric", "silk").param("price_min", "500")
                        .param("price_max", "2500.50").param("in_stock", "true").param("sort", "price_asc")
                        .param("page", "2").param("page_size", "12").param("facets", "1").param("lang", "en")
                        // Nothing in the request can name another institute.
                        .param("instituteId", "inst-2").param("institute_id", "inst-2"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(header().string("Vary", "Origin, X-API-Key, Authorization"))
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.page_size").value(24))
                .andExpect(jsonPath("$.has_more").value(false));

        verify(auth).authenticate(any(), eq(CatalogApiAuth.SCOPE_READ));
        verify(guard).requireFeature("inst-1", CommerceFeature.CATALOGUE);
        verify(service).list(eq("inst-1"), argThat(q -> "साड़ी".equals(q.q()) && "sarees".equals(q.collection())
                && q.attributes().equals(Map.of("colour", List.of("red", "blue"), "fabric", List.of("silk")))
                && new BigDecimal("500").compareTo(q.priceMin()) == 0
                && new BigDecimal("2500.50").compareTo(q.priceMax()) == 0 && Boolean.TRUE.equals(q.inStock())
                && "price_asc".equals(q.sort()) && q.page() == 2 && q.pageSize() == 12 && q.facets()
                && "en".equals(q.locale())));
    }

    @Test
    void defaultsAreTheFirstPageOfTwentyFourWithNoFacets() throws Exception {
        when(service.list(eq("inst-1"), any())).thenReturn(emptyList());
        mvc.perform(get(BASE + "/products")).andExpect(status().isOk());
        verify(service).list(eq("inst-1"), argThat(q -> q.page() == 1 && q.pageSize() == 24 && !q.facets()
                && q.inStock() == null && q.attributes().isEmpty() && q.locale() == null));
    }

    @Test
    void suggestAnswersFromTheSuggestService() throws Exception {
        when(service.suggest("inst-1", "sar", "hi")).thenReturn(StorefrontDtos.Suggestions.builder()
                .products(List.of()).collections(List.of()).total(0).locale("hi").build());
        mvc.perform(get(BASE + "/products").param("suggest", "1").param("q", "sar").param("locale", "hi"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(jsonPath("$.products").isArray());
        verify(service, never()).list(any(), any());
    }

    @Test
    void badParametersAnswerInvalidRequestInTheApiShape() throws Exception {
        mvc.perform(get(BASE + "/products").param("page", "two"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"))
                .andExpect(jsonPath("$.error.details.param").value("page"))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get(BASE + "/products").param("price_min", "-5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.details.param").value("price_min"));
        mvc.perform(get(BASE + "/products").param("in_stock", "maybe"))
                .andExpect(status().isBadRequest());
        mvc.perform(get(BASE + "/categories").param("min_in_stock", "-1"))
                .andExpect(status().isBadRequest());
        verify(service, never()).list(any(), any());
    }

    @Test
    void anInstituteWithoutTheFeatureGetsNoData() throws Exception {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED, "off"))
                .when(guard).requireFeature("inst-1", CommerceFeature.CATALOGUE);

        for (String path : List.of("/products", "/products/red-saree", "/categories")) {
            mvc.perform(get(BASE + path))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error.code").value("commerce_not_enabled"));
        }
        verify(service, never()).list(any(), any());
        verify(service, never()).detail(any(), any(), any());
        verify(service, never()).categories(any(), any(), any(), anyInt());
    }

    @Test
    void aFailedKeyCheckStopsTheRequestBeforeAnythingIsRead() throws Exception {
        when(auth.authenticate(any(), eq(CatalogApiAuth.SCOPE_READ))).thenThrow(
                new CatalogApiException(HttpStatus.UNAUTHORIZED, "missing_api_key", "Send your publishable key."));
        mvc.perform(get(BASE + "/products"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("missing_api_key"));
        verify(guard, never()).requireFeature(any(), any());
        verify(service, never()).list(any(), any());
    }

    @Test
    void theProductAndTheCategoryRoutesPassTheSlugAndTheLocale() throws Exception {
        when(service.detail("inst-1", "red-saree", "en")).thenReturn(StorefrontDtos.ProductDetail.builder()
                .id("p-1").slug("red-saree").name("Red saree").build());
        mvc.perform(get(BASE + "/products/red-saree").param("locale", "en"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(jsonPath("$.slug").value("red-saree"))
                .andExpect(jsonPath("$.description_html").doesNotExist());

        when(service.detail("inst-1", "gone", null))
                .thenThrow(new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", "Product not found."));
        mvc.perform(get(BASE + "/products/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));

        when(service.categories("inst-1", "hi", "CATEGORY", 4)).thenReturn(StorefrontDtos.CategoryTree.builder()
                .data(List.of()).locale("hi").build());
        mvc.perform(get(BASE + "/categories").param("locale", "hi").param("kind", "CATEGORY")
                        .param("min_in_stock", "4"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locale").value("hi"));
    }

    @Test
    void aWrongMethodOnAProductRouteIs405AndAnUnknownPathIs404() throws Exception {
        mvc.perform(post(BASE + "/products"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("method_not_allowed"));
        mvc.perform(post(BASE + "/categories"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(get(BASE + "/products/a/b"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    void theSitemapKeepsTheCoursesAndAddsWhatTheShopContributes() throws Exception {
        Map<String, Object> course = new LinkedHashMap<>();
        course.put("url", "https://site.test/course-1");
        course.put("type", "course");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("data", new ArrayList<>(List.of(course)));
        when(courses.sitemap("inst-1")).thenReturn(body);

        // No contributor: the answer is the course sitemap as it was.
        mvc.perform(get(BASE + "/sitemap"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1));

        CatalogSitemapContributor shop = instituteId -> List.of(
                Map.of("url", "https://site.test/p/red-saree", "type", "product", "id", "p-1"),
                Map.of("url", "https://site.test/c/sarees", "type", "collection", "id", "sarees"));
        ReflectionTestUtils.setField(courseController, "sitemapContributors", List.of(shop));

        mvc.perform(get(BASE + "/sitemap"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=60"))
                .andExpect(jsonPath("$.data.length()").value(3))
                .andExpect(jsonPath("$.data[0].type").value("course"))
                .andExpect(jsonPath("$.data[1].type").value("product"))
                .andExpect(jsonPath("$.data[2].url").value("https://site.test/c/sarees"));
    }
}
