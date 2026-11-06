const fs = require('node:fs');
const path = require('node:path');
const { application, documentation } = require('../version.json');
const file = path.join(__dirname, '../build/build-info.json');
const stamped = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const buildInfo =
  stamped.version === application.version && stamped.build === application.build ? stamped : {};
module.exports = {
  ...buildInfo,
  ...application,
  displayVersion: `${application.version} (${application.build})`,
  documentation,
};
