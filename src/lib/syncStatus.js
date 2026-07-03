export const SYNC_LABEL = {
  local: { dot: 'bg-slate-300', text: 'text-slate-400', label: 'Saved here', tip: 'Saving to this browser only. Add Supabase keys in src/config.js to share with Tyler.' },
  connecting: { dot: 'bg-amber-400 live-dot', text: 'text-amber-600', label: 'Connecting…', tip: 'Connecting to the shared trip…' },
  saving: { dot: 'bg-amber-400 live-dot', text: 'text-amber-600', label: 'Saving…', tip: 'Saving your changes to the shared trip…' },
  synced: { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Synced', tip: 'Saved & shared live with Tyler & Edwin.' },
  error: { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Not saved', tip: 'Could not reach the shared trip — your changes are safe in this browser.' },
};

export function syncTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${date} ${time}`;
  }
  catch { return ''; }
}
