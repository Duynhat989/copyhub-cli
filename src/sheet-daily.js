/**
 * Tên tab theo ngày (múi giờ máy): COPYHUB-YYYY-MM-DD
 * Google Sheets: tối đa 100 ký tự; ký tự cấm đã tránh trong format cố định.
 */
export function dailySheetTabName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `COPYHUB-${y}-${m}-${day}`;
}
