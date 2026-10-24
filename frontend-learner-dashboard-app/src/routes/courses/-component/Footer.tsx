import React, { ChangeEvent, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FaTwitter, FaFacebookF, FaInstagram, FaYoutube } from "react-icons/fa"; // design-lint-ignore: social brand logos (no Phosphor equivalent)
import { Preferences } from "@capacitor/preferences";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";

const Footer: React.FC = () => {
  const { t } = useTranslation("coursesRouteA");
  const [name, setName] = React.useState<string>("");
  const [email, setEmail] = React.useState<string>("");

  const handleSubscribe = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log("Subscribing:", { name, email });
    setName("");
    setEmail("");
  };

  return (
    <footer className="bg-blue-900 text-white">
      <div className="bg-blue-900 p-10 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="space-y-4">
          <img src="/images/logo2.jpg" alt={t("footer.logoAlt")} />
          <p>{t("footer.tagline")}</p>
          <div className="flex gap-4 text-xl">
            <FaTwitter className="hover:text-blue-500 cursor-pointer" />
            <FaFacebookF className="hover:text-blue-600 cursor-pointer" />
            <FaInstagram className="hover:text-pink-500 cursor-pointer" />
            <FaYoutube className="hover:text-red-600 cursor-pointer" />
          </div>
        </div>

        <div className="space-y-stack">
          <h2 className="font-bold text-lg">{t("footer.quickLinks")}</h2>
          <ul className="space-y-1">
            <li>
              <a href="https://codecircle.org/" className="hover:text-blue-400 transition">
                {t("header.nav.home")}
              </a>
            </li>
            <li>
              <a href="https://codecircle.org/about.html" className="hover:text-blue-400 transition">
                {t("header.nav.about")}
              </a>
            </li>
            <li>
              <a href="https://codecircle.org/impact/stories.html" className="hover:text-blue-400 transition">
                {t("header.nav.impact")}
              </a>
            </li>
            <li>
              <a href="https://learner-stgcodecircle.org/courses" className="hover:text-blue-400 transition">
                {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}
              </a>
            </li>
            <li>
              <a href="https://codecircle.org/get-involved.html" className="hover:text-blue-400 transition">
                {t("header.nav.getInvolved")}
              </a>
            </li>
            <li>
              <a href="https://codecircle.org/contact.html" className="hover:text-blue-400 transition">
                {t("header.nav.contact")}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-lg mb-3">{t("footer.contactUs")}</h2>
          <p>
            <a href="https://codecircle.org" className="hover:text-blue-400">
              {t("footer.websiteLabel")}
            </a>
          </p>
          <p>
            {t("footer.emailLabel")}{" "}
            <a
              href="mailto:support@codecircle.org"
              className="hover:text-blue-400"
            >
              support@codecircle.org
            </a>
          </p>
        </div>

        <div className="space-y-stack">
          <h2 className="font-bold text-lg">
            {t("footer.newsletterTitle")}
          </h2>
          <form className="space-y-2" onSubmit={handleSubscribe}>
            <input
              type="text"
              placeholder={t("footer.namePlaceholder")}
              aria-label={t("footer.namePlaceholder")}
              className="w-full p-2 border rounded text-gray-800"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setName(e.target.value)
              }
            />
            <input
              type="email"
              placeholder={t("footer.emailPlaceholder")}
              aria-label={t("footer.emailPlaceholder")}
              className="w-full p-2 border rounded text-gray-800"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
            />
            <button
              type="submit"
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              {t("footer.subscribeButton")}
            </button>
          </form>
        </div>
      </div>

      <div className="border-t-2 border-gray-700 h-20 flex flex-col items-center justify-center text-sm text-white gap-2">
        <p>{t("footer.copyright")}</p>
        <p className="flex gap-2">
          <button
            onClick={async () => {
              try {
                const instituteId = (await Preferences.get({ key: "InstituteId" })).value || "";
                if (instituteId) {
                  const stored = await Preferences.get({ key: `LEARNER_${instituteId}` });
                  if (stored?.value) {
                    const parsed = JSON.parse(stored.value);
                    if (parsed?.privacyPolicyUrl) {
                      window.open(parsed.privacyPolicyUrl, "_blank");
                      return;
                    }
                  }
                }
              } catch {}
              window.open("/privacy-policy", "_blank");
            }}
            className="underline hover:text-blue-300"
            type="button"
          >
            {t("footer.privacyPolicy")}
          </button>
          |
          <button
            onClick={async () => {
              try {
                const instituteId = (await Preferences.get({ key: "InstituteId" })).value || "";
                if (instituteId) {
                  const stored = await Preferences.get({ key: `LEARNER_${instituteId}` });
                  if (stored?.value) {
                    const parsed = JSON.parse(stored.value);
                    if (parsed?.termsAndConditionUrl) {
                      window.open(parsed.termsAndConditionUrl, "_blank");
                      return;
                    }
                  }
                }
              } catch {}
              window.open("/terms-and-conditions", "_blank");
            }}
            className="underline hover:text-blue-300"
            type="button"
          >
            {t("footer.termsOfService")}
          </button>
        </p>
      </div>
    </footer>
  );
};

export default Footer;
