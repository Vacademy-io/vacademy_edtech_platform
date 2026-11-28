import { Card } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { PaymentPlan } from "../-utils/helper";
import { cn } from "@/lib/utils";
import { SelectedPayment } from "./types";

export const OneTimePlanSection = ({
  payment_options,
  currency,
  discount_json,
  selectedPayment,
  onSelect,
}: {
  payment_options: PaymentPlan[];
  currency: string;
  discount_json: { type: string; amount: number } | null;
  selectedPayment: SelectedPayment | null;
  onSelect: (payment: SelectedPayment) => void;
}) => {
  const { t } = useTranslation("enrollmentA");
  const calculateDiscountedPrice = (
    originalPrice: number,
    elevatedPrice?: number
  ) => {
    // Use elevated_price as the base when available (it's the pre-discount MRP).
    // actual_price from the API already reflects the elevated→actual markdown,
    // so applying discount_json on actual_price would double-count.
    const basePrice = elevatedPrice && elevatedPrice > originalPrice
      ? elevatedPrice
      : originalPrice;

    if (!discount_json) return originalPrice;

    if (discount_json.type === "percentage") {
      return basePrice - (basePrice * discount_json.amount) / 100;
    } else if (discount_json.type === "fixed") {
      return basePrice - discount_json.amount;
    }
    return originalPrice;
  };

  const renderDiscount = () => {
    if (!discount_json) return null;

    if (discount_json.type === "percentage") {
      return t("onetimePlan.percentOff", { amount: discount_json.amount });
    } else if (discount_json.type === "fixed") {
      return t("onetimePlan.fixedOff", { currency, amount: discount_json.amount });
    }
  };

  return (
    <div className="flex w-full flex-wrap gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {payment_options.map((payment, idx) => {
          // Use elevated_price (MRP) as the base for display & discount calc
          const originalPrice = payment.elevated_price || payment.actual_price;
          const discountedPrice = calculateDiscountedPrice(
            payment.actual_price,
            payment.elevated_price
          );
          const hasDiscount =
            discount_json && discountedPrice !== originalPrice;

          return (
            <Card
              key={idx}
              className={cn(
                "w-full border border-gray-200 p-4 transition-colors hover:border-gray-300 cursor-pointer",
                selectedPayment?.id === payment.id
                  ? "ring-2 ring-blue-500 bg-blue-50"
                  : "hover:bg-gray-50"
              )}
              onClick={() => {
                const paymentPlan: PaymentPlan & { type: string } = {
                  ...payment,
                  actual_price: discountedPrice,
                  type: "ONE_TIME",
                };
                onSelect(paymentPlan);
              }}
            >
              <div className="flex flex-col gap-stack">
                <h4 className="text-base font-bold text-gray-900">
                  {payment.name}
                </h4>

                {/* Price display */}
                <div className="flex flex-col gap-1">
                  {hasDiscount ? (
                    <>
                      {/* Crossed out original price (MRP / elevated) */}
                      <div className="text-sm text-gray-500 line-through">
                        {currency}
                        {originalPrice.toFixed(2)}
                      </div>
                      {/* Discounted price with discount info */}
                      <div className="text-xl font-bold text-primary-500">
                        {currency}
                        {discountedPrice.toFixed(2)}
                        {discount_json && (
                          <span className="text-sm text-green-600 font-semibold ms-2">
                            {renderDiscount()}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Regular price when no discount */
                    <div className="text-xl font-bold text-primary-500">
                      {currency}
                      {payment.actual_price.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
