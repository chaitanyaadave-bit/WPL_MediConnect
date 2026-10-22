const jwt = require("jsonwebtoken");
const config = require("../config");
const { User } = require("../models");

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  };
}

function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user._id), memberId: user.memberId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn
  });
  res.cookie(config.cookieName, token, cookieOptions());
}

function clearSession(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(config.cookieName, opts);
}

async function loadUser(req) {
  const header = req.get("authorization");
  const token = (req.cookies && req.cookies[config.cookieName]) ||
    (header && header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return await User.findById(payload.sub);
  } catch {
    return null;
  }
}

// Attaches req.user when logged in; never rejects.
async function optionalAuth(req, res, next) {
  req.user = await loadUser(req);
  next();
}

async function requireAuth(req, res, next) {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ error: "Please log in to continue." });
  req.user = user;
  next();
}

module.exports = { issueSession, clearSession, optionalAuth, requireAuth };
