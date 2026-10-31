// ─────────────────────────────────────────────────────────────
// Child Selection Screen — Netflix/Disney+ inspired profile picker
// ─────────────────────────────────────────────────────────────

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile } from "@/types/parent-portal";
import { BASE_URL } from "@/constants/urls";

// ── Avatar Color Palette ────────────────────────────────────────

const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-sky-500 to-info-600",
  "from-success-500 to-teal-600",
  "from-warning-500 to-orange-600",
  "from-danger-500 to-pink-600",
  "from-cyan-500 to-info-500",
  "from-fuchsia-500 to-purple-500",
  "from-lime-500 to-success-600",
];

const AVATAR_EMOJIS = ["🎓", "📚", "🌟", "🎨", "🏆", "🎵", "🔬", "⚽"];

interface ChildSelectionScreenProps {
  children: ChildProfile[];
  parentName: string;
  onSelect: (child: ChildProfile) => void;
}

export function ChildSelectionScreen({
  children,
  parentName,
  onSelect,
}: ChildSelectionScreenProps) {
  const { t } = useTranslation("parent");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-muted flex flex-col items-center justify-center p-4 sm:p-8 relative overflow-hidden"
    >
      {/* Background Ambient Glow - Lightened */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -start-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl opacity-60" />
        <div className="absolute bottom-1/4 -end-20 w-96 h-96 bg-violet-400/10 rounded-full blur-3xl opacity-60" />
        <div className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-col-600 h-96 bg-blue-400/5 rounded-full blur-3xl opacity-60" />
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-center mb-10 sm:mb-14 relative z-10 space-y-stack"
      >
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          {t("admissionPortal.childSelect.hello", { name: parentName })}
        </h1>
        <p className="text-slate-600 font-medium text-sm sm:text-base">
          {t("admissionPortal.childSelect.subtitle")}
        </p>
      </motion.div>

      {/* Profile Cards Grid */}
      <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8 relative z-10 max-w-3xl">
        {children.map((child, index) => (
          <ChildProfileCard
            key={child.id}
            child={child}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Footer hint */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-12 text-slate-400 text-xs sm:text-sm text-center relative z-10 font-medium"
      >
        {t("admissionPortal.childSelect.footerHint")}
      </motion.p>
    </motion.div>
  );
}

// ── Individual Profile Card ─────────────────────────────────────

function ChildProfileCard({
  child,
  index,
  onSelect,
}: {
  child: ChildProfile;
  index: number;
  onSelect: (child: ChildProfile) => void;
}) {
  const gradientClass = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  const emoji = AVATAR_EMOJIS[index % AVATAR_EMOJIS.length];
  const initials = child.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();


  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        delay: 0.15 + index * 0.1,
        type: "spring",
        stiffness: 200,
        damping: 20,
      }}
      whileHover={{ scale: 1.08, y: -4 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onSelect(child)}
      className="group flex flex-col items-center gap-stack focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-2xl p-3"
      id={`child-profile-${child.id}`}
    >
      {/* Avatar Container */}
      <div className="relative">
        {/* Glow Effect */}
        <div
          className={`absolute inset-0 bg-gradient-to-br ${gradientClass} rounded-2xl blur-xl opacity-0 group-hover:opacity-40 transition-opacity duration-500`}
        />

        {/* Avatar */}
        <div
          className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl bg-gradient-to-br ${gradientClass} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300 overflow-hidden border border-slate-200 group-hover:border-primary/20`}
        >
          {child.avatar_file_id ? (
            <img
              src={`${BASE_URL}/files/${child.avatar_file_id}`}
              alt={child.full_name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-4xl sm:text-5xl font-bold text-white/90 select-none">
              {initials}
            </span>
          )}

          {/* Emoji Badge */}
          <div className="absolute -bottom-1 -end-1 w-9 h-9 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-lg shadow-md">
            {emoji}
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="text-center">
        <p className="text-slate-900 font-bold text-sm sm:text-base tracking-wide group-hover:text-primary transition-colors">
          {child.full_name}
        </p>
        {child.grade_applying && (
          <p className="text-slate-500 font-medium text-xs mt-0.5">
            {child.grade_applying}
          </p>
        )}
      </div>
    </motion.button>
  );
}


