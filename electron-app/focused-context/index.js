const normalizers = require('./normalizers');
const clipboard = require('./clipboard');
const appCompat = require('./app-compat');
const readers = require('./readers');
const powershell = require('./powershell');
const scripts = require('./scripts');

module.exports = {
  ...normalizers,
  ...clipboard,
  ...appCompat,
  ...readers,
  ...powershell,
  ...scripts,
};
