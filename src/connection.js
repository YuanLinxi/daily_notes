// SQLite 连接单例：所有数据模块通过 getDb() 取连接，避免循环依赖
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

let db = null;
let dbPath = '';

function init(file) {
  if (db) close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  dbPath = file;
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  require('./migrate').run(db);
}

function close() {
  if (db) {
    try { db.close(); } catch { /* 已关闭 */ }
    db = null;
  }
}

function reopen(file) {
  init(file);
  return true;
}

const getDb = () => db;
const getPath = () => dbPath;

module.exports = { init, close, reopen, getDb, getPath };
