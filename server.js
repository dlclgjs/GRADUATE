const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "data.json");

// 좌석 유지 시간: 1시간
const EXPIRE_MS = 60 * 60 * 1000;

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("데이터 파일 읽기 실패:", e);
    return { seats: {}, users: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// 1시간 지난 사용자 정리소
function cleanExpiredUsers(data) {
  const now = Date.now();
  let changed = false;

  for (const userKey of Object.keys(data.users || {})) {
    const user = data.users[userKey];
    if (!user || !user.time) continue;

    const elapsed = now - user.time;

    if (elapsed > EXPIRE_MS) {
      const { floor, seatType } = user;

      if (
        data.seats &&
        data.seats[floor] &&
        data.seats[floor][seatType] &&
        data.seats[floor][seatType].used > 0
      ) {
        data.seats[floor][seatType].used -= 1;
      }

      delete data.users[userKey];
      changed = true;
    }
  }

  if (changed) {
    saveData(data);
  }
}

function loadDataAndClean() {
  const data = loadData();
  if (!data.seats) data.seats = {};
  if (!data.users) data.users = {};

  cleanExpiredUsers(data);
  return data;
}

app.get("/api/seatInfo", (req, res) => {
  const data = loadDataAndClean();
  res.json(data.seats);
});

app.post("/api/login", (req, res) => {
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

  const data = loadDataAndClean();

  const userKey = String(studentId); // 학번 기준 중복 체크

  if (data.users[userKey]) {
    return res.status(400).json({
      ok: false,
      code: "DUPLICATE",
      message: "이미 인증된 사용자입니다.",
    });
  }

  // 좌석 존재 여부 확인
  if (!data.seats[floor] || !data.seats[floor][seatType]) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_SEAT",
      message: "유효하지 않은 층/좌석입니다.",
    });
  }

  const seatInfo = data.seats[floor][seatType];

  if (seatInfo.used >= seatInfo.total) {
    return res.status(400).json({
      ok: false,
      code: "FULL",
      message: "해당 좌석은 가득 찼습니다.",
    });
  }

  // 좌석 +1
  seatInfo.used += 1;

  // 사용자 기록 저장 (인증 시각 포함)
  data.users[userKey] = {
    studentId,
    floor,
    seatType,
    time: Date.now(),
  };

  saveData(data);

  res.json({
    ok: true,
    message: "인증 성공!",
  });
});

app.get("/api/admin/users", (req, res) => {
  const data = loadDataAndClean();
  const users = Object.values(data.users || {});
  res.json(users);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
