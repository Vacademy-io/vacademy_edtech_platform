package vacademy.io.admin_core_service.features.commerce.accounts.head;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceAccountHead;

import java.util.LinkedHashMap;
import java.util.Map;

/** Request and answer of the account-head routes. */
public final class AccountHeadDtos {

    private AccountHeadDtos() {
    }

    /**
     * Body of {@code POST /account-heads} and {@code PUT /account-heads/{id}}. PUT has no
     * {@code code} (it never changes) and no {@code client_request_id}; it replaces the editable
     * fields, except that an absent {@code is_capital}, {@code position}, {@code status} or
     * {@code expense_kind} keeps the stored value. An absent {@code parent_id},
     * {@code default_itc_eligibility} or {@code default_hsn_code} clears it.
     */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class HeadRequest {
        private String clientRequestId;
        private String code;
        private Map<String, String> nameI18n;
        private String parentId;
        private String nature;
        private String expenseKind;
        private Boolean isCapital;
        private String defaultItcEligibility;
        private String defaultHsnCode;
        private Integer position;
        /** ACTIVE or INACTIVE. */
        private String status;
    }

    /** One account head as the screens see it ({@code account_code} is reserved and not shown). */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class HeadView {
        private String id;
        private String code;
        private Map<String, String> nameI18n;
        private String parentId;
        private String nature;
        private String expenseKind;
        private Boolean isCapital;
        private String defaultItcEligibility;
        private String defaultHsnCode;
        private Boolean isSystem;
        private Integer position;
        private String status;

        public static HeadView of(CommerceAccountHead head) {
            HeadView view = new HeadView();
            view.setId(head.getId());
            view.setCode(head.getCode());
            view.setNameI18n(head.getNameI18n() == null ? null : new LinkedHashMap<>(head.getNameI18n()));
            view.setParentId(head.getParentId());
            view.setNature(head.getNature());
            view.setExpenseKind(head.getExpenseKind());
            view.setIsCapital(head.isCapital());
            view.setDefaultItcEligibility(head.getDefaultItcEligibility());
            view.setDefaultHsnCode(head.getDefaultHsnCode());
            view.setIsSystem(head.isSystem());
            view.setPosition(head.getPosition());
            view.setStatus(head.getStatus());
            return view;
        }
    }
}
