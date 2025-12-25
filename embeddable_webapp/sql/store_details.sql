-- 建立 stores 表格
CREATE TABLE IF NOT EXISTS stores (
    id BIGSERIAL PRIMARY KEY,
    erp_customer_name TEXT NOT NULL,
    pos_store_name TEXT,
    address_zhtw TEXT,
    address_en TEXT,
    country TEXT DEFAULT '台灣',
    city TEXT,
    district TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    store_status TEXT DEFAULT 'active',
    store_type TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 建立自動更新 updated_at 的觸發器 (Supabase/PostgreSQL 慣用做法)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_stores_updated_at
    BEFORE UPDATE ON stores
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 插入範例資料
-- INSERT INTO stores (erp_customer_name, pos_store_name, address_zhtw, address_en, country, city, district, latitude, longitude, store_status, store_type)
-- VALUES 
-- ('三民北平店', '蕃茄村-三民北平店', '北平二街14號', 'No. 14號, Beiping 2nd St, Sanmin District, Kaohsiung City, Taiwan 807', '台灣', '高雄市', '三民區', 22.650317, 120.30269, 'active', '三代店'),
-- ('三重光復店(新)', NULL, '241新北市三重區光復路一段68巷4號', 'No. 39, Lane 145, Chenggong Rd, Sanchong District, New Taipei City, Taiwan 241', '台灣', '新北市', '三重區', 25.053315, 121.487875, 'inactive', '一般'),
-- ('下營中山店', NULL, '西平里中山路222號', '平 里, No. 222號, Zhongshan Rd, Lukang Township, Changhua County, Taiwan 505', '台灣', '彰化縣', '二林鎮', 24.0552699, 120.4345163, 'active', '一般'),
-- ('內湖安康店', '蕃茄村-內湖安康店', '安康路32巷24弄20號', 'No. 20號, Alley 24, Lane 32, Ankang Rd, Neihu District, Taipei City, Taiwan 114', '台灣', '台北市', '內湖區', 25.0616892, 121.5942574, 'active', '三代店'),
-- ('內湖星雲', NULL, '星雲街28號', 'No. 28, Xingyun St, Neihu District, Taipei City, Taiwan 114', '台灣', '台北市', '內湖區', 25.0781687, 121.5908791, 'active', '一般');
