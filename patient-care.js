document.addEventListener("DOMContentLoaded", async function () {
  const paymentModalEl = document.getElementById("paymentModal");
  const paymentModal = new bootstrap.Modal(paymentModalEl);
  let pendingPayment = null; 

  /*Buy Medicine*/
  const cart = {}; 
  const medicineList = document.getElementById("medicineList");
  const cartItemsEl = document.getElementById("cartItems");
  const cartTotalEl = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("checkoutBtn");

  let medicines, packages;
  try {
    [medicines, packages] = await Promise.all([mcGetMedicines(), mcGetPackages()]);
  } catch (e) {
    mcShowLoadError(medicineList, e.message);
    mcShowLoadError(document.getElementById("checkupGrid"), e.message);
    medicines = []; packages = [];
  }
  const data = { medicines, packages };

  medicineList.innerHTML = data.medicines.map(m => `
    <div class="card shadow-sm">
      <div class="card-body d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div class="d-flex align-items-center gap-3">
          <img src="${mcEscape(m.image || `img/medicines/${m.id}.svg`)}" alt="${mcEscape(m.name)} strip" class="care-thumb" width="96" height="60" loading="lazy" onerror="this.style.display='none'">
          <div>
            <div class="d-flex align-items-center gap-2">
              <h3 class="h6 mb-0">${mcEscape(m.name)}</h3>
              ${m.rx ? '<span class="badge bg-dark">Rx</span>' : ''}
            </div>
            <p class="small text-muted mb-0">${mcEscape(m.category)} &middot; ₹${m.price} / strip</p>
          </div>
        </div>
        <button class="btn btn-outline-navy btn-sm" data-add-medicine="${m.id}">Add to cart</button>
      </div>
    </div>
  `).join("");

  function renderCart() {
    const ids = Object.keys(cart).filter(id => cart[id] > 0);
    if (ids.length === 0) {
      cartItemsEl.innerHTML = '<p class="small text-muted mb-0">Your cart is empty.</p>';
      cartTotalEl.textContent = "₹0";
      checkoutBtn.disabled = true;
      return;
    }
    let total = 0;
    cartItemsEl.innerHTML = ids.map(id => {
      const med = data.medicines.find(m => m.id === id);
      const lineTotal = med.price * cart[id];
      total += lineTotal;
      return `
        <div class="d-flex justify-content-between align-items-center border-bottom py-2">
          <div>
            <div class="small fw-semibold">${mcEscape(med.name)}</div>
            <div class="small text-muted">Qty ${cart[id]} &times; ₹${med.price}</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="small fw-semibold">₹${lineTotal}</span>
            <button class="btn btn-sm btn-outline-navy py-0 px-2" data-remove-medicine="${id}" aria-label="Remove">&minus;</button>
          </div>
        </div>`;
    }).join("");
    cartTotalEl.textContent = "₹" + total;
    checkoutBtn.disabled = false;
  }

  medicineList.querySelectorAll("[data-add-medicine]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add-medicine");
      cart[id] = (cart[id] || 0) + 1;
      renderCart();
      mcToast(data.medicines.find(m => m.id === id).name + " added to cart");
    });
  });

  cartItemsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-medicine]");
    if (!btn) return;
    const id = btn.getAttribute("data-remove-medicine");
    cart[id] = Math.max(0, (cart[id] || 0) - 1);
    renderCart();
  });

  checkoutBtn.addEventListener("click", async () => {
    if (!(await mcRequireLogin("patient-care.html"))) return;
    const ids = Object.keys(cart).filter(id => cart[id] > 0);
    const total = ids.reduce((sum, id) => sum + data.medicines.find(m => m.id === id).price * cart[id], 0);
    const rxItems = ids.filter(id => data.medicines.find(m => m.id === id).rx);

    const summaryHtml = `
      <div class="d-flex justify-content-between small mb-1"><span>Items</span><span>${ids.reduce((s, id) => s + cart[id], 0)}</span></div>
      <div class="d-flex justify-content-between fw-semibold"><span>Total</span><span>₹${total}</span></div>
      ${rxItems.length ? '<div class="small text-muted mt-2 mb-0"><i class="bi bi-info-circle me-1"></i>We\'ll confirm your prescription before dispatch.</div>' : ''}
    `;
    openPaymentModal(summaryHtml, async function () {
      // Prices are recalculated on the server; we only send ids and quantities.
      const order = await mcApi("/orders", {
        method: "POST",
        body: { items: ids.map(id => ({ id, qty: cart[id] })) }
      });
      ids.forEach(id => cart[id] = 0);
      renderCart();
      return `Order ${order.orderId} placed for ₹${order.total}. You'll get a pickup/delivery update by SMS.`;
    });
  });

  renderCart();

  /* Health checkups*/
  const checkupGrid = document.getElementById("checkupGrid");
  checkupGrid.innerHTML = data.packages.map(p => `
    <div class="col-md-6 col-lg-3">
      <div class="card h-100 shadow-sm overflow-hidden">
        <img src="${mcEscape(p.image || `img/checkups/${p.id}.svg`)}" alt="${mcEscape(p.name)}" class="w-100" loading="lazy" onerror="this.style.display='none'">
        <div class="card-body d-flex flex-column">
          <h3 class="h6">${mcEscape(p.name)}</h3>
          <p class="small text-muted flex-grow-1">${mcEscape(p.includes)}</p>
          <p class="fw-bold mb-3">₹${p.price}</p>
          <button class="btn btn-teal btn-sm w-100 mt-auto" data-book-package="${p.id}">Book this package</button>
        </div>
      </div>
    </div>
  `).join("");

  checkupGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-book-package]");
    if (!btn) return;
    if (!(await mcRequireLogin("patient-care.html"))) return;
    const pkg = data.packages.find(p => p.id === btn.getAttribute("data-book-package"));
    const summaryHtml = `
      <div class="d-flex justify-content-between small mb-1"><span>${mcEscape(pkg.name)}</span><span>₹${pkg.price}</span></div>
      <div class="small text-muted mb-0">${mcEscape(pkg.includes)}</div>
    `;
    openPaymentModal(summaryHtml, async function () {
      const booking = await mcApi("/checkups", { method: "POST", body: { packageId: pkg.id } });
      return `Checkup booking ${booking.bookingId} confirmed. Our lab team will call to schedule your sample collection.`;
    });
  });

  /* Prefill Member ID fields for logged-in patients */
  const me = await mcCurrentUser();
  if (me) {
    document.getElementById("reportMemberId").value = me.memberId;
    document.getElementById("billMemberId").value = me.memberId;
  }

  function loginNeededHtml() {
    return `
      <div class="alert alert-warning">
        <i class="bi bi-lock me-2"></i>Please <a href="login.html?redirect=patient-care.html" class="alert-link">log in</a> to view your own records.
      </div>`;
  }
  function errorHtml(message) {
    return `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-circle me-2"></i>${mcEscape(message)}
      </div>`;
  }

  /* View reports*/
  const reportForm = document.getElementById("reportSearchForm");
  const reportResult = document.getElementById("reportResult");
  reportForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const memberId = document.getElementById("reportMemberId").value.trim();
    const reportId = document.getElementById("reportId").value.trim();

    let report;
    try {
      report = await mcApi(`/reports/lookup?memberId=${encodeURIComponent(memberId)}&reportId=${encodeURIComponent(reportId)}`);
    } catch (err) {
      reportResult.innerHTML = err.status === 401 ? loginNeededHtml() : errorHtml(err.message);
      return;
    }
    reportResult.innerHTML = `
      <div class="card shadow-sm">
        <div class="card-body">
          <div class="d-flex justify-content-between flex-wrap gap-2 mb-2">
            <h3 class="h6 mb-0">${mcEscape(report.type)}</h3>
            <span class="badge bg-success">${mcEscape(report.status)}</span>
          </div>
          <p class="small text-muted mb-1"><i class="bi bi-calendar3 me-2"></i>${mcEscape(report.date)}</p>
          <p class="small text-muted mb-3"><i class="bi bi-person me-2"></i>Ordered by ${mcEscape(report.doctor)}</p>
          <p class="mb-0">${mcEscape(report.summary)}</p>
        </div>
      </div>`;
  });

  /*Bills & Payments*/
  const billForm = document.getElementById("billSearchForm");
  const billResult = document.getElementById("billResult");

  async function renderBills(memberId) {
    let bills;
    try {
      bills = await mcApi("/bills?memberId=" + encodeURIComponent(memberId));
    } catch (err) {
      billResult.innerHTML = err.status === 401 ? loginNeededHtml() : errorHtml(err.message);
      return;
    }
    billResult.innerHTML = `
      <div class="table-responsive">
        <table class="table table-striped align-middle bg-white shadow-sm">
          <thead style="background:var(--navy);color:#fff;"><tr><th>Bill ID</th><th>Description</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${bills.map(b => `
              <tr>
                <td>${mcEscape(b.billId)}</td>
                <td>${mcEscape(b.description)}</td>
                <td>${mcEscape(b.date)}</td>
                <td>₹${b.amount}</td>
                <td>${b.status === "Paid" ? '<span class="badge bg-success">Paid</span>' : '<span class="badge bg-warning text-dark">Unpaid</span>'}</td>
                <td>${b.status === "Unpaid" ? `<button class="btn btn-teal btn-sm" data-pay-bill="${mcEscape(b.billId)}">Pay now</button>` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    billResult.querySelectorAll("[data-pay-bill]").forEach(btn => {
      btn.addEventListener("click", () => {
        const bill = bills.find(b => b.billId === btn.getAttribute("data-pay-bill"));
        const summaryHtml = `
          <div class="d-flex justify-content-between small mb-1"><span>${mcEscape(bill.description)}</span><span>₹${bill.amount}</span></div>
          <div class="small text-muted mb-0">Bill ${mcEscape(bill.billId)}</div>
        `;
        openPaymentModal(summaryHtml, async function () {
          await mcApi(`/bills/${encodeURIComponent(bill.billId)}/pay`, { method: "POST", body: {} });
          renderBills(memberId);
          return `Bill ${bill.billId} marked as paid. A receipt has been sent to your registered email.`;
        });
      });
    });
  }

  billForm.addEventListener("submit", function (e) {
    e.preventDefault();
    renderBills(document.getElementById("billMemberId").value.trim());
  });

  /*Shared payment modal.
    NOTE: this is a demo flow - no real payment is taken. The server just records the result.*/
  function openPaymentModal(summaryHtml, onConfirm) {
    document.getElementById("paymentSummary").innerHTML = summaryHtml;
    document.getElementById("paymentFormWrap").classList.remove("d-none");
    document.getElementById("paymentSuccess").classList.add("d-none");
    pendingPayment = onConfirm;
    paymentModal.show();
  }

  const confirmBtn = document.getElementById("confirmPaymentBtn");
  confirmBtn.addEventListener("click", async function () {
    if (!pendingPayment) return;
    const action = pendingPayment;
    confirmBtn.disabled = true;
    try {
      const detail = await action();
      document.getElementById("paymentFormWrap").classList.add("d-none");
      document.getElementById("paymentSuccessDetail").textContent = detail;
      document.getElementById("paymentSuccess").classList.remove("d-none");
      pendingPayment = null;
    } catch (err) {
      if (err.status === 401) {
        paymentModal.hide();
        mcRequireLogin("patient-care.html");
      } else {
        mcToast(err.message, "error");
      }
    } finally {
      confirmBtn.disabled = false;
    }
  });
});
