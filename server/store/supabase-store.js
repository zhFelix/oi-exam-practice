// ============================================================
// supabase-store.js —— Supabase 存储实现（t12 阶段2；t13 验收修复）
// 与 server/store/datastore.js 的 DataStore 接口完全一致：
//   find / findById / insert / update / remove / count（全部同步）
// 实现策略：内存缓存 + 串行异步持久化
//   - 启动时 initStores() 调用 load() 把整表读入内存（数据量为个人级，量小）
//   - 读操作走内存（同步）；写操作先更新内存，再按提交顺序**串行**写入
//     Supabase（_queue 链式队列，保证 insert→update 同键操作不乱序，
//     修复 update 先于 insert 落库导致静默丢失的竞态）
//   - 优雅退出（SIGINT/SIGTERM）通过 flush() 排空写队列后再退出，正常部署
//     重启不丢数据；进程被强杀（kill -9/断电）时未落库的写会丢失——
//     这是内存缓存 + 异步落库的固有限制，超低延迟与强一致不可兼得
//   - Supabase 不可用：启动 load 失败由 collections.js 回退 JSON DataStore；
//     运行中写失败仅记日志（内存继续服务），DB 以最后一次成功落库为准
// ============================================================
import { supabaseData } from './supabase.js';

export class SupabaseStore {
  /**
   * @param {string} table Supabase 表名（users / answers / wrong_book / exam_sessions / exam_results）
   */
  constructor(table) {
    this.table = table;
    this.rows = [];
    /** 串行写队列：所有持久化任务按调用顺序排队执行 */
    this._queue = Promise.resolve();
  }

  /** 启动时整表载入内存（initStores 调用；失败抛错由调用方回退 JSON） */
  async load() {
    const { data, error } = await supabaseData.from(this.table).select('*');
    if (error) throw error;
    this.rows = data || [];
    return this;
  }

  // ---------- 同步读（内存） ----------

  find(filter = {}) {
    return this.rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
  }

  findById(id) {
    return this.rows.find((r) => r.id === id) || null;
  }

  count(filter = {}) {
    return this.rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)).length;
  }

  // ---------- 同步写（内存 + 异步持久化） ----------

  insert(doc) {
    this.rows.push(doc);
    this._persist(() => supabaseData.from(this.table).insert(doc), `insert ${this.table}`);
    return doc;
  }

  /** 仅更新内存缓存，不触发持久化——用于已在 Supabase 侧直接写入（如 auth 路由）的场景 */
  cachePush(doc) {
    this.rows.push(doc);
    return doc;
  }

  /** 更新所有满足 predicate 的行，返回更新行数 */
  update(predicate, patch) {
    let changed = 0;
    const ids = [];
    for (const row of this.rows) {
      if (predicate(row)) {
        Object.assign(row, patch);
        ids.push(row.id);
        changed += 1;
      }
    }
    if (changed) {
      this._persist(async () => {
        for (const id of ids) {
          try {
            const { error } = await supabaseData.from(this.table).update(patch).eq('id', id);
            if (error) throw error;
          } catch (e) {
            console.error(`[supabase-store] update ${this.table} id=${id} 失败:`, e.message);
          }
        }
      }, `update ${this.table} x${changed}`);
    }
    return changed;
  }

  /** 删除所有满足 predicate 的行 */
  remove(predicate) {
    const ids = this.rows.filter(predicate).map((r) => r.id);
    if (ids.length) {
      this.rows = this.rows.filter((r) => !predicate(r));
      this._persist(async () => {
        for (const id of ids) {
          try {
            const { error } = await supabaseData.from(this.table).delete().eq('id', id);
            if (error) throw error;
          } catch (e) {
            console.error(`[supabase-store] delete ${this.table} id=${id} 失败:`, e.message);
          }
        }
      }, `delete ${this.table} x${ids.length}`);
    }
  }

  /** 串行持久化：排队执行，按内存操作顺序落库；错误仅记日志，不阻断业务 */
  _persist(task, label) {
    this._queue = this._queue
      .then(async () => {
        await task();
      })
      .catch((e) => {
        console.error(`[supabase-store] ${label} 持久化失败（内存已更新，DB 可能不一致，请人工核对）:`, e.message);
      });
  }

  /** 等待所有已排队写操作落库（优雅退出前调用；无待写任务时立即返回） */
  async flush() {
    await this._queue;
  }
}
