'use strict';

const path = require('path');
const express = require('express');
const homeRouter = require('./routes/home');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/', homeRouter);

  return app;
}

module.exports = { createApp };
