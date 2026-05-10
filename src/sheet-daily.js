/**
 * Daily tab name (machine local timezone): COPYHUB-YYYY-MM-DD
 * Google Sheets: title max 100 chars; fixed format avoids forbidden characters.
 */
export function dailySheetTabName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `COPYHUB-${y}-${m}-${day}`;
}
