import { useTranslation } from "react-i18next";
import { useOfflineAvailable } from "@/hooks/offline/use-offline-availability";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { SidebarMenu } from "@/components/ui/sidebar";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { collectSidebarNavRoutes } from "./active-route";

import { SidebarItem } from "./sidebar-item";
import {
  getHamBurgerSidebarItemsData,
  stripOfflineEntries,
  filterHamburgerMenuItemsWithPermissions,
  getTerminology,
} from "./utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import "./scrollbarStyle.css";
import useStore from "./useSidebar";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useStudentPermissions } from "@/hooks/use-student-permissions";
import { Preferences } from "@capacitor/preferences";
import { Student } from "@/types/user/user-detail";
import { getPublicUrl } from "@/services/upload_file";
import { User } from "@phosphor-icons/react";
import { useIsIOS } from "@/hooks/useIsIOS";

export const LogoutSidebar = ({
  sidebarComponent,
}: {
  sidebarComponent?: React.ReactNode;
}) => {
  const { t } = useTranslation("layoutCommonA");
  const {
    instituteLogoFileUrl,
    sideBarOpen,
    setSidebarOpen,
    homeIconClickRoute,
  } = useStore();
  const navigate = useNavigate();
  const isIOS = useIsIOS();
  const handleInstituteLogoClick = () => {
    if (homeIconClickRoute) {
      window.location.href = homeIconClickRoute;
    }
  };

  const { permissions } = useStudentPermissions();

  const [filteredHamburgerItems, setFilteredHamburgerItems] = useState(() =>
    getHamBurgerSidebarItemsData(t)
  );
  // Same offline gate as the sidebar and the top-navbar dropdown: this sheet
  // renders the same list, so without it the entry stays reachable here.
  const offlineAvailable = useOfflineAvailable();
  const offlineFilteredItems =
    offlineAvailable === true
      ? filteredHamburgerItems
      : stripOfflineEntries(filteredHamburgerItems);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navRoutes = collectSidebarNavRoutes(
    offlineFilteredItems.map((obj) => ({ ...obj, to: obj.to || "/" })),
    pathname
  );

  const [studentData, setStudentData] = useState<Student | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string | undefined>(
    undefined
  );

  useEffect(() => {
    if (isNullOrEmptyOrUndefined(permissions)) return;
    filterHamburgerMenuItemsWithPermissions(
      getHamBurgerSidebarItemsData(t),
      permissions || {
        canViewProfile: false,
        canEditProfile: false,
        canDeleteProfile: false,
        canViewFiles: false,
        canViewReports: false,
      }
    ).then((data) => {
      setFilteredHamburgerItems(data);
    });
  }, [permissions]);

  // Fetch student data for profile display
  useEffect(() => {
    const fetchStudentData = async () => {
      try {
        const { value } = await Preferences.get({ key: "StudentDetails" });

        if (!value) {
          return;
        }

        try {
          // Parse the JSON data
          const parsedData = JSON.parse(value);

          // Handle both array and object formats
          let studentDetails: Student;
          if (Array.isArray(parsedData)) {
            if (parsedData.length === 0) {
              return;
            }
            studentDetails = parsedData[0];
          } else if (typeof parsedData === "object" && parsedData !== null) {
            studentDetails = parsedData;
          } else {
            console.error("Unexpected data format:", parsedData);
            return;
          }

          setStudentData(studentDetails);

          if (studentDetails.face_file_id) {
            try {
              const imageUrl = await getPublicUrl(studentDetails.face_file_id);
              setProfileImageUrl(imageUrl);
            } catch (error) {
              console.error("Error fetching profile image:", error);
            }
          }
        } catch (parseError) {
          console.error("Error parsing JSON from Preferences:", parseError);
        }
      } catch (error) {
        console.error("Error fetching student data from Preferences:", error);
      }
    };

    fetchStudentData();
  }, []);

  return (
    <Sheet open={sideBarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent
        side="right"
        hideCloseButton={isIOS}
        className="sidebar-content flex flex-col bg-white border-s border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800 p-0 w-vw-86 sm:w-80 transition-all duration-300 ease-in-out shadow-xl"
      >
        <SheetHeader className={`px-5 py-5 border-b border-neutral-100 dark:border-neutral-800 bg-gradient-to-r from-white to-neutral-50 dark:from-neutral-900 dark:to-neutral-900 ${isIOS ? 'mt-10' : ''}`}>
          <div className="flex items-center justify-center">
            <div className="relative group">
              {!isNullOrEmptyOrUndefined(instituteLogoFileUrl) ? (
                <div className="relative">
                  <img
                    src={instituteLogoFileUrl}
                    alt={t("logoutSidebar.instituteLogoAlt")}
                    onClick={
                      homeIconClickRoute ? handleInstituteLogoClick : undefined
                    }
                    className={`w-24 h-24 rounded-xl object-contain p-2 bg-white ${homeIconClickRoute ? "cursor-pointer" : ""
                      }`}
                  />
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
              ) : (
                <div
                  className={`w-16 h-16 bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-800 dark:to-primary-900 border-2 border-primary-200 dark:border-primary-700 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg${homeIconClickRoute ? " cursor-pointer" : ""
                    }`}
                  onClick={
                    homeIconClickRoute ? handleInstituteLogoClick : undefined
                  }
                >
                  <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg shadow-sm"></div>
                </div>
              )}
            </div>
          </div>
        </SheetHeader>

        {/* User Profile Section */}
        {studentData && (
          <div 
            onClick={() => {
              setSidebarOpen();
              navigate({ to: "/user-profile" });
            }}
            className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-gradient-to-r from-neutral-50/50 to-white/50 dark:from-neutral-900/50 dark:to-neutral-900/50 cursor-pointer hover:from-neutral-100/50 hover:to-neutral-50/50 dark:hover:from-neutral-800/50 dark:hover:to-neutral-800/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="relative group">
                {profileImageUrl ? (
                  <div className="relative">
                    <img
                      className="w-12 h-12 rounded-full object-cover border-2 border-primary-200 dark:border-primary-800 transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg"
                      src={profileImageUrl}
                      alt={t("logoutSidebar.profilePhotoAlt")}
                    />
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-800 dark:to-primary-900 border-2 border-primary-300 dark:border-primary-700 flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg">
                    <User
                      size={20}
                      className="text-primary-600 dark:text-primary-300"
                    />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate leading-tight">
                  {studentData.full_name ||
                    getTerminology(RoleTerms.Learner, SystemTerms.Learner)}
                </h3>
                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 truncate">
                  @{studentData.email || studentData.username}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Dark-mode toggle removed 2026-06-11: dark fidelity is not ready
            across the redesigned surfaces; the provider pins light. */}

        <div className="flex-1 px-3 py-4 overflow-y-auto bg-gradient-to-b from-white to-neutral-50/50 dark:from-neutral-900 dark:to-neutral-900/50">
          <SidebarMenu className="space-y-1.5">
            {sidebarComponent
              ? sidebarComponent
              : offlineFilteredItems.map((obj, key) => (
                <div
                  key={key}
                  className="animate-slide-in-right transform transition-all duration-300"
                  style={{
                    animationDelay: `${key * 40}ms`,
                    animationFillMode: "both",
                  }}
                >
                  <div className="relative group">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary-500/5 to-primary-600/5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-95 group-hover:scale-100"></div>
                    <SidebarItem
                      icon={obj.icon}
                      subItems={
                        obj.subItems as
                        | { subItem: string; subItemLink: string }[]
                        | undefined
                      }
                      title={obj.title}
                      to={(obj.to || "/") as string}
                      onClick={setSidebarOpen}
                      navRoutes={navRoutes}
                    />
                  </div>
                </div>
              ))}
          </SidebarMenu>
        </div>

      </SheetContent>
    </Sheet>
  );
};
