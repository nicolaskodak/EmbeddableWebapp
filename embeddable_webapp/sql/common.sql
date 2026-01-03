-- (可選) 重建用
-- DROP SCHEMA IF EXISTS tb_mgmt CASCADE;

CREATE SCHEMA IF NOT EXISTS tb_mgmt;
SET search_path TO tb_mgmt;

-- UUID 產生器
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION tb_mgmt.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
