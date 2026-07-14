'use strict';

require('dotenv').config();

// Создаёт стартовых пользователей для демонстрации логина/RBAC (ТЗ 6.1).
// Пароли — временные, только для локальной демонстрации; в проде их нужно
// сразу сменить через /account/password или пересоздать через /admin/users.
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SEED_USERS = [
  { username: 'admin', role: 'ADMIN', managerId: null, password: 'admin12345' },
  { username: 'rukovoditel', role: 'RUKOVODITEL', managerId: null, password: 'ruk12345' },
];

async function main() {
  for (const u of SEED_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { username: u.username, role: u.role, managerId: u.managerId, passwordHash },
    });
  }

  // ТП-логин для менеджера id=11 (реальные данные из samples/ есть у него,
  // удобно для демонстрации главной/каталога/клиентов).
  const demoManager = await prisma.manager.findUnique({ where: { id: 11 } });
  if (demoManager) {
    const existing = await prisma.user.findUnique({ where: { managerId: 11 } });
    if (!existing) {
      const passwordHash = await bcrypt.hash('tp12345', 10);
      await prisma.user.create({
        data: { username: 'tp11', role: 'TP', managerId: 11, passwordHash },
      });
    }
  }

  console.log('Seed users готовы: admin/admin12345, rukovoditel/ruk12345, tp11/tp12345 (managerId=11)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
