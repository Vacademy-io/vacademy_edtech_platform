import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, ClipboardText } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

export const Route = createFileRoute("/planning/")({
  component: PlanningPage,
});

function PlanningPage() {
  const navigate = useNavigate();
  const { setNavHeading } = useNavHeadingStore();
  const { t } = useTranslation("planning");
  const teachers = getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher);

  // Set navigation heading
  useEffect(() => {
    setNavHeading(t("hub.heading"));
  }, [setNavHeading, t]);

  return (
    <LayoutContainer>
      <div className="container mx-auto space-y-4 p-2">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-semibold">{t("hub.heading")}</h2>
          <p className="mt-2 text-muted-foreground">
            {t("hub.subtitle", { teachers })}
          </p>
        </div>

        {/* Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card
            className="cursor-pointer transition-shadow hover:shadow-lg"
            onClick={() => navigate({ to: "/planning/planning-logs" } as never)}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-3">
                  <BookOpen className="size-6 text-primary" />
                </div>
                <div>
                  <CardTitle>{t("hub.plannings.title")}</CardTitle>
                  <CardDescription>
                    {t("hub.plannings.description", { teachers })}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                {t("hub.plannings.cta")}
              </Button>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-shadow hover:shadow-lg"
            onClick={() => navigate({ to: "/planning/activity-logs" } as never)}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-secondary/10 p-3">
                  <ClipboardText className="size-6 text-secondary-foreground" />
                </div>
                <div>
                  <CardTitle>{t("hub.activities.title")}</CardTitle>
                  <CardDescription>
                    {t("hub.activities.description", { teachers })}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                {t("hub.activities.cta")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </LayoutContainer>
  );
}
