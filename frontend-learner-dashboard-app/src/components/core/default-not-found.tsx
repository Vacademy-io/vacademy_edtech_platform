import { Link, useRouter } from "@tanstack/react-router";
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

            <div className="grid h-screen w-full select-none place-content-center bg-base-primary px-4 text-gray-700 dark:text-gray-800">
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
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Button asChild variant={"default"} className="h-10 min-w-32">
                            <Link to="/">{t("common.returnHome")}</Link>
                        </Button>
                        {router.history.canGoBack() && (
                            <Button
                                variant={"outline"}
                                className="h-10 min-w-32"
                                onClick={() => router.history.back()}
                            >
                                {t("common.goBack")}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

export default RootNotFoundComponent;
