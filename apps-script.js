/**
 * Maatti order intake — Google Apps Script
 *
 * Deploy this as a web app (Deploy > New deployment > Web app,
 * "Execute as me", "Anyone with the link") and paste the resulting
 * URL into order.js as ORDER_URL.
 *
 * The POC pages are inlined below so the script is fully self-contained —
 * no separate HTML files needed inside the Apps Script project.
 *
 * Setup: run `setupOrders()` once from the editor (it will ask for
 * authorization), then deploy as a web app.
 */

const ORDERS_SHEET_NAME = 'Orders';

const HEADER = [
  'Timestamp', 'Order ID', 'Name', 'Phone', 'Address', 'Pincode',
  'Items', 'Status', 'POC Initials'
];

const COL = {
  TIMESTAMP: 1, ORDER_ID: 2, NAME: 3, PHONE: 4, ADDRESS: 5,
  PINCODE: 6, ITEMS: 7, STATUS: 8, POC: 9
};

// Only these POC codes may log in.
const ALLOWED_POC = ['J', 'JJ', 'BT', 'PT', 'IA', 'JP'];

// Maximum orders allowed per phone number.
const MAX_ORDERS_PER_PHONE = 3;







function setupOrders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

  if (sheet) {
    const existing = sheet.getDataRange().getValues();
    const headerOk = existing.length > 0 &&
      String(existing[0][COL.STATUS - 1]) === 'Status';
    if (headerOk) return sheet;
    if (existing.length > 1) return sheet;
    ss.deleteSheet(sheet);
  }

  sheet = ss.insertSheet(ORDERS_SHEET_NAME);
  sheet.appendRow(HEADER);
  sheet.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  return sheet;
}

function getOrdersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet;
  try {
    sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  } catch (err) {
    sheet = null;
  }
  if (!sheet || sheet.isSheetHidden === true) {
    sheet = setupOrders();
  }
  return sheet;
}

function parseItems_(raw) {
  if (!raw) return [];
  const list = raw instanceof Array ? raw : [raw];
  return list.map(function (entry) {
    const str = String(entry).trim();
    const m = str.match(/^(.*?)\s*x(\d+)$/i);
    if (m) return { name: m[1].trim(), qty: parseInt(m[2], 10) };
    return { name: str, qty: 1 };
  }).filter(function (i) { return i.name; });
}

function countOrdersByPhone_(phone) {
  if (!phone) return 0;
  const sheet = getOrdersSheet();
  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.PHONE - 1]) === phone) count++;
  }
  return count;
}

function doPost(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};

    // Mark-complete requests from the POC client (the standalone /
    // file:// page POSTs here directly because google.script.run is
    // unavailable outside the Apps Script web app). Route them to
    // markCompleted instead of treating them as a new order — otherwise
    // every "Mark Complete" click silently inserts a duplicate row.
    if (params.action === 'complete') {
      const ok = markCompleted(params.orderId, params.initials);
      return ContentService.createTextOutput(JSON.stringify({
        ok: ok, orderId: params.orderId
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const items = parseItems_(params['items[]'] || params.items);
    const phone = (params.phone || '').trim();

    if (phone && countOrdersByPhone_(phone) >= MAX_ORDERS_PER_PHONE) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: 'Maximum ' + MAX_ORDERS_PER_PHONE + ' orders per phone number.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getOrdersSheet();
    const orderId = 'M' + Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 1000).toString(36).toUpperCase();

    sheet.appendRow([
      new Date(),
      orderId,
      (params.name || '').trim(),
      (params.phone || '').trim(),
      (params.address || '').trim(),
      (params.pincode || '').trim(),
      items.map(function (i) { return i.name + ' x' + i.qty; }).join(', '),
      'Pending',
      ''
    ]);

    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, orderId: orderId })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function markCompleted(orderId, initials) {
  const sheet = getOrdersSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.ORDER_ID - 1]).toUpperCase() ===
        String(orderId).toUpperCase()) {
      sheet.getRange(i + 1, COL.STATUS).setValue('Completed');
      sheet.getRange(i + 1, COL.POC).setValue((initials || '').trim());
      return true;
    }
  }
  return false;
}

function getOrders() {
  const sheet = getOrdersSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1).map(function (row) {
    return {
      timestamp: row[COL.TIMESTAMP - 1],
      orderId: row[COL.ORDER_ID - 1],
      name: row[COL.NAME - 1],
      phone: row[COL.PHONE - 1],
      address: row[COL.ADDRESS - 1],
      pincode: row[COL.PINCODE - 1],
      items: row[COL.ITEMS - 1],
      status: row[COL.STATUS - 1],
      pocInitials: row[COL.POC - 1]
    };
  });
}

function pocLogin_(initials) {
  const code = String(initials || '').trim().toUpperCase();
  if (ALLOWED_POC.indexOf(code) === -1) return null;
  return code;
}

function serveHtml_(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'login') return serveHtml_('poc_login.html');

  // Standalone POC page marks orders complete via GET query params
  // (fetch with mode:no-cors falls back to a plain GET).
  if (action === 'complete') {
    const ok = markCompleted(e.parameter.orderId, e.parameter.initials);
    return ContentService.createTextOutput(JSON.stringify({
      ok: ok, orderId: e.parameter.orderId
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const initials = e && e.parameter && e.parameter.initials;
  if (pocLogin_(initials)) return serveHtml_('poc.html');
  return serveHtml_('poc_login.html');
}

// Exposed to the POC client via google.script.run.
function markCompletedPublic(orderId, initials) { return markCompleted(orderId, initials); }
function getOrdersPublic() { return getOrders(); }

/**
 * Diagnostic: returns raw sheet info so the POC page can show why orders
 * are not appearing. Safe to call from the editor.
 */
function debugOrders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) return { error: 'No sheet named ' + ORDERS_SHEET_NAME, sheets: ss.getSheets().map(function (s) { return s.getName(); }) };
  const data = sheet.getDataRange().getValues();
  return {
    sheetName: sheet.getName(),
    rowCount: data.length,
    header: data[0] || [],
    firstRows: data.slice(1, 4)
  };
}