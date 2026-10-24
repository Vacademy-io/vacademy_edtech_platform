import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Share } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useGetEnrollInvites } from "../-services/get-enroll-invites";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { getInstituteId } from "@/constants/helper";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useEffect, useState } from "react";

interface InviteLinksTableProps {
  referralCode?: string;
}

export function InviteLinksTable({ referralCode }: InviteLinksTableProps) {
  const { t } = useTranslation("miscRoutesA");
  const { data: invites, isLoading } = useGetEnrollInvites();
  const [instituteId, setInstituteId] = useState<string | null>(null);
  useEffect(() => {
    getInstituteId().then((id) => setInstituteId(id ?? ""));
  }, []);

  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);

  const generateInviteLink = (inviteCode: string) => {
    const base_url = window.location.origin;
    const inviteLink = `${base_url}/learner-invitation-response?instituteId=${instituteId}&inviteCode=${inviteCode}&ref=${referralCode}`;
    return inviteLink;
  };

  const getCourseNameFromJson = (jsonString: string | null): string => {
    const unknownCourse = t("referral.inviteLinks.unknownCourse", { course });
    if (!jsonString) return unknownCourse;
    try {
      const json = JSON.parse(jsonString);
      return json.course || unknownCourse;
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return unknownCourse;
    }
  };

  const copyToClipboard = (code: string) => {
    const link = generateInviteLink(code);
    navigator.clipboard.writeText(link);
    toast.success(t("referral.inviteLinks.linkCopied"));
  };

  const shareLink = (code: string) => {
    const link = generateInviteLink(code);
    if (navigator.share) {
      navigator.share({
        title: t("referral.inviteLinks.shareTitle"),
        text: t("referral.inviteLinks.shareText", { course }),
        url: link,
      });
    } else {
      copyToClipboard(link);
    }
  };

  return (
    <Card className="">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold text-primary">
          {t("referral.inviteLinks.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 border-b">
                <TableHead className="text-gray-600 font-medium">{course}</TableHead>
                <TableHead className="text-gray-600 font-medium">
                  {t("referral.inviteLinks.inviteLinkColumn")}
                </TableHead>
                <TableHead className="text-gray-600 font-medium text-center">
                  {t("referral.inviteLinks.shareColumn")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2].map((index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </TableCell>
                  </TableRow>
                ))
              ) : isNullOrEmptyOrUndefined(invites) ? (
                <div>{t("referral.inviteLinks.noInvites")}</div>
              ) : (
                invites.map((item, index) => (
                  <TableRow
                    key={index}
                    className="border-b hover:bg-gray-50/50"
                  >
                    <TableCell className="font-medium text-gray-800">
                      {getCourseNameFromJson(item.web_page_meta_data_json)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="bg-gray-100 rounded-md px-3 py-2 text-sm font-mono text-gray-700 truncate">
                        {generateInviteLink(item.invite_code)}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(item.invite_code)}
                          className="h-8 w-8"
                          title={t("referral.inviteLinks.copyLink")}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => shareLink(item.invite_code)}
                          className="h-8 w-8"
                          title={t("referral.inviteLinks.shareLink")}
                        >
                          <Share className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
