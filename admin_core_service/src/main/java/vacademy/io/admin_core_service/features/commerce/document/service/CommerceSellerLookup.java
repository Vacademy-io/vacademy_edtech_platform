package vacademy.io.admin_core_service.features.commerce.document.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.Builder;
import lombok.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.StringJoiner;

/**
 * Who the seller is on a document: the location when it carries its own GSTIN and state, the
 * institute tax settings otherwise (seller state comes from the location, institute as
 * fallback). {@code stock_location} belongs to the stock work package;
 * it is only read here, by id and institute, with plain SQL.
 */
@Component
public class CommerceSellerLookup {

    @Value
    @Builder
    public static class Seller {
        String gstin;
        String stateCode;
        String legalName;
        String address;
    }

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Throws 400 when the location is not of this institute, and 409 LOCATION_NEEDS_GSTIN when
     * a REGULAR seller bills from a location in another state than the GSTIN it bills under.
     * A null location gives the institute seller. The cart must take the seller state for its
     * tax request from here too, so an order is never taxed for a seller this method refuses.
     */
    public Seller resolve(String instituteId, String locationId, CommerceTaxContext settings) {
        String gstin = settings.getSellerGstin();
        String state = settings.getSellerStateCode();
        String address = settings.getSellerAddress();
        if (locationId != null) {
            Object[] row = locationRow(instituteId, locationId);
            if (row == null) {
                throw new InvalidRequestException("location_id is not a location of this institute");
            }
            String locationGstin = text(row[1]);
            String locationState = text(row[0]);
            if (locationGstin != null) {
                gstin = locationGstin;
                state = locationState != null ? locationState : statePrefix(locationGstin);
            } else if (locationState != null) {
                // The location sells under the institute GSTIN. A registration covers one state:
                // under it, a sale made in another state is not a local sale, and printing that
                // state as the seller state would tax it as one (CGST and SGST where IGST is due).
                if (settings.getMode() == TaxMode.REGULAR && gstin != null
                        && !locationState.equals(statePrefix(gstin))) {
                    throw new ConflictException("LOCATION_NEEDS_GSTIN: this location is in state " + locationState
                            + " but sells under a GSTIN of state " + statePrefix(gstin)
                            + "; add the GSTIN the seller holds in that state to the location");
                }
                state = locationState;
            }
            StringJoiner joined = new StringJoiner(", ");
            for (int i = 2; i <= 5; i++) {
                if (text(row[i]) != null) {
                    joined.add(text(row[i]));
                }
            }
            if (joined.length() > 0) {
                address = joined.toString();
            }
        }
        return Seller.builder()
                .gstin(gstin)
                .stateCode(state)
                .legalName(settings.getSellerLegalName())
                .address(address)
                .build();
    }

    public boolean locationBelongsToInstitute(String instituteId, String locationId) {
        return locationRow(instituteId, locationId) != null;
    }

    private Object[] locationRow(String instituteId, String locationId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(
                        "SELECT state_code, gstin, address_line1, address_line2, city, pincode"
                                + " FROM stock_location WHERE id = ?1 AND institute_id = ?2")
                .setParameter(1, locationId)
                .setParameter(2, instituteId)
                .getResultList();
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static String statePrefix(String gstin) {
        return gstin.length() >= 2 ? gstin.substring(0, 2) : gstin;
    }

    private static String text(Object value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.toString().trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
