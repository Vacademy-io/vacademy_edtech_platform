import { Check, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface StatusChipProps {
  mark: number | string;
  status: "CORRECT" | "INCORRECT" | "PARTIAL_CORRECT" | "DEFAULT";
  showText?: boolean;
}

export const StatusChip = ({
  mark,
  status,
  showText = true,
}: StatusChipProps) => {
  const { t } = useTranslation("testRecords");
  const getStatusConfig = () => {
    switch (status) {
      case "CORRECT":
        return {
          bgColor: "bg-green-50",
          textColor: "text-green-700",
          borderColor: "border-gray-200",
          iconBg: "bg-green-500",
          lightBg: "bg-green-100",
          icon: <Check className="w-3 h-3 text-white" />,
        };
      case "INCORRECT":
        return {
          bgColor: "bg-red-50",
          textColor: "text-red-700",
          borderColor: "border-gray-200",
          iconBg: "bg-red-500",
          lightBg: "bg-red-100",
          icon: <X className="w-3 h-3 text-white" />,
        };
      case "PARTIAL_CORRECT":
        return {
          bgColor: "bg-yellow-50",
          textColor: "text-yellow-700",
          borderColor: "border-gray-400",
          iconBg: "bg-yellow-500",
          lightBg: "bg-yellow-100",
          icon: <Check className="w-3 h-3 text-white" />,
        };
      default:
        return {
          bgColor: "bg-gray-50",
          textColor: "text-gray-700",
          borderColor: "border-gray-200",
          iconBg: "bg-gray-500",
          lightBg: "bg-gray-100",
          icon: null,
        };
    }
  };

  const config = getStatusConfig();
  const markValue = parseFloat(mark.toString());
  const markPrefix = markValue > 0 ? "+" : "";
  const markText = t("marksChip.markLabel", { count: markValue });

  // Render two variations based on showText prop
  if (showText) {
    return (
      <div
        className={`inline-flex items-center px-3 py-1 rounded-md ${config.bgColor} ${config.textColor} border ${config.borderColor}`}
      >
        <span className="font-medium">
          {markPrefix}
          {mark} {markText}
        </span>
      </div>
    );
  } else {
    // Updated icon-only version to match the reference image
    return (
      <div className="relative flex items-center justify-center w-8 h-8">
        {/* Outer light circle */}
        <div
          className={`absolute inset-0 rounded-full ${config.lightBg}`}
        ></div>
        {/* Inner solid circle */}
        <div
          className={`absolute inset-2 rounded-full ${config.iconBg} flex items-center justify-center`}
        >
          {config.icon}
        </div>
      </div>
    );
  }
};

// Full component that combines both mark text and status icon
interface MarksStatusIndicatorProps {
  answer_status: "CORRECT" | "INCORRECT" | "PARTIAL_CORRECT" | "DEFAULT";
  mark: number | string;
}

export const MarksStatusIndicator = ({
  answer_status,
  mark,
}: MarksStatusIndicatorProps) => {
  return (
    <div className="flex justify-between items-center space-x-2">
      <StatusChip mark={mark} status={answer_status} showText={true} />
      <StatusChip mark={mark} status={answer_status} showText={false} />
    </div>
  );
};
