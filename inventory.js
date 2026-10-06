/* Shared live-inventory loader.
 * Fetches the Inventory + Products tabs from the Maatti Google Sheet via the
 * gviz/tq JSON API and exposes a single callback for consumers to render.
 * Re-fetches every 60 seconds so stock counts stay current.
 */
(function (window) {
  'use strict';

  const SHEET_ID = '1jAnvqv6uq0UTiRmFw2shcEcWNLOGEeN6kFFMSj13J1k';
  const INVENTORY_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '/gviz/tq?tqx=out:json&sheet=Inventory';
  const PRODUCTS_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '/gviz/tq?tqx=out:json&sheet=Products';
  const REFRESH_MS = 60000;

  let inventory = [];
  let lastUpdated = null;
  let refreshTimer = null;
  let productsData = null;
  let inventoryData = null;
  let productsLoaded = false;

  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    return Number(String(value).replace(/,/g, '')) || 0;
  }

  function formatPrice(value) {
    const n = Number(value);
    const formatted = n.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return '₹' + formatted.replace(/\.00$/, '');
  }

  function formatWeight(w) {
    if (!w) return '';
    return String(w).replace(/\s+/g, ' ').trim();
  }

  function loadProducts() {
    const oldScript = document.getElementById('productsLoader');
    if (oldScript) oldScript.remove();
    const script = document.createElement('script');
    script.id = 'productsLoader';
    script.src = PRODUCTS_URL + '&t=' + Date.now();
    document.body.appendChild(script);
  }

  function loadInventory() {
    const oldScript = document.getElementById('inventoryLoader');
    if (oldScript) oldScript.remove();
    const script = document.createElement('script');
    script.id = 'inventoryLoader';
    script.src = INVENTORY_URL + '&t=' + Date.now();
    document.body.appendChild(script);
  }

  function loadBoth() {
    productsData = null;
    inventoryData = null;
    productsLoaded = false;
    const oldProducts = document.getElementById('productsLoader');
    const oldInventory = document.getElementById('inventoryLoader');
    if (oldProducts) oldProducts.remove();
    if (oldInventory) oldInventory.remove();
    loadProducts();
  }

  function handleBoth() {
    try {
      const invTable = inventoryData.table;
      const invRows = invTable.rows;
      const productsRows = productsData.table.rows;

      // Weight lookup from Products sheet (col 0 = name, col 4 = weight)
      const weightMap = {};
      for (let i = 0; i < productsRows.length; i++) {
        const cells = productsRows[i].c;
        const name = cells[0] && cells[0].v ? String(cells[0].v).trim() : '';
        const weight = cells[4] && cells[4].v != null ? String(cells[4].v) : '';
        if (name) weightMap[name] = weight;
      }

      const priceRow = invRows[0] ? invRows[0].c : [];
      const stockRow = invRows[4] ? invRows[4].c : [];

      inventory = [];
      for (let i = 3; i < invTable.cols.length; i++) {
        const label = invTable.cols[i] && invTable.cols[i].label
          ? String(invTable.cols[i].label) : '';
        const name = label.replace(/^Product\s*/, '').trim();
        if (!name) continue;

        const price = priceRow[i] ? parseNumber(priceRow[i].v) : 0;
        const stock = stockRow[i] ? parseNumber(stockRow[i].v) : 0;
        const weight = weightMap[name] || '';
        inventory.push({ name, price, weight, stock });
      }

      lastUpdated = new Date();
      if (typeof window.onInventoryReady === 'function') {
        window.onInventoryReady(inventory, lastUpdated);
      }
    } catch (err) {
      if (typeof window.onInventoryError === 'function') {
        window.onInventoryError(err);
      }
    }
  }

  function start() {
    loadBoth();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadBoth, REFRESH_MS);
  }

  // gviz callback — the JSONP response lands here.
  window.google = window.google || {};
  window.google.visualization = window.google.visualization || {};
  window.google.visualization.Query = window.google.visualization.Query || {};
  window.google.visualization.Query.setResponse = function (response) {
    if (!productsLoaded) {
      productsData = response;
      productsLoaded = true;
      loadInventory();
    } else {
      inventoryData = response;
      handleBoth();
    }
  };

  window.maattiInventory = {
    getInventory: function () { return inventory; },
    getLastUpdated: function () { return lastUpdated; },
    refresh: loadBoth,
    start: start,
    formatPrice: formatPrice
  };
})(window);