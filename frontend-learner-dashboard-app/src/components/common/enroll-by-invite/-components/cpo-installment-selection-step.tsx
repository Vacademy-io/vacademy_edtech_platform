import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stack as Layers, WarningCircle as AlertCircle, CheckCircle as CheckCircle2, Clock } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { CpoInstallmentDue } from "../-services/enroll-invite-services";
import { getCurrencySymbol } from "./payment-selection-step";

interface CpoInstallmentSelectionStepProps {
  dues: CpoInstallmentDue[];
  currency: string;
  selectedSfpIds: string[];
  onSelectionChange: (ids: string[], totalAmount: number) => void;
  customAmount?: number;
  onCustomAmountChange?: (amount: number | undefined) => void;
  loading?: boolean;
}

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
};

const formatAmount = (amount: number, currencySymbol: string) =>
  `${currencySymbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CpoInstallmentSelectionStep = ({
  dues,
  currency,
  selectedSfpIds,
  onSelectionChange,
  customAmount,
  onCustomAmountChange,
}: CpoInstallmentSelectionStepProps) => {
  const { t } = useTranslation("enrollmentA");
  const [useCustomAmount, setUseCustomAmount] = useState(false);
  const [customAmountStr, setCustomAmountStr] = useState("");

  const currencySymbol = getCurrencySymbol(currency);

  // Group dues by fee type
  const grouped = useMemo(() => {
    const map: Record<string, CpoInstallmentDue[]> = {};
    for (const due of dues) {
      const key = due.fee_type_name || due.fee_type_code || "General";
      if (!map[key]) map[key] = [];
      map[key].push(due);
    }
    return map;
  }, [dues]);

  const pendingDues = useMemo(
    () => dues.filter((d) => d.status !== "PAID" && d.status !== "WAIVED"),
    [dues]
  );

  const selectedTotal = useMemo(() => {
    return pendingDues
      .filter((d) => selectedSfpIds.includes(d.id))
      .reduce((sum, d) => sum + (d.amount_due ?? d.amount_expected ?? 0), 0);
  }, [pendingDues, selectedSfpIds]);

  const overdueDues = useMemo(
    () => pendingDues.filter((d) => d.is_overdue),
    [pendingDues]
  );

  // Initialize: auto-select all overdue (or all pending if none overdue)
  useEffect(() => {
    if (selectedSfpIds.length === 0 && pendingDues.length > 0) {
      const defaults = overdueDues.length > 0 ? overdueDues : pendingDues;
      const ids = defaults.map((d) => d.id);
      const total = defaults.reduce((s, d) => s + (d.amount_due ?? d.amount_expected ?? 0), 0);
      onSelectionChange(ids, total);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleInstallment = (id: string) => {
    const next = selectedSfpIds.includes(id)
      ? selectedSfpIds.filter((x) => x !== id)
      : [...selectedSfpIds, id];
    const total = pendingDues
      .filter((d) => next.includes(d.id))
      .reduce((s, d) => s + (d.amount_due ?? d.amount_expected ?? 0), 0);
    onSelectionChange(next, total);
  };

  const selectAll = () => {
    const ids = pendingDues.map((d) => d.id);
    const total = pendingDues.reduce((s, d) => s + (d.amount_due ?? d.amount_expected ?? 0), 0);
    onSelectionChange(ids, total);
  };

  const selectOverdue = () => {
    const ids = overdueDues.map((d) => d.id);
    const total = overdueDues.reduce((s, d) => s + (d.amount_due ?? d.amount_expected ?? 0), 0);
    onSelectionChange(ids, total);
  };

  const clearAll = () => onSelectionChange([], 0);

  const handleCustomAmountChange = (val: string) => {
    const clean = val.replace(/[^0-9.]/g, "");
    setCustomAmountStr(clean);
    const parsed = parseFloat(clean);
    onCustomAmountChange?.(isNaN(parsed) ? undefined : parsed);
  };

  const toggleCustomAmount = (checked: boolean) => {
    setUseCustomAmount(checked);
    if (!checked) {
      setCustomAmountStr("");
      onCustomAmountChange?.(undefined);
    }
  };

  if (dues.length === 0) {
    return (
      <Card className="shadow-lg w-full">
        <CardContent className="p-card-lg flex flex-col items-center gap-stack text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="text-subtitle font-semibold text-gray-800">{t("cpoInstallment.noDuesFound")}</p>
          <p className="text-caption text-muted-foreground">{t("cpoInstallment.allSettled")}</p>
        </CardContent>
      </Card>
    );
  }

  const payAmount = useCustomAmount && customAmount !== undefined ? customAmount : selectedTotal;

  return (
    <Card className="shadow-lg w-full">
      <CardContent className="p-5 sm:p-card-lg space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
            <Layers className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-title-lg font-semibold text-gray-900">{t("cpoInstallment.title")}</h2>
            <p className="text-caption text-muted-foreground mt-1">
              {t("cpoInstallment.subtitle")}
            </p>
          </div>
        </div>

        <Separator />

        {/* Quick-select buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={selectAll}
            className="text-xs px-3 py-1.5 rounded-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            {t("cpoInstallment.selectAll")}
          </button>
          {overdueDues.length > 0 && (
            <button
              onClick={selectOverdue}
              className="text-xs px-3 py-1.5 rounded-full border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
            >
              {t("cpoInstallment.selectOverdue", { count: overdueDues.length })}
            </button>
          )}
          <button
            onClick={clearAll}
            className="text-xs px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
          >
            {t("cpoInstallment.clear")}
          </button>
        </div>

        {/* Grouped installments */}
        <div className="space-y-4">
          {Object.entries(grouped).map(([feeTypeName, items]) => (
            <div className="space-y-2" key={feeTypeName}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {feeTypeName}
              </p>
              <div className="space-y-2">
                {items.map((due) => {
                  const isPaid = due.status === "PAID" || due.status === "WAIVED";
                  const isSelected = selectedSfpIds.includes(due.id);
                  const amountDue = due.amount_due ?? due.amount_expected ?? 0;

                  return (
                    <div
                      key={due.id}
                      onClick={() => !isPaid && toggleInstallment(due.id)}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        isPaid
                          ? "bg-gray-50 border-gray-200 cursor-default opacity-60"
                          : isSelected
                          ? "bg-blue-50 border-blue-300 cursor-pointer"
                          : "bg-white border-gray-200 cursor-pointer hover:bg-gray-50"
                      }`}
                    >
                      <div className="mt-0.5">
                        {isPaid ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleInstallment(due.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {due.fee_type_name || t("cpoInstallment.installmentFallback")}
                          </span>
                          <span className={`text-sm font-semibold flex-shrink-0 ${isPaid ? "text-green-600" : "text-gray-900"}`}>
                            {isPaid ? t("cpoInstallment.paid") : formatAmount(amountDue, currencySymbol)}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 mt-1">
                          {due.due_date && (
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {t("cpoInstallment.due", { date: formatDate(due.due_date) })}
                            </span>
                          )}
                          {due.is_overdue && !isPaid && (
                            <Badge variant="destructive" className="text-xs py-0 h-4">
                              <AlertCircle className="w-2.5 h-2.5 me-1" />
                              {due.days_overdue ? t("cpoInstallment.daysOverdue", { days: due.days_overdue }) : t("cpoInstallment.overdue")}
                            </Badge>
                          )}
                          {isPaid && (
                            <Badge variant="outline" className="text-xs py-0 h-4 text-green-600 border-green-300">
                              {t("cpoInstallment.settled")}
                            </Badge>
                          )}
                        </div>

                        {due.amount_paid > 0 && !isPaid && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {t("cpoInstallment.paidSoFar", { amount: formatAmount(due.amount_paid, currencySymbol) })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Separator />

        {/* Custom amount toggle */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="custom-amount-toggle"
              checked={useCustomAmount}
              onCheckedChange={(checked) => toggleCustomAmount(!!checked)}
            />
            <Label htmlFor="custom-amount-toggle" className="text-sm text-gray-700 cursor-pointer">
              {t("cpoInstallment.customAmountLabel")}
            </Label>
          </div>

          {useCustomAmount && (
            <div className="ps-6 space-y-1">
              <div className="relative max-w-xs">
                <span className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  {currencySymbol}
                </span>
                <Input
                  type="number"
                  value={customAmountStr}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  placeholder={t("cpoInstallment.amountPlaceholder")}
                  className="ps-7"
                  min={0}
                  step="0.01"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("cpoInstallment.allocationHint")}
              </p>
            </div>
          )}
        </div>

        {/* Summary */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">
                  {useCustomAmount && customAmount !== undefined
                    ? t("cpoInstallment.customAmount")
                    : t("cpoInstallment.installmentsSelected", { count: selectedSfpIds.length })}
                </p>
                {!useCustomAmount && selectedSfpIds.length > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t("cpoInstallment.totalOutstanding", { amount: formatAmount(
                      pendingDues.reduce((s, d) => s + (d.amount_due ?? d.amount_expected ?? 0), 0),
                      currencySymbol
                    ) })}
                  </p>
                )}
              </div>
              <span className="text-xl font-bold text-blue-700">
                {formatAmount(payAmount, currencySymbol)}
              </span>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
};

export default CpoInstallmentSelectionStep;
