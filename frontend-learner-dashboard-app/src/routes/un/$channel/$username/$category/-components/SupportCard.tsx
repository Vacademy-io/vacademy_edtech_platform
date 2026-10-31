import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BASE_URL_LEARNER_DASHBOARD } from "@/constants/urls";

interface SupportCardProps {
  supportEmail: string;
  isError: boolean;
  isPending: boolean;
  onRetry: () => void;
}

export const SupportCard = ({
  supportEmail,
  isError,
  isPending,
  onRetry,
}: SupportCardProps) => {
  const { t } = useTranslation("miscRoutesA");
  return (
    <Card className="border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
      <CardContent className="flex h-full flex-col justify-between p-8">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {t("unsubscribe.support.title")}
          </h3>
          <p className="text-sm text-slate-600">{t("unsubscribe.support.description")}</p>
        </div>
        <div className="mt-6 space-y-3 text-sm text-slate-500">
          <p>
            {t("unsubscribe.support.emailPrefix")}{" "}
            <a
              className="font-medium text-primary underline-offset-4 hover:underline"
              href={`mailto:${supportEmail}`}
            >
              {supportEmail}
            </a>{" "}
            {t("unsubscribe.support.emailSuffix")}
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-stack">
          {isError ? (
            <Button onClick={onRetry} disabled={isPending}>
              {isPending ? t("unsubscribe.support.retrying") : t("unsubscribe.support.tryAgain")}
            </Button>
          ) : (
            <Button asChild variant="outline">
              <a href={BASE_URL_LEARNER_DASHBOARD}>{t("unsubscribe.returnToVacademy")}</a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

