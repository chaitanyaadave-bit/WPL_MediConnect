const express = require("express");
const { Specialty, Doctor, Medicine, Package } = require("../models");
const { str } = require("../middleware/errors");

const router = express.Router();

router.get("/specialties", async (req, res) => {
  res.json(await Specialty.find().sort({ createdAt: 1, _id: 1 }));
});

router.get("/doctors", async (req, res) => {
  const filter = {};
  const specialty = str(req.query.specialty, 60);
  if (specialty) filter.specialtyId = specialty;
  res.json(await Doctor.find(filter).sort({ _id: 1 }));
});

router.get("/medicines", async (req, res) => {
  res.json(await Medicine.find().sort({ _id: 1 }));
});

router.get("/packages", async (req, res) => {
  res.json(await Package.find().sort({ _id: 1 }));
});

module.exports = router;
