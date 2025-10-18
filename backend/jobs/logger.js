const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'jobs.log');

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
}

module.exports = { log };
