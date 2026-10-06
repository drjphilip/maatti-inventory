/* Order form logic: builds a live product picker from the inventory and
 * submits the order to the Maatti Google Sheet via Apps Script. */
(function () {
  'use strict';

  // Apps Script web app URL — edit this to point at your own deployment.
  const ORDER_URL = 'https://script.google.com/macros/s/AKfycbxNLXyjq2DW8XikDsZF9CehLrpqxa9uup8U-f-DNX9db02b-hi7nXmFGu4fLTg1k_PdtA/exec';

  const LIST = document.getElementById('inventoryList');
  const FORM = document.getElementById('orderForm');
  const STATUS = document.getElementById('status');
  const SUBMIT = document.getElementById('submitBtn');
  const ITEM_COUNT = document.getElementById('itemCount');
  const TOTAL = document.getElementById('totalPrice');

  const selected = {}; // name -> qty

  function fmtPrice(n) {
    return maattiInventory.formatPrice(n);
  }

  function setStatus(msg, kind) {
    STATUS.hidden = !msg;
    STATUS.className = 'status' + (kind ? ' ' + kind : '');
    STATUS.textContent = msg || '';
  }

  function renderList(items) {
    LIST.innerHTML = '';
    if (!items.length) {
      LIST.innerHTML = '<div class="empty">No products available right now.</div>';
      updateSummary();
      return;
    }

    // Only show products with stock; out-of-stock ones are skipped.
    const available = items.filter(function (i) { return i.stock > 0; });

    available.forEach(function (item) {
      if (!(item.name in selected)) selected[item.name] = 0;

      const row = document.createElement('div');
      row.className = 'inventory-row';
      row.dataset.name = item.name;

      const name = document.createElement('div');
      name.className = 'name';
      const prod = document.createElement('div');
      prod.className = 'prod';
      prod.textContent = item.name;
      name.appendChild(prod);
      if (item.weight) {
        const w = document.createElement('span');
        w.className = 'weight';
        w.textContent = '· ' + item.weight;
        name.appendChild(w);
      }

      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = fmtPrice(item.price);

      const qty = document.createElement('div');
      qty.className = 'qty';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.addEventListener('click', function () { changeQty(item, -1); });
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = '0';
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.addEventListener('click', function () { changeQty(item, +1); });

      qty.appendChild(minus);
      qty.appendChild(num);
      qty.appendChild(plus);

      row.appendChild(name);
      row.appendChild(price);
      row.appendChild(qty);
      LIST.appendChild(row);
    });

    updateSummary();
  }

  function changeQty(item, delta) {
    const cur = selected[item.name] || 0;
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > item.stock) next = item.stock;
    selected[item.name] = next;

    const row = LIST.querySelector('.inventory-row[data-name="' + CSS.escape(item.name) + '"]');
    if (row) row.querySelector('.num').textContent = next;
    updateSummary();
  }

  function updateSummary() {
    let count = 0, total = 0;
    Object.keys(selected).forEach(function (name) {
      const q = selected[name] || 0;
      if (q > 0) {
        count += q;
        const item = maattiInventory.getInventory().find(function (i) { return i.name === name; });
        if (item) total += item.price * q;
      }
    });
    ITEM_COUNT.textContent = count;
    TOTAL.textContent = fmtPrice(total);
    SUBMIT.disabled = count === 0;
  }

  function buildOrder() {
    const items = [];
    Object.keys(selected).forEach(function (name) {
      const q = selected[name] || 0;
      if (q > 0) items.push({ name: name, qty: q });
    });
    return {
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      address: document.getElementById('address').value.trim(),
      pincode: document.getElementById('pincode').value.trim(),
      items: items
    };
  }

  FORM.addEventListener('submit', function (e) {
    e.preventDefault();
    const order = buildOrder();
    if (!order.name || !order.phone || !order.address || !order.pincode) {
      setStatus('Please fill in all the details.', 'error');
      return;
    }
    if (!order.items.length) {
      setStatus('Please pick at least one product.', 'error');
      return;
    }
    if (!/^\d{10}$/.test(order.phone.replace(/[\s\-\(\)]/g, ''))) {
      setStatus('Please enter a valid 10-digit phone number.', 'error');
      return;
    }
    if (!/^\d{6}$/.test(order.pincode)) {
      setStatus('Please enter a valid 6-digit pin code.', 'error');
      return;
    }

    SUBMIT.disabled = true;
    setStatus('Placing your order…');

    const body = new FormData();
    body.append('name', order.name);
    body.append('phone', order.phone);
    body.append('address', order.address);
    body.append('pincode', order.pincode);
    order.items.forEach(function (it) {
      body.append('items[]', it.name + ' x' + it.qty);
    });

    if (ORDER_URL.indexOf('YOUR_DEPLOYMENT_ID') !== -1) {
      setStatus('Order link not configured yet — see order.js ORDER_URL.', 'error');
      SUBMIT.disabled = false;
      return;
    }

    fetch(ORDER_URL, { method: 'POST', body: body })
      .then(function (r) { return r.text().then(function (text) { return { status: r.status, text: text }; }); })
      .then(function (res) {
        let ok = false, orderId = '';
        try {
          const parsed = JSON.parse(res.text);
          ok = parsed.ok === true;
          orderId = parsed.orderId || '';
        } catch (e) { ok = false; }
        if (!ok) {
          const hint = res.status && res.status !== 200
            ? ' (server returned HTTP ' + res.status + ')'
            : '';
          setStatus('Server did not confirm the order. Please try again.' + hint, 'error');
          SUBMIT.disabled = false;
          return;
        }
        showConfirm(orderId, order);
        FORM.reset();
        Object.keys(selected).forEach(function (k) { selected[k] = 0; });
        renderList(maattiInventory.getInventory());
      })
      .catch(function () {
        setStatus('Could not place the order. Please try again.', 'error');
        SUBMIT.disabled = false;
      });
  });

  window.onInventoryReady = function (items) {
    renderList(items);
  };

  window.onInventoryError = function () {
    LIST.innerHTML = '<div class="empty">Could not load live inventory. Please refresh.</div>';
  };

  function showConfirm(orderId, order) {
    const modal = document.getElementById('confirmModal');
    const close = document.getElementById('confirmClose');
    const done = document.getElementById('confirmDone');

    document.getElementById('confirmId').textContent = orderId || '—';
    document.getElementById('confirmName').textContent = order.name;
    document.getElementById('confirmPhone').textContent = order.phone;
    document.getElementById('confirmAddress').textContent = order.address;
    document.getElementById('confirmPin').textContent = order.pincode;

    const itemsBox = document.getElementById('confirmItems');
    itemsBox.innerHTML = '';
    let total = 0;
    order.items.forEach(function (it) {
      const item = maattiInventory.getInventory().find(function (i) { return i.name === it.name; });
      const price = item ? item.price : 0;
      total += price * it.qty;
      const row = document.createElement('div');
      row.className = 'modal-item';
      row.innerHTML = '<span>' + it.name + ' x' + it.qty + '</span><span>' +
        maattiInventory.formatPrice(price * it.qty) + '</span>';
      itemsBox.appendChild(row);
    });
    document.getElementById('confirmTotal').textContent = maattiInventory.formatPrice(total);

    modal.hidden = false;
    function closeModal() { modal.hidden = true; }
    close.onclick = closeModal;
    done.onclick = closeModal;
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  }

  maattiInventory.start();
})();