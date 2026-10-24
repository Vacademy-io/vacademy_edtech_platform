import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { USER_LINKED_DATA } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";

interface LinkedData {
  id: string;
  userId: string;
  type: "strength" | "weakness";
  data: string;
  percentage: number;
  createdAt: string;
  updatedAt: string;
}

const ProgressStats = ({ userId }: { userId: string }) => {
  const { t } = useTranslation("userProfileExtra");
  const [strengths, setStrengths] = useState<LinkedData[]>([]);
  const [weaknesses, setWeaknesses] = useState<LinkedData[]>([]);
  const [showAllStrengths, setShowAllStrengths] = useState(false);
  const [showAllWeaknesses, setShowAllWeaknesses] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await authenticatedAxiosInstance.get(
          `${USER_LINKED_DATA}/${userId}`
        );
        const data: LinkedData[] = response.data;
        const sortedStrengths = data
          .filter((item) => item.type === "strength")
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        const sortedWeaknesses = data
          .filter((item) => item.type === "weakness")
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        setStrengths(sortedStrengths);
        setWeaknesses(sortedWeaknesses);
      } catch (error) {
        console.error("Error fetching progress metrics:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [userId]);

  const renderStats = (
    items: LinkedData[],
    showAll: boolean,
    setShowAll: (value: boolean) => void,
    title: string,
    limit: number = 2
  ) => {
    const displayedItems = showAll ? items : items.slice(0, limit);
    return (
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">
          {title === "Strengths" ? t("progressStats.strengths") : t("progressStats.weaknesses")}
        </h4>
        {displayedItems.length === 0 ? (
          <div className="text-muted-foreground">{t("progressStats.empty")}</div>
        ) : (
          displayedItems.map((item) => (
            <div key={item.id} className="space-y-2">
              <CardTitle className="text-sm text-foreground">
                {item.data}
              </CardTitle>
              <div className="flex items-center space-x-2">
                <Progress
                  value={item.percentage}
                  className={cn(
                    "flex-1 !bg-muted",
                    title === "Strengths"
                      ? "[&>div]:bg-green-500"
                      : "[&>div]:bg-red-500"
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {item.percentage}%
                </span>
              </div>
            </div>
          ))
        )}
        {items.length > limit && (
          <MyButton
            buttonType="text"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="w-full text-sm font-medium text-foreground"
          >
            {showAll
              ? t("progressStats.showLess")
              : t("progressStats.viewMore", { count: items.length - limit })}
          </MyButton>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-card rounded-xl border shadow p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("progressStats.title")}
        </h3>
        <div className="text-center text-muted-foreground">{t("progressStats.loading")}</div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border shadow p-6 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t("progressStats.title")}
      </h3>
      <div className="space-y-6">
        {renderStats(
          strengths,
          showAllStrengths,
          setShowAllStrengths,
          "Strengths",
          2
        )}
        {renderStats(
          weaknesses,
          showAllWeaknesses,
          setShowAllWeaknesses,
          "Weaknesses",
          2
        )}
      </div>
    </div>
  );
};

export default ProgressStats;
