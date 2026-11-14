import { useEffect, useState, useRef } from "react";
import { Preferences } from "@capacitor/preferences";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { getPublicUrl } from "@/services/upload_file";
import { Session } from "@/types/user/user-detail";
import { useTranslation } from "react-i18next";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { toTitleCase } from "@/lib/utils";
import i18n from "@/i18n";

const SessionSelectionPage = () => {
  const { t } = useTranslation("auth");
  const [sessionList, setSessionList] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { redirect } = useSearch<any>({ from: "/SessionSelectionPage/" });
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const checkAndFetch = async () => {
      console.log("🚀 useEffect[checkAndFetch] running...");

      try {
        const selectedInstitute = await Preferences.get({
          key: "selectedInstituteId",
        });
        const studentData = await Preferences.get({ key: "students" });

        console.log("📌 selectedInstituteId:", selectedInstitute.value);
        console.log("📌 students:", studentData.value);

        if (!selectedInstitute.value || !studentData.value) {
          console.warn("⚠️ Institute or student data missing.");
          toast.error(i18n.t("auth:sessionSelection.missingData"));
          return;
        }

        const sessionListRaw = await Preferences.get({ key: "sessionList" });
        console.log("📥 Raw sessionList from Preferences:", sessionListRaw);

        if (!sessionListRaw.value) {
          console.warn("⚠️ No sessionList found in Preferences.");
          toast.error(i18n.t("auth:sessionSelection.noSessions"));
          return;
        }

        const parsed = JSON.parse(sessionListRaw.value) as Session[];

        if (!Array.isArray(parsed) || parsed.length === 0) {
          console.warn("⚠️ Parsed session list is empty or invalid.");
        } else {
          console.log(
            `✅ Parsed ${parsed.length} session(s) from Preferences.`
          );
        }

        setSessionList(parsed);
      } catch (error) {
        console.error("❌ Error loading session list:", error);
        toast.error(i18n.t("auth:sessionSelection.loadFailed"));
      } finally {
        setLoading(false);
        console.log("✅ Finished checkAndFetch. Loading set to false.");
      }
    };

    checkAndFetch();
  }, []);

  useEffect(() => {
    console.log(
      "🧠 useEffect[sessionList] triggered. Length:",
      sessionList.length
    );

    if (sessionList.length === 1) {
      console.log("✅ Only one session. Auto-selecting:", sessionList[0]);
      handleSessionSelect(sessionList[0]);
    } else if (sessionList.length > 0) {
      fetchImageUrls();
    }
  }, [sessionList]);

  const fetchImageUrls = async () => {
    console.log("🌄 Fetching image URLs for sessions...");

    const urls: Record<string, string> = {};

    for (const session of sessionList) {
      const thumbnailId = session.package_dto?.thumbnail_file_id;
      console.log(
        `ℹ️ Processing session [${session.id}] with thumbnail ID: ${thumbnailId}`
      );

      if (thumbnailId) {
        try {
          const url = await getPublicUrl(thumbnailId);
          urls[session.id] = url;
          console.log(`✅ Image URL for ${session.id}: ${url}`);
        } catch (error) {
          console.error(
            `❌ Error fetching image for session ${session.id}:`,
            error
          );
        }
      } else {
        console.warn(`⚠️ No thumbnail_file_id found for session ${session.id}`);
      }
    }

    setImageUrls(urls);
    console.log("✅ Image URLs updated in state:", urls);
  };

  const handleSessionSelect = async (selectedSession: Session) => {
    console.log("🎯 handleSessionSelect: Selected session:", selectedSession);
    setSubmitting(true);

    try {
      const studentData = await Preferences.get({ key: "students" });
      console.log("📌 studentData fetched:", studentData.value);

      if (!studentData.value) {
        throw new Error("No student data found!");
      }

      const studentList = JSON.parse(studentData.value);
      const selectedStudent = studentList.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (student: any) => student.package_session_id === selectedSession.id
      );

      if (!selectedStudent) {
        console.warn("⚠️ No matching student found for selected session.");
        throw new Error("No matching student found!");
      }

      await Preferences.set({
        key: "StudentDetails",
        value: JSON.stringify(selectedStudent),
      });

      console.log("✅ Student details saved to Preferences.");
      console.log("➡️ Navigating to:", redirect);

      navigate({ to: redirect });
    } catch (error) {
      console.error("❌ Error during session selection:", error);
      toast.error(i18n.t("auth:sessionSelection.selectError"));
    } finally {
      setSubmitting(false);
      console.log("✅ Session selection finished. Submitting set to false.");
    }
  };

  if (loading || submitting) {
    console.log(
      "⏳ Showing loader. Loading:",
      loading,
      "Submitting:",
      submitting
    );
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
        <DashboardLoader />
      </div>
    );
  }

  console.log(
    "🎉 Rendering session selection UI. Session count:",
    sessionList.length
  );

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-success-50 via-white to-teal-50 p-4">
      <div className="w-full px-4">
        <div className="text-center space-y-4 mb-10">
        <div className="w-20 h-20 bg-gradient-to-br from-success-500 to-teal-600 rounded-md mx-auto flex items-center justify-center shadow-md">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13..."
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            {t("sessionSelection.title", {
              course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            })}
          </h1>
          <p className="text-gray-600">
            {t("sessionSelection.subtitle", {
              course: getTerminology(
                ContentTerms.Course,
                SystemTerms.Course
              ).toLocaleLowerCase(),
            })}
          </p>
        </div>

        {sessionList.length === 0 ? (
          <div className="flex justify-center items-center h-screen-60">
            <div className="bg-white rounded-md p-6 shadow-lg border border-gray-200 max-w-md w-full text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13..."
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t("sessionSelection.noCoursesTitle", {
                  courses: getTerminologyPlural(
                    ContentTerms.Course,
                    SystemTerms.Course
                  ),
                })}
              </h3>
              <p className="text-gray-600">
                {t("sessionSelection.noCoursesBody", {
                  courses: getTerminologyPlural(
                    ContentTerms.Course,
                    SystemTerms.Course
                  ).toLowerCase(),
                })}
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 w-full">
              {sessionList.map((session) => (
                <div
                  key={session.id}
                  className="group cursor-pointer transition-all duration-300 hover:scale-[1.02]"
                  onClick={() => handleSessionSelect(session)}
                >
                  <Card className="border shadow-sm hover:shadow-md border-gray-200 hover:border-emerald-300 rounded-md">
                    <div className="relative h-36 overflow-hidden rounded-t-lg">
                      {imageUrls[session.id] ? (
                        <img
                          src={imageUrls[session.id]}
                          alt={toTitleCase(session.package_dto.package_name)}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                        />
                      ) : (
                        <div className="flex w-full h-full items-center justify-center bg-gradient-to-br from-success-100 to-teal-100">
                          <svg
                            className="w-12 h-12 text-emerald-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 6.253v13..."
                            />
                          </svg>
                        </div>
                      )}
                    </div>

                    <CardHeader className="pb-2">
                      <h3 className="text-lg font-semibold text-gray-900 group-hover:text-emerald-600 truncate">
                        {toTitleCase(session.package_dto.package_name)}
                      </h3>
                    </CardHeader>

                    <CardContent className="space-y-2 text-sm text-gray-600">
                      <div className="flex items-center space-x-1">
                        <span className="font-medium">
                          {t("sessionSelection.sessionLabel", {
                            session: getTerminology(
                              ContentTerms.Session,
                              SystemTerms.Session
                            ),
                          })}
                        </span>
                        <span className="truncate">
                          {toTitleCase(session.session.session_name)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span className="font-medium">
                          {t("sessionSelection.levelLabel", {
                            level: getTerminology(
                              ContentTerms.Level,
                              SystemTerms.Level
                            ),
                          })}
                        </span>
                        <span>{toTitleCase(session.level.level_name)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span className="font-medium">
                          {t("sessionSelection.startLabel")}
                        </span>
                        <span>
                          {new Date(session.start_time).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="pt-1 space-y-1">
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>{t("sessionSelection.readyToStart")}</span>
                          <span>100%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div className="bg-gradient-to-r from-success-500 to-teal-500 h-1.5 rounded-full w-full" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionSelectionPage;
