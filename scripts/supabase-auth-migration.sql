-- ============================================================
-- supabase-auth-migration.sql —— users 表迁移（Supabase Auth 接入，t17）
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴执行（全部幂等，可重复执行）
--
-- 背景：认证从自建 bcrypt+JWT 迁移到 Supabase Auth（GoTrue），登录标识从
-- username 改为 email。自建 public.users 表相应调整：
--   * 新增 email 列（登录标识，Supabase Auth 模式下必填；兼容模式可空）
--   * username 不再唯一（降级为昵称）
--   * 新增 auth_uid 列（Supabase Auth 用户 uuid；新用户 public.users.id 即 auth uid）
--   * password_hash 允许为空（Supabase Auth 用户密码由 GoTrue 管理，不落自建表）
-- 旧行（u_xxx / 明文 bcrypt 哈希）保留，供 Legacy 模式（未配置 Supabase）使用。
-- ============================================================

-- 1) 新增 email 列（登录标识）
alter table public.users add column if not exists email text;

-- 2) username 从登录标识降级为昵称：取消唯一约束（若存在）
alter table public.users drop constraint if exists users_username_key;

-- 3) email 唯一索引（部分索引：仅对非空生效，兼容迁移前的旧行）
create unique index if not exists users_email_key
  on public.users(email) where email is not null;

-- 4) 新增 auth_uid 列（Supabase Auth 用户 uuid；与 id 同值，便于显式关联查询）
alter table public.users add column if not exists auth_uid uuid;

-- 5) auth_uid 唯一索引（部分索引）
create unique index if not exists users_auth_uid_key
  on public.users(auth_uid) where auth_uid is not null;

-- 6) password_hash 允许为空（Supabase Auth 用户密码由 GoTrue 管理）
alter table public.users alter column password_hash drop not null;

-- 说明：如需对 auth.users 建立外键，需先把 public.users.id 与 auth_uid 类型对齐为 uuid，
-- 再执行：
--   alter table public.users alter column id type uuid using id::uuid;
--   alter table public.users add constraint users_auth_uid_fkey
--     foreign key (auth_uid) references auth.users(id);
-- （本阶段 id 保持 text，不强制外键，按值关联。）
