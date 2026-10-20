import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-semibold tracking-wide transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-wall-800 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-brand-bright to-brand-deep text-wall-950 shadow-[0_10px_30px_-12px_rgba(92,240,247,0.9)] hover:from-white hover:to-brand",
        chrome:
          "bg-gradient-to-b from-white via-chrome-2 to-chrome-3 text-wall-900 shadow-[0_10px_30px_-14px_rgba(255,255,255,0.7)] hover:via-white hover:to-chrome-2",
        outline:
          "border border-[rgba(148,196,208,0.22)] bg-wall-800/70 text-snow hover:border-brand/60 hover:text-brand",
        ghost: "text-ash hover:bg-wall-700/70 hover:text-snow",
        danger:
          "border border-danger/40 bg-danger/10 text-danger hover:border-danger/70 hover:bg-danger/20",
      },
      size: {
        sm: "h-9 rounded-lg px-3.5 text-xs",
        md: "h-11 rounded-xl px-5 text-sm",
        lg: "h-13 rounded-xl px-7 text-base",
        icon: "size-9 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
