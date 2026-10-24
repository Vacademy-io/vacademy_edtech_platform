import { useState, useEffect, useRef, useCallback, ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useEway } from "../-hooks/use-eway";
import {
  validateCardNumber,
  validateExpiryDate,
  validateCVV,
  formatCardNumber,
  CardType,
  getCardTypeDisplayName,
} from "../-utils/card-validator";
import {
  encryptCardData,
  isCryptoSupported,
  sanitizeCardData,
  EwayCardData,
  formatEncryptionError,
} from "../-utils/eway-encryption";
import { Input } from "@/components/ui/input";

/**
 * Eway Card Form Props
 */
interface EwayCardFormProps {
  isProcessing?: boolean;
  onPaymentReady: (encryptedData: {
    encryptedNumber: string;
    encryptedCVN: string;
    cardData: {
      name: string;
      expiryMonth: string;
      expiryYear: string;
    };
  } | null) => void;
  onError?: (error: string) => void;
}

/**
 * Eway Card Payment Form Component
 *
 * Collects card details, validates them, and auto-encrypts using Eway's encryption key
 * when all fields are valid. No separate "Verify" button needed — the parent's
 * "Confirm & Pay" button handles submission once encryption is complete.
 */
export const EwayCardForm = ({
  onPaymentReady,
  onError,
  isProcessing = false,
}: EwayCardFormProps) => {
  const { t } = useTranslation("enrollmentA");
  const { encryptionKey, isConfigured } = useEway();

  // Form state
  const [cardData, setCardData] = useState<EwayCardData>({
    name: "",
    number: "",
    expiryMonth: "",
    expiryYear: "",
    cvn: "",
  });

  // Validation state
  const [errors, setErrors] = useState<
    Partial<Record<keyof EwayCardData, string>>
  >({});
  const [cardType, setCardType] = useState<CardType>("unknown");
  const [touched, setTouched] = useState<
    Partial<Record<keyof EwayCardData, boolean>>
  >({});

  // Refs for parent callbacks to avoid dependency cycles if parent re-renders frequently
  const onPaymentReadyRef = useRef(onPaymentReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onPaymentReadyRef.current = onPaymentReady;
  }, [onPaymentReady]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Track whether encryption has been sent to parent to avoid duplicates
  const lastEncryptedRef = useRef<string>("");
  const encryptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if crypto is supported
  const cryptoSupported = isCryptoSupported();

  /**
   * Validate individual field (returns error string or undefined)
   */
  const getFieldError = useCallback(
    (field: keyof EwayCardData, data: EwayCardData, type: CardType): string | undefined => {
      switch (field) {
        case "number": {
          const v = validateCardNumber(data.number);
          return v.isValid ? undefined : v.error;
        }
        case "expiryMonth":
        case "expiryYear": {
          if (data.expiryMonth && data.expiryYear) {
            const v = validateExpiryDate(data.expiryMonth, data.expiryYear);
            return v.isValid ? undefined : v.error;
          }
          return t("ewayCardForm.errors.expiryRequired");
        }
        case "cvn": {
          const v = validateCVV(data.cvn, type);
          return v.isValid ? undefined : v.error;
        }
        case "name":
          return data.name.trim().length < 2 ? t("ewayCardForm.errors.nameRequired") : undefined;
      }
    },
    [t]
  );

  /**
   * Check if all fields are valid without setting error state
   */
  const isFormComplete = useCallback(
    (data: EwayCardData, type: CardType): boolean => {
      const fields: Array<keyof EwayCardData> = ["name", "number", "expiryMonth", "cvn"];
      return fields.every((f) => !getFieldError(f, data, type));
    },
    [getFieldError]
  );

  /**
   * Auto-encrypt when all fields become valid.
   * Debounced to avoid encrypting on every keystroke.
   */
  const tryAutoEncrypt = useCallback(
    (data: EwayCardData, type: CardType) => {
      // Clear any pending encryption
      if (encryptTimeoutRef.current) {
        clearTimeout(encryptTimeoutRef.current);
      }

      if (!isFormComplete(data, type)) {
        // Form became invalid — clear any previously sent encrypted data
        if (lastEncryptedRef.current) {
          lastEncryptedRef.current = "";
          onPaymentReadyRef.current(null);
        }
        return;
      }
      if (!cryptoSupported || !isConfigured || !encryptionKey) return;

      // Build a fingerprint to avoid re-encrypting identical data
      const fingerprint = `${data.number}|${data.cvn}|${data.name}|${data.expiryMonth}|${data.expiryYear}`;
      if (fingerprint === lastEncryptedRef.current) return;

      encryptTimeoutRef.current = setTimeout(async () => {
        try {
          const sanitized = sanitizeCardData(data);
          const encrypted = await encryptCardData(sanitized, encryptionKey);

          lastEncryptedRef.current = fingerprint;

          onPaymentReadyRef.current({
            encryptedNumber: encrypted.encryptedNumber,
            encryptedCVN: encrypted.encryptedCVN,
            cardData: {
              name: sanitized.name,
              expiryMonth: sanitized.expiryMonth,
              expiryYear: sanitized.expiryYear,
            },
          });
        } catch (error) {
          const errorMsg = formatEncryptionError(error);
          onErrorRef.current?.(errorMsg);
          console.error("Encryption error:", error);
        }
      }, 300);
    },
    [cryptoSupported, isConfigured, encryptionKey, isFormComplete]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (encryptTimeoutRef.current) clearTimeout(encryptTimeoutRef.current);
    };
  }, []);

  /**
   * Handle card number change with formatting
   */
  const handleCardNumberChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\s/g, "");
    const next = { ...cardData, number: value };
    setCardData(next);

    const validation = validateCardNumber(value);
    const newType = validation.cardType;
    setCardType(newType);

    if (touched.number) {
      setErrors((prev) => ({
        ...prev,
        number: validation.isValid ? undefined : validation.error,
      }));
    }

    // Reset encryption if card data changes
    lastEncryptedRef.current = "";
    tryAutoEncrypt(next, newType);
  };

  /**
   * Handle expiry date change with formatting
   */
  const handleExpiryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const digitsOnly = value.replace(/\D/g, "");
    const limitedDigits = digitsOnly.slice(0, 4);

    let month = "";
    let year = "";

    if (limitedDigits.length >= 1) {
      month = limitedDigits.slice(0, Math.min(2, limitedDigits.length));
    }
    if (limitedDigits.length > 2) {
      year = limitedDigits.slice(2);
    }

    const next = { ...cardData, expiryMonth: month, expiryYear: year };
    setCardData(next);

    if (touched.expiryMonth || touched.expiryYear) {
      if (limitedDigits.length === 4) {
        const fullYear = year.length === 2 ? `20${year}` : year;
        const validation = validateExpiryDate(month, fullYear);
        setErrors((prev) => ({
          ...prev,
          expiryMonth: validation.isValid ? undefined : validation.error,
          expiryYear: validation.isValid ? undefined : validation.error,
        }));
      } else {
        setErrors((prev) => ({
          ...prev,
          expiryMonth: undefined,
          expiryYear: undefined,
        }));
      }
    }

    lastEncryptedRef.current = "";
    tryAutoEncrypt(next, cardType);
  };

  /**
   * Handle CVV change
   */
  const handleCVVChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 4);
    const next = { ...cardData, cvn: value };
    setCardData(next);

    if (touched.cvn) {
      const validation = validateCVV(value, cardType);
      setErrors((prev) => ({
        ...prev,
        cvn: validation.isValid ? undefined : validation.error,
      }));
    }

    lastEncryptedRef.current = "";
    tryAutoEncrypt(next, cardType);
  };

  /**
   * Handle cardholder name change
   */
  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const next = { ...cardData, name: value };
    setCardData(next);

    if (touched.name) {
      setErrors((prev) => ({
        ...prev,
        name: value.trim().length < 2 ? t("ewayCardForm.errors.nameRequired") : undefined,
      }));
    }

    lastEncryptedRef.current = "";
    tryAutoEncrypt(next, cardType);
  };

  /**
   * Mark field as touched and validate
   */
  const handleBlur = (field: keyof EwayCardData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));

    const error = getFieldError(field, cardData, cardType);
    setErrors((prev) => ({ ...prev, [field]: error }));

    // Also try encrypting on blur (user may have tab'd through the last field)
    tryAutoEncrypt(cardData, cardType);
  };

  return (
    <div className="space-y-4">
      {/* Card Number */}
      <div>
        <label
          htmlFor="cardNumber"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t("ewayCardForm.cardNumber")}
        </label>
        <div className="relative">
          <Input
            id="cardNumber"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder={t("ewayCardForm.cardNumberPlaceholder")}
            value={formatCardNumber(cardData.number)}
            onChange={handleCardNumberChange}
            onBlur={() => handleBlur("number")}
            disabled={isProcessing}
            className={errors.number && touched.number ? "border-red-500" : ""}
          />
          {cardType !== "unknown" && (
            <div className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
              {getCardTypeDisplayName(cardType)}
            </div>
          )}
        </div>
        {errors.number && touched.number && (
          <p className="mt-1 text-sm text-red-600">{errors.number}</p>
        )}
      </div>

      {/* Cardholder Name */}
      <div>
        <label
          htmlFor="cardName"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t("ewayCardForm.cardholderName")}
        </label>
        <Input
          id="cardName"
          type="text"
          autoComplete="cc-name"
          placeholder={t("ewayCardForm.cardholderNamePlaceholder")}
          value={cardData.name}
          onChange={handleNameChange}
          onBlur={() => handleBlur("name")}
          disabled={isProcessing}
          className={errors.name && touched.name ? "border-red-500" : ""}
        />
        {errors.name && touched.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name}</p>
        )}
      </div>

      {/* Expiry and CVV Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Expiry Date */}
        <div>
          <label
            htmlFor="cardExpiry"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t("ewayCardForm.expiryDate")}
          </label>
          <Input
            id="cardExpiry"
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder={t("ewayCardForm.expiryPlaceholder")}
            value={(() => {
              const month = cardData.expiryMonth;
              const year = cardData.expiryYear;
              if (!month) return "";
              if (month && !year) return month;
              if (month && year) return `${month}/${year}`;
              return month;
            })()}
            onChange={handleExpiryChange}
            onBlur={() => {
              handleBlur("expiryMonth");
              handleBlur("expiryYear");
            }}
            maxLength={5}
            disabled={isProcessing}
            className={
              (errors.expiryMonth || errors.expiryYear) &&
              (touched.expiryMonth || touched.expiryYear)
                ? "border-red-500"
                : ""
            }
          />
          {(errors.expiryMonth || errors.expiryYear) &&
            (touched.expiryMonth || touched.expiryYear) && (
              <p className="mt-1 text-sm text-red-600">
                {errors.expiryMonth || errors.expiryYear}
              </p>
            )}
        </div>

        {/* CVV */}
        <div>
          <label
            htmlFor="cardCVV"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t("ewayCardForm.cvv")}
          </label>
          <Input
            id="cardCVV"
            type="text"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder={cardType === "amex" ? t("ewayCardForm.cvvPlaceholderAmex") : t("ewayCardForm.cvvPlaceholder")}
            value={cardData.cvn}
            onChange={handleCVVChange}
            onBlur={() => handleBlur("cvn")}
            maxLength={cardType === "amex" ? 4 : 3}
            disabled={isProcessing}
            className={errors.cvn && touched.cvn ? "border-red-500" : ""}
          />
          {errors.cvn && touched.cvn && (
            <p className="mt-1 text-sm text-red-600">{errors.cvn}</p>
          )}
        </div>
      </div>

      {/* Security Notice */}
      <div className="bg-blue-50 p-3 rounded-md">
        <p className="text-xs text-blue-800">
          🔒 {t("ewayCardForm.securityNotice")}
        </p>
      </div>

      {/* Browser Support Warning */}
      {!cryptoSupported && (
        <div className="bg-red-50 p-3 rounded-md">
          <p className="text-sm text-red-800">
            ⚠️ {t("ewayCardForm.browserUnsupported")}
          </p>
        </div>
      )}
    </div>
  );
};

export default EwayCardForm;
