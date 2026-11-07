import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Preferences } from "@capacitor/preferences";
import { fetchDataByIds } from "@/services/GetDataById";
import { GET_TEXT_VIA_IDS } from "@/constants/urls";

export function ExpandableParagraph() {
  const { t } = useTranslation("questionTest");
  const [aboutData, setAboutData] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAboutData = async () => {
      try {
        setLoading(true);
        // Get the stored IDs
        const storedIds = await Preferences.get({
          key: "InstructionID_and_AboutID",
        });

        if (storedIds.value) {
          const parsedData = JSON.parse(storedIds.value);

          // Check if about_id exists and is not null
          // parsedData.about_id = "e54b40ca-01c6-4bce-86f9-b59ee9cf494d";
          if (parsedData.about_id) {
            // Fetch the paragraph data using the about_id
            const data = await fetchDataByIds(
              parsedData.about_id,
              GET_TEXT_VIA_IDS
            );

            setAboutData(data[0].content);
            console.log("About data:", data[0].content);
          }
        }
      } catch (error) {
        console.error("Error fetching about data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAboutData();
  }, []);

  // If no about data or loading, don't render anything
  if (loading || !aboutData) {
    return null;
  }

  // Function to limit text to two lines (approx. 180 characters)
  const getLimitedText = (text: string): string => {
    if (!expanded && text.length > 120) {
      return text.substring(0, 120) + "...";
    }
    return text;
  };

  return (
    <div className="mt-4 mb-6">
      <div className="text-gray-700">{getLimitedText(aboutData || "")}</div>

      {aboutData?.length > 120 && (
        <Button
          variant="link"
          className="p-0 h-auto text-primary-500 mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t("paragraph.readLess") : t("paragraph.readMore")}
        </Button>
      )}
    </div>
  );
}
