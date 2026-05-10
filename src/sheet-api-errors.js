/**
 * @param {unknown} err
 * @returns {string}
 */
function extractMessage(err) {
  const g = /** @type {{ response?: { data?: { error?: { message?: string } } } }} */ (err);
  return (
    g.response?.data?.error?.message ||
    /** @type {Error} */ (err)?.message ||
    String(err)
  );
}

/**
 * Thông báo ngắn gọn cho lỗi Google Sheets API (đặc biệt API chưa bật).
 * @param {unknown} err
 */
export function formatGoogleSheetUserMessage(err) {
  const msg = extractMessage(err);

  if (
    /Google Sheets API has not been used|it is disabled|SERVICE_DISABLED|has not been used in project/i.test(
      msg,
    )
  ) {
    const m = msg.match(/project[= ](\d+)/i);
    const projectId = m ? m[1] : '';
    const enableUrl = projectId
      ? `https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=${projectId}`
      : 'https://console.cloud.google.com/apis/library/sheets.googleapis.com';
    return (
      `Google Sheets API chưa bật cho Cloud project${projectId ? ` ${projectId}` : ''}. ` +
      `Mở Console → APIs & Services → Library → tìm "Google Sheets API" → Enable. ` +
      `Hoặc: ${enableUrl} — sau khi bật, đợi 1–3 phút rồi copy lại.`
    );
  }

  if (/PERMISSION_DENIED|does not have permission|insufficient authentication scopes/i.test(msg)) {
    return (
      'Không có quyền ghi vào bảng này. Hãy chia sẻ Google Sheet cho đúng tài khoản đã copyhub login, ' +
      `hoặc chạy lại copyhub login. Chi tiết: ${msg}`
    );
  }

  if (/NOT_FOUND|not found|Unable to parse range|Requested entity was not found/i.test(msg)) {
    return `Không tìm thấy spreadsheet hoặc vùng ô. Kiểm tra Spreadsheet ID trong ~/.copyhub/config.json. Chi tiết: ${msg}`;
  }

  return msg;
}
