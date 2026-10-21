import { useEffect } from "react";
import { X } from "lucide-react";
import { HireForm } from "./HireForm";
import type { FundingForm } from "../hooks/useFiatFunding";
import page from "./FlowPage.module.css";

/** Side drawer with the shared hire form. A bank transfer starts the live payment flow behind it. */
export function PayDrawer({ onClose, onBank }: { onClose: () => void; onBank: (form: FundingForm) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={page.drawerOverlay} onClick={onClose}>
      <aside className={page.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={page.drawerHeader}>
          <h3>Fund a job</h3>
          <button className={page.iconButton} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <HireForm
          variant="drawer"
          onBank={(form) => {
            onClose();
            onBank(form);
          }}
          onCreated={onClose}
        />
      </aside>
    </div>
  );
}
