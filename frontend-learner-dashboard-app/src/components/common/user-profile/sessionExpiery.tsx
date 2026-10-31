// import { Progress } from "@/components/ui/progress"; // Assuming shadcn/ui
import { format, differenceInMilliseconds } from "date-fns";
import { useTranslation } from "react-i18next";
import { Student } from "@/types/user/user-detail";

const SessionExpiry = ({ studentData }: { studentData: Student }) => {
  const { t } = useTranslation("userProfileExtra");
  const getExpiryDetails = (
    createdAtString: string,
    expiryDateString: string
  ) => {
    if (!createdAtString || !expiryDateString)
      return { formattedDate: "N/A", progress: 100, remainingDays: 0 };

    const createdAt = new Date(createdAtString);
    const expiryDate = new Date(expiryDateString);
    const formattedDate = format(expiryDate, "dd MMM yyyy");

    const today = new Date();

    // Calculate total duration in days
    const totalMs = differenceInMilliseconds(expiryDate, createdAt);
    const totalDays = totalMs / (1000 * 60 * 60 * 24); // Convert ms to days

    // Calculate remaining days
    const elapsedMs = differenceInMilliseconds(today, createdAt);
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

    // Ensure progress is between 0-100%
    const progress = Math.min(
      Math.max(((totalDays - elapsedDays) / totalDays) * 100, 0),
      100
    );

    return {
      formattedDate,
      progress,
      remainingDays: Math.max(Math.floor(totalDays - elapsedDays), 0),
    };
  };

  const { formattedDate, progress, remainingDays } = getExpiryDetails(
    // const { formattedDate, progress } = getExpiryDetails(
    studentData?.created_at,
    studentData?.expiry_date
  );

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {t("sessionExpiry.accessDays", { count: remainingDays })}
        </span>
        <span className="text-sm font-medium">{formattedDate}</span>
      </div>

      <div className="relative w-full h-2 mt-4 bg-green-500 rounded">
        <div
          className="absolute start-0 top-0 h-2 bg-gray-300 rounded"
          style={{ width: `${100 - progress}%` }}
        ></div>
      </div>

      {/* <div className="text-xs text-gray-500 mt-1">
        {remainingDays > 0
          ? `${remainingDays.toFixed(1)} days remaining`
          : "Session expired"}
      </div> */}
    </div>
  );
};

export default SessionExpiry;
