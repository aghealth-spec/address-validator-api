import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const JUSO_API_KEY = String(
  process.env.JUSO_API_KEY || ""
).trim();
const JUSO_DETAIL_API_KEY = String(
  process.env.JUSO_DETAIL_API_KEY || ""
).trim();
const API_SECRET = String(
  process.env.API_SECRET || ""
).trim();
const ALLOWED_ORIGIN = String(
  process.env.ALLOWED_ORIGIN || "*"
).trim();

/* =========================================================
 * 기본 미들웨어
 * ======================================================= */

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const allowedOrigins = ALLOWED_ORIGIN
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Postman, curl, 서버 간 호출은 Origin이 없을 수 있습니다.
      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("허용되지 않은 Origin입니다.")
      );
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "x-api-secret"
    ]
  })
);

function checkSecret(req, res, next) {
  if (!API_SECRET) {
    return next();
  }

  const requestSecret = String(
    req.headers["x-api-secret"] || ""
  );

  if (requestSecret !== API_SECRET) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });
  }

  return next();
}

/* =========================================================
 * 공통 문자열 함수
 * ======================================================= */

function cleanAddress(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompareText(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/[()]/g, "")
    .toLowerCase();
}

/* =========================================================
 * 상세주소 정규화
 * ======================================================= */

function normalizeDetailAddress(value) {
  const raw = String(value ?? "");

  let clean = raw
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/[，,;/|]+/g, " ")
    .replace(/\s+/g, " ");

  // 3F → 3층
  clean = clean.replace(
    /(\d+)\s*[Ff]\b/g,
    "$1층"
  );

  // 지하1층 → 지하 1층
  clean = clean.replace(
    /지하\s*(\d+)\s*층/g,
    "지하 $1층"
  );

  // 101동404호 → 101동 404호
  clean = clean.replace(
    /([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호?)$/g,
    "$1 $2"
  );

  // 3층302호 → 3층 302호
  clean = clean.replace(
    /(\d+층)\s*([0-9A-Za-z]+호?)$/g,
    "$1 $2"
  );

  // 지하 1층B101호 → 지하 1층 B101호
  clean = clean.replace(
    /(지하\s*\d+층)\s*([A-Za-z]?\d+호?)$/g,
    "$1 $2"
  );

  // 숫자만 있으면 호수 처리
  if (/^\d{1,4}$/.test(clean)) {
    clean += "호";
  }

  // B동 201 → B동 201호
  // 3층 302 → 3층 302호
  clean = clean.replace(
    /([0-9A-Za-z가-힣]+동|\d+층)\s*([0-9A-Za-z]{1,6})$/g,
    "$1 $2호"
  );

  // 지하 1층 B101 → 지하 1층 B101호
  clean = clean.replace(
    /(지하\s*\d+층)\s*([A-Za-z]?\d{1,6})$/g,
    "$1 $2호"
  );

  clean = clean
    .replace(/호호/g, "호")
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw,
    clean
  };
}

/* =========================================================
 * 상세주소 패턴 분류
 * ======================================================= */

function classifyDetailAddress(detailAddress) {
  const { raw, clean } =
    normalizeDetailAddress(detailAddress);

  const compact = clean.replace(/\s+/g, "");
  const lower = compact.toLowerCase();

  const emptyValues = [
    "",
    "-",
    ".",
    "..",
    "...",
    "없음",
    "무",
    "없슴",
    "해당없음",
    "주소없음",
    "상세주소없음",
    "0",
    "00",
    "000"
  ];

  const suspiciousValues = [
    "나중에입력",
    "나중에",
    "모름",
    "가나다",
    "테스트",
    "집",
    "회사"
  ];

  const memoKeywords = [
    "문앞",
    "문 앞",
    "경비실",
    "관리실",
    "부재시",
    "부재 시",
    "전화",
    "연락",
    "택배함",
    "공동현관",
    "비밀번호",
    "현관",
    "앞에",
    "뒤에",
    "후문",
    "정문",
    "벨",
    "노크"
  ];

  if (emptyValues.includes(compact)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: "",
      detailPattern: "EMPTY_OR_SYMBOL",
      detailStatus: "SUSPICIOUS",
      detailRiskScore: 60,
      detailRiskReason:
        "상세주소가 공란 또는 무의미한 값입니다."
    };
  }

  if (suspiciousValues.includes(lower)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "SUSPICIOUS_WORD",
      detailStatus: "SUSPICIOUS",
      detailRiskScore: 60,
      detailRiskReason:
        "상세주소로 보기 어려운 단어입니다."
    };
  }

  if (
    memoKeywords.some((word) =>
      clean.includes(word)
    )
  ) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "DELIVERY_MEMO",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 30,
      detailRiskReason:
        "배송메모성 문구로 보입니다."
    };
  }

  const dongHoMatch = clean.match(
    /^([0-9A-Za-z가-힣]+)동\s*([0-9A-Za-z]+)호$/
  );

  if (dongHoMatch) {
    const dongDigits =
      dongHoMatch[1].replace(/\D/g, "");

    const hoDigits =
      dongHoMatch[2].replace(/\D/g, "");

    if (hoDigits.length >= 7) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "DONG_HO_LONG_HO",
        detailStatus: "SUSPICIOUS",
        detailRiskScore: 70,
        detailRiskReason:
          "호수 숫자 자릿수가 과도하게 깁니다."
      };
    }

    if (hoDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "DONG_HO_LONG_HO",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 35,
        detailRiskReason:
          "호수 숫자 자릿수가 일반 범위를 초과합니다."
      };
    }

    if (dongDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "DONG_HO_LONG_DONG",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 30,
        detailRiskReason:
          "동 번호 자릿수가 일반 범위를 초과합니다."
      };
    }
  }

  const floorHoMatch = clean.match(
    /^(\d+)층\s*([0-9A-Za-z]+)호$/
  );

  if (floorHoMatch) {
    const hoDigits =
      floorHoMatch[2].replace(/\D/g, "");

    if (hoDigits.length >= 7) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "FLOOR_HO_LONG_HO",
        detailStatus: "SUSPICIOUS",
        detailRiskScore: 70,
        detailRiskReason:
          "호수 숫자 자릿수가 과도하게 깁니다."
      };
    }

    if (hoDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "FLOOR_HO_LONG_HO",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 35,
        detailRiskReason:
          "호수 숫자 자릿수가 일반 범위를 초과합니다."
      };
    }
  }

  const hoOnlyMatch = clean.match(
    /^([0-9A-Za-z]+)호$/
  );

  if (hoOnlyMatch) {
    const hoDigits =
      hoOnlyMatch[1].replace(/\D/g, "");

    if (hoDigits.length >= 7) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "HO_ONLY_LONG_HO",
        detailStatus: "SUSPICIOUS",
        detailRiskScore: 70,
        detailRiskReason:
          "호수 숫자 자릿수가 과도하게 깁니다."
      };
    }

    if (hoDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern:
          "HO_ONLY_LONG_HO",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 35,
        detailRiskReason:
          "호수 숫자 자릿수가 일반 범위를 초과합니다."
      };
    }
  }

  if (
    /^[0-9A-Za-z가-힣]+동\s*[0-9A-Za-z]+호$/.test(
      clean
    )
  ) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "DONG_HO",
      detailStatus: "NORMAL",
      detailRiskScore: 0,
      detailRiskReason: "동/호 패턴 정상"
    };
  }

  if (
    /^\d+층\s*[0-9A-Za-z]+호$/.test(
      clean
    )
  ) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "FLOOR_HO",
      detailStatus: "NORMAL",
      detailRiskScore: 0,
      detailRiskReason: "층/호 패턴 정상"
    };
  }

  if (
    /^지하\s*\d+층\s*[A-Za-z]?\d+호$/.test(
      clean
    )
  ) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern:
        "BASEMENT_FLOOR_HO",
      detailStatus: "NORMAL",
      detailRiskScore: 0,
      detailRiskReason:
        "지하층/호 패턴 정상"
    };
  }

  if (/^[0-9A-Za-z]+호$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "HO_ONLY",
      detailStatus: "NORMAL",
      detailRiskScore: 5,
      detailRiskReason: "호수 패턴 확인"
    };
  }

  if (
    /^[0-9A-Za-z가-힣]+동$/.test(clean)
  ) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "DONG_ONLY",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 30,
      detailRiskReason:
        "동 정보만 있고 호수가 없습니다."
    };
  }

  if (/^\d+층$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "FLOOR_ONLY",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 25,
      detailRiskReason:
        "층 정보만 있고 호수가 없습니다."
    };
  }

  if (
    /^지하\s*\d+층$/.test(clean)
  ) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern:
        "BASEMENT_FLOOR_ONLY",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 25,
      detailRiskReason:
        "지하층 정보만 있고 호수가 없습니다."
    };
  }

  if (!/\d/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "NO_NUMBER",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 40,
      detailRiskReason:
        "숫자 정보가 없어 확인이 필요합니다."
    };
  }

  return {
    detailAddressRaw: raw,
    detailAddressClean: clean,
    detailPattern: "UNKNOWN",
    detailStatus: "CHECK_REQUIRED",
    detailRiskScore: 20,
    detailRiskReason:
      "정의되지 않은 상세주소 패턴입니다."
  };
}

/* =========================================================
 * 상세주소 검색정보 추출
 * 현재는 호수가 아닌 층만 검증합니다.
 * ======================================================= */

function extractDetailSearchInfo(
  cleanDetailAddress
) {
  const clean = String(
    cleanDetailAddress || ""
  ).trim();

  let match = clean.match(
    /^(\d+)층\s*([0-9A-Za-z]+호)$/
  );

  if (match) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: `${match[1]}층`,
      targetFloorNo: match[1],
      targetHo: match[2],
      targetDetail: clean,
      compareMode: "FLOOR_ONLY"
    };
  }

  match = clean.match(/^(\d+)층$/);

  if (match) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: `${match[1]}층`,
      targetFloorNo: match[1],
      targetHo: "",
      targetDetail: clean,
      compareMode: "FLOOR_ONLY"
    };
  }

  match = clean.match(
    /^지하\s*(\d+)층\s*([A-Za-z]?\d+호)$/
  );

  if (match) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: `지하 ${match[1]}층`,
      targetFloorNo: `B${match[1]}`,
      targetHo: match[2],
      targetDetail: clean,
      compareMode: "FLOOR_ONLY"
    };
  }

  match = clean.match(
    /^지하\s*(\d+)층$/
  );

  if (match) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: `지하 ${match[1]}층`,
      targetFloorNo: `B${match[1]}`,
      targetHo: "",
      targetDetail: clean,
      compareMode: "FLOOR_ONLY"
    };
  }

  match = clean.match(
    /^([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호)$/
  );

  if (match) {
    return {
      searchType: "",
      dongNm: match[1],
      targetFloor: "",
      targetFloorNo: "",
      targetHo: match[2],
      targetDetail: clean,
      compareMode: "DONG_HO_SKIP"
    };
  }

  match = clean.match(
    /^([0-9A-Za-z]+호)$/
  );

  if (match) {
    return {
      searchType: "",
      dongNm: "",
      targetFloor: "",
      targetFloorNo: "",
      targetHo: match[1],
      targetDetail: clean,
      compareMode: "HO_ONLY_SKIP"
    };
  }

  return {
    searchType: "",
    dongNm: "",
    targetFloor: "",
    targetFloorNo: "",
    targetHo: "",
    targetDetail: clean,
    compareMode: "NOT_SUPPORTED"
  };
}

/* =========================================================
 * Juso 기본주소 API
 * ======================================================= */

async function searchJuso(keyword) {
  const url = new URL(
    "https://business.juso.go.kr/addrlink/addrLinkApi.do"
  );

  url.searchParams.set(
    "confmKey",
    JUSO_API_KEY
  );
  url.searchParams.set(
    "currentPage",
    "1"
  );
  url.searchParams.set(
    "countPerPage",
    "5"
  );
  url.searchParams.set(
    "keyword",
    keyword
  );
  url.searchParams.set(
    "resultType",
    "json"
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",
      signal:
        AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Juso API HTTP Error: ${response.status}`
    );
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Juso API JSON 파싱 실패: ${text.slice(0, 200)}`
    );
  }
}

function createEmptyJusoResult(
  inputAddress,
  orderNo,
  status,
  message
) {
  return {
    orderNo,
    inputAddress,
    jusoMatch: false,
    matchCount: 0,
    roadAddr: "",
    roadAddrPart1: "",
    jibunAddr: "",
    zipNo: "",
    admCd: "",
    rnMgtSn: "",
    udrtYn: "",
    buldMnnm: "",
    buldSlno: "",
    bdMgtSn: "",
    mtYn: "",
    lnbrMnnm: "",
    lnbrSlno: "",
    siNm: "",
    sggNm: "",
    emdNm: "",
    status,
    message
  };
}

function parseJusoResult(
  inputAddress,
  orderNo,
  data
) {
  const common =
    data?.results?.common || {};

  const juso = Array.isArray(
    data?.results?.juso
  )
    ? data.results.juso
    : [];

  const totalCount = Number(
    common.totalCount || 0
  );

  const errorCode = String(
    common.errorCode || ""
  );

  const errorMessage = String(
    common.errorMessage || ""
  );

  if (
    errorCode &&
    errorCode !== "0"
  ) {
    return createEmptyJusoResult(
      inputAddress,
      orderNo,
      "JUSO_API_ERROR",
      errorMessage || "Juso API 오류"
    );
  }

  if (
    juso.length === 0 ||
    totalCount === 0
  ) {
    return createEmptyJusoResult(
      inputAddress,
      orderNo,
      "BASE_ADDR_ERROR",
      "Juso 검색 결과 없음"
    );
  }

  const first = juso[0];

  return {
    orderNo,
    inputAddress,
    jusoMatch: true,
    matchCount: totalCount,

    roadAddr:
      first.roadAddr || "",
    roadAddrPart1:
      first.roadAddrPart1 || "",
    jibunAddr:
      first.jibunAddr || "",
    zipNo:
      first.zipNo || "",

    admCd:
      first.admCd || "",
    rnMgtSn:
      first.rnMgtSn || "",
    udrtYn:
      first.udrtYn || "",
    buldMnnm:
      first.buldMnnm || "",
    buldSlno:
      first.buldSlno || "0",
    bdMgtSn:
      first.bdMgtSn || "",

    mtYn:
      first.mtYn || "",
    lnbrMnnm:
      first.lnbrMnnm || "",
    lnbrSlno:
      first.lnbrSlno || "",

    siNm:
      first.siNm || "",
    sggNm:
      first.sggNm || "",
    emdNm:
      first.emdNm || "",

    status:
      totalCount === 1
        ? "NORMAL"
        : "MULTIPLE_MATCH",

    message:
      totalCount === 1
        ? "Juso 검색 결과 1건"
        : `Juso 검색 결과 ${totalCount}건`
  };
}

/* =========================================================
 * Juso 상세주소 API
 * ======================================================= */

async function searchJusoDetail(
  jusoResult,
  detailResult
) {
  if (!JUSO_DETAIL_API_KEY) {
    return {
      jusoDetailChecked: false,
      jusoDetailMatch: null,
      jusoDetailStatus:
        "DETAIL_API_KEY_MISSING",
      jusoDetailReason:
        "JUSO_DETAIL_API_KEY가 설정되지 않았습니다.",
      jusoDetailCandidates: []
    };
  }

  if (
    !jusoResult.admCd ||
    !jusoResult.rnMgtSn ||
    jusoResult.udrtYn === "" ||
    !jusoResult.buldMnnm
  ) {
    return {
      jusoDetailChecked: false,
      jusoDetailMatch: null,
      jusoDetailStatus:
        "DETAIL_REQUIRED_PARAMS_MISSING",
      jusoDetailReason:
        "상세주소 API 호출 파라미터가 부족합니다.",
      jusoDetailCandidates: []
    };
  }

  const detail =
    extractDetailSearchInfo(
      detailResult.detailAddressClean
    );

  if (!detail.searchType) {
    return {
      jusoDetailChecked: false,
      jusoDetailMatch: null,
      jusoDetailStatus:
        "DETAIL_PATTERN_NOT_SUPPORTED",
      jusoDetailReason:
        "층 정보를 추출할 수 없어 상세주소 API 대조를 수행하지 않았습니다.",
      jusoDetailCandidates: []
    };
  }

  const url = new URL(
    "https://business.juso.go.kr/addrlink/addrDetailApi.do"
  );

  url.searchParams.set(
    "confmKey",
    JUSO_DETAIL_API_KEY
  );
  url.searchParams.set(
    "admCd",
    jusoResult.admCd
  );
  url.searchParams.set(
    "rnMgtSn",
    jusoResult.rnMgtSn
  );
  url.searchParams.set(
    "udrtYn",
    jusoResult.udrtYn
  );
  url.searchParams.set(
    "buldMnnm",
    jusoResult.buldMnnm
  );
  url.searchParams.set(
    "buldSlno",
    jusoResult.buldSlno || "0"
  );
  url.searchParams.set(
    "searchType",
    detail.searchType
  );
  url.searchParams.set(
    "resultType",
    "json"
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",
      signal:
        AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Juso Detail API HTTP Error: ${response.status}`
    );
  }

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Juso Detail API JSON 파싱 실패: ${text.slice(0, 200)}`
    );
  }

  return parseJusoDetailResult(
    data,
    detail
  );
}

function getJusoDetailList(results) {
  const possibleLists = [
    results?.juso,
    results?.addrDetail,
    results?.detail,
    results?.floors,
    results?.floorho,
    results?.detailList
  ];

  return (
    possibleLists.find(
      (value) => Array.isArray(value)
    ) || []
  );
}

function parseJusoDetailResult(
  data,
  detail
) {
  const results =
    data?.results || {};

  const common =
    results?.common || {};

  const detailList =
    getJusoDetailList(results);

  const errorCode = String(
    common.errorCode || ""
  );

  const errorMessage = String(
    common.errorMessage || ""
  );

  const totalCount = Number(
    common.totalCount ||
      detailList.length ||
      0
  );

  if (
    errorCode &&
    errorCode !== "0"
  ) {
    return {
      jusoDetailChecked: true,
      jusoDetailMatch: false,
      jusoDetailStatus:
        "DETAIL_API_ERROR",
      jusoDetailReason:
        errorMessage ||
        "상세주소 API 오류",
      jusoDetailCandidates: []
    };
  }

  const candidates = detailList.map(
    (row) => {
      const values = Object.values(
        row
      )
        .filter(
          (value) =>
            typeof value === "string" ||
            typeof value === "number"
        )
        .map((value) =>
          String(value).trim()
        )
        .filter(Boolean);

      return {
        raw: row,
        text: values.join(" ")
      };
    }
  );

  const targetFloor =
    normalizeCompareText(
      detail.targetFloor
    );

  const targetFloorNo =
    normalizeCompareText(
      detail.targetFloorNo
    );

  const matchedCandidates =
    candidates.filter((candidate) => {
      const candidateText =
        normalizeCompareText(
          candidate.text
        );

      if (
        !targetFloor &&
        !targetFloorNo
      ) {
        return false;
      }

      return (
        candidateText.includes(
          targetFloor
        ) ||
        candidateText.includes(
          `${targetFloorNo}층`
        ) ||
        candidateText.includes(
          `floor${targetFloorNo}`
        ) ||
        candidateText.includes(
          `fl${targetFloorNo}`
        ) ||
        candidateText.includes(
          `층${targetFloorNo}`
        )
      );
    });

  if (matchedCandidates.length > 0) {
    return {
      jusoDetailChecked: true,
      jusoDetailMatch: true,
      jusoDetailStatus:
        "FLOOR_MATCHED",
      jusoDetailReason:
        "Juso 상세주소 API 후보에서 입력한 층 정보가 확인되었습니다. 호수는 검증하지 않았습니다.",
      jusoDetailCandidates:
        candidates.slice(0, 20),
      jusoDetailMatchedCandidates:
        matchedCandidates.slice(0, 20),
      jusoDetailTotalCount:
        totalCount
    };
  }

  if (totalCount === 0) {
    return {
      jusoDetailChecked: true,
      jusoDetailMatch: false,
      jusoDetailStatus:
        "DETAIL_LIST_NOT_PROVIDED",
      jusoDetailReason:
        "해당 건물은 Juso 상세주소 후보 리스트를 제공하지 않습니다.",
      jusoDetailCandidates: [],
      jusoDetailMatchedCandidates: [],
      jusoDetailTotalCount: 0
    };
  }

  return {
    jusoDetailChecked: true,
    jusoDetailMatch: false,
    jusoDetailStatus:
      "FLOOR_NOT_FOUND",
    jusoDetailReason:
      "Juso 상세주소 API 후보에서 입력한 층 정보를 찾지 못했습니다. 호수는 검증하지 않았습니다.",
    jusoDetailCandidates:
      candidates.slice(0, 20),
    jusoDetailMatchedCandidates: [],
    jusoDetailTotalCount:
      totalCount
  };
}

/* =========================================================
 * 기본 위험도 및 상태 계산
 * ======================================================= */

function buildFinalResult(
  jusoResult,
  detailResult
) {
  const jusoRiskScore =
    [
      "BASE_ADDR_ERROR",
      "JUSO_API_ERROR",
      "REQUEST_ERROR",
      "EMPTY_ADDRESS"
    ].includes(jusoResult.status)
      ? 100
      : jusoResult.status ===
          "MULTIPLE_MATCH"
        ? 20
        : 0;

  const finalRiskScore =
    jusoRiskScore +
    detailResult.detailRiskScore;

  let finalStatus = "NORMAL";

  if (
    [
      "BASE_ADDR_ERROR",
      "EMPTY_ADDRESS"
    ].includes(jusoResult.status)
  ) {
    finalStatus = "BASE_ADDR_ERROR";
  } else if (
    [
      "JUSO_API_ERROR",
      "REQUEST_ERROR"
    ].includes(jusoResult.status)
  ) {
    finalStatus = "JUSO_API_ERROR";
  } else if (
    detailResult.detailStatus ===
    "SUSPICIOUS"
  ) {
    finalStatus = "SUSPICIOUS";
  } else if (
    jusoResult.status ===
      "MULTIPLE_MATCH" ||
    detailResult.detailStatus ===
      "CHECK_REQUIRED"
  ) {
    finalStatus = "CHECK_REQUIRED";
  }

  return {
    ...jusoResult,
    ...detailResult,
    finalRiskScore,
    finalStatus
  };
}

function buildFinalResultWithDetailApi(
  jusoResult,
  detailResult,
  detailApiResult
) {
  const base = buildFinalResult(
    jusoResult,
    detailResult
  );

  let extraRisk = 0;
  let finalStatus =
    base.finalStatus;
  let detailStatus =
    detailResult.detailStatus;
  let detailRiskScore =
    detailResult.detailRiskScore;
  let detailRiskReason =
    detailResult.detailRiskReason;

  // 후보 목록 미제공은 주소 불일치가 아닙니다.
  if (
    detailApiResult.jusoDetailStatus ===
    "DETAIL_LIST_NOT_PROVIDED"
  ) {
    return {
      ...base,
      ...detailApiResult,
      finalStatus:
        base.finalStatus,
      finalRiskScore:
        base.finalRiskScore
    };
  }

  // 층 확인 성공
  if (
    detailApiResult.jusoDetailStatus ===
    "FLOOR_MATCHED"
  ) {
    if (
      [
        "FLOOR_HO",
        "BASEMENT_FLOOR_HO",
        "FLOOR_ONLY",
        "BASEMENT_FLOOR_ONLY"
      ].includes(
        detailResult.detailPattern
      )
    ) {
      detailStatus = "NORMAL";
      detailRiskScore = 0;
      detailRiskReason =
        "층 정보가 확인되었습니다. 호수는 검증하지 않았습니다.";
    }

    if (
      jusoResult.status === "NORMAL"
    ) {
      finalStatus = "NORMAL";
    }

    return {
      ...base,
      detailStatus,
      detailRiskScore,
      detailRiskReason,
      ...detailApiResult,
      finalRiskScore:
        jusoResult.status === "NORMAL"
          ? 0
          : base.finalRiskScore,
      finalStatus
    };
  }

  // 후보가 있는데 입력 층이 없는 경우만 추가 위험
  if (
    detailApiResult.jusoDetailStatus ===
      "FLOOR_NOT_FOUND" &&
    [
      "FLOOR_HO",
      "BASEMENT_FLOOR_HO",
      "FLOOR_ONLY",
      "BASEMENT_FLOOR_ONLY"
    ].includes(
      detailResult.detailPattern
    )
  ) {
    extraRisk = 40;

    if (
      base.finalStatus === "NORMAL"
    ) {
      finalStatus =
        "CHECK_REQUIRED";
    }

    detailStatus =
      "CHECK_REQUIRED";

    detailRiskScore =
      detailResult.detailRiskScore +
      extraRisk;

    detailRiskReason =
      "형식은 정상이나 Juso 상세주소 API에서 해당 층이 확인되지 않았습니다.";
  }

  return {
    ...base,
    detailStatus,
    detailRiskScore,
    detailRiskReason,
    ...detailApiResult,
    finalRiskScore:
      base.finalRiskScore +
      extraRisk,
    finalStatus
  };
}

/* =========================================================
 * 검증 요약
 * ======================================================= */

function buildVerificationSummary(
  jusoResult,
  detailResult,
  detailApiResult
) {
  const buildingVerified =
    jusoResult.jusoMatch === true &&
    jusoResult.status === "NORMAL";

  const detailFormatValid =
    detailResult.detailStatus ===
    "NORMAL";

  const detailDataProvided =
    detailApiResult.jusoDetailStatus !==
      "DETAIL_LIST_NOT_PROVIDED" &&
    Array.isArray(
      detailApiResult
        .jusoDetailCandidates
    ) &&
    detailApiResult
      .jusoDetailCandidates.length > 0;

  const floorVerified =
    detailApiResult.jusoDetailStatus ===
      "FLOOR_MATCHED" &&
    detailApiResult.jusoDetailMatch ===
      true;

  // 현재 Juso 상세 API에서는 호수 실존 여부를 검증하지 않습니다.
  const unitVerified = false;

  let verificationStatus =
    "NOT_VERIFIED";

  let verificationReason =
    "주소 검증이 완료되지 않았습니다.";

  if (
    [
      "JUSO_API_ERROR",
      "REQUEST_ERROR"
    ].includes(jusoResult.status)
  ) {
    verificationStatus =
      "API_ERROR";

    verificationReason =
      "Juso 기본주소 API 요청 또는 응답 오류입니다.";
  } else if (
    [
      "BASE_ADDR_ERROR",
      "EMPTY_ADDRESS"
    ].includes(jusoResult.status) ||
    jusoResult.jusoMatch !== true
  ) {
    verificationStatus =
      "BASE_ADDR_ERROR";

    verificationReason =
      "기본주소를 확인하지 못했습니다.";
  } else if (
    jusoResult.status ===
    "MULTIPLE_MATCH"
  ) {
    verificationStatus =
      "MULTIPLE_MATCH";

    verificationReason =
      "기본주소 검색 결과가 여러 건이어서 주소를 확정하지 못했습니다.";
  } else if (floorVerified) {
    verificationStatus =
      "VERIFIED_FLOOR";

    verificationReason =
      "기본 건물과 입력 층이 확인되었습니다. 호수는 검증하지 않았습니다.";
  } else if (
    detailApiResult.jusoDetailStatus ===
    "DETAIL_LIST_NOT_PROVIDED"
  ) {
    verificationStatus =
      "BUILDING_VERIFIED_DETAIL_UNAVAILABLE";

    verificationReason =
      "기본 건물은 확인됐지만 Juso 상세주소 API가 층·호 후보 데이터를 제공하지 않았습니다.";
  } else if (
    detailApiResult.jusoDetailStatus ===
    "FLOOR_NOT_FOUND"
  ) {
    verificationStatus =
      "CHECK_REQUIRED";

    verificationReason =
      "기본 건물은 확인됐지만 상세주소 API 후보에서 입력 층을 찾지 못했습니다.";
  } else if (
    [
      "DETAIL_REQUEST_ERROR",
      "DETAIL_API_ERROR"
    ].includes(
      detailApiResult.jusoDetailStatus
    )
  ) {
    verificationStatus =
      "BUILDING_VERIFIED_DETAIL_API_ERROR";

    verificationReason =
      "기본 건물은 확인됐지만 상세주소 API 요청 또는 응답 오류가 발생했습니다.";
  } else if (
    [
      "DETAIL_PATTERN_NOT_SUPPORTED",
      "NOT_CHECKED",
      "DETAIL_API_KEY_MISSING",
      "DETAIL_REQUIRED_PARAMS_MISSING"
    ].includes(
      detailApiResult.jusoDetailStatus
    )
  ) {
    verificationStatus =
      detailFormatValid
        ? "VERIFIED_BUILDING"
        : "BUILDING_VERIFIED_DETAIL_CHECK_REQUIRED";

    verificationReason =
      detailFormatValid
        ? "기본 건물과 상세주소 형식은 확인됐지만 층·호 실존 여부는 검증하지 않았습니다."
        : "기본 건물은 확인됐지만 상세주소 형식 또는 검증 범위를 확인해야 합니다.";
  } else {
    verificationStatus =
      buildingVerified
        ? "VERIFIED_BUILDING"
        : "NOT_VERIFIED";

    verificationReason =
      buildingVerified
        ? "기본 건물은 확인됐지만 상세주소 실존 여부는 확인되지 않았습니다."
        : "주소를 확인하지 못했습니다.";
  }

  return {
    buildingVerified,
    detailFormatValid,
    detailDataProvided,
    floorVerified,
    unitVerified,
    verificationStatus,
    verificationReason,
    verificationScope: {
      building:
        "JUSO_BASIC_ADDRESS",
      floor:
        "JUSO_DETAIL_FLOOR_ONLY",
      unit:
        "NOT_VERIFIED"
    }
  };
}

/* =========================================================
 * 기본 및 상태 확인 API
 * ======================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service:
      "address-validator-api",
    step: 1,
    message:
      "Address validator API is running"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service:
      "address-validator-api",
    step: 1,
    timestamp:
      new Date().toISOString()
  });
});

/* =========================================================
 * 상세주소 후보 확인용 디버그 API
 * ======================================================= */

app.post(
  "/debug-juso-detail-list",
  checkSecret,
  async (req, res) => {
    try {
      if (!JUSO_API_KEY) {
        return res.status(500).json({
          ok: false,
          message:
            "JUSO_API_KEY가 설정되지 않았습니다."
        });
      }

      if (!JUSO_DETAIL_API_KEY) {
        return res.status(500).json({
          ok: false,
          message:
            "JUSO_DETAIL_API_KEY가 설정되지 않았습니다."
        });
      }

      const baseAddress =
        cleanAddress(
          req.body?.baseAddress
        );

      const detailAddress =
        String(
          req.body?.detailAddress ||
            ""
        ).trim();

      if (!baseAddress) {
        return res.status(400).json({
          ok: false,
          message:
            "baseAddress가 필요합니다."
        });
      }

      const jusoData =
        await searchJuso(
          baseAddress
        );

      const jusoResult =
        parseJusoResult(
          baseAddress,
          "DEBUG",
          jusoData
        );

      if (
        jusoResult.status !==
        "NORMAL"
      ) {
        return res.json({
          ok: true,
          baseAddress,
          detailAddress,
          jusoResult,
          message:
            "기본주소가 NORMAL 상태가 아니어서 상세주소 후보 조회를 중단했습니다."
        });
      }

      const detailResult =
        classifyDetailAddress(
          detailAddress || "1호"
        );

      const detail =
        extractDetailSearchInfo(
          detailResult
            .detailAddressClean
        );

      if (!detail.searchType) {
        const detailApiResult = {
          jusoDetailChecked: false,
          jusoDetailMatch: null,
          jusoDetailStatus:
            "DETAIL_PATTERN_NOT_SUPPORTED",
          jusoDetailReason:
            "층 정보를 추출할 수 없어 상세주소 API를 호출하지 않았습니다.",
          jusoDetailCandidates: []
        };

        return res.json({
          ok: true,
          baseAddress,
          detailAddress,
          jusoResult,
          detailResult,
          detailSearchInfo: detail,
          ...detailApiResult,
          verification:
            buildVerificationSummary(
              jusoResult,
              detailResult,
              detailApiResult
            )
        });
      }

      const url = new URL(
        "https://business.juso.go.kr/addrlink/addrDetailApi.do"
      );

      url.searchParams.set(
        "confmKey",
        JUSO_DETAIL_API_KEY
      );
      url.searchParams.set(
        "admCd",
        jusoResult.admCd
      );
      url.searchParams.set(
        "rnMgtSn",
        jusoResult.rnMgtSn
      );
      url.searchParams.set(
        "udrtYn",
        jusoResult.udrtYn
      );
      url.searchParams.set(
        "buldMnnm",
        jusoResult.buldMnnm
      );
      url.searchParams.set(
        "buldSlno",
        jusoResult.buldSlno || "0"
      );
      url.searchParams.set(
        "searchType",
        detail.searchType
      );
      url.searchParams.set(
        "resultType",
        "json"
      );

      const response = await fetch(
        url.toString(),
        {
          method: "GET",
          signal:
            AbortSignal.timeout(10000)
        }
      );

      if (!response.ok) {
        throw new Error(
          `Juso Detail API HTTP Error: ${response.status}`
        );
      }

      const rawDetailData =
        await response.json();

      const rawResults =
        rawDetailData?.results || {};

      const common =
        rawResults?.common || {};

      const detailList =
        getJusoDetailList(
          rawResults
        );

      const candidates =
        detailList.map((row) => {
          const values =
            Object.values(row)
              .filter(
                (value) =>
                  typeof value ===
                    "string" ||
                  typeof value ===
                    "number"
              )
              .map((value) =>
                String(value).trim()
              )
              .filter(Boolean);

          return {
            raw: row,
            text: values.join(" ")
          };
        });

      const targetFloor =
        normalizeCompareText(
          detail.targetFloor
        );

      const targetFloorNo =
        normalizeCompareText(
          detail.targetFloorNo
        );

      const matchedCandidates =
        candidates.filter(
          (candidate) => {
            const candidateText =
              normalizeCompareText(
                candidate.text
              );

            return (
              candidateText.includes(
                targetFloor
              ) ||
              candidateText.includes(
                `${targetFloorNo}층`
              ) ||
              candidateText.includes(
                `floor${targetFloorNo}`
              ) ||
              candidateText.includes(
                `fl${targetFloorNo}`
              ) ||
              candidateText.includes(
                `층${targetFloorNo}`
              )
            );
          }
        );

      const detailApiResult =
        parseJusoDetailResult(
          rawDetailData,
          detail
        );

      return res.json({
        ok: true,
        baseAddress,
        detailAddress,
        jusoResult,
        detailResult,
        detailSearchInfo: detail,

        detailApiRequestParams: {
          admCd:
            jusoResult.admCd,
          rnMgtSn:
            jusoResult.rnMgtSn,
          udrtYn:
            jusoResult.udrtYn,
          buldMnnm:
            jusoResult.buldMnnm,
          buldSlno:
            jusoResult.buldSlno ||
            "0",
          searchType:
            detail.searchType
        },

        detailApiCommon: common,
        candidateCount:
          candidates.length,
        matchedCount:
          matchedCandidates.length,
        matchedCandidates,
        candidates,
        rawDetailData,

        verification:
          buildVerificationSummary(
            jusoResult,
            detailResult,
            detailApiResult
          )
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }
);

/* =========================================================
 * 주소 일괄 검증 API
 * ======================================================= */

app.post(
  "/validate-addresses",
  checkSecret,
  async (req, res) => {
    try {
      if (!JUSO_API_KEY) {
        return res.status(500).json({
          ok: false,
          message:
            "JUSO_API_KEY가 설정되지 않았습니다."
        });
      }

      const items = Array.isArray(
        req.body?.items
      )
        ? req.body.items
        : [];

      if (items.length === 0) {
        return res.status(400).json({
          ok: false,
          message:
            "items 배열이 필요합니다."
        });
      }

      if (items.length > 50) {
        return res.status(400).json({
          ok: false,
          message:
            "테스트 단계에서는 한 번에 최대 50건까지만 허용합니다."
        });
      }

      const results = [];

      for (const item of items) {
        const orderNo =
          String(
            item?.orderNo || ""
          ).trim();

        const inputAddress =
          cleanAddress(
            item?.baseAddress
          );

        const detailResult =
          classifyDetailAddress(
            item?.detailAddress
          );

        if (!inputAddress) {
          const jusoResult =
            createEmptyJusoResult(
              inputAddress,
              orderNo,
              "EMPTY_ADDRESS",
              "주소값 없음"
            );

          const detailApiResult = {
            jusoDetailChecked: false,
            jusoDetailMatch: null,
            jusoDetailStatus:
              "NOT_CHECKED",
            jusoDetailReason:
              "기본주소가 없어 상세주소 API 대조를 수행하지 않았습니다.",
            jusoDetailCandidates: []
          };

          results.push({
            ...jusoResult,
            ...detailResult,
            ...detailApiResult,
            finalRiskScore:
              100 +
              detailResult
                .detailRiskScore,
            finalStatus:
              "BASE_ADDR_ERROR",
            verification:
              buildVerificationSummary(
                jusoResult,
                detailResult,
                detailApiResult
              )
          });

          continue;
        }

        try {
          const data =
            await searchJuso(
              inputAddress
            );

          const jusoResult =
            parseJusoResult(
              inputAddress,
              orderNo,
              data
            );

          let detailApiResult = {
            jusoDetailChecked: false,
            jusoDetailMatch: null,
            jusoDetailStatus:
              "NOT_CHECKED",
            jusoDetailReason:
              "상세주소 API 대조를 수행하지 않았습니다.",
            jusoDetailCandidates: []
          };

          if (
            jusoResult.status ===
              "NORMAL" &&
            [
              "FLOOR_HO",
              "BASEMENT_FLOOR_HO",
              "FLOOR_ONLY",
              "BASEMENT_FLOOR_ONLY"
            ].includes(
              detailResult
                .detailPattern
            )
          ) {
            try {
              detailApiResult =
                await searchJusoDetail(
                  jusoResult,
                  detailResult
                );
            } catch (
              detailError
            ) {
              detailApiResult = {
                jusoDetailChecked: true,
                jusoDetailMatch: false,
                jusoDetailStatus:
                  "DETAIL_REQUEST_ERROR",
                jusoDetailReason:
                  detailError instanceof
                  Error
                    ? detailError.message
                    : String(
                        detailError
                      ),
                jusoDetailCandidates: []
              };
            }
          }

          const finalResult =
            buildFinalResultWithDetailApi(
              jusoResult,
              detailResult,
              detailApiResult
            );

          const verification =
            buildVerificationSummary(
              jusoResult,
              detailResult,
              detailApiResult
            );

          results.push({
            ...finalResult,
            verification
          });
        } catch (error) {
          const jusoResult =
            createEmptyJusoResult(
              inputAddress,
              orderNo,
              "REQUEST_ERROR",
              error instanceof Error
                ? error.message
                : String(error)
            );

          const detailApiResult = {
            jusoDetailChecked: false,
            jusoDetailMatch: null,
            jusoDetailStatus:
              "NOT_CHECKED",
            jusoDetailReason:
              "Juso 기본주소 요청 오류로 상세주소 API 대조를 수행하지 않았습니다.",
            jusoDetailCandidates: []
          };

          results.push({
            ...jusoResult,
            ...detailResult,
            ...detailApiResult,
            finalRiskScore:
              100 +
              detailResult
                .detailRiskScore,
            finalStatus:
              "JUSO_API_ERROR",
            verification:
              buildVerificationSummary(
                jusoResult,
                detailResult,
                detailApiResult
              )
          });
        }
      }

      return res.json({
        ok: true,
        count: results.length,
        results
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }
);

/* =========================================================
 * 공통 오류 처리
 * ======================================================= */

app.use(
  (error, req, res, next) => {
    console.error(error);

    if (
      error?.message ===
      "허용되지 않은 Origin입니다."
    ) {
      return res.status(403).json({
        ok: false,
        message: error.message
      });
    }

    return res.status(500).json({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "서버 내부 오류가 발생했습니다."
    });
  }
);

/* =========================================================
 * Railway 서버 실행
 * ======================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Address validator API running on port ${PORT}`
    );
  }
);
