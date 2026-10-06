/* POC dashboard client: lists orders, shows details, marks complete. */
(function () {
  'use strict';

  // gviz JSONP always lands in google.visualization.Query.setResponse, so
  // make sure that namespace exists before loadOrders() hooks it.
  window.google = window.google || {};
  window.google.visualization = window.google.visualization || {};
  window.google.visualization.Query = window.google.visualization.Query || {};

  const SHEET_ID = '1jAnvqv6uq0UTiRmFw2shcEcWNLOGEeN6kFFMSj13J1k';
  const GVIZ_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&sheet=Orders';
  const ORDER_URL = 'https://script.google.com/macros/s/AKfycbxNLXyjq2DW8XikDsZF9CehLrpqxa9uup8U-f-DNX9db02b-hi7nXmFGu4fLTg1k_PdtA/exec';

  const BODY = document.getElementById('ordersBody');
  const EMPTY = document.getElementById('emptyState');
  const COUNT = document.getElementById('count');
  const TAG = document.getElementById('initialsTag');
  const FILTER = document.getElementById('filter');
  const LOADING = document.getElementById('loadingState');

  let orders = [];
  let currentFilter = 'all';
  let initials = '';

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function badge(status) {
    const s = (status || 'pending').toLowerCase();
    return '<span class="badge ' + s + '">' + (status || 'Pending') + '</span>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderItems(raw) {
    if (!raw || !raw.trim()) return '<span style="color:var(--ink-soft);font-style:italic;">No products</span>';
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    return parts.map(it => {
      const match = it.match(/^(.*?)\s*[xX×](\d+)$/);
      if (match) {
        return '<span class="item-chip">' + escapeHtml(match[1].trim()) +
               ' <b style="color:var(--accent);">&times;' + match[2] + '</b></span>';
      }
      return '<span class="item-chip">' + escapeHtml(it) + '</span>';
    }).join(' ');
  }

  function render() {
    // Default to Pending on load so completed orders don't bury the
    // ones that still need action.
    if (currentFilter === 'all') currentFilter = 'pending';

    const filtered = orders.filter(function (o) {
      return (o.status || '').toLowerCase() === currentFilter;
    });

    COUNT.textContent = filtered.length + ' order' + (filtered.length === 1 ? '' : 's');

    if (!filtered.length) {
      BODY.innerHTML = '';
      EMPTY.hidden = false;
      EMPTY.textContent = orders.length
        ? 'No orders match this filter.'
        : 'No orders have been placed yet.';
      return;
    }
    EMPTY.hidden = true;

    BODY.innerHTML = '';
    filtered.forEach(function (o) {
      const tr = document.createElement('tr');
      tr.dataset.orderId = o.orderId;

      const idTd = document.createElement('td');
      idTd.className = 'order-id';
      idTd.innerHTML = '<div>' + escapeHtml(o.orderId) + '</div>' +
        (o.timestamp ? '<div style="font-size:11px;color:var(--ink-soft);">' + escapeHtml(o.timestamp) + '</div>' : '');

      const custTd = document.createElement('td');
      const nameDiv = document.createElement('div');
      nameDiv.style.fontWeight = '600';
      nameDiv.textContent = o.name || 'Anonymous';
      const metaDiv = document.createElement('div');
      metaDiv.style.cssText = 'font-size:12px;color:var(--ink-soft);';
      metaDiv.innerHTML = (o.phone ? '<a href="tel:' + escapeHtml(o.phone) + '" style="color:inherit;text-decoration:none;">📞 ' + escapeHtml(o.phone) + '</a>' : '') +
        (o.pincode ? ' &middot; ' + escapeHtml(o.pincode) : '');
      custTd.appendChild(nameDiv);
      custTd.appendChild(metaDiv);

      const itemsTd = document.createElement('td');
      itemsTd.innerHTML = renderItems(o.items);

      const actionTd = document.createElement('td');
      if ((o.status || '').toLowerCase() === 'completed') {
        const done = document.createElement('span');
        done.className = 'poc-tag';
        done.textContent = '✓ Done · ' + (o.pocInitials || '');
        actionTd.appendChild(done);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn complete';
        btn.textContent = 'Mark Complete';
        btn.addEventListener('click', function () { markComplete(o.orderId, btn); });
        actionTd.appendChild(btn);
      }

      tr.appendChild(idTd);
      tr.appendChild(custTd);
      tr.appendChild(itemsTd);
      tr.appendChild(actionTd);
      BODY.appendChild(tr);
    });
  }

  function markComplete(orderId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // If running in Google Apps Script
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run
        .withSuccessHandler(function () { loadOrders(); })
        .withFailureHandler(function (err) {
          if (btn) { btn.disabled = false; btn.textContent = 'Mark Complete'; }
          setStatus('Could not update. ' + (err && err.message ? err.message : 'Please try again.'));
        })
        .markCompletedPublic(orderId, initials || 'POS');
      return;
    }

    // Direct HTTP request to Apps Script Web App.
    // NOTE: Apps Script's e.parameter only parses URL query params, NOT
    // POST bodies — so action/orderId/initials must go in the URL,
    // otherwise the request silently becomes a new (duplicate) order.
    const qs = '?action=complete&orderId=' + encodeURIComponent(orderId) +
      '&initials=' + encodeURIComponent(initials || 'POS');

    fetch(ORDER_URL + qs, { method: 'POST' })
      .then(() => {
        const target = orders.find(x => x.orderId === orderId);
        if (target) { target.status = 'Completed'; target.pocInitials = initials || 'POS'; render(); }
        setTimeout(loadOrders, 1000);
      })
      .catch(() => {
        fetch(ORDER_URL + qs, { mode: 'no-cors' })
          .then(() => {
            const target = orders.find(x => x.orderId === orderId);
            if (target) { target.status = 'Completed'; target.pocInitials = initials || 'POS'; render(); }
            setTimeout(loadOrders, 1500);
          })
          .catch(() => {
            if (btn) { btn.disabled = false; btn.textContent = 'Mark Complete'; }
            setStatus('Could not update order.');
          });
      });
  }

  function setStatus(msg) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  function loadOrders() {
    if (LOADING) LOADING.hidden = false;
    EMPTY.hidden = true;

    // Direct Google Sheets gviz fetch.
    // Google's gviz API ignores the `callback`/`responseHandler` query
    // params and always wraps its payload in
    //   google.visualization.Query.setResponse(...)
    // so we hook that global function instead. Restoring it after each
    // call keeps concurrent refreshes from clobbering each other.
    const original = google.visualization.Query.setResponse;
    google.visualization.Query.setResponse = function (data) {
      google.visualization.Query.setResponse = original;
      if (script && script.parentNode) script.remove();
      if (LOADING) LOADING.hidden = true;

      try {
        const rows = data.table && data.table.rows ? data.table.rows : [];
        orders = [];
        rows.forEach(r => {
          const c = r.c || [];
          const id = c[1] ? String(c[1].v || '') : '';
          if (!id || id === 'Order ID') return;
          orders.push({
            timestamp: c[0] ? (c[0].f || c[0].v || '') : '',
            orderId: id,
            name: c[2] ? String(c[2].v || '') : '',
            phone: c[3] ? (c[3].f || String(c[3].v || '')) : '',
            address: c[4] ? String(c[4].v || '') : '',
            pincode: c[5] ? (c[5].f || String(c[5].v || '')) : '',
            items: c[6] ? String(c[6].v || '') : '',
            status: c[7] ? String(c[7].v || 'Pending') : 'Pending',
            pocInitials: c[8] ? String(c[8].v || '') : ''
          });
        });
        orders.reverse();
        render();
      } catch (e) {
        EMPTY.hidden = false;
        EMPTY.textContent = 'Error parsing orders: ' + e.message;
      }
    };

    const script = document.createElement('script');
    script.src = GVIZ_URL + '&t=' + Date.now();
    script.onerror = function () {
      if (LOADING) LOADING.hidden = true;
      // Fallback: If inside Google Apps Script, try google.script.run
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
          .withSuccessHandler(function (d) { orders = d || []; render(); })
          .withFailureHandler(function (err) {
            EMPTY.hidden = false;
            EMPTY.textContent = 'Could not load orders.';
          })
          .getOrdersPublic();
      } else {
        EMPTY.hidden = false;
        EMPTY.textContent = 'Could not load orders from Google Sheets. Please refresh.';
      }
    };
    document.body.appendChild(script);
  }

  FILTER.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    Array.prototype.forEach.call(FILTER.children, function (c) {
      c.classList.toggle('active', c === btn);
    });
    render();
  });

  function init() {
    const params = new URLSearchParams(location.search);
    initials = (params.get('initials') || '').slice(0, 3).toUpperCase();
    if (TAG) TAG.textContent = initials || '—';
    loadOrders();
    setInterval(loadOrders, 30000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();