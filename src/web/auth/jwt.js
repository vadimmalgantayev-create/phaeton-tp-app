'use strict';

const jwt = require('jsonwebtoken');

// ⚑ Открытый вопрос: нет секрет-менеджера в этом окружении. JWT_SECRET
// должен быть задан в проде (render.yaml/переменные окружения); здесь
// используется dev-заглушка только чтобы локальный запуск не падал.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const COOKIE_NAME = 'phaeton_session';
const EXPIRES_IN = '12h';

function signSession(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, managerId: user.managerId },
    JWT_SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { signSession, verifySession, COOKIE_NAME };
