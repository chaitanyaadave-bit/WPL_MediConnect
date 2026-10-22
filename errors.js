const mongoose = require("mongoose");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Only accept real strings from the client (blocks {"$ne": ...} style NoSQL operator injection).
function str(v, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function notFound(req, res) {
  res.status(404).json({ error: "Not found." });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof mongoose.Error.ValidationError) {
    const first = Object.values(err.errors)[0];
    return res.status(400).json({ error: first ? first.message : "Invalid data." });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: "Invalid value." });
  if (err && err.code === 11000) return res.status(409).json({ error: "That record already exists." });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}

module.exports = { HttpError, str, notFound, errorHandler };
