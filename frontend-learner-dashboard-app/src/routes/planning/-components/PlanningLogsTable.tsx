import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye } from "@phosphor-icons/react";
import type { PlanningLog } from "../-types/types";
import {
  formatIntervalType,
  formatIntervalTypeId,
} from "../-utils/intervalTypeIdFormatter";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/formatters";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

interface PlanningLogsTableProps {
  data: PlanningLog[];
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onViewLog: (log: PlanningLog) => void;
}

export default function PlanningLogsTable({
  data,
  totalPages,
  currentPage,
  onPageChange,
  onViewLog,
}: PlanningLogsTableProps) {
  const { t } = useTranslation("planning");
  const teachers = getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          {t("table.empty.title")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("table.empty.description", { teachers })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.headers.interval")}</TableHead>
              <TableHead>{t("table.headers.period")}</TableHead>
              <TableHead>{t("table.headers.title")}</TableHead>
              <TableHead>{t("table.headers.createdBy")}</TableHead>
              <TableHead>{t("table.headers.createdAt")}</TableHead>
              <TableHead className="text-end">{t("table.headers.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <Badge variant="outline">
                    {formatIntervalType(log.interval_type, t)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {formatIntervalTypeId(log.interval_type_id, t)}
                </TableCell>
                <TableCell className="font-medium">{log.title}</TableCell>
                <TableCell>{log.created_by}</TableCell>
                <TableCell>
                  {formatDate(log.created_at, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewLog(log)}
                  >
                    <Eye className="me-2 size-4" />
                    {t("common.view")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => currentPage > 0 && onPageChange(currentPage - 1)}
                className={
                  currentPage === 0
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => (
              <PaginationItem key={i}>
                <PaginationLink
                  onClick={() => onPageChange(i)}
                  isActive={currentPage === i}
                  className="cursor-pointer"
                >
                  {i + 1}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() =>
                  currentPage < totalPages - 1 && onPageChange(currentPage + 1)
                }
                className={
                  currentPage === totalPages - 1
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
