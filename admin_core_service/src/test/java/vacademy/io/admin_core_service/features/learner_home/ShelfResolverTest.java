package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ShelfConfig;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerFacts;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver.CourseCard;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Enrolment;
import vacademy.io.admin_core_service.features.packages.dto.LearnerPackageFilterDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.service.OpenPackageService;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.block;

/** Shelf sources (TAG, HAND_PICKED order, NEWEST, FREE), internal types, hide-owned and limit. */
class ShelfResolverTest {

    static PackageDetailV2DTO row(String id, String type, Double price, String thumb) {
        PackageDetailV2DTO d = new PackageDetailV2DTO();
        d.setId(id);
        d.setPackageName("Course " + id);
        d.setPackageType(type);
        d.setMinPlanActualPrice(price);
        d.setCurrency(price == null ? null : "INR");
        d.setThumbnailFileId(thumb);
        return d;
    }

    static ShelfConfig cfg(String json) {
        return (ShelfConfig) block("{'type':'COURSE_SHELF','config':" + json + "}").config();
    }

    OpenPackageService search = mock(OpenPackageService.class);
    CatalogMediaResolver media = mock(CatalogMediaResolver.class);
    ShelfResolver resolver = new ShelfResolver(search, media);

    void answer(PackageDetailV2DTO... rows) {
        when(search.getLearnerPackageDetailV2(any(), eq("i"), eq(0), eq(50))).thenReturn(new PageImpl<>(List.of(rows)));
        when(media.resolve(any())).thenReturn(Map.of("th-a", "https://cdn/a.jpg"));
    }

    @Test
    void newestDedupesDropsInternalTypesAndResolvesThumbnails() {
        answer(row("a", null, 100d, "th-a"), row("a", null, 100d, "th-a"), row("charge", "DELIVERY_CHARGE", 50d, null),
                row("dep", "SECURITY_DEPOSIT", 50d, null), row("b", "COURSE", null, null));
        List<CourseCard> cards = resolver.candidates("i", "k", 3, cfg("{'title':'New'}"));
        assertEquals(List.of("a", "b"), cards.stream().map(CourseCard::packageId).toList());
        assertEquals("https://cdn/a.jpg", cards.get(0).thumbnailUrl());
        ArgumentCaptor<LearnerPackageFilterDTO> f = ArgumentCaptor.forClass(LearnerPackageFilterDTO.class);
        verify(search).getLearnerPackageDetailV2(f.capture(), eq("i"), eq(0), eq(50));
        assertEquals(Map.of("createdAt", "DESC"), f.getValue().getSortColumns());
        assertTrue(f.getValue().isExcludeChargePackages());
        // cached per (institute, block, version)
        resolver.candidates("i", "k", 3, cfg("{'title':'New'}"));
        verify(search, times(1)).getLearnerPackageDetailV2(any(), any(), anyInt(), anyInt());
    }

    @Test
    void tagShelfPassesTheTags() {
        answer(row("a", null, 0d, null));
        resolver.candidates("i", "k", 1, cfg("{'title':'JEE','source':'TAG','tags':['JEE 2027']}"));
        ArgumentCaptor<LearnerPackageFilterDTO> f = ArgumentCaptor.forClass(LearnerPackageFilterDTO.class);
        verify(search).getLearnerPackageDetailV2(f.capture(), any(), anyInt(), anyInt());
        assertEquals(List.of("JEE 2027"), f.getValue().getTag());
        assertTrue(resolver.candidates("i", "k2", 1, cfg("{'title':'JEE','source':'TAG'}")).isEmpty(), "no tag, no query");
    }

    @Test
    void handPickedKeepsTheAdminsOrder() {
        answer(row("a", null, 1d, null), row("b", null, 1d, null), row("c", null, 1d, null));
        List<CourseCard> cards = resolver.candidates("i", "k", 1,
                cfg("{'title':'Picks','source':'HAND_PICKED','package_ids':['c','missing','a']}"));
        assertEquals(List.of("c", "a"), cards.stream().map(CourseCard::packageId).toList());
    }

    @Test
    void freeKeepsNoPriceOrZero() {
        answer(row("paid", null, 499d, null), row("zero", null, 0d, null), row("none", null, null, null));
        assertEquals(List.of("zero", "none"), resolver.candidates("i", "k", 1, cfg("{'title':'Free','source':'FREE'}"))
                .stream().map(CourseCard::packageId).toList());
    }

    static PageImpl<PackageDetailV2DTO> page(int pageNo, int total, java.util.function.IntFunction<PackageDetailV2DTO> make) {
        List<PackageDetailV2DTO> rows = new java.util.ArrayList<>();
        for (int i = 0; i < 50 && pageNo * 50 + i < total; i++) rows.add(make.apply(pageNo * 50 + i));
        return new PageImpl<>(rows, org.springframework.data.domain.PageRequest.of(pageNo, 50), total);
    }

    @Test
    void freeShelfLooksPastTheFiftyNewestCourses() {
        // 120 courses: the 50 newest are paid, free ones only on later pages.
        java.util.function.IntFunction<PackageDetailV2DTO> make = i -> row("c" + i, null, i < 50 ? 999d : (i % 2 == 0 ? 0d : 499d), null);
        for (int p = 0; p < 3; p++) {
            when(search.getLearnerPackageDetailV2(any(), eq("i"), eq(p), eq(50))).thenReturn(page(p, 120, make));
        }
        when(media.resolve(any())).thenReturn(Map.of());
        List<CourseCard> cards = resolver.candidates("i", "free", 1, cfg("{'title':'Free','source':'FREE'}"));
        assertEquals(35, cards.size());
        assertTrue(cards.stream().allMatch(CourseCard::isFree));
        assertEquals("c50", cards.get(0).packageId());
        verify(search, times(3)).getLearnerPackageDetailV2(any(), any(), anyInt(), anyInt());
    }

    @Test
    void freeShelfStopsAtAFullCandidateListOrTheBound() {
        when(media.resolve(any())).thenReturn(Map.of());
        // All free: one page is enough.
        java.util.function.IntFunction<PackageDetailV2DTO> free = i -> row("f" + i, null, null, null);
        when(search.getLearnerPackageDetailV2(any(), eq("i"), anyInt(), eq(50)))
                .thenAnswer(inv -> page(inv.getArgument(2), 10_000, free));
        assertEquals(50, resolver.candidates("i", "a", 1, cfg("{'title':'Free','source':'FREE'}")).size());
        verify(search, times(1)).getLearnerPackageDetailV2(any(), any(), anyInt(), anyInt());

        // None free in a huge catalogue: at most 6 pages are read.
        java.util.function.IntFunction<PackageDetailV2DTO> paid = i -> row("p" + i, null, 10d, null);
        when(search.getLearnerPackageDetailV2(any(), eq("i"), anyInt(), eq(50)))
                .thenAnswer(inv -> page(inv.getArgument(2), 10_000, paid));
        assertTrue(resolver.candidates("i", "b", 1, cfg("{'title':'Free','source':'FREE'}")).isEmpty());
        verify(search, times(7)).getLearnerPackageDetailV2(any(), any(), anyInt(), anyInt());
    }

    @Test
    void perLearnerHideOwnedAndLimit() {
        List<CourseCard> cards = List.of(new CourseCard("a", "A", null, null, null), new CourseCard("b", "B", null, null, null),
                new CourseCard("c", "C", null, null, null), new CourseCard("d", "D", null, null, null),
                new CourseCard("e", "E", null, null, null));
        LearnerFacts owns = LearnerFacts.of(List.of(new Enrolment("ps", "b")), List.of());
        assertEquals(List.of("a", "c", "d", "e"), ShelfResolver.forLearner(cards, cfg("{'title':'t','limit':4}"), owns)
                .stream().map(i -> i.card().packageId()).toList());
        List<ShelfResolver.ShelfItem> shown = ShelfResolver.forLearner(cards, cfg("{'title':'t','limit':4,'hide_owned':false}"), owns);
        assertEquals(List.of("a", "b", "c", "d"), shown.stream().map(i -> i.card().packageId()).toList());
        assertTrue(shown.get(1).owned());
    }
}
