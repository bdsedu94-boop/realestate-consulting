const fs = require('fs');
const path = require('path');

/*
 * 데이터 저장: db.json 파일 하나 (수강생 students, 추천물건 recommendations)
 * - Railway Volume 이 있으면 RAILWAY_VOLUME_MOUNT_PATH 에 저장 (재배포해도 유지)
 * - 로컬 개발에서는 프로젝트 폴더에 저장
 */
module.exports = function createDB(DATA_DIR) {
  const DB_FILE = path.join(DATA_DIR, 'db.json');

  function readDB() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(DB_FILE)) {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('DB 읽기 오류:', e);
    }
    return { students: [], nextId: 1 };
  }

  function writeDB(data) {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('DB 쓰기 오류:', e);
    }
  }

  return { readDB, writeDB };
};
