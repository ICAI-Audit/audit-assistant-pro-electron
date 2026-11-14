import * as React from "react";

import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const SIZES = {
  sm: "max-w-[440px]",
  md: "max-w-[560px]",
  lg: "max-w-[720px]",
  xl: "max-w-[960px]",
} as const;

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof SIZES;
  /**
   * When true, Esc and the close button ask before discarding, and a click outside
   * the dialog is ignored.
   */
  dirty?: boolean;
  /** Wraps body and footer in a <form> so Enter submits. */
  onSubmit?: () => void;
  className?: string;
}

/**
 * Centred dialog: title, subtitle and close button on top, scrolling body, footer
 * with right-aligned actions. Focus returns to the element that opened it.
 */
function Modal({ open, onOpenChange, title, description, children, footer, size = "md", dirty = false, onSubmit, className }: ModalProps) {
  const [confirming, setConfirming] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const Wrapper = onSubmit ? "form" : "div";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else if (dirty) setConfirming(true);
          else onOpenChange(false);
        }}
      >
        <DialogContent
          overlayClassName="bg-slate-900/50 backdrop-blur-[2px]"
          className={cn(
            "flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-xl bg-card p-0 sm:rounded-xl",
            SIZES[size],
            className,
          )}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          onInteractOutside={(event) => {
            if (dirty) event.preventDefault();
          }}
        >
          <div className="space-y-1 px-6 pb-4 pr-14 pt-6">
            <DialogTitle className="text-lg font-semibold leading-tight tracking-tight">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
          <Wrapper
            className="flex min-h-0 flex-1 flex-col"
            {...(onSubmit
              ? {
                  noValidate: true,
                  onSubmit: (event: React.FormEvent) => {
                    event.preventDefault();
                    onSubmit();
                  },
                }
              : {})}
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6 pt-1">{children}</div>
            {footer}
          </Wrapper>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="max-w-[420px] rounded-xl sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved changes. If you close now, they will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirming(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ModalFooterProps {
  /** Helper text on the left, e.g. why Save is disabled. */
  note?: React.ReactNode;
  children: React.ReactNode;
}

function ModalFooter({ note, children }: ModalFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t bg-muted/40 px-6 py-4">
      <p className="min-w-0 flex-1 basis-[12rem] text-xs text-subtle" aria-live="polite">
        {note}
      </p>
      <div className="flex items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** Cancel button that goes through the same dirty-form check as Esc and the close icon. */
function ModalCancel({ children = "Cancel", disabled }: { children?: React.ReactNode; disabled?: boolean }) {
  return (
    <DialogClose asChild>
      <Button type="button" variant="outline" disabled={disabled}>
        {children}
      </Button>
    </DialogClose>
  );
}

export { Modal, ModalFooter, ModalCancel };
