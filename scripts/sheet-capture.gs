// Deploy: open the target Google Sheet, Extensions > Apps Script, paste this in,
// then Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
// Copy the resulting /exec URL and paste it into SHEET_ENDPOINT at the top of web/public/log.html.
// Each recorded action then appends one row here (the page POSTs no-cors JSON).
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["received", "ts", "who", "what", "type", "hours", "withinMandate", "exceptions", "root"]);
  }
  var b = {};
  if (e && e.postData && e.postData.contents) { try { b = JSON.parse(e.postData.contents); } catch (err) { b = {}; } }
  var p = (e && e.parameter) || {};
  var g = function (k) { return b[k] !== undefined ? b[k] : (p[k] !== undefined ? p[k] : ""); };
  sheet.appendRow([new Date(), g("ts"), g("who"), g("what"), g("type"), g("hours"), g("withinMandate"), g("exceptions"), g("root")]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
