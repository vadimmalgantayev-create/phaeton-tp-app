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

router.post('/login', async (req, res, next) => {
  try {
    const { managerId, password } = req.body;
    const managers = await prisma.manager.findMany({ orderBy: { name: 'asc' } });
    const manager = managerId ? await prisma.manager.findUnique({ where: { id: Number(managerId) } }) : null;
    if (!manager || String(password || '') !== DEMO_PASSWORD) {
      return res.status(401).render('login', { error: 'Неверный менеджер или пароль', managers });
    }
    // Вход всегда как TP (ТЗ: роли руководитель/админ -- позже). Сессия
    // строится напрямую из Manager, без строки в users.
    const token = signSession({ id: manager.id, username: manager.name, role: 'TP', managerId: manager.id });
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
