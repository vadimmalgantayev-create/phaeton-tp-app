'use strict';

const jwt = require('jsonwebtoken');

// Раньше здесь был дефолт-заглушка на случай отсутствия JWT_SECRET -- это
// был обход авторизации: репозиторий публичный, значение дефолта было бы
// известно кому угодно, и на деплое без явно заданного секрета сервер тихо
// подписывал бы токены им (см. разбор в PHA-68/PHA-70). Секрет обязателен:
// без него сервер должен падать при старте, а не работать в незащищённом
// режиме.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET не задан. Сгенерируйте случайный секрет и добавьте в .env ' +
    '(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))") ' +
    'или в переменные окружения деплоя (Render: значение генерируется автоматически, см. render.yaml).'
  );
}
const COOKIE_NAME = 'phaeton_session';
const EXPIRES_IN = '12h';

function signSession(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, managerId: user.managerId, regionId: user.regionId },
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
