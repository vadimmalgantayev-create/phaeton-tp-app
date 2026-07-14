'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signSession, COOKIE_NAME } = require('../auth/jwt');
const { requireAuth } = require('../auth/middleware');

const prisma = new PrismaClient();
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username: String(username || '').trim() } });
    if (!user || !user.isActive) {
      return res.status(401).render('login', { error: 'Неверный логин или пароль' });
    }
    const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
    if (!ok) {
      return res.status(401).render('login', { error: 'Неверный логин или пароль' });
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
