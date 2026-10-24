import React from "react";
import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

interface PolicyProps {
    policies: {
        [key: string]: {
            title: string;
            content: string;
        };
    };
}

export const Policy: React.FC<PolicyProps> = ({ policies }) => {
    const { t } = useTranslation("coursePlayerB");
    const params = useParams({ strict: false }) as Record<string, string>;
    const policyType = params.policyType || params.courseId;

    // Try to match by policyType, or fall back to the first available policy in the object
    const policy = policies[policyType] || Object.values(policies)[0];

    if (!policy) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
                <h1 className="text-2xl font-bold text-gray-900">{t("policy.notFoundTitle")}</h1>
                <p className="text-gray-600">{t("policy.notFoundDescription")}</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-12 md:py-10">
            <div className="bg-white rounded-catalogue-lg shadow-sm border border-gray-100 px-4 md:p-12 space-y-8">
                <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 border-b pb-6">
                    {policy.title}
                </h1>
                <div
                    className="prose prose-blue max-w-none text-gray-700 leading-relaxed
            prose-headings:text-gray-900 prose-headings:font-bold
            prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-6
            prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-4
            prose-p:mb-6
            prose-ul:list-disc prose-ul:ps-6 prose-ul:mb-6
            prose-li:mb-2"
                    dangerouslySetInnerHTML={{ __html: policy.content }}
                />
            </div>
        </div>
    );
};
