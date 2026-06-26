import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const JUSO_API_KEY = process.env.JUSO_API_KEY;
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
  if (!API_SECRET) {
    return next();
  }

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

  // 101동1203호 → 101동 1203호
  clean = clean.replace(/([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호?)$/g, "$1 $2");

  // B동201호 → B동 201호
  clean = clean.replace(/([A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호?)$/g, "$1 $2");

  // 3층302호 → 3층 302호
  clean = clean.replace(/(\d+층)\s*([0-9A-Za-z]+호?)$/g, "$1 $2");

  // 숫자만 있으면 호수로 보정: 302 → 302호
  if (/^\d{1,4}$/.test(clean)) {
    clean = clean + "호";
  }

  // "B동 201" → "B동 201호", "3층 302" → "3층 302호"
  clean = clean.replace(/(동|층)\s*(\d{1,4})$/g, "$1 $2호");

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

  // 101동 1203호, B동 201호
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

  // 3층 302호
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

  // 302호
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

  // 101동만 있음
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

  // 3층만 있음
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

  // 숫자가 하나도 없음
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
 * Juso API 호출
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
 * Juso 결과 파싱
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
    bdMgtSn: first.bdMgtSn || "",
    siNm: first.siNm || "",
    sggNm: first.sggNm || "",
    emdNm: first.emdNm || "",
    status: totalCount === 1 ? "NORMAL" : "MULTIPLE_MATCH",
    message: totalCount === 1 ? "Juso 검색 결과 1건" : "Juso 검색 결과 복수"
  };
}

/**
 * 최종 상태 계산
 */
function buildFinalResult(jusoResult, detailResult) {
  const jusoRiskScore =
    jusoResult.status === "BASE_ADDR_ERROR"
      ? 100
      : jusoResult.status === "JUSO_API_ERROR"
        ? 100
        : jusoResult.status === "MULTIPLE_MATCH"
          ? 20
          : 0;

  const finalRiskScore = jusoRiskScore + detailResult.detailRiskScore;

  let finalStatus = "NORMAL";

  if (jusoResult.status === "BASE_ADDR_ERROR") {
    finalStatus = "BASE_ADDR_ERROR";
  } else if (jusoResult.status === "JUSO_API_ERROR") {
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
          finalRiskScore: 100 + detailResult.detailRiskScore,
          finalStatus: "BASE_ADDR_ERROR"
        });

        continue;
      }

      try {
        const data = await searchJuso(inputAddress);
        const jusoResult = parseJusoResult(inputAddress, orderNo, data);
        const finalResult = buildFinalResult(jusoResult, detailResult);

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
