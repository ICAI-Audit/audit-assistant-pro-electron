import * as React from "react";

import { cn } from "@/lib/utils";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";

interface AutoGrowTextareaProps extends TextareaProps {
  /** Height in px above which the textarea scrolls instead of growing. */
  maxHeight?: number;
}

/** A textarea that grows with its content up to maxHeight. */
const AutoGrowTextarea = React.forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  ({ className, value, maxHeight = 240, ...props }, ref) => {
    const inner = React.useRef<HTMLTextAreaElement | null>(null);

    React.useLayoutEffect(() => {
      const element = inner.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
      element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [value, maxHeight]);

    return (
      <Textarea
        ref={(node) => {
          inner.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        value={value}
        className={cn("min-h-[5.5rem] resize-none", className)}
        {...props}
      />
    );
  },
);
AutoGrowTextarea.displayName = "AutoGrowTextarea";

export { AutoGrowTextarea };
