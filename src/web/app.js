'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { attachUser, requireAuth } = require('./auth/middleware');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const homeRouter = require('./routes/home');
const catalogRouter = require('./routes/catalog');
const clientsRouter = require('./routes/clients');
const ordersRouter = require('./routes/orders');
const notificationsRouter = require('./routes/notifications');
const routeRouter = require('./routes/route');
const managerRouter = require('./routes/manager');
const apiRouter = require('./routes/api');
const tasksRouter = require('./routes/tasks');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use('/', authRouter);
  app.use('/admin', requireAuth, adminRouter);
  app.use('/', requireAuth, homeRouter);
  app.use('/', requireAuth, catalogRouter);
  app.use('/', requireAuth, clientsRouter);
  app.use('/', requireAuth, ordersRouter);
  app.use('/', requireAuth, notificationsRouter);
  app.use('/', requireAuth, routeRouter);
  app.use('/', requireAuth, managerRouter);
  app.use('/', requireAuth, apiRouter);
  app.use('/', requireAuth, tasksRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Внутренняя ошибка сервера');
  });

  return app;
}

module.exports = { createApp };
