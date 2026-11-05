package vacademy.io.admin_core_service.features.credits.service;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackAdminDTO;
import vacademy.io.admin_core_service.features.credits.entity.CreditPack;
import vacademy.io.admin_core_service.features.credits.entity.CreditPackPrice;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackPriceRepository;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** The super-admin edit of credit packs: what a pack gives, what it costs, and if it is on sale. */
@Service
@RequiredArgsConstructor
public class CreditPackAdminService {

    private final CreditPackRepository packs;
    private final CreditPackPriceRepository prices;

    @Transactional(readOnly = true)
    public List<CreditPackAdminDTO> list() {
        return packs.findAll().stream()
                .sorted(Comparator.comparing(CreditPack::getDisplayOrder,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .map(this::toDto)
                .toList();
    }

    @Transactional
    public CreditPackAdminDTO update(String packId, CreditPackAdminDTO body) {
        CreditPack pack = packs.findById(packId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No such credit pack"));
        if (body.getCredits() != null) {
            if (body.getCredits().compareTo(BigDecimal.ONE) < 0) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "A pack must give at least 1 credit");
            }
            pack.setCredits(body.getCredits());
        }
        if (body.getIsActive() != null) {
            pack.setIsActive(body.getIsActive());
        }
        if (body.getPrices() != null) {
            for (CreditPackAdminDTO.Price in : body.getPrices()) {
                if (in.getCurrency() == null || in.getAmountMinor() == null || in.getAmountMinor() < 1) {
                    throw new VacademyException(HttpStatus.BAD_REQUEST, "Every price must be above zero");
                }
                String currency = in.getCurrency().trim().toUpperCase(Locale.ROOT);
                CreditPackPrice price = prices.findByPackIdAndCurrencyAndIsActiveTrue(packId, currency)
                        .orElseThrow(() -> new VacademyException(HttpStatus.BAD_REQUEST,
                                "This pack has no " + currency + " price to change"));
                price.setAmountMinor(in.getAmountMinor());
                prices.save(price);
            }
        }
        return toDto(packs.save(pack));
    }

    private CreditPackAdminDTO toDto(CreditPack pack) {
        return CreditPackAdminDTO.builder()
                .id(pack.getId())
                .code(pack.getCode())
                .name(pack.getName())
                .credits(pack.getCredits())
                .isActive(pack.getIsActive())
                .prices(prices.findByPackIdAndIsActiveTrue(pack.getId()).stream()
                        .sorted(Comparator.comparing(CreditPackPrice::getCurrency))
                        .map(p -> new CreditPackAdminDTO.Price(p.getCurrency(), p.getAmountMinor()))
                        .toList())
                .build();
    }
}
