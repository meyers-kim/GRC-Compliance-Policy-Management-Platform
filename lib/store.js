const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const files = {
  users: path.join(dataDir, 'users.json'),
  obligations: path.join(dataDir, 'obligations.json'),
  policies: path.join(dataDir, 'policies.json'),
  activity: path.join(dataDir, 'activity.json'),
};

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function readUsers() {
  return readJson(files.users);
}

async function readObligations() {
  return readJson(files.obligations);
}

async function writeObligations(data) {
  return writeJson(files.obligations, data);
}

async function readPolicies() {
  return readJson(files.policies);
}

async function writePolicies(data) {
  return writeJson(files.policies, data);
}

async function readActivity() {
  return readJson(files.activity);
}

async function writeActivity(data) {
  return writeJson(files.activity, data);
}

module.exports = {
  readUsers,
  readObligations,
  writeObligations,
  readPolicies,
  writePolicies,
  readActivity,
  writeActivity,
};
