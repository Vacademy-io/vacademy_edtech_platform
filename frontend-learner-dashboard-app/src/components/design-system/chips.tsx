import { Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
export const StatusCheck = () => (
  <div className="flex items-center justify-center rounded-full bg-green-500 p-1">
    <Check className="h-3 w-3 text-white" />
  </div>
);

export type PlayMode = "EXAM" | "MOCK" | "PRACTICE" | "SURVEY";

export interface StatusChipProps {
  playMode: PlayMode;
  className?: string;
}

const playModeColors: Record<PlayMode, string> = {
  EXAM: "bg-success-400 text-black",
  MOCK: "bg-purple-50 text-black",
  PRACTICE: "bg-blue-50 text-black",
  SURVEY: "bg-red-50 text-black",
};

export const StatusChip = ({ playMode, className }: StatusChipProps) => {
  return (
    <div
      className={`inline-flex items-center rounded-sm px-2 py-1  border border-gray-200 ${playModeColors[playMode]} ${className}`}
    >
      <div className="w-2 h-2 rounded-full bg-white opacity-75 me-1.5" />
      <span className="text-xs font-medium">{playMode}</span>
    </div>
  );
};

export const MarkBadge = ({ marks }: { marks: number }) => {
  const { t } = useTranslation("uiAtomsA");
  return (
    <div className="inline-block px-2 py-1 bg-green-500 text-white text-sm font-semibold rounded-md">
      {t("markBadge.marks", { marks })}
    </div>
  );
};

// const STATUS_STYLES = {
//   active: {
//     background: 'bg-green-100',
//     text: 'text-green-700',
//     icon: 'text-green-600'
//   },
//   error: {
//     background: 'bg-red-100',
//     text: 'text-red-700',
//     icon: 'text-red-600'
//   },
//   inactive: {
//     background: 'bg-gray-100',
//     text: 'text-gray-700',
//     icon: 'text-gray-600'
//   }
// };

// export const StatusChips = ({
//   children,
//   status = 'inactive',
//   showIcon = true,
//   className = ''
// }: {
//   children?: React.ReactNode;
//   status?: 'active' | 'error' | 'inactive';
//   showIcon?: boolean;
//   className?: string;
// }) => {
//   const { background, text, icon } = STATUS_STYLES[status as 'active' | 'error' | 'inactive'] || STATUS_STYLES.inactive;

//   const renderIcon = () => {
//     if (!showIcon) return null;

//     const iconMap: Record<'active' | 'error' | 'inactive', React.ReactNode> = {
//       active: <Check className={`w-4 h-4 ${icon}`} />,
//       error: <X className={`w-4 h-4 ${icon}`} />,
//       inactive: null
//     };

//     return iconMap[status as 'active' | 'error' | 'inactive'];
//   };

//   return (
//     <div
//       className={`
//         inline-flex items-center justify-center
//         ${background} ${text}
//         px-2 py-1 text-xs font-medium
//         ${className.includes('rounded-full') ? 'rounded-full' : 'rounded-md'}
//         ${children ? 'gap-1' : 'p-1'}
//       `}
//     >
//       {renderIcon()}
//       {children}
//     </div>
//   );
// };

// const ChipsWrapper = ({ children, className }: ChipsWrapperProps) => {
//   return (
//       <div
//           className={cn(
//               "inline-flex h-8 flex-shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-body font-regular text-neutral-600",
//               className,
//           )}
//       >
//           {children}
//       </div>
//   );
// };

// export const StatusChips = ({
//   status,
//   children,
//   className,
//   showIcon = true,
// }: {
//   status: ActivityStatus | "ACTIVE" | "TEMINATED" | "INACTIVE";
//   children?: ReactNode;
//   className?: string;
//   showIcon?: boolean;
// }) => {
//   const normalizedStatus =
//       status === "ACTIVE"
//           ? "active"
//           : status === "INACTIVE"
//             ? "inactive"
//             : (status as ActivityStatus);

//   const statusData = ActivityStatusData[normalizedStatus];
//   const StatusIcon = statusData.icon;

//   return (
//       <ChipsWrapper className={cn(statusData.color.bg, "")}>
//           <div className="flex items-center">
//               {showIcon && (
//                   <StatusIcon
//                       className={cn(statusData.color.icon, "size-5")}
//                       weight="fill"
//                   />
//               )}
//               <div className={cn("text-body capitalize text-neutral-600", className)}>
//                   {children ? children : status}
//               </div>
//           </div>
//       </ChipsWrapper>
//   );
// };
