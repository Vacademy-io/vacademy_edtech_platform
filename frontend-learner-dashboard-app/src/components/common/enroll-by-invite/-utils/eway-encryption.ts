/**
 * Eway Client-Side Encryption Utilities
 * Implements Eway Rapid API client-side encryption for secure card data handling
 *
 * Official Documentation:
 * - Eway Rapid API: https://eway.io/api-v3/
 * - Client-Side Encryption: https://eway.io/api-v3/#client-side-encryption
 * - Direct Connection: https://eway.io/api-v3/#direct-connection
 *
 * ⚠️ IMPORTANT: This implementation uses Eway's official eCrypt JavaScript library
 * - Library: https://secure.ewaypayments.com/scripts/eCrypt.min.js
 * - Eway handles all encryption internally (RSA-OAEP with their keys)
 * - We use the eCrypt.encryptValue() function provided by Eway
 * - Output Format: Base64 encoded string prefixed with "eCrypted:"
 *
 * Encryption Specifications (handled by Eway's eCrypt library):
 * - Algorithm: RSA-OAEP (Optimal Asymmetric Encryption Padding)
 * - Key: Eway's Client Side Encryption Key (2048-bit RSA public key)
 * - Only card number and CVN are encrypted (per Eway spec)
 *
 * Security Flow (Direct Connection with Client-Side Encryption):
 * 1. Load Eway's eCrypt.min.js library in the browser
 * 2. Frontend receives Eway's Client Side Encryption Key from backend
 * 3. User enters card details (validated client-side)
 * 4. Use eCrypt.encryptValue() to encrypt card number and CVN separately
 * 5. Encrypted values sent to backend with "eCrypted:" prefix
 * 6. Backend sends encrypted values to Eway's Direct Connection API
 * 7. Eway decrypts using their private key and processes payment
 *
 * ⚠️ SECURITY NOTES:
 * - Card data is encrypted BEFORE leaving the browser
 * - Only card number and CVN are encrypted (as per Eway spec)
 * - Private key must NEVER be exposed to frontend
 * - All API calls must use HTTPS
 * - PCI-DSS compliance is reduced with client-side encryption
 */
import i18n from "@/i18n";

/**
 * Card data interface for encryption
 */
export interface EwayCardData {
  /** Cardholder name */
  name: string;
  /** Card number (digits only) */
  number: string;
  /** Expiry month (MM) */
  expiryMonth: string;
  /** Expiry year (YY or YYYY) */
  expiryYear: string;
  /** CVV/CVN */
  cvn: string;
}

/**
 * Encrypted card data result (per Eway Direct Connection specification)
 */
export interface EncryptedCardData {
  /** Encrypted card number with "eCrypted:" prefix */
  encryptedNumber: string;
  /** Encrypted CVN with "eCrypted:" prefix */
  encryptedCVN: string;
  /** Encryption method used */
  encryptionMethod: string;
}

export const encryptCardData = async (
  cardData: EwayCardData,
  publicKey: string
): Promise<EncryptedCardData> => {
  try {
    // ✅ Step 1: Verify Eway eCrypt library is loaded
    if (!window.eCrypt || typeof window.eCrypt.encryptValue !== "function") {
      throw new Error(
        "Eway eCrypt library not loaded. Please ensure the script is included: " +
          "https://secure.ewaypayments.com/scripts/eCrypt.min.js"
      );
    }

    // ✅ Step 2: Clean and validate card data
    const cleanCardNumber = cardData.number.replace(/\s/g, ""); // Remove spaces
    const cleanCVN = cardData.cvn.trim();

    // ✅ Step 3: Encrypt using Eway's eCrypt.encryptValue() function
    // The eCrypt library handles all RSA-OAEP encryption internally
    // and automatically adds the "eCrypted:" prefix
    const encryptedNumber = window.eCrypt.encryptValue(
      cleanCardNumber,
      publicKey
    );
    const encryptedCVN = window.eCrypt.encryptValue(cleanCVN, publicKey);

    // ✅ Step 4: Verify encrypted values have the correct prefix
    if (
      !encryptedNumber.startsWith("eCrypted:") ||
      !encryptedCVN.startsWith("eCrypted:")
    ) {
      throw new Error(
        "Encryption failed: eCrypt library did not return expected format"
      );
    }

    // ✅ Return encrypted fields (already have "eCrypted:" prefix from eCrypt)
    return {
      encryptedNumber: encryptedNumber,
      encryptedCVN: encryptedCVN,
      encryptionMethod: "eCrypt",
    };
  } catch (error) {
    console.error("❌ Encryption error:", error);
    if (error instanceof Error) {
      throw error; // Re-throw with original message
    }
    throw new Error("Failed to encrypt card data. Please try again.");
  }
};

/**
 * Validate that browser supports required Eway eCrypt library
 *
 * @returns true if Eway eCrypt library is available
 */
export const isCryptoSupported = (): boolean => {
  return !!(window.eCrypt && typeof window.eCrypt.encryptValue === "function");
};

/**
 * Sanitize card data for encryption
 * Removes spaces and formats data appropriately
 *
 * @param cardData - Raw card data
 * @returns Sanitized card data
 */
export const sanitizeCardData = (cardData: EwayCardData): EwayCardData => {
  // Ensure year is in 2-digit format (YY) for storage
  // encryptCardData will convert to YYYY when sending to Eway
  let sanitizedYear = cardData.expiryYear.trim();
  if (sanitizedYear.length === 4) {
    sanitizedYear = sanitizedYear.slice(-2); // Convert YYYY to YY
  }

  return {
    name: cardData.name.trim(),
    number: cardData.number.replace(/\s/g, ""),
    expiryMonth: cardData.expiryMonth.padStart(2, "0"),
    expiryYear: sanitizedYear,
    cvn: cardData.cvn.trim(),
  };
};

export const createEwayTransactionRequest = (
  encryptedData: EncryptedCardData,
  cardData: EwayCardData,
  amount: number,
  currency: string,
  customerData: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }
) => {
  return {
    Payment: {
      TotalAmount: amount,
      CurrencyCode: currency,
    },
    Customer: {
      FirstName: customerData.firstName,
      LastName: customerData.lastName,
      Email: customerData.email,
      Phone: customerData.phone || "",
      Street1: customerData.street1 || "",
      Street2: customerData.street2 || "",
      City: customerData.city || "",
      State: customerData.state || "",
      PostalCode: customerData.postalCode || "",
      Country: customerData.country?.toLowerCase() || "",
      CardDetails: {
        Name: cardData.name, // Plain text
        Number: encryptedData.encryptedNumber, // eCrypted:base64...
        ExpiryMonth: cardData.expiryMonth.padStart(2, "0"), // Plain text
        ExpiryYear:
          cardData.expiryYear.length === 2
            ? cardData.expiryYear
            : cardData.expiryYear.slice(-2), // YY format
        CVN: encryptedData.encryptedCVN, // eCrypted:base64...
      },
    },
    Method: "ProcessPayment",
    TransactionType: "Purchase",
  };
};

/**
 * Format error messages from encryption process
 *
 * @param error - Error object
 * @returns User-friendly error message
 */
export const formatEncryptionError = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message.includes("eCrypt")) {
      return i18n.t("enrollmentB:ewayEncryption.libraryUnavailable");
    }
    if (error.message.includes("encrypt")) {
      return i18n.t("enrollmentB:ewayEncryption.encryptFailed");
    }
    return error.message;
  }
  return i18n.t("enrollmentB:ewayEncryption.unexpectedError");
};

/**
 * Verify encryption library is loaded
 * Helps debug issues with Eway eCrypt library loading
 *
 * @returns Object with validation results
 */
export const verifyeCryptLibrary = (): {
  isLoaded: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  // Check if window.eCrypt exists
  if (typeof window.eCrypt === "undefined") {
    errors.push(
      "Eway eCrypt library not loaded. Add <script src='https://secure.ewaypayments.com/scripts/eCrypt.min.js'></script> to your HTML."
    );
    return { isLoaded: false, errors, warnings, info };
  }

  info.push("✓ window.eCrypt object found");

  // Check if encryptValue function exists
  if (typeof window.eCrypt.encryptValue !== "function") {
    errors.push("window.eCrypt.encryptValue function not found");
    return { isLoaded: false, errors, warnings, info };
  }

  info.push("✓ window.eCrypt.encryptValue function available");

  const isLoaded = errors.length === 0;

  return { isLoaded, errors, warnings, info };
};
