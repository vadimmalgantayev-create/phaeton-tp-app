'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { requireRole } = require('../auth/middleware');

const prisma = new PrismaClient();
const router = express.Router();

router.use(requireRole('ADMIN'));

router.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { manager: true },
      orderBy: { username: 'asc' },
    });
    res.render('adminUsers', { users, error: null, generatedPassword: null, user: req.user });
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const { username, role, managerId } = req.body;
    if (!username || !role) {
      const users = await prisma.user.findMany({ include: { manager: true }, orderBy: { username: 'asc' } });
      return res.status(400).render('adminUsers', { users, error: 'Логин и роль обязательны', generatedPassword: null, user: req.user });
    }
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.create({
      data: {
        username: username.trim(),
        role,
        passwordHash,
        managerId: role === 'TP' && managerId ? Number(managerId) : null,
      },
    });
    const users = await prisma.user.findMany({ include: { manager: true }, orderBy: { username: 'asc' } });
    res.render('adminUsers', { users, error: null, generatedPassword: tempPassword, user: req.user });
  } catch (err) {
    next(err);
  }
});

// Заменяет "восстановление пароля" по e-mail (в MVP нет почтового
// провайдера/шаблонов писем — открытый вопрос ТЗ 6.1): администратор
// выдаёт новый временный пароль пользователю лично.
router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: Number(req.params.id) }, data: { passwordHash } });
    const users = await prisma.user.findMany({ include: { manager: true }, orderBy: { username: 'asc' } });
    res.render('adminUsers', { users, error: null, generatedPassword: tempPassword, user: req.user });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/toggle-active', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: !user.isActive } });
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
