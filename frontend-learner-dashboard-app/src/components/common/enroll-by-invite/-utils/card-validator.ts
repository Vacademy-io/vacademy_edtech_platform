/**
 * Card Validator Utilities
 * Implements Luhn algorithm for credit card validation and card type detection
 */
import i18n from "@/i18n";

/**
 * Credit Card Types
 */
export type CardType =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "diners"
  | "jcb"
  | "unknown";

/**
 * Card Type Configuration
 */
interface CardTypeConfig {
  type: CardType;
  patterns: RegExp[];
  length: number[];
  cvvLength: number;
  format: RegExp;
}

/**
 * Card type configurations based on card number patterns
 */
const CARD_TYPES: CardTypeConfig[] = [
  {
    type: "visa",
    patterns: [/^4/],
    length: [13, 16, 19],
    cvvLength: 3,
    format: /(\d{1,4})/g,
  },
  {
    type: "mastercard",
    patterns: [/^5[1-5]/, /^2(2[2-9]|[3-6]|7[0-1]|720)/],
    length: [16],
    cvvLength: 3,
    format: /(\d{1,4})/g,
  },
  {
    type: "amex",
    patterns: [/^3[47]/],
    length: [15],
    cvvLength: 4,
    format: /(\d{1,4})(\d{1,6})?(\d{1,5})?/,
  },
  {
    type: "discover",
    patterns: [/^6(?:011|5)/, /^64[4-9]/, /^65/],
    length: [16],
    cvvLength: 3,
    format: /(\d{1,4})/g,
  },
  {
    type: "diners",
    patterns: [/^3(?:0[0-5]|[68])/, /^5[45]/],
    length: [14, 16],
    cvvLength: 3,
    format: /(\d{1,4})/g,
  },
  {
    type: "jcb",
    patterns: [/^35/],
    length: [16],
    cvvLength: 3,
    format: /(\d{1,4})/g,
  },
];

/**
 * Luhn Algorithm Implementation
 * Validates credit card numbers using the Luhn checksum
 *
 * @param cardNumber - Card number string (digits only)
 * @returns true if card number passes Luhn check, false otherwise
 */
export const luhnCheck = (cardNumber: string): boolean => {
  // Remove all non-digit characters
  const sanitized = cardNumber.replace(/\D/g, "");

  // Card number must be at least 13 digits
  if (sanitized.length < 13) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  // Loop through values starting from the rightmost digit
  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized.charAt(i), 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
};

/**
 * Detect card type from card number
 *
 * @param cardNumber - Card number string
 * @returns CardType enum value
 */
export const detectCardType = (cardNumber: string): CardType => {
  const sanitized = cardNumber.replace(/\D/g, "");

  for (const cardType of CARD_TYPES) {
    for (const pattern of cardType.patterns) {
      if (pattern.test(sanitized)) {
        return cardType.type;
      }
    }
  }

  return "unknown";
};

/**
 * Get card type configuration
 *
 * @param cardType - Card type
 * @returns Card type configuration or undefined
 */
export const getCardTypeConfig = (
  cardType: CardType
): CardTypeConfig | undefined => {
  return CARD_TYPES.find((config) => config.type === cardType);
};

/**
 * Validate card number
 * Checks both format and Luhn algorithm
 *
 * @param cardNumber - Card number string
 * @returns Object with isValid flag and detected card type
 */
export const validateCardNumber = (
  cardNumber: string
): { isValid: boolean; cardType: CardType; error?: string } => {
  const sanitized = cardNumber.replace(/\D/g, "");

  // Check minimum length
  if (sanitized.length < 13) {
    return {
      isValid: false,
      cardType: "unknown",
      error: i18n.t("enrollmentB:cardValidator.tooShort"),
    };
  }

  // Detect card type
  const cardType = detectCardType(sanitized);

  // Check if card type is recognized
  if (cardType === "unknown") {
    return {
      isValid: false,
      cardType: "unknown",
      error: i18n.t("enrollmentB:cardValidator.typeNotRecognized"),
    };
  }

  // Get card type configuration
  const config = getCardTypeConfig(cardType);

  // Check length is valid for this card type
  if (config && !config.length.includes(sanitized.length)) {
    return {
      isValid: false,
      cardType,
      error: i18n.t("enrollmentB:cardValidator.invalidLength", { cardType }),
    };
  }

  // Validate using Luhn algorithm
  if (!luhnCheck(sanitized)) {
    return {
      isValid: false,
      cardType,
      error: i18n.t("enrollmentB:cardValidator.invalidNumber"),
    };
  }

  return {
    isValid: true,
    cardType,
  };
};

/**
 * Format card number with spaces for display
 *
 * @param cardNumber - Card number string
 * @returns Formatted card number
 */
export const formatCardNumber = (cardNumber: string): string => {
  const sanitized = cardNumber.replace(/\D/g, "");
  const cardType = detectCardType(sanitized);
  const config = getCardTypeConfig(cardType);

  if (!config) {
    // Default formatting for unknown cards (groups of 4)
    return sanitized.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
  }

  if (cardType === "amex") {
    // American Express: 4-6-5 format
    return sanitized.replace(/(\d{4})(\d{6})(\d{5})/, "$1 $2 $3").trim();
  }

  // Default: groups of 4
  return sanitized.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
};

/**
 * Validate expiry date
 *
 * @param month - Expiry month (1-12)
 * @param year - Expiry year (2 or 4 digits)
 * @returns Object with isValid flag and error message
 */
export const validateExpiryDate = (
  month: string | number,
  year: string | number
): { isValid: boolean; error?: string } => {
  const monthNum = typeof month === "string" ? parseInt(month, 10) : month;
  let yearNum = typeof year === "string" ? parseInt(year, 10) : year;

  // Validate month
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return {
      isValid: false,
      error: i18n.t("enrollmentB:cardValidator.invalidMonth"),
    };
  }

  // Convert 2-digit year to 4-digit year
  if (yearNum < 100) {
    yearNum += 2000;
  }

  // Validate year
  const currentYear = new Date().getFullYear();
  if (isNaN(yearNum) || yearNum < currentYear) {
    return {
      isValid: false,
      error: i18n.t("enrollmentB:cardValidator.expired"),
    };
  }

  // Check if card has expired
  const currentMonth = new Date().getMonth() + 1;
  if (yearNum === currentYear && monthNum < currentMonth) {
    return {
      isValid: false,
      error: i18n.t("enrollmentB:cardValidator.expired"),
    };
  }

  return {
    isValid: true,
  };
};

/**
 * Parse expiry date from MM/YY or MM/YYYY format
 *
 * @param expiryString - Expiry date string in MM/YY or MM/YYYY format
 * @returns Object with month and year, or null if invalid
 */
export const parseExpiryDate = (
  expiryString: string
): { month: number; year: number } | null => {
  const sanitized = expiryString.replace(/\D/g, "");

  if (sanitized.length < 3) {
    return null;
  }

  const month = parseInt(sanitized.slice(0, 2), 10);
  const yearStr = sanitized.slice(2);
  let year = parseInt(yearStr, 10);

  if (isNaN(month) || isNaN(year)) {
    return null;
  }

  // Convert 2-digit year to 4-digit year
  if (year < 100) {
    year += 2000;
  }

  return { month, year };
};

/**
 * Validate CVV
 *
 * @param cvv - CVV string
 * @param cardType - Card type (affects CVV length requirements)
 * @returns Object with isValid flag and error message
 */
export const validateCVV = (
  cvv: string,
  cardType: CardType = "unknown"
): { isValid: boolean; error?: string } => {
  const sanitized = cvv.replace(/\D/g, "");

  if (sanitized.length === 0) {
    return {
      isValid: false,
      error: i18n.t("enrollmentB:cardValidator.cvvRequired"),
    };
  }

  const config = getCardTypeConfig(cardType);
  const expectedLength = config ? config.cvvLength : 3;

  if (sanitized.length !== expectedLength) {
    return {
      isValid: false,
      error: i18n.t("enrollmentB:cardValidator.cvvLength", { expectedLength }),
    };
  }

  return {
    isValid: true,
  };
};

/**
 * Format expiry date as MM/YY
 *
 * @param value - Input value
 * @returns Formatted expiry date
 */
export const formatExpiryDate = (value: string): string => {
  const sanitized = value.replace(/\D/g, "");

  if (sanitized.length === 0) {
    return "";
  }

  if (sanitized.length <= 2) {
    return sanitized;
  }

  return `${sanitized.slice(0, 2)}/${sanitized.slice(2, 4)}`;
};

/**
 * Get card type display name
 *
 * @param cardType - Card type
 * @returns Display name for the card type
 */
export const getCardTypeDisplayName = (cardType: CardType): string => {
  const displayNames: Record<CardType, string> = {
    visa: i18n.t("enrollmentB:cardValidator.brands.visa"),
    mastercard: i18n.t("enrollmentB:cardValidator.brands.mastercard"),
    amex: i18n.t("enrollmentB:cardValidator.brands.amex"),
    discover: i18n.t("enrollmentB:cardValidator.brands.discover"),
    diners: i18n.t("enrollmentB:cardValidator.brands.diners"),
    jcb: i18n.t("enrollmentB:cardValidator.brands.jcb"),
    unknown: i18n.t("enrollmentB:cardValidator.brands.unknown"),
  };

  return displayNames[cardType] || i18n.t("enrollmentB:cardValidator.brands.unknown");
};
