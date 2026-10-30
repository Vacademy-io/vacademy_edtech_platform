package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Engine;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportItems.Item;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportItemsDao.ItemRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportItemsService.Clause;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The rows behind the report's lead numbers: filters, search, and what each kind's row carries. */
class EngagementReportItemsRulesTest {

    private static final String INST = "inst-1";
    private static final String TZ = "Asia/Kolkata";

    private EngagementReportItemsDao dao;
    private EngagementDailyReportDao reportDao;
    private PlaceholderEmailService placeholders;
    private AuthService auth;
    private EngagementReportItemsService service;

    @BeforeEach
    void setUp() {
        dao = mock(EngagementReportItemsDao.class);
        reportDao = mock(EngagementDailyReportDao.class);
        placeholders = mock(PlaceholderEmailService.class);
        auth = mock(AuthService.class);
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.getJdbcTemplate()).thenReturn(mock(JdbcTemplate.class));
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getTimezoneId(INST)).thenReturn(TZ);
        when(placeholders.isPlaceholder(anyString())).thenAnswer(i -> i.<String>getArgument(0).endsWith("@vacademy.com"));
        when(reportDao.engines(INST)).thenReturn(List.of(new Engine("e1", "Outreach", "ACTIVE", "u1"),
                new Engine("e2", "Old", "ARCHIVED", "u1")));
        service = new EngagementReportItemsService(dao, reportDao, jdbc, mock(PlatformTransactionManager.class), tz,
                placeholders, auth);
    }

    private static String today() {
        return LocalDate.now(ZoneId.of(TZ)).toString();
    }

    private static ItemRow row(String kind) {
        LocalDateTime t = LocalDateTime.of(2026, 10, 28, 4, 2, 15);
        boolean leads = "LEADS_ADDED".equals(kind), demos = kind.startsWith("DEMOS_");
        boolean moves = "STATUS_CHANGES".equals(kind) || "CONVERSIONS".equals(kind);
        return new ItemRow("k1", "e1", "Outreach", "u-9", "ar-9",
                null, null, "asha9000@vacademy.com",
                "Asha", "+919800000001", "asha@school.org",
                demos ? "Invitee" : null, demos ? "+91 1" : null, demos ? "inv@x.org" : null,
                leads ? "BATCH" : null, null, null, leads ? Boolean.TRUE : null, leads ? t : null, leads ? t : null,
                demos ? "b1" : null, demos ? t : null, demos ? t.plusDays(1) : null, demos ? "CONFIRMED" : null,
                demos ? "NO_SHOW" : null, demos ? "host-1" : null,
                moves ? "New" : null, "CONVERSIONS".equals(kind) ? null : moves ? "Interested" : null,
                moves ? "MANUAL" : null, moves ? "staff-1" : null, moves ? t : null, moves ? "TEAM" : null);
    }

    @Nested
    class Filters {

        @Test
        void leadsSplitAsTheReportDoes() {
            assertEquals("is_new", EngagementReportItemsService.clause("LEADS_ADDED", "new").sql());
            assertEquals("NOT is_new", EngagementReportItemsService.clause("LEADS_ADDED", " Existing ").sql());
            assertEquals("list_kind = 'BATCH'", EngagementReportItemsService.clause("LEADS_ADDED", "list:BATCH").sql());
            assertEquals("list_kind = 'USERS'", EngagementReportItemsService.clause("LEADS_ADDED", "list:USERS").sql());
            Clause list = EngagementReportItemsService.clause("LEADS_ADDED", "list:AbC-123");
            assertEquals("list_kind = 'LIST' AND list_id = :listId", list.sql());
            assertEquals("AbC-123", list.listId());   // the id keeps its case and is bound, never inlined
        }

        @Test
        void demosAndStatusChanges() {
            assertEquals("r.outcome = 'COMPLETED'", EngagementReportItemsService.clause("DEMOS_SCHEDULED", "done").sql());
            assertEquals("r.outcome = 'NO_SHOW'", EngagementReportItemsService.clause("DEMOS_SCHEDULED", "no_show").sql());
            assertTrue(EngagementReportItemsService.clause("DEMOS_SCHEDULED", "not_marked").sql().contains("NOT IN"));
            assertEquals("h.source = 'ENGAGEMENT_ENGINE'",
                    EngagementReportItemsService.clause("STATUS_CHANGES", "engine").sql());
            assertTrue(EngagementReportItemsService.clause("STATUS_CHANGES", "team").sql().contains("'MANUAL'"));
            assertTrue(EngagementReportItemsService.clause("STATUS_CHANGES", "automation").sql()
                    .startsWith("COALESCE(h.source, '') NOT IN ('ENGAGEMENT_ENGINE', "));
            assertEquals(Clause.NONE, EngagementReportItemsService.clause("CONVERSIONS", " "));
        }

        @Test
        void aFilterThatDoesNotApplyIs400() {
            assertThrows(InvalidRequestException.class, () -> EngagementReportItemsService.clause("DEMOS_BOOKED", "done"));
            assertThrows(InvalidRequestException.class, () -> EngagementReportItemsService.clause("CONVERSIONS", "new"));
            assertThrows(InvalidRequestException.class, () -> EngagementReportItemsService.clause("LEADS_ADDED", "list:"));
            assertThrows(InvalidRequestException.class, () -> EngagementReportItemsService.clause("STATUS_CHANGES", "bot"));
        }
    }

    @Nested
    class Search {

        @Test
        void typedWildcardsMatchThemselvesAndPhonesMatchInDigits() {
            MapSqlParameterSource p = new MapSqlParameterSource();
            String sql = EngagementReportItemsService.searchSql("LEADS_ADDED", " +91 98765_% ", p);

            assertEquals("%+91 98765\\_\\%%", p.getValue("q"));
            assertEquals("%9198765%", p.getValue("qDigits"));
            assertTrue(sql.contains("LIKE :qDigits"));
            assertFalse(sql.contains("inv_name"));
        }

        @Test
        void demosAlsoSearchTheInviteeAndNoSearchIsTrue() {
            MapSqlParameterSource p = new MapSqlParameterSource();
            String sql = EngagementReportItemsService.searchSql("DEMOS_BOOKED", "asha", p);

            assertTrue(sql.contains("i.inv_name ILIKE :q"));
            assertFalse(sql.contains("qDigits"));
            assertFalse(p.hasValue("qDigits"));
            assertEquals("TRUE", EngagementReportItemsService.searchSql("DEMOS_BOOKED", "  ", new MapSqlParameterSource()));
        }
    }

    @Nested
    class Rows {

        @Test
        void aLeadRowCarriesOnlyLeadFieldsAndNoPlaceholderEmail() {
            Item i = service.item("LEADS_ADDED", row("LEADS_ADDED"), Map.of(), null);

            assertEquals("Asha", i.leadName());
            assertEquals("asha@school.org", i.email());   // the student row's synthesized address is no email
            assertEquals("BATCH", i.listId());
            assertEquals("Batch members", i.listName());
            assertTrue(i.isNew());
            assertEquals("2026-10-28T04:02:15Z", i.joinedAt());
            assertNull(i.bookingId());
            assertNull(i.toStatus());
            assertNull(i.actor());
        }

        @Test
        void aDemoRowNamesItsHost() {
            Item i = service.item("DEMOS_SCHEDULED", row("DEMOS_SCHEDULED"), Map.of("host-1", "Ravi"), null);

            assertEquals("b1", i.bookingId());
            assertEquals("NO_SHOW", i.outcome());
            assertEquals("Ravi", i.hostName());
            assertEquals("2026-10-29T04:02:15Z", i.scheduledStart());
            assertNull(i.isNew());
            assertNull(i.listId());
            assertNull(i.fromStatus());
        }

        @Test
        void aConversionWithoutAStatusMoveReadsAsTheConvertedStatus() {
            Item i = service.item("CONVERSIONS", row("CONVERSIONS"), Map.of("staff-1", "Meera"), "Converted");

            assertEquals("Converted", i.toStatus());
            assertEquals("TEAM", i.actor());
            assertEquals("Meera", i.changedByName());
            assertNull(i.bookingId());
        }
    }

    @Nested
    class Request {

        @Test
        void kindAndDateAreRequiredAndCheckedAsTheReport() {
            assertThrows(InvalidRequestException.class,
                    () -> service.items(INST, null, today(), "LEADS", null, null, 0, 50));
            assertThrows(InvalidRequestException.class,
                    () -> service.items(INST, null, null, "LEADS_ADDED", null, null, 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.items(INST, null,
                    LocalDate.now(ZoneId.of(TZ)).plusDays(2).toString(), "LEADS_ADDED", null, null, 0, 50));
            assertThrows(InvalidRequestException.class, () -> service.items(INST, null,
                    LocalDate.now(ZoneId.of(TZ)).minusDays(91).toString(), "LEADS_ADDED", null, null, 0, 50));
            assertThrows(InvalidRequestException.class,
                    () -> service.items(INST, null, today(), "LEADS_ADDED", null, null, -1, 50));
        }

        @Test
        void anotherInstitutesEngineIs404() {
            assertThrows(ResourceNotFoundException.class,
                    () -> service.items(INST, "zz", today(), "CONVERSIONS", null, null, 0, 50));
        }

        @Test
        void allEnginesIncludingArchivedAsTheReportAndSizeIsCapped() {
            when(dao.count(anyString(), eq("TRUE"), any())).thenReturn(1200L);
            when(dao.page(anyString(), eq("TRUE"), eq("i.sort_at DESC, i.item_key"), any()))
                    .thenReturn(List.of(row("STATUS_CHANGES")));
            when(auth.getUsersFromAuthServiceByUserIds(anyList()))
                    .thenReturn(List.of(UserDTO.builder().id("staff-1").fullName("Meera").build()));

            EngagementReportItems out = service.items(INST, " ", today(), "status_changes", "team", null, 1, 5000);

            ArgumentCaptor<MapSqlParameterSource> p = ArgumentCaptor.forClass(MapSqlParameterSource.class);
            ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            verify(dao).page(sql.capture(), eq("TRUE"), anyString(), p.capture());
            assertEquals(List.of("e1", "e2"), p.getValue().getValue("engineIds"));
            assertEquals(500, p.getValue().getValue("limit"));
            assertEquals(500L, p.getValue().getValue("offset"));
            assertTrue(sql.getValue().contains("AND h.source IN ('MANUAL'"));
            assertEquals("STATUS_CHANGES", out.kind());
            assertEquals(TZ, out.timezone());
            assertNull(out.engineId());
            assertEquals(1200, out.total());
            assertEquals(500, out.size());
            assertEquals("Meera", out.rows().get(0).changedByName());
        }

        @Test
        void aPagePastTheEndOrNothingAtAllSkipsThePageQuery() {
            when(dao.count(anyString(), anyString(), any())).thenReturn(40L);

            EngagementReportItems out = service.items(INST, "e1", today(), "DEMOS_BOOKED", null, "asha", 1, 50);

            assertEquals(40, out.total());
            assertTrue(out.rows().isEmpty());
            assertEquals("e1", out.engineId());
            verify(dao, never()).page(anyString(), anyString(), anyString(), any());
        }

        @Test
        void scheduledDemosReadEarliestFirst() {
            when(dao.count(anyString(), anyString(), any())).thenReturn(1L);
            when(dao.page(anyString(), anyString(), anyString(), any())).thenReturn(List.of(row("DEMOS_SCHEDULED")));
            when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenThrow(new RuntimeException("auth down"));

            EngagementReportItems out = service.items(INST, null, today(), "DEMOS_SCHEDULED", "no_show", null, 0, 50);

            verify(dao).page(anyString(), eq("TRUE"), eq("i.sort_at ASC, i.item_key"), any());
            assertNull(out.rows().get(0).hostName());   // auth_service down: names left out, rows still served
        }
    }
}
