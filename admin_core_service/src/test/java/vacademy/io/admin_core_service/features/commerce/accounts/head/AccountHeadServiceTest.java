package vacademy.io.admin_core_service.features.commerce.accounts.head;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.accounts.AccountsAuditKinds;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.head.AccountHeadDtos.HeadView;
import vacademy.io.admin_core_service.features.commerce.accounts.repository.CommerceAccountHeadRepository;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Account heads: seeding, the starter list, creation and edit rules, audit. */
class AccountHeadServiceTest {

    private static final String INST = "inst-1";
    private static final String ACTOR = "user-1";
    private static final ObjectMapper JSON = new ObjectMapper();

    private CommerceAccountHeadRepository heads;
    private CommerceAuditService audit;
    private CommerceRequestGuard requestGuard;
    private final List<AccountHeadUsage> usages = new ArrayList<>();
    private AccountHeadService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        heads = mock(CommerceAccountHeadRepository.class);
        audit = mock(CommerceAuditService.class);
        requestGuard = mock(CommerceRequestGuard.class);
        when(requestGuard.run(any(), any(), any())).thenAnswer(inv ->
                new CommerceRequestGuard.Outcome<>(((Supplier<Object>) inv.getArgument(1)).get(), false));
        when(heads.countByInstituteIdAndCodeIn(anyString(), anyCollection())).thenReturn(25L);
        when(heads.saveAndFlush(any(CommerceAccountHead.class))).thenAnswer(inv -> {
            CommerceAccountHead h = inv.getArgument(0);
            if (h.getId() == null) {
                h.setId("head-new");
            }
            return h;
        });
        usages.clear();
        service = new AccountHeadService(heads, audit, requestGuard, mock(PlatformTransactionManager.class), usages);
    }

    private static Map<String, String> names(String en) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("en", en);
        return m;
    }

    private static HeadRequest create(String code, String nature) {
        HeadRequest r = new HeadRequest();
        r.setClientRequestId("req-12345678");
        r.setCode(code);
        r.setNameI18n(names("Raw material"));
        r.setNature(nature);
        return r;
    }

    private CommerceAccountHead stored(String id, String code, String nature, boolean system) {
        CommerceAccountHead h = new CommerceAccountHead();
        h.setId(id);
        h.setInstituteId(INST);
        h.setCode(code);
        h.setNameI18n(names(code));
        h.setNature(nature);
        h.setExpenseKind("EXPENSE".equals(nature) ? "INDIRECT" : null);
        h.setSystem(system);
        h.setPosition(10);
        h.setStatus("ACTIVE");
        when(heads.findByInstituteIdAndId(INST, id)).thenReturn(Optional.of(h));
        return h;
    }

    private static HeadRequest edit(CommerceAccountHead h) {
        HeadRequest r = new HeadRequest();
        r.setNameI18n(new LinkedHashMap<>(h.getNameI18n()));
        r.setNature(h.getNature());
        r.setParentId(h.getParentId());
        return r;
    }

    private static void assertValidation(Runnable call) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, call::run);
        assertTrue(e.getMessage().startsWith("VALIDATION: "), e.getMessage());
    }

    private static void assertConflict(String code, Runnable call) {
        ConflictException e = assertThrows(ConflictException.class, call::run);
        assertTrue(e.getMessage().startsWith(code + ": "), e.getMessage());
    }

    // ------------------------------------------------------------------ starter list and seed

    @Test
    void starterListIsTwentyFiveNeutralHeadsSevenSystem() {
        assertEquals(25, StarterHeads.ALL.size());
        assertEquals(7, StarterHeads.ALL.stream().filter(StarterHeads.Starter::system).count());
        assertEquals(25, new HashSet<>(StarterHeads.CODES).size());
        for (StarterHeads.Starter s : StarterHeads.ALL) {
            assertTrue(AccountHeadService.CODE.matcher(s.code()).matches(), s.code());
            assertFalse(s.en().isBlank());
            assertFalse(s.hi().isBlank());
            assertTrue(s.en().length() <= 100 && s.hi().length() <= 100);
            assertEquals("EXPENSE".equals(s.nature()), s.expenseKind() != null, s.code());
        }
        Set<String> direct = new HashSet<>();
        StarterHeads.ALL.stream().filter(s -> "DIRECT".equals(s.expenseKind())).forEach(s -> direct.add(s.code()));
        assertEquals(Set.of("FREIGHT_AND_COURIER", "WAGES"), direct);
        assertEquals(List.of("EQUIPMENT"),
                StarterHeads.ALL.stream().filter(StarterHeads.Starter::capital).map(StarterHeads.Starter::code).toList());
        assertEquals(Set.of("GATEWAY_CHARGES", "COURIER_CHARGES", "CASH_SHORT_OVER", "SETTLEMENT_DISCOUNT",
                        "TDS_PAYABLE", "GST_PAID", "RCM_TAX_PAID"),
                new HashSet<>(StarterHeads.ALL.stream().filter(StarterHeads.Starter::system)
                        .map(StarterHeads.Starter::code).toList()));
    }

    @Test
    void seedInsertsTwentyFiveThenNothing() throws Exception {
        when(heads.countByInstituteIdAndCodeIn(eq(INST), anyCollection())).thenReturn(0L, 25L);
        when(heads.seedStarter(anyString(), eq(INST), anyString(), anyString(), anyString(), any(), anyBoolean(),
                anyBoolean(), anyInt(), any())).thenReturn(1);

        assertEquals(25, service.ensureSeeded(INST, ACTOR));
        assertEquals(0, service.ensureSeeded(INST, ACTOR));

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(heads, times(25)).seedStarter(anyString(), eq(INST), anyString(), json.capture(), anyString(), any(),
                anyBoolean(), anyBoolean(), anyInt(), eq(ACTOR));
        JsonNode rent = JSON.readTree(json.getAllValues().get(0));
        assertEquals("Rent", rent.get("en").asText());
        assertEquals("किराया", rent.get("hi").asText());
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit, times(1)).record(eq(INST), eq(ACTOR), isNull(), eq(AccountsAuditKinds.ACCOUNT_HEADS_SEED),
                eq("ACCOUNT_HEAD"), eq(INST), isNull(), detail.capture(), isNull());
        assertEquals(25, JSON.readTree(detail.getValue()).get("inserted").asInt());
    }

    @Test
    void seedThatFindsEverythingPresentWritesNoAudit() {
        when(heads.countByInstituteIdAndCodeIn(eq(INST), anyCollection())).thenReturn(0L);
        when(heads.seedStarter(anyString(), anyString(), anyString(), anyString(), anyString(), any(), anyBoolean(),
                anyBoolean(), anyInt(), any())).thenReturn(0);
        assertEquals(0, service.ensureSeeded(INST));
        verify(audit, never()).record(anyString(), any(), any(), anyString(), any(), any(), any(), any(), any());
    }

    @Test
    void everyRouteSeedsFirst() {
        when(heads.countByInstituteIdAndCodeIn(eq(INST), anyCollection())).thenReturn(0L);
        when(heads.findForList(INST, null, null)).thenReturn(List.of());
        service.list(INST, ACTOR, null, null);
        verify(heads, times(25)).seedStarter(anyString(), eq(INST), anyString(), anyString(), anyString(), any(),
                anyBoolean(), anyBoolean(), anyInt(), any());
    }

    // ------------------------------------------------------------------ list

    @Test
    void listFiltersAndRefusesUnknownValues() {
        when(heads.findForList(INST, "EXPENSE", "ACTIVE")).thenReturn(List.of());
        service.list(INST, ACTOR, "expense", "active");
        verify(heads).findForList(INST, "EXPENSE", "ACTIVE");
        assertThrows(InvalidRequestException.class, () -> service.list(INST, ACTOR, "COST", null));
        assertThrows(InvalidRequestException.class, () -> service.list(INST, ACTOR, null, "ALL"));
    }

    // ------------------------------------------------------------------ create

    @Test
    void createWritesHeadAndAuditWithOldNull() throws Exception {
        HeadView view = service.create(INST, ACTOR, create("raw_material", "EXPENSE"));
        assertEquals("RAW_MATERIAL", view.getCode());
        assertEquals("INDIRECT", view.getExpenseKind());
        assertEquals(Boolean.FALSE, view.getIsSystem());
        assertEquals("ACTIVE", view.getStatus());
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq(ACTOR), isNull(), eq(AccountsAuditKinds.ACCOUNT_HEAD_EDIT),
                eq("ACCOUNT_HEAD"), eq("head-new"), isNull(), json.capture(), isNull());
        assertEquals("RAW_MATERIAL", JSON.readTree(json.getValue()).get("code").asText());
    }

    @Test
    void createRequiresAClientKey() {
        HeadRequest r = create("RAW", "EXPENSE");
        r.setClientRequestId(null);
        assertValidation(() -> service.create(INST, ACTOR, r));
    }

    @Test
    void duplicateCodeIs409() {
        when(heads.existsByInstituteIdAndCode(INST, "RENT")).thenReturn(true);
        assertConflict("DUPLICATE_CODE", () -> service.create(INST, ACTOR, create("RENT", "EXPENSE")));
        org.mockito.Mockito.doThrow(new DataIntegrityViolationException(
                "duplicate key value violates unique constraint \"uq_commerce_account_head_code\""))
                .when(requestGuard).run(any(), any(), any());
        assertConflict("DUPLICATE_CODE", () -> service.create(INST, ACTOR, create("RAW", "EXPENSE")));
    }

    @Test
    void codeShape() {
        assertValidation(() -> service.create(INST, ACTOR, create("RAW MATERIAL", "EXPENSE")));
        assertValidation(() -> service.create(INST, ACTOR, create("R".repeat(33), "EXPENSE")));
        assertValidation(() -> service.create(INST, ACTOR, create(" ", "EXPENSE")));
    }

    @Test
    void expenseKindOnlyForExpense() {
        HeadRequest income = create("FEES", "INCOME");
        income.setExpenseKind("DIRECT");
        assertValidation(() -> service.create(INST, ACTOR, income));
        HeadRequest direct = create("RAW", "EXPENSE");
        direct.setExpenseKind("direct");
        assertEquals("DIRECT", service.create(INST, ACTOR, direct).getExpenseKind());
        assertNull(service.create(INST, ACTOR, create("FEES", "INCOME")).getExpenseKind());
        assertValidation(() -> service.create(INST, ACTOR, create("X", "COST")));
    }

    @Test
    void nameI18nRules() {
        HeadRequest noEn = create("RAW", "EXPENSE");
        noEn.setNameI18n(Map.of("hi", "x"));
        assertValidation(() -> service.create(INST, ACTOR, noEn));
        HeadRequest badKey = create("RAW", "EXPENSE");
        badKey.setNameI18n(Map.of("en", "Raw", "HI", "x"));
        assertValidation(() -> service.create(INST, ACTOR, badKey));
        HeadRequest tooMany = create("RAW", "EXPENSE");
        tooMany.setNameI18n(Map.of("en", "a", "hi", "b", "ta", "c", "te", "d", "bn", "e", "mr", "f"));
        assertValidation(() -> service.create(INST, ACTOR, tooMany));
        HeadRequest tooLong = create("RAW", "EXPENSE");
        tooLong.setNameI18n(Map.of("en", "x".repeat(101)));
        assertValidation(() -> service.create(INST, ACTOR, tooLong));
        HeadRequest blank = create("RAW", "EXPENSE");
        blank.setNameI18n(Map.of("en", "Raw", "hi", " "));
        assertValidation(() -> service.create(INST, ACTOR, blank));
        HeadRequest ok = create("RAW", "EXPENSE");
        ok.setNameI18n(Map.of("hi", "कच्चा माल", "en", "  Raw material "));
        HeadView view = service.create(INST, ACTOR, ok);
        assertEquals("Raw material", view.getNameI18n().get("en"));
        assertEquals("en", view.getNameI18n().keySet().iterator().next());
    }

    @Test
    void hsnAndPositionRules() {
        HeadRequest hsn = create("RAW", "EXPENSE");
        hsn.setDefaultHsnCode("12a4");
        assertValidation(() -> service.create(INST, ACTOR, hsn));
        hsn.setDefaultHsnCode("123");
        assertValidation(() -> service.create(INST, ACTOR, hsn));
        hsn.setDefaultHsnCode("12345678");
        assertEquals("12345678", service.create(INST, ACTOR, hsn).getDefaultHsnCode());
        HeadRequest pos = create("RAW2", "EXPENSE");
        pos.setPosition(-1);
        assertValidation(() -> service.create(INST, ACTOR, pos));
        HeadRequest itc = create("RAW3", "EXPENSE");
        itc.setDefaultItcEligibility("MAYBE");
        assertValidation(() -> service.create(INST, ACTOR, itc));
    }

    @Test
    void parentIsOneLevelSameNatureAndOfThisInstitute() {
        stored("p-exp", "RENT", "EXPENSE", false);
        stored("p-inc", "OTHER_INCOME", "INCOME", false);
        CommerceAccountHead child = stored("p-child", "SHOP_RENT", "EXPENSE", false);
        child.setParentId("p-exp");

        HeadRequest otherNature = create("RAW", "EXPENSE");
        otherNature.setParentId("p-inc");
        assertValidation(() -> service.create(INST, ACTOR, otherNature));

        HeadRequest twoLevels = create("RAW", "EXPENSE");
        twoLevels.setParentId("p-child");
        assertValidation(() -> service.create(INST, ACTOR, twoLevels));

        HeadRequest missing = create("RAW", "EXPENSE");
        missing.setParentId("p-other-institute");
        VacademyException e = assertThrows(VacademyException.class, () -> service.create(INST, ACTOR, missing));
        assertTrue(e.getMessage().startsWith("NOT_FOUND"));

        HeadRequest ok = create("RAW", "EXPENSE");
        ok.setParentId("p-exp");
        assertEquals("p-exp", service.create(INST, ACTOR, ok).getParentId());
    }

    // ------------------------------------------------------------------ edit

    @Test
    void codeIsImmutable() {
        CommerceAccountHead h = stored("h1", "RAW", "EXPENSE", false);
        HeadRequest r = edit(h);
        r.setCode("OTHER");
        assertValidation(() -> service.update(INST, ACTOR, "h1", r));
        r.setCode("raw");
        service.update(INST, ACTOR, "h1", r);
    }

    @Test
    void unknownHeadIs404() {
        HeadRequest r = new HeadRequest();
        r.setNameI18n(names("x"));
        r.setNature("EXPENSE");
        VacademyException e = assertThrows(VacademyException.class, () -> service.update(INST, ACTOR, "nope", r));
        assertTrue(e.getMessage().startsWith("NOT_FOUND"));
    }

    @Test
    void systemHeadLocksNatureStatusParentCapitalAndKind() {
        CommerceAccountHead h = stored("sys", "GATEWAY_CHARGES", "EXPENSE", true);
        stored("p-exp", "RENT", "EXPENSE", false);

        HeadRequest nature = edit(h);
        nature.setNature("INCOME");
        assertConflict("SYSTEM_HEAD", () -> service.update(INST, ACTOR, "sys", nature));
        HeadRequest status = edit(h);
        status.setStatus("INACTIVE");
        assertConflict("SYSTEM_HEAD", () -> service.update(INST, ACTOR, "sys", status));
        HeadRequest parent = edit(h);
        parent.setParentId("p-exp");
        assertConflict("SYSTEM_HEAD", () -> service.update(INST, ACTOR, "sys", parent));
        HeadRequest capital = edit(h);
        capital.setIsCapital(true);
        assertConflict("SYSTEM_HEAD", () -> service.update(INST, ACTOR, "sys", capital));
        HeadRequest kind = edit(h);
        kind.setExpenseKind("DIRECT");
        assertConflict("SYSTEM_HEAD", () -> service.update(INST, ACTOR, "sys", kind));
        verify(audit, never()).record(anyString(), any(), any(), anyString(), any(), any(), any(), any(), any());

        HeadRequest rename = edit(h);
        rename.setNameI18n(Map.of("en", "Card and UPI charges"));
        rename.setPosition(5);
        rename.setDefaultHsnCode("9971");
        HeadView view = service.update(INST, ACTOR, "sys", rename);
        assertEquals("Card and UPI charges", view.getNameI18n().get("en"));
        assertEquals(5, view.getPosition());
    }

    @Test
    void inactiveWithActiveChildrenIs409() {
        CommerceAccountHead h = stored("h1", "RENT", "EXPENSE", false);
        when(heads.existsByInstituteIdAndParentIdAndStatus(INST, "h1", "ACTIVE")).thenReturn(true);
        HeadRequest r = edit(h);
        r.setStatus("INACTIVE");
        assertConflict("HEAD_HAS_CHILDREN", () -> service.update(INST, ACTOR, "h1", r));
        when(heads.existsByInstituteIdAndParentIdAndStatus(INST, "h1", "ACTIVE")).thenReturn(false);
        assertEquals("INACTIVE", service.update(INST, ACTOR, "h1", r).getStatus());
    }

    @Test
    void natureChangeIsVetoedByUsage() {
        CommerceAccountHead h = stored("h1", "MISC", "EXPENSE", false);
        AtomicInteger asked = new AtomicInteger();
        usages.add((inst, id) -> {
            asked.incrementAndGet();
            return "h1".equals(id);
        });
        service = new AccountHeadService(heads, audit, requestGuard, mock(PlatformTransactionManager.class), usages);
        HeadRequest r = edit(h);
        r.setNature("ASSET");
        assertConflict("HEAD_IN_USE", () -> service.update(INST, ACTOR, "h1", r));
        assertEquals(1, asked.get());
        usages.clear();
        service = new AccountHeadService(heads, audit, requestGuard, mock(PlatformTransactionManager.class), usages);
        HeadView view = service.update(INST, ACTOR, "h1", r);
        assertEquals("ASSET", view.getNature());
        assertNull(view.getExpenseKind());
    }

    @Test
    void natureChangeWithSubHeadsIs409() {
        CommerceAccountHead h = stored("h1", "MISC", "EXPENSE", false);
        when(heads.existsByInstituteIdAndParentId(INST, "h1")).thenReturn(true);
        HeadRequest r = edit(h);
        r.setNature("ASSET");
        assertConflict("HEAD_HAS_CHILDREN", () -> service.update(INST, ACTOR, "h1", r));
    }

    @Test
    void headWithChildrenCannotGetAParentNorBeItsOwn() {
        CommerceAccountHead h = stored("h1", "MISC", "EXPENSE", false);
        stored("p-exp", "RENT", "EXPENSE", false);
        when(heads.existsByInstituteIdAndParentId(INST, "h1")).thenReturn(true);
        HeadRequest r = edit(h);
        r.setParentId("p-exp");
        assertValidation(() -> service.update(INST, ACTOR, "h1", r));
        HeadRequest self = edit(h);
        self.setParentId("h1");
        assertValidation(() -> service.update(INST, ACTOR, "h1", self));
    }

    @Test
    void editAuditsChangedFieldsOnlyAndNoChangeWritesNothing() throws Exception {
        CommerceAccountHead h = stored("h1", "MISC", "EXPENSE", false);
        service.update(INST, ACTOR, "h1", edit(h));
        verify(heads, never()).saveAndFlush(any(CommerceAccountHead.class));
        verify(audit, never()).record(anyString(), any(), any(), anyString(), any(), any(), any(), any(), any());

        HeadRequest r = edit(h);
        r.setPosition(99);
        service.update(INST, ACTOR, "h1", r);
        ArgumentCaptor<String> oldJson = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> newJson = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq(INST), eq(ACTOR), isNull(), eq(AccountsAuditKinds.ACCOUNT_HEAD_EDIT),
                eq("ACCOUNT_HEAD"), eq("h1"), oldJson.capture(), newJson.capture(), isNull());
        assertEquals("{\"position\":10}", oldJson.getValue());
        assertEquals("{\"position\":99}", newJson.getValue());
    }

    @Test
    void absentKindPositionCapitalAndStatusKeepTheStoredValues() {
        CommerceAccountHead h = stored("h1", "FREIGHT", "EXPENSE", false);
        h.setExpenseKind("DIRECT");
        h.setCapital(true);
        h.setStatus("INACTIVE");
        HeadView view = service.update(INST, ACTOR, "h1", edit(h));
        assertEquals("DIRECT", view.getExpenseKind());
        assertEquals(Boolean.TRUE, view.getIsCapital());
        assertEquals("INACTIVE", view.getStatus());
        assertEquals(10, view.getPosition());
    }

    // ------------------------------------------------------------------ JSON

    @Test
    void headViewJsonUsesSnakeCaseFlagsAndHidesAccountCode() throws Exception {
        CommerceAccountHead h = stored("h1", "RENT", "EXPENSE", true);
        h.setCapital(true);
        h.setAccountCode("5000");
        JsonNode json = JSON.readTree(JSON.writeValueAsString(HeadView.of(h)));
        assertTrue(json.get("is_capital").asBoolean());
        assertTrue(json.get("is_system").asBoolean());
        assertEquals("RENT", json.get("name_i18n").get("en").asText());
        assertFalse(json.has("account_code"));
        assertFalse(json.has("capital"));
        assertFalse(json.has("system"));

        HeadRequest parsed = JSON.readValue("{\"client_request_id\":\"k-12345678\",\"code\":\"X\",\"is_capital\":true,"
                + "\"name_i18n\":{\"en\":\"X\"},\"default_hsn_code\":\"1234\"}", HeadRequest.class);
        assertEquals(Boolean.TRUE, parsed.getIsCapital());
        assertEquals("1234", parsed.getDefaultHsnCode());
        assertEquals("k-12345678", parsed.getClientRequestId());
    }
}
