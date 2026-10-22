const crypto = require("crypto");
const express = require("express");
const { Medicine, Package, Order, CheckupBooking, Report, Bill } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { HttpError, str } = require("../middleware/errors");

const router = express.Router();
const code = prefix => prefix + crypto.randomInt(100000, 1000000);
const isoDate = d => new Date(d).toISOString().slice(0, 10);

/* Every purchase is paid up-front in the payment modal, so it is recorded as a Paid bill.
   refId (the order / booking id) makes this idempotent: the same purchase never gets two bills. */
async function createPaidBill({ memberId, refId, description, amount, at = new Date() }) {
  const existing = await Bill.findOne({ refId });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await Bill.create({
        memberId, refId, description, amount,
        billId: code("BL"),
        status: "Paid", date: isoDate(at), paidAt: at
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
      const dup = await Bill.findOne({ refId });   // lost a race for the same purchase
      if (dup) return dup;                           // otherwise billId collided: retry
    }
  }
  throw new HttpError(500, "Could not record the bill. Please try again.");
}

const orderDescription = o => "Medicine order " + o.orderId + " (" +
  o.items.reduce((n, i) => n + i.qty, 0) + " item" + (o.items.reduce((n, i) => n + i.qty, 0) === 1 ? "" : "s") + ")";
const checkupDescription = b => "Health checkup — " + b.packageName;

/* Bills for purchases made before bills were recorded automatically. */
async function backfillBills(memberId) {
  const [orders, bookings] = await Promise.all([
    Order.find({ memberId, status: { $ne: "Cancelled" } }),
    CheckupBooking.find({ memberId, status: { $ne: "Cancelled" } })
  ]);
  const refs = [...orders.map(o => o.orderId), ...bookings.map(b => b.bookingId)];
  if (refs.length === 0) return;
  const have = new Set((await Bill.find({ refId: { $in: refs } }).select("refId")).map(b => b.refId));
  for (const o of orders) if (!have.has(o.orderId))
    await createPaidBill({ memberId, refId: o.orderId, description: orderDescription(o), amount: o.total, at: o.createdAt });
  for (const b of bookings) if (!have.has(b.bookingId))
    await createPaidBill({ memberId, refId: b.bookingId, description: checkupDescription(b), amount: b.price, at: b.createdAt });
}

/* Buy medicine. Prices are always taken from the database, never from the client. */
router.post("/orders", requireAuth, async (req, res) => {
  const raw = Array.isArray(req.body.items) ? req.body.items : [];
  if (raw.length === 0 || raw.length > 50) throw new HttpError(400, "Your cart is empty.");

  const qtyById = new Map();
  for (const it of raw) {
    const id = str(it && it.id, 20);
    const qty = Number(it && it.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, "Invalid item quantity.");
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }
  const meds = await Medicine.find({ _id: { $in: [...qtyById.keys()] } });
  if (meds.length !== qtyById.size) throw new HttpError(400, "One or more medicines are no longer available.");

  const items = meds.map(m => ({
    medicineId: m._id, name: m.name, unitPrice: m.price, qty: Math.min(qtyById.get(m._id), 20), rx: m.rx
  }));
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

  const order = await Order.create({
    orderId: code("ORD"),
    memberId: req.user.memberId,
    items, total,
    needsPrescriptionCheck: items.some(i => i.rx)
  });
  try {
    await createPaidBill({ memberId: order.memberId, refId: order.orderId, description: orderDescription(order), amount: order.total });
  } catch (e) {
    await Order.deleteOne({ _id: order._id });  // don't keep a paid order that has no bill
    throw e;
  }
  res.status(201).json(order);
});

router.get("/orders/mine", requireAuth, async (req, res) => {
  res.json(await Order.find({ memberId: req.user.memberId }).sort({ createdAt: -1 }));
});

/* Health checkup packages */
router.post("/checkups", requireAuth, async (req, res) => {
  const pkg = await Package.findById(str(req.body.packageId, 20));
  if (!pkg) throw new HttpError(404, "That package could not be found.");
  const booking = await CheckupBooking.create({
    bookingId: code("CKP"),
    memberId: req.user.memberId,
    packageId: pkg._id, packageName: pkg.name, price: pkg.price
  });
  try {
    await createPaidBill({ memberId: booking.memberId, refId: booking.bookingId, description: checkupDescription(booking), amount: booking.price });
  } catch (e) {
    await CheckupBooking.deleteOne({ _id: booking._id });
    throw e;
  }
  res.status(201).json(booking);
});

/* Reports: only the owner can look a report up. Wrong ID and someone else's ID look identical. */
router.get("/reports/lookup", requireAuth, async (req, res) => {
  const memberId = str(req.query.memberId, 20).toUpperCase();
  const reportId = str(req.query.reportId, 20).toUpperCase();
  const report = memberId === req.user.memberId
    ? await Report.findOne({ memberId, reportId })
    : null;
  if (!report) throw new HttpError(404, "No report found for that Member ID and Report ID combination. Double-check both fields and try again.");
  res.json(report);
});

/* Bills */
router.get("/bills", requireAuth, async (req, res) => {
  const memberId = (str(req.query.memberId, 20) || req.user.memberId).toUpperCase();
  if (memberId === req.user.memberId) await backfillBills(memberId);
  const bills = memberId === req.user.memberId
    ? await Bill.find({ memberId }).sort({ date: -1, billId: 1 })
    : [];
  if (bills.length === 0) throw new HttpError(404, `No bills found for Member ID "${memberId}".`);
  res.json(bills);
});

// Simulated payment: there's no payment gateway behind this - it just records the bill as paid.
router.post("/bills/:billId/pay", requireAuth, async (req, res) => {
  const bill = await Bill.findOneAndUpdate(
    { billId: str(req.params.billId, 20).toUpperCase(), memberId: req.user.memberId, status: "Unpaid" },
    { $set: { status: "Paid", paidAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!bill) throw new HttpError(404, "That bill was not found or has already been paid.");
  res.json(bill);
});

module.exports = router;
