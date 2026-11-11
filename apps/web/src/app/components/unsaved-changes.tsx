"use client";

import { forwardRef, useEffect, useImperativeHandle, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { FormDialogHeader } from "./form-dialog-header";

const navigationEvent = "evseye:before-navigation";
const savedEvent = "evseye:form-saved";
export function requestNavigation(proceed: () => void) {
  const event = new CustomEvent(navigationEvent, { cancelable: true, detail: { proceed } });
  if (window.dispatchEvent(event)) { proceed(); return true; }
  return false;
}
export function guardLinkNavigation(event: MouseEvent<HTMLElement>) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
  if (!link || link.download || (link.target && link.target !== "_self") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const before = new CustomEvent(navigationEvent, { cancelable: true, detail: { proceed: () => window.location.assign(link.href) } });
  if (!window.dispatchEvent(before)) event.preventDefault();
}
export function markFormsSaved() { window.dispatchEvent(new Event(savedEvent)); }
export type UnsavedChangesHandle = { leave: (proceed: () => void) => void };

export const UnsavedChangesScope = forwardRef<UnsavedChangesHandle, { children: ReactNode; resetKey?: unknown; formsOnly?: boolean }>(function UnsavedChangesScope({ children, resetKey, formsOnly = false }, ref) {
  const titleId = useId();
  const scope = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const baseline = useRef<string | null>(null);
  const dirty = useRef(false);
  const bypass = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const snapshot = () => JSON.stringify(Array.from(scope.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]), textarea, select") ?? [])
    .filter((field) => field.closest("[data-unsaved-scope]") === scope.current && (!formsOnly || field.closest("form, [data-unsaved-fields]")) && !field.disabled && !("readOnly" in field && field.readOnly))
    .map((field) => [field.name || field.id, field.type, field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type) ? field.checked : field instanceof HTMLInputElement && field.type === "file" ? Array.from(field.files ?? []).map((file) => `${file.name}:${file.size}:${file.lastModified}`) : field.value]));
  const reset = () => { baseline.current = snapshot(); dirty.current = false; };
  const leave = (proceed: () => void) => {
    if (!dirty.current) { proceed(); return; }
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(() => proceed);
  };
  useImperativeHandle(ref, () => ({ leave }));
  useEffect(() => {
    const frame = requestAnimationFrame(reset);
    return () => cancelAnimationFrame(frame);
    // Reset only when the caller records a successful save/version change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: Event) => { if (dirty.current && !event.defaultPrevented) { event.preventDefault(); leave(() => requestNavigation((event as CustomEvent<{ proceed: () => void }>).detail.proceed)); } };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(navigationEvent, navigate);
    window.addEventListener(savedEvent, reset);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener(navigationEvent, navigate); window.removeEventListener(savedEvent, reset); };
  });
  useEffect(() => {
    if (pending) { dialog.current?.showModal(); cancel.current?.focus(); }
    else dialog.current?.close();
  }, [pending]);
  const stay = () => { setPending(null); trigger.current?.focus(); };
  return <><div ref={scope} data-unsaved-scope onFocusCapture={() => { if (!dirty.current) reset(); }} onChangeCapture={(event) => {
    if ((event.target as HTMLElement).closest("[data-unsaved-scope]") !== scope.current) return;
    if (formsOnly && !(event.target as HTMLElement).closest("form, [data-unsaved-fields]")) return;
    Promise.resolve().then(() => { dirty.current = baseline.current !== snapshot(); });
  }} onClickCapture={(event) => {
    if (bypass.current || !dirty.current) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled || button.closest("[data-unsaved-scope]") !== scope.current || !/^(cancel(?: edit)?|close(?: .*)?)$/i.test(button.textContent?.trim() ?? "")) return;
    event.preventDefault(); event.stopPropagation();
    leave(() => { bypass.current = true; button.click(); bypass.current = false; });
  }} onInvalidCapture={(event) => {
    const form = (event.target as HTMLElement).closest("form");
    requestAnimationFrame(() => form?.querySelector<HTMLElement>(":invalid")?.focus());
  }}>{children}</div>
    <dialog ref={dialog} className="sa-dialog" aria-label="Discard unsaved changes?" aria-modal="true" onCancel={(event) => { event.preventDefault(); stay(); }}>
      <div className="sa-form sa-dialog-surface client-form-dialog">
        <FormDialogHeader titleId={titleId} title="Discard unsaved changes?" onClose={stay} />
        <div className="client-dialog-content"><p>Your changes have not been saved. Leave this form and discard them?</p>
        <div className="form-actions"><button ref={cancel} type="button" className="secondary" onClick={stay}>Keep editing</button><button type="button" className="danger" onClick={() => { const proceed = pending; dirty.current = false; setPending(null); proceed?.(); }}>Discard changes</button></div></div>
      </div>
    </dialog>
  </>;
});
