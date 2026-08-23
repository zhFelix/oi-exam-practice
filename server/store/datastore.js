// ============================================================
// datastore.js —— 通用 JSON 文件集合（内存数组 + 同步落盘）
// 启动时加载进内存，读写走内存，变更后同步写盘
// （临时文件 + rename 原子替换，避免进程退出丢数据）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

export class DataStore {
  /**
   * @param {string} fileName data/ 目录下的文件名，如 'users.json'
   */
  constructor(fileName) {
    this.file = path.join(DATA_DIR, fileName);
    this.rows = [];
    this._load();
  }

  _load() {
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.rows = raw.trim() ? JSON.parse(raw) : [];
    } else {
      this._save(); // 首次创建空集合文件
    }
  }

  _save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.rows, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** 按条件查询，filter 为字段精确匹配对象 */
  find(filter = {}) {
    return this.rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
  }

  findById(id) {
    return this.rows.find((r) => r.id === id) || null;
  }

  /** 插入并落盘 */
  insert(doc) {
    this.rows.push(doc);
    this._save();
    return doc;
  }

  /** 更新所有满足 predicate 的行，返回更新行数 */
  update(predicate, patch) {
    let changed = 0;
    for (const row of this.rows) {
      if (predicate(row)) {
        Object.assign(row, patch);
        changed += 1;
      }
    }
    if (changed) this._save();
    return changed;
  }

  /** 删除所有满足 predicate 的行 */
  remove(predicate) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !predicate(r));
    if (this.rows.length !== before) this._save();
  }

  count(filter = {}) {
    return this.rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)).length;
  }
}
