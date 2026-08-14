// AlertDialog no padrão shadcn/ui (Radix @radix-ui/react-alert-dialog),
// para confirmações destrutivas/irreversíveis. Difere do Dialog: sem X, sem
// fechar por clique-fora, e um par Cancel/Action explícito no rodapé.
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({ className = '', children, ...props }) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="dlg-overlay" />
      <AlertDialogPrimitive.Content
        className={`dlg-content dlg-content--alert ${className}`}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ children }) {
  return <div className="dlg-header">{children}</div>;
}

export function AlertDialogFooter({ children }) {
  return <div className="dlg-footer">{children}</div>;
}

export function AlertDialogTitle({ children, ...props }) {
  return (
    <AlertDialogPrimitive.Title className="dlg-title" {...props}>
      {children}
    </AlertDialogPrimitive.Title>
  );
}

export function AlertDialogDescription({ children, ...props }) {
  return (
    <AlertDialogPrimitive.Description className="dlg-desc" {...props}>
      {children}
    </AlertDialogPrimitive.Description>
  );
}

export function AlertDialogAction({ className = 'btn btn-primary', ...props }) {
  return <AlertDialogPrimitive.Action className={className} {...props} />;
}

export function AlertDialogCancel({ className = 'btn btn-ghost', ...props }) {
  return <AlertDialogPrimitive.Cancel className={className} {...props} />;
}
