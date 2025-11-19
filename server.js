const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// 1시간 동안 좌석 유지
const EXPIRE_MS = 60 * 60 * 1000;

app.use(express.json());
app.use(express.static(__dirname));

// DB 초기화
const DB_PATH = path.join(__dirname, "seat_system.db");
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

db.serialize(() => {
  // 총좌석
  db.run(`
    CREATE TABLE IF NOT EXISTS seat_totals (
      floor TEXT NOT NULL,
      seatType TEXT NOT NULL,
      total INTEGER NOT NULL,
      PRIMARY KEY (floor, seatType)
    )
  `);

  // 사용 중인 좌석
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL,
      floor TEXT NOT NULL,
      seatType TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    )
  `);

  // 학생 계정
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      password TEXT NOT NULL
    )
  `);

  // 기본 좌석 설정
  const defaults = [
    ["1층", "장애인석", 5],
    ["1층", "콘센트석", 5],
    ["1층", "일반석", 10],

    ["2층", "장애인석", 5],
    ["2층", "콘센트석", 5],
    ["2층", "일반석", 10],

    ["3층", "장애인석", 5],
    ["3층", "콘센트석", 5],
    ["3층", "일반석", 10],

    ["4층", "장애인석", 5],
    ["4층", "콘센트석", 5],
    ["4층", "일반석", 10],

    ["1열람실", "장애인석", 6],
    ["1열람실", "콘센트석", 24],
    ["1열람실", "일반석", 368],

    ["2열람실", "장애인석", 11],
    ["2열람실", "콘센트석", 18],
    ["2열람실", "일반석", 312]
  ];

  const seatStmt = db.prepare(`
    INSERT OR IGNORE INTO seat_totals (floor, seatType, total)
    VALUES (?, ?, ?)
  `);

  defaults.forEach(([floor, seatType, total]) => {
    seatStmt.run(floor, seatType, total);
  });

  seatStmt.finalize();

  // 학생 계정 기본 데이터
  const students = [
    ["12345678", "12345678"],
    ["12341234", "12341234"],
    ["56785678", "56785678"],
    ["11112222", "11112222"],
    ["33334444", "33334444"],
  ];

  const stuStmt = db.prepare(`
    INSERT OR IGNORE INTO students (studentId, password)
    VALUES (?, ?)
  `);

  students.forEach(([id, pw]) => {
    stuStmt.run(id, pw);
  });

  stuStmt.finalize();
});

// 1시간이 지나면 재인증
async function cleanExpiredSessions() {
  const cutoff = Date.now() - EXPIRE_MS;
  await run(`DELETE FROM sessions WHERE createdAt < ?`, [cutoff]);
}

app.get("/api/seatInfo", async (req, res) => {
  try {
    await cleanExpiredSessions();

    const totals = await all(
      `SELECT floor, seatType, total FROM seat_totals`
    );

    const usedRows = await all(
      `SELECT floor, seatType, COUNT(*) AS used
       FROM sessions
       GROUP BY floor, seatType`
    );

    const usedMap = {};
    usedRows.forEach((row) => {
      const key = `${row.floor}||${row.seatType}`;
      usedMap[key] = row.used;
    });

    const result = {};

    totals.forEach((row) => {
      if (!result[row.floor]) {
        result[row.floor] = {};
      }
      const key = `${row.floor}||${row.seatType}`;
      const used = usedMap[key] || 0;
      result[row.floor][row.seatType] = {
        used,
        total: row.total,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("seatInfo 오류:", err);
    res.status(500).json({ ok: false, message: "서버 오류" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { studentId, password, floor, seatType, agree } = req.body;

    if (!studentId || !password || !floor || !seatType) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_INPUT",
        message: "모든 값을 입력하세요.",
      });
    }

    if (!agree) {
      return res.status(400).json({
        ok: false,
        code: "NO_AGREE",
        message: "동의해야 인증할 수 있습니다.",
      });
    }

    const stu = await get(
      `SELECT studentId, password FROM students WHERE studentId = ?`,
      [String(studentId)]
    );

    if (!stu) {
      return res.status(400).json({
        ok: false,
        code: "NO_STUDENT",
        message: "등록되지 않은 학번입니다.",
      });
    }

    if (stu.password !== String(password)) {
      return res.status(400).json({
        ok: false,
        code: "WRONG_PASSWORD",
        message: "비밀번호가 올바르지 않습니다.",
      });
    }

    await cleanExpiredSessions();

    // 학번 확인
    const dup = await get(
      `SELECT id FROM sessions WHERE studentId = ?`,
      [String(studentId)]
    );

    if (dup) {
      return res.status(400).json({
        ok: false,
        code: "DUPLICATE",
        message: "이미 인증된 사용자입니다.",
      });
    }

    // 4) 좌석 존재 여부 확인
    const totalRow = await get(
      `SELECT total FROM seat_totals WHERE floor = ? AND seatType = ?`,
      [floor, seatType]
    );

    if (!totalRow) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_SEAT",
        message: "유효하지 않은 층/좌석입니다.",
      });
    }

    // 5) 현재 사용 중인 좌석 수 확인
    const usedRow = await get(
      `SELECT COUNT(*) AS used
       FROM sessions
       WHERE floor = ? AND seatType = ?`,
      [floor, seatType]
    );

    const used = usedRow ? usedRow.used : 0;

    if (used >= totalRow.total) {
      return res.status(400).json({
        ok: false,
        code: "FULL",
        message: "해당 좌석은 가득 찼습니다.",
      });
    }

    // 6) 세션 추가
    await run(
      `INSERT INTO sessions (studentId, floor, seatType, createdAt)
       VALUES (?, ?, ?, ?)`,
      [String(studentId), floor, seatType, Date.now()]
    );

    res.json({
      ok: true,
      message: "인증 성공!",
    });
  } catch (err) {
    console.error("login 오류:", err);
    res.status(500).json({ ok: false, message: "서버 오류" });
  }
});

// 남은 시간 조회
app.get("/api/time-remaining", async (req, res) => {
  try {
    const studentId = req.query.studentId;

    if (!studentId) {
      return res.status(400).json({
        ok: false,
        code: "NO_ID",
        message: "학번을 입력하세요.",
      });
    }

    await cleanExpiredSessions();

    const session = await get(
      `SELECT createdAt FROM sessions WHERE studentId = ?`,
      [String(studentId)]
    );

    if (!session) {
      return res.json({
        ok: false,
        code: "NO_SESSION",
        message: "현재 활성화된 인증이 없습니다.",
      });
    }

    const now = Date.now();
    const expireAt = session.createdAt + EXPIRE_MS;
    const remainingMs = expireAt - now;

    if (remainingMs <= 0) {
      return res.json({
        ok: false,
        code: "EXPIRED",
        message: "인증이 만료되었습니다.",
      });
    }

    res.json({
      ok: true,
      remainingMs,
      expireAt,
    });
  } catch (err) {
    console.error("time-remaining 오류:", err);
    res.status(500).json({ ok: false, message: "서버 오류" });
  }
});

// 관리자용 사용자 목록 조회
app.get("/api/admin/users", async (req, res) => {
  try {
    await cleanExpiredSessions();

    const rows = await all(
      `SELECT studentId, floor, seatType, createdAt
       FROM sessions`
    );

    res.json(rows);
  } catch (err) {
    console.error("admin/users 오류:", err);
    res.status(500).json({ ok: false, message: "서버 오류" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
