import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile, PaymentSummary, PaymentHistory } from "@/types/parent-portal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Receipt, CheckCircle, Clock, Warning, DownloadSimple, CaretDown, CaretUp, CreditCard } from "@phosphor-icons/react";
import { formatDate } from "@/lib/formatters";

interface Props { child: ChildProfile; summary: PaymentSummary; history: PaymentHistory }

export function PaymentsDemo({ child, summary, history }: Props) {
  const { t, i18n } = useTranslation("parent");
  const [selected, setSelected] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const toggle = (id: string) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const total = summary.fee_items.filter(f => selected.includes(f.id)).reduce((s, f) => s + f.total, 0);

  const catColors: Record<string, string> = { REGISTRATION: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", ADMISSION: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", TUITION: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", TRANSPORT: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", LIBRARY: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300", ADDITIONAL: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300" };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-5 pb-20 lg:pb-8">
      <div><h2 className="text-lg sm:text-xl font-bold text-foreground">{t("admissionPortal.demo.tiles.feePayment")}</h2><p className="text-sm text-muted-foreground mt-0.5">{t("admissionPortal.demo.feeDetailsFor", { name: child.full_name })}</p></div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-3 gap-3">
        {[{ l: t("admissionPortal.fees.totalFees"), a: summary.total_fees, c: "text-foreground", b: "bg-card" }, { l: t("admissionPortal.fees.table.paid"), a: summary.total_paid, c: "text-emerald-600 dark:text-emerald-400", b: "bg-emerald-50 dark:bg-emerald-950/20" }, { l: t("admissionPortal.fees.filters.pending"), a: summary.total_pending, c: "text-amber-600 dark:text-amber-400", b: "bg-amber-50 dark:bg-amber-950/20" }].map(s => (
          <Card key={s.l} className={`shadow-sm ${s.b}`}><CardContent className="p-3 text-center"><p className="text-caption font-medium text-muted-foreground uppercase tracking-wider mb-1">{s.l}</p><p className={`text-base sm:text-lg font-bold ${s.c}`}>{summary.currency}{s.a.toLocaleString()}</p></CardContent></Card>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Card className="shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">{t("admissionPortal.demo.feeBreakdown")}</CardTitle><CardDescription className="text-xs">{t("admissionPortal.demo.selectItemsToPay")}</CardDescription></CardHeader>
          <CardContent className="space-y-2">{summary.fee_items.map(item => {
            const paid = item.status === "COMPLETED" || item.status === "WAIVED";
            const overdue = item.status === "OVERDUE";
            const sel = selected.includes(item.id);
            return (
              <div key={item.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${sel ? "border-primary/40 bg-primary/5" : paid ? "border-border/50 bg-muted/20 opacity-70" : overdue ? "border-destructive/30 bg-destructive/5" : "border-border hover:border-border/80"}`}>
                {!paid ? <input type="checkbox" checked={sel} onChange={() => toggle(item.id)} className="rounded border-input h-4 w-4 shrink-0" /> : <CheckCircle size={16} className="text-emerald-500 shrink-0" />}
                <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-0.5"><p className="text-sm font-medium text-foreground truncate">{item.description}</p><Badge className={`text-caption px-1.5 ${catColors[item.category] || catColors["ADDITIONAL"]}`}>{item.category}</Badge></div>
                  {item.due_date && !paid && <p className={`text-caption ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>{overdue ? t("admissionPortal.demo.overduePrefix") : t("admissionPortal.demo.duePrefix")}{formatDate(item.due_date, { month: "short", day: "numeric" })}</p>}
                </div>
                <div className="text-end shrink-0"><p className={`text-sm font-bold ${paid ? "text-muted-foreground line-through" : "text-foreground"}`}>{summary.currency}{item.total.toLocaleString(i18n.language)}</p>{item.discount > 0 && <p className="text-caption text-emerald-600">{t("admissionPortal.demo.discountOff", { currency: summary.currency, amount: item.discount.toLocaleString(i18n.language) })}</p>}</div>
              </div>
            );
          })}</CardContent>
        </Card>
      </motion.div>

      {selected.length > 0 && (<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="sticky bottom-20 lg:bottom-4 z-30">
        <Card className="shadow-lg border-primary/20 bg-card/95 backdrop-blur-sm"><CardContent className="p-3 flex items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">{t("admissionPortal.demo.itemsCount", { count: selected.length })}</p><p className="text-lg font-bold">{summary.currency}{total.toLocaleString(i18n.language)}</p></div><Button onClick={() => toast.success(t("admissionPortal.demo.paymentInitiatedDemo"))} className="gap-1.5 h-10 px-6 shadow-sm"><CreditCard size={16} />{t("admissionPortal.payment.payNow")}</Button></CardContent></Card>
      </motion.div>)}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="shadow-sm"><CardHeader className="pb-3"><button onClick={() => setShowHistory(!showHistory)} className="w-full flex items-center justify-between"><div className="flex items-center gap-2"><Receipt size={18} className="text-muted-foreground" /><CardTitle className="text-base">{t("admissionPortal.fees.tabs.history")}</CardTitle></div>{showHistory ? <CaretUp size={16} className="text-muted-foreground" /> : <CaretDown size={16} className="text-muted-foreground" />}</button></CardHeader>
          <AnimatePresence>{showHistory && (<motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <CardContent className="pt-0 space-y-2">{history.transactions.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/20">
                <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 shrink-0"><CheckCircle size={16} className="text-emerald-700 dark:text-emerald-300" /></div>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium">{t.currency}{t.amount.toLocaleString(i18n.language)}</p><p className="text-caption text-muted-foreground">{formatDate(t.paid_at, { month: "short", day: "numeric", year: "numeric" })} &bull; {t.payment_method}</p></div>
                <div className="flex items-center gap-1.5 shrink-0"><Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-caption">{t("admissionPortal.demo.success")}</Badge><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toast.success(t("admissionPortal.demo.receiptDownloadDemo"))}><DownloadSimple size={14} /></Button></div>
              </div>
            ))}</CardContent>
          </motion.div>)}</AnimatePresence>
        </Card>
      </motion.div>
    </div>
  );
}
