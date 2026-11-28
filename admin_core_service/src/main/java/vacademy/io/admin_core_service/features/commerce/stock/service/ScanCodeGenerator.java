package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;

import java.security.SecureRandom;

/**
 * Issues both kinds of scan code: a piece code starts with {@code P}, a
 * variant label code with {@code V}, each followed by nine random characters, so one code can
 * never match both. The alphabet leaves out 0, O, 1 and I, which are misread on a printed label.
 */
@Component
public class ScanCodeGenerator {

    public static final char PIECE_PREFIX = 'P';
    public static final char VARIANT_PREFIX = 'V';
    public static final int CODE_LENGTH = 10;
    static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final int MAX_TRIES = 8;

    private final SecureRandom random = new SecureRandom();
    private final CommercePieceRepository pieceRepository;
    private final StockVariantRepository variantRepository;

    public ScanCodeGenerator(CommercePieceRepository pieceRepository, StockVariantRepository variantRepository) {
        this.pieceRepository = pieceRepository;
        this.variantRepository = variantRepository;
    }

    /** A piece code no piece has yet. The UNIQUE key on the column settles a race. */
    public String newPieceCode() {
        for (int i = 0; i < MAX_TRIES; i++) {
            String code = random(PIECE_PREFIX);
            if (!pieceRepository.existsByCode(code)) {
                return code;
            }
        }
        throw new IllegalStateException("could not find an unused piece code");
    }

    public String newVariantLabelCode() {
        for (int i = 0; i < MAX_TRIES; i++) {
            String code = random(VARIANT_PREFIX);
            if (variantRepository.countByLabelCode(code) == 0) {
                return code;
            }
        }
        throw new IllegalStateException("could not find an unused label code");
    }

    /** True for a string shaped like a code of the given kind. Says nothing about existence. */
    public static boolean looksLike(char prefix, String code) {
        if (code == null || code.length() != CODE_LENGTH || code.charAt(0) != prefix) {
            return false;
        }
        for (int i = 1; i < code.length(); i++) {
            if (ALPHABET.indexOf(code.charAt(i)) < 0) {
                return false;
            }
        }
        return true;
    }

    private String random(char prefix) {
        StringBuilder code = new StringBuilder(CODE_LENGTH).append(prefix);
        for (int i = 1; i < CODE_LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }
}
