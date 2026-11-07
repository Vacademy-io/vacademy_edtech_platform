import { Prohibit } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { Card, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BASE_URL_LEARNER_DASHBOARD } from "@/constants/urls";

interface InvalidLinkNoticeProps {

}

export const InvalidLinkNotice = ({

}: InvalidLinkNoticeProps) => {
  const { t } = useTranslation("miscRoutesA");
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-16">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <Prohibit className="h-12 w-12 text-rose-500" />
        <h1 className="mt-6 text-3xl font-semibold text-slate-900 sm:text-4xl">
          {t("unsubscribe.invalidLink.title")}
        </h1>
        <p className="mt-4 text-base text-slate-600">
          {t("unsubscribe.invalidLink.description")}
        </p>

        <Card className="mt-10 w-full border border-slate-200 bg-white/90 shadow-lg backdrop-blur">

          <CardFooter className="border-t border-slate-100 bg-slate-50 px-8 py-6">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={BASE_URL_LEARNER_DASHBOARD}>{t("unsubscribe.returnToVacademy")}</a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
};

