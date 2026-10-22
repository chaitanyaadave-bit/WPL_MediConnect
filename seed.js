/* Loads the reference data + demo accounts into MongoDB.
 *   npm run seed          -> wipes the Mediconnect collections and reseeds
 * Also exported so the server can seed an empty database on first start. */
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const data = require("./seedData.json");
const M = require("./models");

async function seed({ wipe = true } = {}) {
  if (wipe) {
    await Promise.all([
      M.Specialty, M.Doctor, M.Medicine, M.Package, M.User, M.Report, M.Bill,
      M.Appointment, M.Order, M.CheckupBooking, M.Counter
    ].map(model => model.deleteMany({})));
  }

  await M.Specialty.insertMany(data.specialties);
  await M.Doctor.insertMany(data.doctors);
  await M.Medicine.insertMany(data.medicines);
  await M.Package.insertMany(data.packages);

  const users = [];
  for (const a of data.accounts) {
    const { password, ...rest } = a;
    users.push({ ...rest, passwordHash: await bcrypt.hash(password, 10) });
  }
  await M.User.insertMany(users);
  await M.Report.insertMany(data.reports);
  await M.Bill.insertMany(data.bills);
  await M.ensureCounters();
}

/* Runs on every start. Safe for databases that already hold real data:
 *  - inserts any catalogue document that is missing
 *  - fills in the image field (photo for doctors) ONLY where it is empty
 * It never overwrites other fields, so edits made in Compass are kept, and it
 * never touches users, appointments, orders, bills or reports. */
const IMAGE_FIELDS = [
  [M.Specialty, "specialties", "image"],
  [M.Doctor, "doctors", "photo"],
  [M.Medicine, "medicines", "image"],
  [M.Package, "packages", "image"]
];

async function syncReferenceData() {
  let filled = 0;
  for (const [Model, key, field] of IMAGE_FIELDS) {
    const ops = [];
    for (const doc of data[key]) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } });
      if (doc[field]) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id, $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }] },
            update: { $set: { [field]: doc[field] } }
          }
        });
      }
    }
    const res = await Model.bulkWrite(ops, { timestamps: false }); // don't bump updatedAt on every start
    filled += (res.modifiedCount || 0);
  }
}

async function seedIfEmpty() {
  // exists() is exact; estimatedDocumentCount() can be stale after an unclean mongod shutdown.
  if (!(await M.Specialty.exists({}))) {
    await seed({ wipe: false });
    console.log("Seeded empty database with demo data.");
  } else {
    await syncReferenceData();
  }
  await M.ensureCounters();
}

module.exports = { seed, seedIfEmpty, syncReferenceData };

if (require.main === module) {
  const { connectDb } = require("./db");
  connectDb()
    .then(() => seed())
    .then(() => { console.log("Database seeded."); return mongoose.disconnect(); })
    .catch(err => { console.error("Seed failed:", err.message); process.exit(1); });
}
