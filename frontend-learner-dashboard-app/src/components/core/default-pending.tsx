import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { DashboardLoader } from "./dashboard-loader";

function RootPendingComponent() {
    const { t } = useTranslation("courseComponentsExtra");
    return (
        <>
            <Helmet>
                <title>{document?.title || t("defaultPending.pageTitle")}</title>
                <meta
                    name="description"
                    content={t("defaultPending.metaDescription")}
                />
            </Helmet>
            <div className="flex h-screen w-full items-center justify-center">
                <DashboardLoader />
            </div>
        </>
    );
}

export default RootPendingComponent;
