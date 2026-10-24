import { useTranslation } from "react-i18next";
import { StatusCheck } from "@/components/design-system/chips";
import { SectionDto } from "@/types/assessment";
import { isRichTextEmpty, sanitizeHtml } from "@/lib/utils";

export const SectionDetails = ({ section }: { section: SectionDto }) => {
  const { t } = useTranslation("layoutCommonB");
  return (
    <div className="w-full mb-4">
      <div className="space-y-6">
        <h2 className="text-primary-500 text-lg font-semibold">
          {section.name}
        </h2>

        <div className="space-y-4">
          {/* Most sections carry an empty rich-text body ("<p></p>") rather
              than null, so a bare truthiness check would print the label over
              nothing. */}
          {!isRichTextEmpty(section?.description?.content) && (
            <div className="text-sm text-gray-600">
              <div className="font-semibold ">
                <p className="font-bold">{t("instructionPage.sectionDetails.description")}</p>
              </div>
              <div
                className="richtext-content"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(section?.description?.content ?? ""),
                }}
              />
            </div>
          )}

          <div className="text-sm text-gray-600">
            <div className="mb-4">
              <span className="font-bold">{t("instructionPage.sectionDetails.duration")}</span>
              <span className="text-gray-900">{section?.duration}</span>
            </div>
          </div>

          <div className="space-y-4">
            {/* <div className="flex items-center justify-between text-sm text-gray-600">
              <div>
                <span className="font-bold">Negative Marking: </span>
                {section..checked
                  ? section.negativeMarking.value
                  : "No"}
              </div>
              {section.cutoff_marks && <StatusCheck />}
            </div> */}

            <div className="flex items-center justify-between text-sm text-gray-600">
              {/* <div>
                <p className="font-bold">Partial Marking</p>
              </div> */}
              {/* {section. && <StatusCheck />} */}
            </div>

            <div className="flex items-center justify-between text-sm text-gray-600">
              <div>
                <span className="font-bold">{t("instructionPage.sectionDetails.cutoffMarks")}</span>
                {section.cutoff_marks ? section.cutoff_marks : t("instructionPage.sectionDetails.notApplicable")}
              </div>
              {section.cutoff_marks && <StatusCheck />}
            </div>

            <div className="flex items-center justify-between text-sm text-gray-600">
              <div>
                <span className="font-bold">{t("instructionPage.sectionDetails.totalMarks")}</span>
                <span>{section.total_marks}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SectionDetails;
