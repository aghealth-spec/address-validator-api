import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const JUSO_API_KEY = process.env.JUSO_API_KEY;
const JUSO_DETAIL_API_KEY = process.env.JUSO_DETAIL_API_KEY;
const API_SECRET = process.env.API_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-api-secret"]
  })
);

function checkSecret(req, res, next) {
  if (!API_SECRET) return next();

  const secret = req.headers["x-api-secret"];

  if (secret !== API_SECRET) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });
  }

  next();
}

function cleanAddress(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompareText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/[()]/g, "")
    .toLowerCase();
}

/**
 * 상세주소 정규화
 */
function normalizeDetailAddress(value) {
  const raw = String(value || "");

  let clean = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[，,\/|]+/g, " ")
    .replace(/\s+/g, " ");

  // 3F, 3f → 3층
  clean = clean.replace(/(\d+)\s*[Ff]\b/g, "$1층");

  // 지하1층 → 지하 1층
  clean = clean.replace(/지하\s*(\d+)층/g, "지하 $1층");

  // 101동1203호 → 101동 1203호
  clean = clean.replace(/([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호?)$/g, "$1 $2");

  // B동201호 → B동 201호
  clean = clean.replace(/([A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호?)$/g, "$1 $2");

  // 3층302호 → 3층 302호
  clean = clean.replace(/(\d+층)\s*([0-9A-Za-z]+호?)$/g, "$1 $2");

  // 지하 1층B101호 → 지하 1층 B101호
  clean = clean.replace(/(지하\s*\d+층)\s*([A-Za-z]?\d+호?)$/g, "$1 $2");

  // 숫자만 있으면 호수로 보정: 302 → 302호
  if (/^\d{1,4}$/.test(clean)) {
    clean = clean + "호";
  }

  // "B동 201" → "B동 201호", "3층 302" → "3층 302호"
  clean = clean.replace(/(동|층)\s*(\d{1,4})$/g, "$1 $2호");

  // "지하 1층 B101" → "지하 1층 B101호"
  clean = clean.replace(/(지하\s*\d+층)\s*([A-Za-z]?\d{1,4})$/g, "$1 $2호");

  // 중복 보정
  clean = clean.replace(/호호/g, "호");

  return {
    raw,
    clean
  };
}

/**
 * 상세주소 패턴 분류
 */
function classifyDetailAddress(detailAddress) {
  const { raw, clean } = normalizeDetailAddress(detailAddress);

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
      detailRiskReason: "상세주소가 공란 또는 무의미한 값입니다."
    };
  }

  if (suspiciousValues.includes(lower)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "SUSPICIOUS_WORD",
      detailStatus: "SUSPICIOUS",
      detailRiskScore: 60,
      detailRiskReason: "상세주소로 보기 어려운 단어입니다."
    };
  }

  if (memoKeywords.some((word) => clean.includes(word))) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "DELIVERY_MEMO",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 30,
      detailRiskReason: "배송메모성 문구로 보입니다."
    };
  }

  const dongHoMatch = clean.match(/^([0-9A-Za-z가-힣]+)동\s*([0-9A-Za-z]+)호$/);

  if (dongHoMatch) {
    const dongPart = dongHoMatch[1];
    const hoPart = dongHoMatch[2];

    const dongDigits = dongPart.replace(/\D/g, "");
    const hoDigits = hoPart.replace(/\D/g, "");

    if (hoDigits.length >= 7) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "DONG_HO_LONG_HO",
        detailStatus: "SUSPICIOUS",
        detailRiskScore: 70,
        detailRiskReason: "호수 숫자 자릿수가 과도하게 길어 의심주소로 분류되었습니다."
      };
    }

    if (hoDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "DONG_HO_LONG_HO",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 35,
        detailRiskReason: "호수 숫자 자릿수가 일반 범위를 초과하여 확인이 필요합니다."
      };
    }

    if (dongDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "DONG_HO_LONG_DONG",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 30,
        detailRiskReason: "동 번호 자릿수가 일반 범위를 초과하여 확인이 필요합니다."
      };
    }
  }

  const floorHoMatch = clean.match(/^(\d+)층\s*([0-9A-Za-z]+)호$/);

  if (floorHoMatch) {
    const hoPart = floorHoMatch[2];
    const hoDigits = hoPart.replace(/\D/g, "");

    if (hoDigits.length >= 7) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "FLOOR_HO_LONG_HO",
        detailStatus: "SUSPICIOUS",
        detailRiskScore: 70,
        detailRiskReason: "호수 숫자 자릿수가 과도하게 길어 의심주소로 분류되었습니다."
      };
    }

    if (hoDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "FLOOR_HO_LONG_HO",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 35,
        detailRiskReason: "호수 숫자 자릿수가 일반 범위를 초과하여 확인이 필요합니다."
      };
    }
  }

  const hoOnlyMatch = clean.match(/^([0-9A-Za-z]+)호$/);

  if (hoOnlyMatch) {
    const hoPart = hoOnlyMatch[1];
    const hoDigits = hoPart.replace(/\D/g, "");

    if (hoDigits.length >= 7) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "HO_ONLY_LONG_HO",
        detailStatus: "SUSPICIOUS",
        detailRiskScore: 70,
        detailRiskReason: "호수 숫자 자릿수가 과도하게 길어 의심주소로 분류되었습니다."
      };
    }

    if (hoDigits.length >= 5) {
      return {
        detailAddressRaw: raw,
        detailAddressClean: clean,
        detailPattern: "HO_ONLY_LONG_HO",
        detailStatus: "CHECK_REQUIRED",
        detailRiskScore: 35,
        detailRiskReason: "호수 숫자 자릿수가 일반 범위를 초과하여 확인이 필요합니다."
      };
    }
  }

  if (/^[0-9A-Za-z가-힣]+동\s*[0-9A-Za-z]+호$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "DONG_HO",
      detailStatus: "NORMAL",
      detailRiskScore: 0,
      detailRiskReason: "동/호 패턴 정상"
    };
  }

  if (/^\d+층\s*[0-9A-Za-z]+호$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "FLOOR_HO",
      detailStatus: "NORMAL",
      detailRiskScore: 0,
      detailRiskReason: "층/호 패턴 정상"
    };
  }

  if (/^지하\s*\d+층\s*[A-Za-z]?\d+호$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "BASEMENT_FLOOR_HO",
      detailStatus: "NORMAL",
      detailRiskScore: 0,
      detailRiskReason: "지하층/호 패턴 정상"
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

  if (/^[0-9A-Za-z가-힣]+동$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "DONG_ONLY",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 30,
      detailRiskReason: "동 정보만 있고 호수가 없습니다."
    };
  }

  if (/^\d+층$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "FLOOR_ONLY",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 25,
      detailRiskReason: "층 정보만 있고 호수가 없습니다."
    };
  }

  if (/^지하\s*\d+층$/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "BASEMENT_FLOOR_ONLY",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 25,
      detailRiskReason: "지하층 정보만 있고 호수가 없습니다."
    };
  }

  if (!/\d/.test(clean)) {
    return {
      detailAddressRaw: raw,
      detailAddressClean: clean,
      detailPattern: "NO_NUMBER",
      detailStatus: "CHECK_REQUIRED",
      detailRiskScore: 40,
      detailRiskReason: "숫자 정보가 없어 상세주소로 충분한지 확인이 필요합니다."
    };
  }

  return {
    detailAddressRaw: raw,
    detailAddressClean: clean,
    detailPattern: "UNKNOWN",
    detailStatus: "CHECK_REQUIRED",
    detailRiskScore: 20,
    detailRiskReason: "정의되지 않은 상세주소 패턴입니다."
  };
}

/**
 * 상세주소 API 검색정보 추출
 */
function extractDetailSearchInfo(cleanDetailAddress) {
  const clean = String(cleanDetailAddress || "").trim();

  const dongHo = clean.match(/^([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호)$/);
  if (dongHo) {
    return {
      searchType: "floorho",
      dongNm: dongHo[1],
      targetFloor: "",
      targetHo: dongHo[2],
      targetDetail: clean
    };
  }

  const floorHo = clean.match(/^(\d+층)\s*([0-9A-Za-z]+호)$/);
  if (floorHo) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: floorHo[1],
      targetHo: floorHo[2],
      targetDetail: clean
    };
  }

  const basementFloorHo = clean.match(/^(지하\s*\d+층)\s*([A-Za-z]?\d+호)$/);
  if (basementFloorHo) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: basementFloorHo[1],
      targetHo: basementFloorHo[2],
      targetDetail: clean
    };
  }

  const hoOnly = clean.match(/^([0-9A-Za-z]+호)$/);
  if (hoOnly) {
    return {
      searchType: "floorho",
      dongNm: "",
      targetFloor: "",
      targetHo: hoOnly[1],
      targetDetail: clean
    };
  }

  return {
    searchType: "",
    dongNm: "",
    targetFloor: "",
    targetHo: "",
    targetDetail: clean
  };
}

/**
 * Juso 기본주소 API 호출
 */
async function searchJuso(keyword) {
  const url = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");

  url.searchParams.set("confmKey", JUSO_API_KEY);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", "5");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  const response = await fetch(url.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Juso API HTTP Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Juso 상세주소 API 호출
 */
async function searchJusoDetail(jusoResult, detailResult) {
  if (!JUSO_DETAIL_API_KEY) {
    return {
      jusoDetailChecked: false,
      jusoDetailMatch: null,
      jusoDetailStatus: "DETAIL_API_KEY_MISSING",
      jusoDetailReason: "JUSO_DETAIL_API_KEY가 설정되지 않았습니다.",
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
      jusoDetailStatus: "DETAIL_REQUIRED_PARAMS_MISSING",
      jusoDetailReason: "상세주소 API 호출에 필요한 기본주소 파라미터가 부족합니다.",
      jusoDetailCandidates: []
    };
  }

  const detail = extractDetailSearchInfo(detailResult.detailAddressClean);

  if (!detail.searchType) {
    return {
      jusoDetailChecked: false,
      jusoDetailMatch: null,
      jusoDetailStatus: "DETAIL_PATTERN_NOT_SUPPORTED",
      jusoDetailReason: "Juso 상세주소 API 대조 대상 패턴이 아닙니다.",
      jusoDetailCandidates: []
    };
  }

  const url = new URL("https://business.juso.go.kr/addrlink/addrDetailApi.do");

  url.searchParams.set("confmKey", JUSO_DETAIL_API_KEY);
  url.searchParams.set("admCd", jusoResult.admCd);
  url.searchParams.set("rnMgtSn", jusoResult.rnMgtSn);
  url.searchParams.set("udrtYn", jusoResult.udrtYn);
  url.searchParams.set("buldMnnm", jusoResult.buldMnnm);
  url.searchParams.set("buldSlno", jusoResult.buldSlno || "0");
  url.searchParams.set("searchType", detail.searchType);
  url.searchParams.set("resultType", "json");

  if (detail.dongNm) {
    url.searchParams.set("dongNm", detail.dongNm);
  }

  const response = await fetch(url.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Juso Detail API HTTP Error: ${response.status}`);
  }

  const data = await response.json();

  return parseJusoDetailResult(data, detail);
}

/**
 * Juso 상세주소 API 결과 파싱
 */
function parseJusoDetailResult(data, detail) {
  const results = data?.results || {};
  const common = results?.common || {};

  const possibleLists = [
    results?.juso,
    results?.addrDetail,
    results?.detail,
    results?.floors,
    results?.floorho,
    results?.detailList
  ];

  const detailList = possibleLists.find((v) => Array.isArray(v)) || [];

  const errorCode = common.errorCode || "";
  const errorMessage = common.errorMessage || "";
  const totalCount = Number(common.totalCount || detailList.length || 0);

  if (errorCode && errorCode !== "0") {
    return {
      jusoDetailChecked: true,
      jusoDetailMatch: false,
      jusoDetailStatus: "DETAIL_API_ERROR",
      jusoDetailReason: errorMessage || "상세주소 API 오류",
      jusoDetailCandidates: []
    };
  }

  const candidates = detailList.map((row) => {
    const values = Object.values(row)
      .filter((v) => typeof v === "string" || typeof v === "number")
      .map((v) => String(v).trim())
      .filter(Boolean);

    return {
      raw: row,
      text: values.join(" ")
    };
  });

  const targetDetail = normalizeCompareText(detail.targetDetail);
  const targetFloor = normalizeCompareText(detail.targetFloor);
  const targetHo = normalizeCompareText(detail.targetHo);
  const targetDong = normalizeCompareText(detail.dongNm);

  const matched = candidates.some((candidate) => {
    const candidateText = normalizeCompareText(candidate.text);

    const fullMatch =
      targetDetail &&
      (candidateText.includes(targetDetail) || targetDetail.includes(candidateText));

    const hoMatch = targetHo && candidateText.includes(targetHo);
    const floorMatch = targetFloor ? candidateText.includes(targetFloor) : true;
    const dongMatch = targetDong ? candidateText.includes(targetDong) : true;

    return fullMatch || (hoMatch && floorMatch && dongMatch);
  });

  if (matched) {
    return {
      jusoDetailChecked: true,
      jusoDetailMatch: true,
      jusoDetailStatus: "DETAIL_MATCHED",
      jusoDetailReason: "Juso 상세주소 API 후보에서 입력 상세주소가 확인되었습니다.",
      jusoDetailCandidates: candidates.slice(0, 20)
    };
  }

  return {
    jusoDetailChecked: true,
    jusoDetailMatch: false,
    jusoDetailStatus: totalCount === 0 ? "DETAIL_EMPTY" : "DETAIL_NOT_FOUND",
    jusoDetailReason:
      totalCount === 0
        ? "Juso 상세주소 API 후보가 없습니다."
        : "Juso 상세주소 API 후보에서 입력 상세주소를 찾지 못했습니다.",
    jusoDetailCandidates: candidates.slice(0, 20)
  };
}

/**
 * Juso 기본주소 결과 파싱
 */
function parseJusoResult(inputAddress, orderNo, data) {
  const common = data?.results?.common || {};
  const juso = data?.results?.juso || [];

  const totalCount = Number(common.totalCount || 0);
  const errorCode = common.errorCode || "";
  const errorMessage = common.errorMessage || "";

  if (errorCode && errorCode !== "0") {
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
      siNm: "",
      sggNm: "",
      emdNm: "",
      status: "JUSO_API_ERROR",
      message: errorMessage
    };
  }

  if (!Array.isArray(juso) || totalCount === 0) {
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
      siNm: "",
      sggNm: "",
      emdNm: "",
      status: "BASE_ADDR_ERROR",
      message: "Juso 검색 결과 없음"
    };
  }

  const first = juso[0];

  return {
    orderNo,
    inputAddress,
    jusoMatch: true,
    matchCount: totalCount,
    roadAddr: first.roadAddr || "",
    roadAddrPart1: first.roadAddrPart1 || "",
    jibunAddr: first.jibunAddr || "",
    zipNo: first.zipNo || "",
    admCd: first.admCd || "",
    rnMgtSn: first.rnMgtSn || "",
    udrtYn: first.udrtYn || "",
    buldMnnm: first.buldMnnm || "",
    buldSlno: first.buldSlno || "",
    bdMgtSn: first.bdMgtSn || "",
    siNm: first.siNm || "",
    sggNm: first.sggNm || "",
    emdNm: first.emdNm || "",
    status: totalCount === 1 ? "NORMAL" : "MULTIPLE_MATCH",
    message: totalCount === 1 ? "Juso 검색 결과 1건" : "Juso 검색 결과 복수"
  };
}

/**
 * 기본 최종 상태 계산
 */
function buildFinalResult(jusoResult, detailResult) {
  const jusoRiskScore =
    jusoResult.status === "BASE_ADDR_ERROR"
      ? 100
      : jusoResult.status === "JUSO_API_ERROR"
        ? 100
        : jusoResult.status === "REQUEST_ERROR"
          ? 100
          : jusoResult.status === "MULTIPLE_MATCH"
            ? 20
            : 0;

  const finalRiskScore = jusoRiskScore + detailResult.detailRiskScore;

  let finalStatus = "NORMAL";

  if (jusoResult.status === "BASE_ADDR_ERROR") {
    finalStatus = "BASE_ADDR_ERROR";
  } else if (
    jusoResult.status === "JUSO_API_ERROR" ||
    jusoResult.status === "REQUEST_ERROR"
  ) {
    finalStatus = "JUSO_API_ERROR";
  } else if (detailResult.detailStatus === "SUSPICIOUS") {
    finalStatus = "SUSPICIOUS";
  } else if (
    jusoResult.status === "MULTIPLE_MATCH" ||
    detailResult.detailStatus === "CHECK_REQUIRED"
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

/**
 * 상세주소 API 대조 결과까지 포함한 최종 상태 계산
 */
function buildFinalResultWithDetailApi(jusoResult, detailResult, detailApiResult) {
  const base = buildFinalResult(jusoResult, detailResult);

  let extraRisk = 0;
  let finalStatus = base.finalStatus;
  let detailStatus = detailResult.detailStatus;
  let detailRiskScore = detailResult.detailRiskScore;
  let detailRiskReason = detailResult.detailRiskReason;

  if (
    detailApiResult.jusoDetailChecked === true &&
    detailApiResult.jusoDetailMatch === false &&
    ["DONG_HO", "FLOOR_HO", "HO_ONLY", "BASEMENT_FLOOR_HO"].includes(
      detailResult.detailPattern
    )
  ) {
    extraRisk = 40;

    if (base.finalStatus === "NORMAL") {
      finalStatus = "CHECK_REQUIRED";
    }

    if (detailResult.detailStatus === "NORMAL") {
      detailStatus = "CHECK_REQUIRED";
      detailRiskScore = detailResult.detailRiskScore + extraRisk;
      detailRiskReason =
        "형식은 정상이나 Juso 상세주소 API에서 해당 상세주소가 확인되지 않았습니다.";
    }
  }

  if (detailApiResult.jusoDetailMatch === true && base.finalStatus === "NORMAL") {
    finalStatus = "NORMAL";
  }

  return {
    ...base,
    detailStatus,
    detailRiskScore,
    detailRiskReason,
    ...detailApiResult,
    finalRiskScore: base.finalRiskScore + extraRisk,
    finalStatus
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "address-validator-api",
    message: "Address validator API is running"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "address-validator-api"
  });
});

/**
 * Juso 상세주소 후보 리스트 확인용 디버그 API
 */
app.post("/debug-juso-detail-list", checkSecret, async (req, res) => {
  try {
    if (!JUSO_API_KEY) {
      return res.status(500).json({
        ok: false,
        message: "JUSO_API_KEY가 설정되지 않았습니다."
      });
    }

    if (!JUSO_DETAIL_API_KEY) {
      return res.status(500).json({
        ok: false,
        message: "JUSO_DETAIL_API_KEY가 설정되지 않았습니다."
      });
    }

    const baseAddress = cleanAddress(req.body?.baseAddress);
    const detailAddress = String(req.body?.detailAddress || "").trim();

    if (!baseAddress) {
      return res.status(400).json({
        ok: false,
        message: "baseAddress가 필요합니다."
      });
    }

    const jusoData = await searchJuso(baseAddress);
    const jusoResult = parseJusoResult(baseAddress, "DEBUG", jusoData);

    if (jusoResult.status !== "NORMAL") {
      return res.json({
        ok: true,
        baseAddress,
        detailAddress,
        jusoResult,
        message: "기본주소가 NORMAL 상태가 아니어서 상세주소 후보 조회를 중단했습니다."
      });
    }

    const detailResult = classifyDetailAddress(detailAddress || "1호");

    const url = new URL("https://business.juso.go.kr/addrlink/addrDetailApi.do");

    url.searchParams.set("confmKey", JUSO_DETAIL_API_KEY);
    url.searchParams.set("admCd", jusoResult.admCd);
    url.searchParams.set("rnMgtSn", jusoResult.rnMgtSn);
    url.searchParams.set("udrtYn", jusoResult.udrtYn);
    url.searchParams.set("buldMnnm", jusoResult.buldMnnm);
    url.searchParams.set("buldSlno", jusoResult.buldSlno || "0");
    url.searchParams.set("searchType", "floorho");
    url.searchParams.set("resultType", "json");

    const response = await fetch(url.toString(), {
      method: "GET"
    });

    if (!response.ok) {
      throw new Error(`Juso Detail API HTTP Error: ${response.status}`);
    }

    const rawDetailData = await response.json();

    const results = rawDetailData?.results || {};
    const common = results?.common || {};

    const possibleLists = [
      results?.juso,
      results?.addrDetail,
      results?.detail,
      results?.floors,
      results?.floorho,
      results?.detailList
    ];

    const detailList = possibleLists.find((v) => Array.isArray(v)) || [];

    const candidates = detailList.map((row) => {
      const values = Object.values(row)
        .filter((v) => typeof v === "string" || typeof v === "number")
        .map((v) => String(v).trim())
        .filter(Boolean);

      return {
        raw: row,
        text: values.join(" ")
      };
    });

    const target = normalizeCompareText(detailAddress);

    const matchedCandidates = candidates.filter((candidate) => {
      const candidateText = normalizeCompareText(candidate.text);
      return target && candidateText.includes(target);
    });

    res.json({
      ok: true,
      baseAddress,
      detailAddress,
      jusoResult,
      detailResult,
      detailApiRequestParams: {
        admCd: jusoResult.admCd,
        rnMgtSn: jusoResult.rnMgtSn,
        udrtYn: jusoResult.udrtYn,
        buldMnnm: jusoResult.buldMnnm,
        buldSlno: jusoResult.buldSlno || "0",
        searchType: "floorho"
      },
      detailApiCommon: common,
      candidateCount: candidates.length,
      matchedCount: matchedCandidates.length,
      matchedCandidates,
      candidates,
      rawDetailData
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

/**
 * 주소 검증 API
 */
app.post("/validate-addresses", checkSecret, async (req, res) => {
  try {
    if (!JUSO_API_KEY) {
      return res.status(500).json({
        ok: false,
        message: "JUSO_API_KEY가 설정되지 않았습니다."
      });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "items 배열이 필요합니다."
      });
    }

    if (items.length > 50) {
      return res.status(400).json({
        ok: false,
        message: "테스트 단계에서는 한 번에 최대 50건까지만 허용합니다."
      });
    }

    const results = [];

    for (const item of items) {
      const orderNo = item.orderNo || "";
      const inputAddress = cleanAddress(item.baseAddress);
      const detailResult = classifyDetailAddress(item.detailAddress);

      if (!inputAddress) {
        const jusoResult = {
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
          siNm: "",
          sggNm: "",
          emdNm: "",
          status: "EMPTY_ADDRESS",
          message: "주소값 없음"
        };

        results.push({
          ...jusoResult,
          ...detailResult,
          jusoDetailChecked: false,
          jusoDetailMatch: null,
          jusoDetailStatus: "NOT_CHECKED",
          jusoDetailReason: "기본주소가 없어 상세주소 API 대조를 수행하지 않았습니다.",
          jusoDetailCandidates: [],
          finalRiskScore: 100 + detailResult.detailRiskScore,
          finalStatus: "BASE_ADDR_ERROR"
        });

        continue;
      }

      try {
        const data = await searchJuso(inputAddress);
        const jusoResult = parseJusoResult(inputAddress, orderNo, data);

        let detailApiResult = {
          jusoDetailChecked: false,
          jusoDetailMatch: null,
          jusoDetailStatus: "NOT_CHECKED",
          jusoDetailReason: "상세주소 API 대조를 수행하지 않았습니다.",
          jusoDetailCandidates: []
        };

        if (
          jusoResult.status === "NORMAL" &&
          ["DONG_HO", "FLOOR_HO", "HO_ONLY", "BASEMENT_FLOOR_HO"].includes(
            detailResult.detailPattern
          )
        ) {
          try {
            detailApiResult = await searchJusoDetail(jusoResult, detailResult);
          } catch (detailError) {
            detailApiResult = {
              jusoDetailChecked: true,
              jusoDetailMatch: false,
              jusoDetailStatus: "DETAIL_REQUEST_ERROR",
              jusoDetailReason: detailError.message,
              jusoDetailCandidates: []
            };
          }
        }

        const finalResult = buildFinalResultWithDetailApi(
          jusoResult,
          detailResult,
          detailApiResult
        );

        results.push(finalResult);
      } catch (error) {
        const jusoResult = {
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
          siNm: "",
          sggNm: "",
          emdNm: "",
          status: "REQUEST_ERROR",
          message: error.message
        };

        results.push({
          ...jusoResult,
          ...detailResult,
          jusoDetailChecked: false,
          jusoDetailMatch: null,
          jusoDetailStatus: "NOT_CHECKED",
          jusoDetailReason: "Juso 기본주소 요청 오류로 상세주소 API 대조를 수행하지 않았습니다.",
          jusoDetailCandidates: [],
          finalRiskScore: 100 + detailResult.detailRiskScore,
          finalStatus: "JUSO_API_ERROR"
        });
      }
    }

    res.json({
      ok: true,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Address validator API running on port ${PORT}`);
});
