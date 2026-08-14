// Dialog no padrão shadcn/ui, construído sobre as primitivas Radix
// (@radix-ui/react-dialog) e estilizado com os tokens TROX (ver app.css).
// Anatomia: Dialog › DialogContent › DialogHeader (Title/Description) + DialogFooter.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className = '', children, showClose = true, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dlg-overlay" />
      <DialogPrimitive.Content className={`dlg-content ${className}`} {...props}>
        {children}
        {showClose && (
          <DialogPrimitive.Close className="dlg-x" aria-label="Fechar">
            <X size={16} aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ children }) {
  return <div className="dlg-header">{children}</div>;
}

export function DialogFooter({ children }) {
  return <div className="dlg-footer">{children}</div>;
}

export function DialogTitle({ children, ...props }) {
  return (
    <DialogPrimitive.Title className="dlg-title" {...props}>
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({ children, ...props }) {
  return (
    <DialogPrimitive.Description className="dlg-desc" {...props}>
      {children}
    </DialogPrimitive.Description>
  );
}
