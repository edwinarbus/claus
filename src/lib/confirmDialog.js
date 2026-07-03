// Promise-based replacement for window.confirm/alert so destructive actions use
// a native-style iOS action sheet instead of the browser's chrome dialog. A
// single <ConfirmHost/> (mounted in App) renders the sheet; callers just await:
//
//   if (await confirmDialog({ title: 'Remove stop?', confirmLabel: 'Remove',
//                             tone: 'destructive' })) dispatch(...);
//
// For an info/alert (single button), pass cancelLabel: null.
let opener = null;

export function registerConfirm(fn) { opener = fn; }

export function confirmDialog(opts = {}) {
  return new Promise((resolve) => {
    if (typeof opener !== 'function') {
      // No host mounted (shouldn't happen) — fall back to the native dialog so
      // the action is never silently lost.
      resolve(opts.cancelLabel === null ? true : window.confirm(opts.message || opts.title || ''));
      return;
    }
    opener({ ...opts, resolve });
  });
}
