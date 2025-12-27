
-- inventory_details
-- 用於保存 ERP 庫存品項的補貨/效期等參數。

create table if not exists public.inventory_details (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	category text,                  -- 類別（例如：長效*熱銷）
	rank integer,                   -- 排行
	item_code text not null,        -- 貨品代號
	item_name text,                -- 貨品名稱
	unit text,                     -- 單位
	shelf_life_days integer,        -- 效期（天）
	shelf_life_category text,       -- 效期分類（例如：長效* / 中效*）
	sales_grade text,              -- 銷度（例如：熱銷）
	lead_time_days integer,         -- 交期（天）
	delivery text,                 -- 配送（文字描述）
	max_purchase_param numeric,     -- 最大進貨量參數
	safety_stock_param numeric,     -- 安全庫存參數
	inventory_turnover_days numeric -- 庫存週轉天數
);

-- 若表格已存在（早期版本欄位不齊），補齊欄位
alter table public.inventory_details add column if not exists unit text;

create unique index if not exists inventory_details_item_code_uidx
	on public.inventory_details (item_code);

-- 自動維護 updated_at
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists trg_inventory_details_set_updated_at on public.inventory_details;
create trigger trg_inventory_details_set_updated_at
before update on public.inventory_details
for each row
execute function public.set_updated_at_timestamp();

-- 範例資料（可重複執行）
insert into public.inventory_details (
	category,
	rank,
	item_code,
	item_name,
	unit,
	shelf_life_days,
	shelf_life_category,
	sales_grade,
	lead_time_days,
	delivery,
	max_purchase_param,
	safety_stock_param,
	inventory_turnover_days
) values
	('長效*熱銷', 1, 'A00002', '◎豬排肉', '盤', 365, '長效*', '熱銷', 7,  'W2、5；W5會較多', 7, 10, 17.5),
	('長效*熱銷', 3, 'A00023', '◎手工蛋餅皮', '包', 180, '長效*', '熱銷', 14, 'W1-5',          7, 10, 17.5),
	('長效*熱銷', 4, 'A00068', '◎美式薯條', '包', 540, '長效*', '熱銷', 7,  '中午前訂.隔天到', 7, 10, 17.5),
	('中效*熱銷', 7, 'A00235', '◎牛奶土司', '條', 90,  '中效*', '熱銷', 7,  '',               7, 10, 17.5),
	('長效*熱銷', 8, 'A00258', '◎好事堡(新)', '包', 180, '長效*', '熱銷', 7,  '',               7, 10, 17.5)
on conflict (item_code) do update set
	category = excluded.category,
	rank = excluded.rank,
	item_name = excluded.item_name,
	unit = excluded.unit,
	shelf_life_days = excluded.shelf_life_days,
	shelf_life_category = excluded.shelf_life_category,
	sales_grade = excluded.sales_grade,
	lead_time_days = excluded.lead_time_days,
	delivery = excluded.delivery,
	max_purchase_param = excluded.max_purchase_param,
	safety_stock_param = excluded.safety_stock_param,
	inventory_turnover_days = excluded.inventory_turnover_days;

