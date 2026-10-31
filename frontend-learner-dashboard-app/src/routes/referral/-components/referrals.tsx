import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BenefitLog,
  ReferralBenefit,
  useGetReferrerBenefits,
} from "../-services/get-referral-benefits";
import { format } from "date-fns";
import { ArrowSquareOut, User } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BenefitType,
  getBenefitText,
  getBenefitTypeLabel,
  getStatusIcon,
  parseBenefitLog,
} from "../-services/utils";

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-700 hover:bg-green-100";
    case "PENDING":
      return "bg-gray-100 text-gray-600 hover:bg-gray-100";
    default:
      return "bg-gray-100 text-gray-600 hover:bg-gray-100";
  }
};

export function ReferralsTable() {
  const { t } = useTranslation("miscRoutesA");
  const { data: referrals } = useGetReferrerBenefits();

  return (
    <Card className="rounded-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold text-primary">
          {t("referral.table.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 border-b">
                <TableHead className="text-gray-600 font-medium">
                  {t("referral.table.memberName")}
                </TableHead>
                <TableHead className="text-gray-600 font-medium">
                  {t("referral.table.memberEmail")}
                </TableHead>
                <TableHead className="text-gray-600 font-medium">
                  {t("referral.table.rewardStatus")}
                </TableHead>
                <TableHead className="text-gray-600 font-medium">
                  {t("referral.table.viewDetails")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referrals?.map((referral, index) => (
                <TableRow key={index} className="border-b hover:bg-gray-50/50">
                  <TableCell className="font-medium text-gray-800">
                    {referral.user_detail.full_name}
                  </TableCell>
                  <TableCell className="text-gray-600">
                    {referral.user_detail.email}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`${getStatusBadgeVariant(
                        referral.benefit_logs?.[0]?.status || "PENDING"
                      )} font-medium`}
                    >
                      {referral.benefit_logs?.[0]?.status || t("referral.status.pending")}
                    </Badge>
                  </TableCell>
                  <TableCell className="">
                    <ReferralDetailsDialog referral={referral} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {(!referrals || referrals.length === 0) && (
          <div className="text-center py-8 text-gray-500">
            <p>{t("referral.table.noneFound")}</p>
            <p className="text-sm">{t("referral.table.noneFoundHelper")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ReferralDetailsDialog = ({ referral }: { referral: ReferralBenefit }) => {
  const { t } = useTranslation("miscRoutesA");
  const [isOpen, setIsOpen] = useState(false);

  const renderBenefit = (log: BenefitLog) => {
    const parsed: { type: BenefitType; points?: number; days?: number } =
      parseBenefitLog(log.benefit_value, log.benefit_type as BenefitType);
    switch (log.benefit_type) {
      case "POINTS":
        return <p>{t("referral.benefit.earnedPoints", { points: parsed?.points })}</p>;
      case "FREE_MEMBERSHIP_DAYS":
        return <p>{t("referral.benefit.receivedDays", { days: parsed?.days })}</p>;
      default:
        return <p>{getBenefitText(parsed.type, t)}</p>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          title={t("referral.table.viewDetailsTitle")}
        >
          <ArrowSquareOut className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-screen-80 overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 bg-primary-100 rounded-lg">
              <User className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <div className="font-semibold">
                {referral.user_detail.full_name}
              </div>
              <div className="text-sm text-gray-500 font-normal">
                {referral.user_detail.email}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          {/* Benefit Logs */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-4">
              {t("referral.table.yourBenefits")}
            </h3>
            {referral.benefit_logs && referral.benefit_logs.length > 0 ? (
              <div className="space-y-3">
                {referral.benefit_logs.map((log, index) => (
                  <div
                    key={index}
                    className="bg-white rounded-lg p-4 border border-gray-200 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {getStatusIcon(log.status)}
                        </span>
                        <div>
                          <div className="font-medium text-gray-900">
                            {getBenefitTypeLabel(log.benefit_type, t)}
                          </div>
                          <div className="text-sm text-gray-500">
                            {format(log.created_at, "MMM dd, yyyy")}
                          </div>
                        </div>
                      </div>
                      <Badge
                        className={`${getStatusBadgeVariant(
                          log.status
                        )} text-xs`}
                      >
                        {log.status}
                      </Badge>
                    </div>
                    <div className="text-sm">{renderBenefit(log)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">
                <p>{t("referral.table.noBenefitLogs")}</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
