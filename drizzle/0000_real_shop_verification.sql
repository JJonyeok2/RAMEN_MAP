CREATE TABLE IF NOT EXISTS shop_candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  region TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  phone TEXT NOT NULL DEFAULT '',
  representative_menu TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  ramen_types TEXT NOT NULL DEFAULT '[]',
  broth_style TEXT NOT NULL DEFAULT 'unknown',
  body INTEGER NOT NULL DEFAULT 3,
  spiciness INTEGER NOT NULL DEFAULT 0,
  bases TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  hours TEXT NOT NULL DEFAULT '',
  closed TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  secondary_source_url TEXT NOT NULL DEFAULT '',
  evidence_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'hold', 'rejected')),
  reviewer_note TEXT NOT NULL DEFAULT '',
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS shop_candidates_status_idx ON shop_candidates(status);
CREATE INDEX IF NOT EXISTS shop_candidates_area_idx ON shop_candidates(area);

INSERT OR IGNORE INTO shop_candidates (id, name, area, region, district, address, lat, lng, phone, representative_menu, price, ramen_types, broth_style, body, spiciness, bases, tags, hours, closed, source_name, source_url, secondary_source_url, evidence_note) VALUES
('menkyudan', '멘큐단', '안양', '경기', '안양시 동안구', '경기 안양시 동안구 관평로69번길 19 1층 101호', 37.3832507, 126.9640521, '', '쇼유라멘', 10000, '["shoyu","shio","tsukemen"]', 'chintan', 2, 0, '["닭","해산물"]', '["쇼유","시오","곤부스이","츠케멘"]', '11:30-20:00 · 라스트오더 19:30', '월·화요일', '다이닝코드', 'https://www.diningcode.com/profile.php?rid=pxroF2jlNKso', 'https://www.tabling.co.kr/place/677cd5cc66de5f06988fd999', '쇼유·시오·곤부스이 츠케멘 메뉴와 현재 영업시간을 직접 확인해 주세요.'),
('shinmen', '신멘', '안양', '경기', '안양시 동안구', '경기 안양시 동안구 호성로 20 호계금호어울림 상가 1층 101호', 37.3655944, 126.9645788, '', '쇼유', 11000, '["shoyu","mazesoba"]', 'chintan', 2, 0, '["닭","해산물"]', '["맑은간장라멘","교카이마제멘"]', '수-일 11:30-19:30 · 브레이크 15:00-17:30', '월·화요일', '다이닝코드', 'https://www.diningcode.com/profile.php?rid=HcM3OLGaj0Wc', 'https://polle.com/place/11yXzv/%EC%8B%A0%EB%A9%B4', '좌표는 호성로 도로 구간을 기준으로 한 근사값입니다. 정확한 건물 위치와 변동 메뉴를 확인해 주세요.'),
('ramen-club', '라멘 구락부', '안양 생활권', '경기', '의왕시', '경기 의왕시 계원대학로 28 112호', 37.3795653, 126.9746005, '031-422-7520', '농후니보시', 11500, '["shoyu","mazesoba"]', 'paitan', 5, 3, '["닭","해산물"]', '["농후니보시","카라이","토리파이탄","아부라소바"]', '11:00-19:30 · 브레이크 15:00-17:00', '', '테이블링', 'https://www.tabling.co.kr/place/677ccd2066de5f0698806d9f', 'https://www.114.co.kr/search/detail?comp_id=275734&comp_tp_cd=INT&upjong_cd=852309', '행정구역은 의왕시지만 사용자가 지정한 안양 생활권 후보입니다. 농후니보시의 백탕 분류와 카라이 메뉴를 확인해 주세요.'),
('menji-mangwon', '멘지 망원점', '망원', '서울', '마포구', '서울 마포구 월드컵로11길 8 103호', 37.5549408, 126.9104224, '0507-1493-1984', '토리파이탄', 10000, '["shoyu","shio"]', 'paitan', 4, 0, '["닭"]', '["토리파이탄","땡초","카라탄탄멘"]', '', '', '식신', 'https://www.siksinhot.com/P/1146325', 'https://polle.com/place/2PXstD/%EB%A9%98%EC%A7%80', '전화번호 출처가 서로 다릅니다. 토리파이탄 가격과 땡초·카라 탄탄멘의 현재 판매 여부를 확인해 주세요.'),
('jirou-ramen', '지로우 라멘', '홍대', '서울', '마포구', '서울 마포구 와우산로29가길 79 1층', 37.5537140, 126.9251171, '02-323-3225', '지로우라멘', 10000, '["tonkotsu"]', 'paitan', 5, 1, '["돼지","해산물"]', '["지로우라멘","교카이돈코츠","폭탄라멘"]', '11:30-21:00 · 평일 브레이크 15:00-17:00 · 라스트오더 20:30', '', '다이닝코드', 'https://www.diningcode.com/profile.php?rid=FBnGPdWhe5Rs', '', '대표 메뉴와 영업시간을 직접 확인해 주세요.'),
('oreno-ramen', '오레노라멘 본점', '합정', '서울', '마포구', '서울 마포구 독막로8길 16 1층', 37.5467436, 126.9178455, '', '토리빠이탄', 13000, '["shio"]', 'paitan', 4, 0, '["닭"]', '["토리빠이탄","카라빠이탄"]', '11:00-22:00 · 라스트오더 21:30', '연중무휴', '판다랭크', 'https://pandarank.net/contents/6999c0006e46d5490aa9222c', 'https://english.visitkorea.or.kr/svc/whereToGo/locIntrdn/rgnContentsView.do?vcontsId=191605', '2026년 자료는 독막로8길 16 이전을 안내하지만 기존 공식 관광 자료는 독막로6길 14입니다. 현 주소를 꼭 확인해 주세요.'),
('damtaek', '담택', '합정', '서울', '마포구', '서울 마포구 동교로12안길 51 1층', 37.5544520, 126.9151648, '0507-1347-4561', '시오라멘', 9500, '["shio"]', 'chintan', 2, 0, '["닭","채소"]', '["시오","유즈시오","와사비시오","능이고마멘"]', '월-토 11:30-21:00', '일요일', '테이블링', 'https://www.tabling.co.kr/restaurant/8928', '', '현재 자료는 동교로12안길 51이지만 과거 자료에는 월드컵로8길 34가 남아 있습니다. 이전 여부와 현재 메뉴를 확인해 주세요.'),
('menyajun', '멘야준', '홍대·합정', '서울', '마포구', '서울 마포구 동교로 128', 37.5549046, 126.9163882, '070-8677-0726', '시오라멘', 11000, '["shio","shoyu"]', 'chintan', 2, 0, '["닭","해산물"]', '["시오","쇼유","특선시오"]', '11:00-20:30', '', '테이블링', 'https://www.tabling.co.kr/place/677ccdc066de5f069881a5c5', 'https://www.eathub.co.kr/ko/restaurant/%EC%84%9C%EC%9A%B8-%EB%A9%98%EC%95%BC%EC%A4%80-661c2546-8874-4f54-9fd2-c55261e3f500', '시오·쇼유 메뉴와 현재 영업시간을 직접 확인해 주세요.');
