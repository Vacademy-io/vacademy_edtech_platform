import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { parseHtmlToString } from "@/lib/utils";
import { SurveyReportDialogProps, SurveyQuestion, SurveySection } from "@/types/assessments/survey-report-type";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";

export const SurveyReportDialog = ({
  surveyReport,
  assessmentDetails,
}: SurveyReportDialogProps) => {
  const { t } = useTranslation("testRecords");
  const { setNavHeading } = useNavHeadingStore();

  useEffect(() => {
    setNavHeading(t("surveyReportDialog.title"));
  }, [setNavHeading, t]);

  const renderQuestionResponse = (question: SurveyQuestion) => {
    try {
      const responseData = JSON.parse(question.student_answer.response_json);
      
      switch (question.question_type) {
        case "MCQS":
        case "MCQM":
          const selectedOptions = responseData.optionIds || [];
          const options = JSON.parse(question.options_json || "{}");
          return (
            <div className="space-y-2">
              {selectedOptions.length > 0 ? (
                selectedOptions.map((optionId: string) => (
                  <div key={optionId} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <span className="text-sm text-green-800 font-medium">{options[optionId] || optionId}</span>
                  </div>
                ))
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <span className="text-sm text-gray-500">{t("questionResponseRenderer.noResponse")}</span>
                </div>
              )}
            </div>
          );
        
        case "TRUE_FALSE":
          const trueFalseOptions = JSON.parse(question.options_json || "{}");
          const selectedOption = responseData.optionIds?.[0];
          return (
            <div>
              {selectedOption ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-sm text-green-800 font-medium">{trueFalseOptions[selectedOption] || selectedOption}</span>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <span className="text-sm text-gray-500">{t("questionResponseRenderer.noResponse")}</span>
                </div>
              )}
            </div>
          );
        
        case "NUMERIC":
          const numericValue = responseData.validAnswer;
          return (
            <div>
              {numericValue !== null && numericValue !== undefined ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-sm text-green-800 font-medium font-mono">{numericValue}</span>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <span className="text-sm text-gray-500">{t("questionResponseRenderer.noResponse")}</span>
                </div>
              )}
            </div>
          );
        
        case "TEXT":
        case "PARAGRAPH":
          const textValue = responseData.text || responseData.answer;
          return (
            <div>
              {textValue ? (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-sm text-blue-800 leading-relaxed">{textValue}</span>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <span className="text-sm text-gray-500">{t("questionResponseRenderer.noResponse")}</span>
                </div>
              )}
            </div>
          );
        
        default:
          return (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm text-gray-500">{t("surveyReportDialog.responseNotAvailable")}</span>
            </div>
          );
      }
    } catch (error) {
      console.error("Error parsing response:", error);
      return (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-sm text-red-600">{t("surveyReportDialog.errorParsingResponse")}</span>
        </div>
      );
    }
  };

  if (!surveyReport) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-600">{t("surveyReportDialog.noSurveyData")}</h2>
        </div>
      </div>
    );
  }

  const { sections } = surveyReport;

  // Get survey name from assessment details
  const surveyName = assessmentDetails && assessmentDetails.length > 0
    ? assessmentDetails[0]?.saved_data?.name || t("surveyReportDialog.title")
    : t("surveyReportDialog.title");

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-8">
      {/* Survey Title */}
      <div className="text-start">
        <h1 className="text-xl font-semibold text-gray-900">{surveyName}</h1>
      </div>

      {/* Questions and Responses */}
      {sections.map((section: SurveySection) => (
        <div key={section.section_id} className="space-y-6">
          {/* Questions Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-section">
            {section.questions.map((question: SurveyQuestion, index: number) => (
              <Card key={question.question_id} className="p-6 border border-gray-200 shadow-sm">
                <div className="space-y-4">
                  {/* Question */}
                  <div>
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-gray-700">{index + 1}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-base text-gray-900 leading-relaxed flex-1">
                            {parseHtmlToString(question.question_text.content)}
                          </div>
                          <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full ms-4">
                            {question.question_type}
                          </span>
                        </div>
                        {question.parent_rich_text && (
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="text-sm text-gray-700">
                              {parseHtmlToString(question.parent_rich_text.content)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Response */}
                  <div className="ms-12">
                    <h4 className="text-xs font-medium text-gray-600 mb-2">{t("common.yourResponse")}</h4>
                    {renderQuestionResponse(question)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
