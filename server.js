const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "data.json");
const EXPIRE_MS = 60 * 60 * 1000;


function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const data = JSON.parse(raw);
    return normalizeData(data);
  } catch (e) {
    console.error("데이터 파일 읽기 실패:", e);
    return { seats: {}, users: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeData(data) {
  if (!data || typeof data !== "object") {
    return { seats: {}, users: {} };
  }
  if (!data.seats || typeof data.seats !== "object") {
    data.seats = {};
  }
  if (!data.users || typeof data.users !== "object") {
    data.users = {};
  }
  return data;
}

function decreaseSeatUsage(data, floor, seatType) {
  const seat =
    data.seats &&
    data.seats[floor] &&
    data.seats[floor][seatType];

  if (seat && seat.used > 0) {
    seat.used -= 1;
  }
}

function cleanExpiredUsers(data) {
  const now = Date.now();
  let changed = false;

  for (const [userKey, user] of Object.entries(data.users)) {
    if (!user || !user.time) continue;

    const elapsed = now - user.time;
    if (elapsed <= EXPIRE_MS) continue;

    decreaseSeatUsage(data, user.floor, user.seatType);
    delete data.users[userKey];
    changed = true;
  }

  if (changed) {
    saveData(data);
  }
}

function loadDataAndClean() {
  const data = loadData();
  cleanExpiredUsers(data);
  return data;
}


app.get("/api/seatInfo", (req, res) => {
  const data = loadDataAndClean();
  res.json(data.seats);
});

app.post("/api/login", (req, res) => {
  const { studentId, password, floor, seatType, agree } = req.body;

  const data = loadDataAndClean();
  const userKey = String(studentId);

  if (data.users[userKey]) {
    return res.status(400).json({
      ok: false,
      code: "DUPLICATE",
      message: "이미 인증된 사용자입니다.",
    });
  }

  const floorSeats = data.seats[floor];
  const seatInfo = floorSeats && floorSeats[seatType];

  if (!seatInfo) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_SEAT",
      message: "유효하지 않은 층/좌석입니다.",
    });
  }

  if (seatInfo.used >= seatInfo.total) {
    return res.status(400).json({
      ok: false,
      code: "FULL",
      message: "해당 좌석은 가득 찼습니다.",
    });
  }

  seatInfo.used += 1;

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
  const users = Object.values(data.users);
  res.json(users);
});

app.delete("/api/admin/users/:studentId", (req, res) => {
  const studentId = String(req.params.studentId);
  const data = loadDataAndClean();

  const user = data.users[studentId];
  if (!user) {
    return res.status(404).json({
      ok: false,
      message: "해당 사용자를 찾을 수 없습니다.",
    });
  }

  decreaseSeatUsage(data, user.floor, user.seatType);

  delete data.users[studentId];
  saveData(data);

  return res.json({
    ok: true,
    message: "사용자 삭제가 완료되었습니다.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
