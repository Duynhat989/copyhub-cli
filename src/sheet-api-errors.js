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
 * Short user-facing message for Google Sheets API errors (especially API disabled).
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
      `Google Sheets API is not enabled for Cloud project${projectId ? ` ${projectId}` : ''}. ` +
      `Open Console → APIs & Services → Library → search "Google Sheets API" → Enable. ` +
      `Or: ${enableUrl} — after enabling, wait 1–3 minutes then copy again.`
    );
  }

  if (/PERMISSION_DENIED|does not have permission|insufficient authentication scopes/i.test(msg)) {
    return (
      'No permission to write this spreadsheet. Share the Sheet with the Google account used for copyhub login, ' +
      `or run copyhub login again. Details: ${msg}`
    );
  }

  if (/NOT_FOUND|not found|Unable to parse range|Requested entity was not found/i.test(msg)) {
    return `Spreadsheet or range not found. Check Spreadsheet ID in ~/.copyhub/config.json. Details: ${msg}`;
  }

  return msg;
}
