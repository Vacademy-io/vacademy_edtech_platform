import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Receipt } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MyButton } from "@/components/design-system/button";
import { getInstituteId } from "@/constants/helper";
import { ONE_OFF_DUES_MINE } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

interface OneOffDue {
    id: string;
    title: string;
    amount: number;
    currency: string | null;
    due_date: string;
    status: "DUE" | "PAID" | "CANCELLED";
    invoice_id: string | null;
    course_label: string | null;
}

interface OneOffDuesResponse {
    enabled: boolean;
    dues: OneOffDue[];
}

function fmtDay(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return formatDate(new Date(y, m - 1, d), { day: "numeric", month: "short", year: "numeric" });
}

function todayIso(): string {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * One-off charges the institute added for this learner (e.g. a bridge class), with a Pay
 * button that opens the usual invoice payment page. Renders nothing unless the institute
 * switched the feature on and something is due.
 */
export function OneOffDuesCard() {
    const { t } = useTranslation("dashboard");
    const navigate = useNavigate();
    const [instituteId, setInstituteId] = useState<string | undefined>();

    useEffect(() => {
        getInstituteId().then((id) => setInstituteId(id ?? undefined));
    }, []);

    const { data } = useQuery({
        queryKey: ["one-off-dues", "mine", instituteId],
        queryFn: async (): Promise<OneOffDuesResponse> => {
            const res = await authenticatedAxiosInstance.get(ONE_OFF_DUES_MINE, {
                params: { instituteId },
            });
            return res.data;
        },
        enabled: Boolean(instituteId) && !shouldHidePaidPurchaseUI(),
        staleTime: 60_000,
        retry: false,
    });

    if (shouldHidePaidPurchaseUI()) return null;
    const due = (data?.dues ?? []).filter((d) => d.status === "DUE" && d.invoice_id);
    if (!data?.enabled || due.length === 0) return null;
    const today = todayIso();

    return (
        <Card className="border-warning-200">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-subtitle">
                    <Receipt className="size-5 text-warning-600" />
                    {t("oneOffDues.title")}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="divide-y divide-border">
                    {due.map((d) => {
                        const overdue = d.due_date < today;
                        return (
                            <li
                                key={d.id}
                                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0">
                                    <p className="truncate font-semibold text-foreground">{d.title}</p>
                                    <p className="text-caption text-muted-foreground">
                                        {formatCurrency(Number(d.amount), d.currency || "INR")}
                                        {" · "}
                                        <span className={cn(overdue && "font-semibold text-danger-600")}>
                                            {overdue
                                                ? t("oneOffDues.overdueSince", { date: fmtDay(d.due_date) })
                                                : t("oneOffDues.dueOn", { date: fmtDay(d.due_date) })}
                                        </span>
                                    </p>
                                    {d.course_label && (
                                        <p className="truncate text-caption text-muted-foreground">
                                            {d.course_label}
                                        </p>
                                    )}
                                </div>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    className="shrink-0"
                                    onClick={() =>
                                        navigate({
                                            to: "/pay/invoice/$invoiceId",
                                            params: { invoiceId: d.invoice_id as string },
                                        })
                                    }
                                >
                                    {t("oneOffDues.pay")}
                                </MyButton>
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>
    );
}
