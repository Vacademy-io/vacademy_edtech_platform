package vacademy.io.admin_core_service.features.packages.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.config.cache.ClientCacheResponseAdvice;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.service.CatalogPopularityService;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;

import java.util.List;

import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Round-trips GET /open/packages/v1/popularity through Spring MVC with the real
 * ClientCacheResponseAdvice registered (as it is in the app), so the JSON keys and the
 * Cache-Control header are what a browser would actually receive.
 */
class OpenPackageControllerPopularityTest {

    private static final String URL = "/admin-core-service/open/packages/v1/popularity";

    private final CatalogPopularityService popularityService = mock(CatalogPopularityService.class);
    private final OpenPackageService openPackageService = mock(OpenPackageService.class);
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        OpenPackageController controller = new OpenPackageController();
        ReflectionTestUtils.setField(controller, "openPackageService", openPackageService);
        ReflectionTestUtils.setField(controller, "catalogPopularityService", popularityService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ClientCacheResponseAdvice())
                .build();
    }

    @Test
    @DisplayName("Returns {institute_id, ranks[{package_id, rank}]} with public, max-age=600")
    void returnsRanksWithPublicTenMinuteCaching() throws Exception {
        when(popularityService.getPopularity("inst-1")).thenReturn(new CatalogPopularityDTO("inst-1", List.of(
                new CatalogPopularityDTO.PackageRank("pkg-a", 1),
                new CatalogPopularityDTO.PackageRank("pkg-b", 2))));

        mockMvc.perform(get(URL).param("instituteId", "inst-1"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=600"))
                .andExpect(jsonPath("$.institute_id").value("inst-1"))
                .andExpect(jsonPath("$.ranks", hasSize(2)))
                .andExpect(jsonPath("$.ranks[0].package_id").value("pkg-a"))
                .andExpect(jsonPath("$.ranks[0].rank").value(1))
                .andExpect(jsonPath("$.ranks[1].package_id").value("pkg-b"))
                .andExpect(jsonPath("$.ranks[1].rank").value(2))
                .andExpect(jsonPath("$.ranks[0].learner_count").doesNotExist())
                .andExpect(jsonPath("$.ranks[0].count").doesNotExist())
                .andExpect(jsonPath("$.unavailable").doesNotExist());
        verifyNoInteractions(openPackageService);
    }

    @Test
    @DisplayName("An institute with no ranked course: an empty list, still cacheable for 10 minutes")
    void emptyRanksAreCacheable() throws Exception {
        when(popularityService.getPopularity("inst-1")).thenReturn(CatalogPopularityDTO.empty("inst-1"));

        mockMvc.perform(get(URL).param("instituteId", "inst-1"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=600"))
                .andExpect(jsonPath("$.ranks", hasSize(0)));
    }

    @Test
    @DisplayName("Ranks that failed to load: still 200 with an empty list, but never stored by the browser")
    void unavailableRanksAreAnsweredButNotStored() throws Exception {
        when(popularityService.getPopularity("inst-1")).thenReturn(CatalogPopularityDTO.unavailable("inst-1"));

        mockMvc.perform(get(URL).param("instituteId", "inst-1"))
                .andExpect(status().isOk())
                // the server retries after a minute; a 10-minute browser copy would outlive that
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.institute_id").value("inst-1"))
                .andExpect(jsonPath("$.ranks", hasSize(0)))
                // same body shape the public site already reads as "no popularity data"
                .andExpect(jsonPath("$.unavailable").doesNotExist());
    }

    @Test
    @DisplayName("A blank institute id answers an empty list without reaching the cache or the DB")
    void blankInstituteIdIsAnsweredWithoutTheService() throws Exception {
        mockMvc.perform(get(URL).param("instituteId", "  "))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=600"))
                .andExpect(jsonPath("$.ranks", hasSize(0)));
        verify(popularityService, never()).getPopularity(anyString());
    }

    @Test
    @DisplayName("An impossibly long institute id is not given a cache slot")
    void oversizedInstituteIdIsAnsweredWithoutTheService() throws Exception {
        mockMvc.perform(get(URL).param("instituteId", "x".repeat(OpenPackageController.MAX_INSTITUTE_ID_LENGTH + 1)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=600"))
                .andExpect(jsonPath("$.ranks", hasSize(0)));
        verify(popularityService, never()).getPopularity(anyString());
    }

    @Test
    @DisplayName("instituteId is required")
    void missingInstituteIdIsBadRequest() throws Exception {
        mockMvc.perform(get(URL)).andExpect(status().isBadRequest());
        verifyNoInteractions(popularityService);
    }
}
