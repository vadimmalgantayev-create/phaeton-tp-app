'use strict';

const { createApp } = require('./web/app');

const PORT = process.env.PORT || 3000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`Phaeton TP app listening on port ${PORT}`);
});
