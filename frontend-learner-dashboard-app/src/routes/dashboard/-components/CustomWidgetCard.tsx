import { CaretRight } from "@phosphor-icons/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FunCustomCard } from "./fun/FunCustomCard";

/**
 * The institute's own dashboard card (the "custom" widget: a title, a line and
 * an optional Open button). Shared by the classic home and by the home
 * builder's plain notice, so an imported card looks exactly as it did.
 */
export function CustomWidgetCard({
  fun,
  title,
  subTitle,
  openLabel,
  onOpen,
}: {
  fun: boolean;
  title: string;
  subTitle?: string | null;
  openLabel: string;
  onOpen?: () => void;
}) {
  if (fun) {
    return <FunCustomCard title={title} subTitle={subTitle} openLabel={openLabel} onOpen={onOpen} />;
  }
  return (
    <Card
      className={cn(
        "transition-shadow",
        "[.ui-vibrant_&]:border-primary/20",
        "[.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-card [.ui-vibrant_&]:to-primary/5"
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        {subTitle && <CardDescription>{subTitle}</CardDescription>}
      </CardHeader>
      <CardContent>
        {onOpen && (
          <Button variant="ghost" size="sm" onClick={onOpen} className="w-full justify-between">
            {openLabel} <CaretRight size={14} />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
