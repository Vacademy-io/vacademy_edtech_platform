package vacademy.io.admin_core_service.features.product_page.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;

import java.util.Collection;
import java.util.List;

/**
 * Batched reads behind a product page response, so a page costs a fixed
 * number of queries whatever the number of courses on it. by-code used to run
 * three per course (the bridge row, the plan, the invite's custom fields).
 */
@Repository
public interface ProductPageReadRepository extends org.springframework.data.repository.Repository<PaymentPlan, String> {

    /** The plans, each with its payment option (an eager association) in the same query. */
    @Query("SELECT p FROM PaymentPlan p LEFT JOIN FETCH p.paymentOption WHERE p.id IN :ids")
    List<PaymentPlan> findPlansWithOptionByIdIn(@Param("ids") Collection<String> ids);

    /**
     * The custom fields of several invites at once: rows of
     * [InstituteCustomField, CustomFields], the same pair, filter and order
     * InstituteCustomFiledService.findCustomFieldsAsJson reads for one invite
     * (per-form position, then the master order), plus created_at and id so
     * fields sharing a position keep one stable order instead of whatever
     * order the database returns them in.
     */
    @Query("SELECT icf, cf FROM InstituteCustomField icf, CustomFields cf "
            + "WHERE cf.id = icf.customFieldId "
            + "AND icf.instituteId = :instituteId "
            + "AND icf.type = :type "
            + "AND icf.typeId IN :typeIds "
            + "AND icf.status = :status "
            + "ORDER BY COALESCE(icf.individualOrder, cf.formOrder) ASC, cf.formOrder ASC, "
            + "icf.createdAt ASC, icf.id ASC")
    List<Object[]> findCustomFieldsWithDetailsForTypeIds(@Param("instituteId") String instituteId,
                                                         @Param("type") String type,
                                                         @Param("typeIds") Collection<String> typeIds,
                                                         @Param("status") String status);
}
