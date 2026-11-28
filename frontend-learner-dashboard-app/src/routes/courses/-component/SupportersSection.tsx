import React from "react";
import { useTranslation } from "react-i18next";

interface Supporter {
  name: string;
  image: string;
  alt: string;
}

const supporters: Supporter[] = [
  {
    name: "Milpitas Unified School District",
    image: "/images/SupportesImages/image 21.png", // Assuming images are in public folder
    alt: "Milpitas Unified School District Logo"
  },
  {
    name: "Coursera",
    image: "/images/SupportesImages/image 22.png",
    alt: "Coursera Logo"
  },
  {
    name: "Amazon",
    image: "/images/SupportesImages/image 23.png",
    alt: "Amazon Logo"
  },
  {
    name: "NVIDIA",
    image: "/images/SupportesImages/image 24.png",
    alt: "NVIDIA Logo"
  },
  {
    name: "Cisco",
    image: "/images/SupportesImages/image 25.png",
    alt: "Cisco Logo"
  },
  {
    name: "Broadcom",
    image: "/images/SupportesImages/image 26.png",
    alt: "Broadcom Logo"
  },
];

const SupportersSection: React.FC = () => {
  const { t } = useTranslation("coursesRouteA");
  return (
    <section className="py-12 bg-white text-center">
      <h2 className="text-3xl font-bold text-gray-800 mb-4"> {/* Increased size and margin */}
        {t("supporters.titlePrefix")} <span className="text-blue-600">{t("supporters.titleHighlight")}</span> {/* Adjusted blue color for consistency */}
      </h2>

      <div className="mt-10 flex flex-wrap justify-center items-center gap-x-10 gap-y-6 md:gap-x-16"> {/* Increased gaps and top margin */}
        {supporters.map((supporter, index) => (
          <img
            key={index} // Using index as key is fine if list is static and order doesn't change
            src={supporter.image}
            alt={supporter.alt} // Alt text already provided
            title={supporter.name} // Added title attribute for hover tooltip
            className="h-10 w-10 md:h-14 object-contain transition-all duration-300 ease-in-out" // Removed filter grayscale and hover:grayscale-0
          />
        ))}
      </div>
    </section>
  );
};

export default SupportersSection; 