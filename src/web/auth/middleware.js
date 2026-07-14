'use strict';

const { verifySession, COOKIE_NAME } = require('./jwt');

// Читает сессионную cookie на каждый запрос и кладёт req.user (или null).
// Не блокирует запрос — используйте requireAuth/requireRole для этого.
function attachUser(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  req.user = token ? verifySession(token) : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'Требуется вход' });
  }
  next();
}

// RBAC (ТЗ 3.4): ограничивает роут ролями из списка.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      if (req.accepts('html')) return res.redirect('/login');
      return res.status(401).json({ error: 'Требуется вход' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).send('Недостаточно прав для этого раздела');
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireRole };
