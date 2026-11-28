import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Receipt } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { ModuleScaffold } from "../../-components/ModuleScaffold";
import { ParentStatusChip } from "../../-components/ParentStatusChip";
import { useChildInvoices, useChildOverview } from "../../-hooks/use-parent-child";
import { paymentsSummary } from "../../-lib/summaries";

export const Route = createFileRoute("/parent/child/$childId/payments/")({
  component: PaymentsScreen,
});

function isPaid(status: unknown): boolean {
  const s = String(status ?? "").toUpperCase();
  return s === "PAID";
}

function PaymentsScreen() {
  const { childId } = useParams({ from: "/parent/child/$childId/payments/" });
  const { t } = useTranslation("parent");
  const navigate = useNavigate();
  const overview = useChildOverview(childId);
  const { data: invoices, isLoading, isError, refetch } = useChildInvoices(childId);

  const childName = overview.data?.child?.fullName || t("common.yourChild");
  const pending = (invoices ?? []).filter((inv) => !isPaid(inv.status)).length;

  return (
    <ModuleScaffold
      childId={childId}
      title={t("tiles.payments")}
      icon="payments"
      summary={paymentsSummary(pending, invoices?.length, childName, t)}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={(invoices?.length ?? 0) === 0}
      emptyIcon={Receipt}
      emptyTitle={t("payments.emptyTitle")}
      emptyBody={t("payments.emptyBody")}
    >
      <ul className="flex flex-col gap-stack">
        {invoices?.map((inv, i) => {
          const paid = isPaid(inv.status);
          const invoiceId = String(inv.id ?? inv.invoiceId ?? "");
          return (
            <li
              key={invoiceId || i}
              className="flex items-center justify-between gap-3 rounded-xl bg-card shadow-sm px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-body font-medium text-foreground">
                  {String(inv.invoice_number ?? inv.invoiceNumber ?? t("payments.invoice"))}
                </span>
                {inv.total_amount != null ? (
                  <span className="text-caption font-semibold text-foreground">
                    {`${String(inv.currency ?? "")} ${String(inv.total_amount)}`.trim()}
                  </span>
                ) : null}
                <ParentStatusChip
                  tone={paid ? "good" : "action"}
                  label={paid ? t("payments.paid") : t("payments.due")}
                />
              </div>
              {!paid && invoiceId ? (
                <MyButton
                  buttonType="primary"
                  scale="small"
                  onClick={() =>
                    navigate({ to: `/pay/invoice/${invoiceId}` as never })
                  }
                >
                  {t("payments.payNow")}
                </MyButton>
              ) : null}
            </li>
          );
        })}
      </ul>
    </ModuleScaffold>
  );
}
