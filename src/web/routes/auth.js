'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signSession, COOKIE_NAME } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');

const prisma = new PrismaClient();
const router = express.Router();

// Общий пароль для входа по выбору менеджера (ТП). Проверяется против
// DEMO_PASSWORD, а не против таблицы users -- на Render база эфемерная
// (пересоздаётся при каждом деплое) и users там пустая, seed:users в
// buildCommand не запускается. Дефолт 123456 только если переменная не
// задана вовсе.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '123456';

router.get('/login', async (req, res, next) => {
  try {
    if (req.user) return res.redirect('/');
    const managers = await prisma.manager.findMany({ orderBy: { name: 'asc' } });
    res.render('login', { error: null, managers });
  } catch (err) {
    next(err);
  }
});

// PHA-81: до этой задачи RUKOVODITEL/ADMIN не могли войти вообще -- форма
// поддерживала только выбор менеджера + DEMO_PASSWORD (всегда вход как TP,
// см. комментарий ниже про ТЗ "роли руководитель/админ -- позже"). Но
// seedUsers.js уже создаёт rukovoditel/admin с реальным passwordHash, а
// кабинет руководителя (эта задача) требует, чтобы под rukovoditel можно
// было войти -- иначе экран недостижим ни для кого. Логин/пароль сверяются
// с users.passwordHash (bcrypt), а не с DEMO_PASSWORD.
router.post('/login/user', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = username ? await prisma.user.findUnique({ where: { username } }) : null;
    const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      const managers = await prisma.manager.findMany({ orderBy: { name: 'asc' } });
      return res.status(401).render('login', { error: 'Неверный логин или пароль', managers });
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

router.post('/login', async (req, res, next) => {
  try {
    const { managerId, password } = req.body;
    const managers = await prisma.manager.findMany({ orderBy: { name: 'asc' } });
    const managerIdNum = Number(managerId);
    const manager = Number.isInteger(managerIdNum)
      ? await prisma.manager.findUnique({ where: { id: managerIdNum } })
      : null;
    if (!manager || String(password || '') !== DEMO_PASSWORD) {
      return res.status(401).render('login', { error: 'Неверный менеджер или пароль', managers });
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
