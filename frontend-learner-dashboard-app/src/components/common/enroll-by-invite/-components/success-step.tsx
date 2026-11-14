import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

interface SuccessStepProps {
    courseName: string;
    approvalRequired: boolean;
    email: string;
    isAutoLoggingIn?: boolean;
    config?: {
        redirectPath?: string;
        showLoginButton?: boolean;
        content?: string;
    };
    /**
     * Optional formatted amount (currency symbol + value) to interpolate into
     * `config.content` wherever the institute used the {{amount}} token.
     * When undefined or empty, the token is replaced with an empty string.
     */
    amountDisplay?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const interpolateTokens = (
    template: string,
    vars: Record<string, string>
): string => {
    let out = template;
    for (const [key, value] of Object.entries(vars)) {
        const re = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
        const replacement = value ?? "";
        // Function form neutralizes $&, $1, $$ etc. in the replacement string —
        // so an amount like "$25.00" is inserted verbatim.
        out = out.replace(re, () => replacement);
    }
    return out;
};

const SuccessStep = ({
    courseName,
    approvalRequired,
    email,
    isAutoLoggingIn,
    config,
    amountDisplay,
}: SuccessStepProps) => {
    const { t } = useTranslation("enrollmentB");
    const renderedContent = config?.content
        ? interpolateTokens(config.content, {
              courseName: courseName ?? "",
              amount: amountDisplay ?? "",
          })
        : null;
    const navigate = useNavigate();
    return (
        <div className="space-y-6">
            {/* Success Card */}
            <Card className="shadow-lg border bg-white">
                <CardContent className="p-5 sm:p-card-lg text-center">
                    <div className="flex items-center justify-center mb-6">
                        <div className="p-3 bg-green-100 rounded-full">
                            <CheckCircle className="w-12 h-12 text-green-600" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-4">
                        {t("successStep.title")}
                    </h2>
                    {renderedContent ? (
                        <div dangerouslySetInnerHTML={{ __html: renderedContent }} className="text-gray-600 text-lg mb-6" />
                    ) : (
                        <p className="text-gray-600 text-lg mb-6">
                            {t("successStep.defaultMessage.intro", { courseName })}{" "}
                            <span className="text-blue-500">{email}</span>
                            {t("successStep.defaultMessage.outro")}
                        </p>
                    )}
                    {/* Approval Required Sub-card */}
                    {approvalRequired && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-6">
                            <div className="flex items-start gap-3">
                                <div className="p-1.5 bg-amber-100 rounded-lg flex-shrink-0">
                                    <Warning className="w-5 h-5 text-amber-600" />
                                </div>
                                <div className="text-start space-y-1">
                                    <h3 className="text-base font-semibold text-gray-900">
                                        {t("successStep.approvalRequired.title")}
                                    </h3>
                                    <p className="text-gray-600 text-sm leading-relaxed">
                                        {t("successStep.approvalRequired.body")}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Check Email Status Button */}
                    <div className="mt-6">
                        {isAutoLoggingIn ? (
                            <div className="flex flex-col items-center gap-stack">
                                <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                                <p className="text-primary-600 font-medium italic">{t("successStep.redirectingToDashboard")}</p>
                            </div>
                        ) : config?.showLoginButton !== false ? (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="large"
                                layoutVariant="default"
                                className="w-full sm:w-auto text-white font-semibold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                                onClick={() => {
                                    if (config?.redirectPath) {
                                        if (config.redirectPath.startsWith('http')) {
                                            window.location.href = config.redirectPath;
                                        } else {
                                            navigate({ to: config.redirectPath });
                                        }
                                    } else {
                                        navigate({ to: "/login" });
                                    }
                                }}
                            >
                                {config?.redirectPath ? t("successStep.continue") : t("successStep.loginNow")}
                            </MyButton>
                        ) : null}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default SuccessStep;
