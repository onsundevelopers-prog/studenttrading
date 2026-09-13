import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Buttons follow Linear's restraint: the lavender accent appears on exactly one
 * primary action at a time, everything else is a surface lift with a hairline.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-hover",
        secondary:
          "border border-hairline bg-surface-2 text-ink hover:bg-surface-3 hover:border-hairline-strong",
        subtle: "bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink",
        ghost: "text-ink-subtle hover:bg-surface-2 hover:text-ink",
        outline:
          "border border-hairline bg-transparent text-ink hover:bg-surface-2",
        danger:
          "border border-neg/40 bg-neg/10 text-neg hover:bg-neg/20 hover:border-neg/60",
        dangerSolid: "bg-neg text-white hover:bg-neg/85",
      },
      size: {
        sm: "h-7 px-2.5 [&_svg]:size-3.5",
        md: "h-8 px-3 [&_svg]:size-4",
        lg: "h-9 px-4 text-sm [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
        iconSm: "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
