import { useRouter } from "@tanstack/react-router";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";

function RootNotFoundComponent() {
    const { t } = useTranslation("courseComponentsExtra");
    const router = useRouter();

    return (
        <>
            <Helmet>
                <title>{document?.title || t("defaultNotFound.pageTitle")}</title>
                <meta
                    name="description"
                    content={t("defaultNotFound.metaDescription")}
                />
            </Helmet>

            <div className="grid h-screen select-none place-content-center bg-base-primary px-4 text-gray-700 dark:text-gray-800">
                <div className="text-center">
                    <h1 className="text-9xl font-black">404</h1>
                    <p className="text-2xl font-bold tracking-tight sm:text-4xl">
                        {t("defaultNotFound.heading")}
                    </p>
                    <p className="mt-4 text-gray-500">
                        {t("defaultNotFound.descriptionLine1")}
                        <br />
                        {t("defaultNotFound.descriptionLine2")}
                    </p>
                    <div className="mt-8 flex justify-center gap-5 text-base-white">
                        <Button asChild variant={"default"} className="h-10 min-w-32">
                            <div>{t("common.returnHome")}</div>
                        </Button>
                        <Button asChild variant={"default"} className="h-10 min-w-32">
                            <div onClick={() => router.history.back()}>{t("common.goBack")}</div>
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}

export default RootNotFoundComponent;
