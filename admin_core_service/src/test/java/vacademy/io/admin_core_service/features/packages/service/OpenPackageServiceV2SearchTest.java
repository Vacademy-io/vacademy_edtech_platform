package vacademy.io.admin_core_service.features.packages.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.query.Param;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.util.EnrollInviteAvailabilityUtil;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.faculty.service.CourseRoleLabelService;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2Projection;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The public v2 catalogue search: created_at on every row, and the additive package_ids filter.
 *
 * <p>The repository is a recording mock that captures each call's arguments BY @Param NAME, so a
 * value bound to the wrong position of the 22-argument call (the classic way to break this
 * method) shows up as a wrong named argument instead of passing silently.
 */
class OpenPackageServiceV2SearchTest {

    private static final Instant CREATED = Instant.parse("2026-09-01T10:15:30.120Z");
    private static final String COMING_SOON_JSON =
            "{\"setting\":{\"COMING_SOON\":{\"key\":\"COMING_SOON\",\"data\":{\"enabled\":true,\"launchDate\":\"2026-11-15\"}}}}";

    private final List<Map<String, Object>> calls = new ArrayList<>();
    private List<PackageDetailV2Projection> rows = List.of();
    private OpenPackageService service;

    @BeforeEach
    void setUp() {
        PackageRepository repository = mock(PackageRepository.class, invocation -> {
            Method method = invocation.getMethod();
            if (!method.getName().endsWith("PackageDetailV2")) {
                return Answers.RETURNS_DEFAULTS.answer(invocation);
            }
            Map<String, Object> args = new LinkedHashMap<>();
            args.put("$method", method.getName());
            Parameter[] parameters = method.getParameters();
            for (int i = 0; i < parameters.length; i++) {
                Param param = parameters[i].getAnnotation(Param.class);
                args.put(param != null ? param.value() : parameters[i].getType().getSimpleName(),
                        invocation.getArgument(i));
            }
            calls.add(args);
            Pageable pageable = (Pageable) args.get("Pageable");
            return new PageImpl<>(rows, pageable, rows.size());
        });
        service = new OpenPackageService();
        ReflectionTestUtils.setField(service, "packageRepository", repository);
        ReflectionTestUtils.setField(service, "authService", mock(AuthService.class));
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        ReflectionTestUtils.setField(service, "courseRoleLabelService",
                new CourseRoleLabelService(mock(FacultySubjectPackageSessionMappingRepository.class)));
    }

    private static PackageDetailV2Projection projection(Timestamp createdAt) {
        PackageDetailV2Projection p = mock(PackageDetailV2Projection.class);
        when(p.getId()).thenReturn("pkg-1");
        when(p.getPackageName()).thenReturn("Vedic Maths");
        when(p.getPackageSessionId()).thenReturn("ps-1");
        when(p.getLevelName()).thenReturn("Beginner Hindi");
        when(p.getEnrollInviteId()).thenReturn("invite-1");
        when(p.getEnrollInviteStatus()).thenReturn("INACTIVE");
        when(p.getMinPlanActualPrice()).thenReturn(499.0);
        when(p.getCurrency()).thenReturn("INR");
        when(p.getAvailableSlots()).thenReturn(7);
        when(p.getMaxSeats()).thenReturn(25);
        when(p.getComingSoonSettingJson()).thenReturn(COMING_SOON_JSON);
        when(p.getCreatedAt()).thenReturn(createdAt);
        return p;
    }

    private static LearnerPackageFilterDTO filter(List<String> packageIds, String searchByName) {
        LearnerPackageFilterDTO filter = new LearnerPackageFilterDTO();
        filter.setPackageIds(packageIds);
        filter.setSearchByName(searchByName);
        filter.setCreatedByUserId("creator-9");
        filter.setLevelIds(List.of("level-1"));
        filter.setSessionIds(List.of("session-1"));
        filter.setTag(List.of("shiksha"));
        return filter;
    }

    private Map<String, Object> onlyCall() {
        assertThat(calls).hasSize(1);
        return calls.get(0);
    }

    // ---------------------------------------------------------------- created_at

    @Test
    @DisplayName("created_at is mapped from the projection, and the positional neighbours stay in place")
    void createdAtIsMappedWithoutShiftingNeighbours() {
        rows = List.of(projection(Timestamp.from(CREATED)));

        Page<PackageDetailV2DTO> page = service.getLearnerPackageDetailV2(filter(null, null), "inst-1", 0, 20);

        PackageDetailV2DTO dto = page.getContent().get(0);
        assertThat(dto.getCreatedAt()).isNotNull();
        assertThat(dto.getCreatedAt().toInstant()).isEqualTo(CREATED);
        // the last positional arguments before createdAt still land in their own fields
        assertThat(dto.getComingSoon()).isNotNull();
        assertThat(dto.getComingSoon().getEnabled()).isTrue();
        assertThat(dto.getComingSoon().getLaunchDate()).isEqualTo("2026-11-15");
        assertThat(dto.getEnrollInviteAvailability()).isEqualTo(EnrollInviteAvailabilityUtil.INACTIVE);
        assertThat(dto.getMaxSeats()).isEqualTo(25);
        assertThat(dto.getAvailableSlots()).isEqualTo(7);
        assertThat(dto.getCurrency()).isEqualTo("INR");
        assertThat(dto.getMinPlanActualPrice()).isEqualTo(499.0);
        assertThat(dto.getEnrollInviteId()).isEqualTo("invite-1");
        assertThat(dto.getLevelName()).isEqualTo("Beginner Hindi");
        assertThat(dto.getId()).isEqualTo("pkg-1");
    }

    @Test
    @DisplayName("created_at serialises as an ISO-8601 UTC string, with or without Spring Boot date defaults")
    void createdAtIsIsoOnTheWire() throws Exception {
        rows = List.of(projection(Timestamp.from(CREATED)));
        PackageDetailV2DTO dto = service.getLearnerPackageDetailV2(filter(null, null), "inst-1", 0, 20)
                .getContent().get(0);

        // plain mapper: WRITE_DATES_AS_TIMESTAMPS is ON here, so only the field pin keeps it a string
        JsonNode plain = new ObjectMapper().readTree(new ObjectMapper().writeValueAsString(dto));
        assertThat(plain.get("created_at").isTextual()).isTrue();
        assertThat(plain.get("created_at").asText()).isEqualTo("2026-09-01T10:15:30.120Z");
        assertThat(Instant.parse(plain.get("created_at").asText())).isEqualTo(CREATED);
        assertThat(plain.has("createdAt")).isFalse();

        // the application's mapper (Spring Boot defaults)
        ObjectMapper boot = Jackson2ObjectMapperBuilder.json().build();
        assertThat(boot.readTree(boot.writeValueAsString(dto)).get("created_at").asText())
                .isEqualTo("2026-09-01T10:15:30.120Z");
    }

    @Test
    @DisplayName("A row without created_at serialises created_at as null, never a bogus date")
    void missingCreatedAtStaysNull() throws Exception {
        rows = List.of(projection(null));

        PackageDetailV2DTO dto = service.getLearnerPackageDetailV2(filter(null, null), "inst-1", 0, 20)
                .getContent().get(0);

        assertThat(dto.getCreatedAt()).isNull();
        JsonNode json = new ObjectMapper().readTree(new ObjectMapper().writeValueAsString(dto));
        assertThat(json.has("created_at")).isTrue();
        assertThat(json.get("created_at").isNull()).isTrue();
    }

    // ---------------------------------------------------------------- package_ids

    @Test
    @DisplayName("package_ids reaches the browse query, trimmed and de-duplicated, other filters unchanged")
    void packageIdsReachTheOpenQuery() {
        service.getLearnerPackageDetailV2(filter(List.of(" pkg-a ", "pkg-b", "pkg-a"), null), "inst-1", 0, 20);

        Map<String, Object> call = onlyCall();
        assertThat(call.get("$method")).isEqualTo("getOpenCatalogPackageDetailV2");
        assertThat(call.get("packageIds")).isEqualTo(List.of("pkg-a", "pkg-b"));
        assertThat(call.get("instituteId")).isEqualTo("inst-1");
        assertThat(call.get("createdByUserId")).isEqualTo("creator-9");
        assertThat(call.get("levelIds")).isEqualTo(List.of("level-1"));
        assertThat(call.get("sessionIds")).isEqualTo(List.of("session-1"));
        assertThat(call.get("tags")).isEqualTo(List.of("shiksha"));
        assertThat(((Pageable) call.get("Pageable")).getPageSize()).isEqualTo(20);
    }

    @Test
    @DisplayName("package_ids reaches the search-by-name query too")
    void packageIdsReachTheSearchQuery() {
        service.getLearnerPackageDetailV2(filter(List.of("pkg-a"), "maths"), "inst-1", 0, 20);

        Map<String, Object> call = onlyCall();
        assertThat(call.get("$method")).isEqualTo("getCatalogPackageDetailV2");
        assertThat(call.get("packageIds")).isEqualTo(List.of("pkg-a"));
        assertThat(call.get("name")).isEqualTo("maths");
        assertThat(call.get("createdByUserId")).isEqualTo("creator-9");
        assertThat(call.get("levelIds")).isEqualTo(List.of("level-1"));
    }

    @Test
    @DisplayName("Absent or empty package_ids leaves both queries unfiltered (every existing caller)")
    void absentPackageIdsChangeNothing() {
        service.getLearnerPackageDetailV2(filter(null, null), "inst-1", 0, 20);
        service.getLearnerPackageDetailV2(filter(List.of(), null), "inst-1", 0, 20);
        service.getLearnerPackageDetailV2(filter(null, "maths"), "inst-1", 0, 20);
        service.getLearnerPackageDetailV2(filter(List.of(), "maths"), "inst-1", 0, 20);

        assertThat(calls).hasSize(4);
        assertThat(calls).allSatisfy(call -> {
            assertThat(call).containsKey("packageIds");
            assertThat(call.get("packageIds")).isNull();
        });
    }

    @Test
    @DisplayName("package_ids holding only blanks matches nothing, without running the query")
    void blankOnlyPackageIdsMatchNothing() {
        Page<PackageDetailV2DTO> page = service.getLearnerPackageDetailV2(
                filter(Arrays.asList("", "   ", null), null), "inst-1", 0, 20);

        assertThat(page.getContent()).isEmpty();
        assertThat(page.getTotalElements()).isZero();
        assertThat(calls).isEmpty();
    }

    @Test
    @DisplayName("More than 500 distinct package_ids is a 400, before any query")
    void tooManyPackageIdsIsRejected() {
        List<String> tooMany = IntStream.rangeClosed(1, OpenPackageService.MAX_PACKAGE_IDS_FILTER + 1)
                .mapToObj(i -> "pkg-" + i).toList();

        assertThatThrownBy(() -> service.getLearnerPackageDetailV2(filter(tooMany, null), "inst-1", 0, 20))
                .isInstanceOf(VacademyException.class)
                .satisfies(e -> assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThat(calls).isEmpty();

        // exactly at the cap is fine, and duplicates do not count against it
        List<String> atCap = new ArrayList<>(tooMany.subList(0, OpenPackageService.MAX_PACKAGE_IDS_FILTER));
        atCap.add("pkg-1");
        service.getLearnerPackageDetailV2(filter(atCap, null), "inst-1", 0, 20);
        assertThat((List<?>) onlyCall().get("packageIds")).hasSize(OpenPackageService.MAX_PACKAGE_IDS_FILTER);
    }

    @Test
    @DisplayName("normalizePackageIdsFilter: null/empty = no filter, blanks dropped, order kept")
    void normalizeRules() {
        assertThat(OpenPackageService.normalizePackageIdsFilter(null)).isNull();
        assertThat(OpenPackageService.normalizePackageIdsFilter(List.of())).isNull();
        assertThat(OpenPackageService.normalizePackageIdsFilter(Arrays.asList(" ", null))).isEmpty();
        assertThat(OpenPackageService.normalizePackageIdsFilter(List.of("b", " a", "b", "c ")))
                .containsExactly("b", "a", "c");
    }
}
