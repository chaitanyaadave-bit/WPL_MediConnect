const crypto = require("crypto");
const express = require("express");
const { Doctor, Appointment } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { HttpError, str } = require("../middleware/errors");

const router = express.Router();

const SLOTS = [
  "09:00 AM – 09:30 AM", "10:00 AM – 10:30 AM", "11:30 AM – 12:00 PM",
  "02:00 PM – 02:30 PM", "04:00 PM – 04:30 PM", "05:30 PM – 06:00 PM"
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Please choose a valid date.");
  const d = new Date(date + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, "Please choose a valid date.");
  }
  // One day of slack so users ahead of UTC (e.g. India) can still book "today".
  const earliest = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date < earliest) throw new HttpError(400, "Appointments can't be booked in the past.");
  return DAY_NAMES[d.getUTCDay()];
}

router.post("/", requireAuth, async (req, res) => {
  const doctorId = str(req.body.doctorId, 20);
  const date = str(req.body.date, 10);
  const time = str(req.body.time, 40);
  const reason = str(req.body.reason, 1000);

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) throw new HttpError(404, "That doctor could not be found.");
  const dayName = validateDate(date);
  if (!doctor.days.includes(dayName)) {
    throw new HttpError(400, `${doctor.name} isn't available on ${DAY_FULL[dayName]}s. Available: ${doctor.days.join(", ")}.`);
  }
  if (!SLOTS.includes(time)) throw new HttpError(400, "Please choose a valid time slot.");
  if (!reason) throw new HttpError(400, "Please tell us the reason for your visit.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = "APT" + crypto.randomInt(100000, 1000000);
    try {
      const appt = await Appointment.create({
        ref, memberId: req.user.memberId, doctorId, date, time, reason
      });
      return res.status(201).json(appt);
    } catch (err) {
      if (err.code !== 11000) throw err;
      if (err.keyPattern && err.keyPattern.ref) continue; // ref collision: try another
      throw new HttpError(409, "That time slot is already booked. Please pick another slot or date.");
    }
  }
  throw new HttpError(500, "Could not generate a booking reference. Please try again.");
});

router.get("/mine", requireAuth, async (req, res) => {
  res.json(await Appointment.find({ memberId: req.user.memberId }).sort({ date: -1, createdAt: -1 }));
});

module.exports = router;
