import { DatabaseSync } from 'node:sqlite';
import { AppError } from './errors.js';

export class Workspace {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) {
      this.db.close();
      throw new Error('This workspace was created with a newer version of the app.');
    }
    if (!version) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        remit TEXT NOT NULL, manager TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL REFERENCES departments(id), body TEXT NOT NULL,
        created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS updates_by_department ON updates(department, seq DESC);
      CREATE TABLE IF NOT EXISTS exchanges (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL REFERENCES departments(id), question TEXT NOT NULL,
        answer TEXT NOT NULL, model TEXT NOT NULL,
        created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS exchanges_by_department ON exchanges(department, seq DESC);
      CREATE TABLE IF NOT EXISTS connection (
        id INTEGER PRIMARY KEY CHECK(id=1), endpoint TEXT NOT NULL, model TEXT NOT NULL
      );
      PRAGMA user_version=1;
      COMMIT;
    `);
  }
  departments() {
    return this.db.prepare('SELECT * FROM departments ORDER BY name COLLATE NOCASE').all();
  }
  department(id) {
    const dept = this.db.prepare('SELECT * FROM departments WHERE id=?').get(id);
    if (!dept) throw new AppError(404, 'Department not found.');
    return dept;
  }
  create({id, name, remit, manager}) {
    const previous = this.db.prepare('SELECT * FROM departments WHERE id=?').get(id);
    if (previous) {
      if (previous.name === name && previous.remit === remit && previous.manager === manager) return previous;
      throw new AppError(409, 'This request was already used.');
    }
    const result = this.db.prepare('INSERT INTO departments VALUES (?,?,?,?) ON CONFLICT(name) DO NOTHING RETURNING *')
      .get(id, name, remit, manager);
    if (!result) throw new AppError(409, 'A department with that name already exists.');
    return result;
  }
  updates(id, limit) {
    return this.db.prepare('SELECT id, body, created FROM updates WHERE department=? ORDER BY seq DESC LIMIT ?').all(id, limit);
  }
  addUpdate(dept, id, body) {
    this.db.prepare('INSERT INTO updates (id,department,body) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(id, dept, body);
    const row = this.db.prepare('SELECT id, body, created FROM updates WHERE department=? AND id=?').get(dept, id);
    if (!row || row.body !== body) throw new AppError(409, 'This request was already used.');
    return row;
  }
  exchanges(id, limit) {
    return this.db.prepare('SELECT id, question, answer, model, created FROM exchanges WHERE department=? ORDER BY seq DESC LIMIT ?')
      .all(id, limit).reverse();
  }
  previousExchange(dept, id, question) {
    const row = this.db.prepare('SELECT * FROM exchanges WHERE id=?').get(id);
    if (row && (row.department !== dept || row.question !== question)) throw new AppError(409, 'This request was already used.');
    return row;
  }
  recordExchange(dept, id, question, answer, model) {
    this.db.prepare('INSERT INTO exchanges (department,id,question,answer,model) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(dept, id, question, answer, model);
    return this.previousExchange(dept, id, question);
  }
  connection(base) {
    return this.db.prepare('SELECT model FROM connection WHERE id=1 AND endpoint=?').get(base)?.model || null;
  }
  connect(base, model) {
    this.db.prepare('INSERT INTO connection VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint, model=excluded.model')
      .run(base, model);
  }
  disconnect() { this.db.exec('DELETE FROM connection'); }
  close() { this.db.close(); }
}
