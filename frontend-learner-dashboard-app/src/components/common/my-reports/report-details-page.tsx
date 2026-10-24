"use client";

import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { StudentReport } from "@/services/student-reports-api";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { ArrowLeft, List, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useReportStore } from "@/stores/report-store";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

interface ReportDetailsPageProps {
  report: StudentReport;
}

const markdownComponents = {
  h3: ({ ...props }) => (
    <h3
      className="mb-5 mt-0 text-h3 font-bold text-slate-900"
      {...props}
    />
  ),
  table: ({ ...props }) => (
    <div className="my-6 overflow-x-auto">
      <table
        className="w-full border-collapse border border-slate-200 text-body"
        {...props}
      />
    </div>
  ),
  thead: ({ ...props }) => <thead className="bg-slate-50" {...props} />,
  th: ({ ...props }) => (
    <th
      className="border border-slate-200 px-4 py-2.5 text-start font-bold text-slate-900"
      {...props}
    />
  ),
  td: ({ ...props }) => (
    <td
      className="border border-slate-200 px-4 py-2.5 text-slate-800"
      {...props}
    />
  ),
};

export default function ReportDetailsPage({ report }: ReportDetailsPageProps) {
  const { t } = useTranslation("layoutCommonB");
  const navigate = useNavigate();
  const { clearSelectedReport } = useReportStore();
  const [activeSection, setActiveSection] = useState<string>("");
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(true);

  const sections = [
    { id: "progress", title: t("reportDetailsPage.sections.overallProgress"), available: true },
    { id: "efforts", title: t("reportDetailsPage.sections.studentEfforts"), available: true },
    { id: "pattern", title: t("reportDetailsPage.sections.learningPattern"), available: true },
    {
      id: "strengths",
      title: t("reportDetailsPage.sections.strengths"),
      available: Object.keys(report.report?.strengths ?? {}).length > 0,
    },
    {
      id: "weaknesses",
      title: t("reportDetailsPage.sections.weaknesses"),
      available: Object.keys(report.report?.weaknesses ?? {}).length > 0,
    },
    { id: "improvement", title: t("reportDetailsPage.sections.topicsOfImprovement"), available: true },
    { id: "attention", title: t("reportDetailsPage.sections.topicsNeedingAttention"), available: true },
    { id: "remedial", title: t("reportDetailsPage.sections.recommendedRemedialActions"), available: true },
  ];

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections
        .filter((section) => section.available)
        .map((section) => ({
          id: section.id,
          element: document.getElementById(section.id),
        }));

      const currentSection = sectionElements.find(({ element }) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top <= 100 && rect.bottom >= 100;
      });

      if (currentSection) {
        setActiveSection(currentSection.id);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(sectionId);
    }
  };
  const renderSection = (content: string, sectionId: string) => (
    <Card id={sectionId} className="mb-6 p-6">
      <CardContent className="prose prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkBreaks, remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </CardContent>
    </Card>
  );

  const renderStrengthsWeaknesses = (
    title: string,
    data: Record<string, number>,
    isStrength: boolean = true,
    sectionId: string
  ) => {
    const progressClassName = isStrength
      ? "[&>div]:bg-green-500 bg-green-100"
      : "[&>div]:bg-red-500 bg-red-100";

    // Filter out entries with 0% score
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const filteredData = Object.entries(data).filter(([_, score]) => score > 0);

    if (filteredData.length === 0) {
      return null;
    }

    return (
      <Card id={sectionId} className="w-full p-4 space-y-stack">
        <CardTitle className="text-lg font-semibold text-neutral-800">
          {title}
        </CardTitle>
        <CardContent className="grid gap-2">
          {filteredData.map(([subject, score]) => (
            <div key={subject} className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">{subject}</span>
                <span className="text-sm text-neutral-600">{score}%</span>
              </div>
              <Progress value={score} className={progressClassName} />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  const NavigationIndex = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className={isMobile ? "p-4" : "p-4"}>
      {!isMobile && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {t("reportDetailsPage.reportSections")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsNavCollapsed(!isNavCollapsed)}
            className="h-6 w-6 p-0"
          >
            {isNavCollapsed ? (
              <CaretRight size={14} />
            ) : (
              <CaretLeft size={14} />
            )}
          </Button>
        </div>
      )}
      <nav className="space-y-1">
        {sections
          .filter((section) => section.available)
          .map((section) => (
            <button
              key={section.id}
              onClick={() => {
                scrollToSection(section.id);
                if (isMobile) setIsMobileNavOpen(false);
              }}
              className={`w-full text-start px-3 py-2 text-sm rounded-md transition-colors ${
                activeSection === section.id
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {section.title}
            </button>
          ))}
      </nav>
    </div>
  );

  const safeFormatDate = (iso: string | undefined, fmt: string): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return format(d, fmt);
    } catch {
      return "—";
    }
  };

  const heading = `${safeFormatDate(report.start_date_iso, "MMM dd, yyyy")} - ${safeFormatDate(report.end_date_iso, "MMM dd, yyyy")}`;
  const description = t("reportDetailsPage.generatedOn", {
    date: safeFormatDate(report.created_at, "MMM dd, yyyy"),
  });

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white sticky top-0 z-30">
        <div className="w-full p-2">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-4">
              <Button
                onClick={() => {
                  clearSelectedReport();
                  navigate({ to: "/my-reports" });
                }}
                variant="ghost"
                size="sm"
                className=""
              >
                <ArrowLeft size={20} />
              </Button>
              <div>
                <h1 className="text-lg md:text-xl font-bold text-gray-900">
                  {heading}
                </h1>
                <p className="text-sm text-neutral-600 mt-1">{description}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className=" py-4 px-4">
        <div className="flex gap-8">
          {/* Desktop Navigation Sidebar */}
          <div
            className={`hidden lg:block transition-all duration-300 ease-in-out ${
              isNavCollapsed ? "w-12" : "w-64"
            } flex-shrink-0`}
          >
            <div className="sticky top-24 start-0 bg-white rounded-lg border shadow-sm overflow-hidden">
              {isNavCollapsed ? (
                <div className="p-2 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsNavCollapsed(false)}
                    className="h-8 w-8 p-0"
                  >
                    <List size={16} />
                  </Button>
                </div>
              ) : (
                <NavigationIndex />
              )}
            </div>
          </div>

          {/* Main Content */}
          <div
            className={`flex-1 min-w-0 transition-all duration-300 ${
              isNavCollapsed ? "lg:ms-0" : ""
            }`}
          >
            <div className="space-y-6">
              {renderSection(report.report.progress, "progress")}
              {renderSection(report.report.student_efforts, "efforts")}
              {renderSection(report.report.learning_frequency, "pattern")}

              <div className="flex flex-col md:flex-row gap-section w-full">
                {Object.keys(report.report?.strengths ?? {}).length > 0 &&
                  renderStrengthsWeaknesses(
                    "Strengths",
                    report.report.strengths,
                    true,
                    "strengths"
                  )}

                {Object.keys(report.report?.weaknesses ?? {}).length > 0 &&
                  renderStrengthsWeaknesses(
                    "Weaknesses",
                    report.report.weaknesses,
                    false,
                    "weaknesses"
                  )}
              </div>

              {renderSection(
                report.report.topics_of_improvement,
                "improvement"
              )}
              {renderSection(report.report.topics_of_degradation, "attention")}
              {renderSection(report.report.remedial_points, "remedial")}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      {isMobileNavOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 xl:hidden"
            onClick={() => setIsMobileNavOpen(false)}
          />
          {/* Bottom Sheet */}
          <div className="fixed bottom-0 start-0 end-0 bg-white rounded-t-xl shadow-2xl z-50 xl:hidden max-h-screen-70 overflow-hidden">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t("reportDetailsPage.reportSections")}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMobileNavOpen(false)}
                  className="h-8 w-8 p-0"
                >
                  ✕
                </Button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[calc(70vh-80px)]"> {/* design-lint-ignore: viewport math */}
              <NavigationIndex isMobile />
            </div>
          </div>
        </>
      )}

      {/* Mobile Navigation Toggle Button */}
      <div className="block xl:hidden">
        <div className="fixed bottom-6 end-6 z-60">
          <Button
            onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
            className="rounded-full size-12 shadow-2xl bg-primary-400 text-white flex items-center justify-center"
            size="sm"
          >
            <List size={28} weight="bold" />
          </Button>
        </div>
      </div>
    </div>
  );
}
