'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signSession, COOKIE_NAME } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');

const prisma = new PrismaClient();
const router = express.Router();

// Общий пароль для входа по выбору менеджера (ТП). Проверяется против
// DEMO_PASSWORD, а не против таблицы users -- ТП-пользователи создаются
// лениво через upsert ниже (по managerId), а не сидом. Дефолт 123456 только
// если переменная не задана вовсе.
//
// PHA-81 QA: admin/rukovoditel НЕ создаются лениво (нет managerId, не через
// эту форму) -- их обязан завести `npm run seed:users`, который теперь есть
// в render.yaml buildCommand (иначе на эфемерной БД Render кабинет
// руководителя недостижим никем, включая владельца -- см. PHA-81 QA отчёт).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '123456';

// Общие для формы входа списки (менеджеры для ТП, регионы для руководителя).
async function loginFormOptions() {
  const [managers, regions] = await Promise.all([
    prisma.manager.findMany({ orderBy: { name: 'asc' } }),
    prisma.region.findMany({ orderBy: { name: 'asc' } }),
  ]);
  return { managers, regions };
}

router.get('/login', async (req, res, next) => {
  try {
    if (req.user) return res.redirect('/');
    const options = await loginFormOptions();
    res.render('login', { error: null, ...options });
  } catch (err) {
    next(err);
  }
});

// PHA-81: до этой задачи RUKOVODITEL/ADMIN не могли войти вообще. seedUsers.js
// создаёт rukovoditel/admin с реальным passwordHash -- оставлено как вход
// АДМИНИСТРАТОРА по логину/паролю (users.passwordHash, bcrypt). Для
// руководителя этот путь заменён на /login/region (PHA-82, см. ниже) --
// seedUsers-аккаунт rukovoditel не создаётся лениво и пропадает на эфемерной
// БД Render (см. PHA-82 ТЗ), поэтому руководителю нужен вход, не зависящий
// от сида. Роль явно не проверяется здесь: строка users с ролью RUKOVODITEL,
// заведённая вручную через /admin/users, тоже может войти этим путём -- это
// сознательно оставлено как запасной путь для админ-заведённых аккаунтов.
router.post('/login/user', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = username ? await prisma.user.findUnique({ where: { username } }) : null;
    const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      const options = await loginFormOptions();
      return res.status(401).render('login', { error: 'Неверный логин или пароль', ...options });
    }
    const token = signSession(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// PHA-82: вход руководителя -- выбор бизнес-региона (distinct список из
// regions, т.е. из данных, а не хардкод) + общий пароль DEMO_PASSWORD (та же
// переменная, что у ТП -- см. ТЗ "на твоё усмотрение", отдельная переменная
// не заводится, чтобы не плодить новых обязательных env на Render). Пароль
// проверяется НЕ против users.passwordHash, а против DEMO_PASSWORD -- ровно
// по той же причине, что и вход ТП: users пустая на эфемерной БД Render, а
// сид (seedUsers) переживает только билд, но не рестарт эфемерного диска
// (см. ТЗ PHA-82). Под выбранный регион здесь лениво get-or-create'ится
// настоящая строка User (регион кладётся в сессию через regionId, не как
// отдельная таблица "выбор" -- см. jwt.js), а не подставляется region.id
// вместо user.id.
router.post('/login/region', async (req, res, next) => {
  try {
    const { regionId, password } = req.body;
    const options = await loginFormOptions();
    const regionIdNum = Number(regionId);
    const region = Number.isInteger(regionIdNum)
      ? await prisma.region.findUnique({ where: { id: regionIdNum } })
      : null;
    if (!region || String(password || '') !== DEMO_PASSWORD) {
      return res.status(401).render('login', { error: 'Неверный регион или пароль', ...options });
    }
    const user = await prisma.user.upsert({
      where: { regionId: region.id },
      update: {},
      create: {
        username: `rukovoditel-region-${region.id}`,
        role: 'RUKOVODITEL',
        regionId: region.id,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      },
    });
    const token = signSession(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { managerId, password } = req.body;
    const options = await loginFormOptions();
    const managerIdNum = Number(managerId);
    const manager = Number.isInteger(managerIdNum)
      ? await prisma.manager.findUnique({ where: { id: managerIdNum } })
      : null;
    if (!manager || String(password || '') !== DEMO_PASSWORD) {
      return res.status(401).render('login', { error: 'Неверный менеджер или пароль', ...options });
    }
    // Вход всегда как TP (ТЗ: роли руководитель/админ -- позже). users
    // пустая на эфемерной БД, поэтому под каждого менеджера здесь
    // get-or-create'ится настоящая строка User (а не подставляется
    // manager.id вместо user.id в сессию) -- иначе Note.authorId/
    // Order.createdById (реальные FK на users) падают на первой же
    // заметке/заказе, т.к. такой строки users нет (см. QA PHA-78).
    // passwordHash сразу захеширован от DEMO_PASSWORD, чтобы
    // /account/password тоже был согласован с этим входом, а не всегда
    // отвечал "неверный пароль".
    const user = await prisma.user.upsert({
      where: { managerId: manager.id },
      update: {},
      create: {
        username: `tp-manager-${manager.id}`,
        role: 'TP',
        managerId: manager.id,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      },
    });
    const token = signSession(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

router.get('/account/password', requireAuth, (req, res) => {
  res.render('changePassword', { error: null, done: false, user: req.user });
});

router.post('/account/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    const ok = user && (await bcrypt.compare(String(currentPassword || ''), user.passwordHash));
    if (!ok) {
      return res.status(401).render('changePassword', { error: 'Текущий пароль неверен', done: false, user: req.user });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).render('changePassword', { error: 'Новый пароль должен быть не короче 6 символов', done: false, user: req.user });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.render('changePassword', { error: null, done: true, user: req.user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
