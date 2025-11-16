const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "data.json");

// 좌석 유지 시간: 1시간 (밀리초)
const EXPIRE_MS = 60 * 60 * 1000;

// data.json 읽기
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("데이터 파일 읽기 실패:", e);
    return { seats: {}, users: {} };
  }
}

// data.json 저장
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// 1시간 지난 사용자 정리
function cleanExpiredUsers(data) {
  const now = Date.now();
  let changed = false;

  for (const userKey of Object.keys(data.users || {})) {
    const user = data.users[userKey];
    if (!user || !user.time) continue;

    const elapsed = now - user.time;

    if (elapsed > EXPIRE_MS) {
      const { floor, seatType } = user;

      // 사용 중인 좌석이면 used 감소
      if (
        data.seats &&
        data.seats[floor] &&
        data.seats[floor][seatType] &&
        data.seats[floor][seatType].used > 0
      ) {
        data.seats[floor][seatType].used -= 1;
      }

      // 사용자 삭제
      delete data.users[userKey];
      changed = true;
    }
  }

  if (changed) {
    saveData(data);
  }
}

// 데이터 로드 + 만료 사용자 정리
function loadDataAndClean() {
  const data = loadData();
  if (!data.seats) data.seats = {};
  if (!data.users) data.users = {};

  cleanExpiredUsers(data);
  return data;
}

// 좌석 현황 가져오기
app.get("/api/seatInfo", (req, res) => {
  const data = loadDataAndClean();
  res.json(data.seats);
});

// 로그인 및 좌석 인증
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

  // 이미 인증된 사용자
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

  // 좌석이 가득 찼는지 확인
  if (seatInfo.used >= seatInfo.total) {
    return res.status(400).json({
      ok: false,
      code: "FULL",
      message: "해당 좌석은 가득 찼습니다.",
    });
  }

  // 좌석 사용 수 +1
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

// 관리자용: 현재 인증된 사용자 목록 조회
app.get("/api/admin/users", (req, res) => {
  const data = loadDataAndClean();
  const users = Object.values(data.users || {});
  res.json(users);
});

// 관리자용: 특정 사용자 삭제
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

  const { floor, seatType } = user;

  // 좌석 사용 중이면 used 감소
  if (
    data.seats &&
    data.seats[floor] &&
    data.seats[floor][seatType] &&
    data.seats[floor][seatType].used > 0
  ) {
    data.seats[floor][seatType].used -= 1;
  }

  // 사용자 삭제
  delete data.users[studentId];

  // 변경 내용 저장
  saveData(data);

  return res.json({
    ok: true,
    message: "사용자 삭제가 완료되었습니다.",
  });
});

// 서버 실행
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
