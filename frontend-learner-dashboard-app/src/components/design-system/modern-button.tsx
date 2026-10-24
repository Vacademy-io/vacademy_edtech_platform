import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { useTranslation } from "react-i18next";

export interface ModernButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "outline" | "ghost" | "link";
  size?: "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
}

const modernButtonVariants = {
  base: "inline-flex items-center justify-center whitespace-nowrap text-subtitle font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] hover:shadow-lg transform-gpu",
  
  variant: {
    primary:
      "bg-primary-500 text-white hover:bg-primary-400 active:bg-primary-600 shadow-md hover:shadow-lg hover:shadow-primary-500/25",
    secondary:
      "bg-white border border-border text-foreground hover:bg-accent hover:text-accent-foreground shadow-sm hover:shadow-md",
    destructive:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md hover:shadow-lg hover:shadow-destructive/25",
    outline:
      "border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm hover:shadow-md",
    ghost:
      "hover:bg-accent hover:text-accent-foreground",
    link:
      "text-primary underline-offset-4 hover:underline",
  },
  
  size: {
    sm: "h-9 px-3 text-caption rounded-md",
    md: "h-10 px-4 py-2 text-body rounded-lg",
    lg: "h-11 px-8 text-subtitle rounded-lg",
    xl: "h-14 px-10 text-title rounded-xl",
  },
  
  rounded: {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    full: "rounded-full",
  },
};

const ModernButton = forwardRef<HTMLButtonElement, ModernButtonProps>(
  ({
    className,
    variant = "primary",
    size = "md",
    rounded,
    isLoading = false,
    leftIcon,
    rightIcon,
    asChild = false,
    children,
    disabled,
    ...props
  }, ref) => {
    const { t } = useTranslation("uiAtomsA");
    const Comp = asChild ? Slot : "button";

    // Use size-based rounding if no specific rounding is provided
    const roundingClass = rounded ? modernButtonVariants.rounded[rounded] : "";
    
    return (
      <Comp
        className={cn(
          modernButtonVariants.base,
          modernButtonVariants.variant[variant],
          modernButtonVariants.size[size],
          roundingClass,
          isLoading && "cursor-not-allowed opacity-50",
          className
        )}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <div className="me-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {t("modernButton.loading")}
          </>
        ) : (
          <>
            {leftIcon && <span className="me-2 flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="ms-2 flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </Comp>
    );
  }
);

ModernButton.displayName = "ModernButton";

export { ModernButton, modernButtonVariants }; 