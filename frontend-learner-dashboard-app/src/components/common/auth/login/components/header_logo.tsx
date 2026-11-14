// import { SsdcLogo_Login } from "@/assets/svgs"; // Add the logo here
import Logo from "@/svgs/ssdc-logo.svg?url"
import { useTranslation } from "react-i18next";

export default function HeaderLogo() {
  const { t } = useTranslation("authExtraA");
  return (
    <div>
    <div className=" flex flex-col w-full items-center justify-center" style={{ padding: '6%' }}>
      <img src={Logo} alt={t("logo.alt")} />
    </div>
    </div>
  );
}
