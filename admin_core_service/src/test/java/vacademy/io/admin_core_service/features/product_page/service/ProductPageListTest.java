package vacademy.io.admin_core_service.features.product_page.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageListResponse;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProductPageListTest {

    @Mock
    private ProductPageRepository coursePageRepository;

    @Mock
    private ProductPageInviteMappingRepository mappingRepository;

    @InjectMocks
    private ProductPageService service;

    @Test
    @DisplayName("search is lower-cased and its LIKE wildcards are escaped")
    void likePatternEscapesWildcards() {
        assertThat(ProductPageService.likePattern(null)).isEqualTo("%");
        assertThat(ProductPageService.likePattern("   ")).isEqualTo("%");
        assertThat(ProductPageService.likePattern(" Weekly CA ")).isEqualTo("%weekly ca%");
        assertThat(ProductPageService.likePattern("50%_off!")).isEqualTo("%50!%!_off!!%");
    }

    @Test
    @DisplayName("each sort option orders by its column, id breaking ties")
    void listSortOptions() {
        assertThat(ProductPageService.listSort(null).getOrderFor("createdAt").getDirection())
                .isEqualTo(Sort.Direction.DESC);
        assertThat(ProductPageService.listSort("oldest").getOrderFor("createdAt").getDirection())
                .isEqualTo(Sort.Direction.ASC);
        Sort az = ProductPageService.listSort("NAME_ASC");
        assertThat(az.getOrderFor("name").getDirection()).isEqualTo(Sort.Direction.ASC);
        assertThat(az.getOrderFor("name").isIgnoreCase()).isTrue();
        assertThat(ProductPageService.listSort("NAME_DESC").getOrderFor("name").getDirection())
                .isEqualTo(Sort.Direction.DESC);
        assertThat(ProductPageService.listSort("bogus").getOrderFor("id")).isNotNull();
    }

    @Test
    @DisplayName("list returns summaries with mapping counts and status counts that ignore the status filter")
    void listBuildsSummaries() throws Exception {
        ProductPage page = new ProductPage();
        page.setId("pp-1");
        page.setName("Weekly CA");
        page.setCode("abc123");
        page.setStatus("ACTIVE");
        page.setPageJson("{\"huge\":true}");
        page.setCreatedAt(LocalDateTime.of(2026, 10, 1, 10, 0));

        when(coursePageRepository.searchForAdmin(eq("inst"), eq(List.of("ACTIVE")), eq("%weekly%"),
                any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(page), PageRequest.of(1, 12), 13));
        when(mappingRepository.countByProductPageIds(List.of("pp-1"), List.of("ACTIVE")))
                .thenReturn(List.<Object[]>of(new Object[]{"pp-1", 9L}));
        when(coursePageRepository.countByStatusForAdmin(eq("inst"), eq(List.of("ACTIVE", "DRAFT")),
                eq("%weekly%")))
                .thenReturn(List.of(new Object[]{"ACTIVE", 11L}, new Object[]{"DRAFT", 2L}));

        ProductPageListResponse resp = service.listProductPages("inst", "Weekly", "active", "LATEST", 1, 500);

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(coursePageRepository).searchForAdmin(eq("inst"), anyList(), eq("%weekly%"), pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isEqualTo(1);
        assertThat(pageable.getValue().getPageSize()).isEqualTo(100);

        assertThat(resp.getContent()).hasSize(1);
        assertThat(resp.getContent().get(0).getMappingCount()).isEqualTo(9L);
        assertThat(resp.getTotalElements()).isEqualTo(13L);
        assertThat(resp.getTotalPages()).isEqualTo(2);
        assertThat(resp.getActiveCount()).isEqualTo(11L);
        assertThat(resp.getDraftCount()).isEqualTo(2L);

        ObjectMapper mapper = JsonMapper.builder().addModule(new JavaTimeModule()).build();
        String json = mapper.writeValueAsString(resp);
        assertThat(json).contains("\"total_elements\":13", "\"active_count\":11", "\"mapping_count\":9");
        assertThat(json).doesNotContain("huge", "page_json");
    }
}
