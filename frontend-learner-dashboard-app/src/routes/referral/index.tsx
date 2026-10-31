import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "@phosphor-icons/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useGetCoupons } from "./-services/get-coupon";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { InviteLinksTable } from "./-components/invite-link";
import { ReferralsTable } from "./-components/referrals";

export const Route = createFileRoute("/referral/")({
  component: () => {
    return (
      <LayoutContainer>
        <ReferralComponent />
      </LayoutContainer>
    );
  },
});

function ReferralComponent() {
  const { t } = useTranslation("miscRoutesA");
  const { data: coupons, isLoading, isError } = useGetCoupons();
  const { setNavHeading } = useNavHeadingStore();
  useEffect(() => {
    setNavHeading(t("referral.navHeading"));
  }, [setNavHeading, t]);

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("referral.copiedToClipboard", { type }));
  };

  if (isLoading) return <div>{t("referral.loading")}</div>;
  if (isError) return <div>{t("referral.loadError")}</div>;
  if (isNullOrEmptyOrUndefined(coupons) || coupons.length === 0)
    return (
      <div>
        <Card className="max-w-md mx-auto">
          <CardContent className="text-center p-8">
            <div className="space-y-4">
              <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                <Copy className="h-8 w-8 text-gray-400" />
              </div>
              <div className="space-y-2">
                <CardTitle className="text-lg text-gray-700">
                  {t("referral.noDataTitle")}
                </CardTitle>
                <p className="text-sm text-gray-500">{t("referral.noDataDescription")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  const referralCode = coupons[0].code;

  return (
    <div className="min-h-screen">
      {/* Desktop: Two-column hero layout, Mobile: Stacked */}
      <div className="container mx-auto p-4">
        <Card className="p-4 rounded-lg grid lg:grid-cols-3 gap-12 lg:gap-16 items-center mb-16">
          {/* Left Column - Content */}
          <CardContent className="space-y-4 lg:col-span-2">
            <CardTitle className="space-y-2">
              <h1 className="text-4xl font-bold text-gray-800 ">
                {t("referral.hero.titlePrefix")}{" "}
                <span className="text-primary inline-block">
                  {t("referral.hero.titleHighlight")}
                </span>
              </h1>
              <p className="text-base text-gray-500 leading-relaxed">
                {t("referral.hero.description")}
              </p>
            </CardTitle>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-gray-700 text-sm leading-relaxed">
                {t("referral.hero.shareNote")}
              </p>
            </div>

            {/* Your Invite Code Section */}
            <Card className="bg-gray-50 ">
              <CardHeader className="p-2 px-5">
                <CardTitle className="text-sm  text-primary-300">
                  {t("referral.hero.yourCodeTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border p-2 rounded-lg">
                    <span className="text-lg font-bold text-primary-400 tracking-wider">
                      {referralCode}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        copyToClipboard(referralCode, t("referral.inviteCode"))
                      }
                      className="shrink-0"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">{t("referral.hero.codeHelper")}</p>
                </div>
              </CardContent>
            </Card>
          </CardContent>

          <div className="flex justify-center lg:justify-end pe-4 w-full">
            <div className="relative w-full max-w-lg">
              <img
                src="/referral-image.jpg"
                alt={t("referral.hero.imageAlt")}
                width={600}
                height={600}
                className="w-full h-auto rounded-md"
              />
            </div>
          </div>
        </Card>

        {/* Invite Links Table */}
        <div className="mb-12">
          <InviteLinksTable referralCode={referralCode} />
        </div>

        {/* Your Referrals Table */}
        <div className="mb-12">
          <ReferralsTable />
        </div>
      </div>
    </div>
  );
}
