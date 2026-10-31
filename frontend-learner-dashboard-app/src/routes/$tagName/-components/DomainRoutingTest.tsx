import React from "react";
import { useDomainRouting } from "@/hooks/use-domain-routing";

export const DomainRoutingTest: React.FC = () => {
  const domainRouting = useDomainRouting();

  return (
    <div className="p-4 bg-gray-100 rounded-catalogue-md space-y-2">
      <h3 className="text-lg font-semibold">Domain Routing Debug Info</h3>
      <div className="space-y-2 text-sm">
        <div>
          <strong>Loading:</strong> {domainRouting.isLoading ? "Yes" : "No"}
        </div>
        <div>
          <strong>Institute ID:</strong> {domainRouting.instituteId || "Not found"}
        </div>
        <div>
          <strong>Institute Name:</strong> {domainRouting.instituteName || "Not found"}
        </div>
        <div>
          <strong>Theme Code:</strong> {domainRouting.instituteThemeCode || "Not found"}
        </div>
        <div>
          <strong>Error:</strong> {domainRouting.error || "None"}
        </div>
        <div>
          <strong>Current URL:</strong> {window.location.href}
        </div>
        <div>
          <strong>Hostname:</strong> {window.location.hostname}
        </div>
      </div>
    </div>
  );
};
