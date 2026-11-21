import { cn } from "@/lib/utils";
import { forwardRef } from "react";

export interface ModernCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "glass" | "outlined" | "subtle";
  padding?: "none" | "sm" | "md" | "lg" | "xl";
  rounded?: "sm" | "md" | "lg" | "xl" | "2xl";
  hoverable?: boolean;
  interactive?: boolean;
}

const modernCardVariants = {
  base: "card-base card-interactive transition-all duration-300 ease-out",
  
  variant: {
    default: "card-hover",
    elevated: "shadow-lg hover:shadow-xl",
    glass: "bg-white/80 backdrop-blur-sm border border-white/20 shadow-lg hover:shadow-xl hover:bg-white/90",
    outlined: "bg-transparent border border-border hover:bg-accent/5",
    subtle: "bg-accent/30 border border-accent hover:bg-accent/50",
  },
  
  padding: {
    none: "p-0",
    sm: "p-3",
    // md/lg ride the density axis (p-card == p-4, p-card-lg == p-6 at the
    // default setting). sm/xl stay literal so the ladder keeps its end stops.
    md: "p-card",
    lg: "p-card-lg",
    xl: "p-8",
  },
  
  rounded: {
    sm: "rounded-md",
    md: "rounded-lg",
    lg: "rounded-lg",
    xl: "rounded-xl",
    "2xl": "rounded-2xl",
  },
  
  hoverable: "hover:translate-y-[-2px] hover:scale-[1.02] cursor-pointer",
  interactive: "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
};

const ModernCard = forwardRef<HTMLDivElement, ModernCardProps>(
  ({
    className,
    variant = "default",
    padding = "md",
    rounded = "lg",
    hoverable = false,
    interactive = false,
    children,
    ...props
  }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          modernCardVariants.base,
          modernCardVariants.variant[variant],
          modernCardVariants.padding[padding],
          modernCardVariants.rounded[rounded],
          hoverable && modernCardVariants.hoverable,
          interactive && modernCardVariants.interactive,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ModernCard.displayName = "ModernCard";

// Header component for cards
export interface ModernCardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "bordered" | "subtle";
}

const ModernCardHeader = forwardRef<HTMLDivElement, ModernCardHeaderProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    const variants = {
      default: "flex flex-col space-y-1.5 p-card-lg",
      bordered: "flex flex-col space-y-1.5 p-card-lg border-b border-border",
      subtle: "flex flex-col space-y-1.5 p-card-lg bg-accent/20",
    };

    return (
      <div
        ref={ref}
        className={cn(variants[variant], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ModernCardHeader.displayName = "ModernCardHeader";

// Title component for cards
export interface ModernCardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  size?: "sm" | "md" | "lg";
}

const ModernCardTitle = forwardRef<HTMLParagraphElement, ModernCardTitleProps>(
  ({ className, size = "md", children, ...props }, ref) => {
    const sizes = {
      sm: "text-body font-semibold leading-none tracking-tight",
      md: "text-subtitle font-semibold leading-none tracking-tight",
      lg: "text-title font-semibold leading-none tracking-tight",
    };

    return (
      <h3
        ref={ref}
        className={cn(sizes[size], className)}
        {...props}
      >
        {children}
      </h3>
    );
  }
);

ModernCardTitle.displayName = "ModernCardTitle";

// Description component for cards
const ModernCardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn("text-caption text-muted-foreground", className)}
        {...props}
      >
        {children}
      </p>
    );
  }
);

ModernCardDescription.displayName = "ModernCardDescription";

// Content component for cards
const ModernCardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("p-card-lg pt-0", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ModernCardContent.displayName = "ModernCardContent";

// Footer component for cards
export interface ModernCardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "bordered" | "subtle";
}

const ModernCardFooter = forwardRef<HTMLDivElement, ModernCardFooterProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    const variants = {
      default: "flex items-center p-card-lg pt-0",
      bordered: "flex items-center p-card-lg pt-0 border-t border-border",
      subtle: "flex items-center p-card-lg pt-0 bg-accent/20",
    };

    return (
      <div
        ref={ref}
        className={cn(variants[variant], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ModernCardFooter.displayName = "ModernCardFooter";

export {
  ModernCard,
  ModernCardHeader,
  ModernCardTitle,
  ModernCardDescription,
  ModernCardContent,
  ModernCardFooter,
  modernCardVariants,
}; 