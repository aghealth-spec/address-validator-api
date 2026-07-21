import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

/* =========================================================
 * 환경변수
 * ======================================================= */

const PORT = Number(process.env.PORT || 3000);

const JUSO_API_KEY = String(
  process.env.JUSO_API_KEY || ""
).trim();

const PUBLIC_DATA_API_KEY = String(
  process.env.PUBLIC_DATA_API_KEY || ""
).trim();

const API_SECRET = String(
  process.env.API_SECRET || ""
).trim();

const ALLOWED_ORIGIN = String(
  process.env.ALLOWED_ORIGIN || "*"
).trim();

const BUILDING_API_BASE =
  "https://apis.data.go.kr/1613000/BldRgstHubService";

/* =========================================================
 * 미들웨어
 * ======================================================= */

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "2mb"
  })
);

const allowedOrigins = ALLOWED_ORIGIN
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
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

    methods: [
      "GET",
      "POST",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "x-api-secret"
    ]
  })
);

/* =========================================================
 * 인증
 * ======================================================= */

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
 * 공통 함수
 * ======================================================= */

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompareText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/-/g, "")
    .toLowerCase();
}

function toNumberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function toArray(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  return Array.isArray(value)
    ? value
    : [value];
}

function padJibunNumber(value) {
  const digits = String(value ?? "")
    .replace(/\D/g, "");

  if (!digits) {
    return "0000";
  }

  return digits.padStart(4, "0");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pickFirstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return "";
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

  // B1F → 지하 1층
  clean = clean.replace(
    /\bB\s*(\d+)\s*[Ff]\b/gi,
    "지하 $1층"
  );

  // 지하1층 → 지하 1층
  clean = clean.replace(
    /지하\s*(\d+)\s*층/g,
    "지하 $1층"
  );

  // 101동505호 → 101동 505호
  clean = clean.replace(
    /([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호?)$/g,
    "$1 $2"
  );

  // 5층505호 → 5층 505호
  clean = clean.replace(
    /(\d+층)\s*([0-9A-Za-z]+호?)$/g,
    "$1 $2"
  );

  // 지하1층B101호 → 지하 1층 B101호
  clean = clean.replace(
    /(지하\s*\d+층)\s*([A-Za-z]?\d+호?)$/g,
    "$1 $2"
  );

  // 숫자만 입력되면 호수로 처리
  if (/^\d{1,5}$/.test(clean)) {
    clean += "호";
  }

  // 101동 505 → 101동 505호
  clean = clean.replace(
    /([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]{1,8})$/g,
    "$1 $2호"
  );

  // 5층 505 → 5층 505호
  clean = clean.replace(
    /(\d+층)\s*([0-9A-Za-z]{1,8})$/g,
    "$1 $2호"
  );

  // 지하 1층 B101 → 지하 1층 B101호
  clean = clean.replace(
    /(지하\s*\d+층)\s*([A-Za-z]?\d+)$/g,
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
 * 동·호 정규화
 * ======================================================= */

function normalizeDongName(value) {
  let text = String(value ?? "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase();

  text = text
    .replace(/^제/, "")
    .replace(/동$/, "");

  if (/^\d+$/.test(text)) {
    text = text.replace(
      /^0+(?=\d)/,
      ""
    );
  }

  return text;
}

function normalizeHoName(value) {
  let text = String(value ?? "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase();

  // 제505호 → 505호
  text = text.replace(/^제/, "");

  /*
   * 전유부 응답 예:
   * 5층505호 → 505
   * 10층1001호 → 1001
   * 지하1층B101호 → b101
   */
  text = text.replace(
    /^(?:지하\d+층|\d+층)/,
    ""
  );

  text = text.replace(/호$/, "");

  if (/^\d+$/.test(text)) {
    text = text.replace(
      /^0+(?=\d)/,
      ""
    );
  }

  return text;
}

function extractFloorFromHoName(value) {
  const text = String(value ?? "")
    .replace(/\s+/g, "")
    .trim();

  let match = text.match(
    /^지하(\d+)층/
  );

  if (match) {
    return {
      floorType: "UNDERGROUND",
      floorNumber: Number(match[1])
    };
  }

  match = text.match(/^(\d+)층/);

  if (match) {
    return {
      floorType: "GROUND",
      floorNumber: Number(match[1])
    };
  }

  return {
    floorType: "",
    floorNumber: null
  };
}

/* =========================================================
 * 상세주소 파싱
 * ======================================================= */

function inferGroundFloorFromUnit(unitName) {
  const digits = String(unitName ?? "")
    .replace(/\D/g, "");

  // 505호 → 5층
  if (digits.length === 3) {
    return Number(
      digits.slice(0, 1)
    );
  }

  // 1203호 → 12층
  if (digits.length === 4) {
    return Number(
      digits.slice(0, 2)
    );
  }

  return null;
}

function parseDetailAddress(detailAddress) {
  const normalized =
    normalizeDetailAddress(
      detailAddress
    );

  const clean = normalized.clean;

  /*
   * 101동 505호
   */
  let match = clean.match(
    /^([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z]+호)$/
  );

  if (match) {
    return {
      raw: normalized.raw,
      clean,
      pattern: "DONG_HO",

      dongRaw: match[1],
      hoRaw: match[2],

      targetDong:
        normalizeDongName(match[1]),

      targetHo:
        normalizeHoName(match[2]),

      floorType: "GROUND",

      inferredFloor:
        inferGroundFloorFromUnit(
          match[2]
        ),

      inputFloor: null
    };
  }

  /*
   * 11층 1001호
   */
  match = clean.match(
    /^(\d+)층\s*([0-9A-Za-z]+호)$/
  );

  if (match) {
    return {
      raw: normalized.raw,
      clean,
      pattern: "FLOOR_HO",

      dongRaw: "",
      hoRaw: match[2],

      targetDong: "",
      targetHo:
        normalizeHoName(match[2]),

      floorType: "GROUND",
      inferredFloor: null,
      inputFloor: Number(match[1])
    };
  }

  /*
   * 지하 1층 B101호
   */
  match = clean.match(
    /^지하\s*(\d+)층\s*([A-Za-z]?\d+호)$/
  );

  if (match) {
    return {
      raw: normalized.raw,
      clean,
      pattern:
        "BASEMENT_FLOOR_HO",

      dongRaw: "",
      hoRaw: match[2],

      targetDong: "",
      targetHo:
        normalizeHoName(match[2]),

      floorType: "UNDERGROUND",
      inferredFloor: null,
      inputFloor: Number(match[1])
    };
  }

  /*
   * 505호
   */
  match = clean.match(
    /^([0-9A-Za-z]+호)$/
  );

  if (match) {
    return {
      raw: normalized.raw,
      clean,
      pattern: "HO_ONLY",

      dongRaw: "",
      hoRaw: match[1],

      targetDong: "",
      targetHo:
        normalizeHoName(match[1]),

      floorType: "GROUND",

      inferredFloor:
        inferGroundFloorFromUnit(
          match[1]
        ),

      inputFloor: null
    };
  }

  return {
    raw: normalized.raw,
    clean,

    pattern:
      clean
        ? "UNKNOWN"
        : "EMPTY",

    dongRaw: "",
    hoRaw: "",

    targetDong: "",
    targetHo: "",

    floorType: "",
    inferredFloor: null,
    inputFloor: null
  };
}

/* =========================================================
 * Juso 기본주소 API
 * ======================================================= */

async function searchJuso(keyword) {
  if (!JUSO_API_KEY) {
    throw new Error(
      "JUSO_API_KEY가 설정되지 않았습니다."
    );
  }

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
    "10"
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

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Juso API HTTP 오류: ${response.status} / ${text.slice(0, 200)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Juso API JSON 파싱 실패: ${text.slice(0, 300)}`
    );
  }
}

function parseJusoResult(
  inputAddress,
  orderNo,
  data
) {
  const common =
    data?.results?.common || {};

  const rows = Array.isArray(
    data?.results?.juso
  )
    ? data.results.juso
    : [];

  const errorCode = String(
    common.errorCode || ""
  );

  const errorMessage = String(
    common.errorMessage || ""
  );

  const totalCount = Number(
    common.totalCount ||
    rows.length ||
    0
  );

  if (
    errorCode &&
    errorCode !== "0"
  ) {
    return {
      orderNo,
      inputAddress,

      matched: false,
      status: "JUSO_API_ERROR",

      message:
        errorMessage ||
        "Juso API 오류",

      totalCount: 0,
      selected: null,
      candidates: []
    };
  }

  if (
    rows.length === 0 ||
    totalCount === 0
  ) {
    return {
      orderNo,
      inputAddress,

      matched: false,
      status:
        "BASE_ADDRESS_NOT_FOUND",

      message:
        "Juso 기본주소 검색 결과가 없습니다.",

      totalCount: 0,
      selected: null,
      candidates: []
    };
  }

  const candidates = rows.map(
    (row) => ({
      roadAddr:
        row?.roadAddr || "",

      roadAddrPart1:
        row?.roadAddrPart1 || "",

      jibunAddr:
        row?.jibunAddr || "",

      zipNo:
        row?.zipNo || "",

      admCd:
        row?.admCd || "",

      rnMgtSn:
        row?.rnMgtSn || "",

      udrtYn:
        row?.udrtYn || "",

      buldMnnm:
        row?.buldMnnm || "",

      buldSlno:
        row?.buldSlno || "0",

      bdMgtSn:
        row?.bdMgtSn || "",

      mtYn:
        row?.mtYn || "0",

      lnbrMnnm:
        row?.lnbrMnnm || "",

      lnbrSlno:
        row?.lnbrSlno || "0",

      bdNm:
        row?.bdNm || "",

      detBdNmList:
        row?.detBdNmList || "",

      siNm:
        row?.siNm || "",

      sggNm:
        row?.sggNm || "",

      emdNm:
        row?.emdNm || ""
    })
  );

  return {
    orderNo,
    inputAddress,

    matched: true,

    status:
      totalCount === 1
        ? "NORMAL"
        : "MULTIPLE_MATCH",

    message:
      totalCount === 1
        ? "Juso 검색 결과 1건"
        : `Juso 검색 결과 ${totalCount}건`,

    totalCount,
    selected: candidates[0],
    candidates
  };
}

/* =========================================================
 * 건축물대장 파라미터
 * ======================================================= */

function buildBuildingParams(juso) {
  const admCd = String(
    juso?.admCd || ""
  );

  if (admCd.length < 10) {
    return {
      valid: false,
      reason:
        "Juso admCd 값이 없습니다."
    };
  }

  if (!juso?.lnbrMnnm) {
    return {
      valid: false,
      reason:
        "Juso 지번 본번 값이 없습니다."
    };
  }

  return {
    valid: true,

    sigunguCd:
      admCd.slice(0, 5),

    bjdongCd:
      admCd.slice(5, 10),

    platGbCd:
      String(juso?.mtYn || "0") ===
      "1"
        ? "1"
        : "0",

    bun:
      padJibunNumber(
        juso?.lnbrMnnm
      ),

    ji:
      padJibunNumber(
        juso?.lnbrSlno || "0"
      )
  };
}

/*
 * 정확지번 + 대표지번 후보 생성
 *
 * 예:
 * 삼성동 159-1
 * 1차: bun=0159, ji=0001
 * 2차: bun=0159, ji=0000
 */
function buildBuildingParamCandidates(juso) {
  const exact =
    buildBuildingParams(juso);

  if (!exact.valid) {
    return [exact];
  }

  const candidates = [
    {
      ...exact,
      lookupSource:
        "JUSO_EXACT_JIBUN"
    }
  ];

  if (exact.ji !== "0000") {
    candidates.push({
      ...exact,
      ji: "0000",
      lookupSource:
        "MAIN_JIBUN_FALLBACK"
    });
  }

  return candidates;
}

/* =========================================================
 * 건축HUB 공통 호출
 * ======================================================= */

async function fetchBuildingHubPage(
  operation,
  params,
  pageNo = 1,
  numOfRows = 100
) {
  if (!PUBLIC_DATA_API_KEY) {
    throw new Error(
      "PUBLIC_DATA_API_KEY가 설정되지 않았습니다."
    );
  }

  const url = new URL(
    `${BUILDING_API_BASE}/${operation}`
  );

  url.searchParams.set(
    "serviceKey",
    PUBLIC_DATA_API_KEY
  );

  url.searchParams.set(
    "sigunguCd",
    params.sigunguCd
  );

  url.searchParams.set(
    "bjdongCd",
    params.bjdongCd
  );

  url.searchParams.set(
    "platGbCd",
    params.platGbCd
  );

  url.searchParams.set(
    "bun",
    params.bun
  );

  url.searchParams.set(
    "ji",
    params.ji
  );

  url.searchParams.set(
    "numOfRows",
    String(numOfRows)
  );

  url.searchParams.set(
    "pageNo",
    String(pageNo)
  );

  url.searchParams.set(
    "_type",
    "json"
  );

  const response = await fetch(
    url.toString(),
    {
      method: "GET",
      signal:
        AbortSignal.timeout(20000)
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${operation} HTTP 오류: ${response.status} / ${text.slice(0, 300)}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `${operation} JSON 파싱 실패: ${text.slice(0, 500)}`
    );
  }

  const header =
    data?.response?.header || {};

  const resultCode = String(
    header?.resultCode || ""
  );

  const resultMessage = String(
    header?.resultMsg || ""
  );

  if (
    resultCode &&
    !["00", "0000"].includes(
      resultCode
    )
  ) {
    throw new Error(
      `${operation} API 오류: ${resultCode} / ${resultMessage}`
    );
  }

  const body =
    data?.response?.body || {};

  const items = toArray(
    body?.items?.item
  );

  return {
    operation,
    pageNo,
    numOfRows,

    resultCode,
    resultMessage,

    totalCount:
      Number(
        body?.totalCount ||
        items.length ||
        0
      ),

    items,
    raw: data
  };
}

async function fetchAllBuildingHubItems(
  operation,
  params,
  options = {}
) {
  const numOfRows = Number(
    options.numOfRows || 100
  );

  const maxPages = Number(
    options.maxPages || 30
  );

  const first =
    await fetchBuildingHubPage(
      operation,
      params,
      1,
      numOfRows
    );

  const allItems = [
    ...first.items
  ];

  const realTotalPages =
    Math.max(
      1,
      Math.ceil(
        first.totalCount /
        numOfRows
      )
    );

  const totalPages =
    Math.min(
      maxPages,
      realTotalPages
    );

  for (
    let pageNo = 2;
    pageNo <= totalPages;
    pageNo += 1
  ) {
    await sleep(30);

    const page =
      await fetchBuildingHubPage(
        operation,
        params,
        pageNo,
        numOfRows
      );

    allItems.push(
      ...page.items
    );
  }

  return {
    operation,

    resultCode:
      first.resultCode,

    resultMessage:
      first.resultMessage,

    totalCount:
      first.totalCount,

    loadedCount:
      allItems.length,

    pageCount:
      totalPages,

    truncated:
      totalPages <
      realTotalPages,

    items:
      allItems
  };
}

/* =========================================================
 * 표제부 폴백 조회
 * ======================================================= */

async function searchBuildingTitlesWithFallback(
  juso
) {
  const paramCandidates =
    buildBuildingParamCandidates(
      juso
    );

  const attempts = [];

  /*
   * 1단계
   * 정확지번·대표지번 표제부 조회
   */
  for (const params of paramCandidates) {
    try {
      const result =
        await fetchAllBuildingHubItems(
          "getBrTitleInfo",
          params,
          {
            numOfRows: 100,
            maxPages: 10
          }
        );

      attempts.push({
        operation:
          "getBrTitleInfo",

        lookupSource:
          params.lookupSource,

        params,

        success: true,

        totalCount:
          result.totalCount
      });

      if (result.items.length > 0) {
        return {
          matched: true,

          operation:
            "getBrTitleInfo",

          lookupSource:
            params.lookupSource,

          matchedParams:
            params,

          attempts,

          ...result
        };
      }
    } catch (error) {
      attempts.push({
        operation:
          "getBrTitleInfo",

        lookupSource:
          params.lookupSource,

        params,

        success: false,

        totalCount: 0,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  /*
   * 2단계
   * 정확지번·대표지번 총괄표제부 조회
   */
  for (const params of paramCandidates) {
    try {
      const result =
        await fetchAllBuildingHubItems(
          "getBrRecapTitleInfo",
          params,
          {
            numOfRows: 100,
            maxPages: 10
          }
        );

      attempts.push({
        operation:
          "getBrRecapTitleInfo",

        lookupSource:
          params.lookupSource,

        params,

        success: true,

        totalCount:
          result.totalCount
      });

      if (result.items.length > 0) {
        return {
          matched: true,

          operation:
            "getBrRecapTitleInfo",

          lookupSource:
            params.lookupSource,

          matchedParams:
            params,

          attempts,

          ...result
        };
      }
    } catch (error) {
      attempts.push({
        operation:
          "getBrRecapTitleInfo",

        lookupSource:
          params.lookupSource,

        params,

        success: false,

        totalCount: 0,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  return {
    matched: false,

    operation: "",

    lookupSource:
      "ALL_LOOKUPS_FAILED",

    matchedParams: null,

    attempts,

    resultCode: "",
    resultMessage: "",

    totalCount: 0,
    loadedCount: 0,
    pageCount: 0,
    truncated: false,

    items: []
  };
}

/* =========================================================
 * 전유부 폴백 조회
 * ======================================================= */

async function searchExposWithFallback(
  juso,
  preferredParams,
  options = {}
) {
  const allCandidates = [];

  if (
    preferredParams &&
    preferredParams.valid !== false
  ) {
    allCandidates.push({
      ...preferredParams,
      lookupSource:
        preferredParams.lookupSource ||
        "TITLE_MATCHED_PARAMS"
    });
  }

  const defaultCandidates =
    buildBuildingParamCandidates(
      juso
    );

  for (const candidate of defaultCandidates) {
    const duplicate =
      allCandidates.some(
        (item) =>
          item.sigunguCd ===
            candidate.sigunguCd &&
          item.bjdongCd ===
            candidate.bjdongCd &&
          item.platGbCd ===
            candidate.platGbCd &&
          item.bun ===
            candidate.bun &&
          item.ji ===
            candidate.ji
      );

    if (!duplicate) {
      allCandidates.push(
        candidate
      );
    }
  }

  const attempts = [];

  for (const params of allCandidates) {
    try {
      const result =
        await fetchAllBuildingHubItems(
          "getBrExposInfo",
          params,
          {
            numOfRows:
              Number(
                options.exposRowsPerPage ||
                100
              ),

            maxPages:
              Number(
                options.exposMaxPages ||
                30
              )
          }
        );

      attempts.push({
        operation:
          "getBrExposInfo",

        lookupSource:
          params.lookupSource,

        params,

        success: true,

        totalCount:
          result.totalCount
      });

      if (result.items.length > 0) {
        return {
          matched: true,

          operation:
            "getBrExposInfo",

          lookupSource:
            params.lookupSource,

          matchedParams:
            params,

          attempts,

          ...result
        };
      }
    } catch (error) {
      attempts.push({
        operation:
          "getBrExposInfo",

        lookupSource:
          params.lookupSource,

        params,

        success: false,

        totalCount: 0,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  return {
    matched: false,

    operation:
      "getBrExposInfo",

    lookupSource:
      "ALL_LOOKUPS_FAILED",

    matchedParams: null,

    attempts,

    resultCode: "",
    resultMessage: "",

    totalCount: 0,
    loadedCount: 0,
    pageCount: 0,
    truncated: false,

    items: []
  };
}

/* =========================================================
 * 표제부 매핑
 * ======================================================= */

function mapTitleCandidate(item) {
  return {
    buildingPk: String(
      item?.mgmBldrgstPk || ""
    ),

    buildingName:
      item?.bldNm || "",

    dongName:
      item?.dongNm || "",

    registerTypeCode:
      item?.regstrGbCd || "",

    registerTypeName:
      item?.regstrGbCdNm || "",

    registerKindCode:
      item?.regstrKindCd || "",

    registerKindName:
      item?.regstrKindCdNm || "",

    mainAttachCode:
      item?.mainAtchGbCd || "",

    mainAttachName:
      item?.mainAtchGbCdNm || "",

    mainPurpose:
      item?.mainPurpsCdNm || "",

    otherPurpose:
      item?.etcPurps || "",

    structure:
      item?.strctCdNm || "",

    roadAddress:
      item?.newPlatPlc || "",

    landAddress:
      item?.platPlc || "",

    /*
     * 지상층수
     */
    groundFloorCount:
      toNumberOrNull(
        item?.grndFlrCnt
      ),

    /*
     * 지하층수
     */
    undergroundFloorCount:
      toNumberOrNull(
        item?.ugrndFlrCnt
      ),

    height:
      toNumberOrNull(
        item?.heit
      ),

    elevatorCount:
      toNumberOrNull(
        item?.rideUseElvtCnt
      ),

    emergencyElevatorCount:
      toNumberOrNull(
        item?.emgenUseElvtCnt
      ),

    useApprovalDate:
      item?.useAprDay || "",

    raw: item
  };
}

function isLikelyResidentialTitle(
  candidate
) {
  const text =
    normalizeCompareText(
      [
        candidate.mainPurpose,
        candidate.otherPurpose,
        candidate.buildingName
      ].join(" ")
    );

  return (
    text.includes("공동주택") ||
    text.includes("아파트") ||
    text.includes("연립주택") ||
    text.includes("다세대")
  );
}

/* =========================================================
 * 전유부 매핑
 * ======================================================= */

function mapExposCandidate(item) {
  const dongName =
    pickFirstValue(
      item,
      [
        "dongNm",
        "mainBldNm",
        "bldNm"
      ]
    );

  const hoName =
    pickFirstValue(
      item,
      [
        "hoNm",
        "ho",
        "unitNm"
      ]
    );

  const rawFloorNumber =
    toNumberOrNull(
      pickFirstValue(
        item,
        [
          "flrNo",
          "floorNo"
        ]
      )
    );

  const parsedFloor =
    extractFloorFromHoName(
      hoName
    );

  /*
   * 전유부의 flrNo가 0인 경우가 있으므로
   * hoNm의 "5층505호"에서 층을 보완합니다.
   */
  const floorNumber =
    rawFloorNumber !== null &&
    rawFloorNumber !== 0
      ? rawFloorNumber
      : parsedFloor.floorNumber;

  const floorType =
    parsedFloor.floorType ||
    (
      String(
        item?.flrGbCdNm || ""
      ).includes("지하")
        ? "UNDERGROUND"
        : String(
            item?.flrGbCdNm || ""
          ).includes("지상")
          ? "GROUND"
          : ""
    );

  return {
    exposPk: String(
      item?.mgmBldrgstPk || ""
    ),

    buildingName:
      item?.bldNm || "",

    dongName:
      String(dongName || ""),

    hoName:
      String(hoName || ""),

    normalizedDong:
      normalizeDongName(
        dongName
      ),

    normalizedHo:
      normalizeHoName(
        hoName
      ),

    floorTypeCode:
      item?.flrGbCd || "",

    floorTypeName:
      item?.flrGbCdNm || "",

    floorType,
    floorNumber,

    mainPurpose:
      item?.mainPurpsCdNm || "",

    otherPurpose:
      item?.etcPurps || "",

    area:
      toNumberOrNull(
        item?.area
      ),

    registerTypeName:
      item?.regstrGbCdNm || "",

    registerKindName:
      item?.regstrKindCdNm || "",

    raw: item
  };
}

/* =========================================================
 * 전유부 동·호 매칭
 * ======================================================= */

function evaluateExposMatch(
  detail,
  exposCandidates
) {
  const hasTargetDong =
    Boolean(detail.targetDong);

  const hasTargetHo =
    Boolean(detail.targetHo);

  const dongMatches = [];
  const unitMatches = [];
  const exactMatches = [];

  for (
    const candidate
    of exposCandidates
  ) {
    const dongMatched =
      hasTargetDong &&
      candidate.normalizedDong ===
      detail.targetDong;

    const hoMatched =
      hasTargetHo &&
      candidate.normalizedHo ===
      detail.targetHo;

    /*
     * 사용자가 층을 직접 입력한 경우:
     * 11층 1001호
     *
     * 같은 1001호가 여러 층에 존재할 가능성을 고려해
     * 층 정보도 함께 검사합니다.
     */
    const inputFloorMatched =
      !Number.isFinite(
        detail.inputFloor
      ) ||
      !Number.isFinite(
        candidate.floorNumber
      ) ||
      (
        candidate.floorType ===
          detail.floorType &&
        candidate.floorNumber ===
          detail.inputFloor
      );

    if (dongMatched) {
      dongMatches.push(
        candidate
      );
    }

    if (
      hoMatched &&
      inputFloorMatched
    ) {
      unitMatches.push(
        candidate
      );
    }

    if (
      (
        !hasTargetDong ||
        dongMatched
      ) &&
      (
        !hasTargetHo ||
        hoMatched
      ) &&
      inputFloorMatched &&
      (
        hasTargetDong ||
        hasTargetHo
      )
    ) {
      exactMatches.push(
        candidate
      );
    }
  }

  let status =
    "NOT_CHECKED";

  let reason =
    "비교 가능한 동·호 입력값이 없습니다.";

  if (
    exposCandidates.length === 0
  ) {
    status =
      "EXPOS_DATA_UNAVAILABLE";

    reason =
      "건축물대장 전유부 데이터가 제공되지 않았습니다.";
  } else if (
    exactMatches.length > 0
  ) {
    status =
      hasTargetDong &&
      hasTargetHo
        ? "DONG_UNIT_VERIFIED"
        : hasTargetHo
          ? "UNIT_VERIFIED"
          : "DONG_VERIFIED";

    reason =
      hasTargetDong &&
      hasTargetHo
        ? "전유부에서 입력한 동과 호가 함께 확인되었습니다."
        : hasTargetHo
          ? "전유부에서 입력한 호가 확인되었습니다."
          : "전유부에서 입력한 동이 확인되었습니다.";
  } else if (
    dongMatches.length > 0 &&
    hasTargetHo
  ) {
    status =
      "DONG_VERIFIED_UNIT_NOT_FOUND";

    reason =
      "전유부에서 입력 동은 확인했지만 입력 호는 찾지 못했습니다.";
  } else if (
    unitMatches.length > 0 &&
    hasTargetDong
  ) {
    status =
      "UNIT_VERIFIED_DONG_NOT_FOUND";

    reason =
      "전유부에서 입력 호는 확인했지만 입력 동은 찾지 못했습니다.";
  } else {
    status =
      "DONG_UNIT_NOT_FOUND";

    reason =
      "전유부 데이터는 제공됐지만 입력한 동·호 또는 층 조건을 찾지 못했습니다.";
  }

  const matchedExposPks =
    exactMatches
      .map((candidate) =>
        candidate.exposPk
      )
      .filter(Boolean);

  return {
    checked: true,

    dataProvided:
      exposCandidates.length > 0,

    targetDongRaw:
      detail.dongRaw,

    targetHoRaw:
      detail.hoRaw,

    normalizedTargetDong:
      detail.targetDong,

    normalizedTargetHo:
      detail.targetHo,

    inputFloorType:
      detail.floorType,

    inputFloor:
      detail.inputFloor,

    dongMatched:
      dongMatches.length > 0,

    unitMatched:
      exactMatches.length > 0,

    exactMatched:
      exactMatches.length > 0,

    status,
    reason,

    matchedExposPks,

    dongMatchCount:
      dongMatches.length,

    unitMatchCount:
      unitMatches.length,

    exactMatchCount:
      exactMatches.length,

    exactMatches:
      exactMatches.slice(0, 30),

    dongMatches:
      dongMatches.slice(0, 30),

    unitMatches:
      unitMatches.slice(0, 30)
  };
}

/* =========================================================
 * 표제부 선택
 * ======================================================= */

  /*
   * 4순위:
   * Juso 건물명과 표제부 건물명 비교
   *
   * 빈 문자열은 절대 비교하지 않습니다.
   */
  const jusoBuildingName =
    normalizeCompareText(
      juso?.bdNm || ""
    );

  if (jusoBuildingName) {
    const buildingNameTitles =
      titleCandidates.filter(
        (candidate) => {
          const candidateName =
            normalizeCompareText(
              candidate.buildingName
            );

          /*
           * 핵심 수정:
           * 후보 건물명이 빈 문자열이면 제외
           */
          if (!candidateName) {
            return false;
          }

          return (
            candidateName ===
              jusoBuildingName ||
            candidateName.includes(
              jusoBuildingName
            ) ||
            jusoBuildingName.includes(
              candidateName
            )
          );
        }
      );

    if (
      buildingNameTitles.length === 1
    ) {
      return {
        source:
          "JUSO_BUILDING_NAME_MATCH",

        selected:
          buildingNameTitles[0],

        candidates:
          buildingNameTitles
      };
    }

    if (
      buildingNameTitles.length > 1
    ) {
      return {
        source:
          "JUSO_BUILDING_NAME_MULTIPLE",

        selected: null,

        candidates:
          buildingNameTitles
      };
    }
  }

  /*
   * 5순위:
   * 표제부 후보가 하나뿐일 경우
   */
  if (titleCandidates.length === 1) {
    return {
      source:
        "SINGLE_TITLE",

      selected:
        titleCandidates[0],

      candidates:
        titleCandidates
    };
  }

  /*
   * 6순위:
   * 공동주택 단일 후보
   */
  const residentialTitles =
    titleCandidates.filter(
      isLikelyResidentialTitle
    );

  if (
    residentialTitles.length === 1
  ) {
    return {
      source:
        "SINGLE_RESIDENTIAL_TITLE",

      selected:
        residentialTitles[0],

      candidates:
        residentialTitles
    };
  }

  return {
    source:
      "TITLE_NOT_DETERMINED",

    selected: null,

    candidates:
      residentialTitles.length > 0
        ? residentialTitles
        : titleCandidates
  };
}


/* =========================================================
 * 층수 결정
 * ======================================================= */

function determineFloorForCheck(
  detail,
  exposMatch
) {
  /*
   * 입력 층이 직접 있는 경우 우선
   *
   * 예:
   * 11층 1001호
   *
   * 호명이 1001호라고 해서
   * 반드시 10층이라고 판단하지 않습니다.
   */
  if (
    Number.isFinite(
      detail.inputFloor
    )
  ) {
    return {
      floorType:
        detail.floorType,

      floorNumber:
        detail.inputFloor,

      source:
        "DETAIL_ADDRESS"
    };
  }

  /*
   * 전유부 직접 일치 층
   */
  const exactCandidate =
    exposMatch.exactMatches.find(
      (candidate) =>
        Number.isFinite(
          candidate.floorNumber
        )
    );

  if (exactCandidate) {
    return {
      floorType:
        exactCandidate.floorType ||
        "GROUND",

      floorNumber:
        exactCandidate.floorNumber,

      source:
        "EXPOS_REGISTER"
    };
  }

  /*
   * 505호 → 5층 추정
   */
  if (
    Number.isFinite(
      detail.inferredFloor
    )
  ) {
    return {
      floorType:
        "GROUND",

      floorNumber:
        detail.inferredFloor,

      source:
        "INFERRED_FROM_UNIT"
    };
  }

  return {
    floorType: "",
    floorNumber: null,
    source: "UNAVAILABLE"
  };
}

/* =========================================================
 * 층수 범위 검증
 * ======================================================= */

function evaluateSingleTitleFloor(
  title,
  floorInfo
) {
  if (
    !title ||
    !Number.isFinite(
      floorInfo.floorNumber
    )
  ) {
    return {
      checked: false,

      floorWithinRange:
        null,

      status:
        "NOT_CHECKED",

      reason:
        "선택된 표제부 또는 입력 층 정보가 없습니다."
    };
  }

  const inputFloor =
    floorInfo.floorNumber;

  /*
   * 지하층 검증
   */
  if (
    floorInfo.floorType ===
    "UNDERGROUND"
  ) {
    const maxFloor =
      title.undergroundFloorCount;

    if (
      !Number.isFinite(maxFloor)
    ) {
      return {
        checked: true,

        floorWithinRange:
          null,

        status:
          "UNDERGROUND_COUNT_UNAVAILABLE",

        reason:
          "선택된 표제부에서 지하층수를 확인하지 못했습니다."
      };
    }

    return {
      checked: true,

      inputFloorType:
        "UNDERGROUND",

      inputFloor,

      maximumFloor:
        maxFloor,

      floorWithinRange:
        inputFloor <= maxFloor,

      status:
        inputFloor <= maxFloor
          ? "FLOOR_WITHIN_RANGE"
          : "UNDERGROUND_FLOOR_OUT_OF_RANGE",

      reason:
        inputFloor <= maxFloor
          ? `입력 지하 ${inputFloor}층은 해당 건물의 지하 ${maxFloor}층 범위 안에 있습니다.`
          : `입력 지하 ${inputFloor}층이 해당 건물의 지하층수 ${maxFloor}층을 초과합니다.`
    };
  }

  /*
   * 지상층 검증
   */
  const maxFloor =
    title.groundFloorCount;

  if (!Number.isFinite(maxFloor)) {
    return {
      checked: true,

      floorWithinRange:
        null,

      status:
        "GROUND_COUNT_UNAVAILABLE",

      reason:
        "선택된 표제부에서 지상층수를 확인하지 못했습니다."
    };
  }

  return {
    checked: true,

    inputFloorType:
      "GROUND",

    inputFloor,

    maximumFloor:
      maxFloor,

    floorWithinRange:
      inputFloor <= maxFloor,

    status:
      inputFloor <= maxFloor
        ? "FLOOR_WITHIN_RANGE"
        : "GROUND_FLOOR_OUT_OF_RANGE",

    reason:
      inputFloor <= maxFloor
        ? `입력 ${inputFloor}층은 해당 건물의 지상 ${maxFloor}층 범위 안에 있습니다.`
        : `입력 ${inputFloor}층이 해당 건물의 지상층수 ${maxFloor}층을 초과합니다.`
  };
}

function evaluateCandidateFloorRanges(
  titleCandidates,
  floorInfo
) {
  if (
    !Number.isFinite(
      floorInfo.floorNumber
    )
  ) {
    return {
      checked: false,

      inputFloorType:
        floorInfo.floorType,

      inputFloor: null,

      floorSource:
        floorInfo.source,

      withinAnyCandidate:
        null,

      withinAllCandidates:
        null,

      results: []
    };
  }

  const residentialCandidates =
    titleCandidates.filter(
      isLikelyResidentialTitle
    );

  const targets =
    residentialCandidates.length > 0
      ? residentialCandidates
      : titleCandidates;

  const results =
    targets.map(
      (title) => ({
        buildingPk:
          title.buildingPk,

        dongName:
          title.dongName,

        buildingName:
          title.buildingName,

        groundFloorCount:
          title.groundFloorCount,

        undergroundFloorCount:
          title.undergroundFloorCount,

        ...evaluateSingleTitleFloor(
          title,
          floorInfo
        )
      })
    );

  const comparable =
    results.filter(
      (result) =>
        result.floorWithinRange !==
        null
    );

  return {
    checked:
      comparable.length > 0,

    inputFloorType:
      floorInfo.floorType,

    inputFloor:
      floorInfo.floorNumber,

    floorSource:
      floorInfo.source,

    withinAnyCandidate:
      comparable.length > 0
        ? comparable.some(
            (result) =>
              result.floorWithinRange ===
              true
          )
        : null,

    withinAllCandidates:
      comparable.length > 0
        ? comparable.every(
            (result) =>
              result.floorWithinRange ===
              true
          )
        : null,

    results
  };
}

/* =========================================================
 * 최종 판정
 * ======================================================= */

function buildVerification(
  jusoResult,
  titleResult,
  exposResult,
  titleSelection,
  floorInfo,
  selectedFloorCheck,
  candidateFloorCheck
) {
  const buildingVerified =
    jusoResult.matched === true;

  const titleVerified =
    titleResult.matched === true;

  const dongVerified =
    exposResult.dongMatched === true;

  const unitVerified =
    exposResult.exactMatched === true;

  const selectedTitleVerified =
    Boolean(titleSelection.selected);

  let status =
    "NOT_VERIFIED";

  let reason =
    "주소를 확인하지 못했습니다.";

  if (!buildingVerified) {
    status =
      "BASE_ADDRESS_NOT_VERIFIED";

    reason =
      "Juso 기본주소가 확인되지 않았습니다.";
  } else if (!titleVerified) {
    status =
      "BUILDING_REGISTER_DATA_UNAVAILABLE";

    reason =
      "Juso 기본주소는 확인됐지만 정확지번·대표지번·총괄표제부에서 건축물대장 데이터가 제공되지 않았습니다.";
  } else if (unitVerified) {
    if (
      selectedFloorCheck
        .floorWithinRange ===
      false
    ) {
      status =
        "DONG_UNIT_MATCHED_FLOOR_CONFLICT";

      reason =
        "전유부에서 동·호는 확인됐지만 표제부의 지상·지하 층수와 충돌합니다.";
    } else {
      status =
        "DONG_UNIT_VERIFIED";

      reason =
        "전유부에서 입력한 동·호가 확인되었습니다.";
    }
  } else if (
    exposResult.status ===
    "DONG_VERIFIED_UNIT_NOT_FOUND"
  ) {
    status =
      "DONG_VERIFIED_UNIT_NOT_FOUND";

    reason =
      exposResult.reason;
  } else if (
    exposResult.status ===
    "UNIT_VERIFIED_DONG_NOT_FOUND"
  ) {
    status =
      "UNIT_VERIFIED_DONG_NOT_FOUND";

    reason =
      exposResult.reason;
  } else if (
    exposResult.status ===
    "DONG_UNIT_NOT_FOUND"
  ) {
    status =
      "DONG_UNIT_NOT_FOUND";

    reason =
      exposResult.reason;
  } else if (
    exposResult.status ===
    "EXPOS_DATA_UNAVAILABLE"
  ) {
    if (
      selectedFloorCheck
        .floorWithinRange ===
      true
    ) {
      status =
        "BUILDING_FLOOR_RANGE_VERIFIED";

      reason =
        "전유부 데이터는 없지만 입력 층이 선택된 건물의 지상·지하 층수 범위 안에 있습니다.";
    } else if (
      selectedFloorCheck
        .floorWithinRange ===
      false
    ) {
      status =
        "BUILDING_FLOOR_OUT_OF_RANGE";

      reason =
        selectedFloorCheck.reason;
    } else if (
      candidateFloorCheck
        .withinAllCandidates ===
      true
    ) {
      status =
        "EXPOS_UNAVAILABLE_FLOOR_WITHIN_ALL_CANDIDATES";

      reason =
        "전유부 데이터는 없지만 입력 또는 추정 층이 모든 표제부 후보의 층수 범위 안에 있습니다.";
    } else if (
      candidateFloorCheck
        .withinAnyCandidate ===
      true
    ) {
      status =
        "EXPOS_UNAVAILABLE_FLOOR_WITHIN_SOME_CANDIDATES";

      reason =
        "전유부 데이터는 없으며 입력 또는 추정 층이 일부 표제부 후보에서만 가능합니다.";
    } else if (
      candidateFloorCheck
        .withinAnyCandidate ===
      false
    ) {
      status =
        "BUILDING_FLOOR_OUT_OF_RANGE";

      reason =
        "전유부 데이터는 없고 입력 또는 추정 층이 모든 표제부 후보의 층수 범위를 초과합니다.";
    } else {
      status =
        "EXPOS_DATA_UNAVAILABLE";

      reason =
        "건축물대장 전유부 데이터가 제공되지 않아 동·호를 확인하지 못했습니다.";
    }
  } else if (
    selectedTitleVerified &&
    selectedFloorCheck
      .floorWithinRange ===
    false
  ) {
    status =
      "BUILDING_FLOOR_OUT_OF_RANGE";

    reason =
      selectedFloorCheck.reason;
  } else if (
    selectedTitleVerified
  ) {
    status =
      titleResult.usedFallback
        ? "BUILDING_REGISTER_FALLBACK_MATCHED"
        : "BUILDING_TITLE_VERIFIED";

    reason =
      titleResult.usedFallback
        ? "Juso 정확지번에서는 표제부가 조회되지 않았지만 대표지번 또는 총괄표제부에서 건물을 확인했습니다."
        : "건축물대장 표제부 후보는 확인됐지만 동·호는 확인되지 않았습니다.";
  } else {
    status =
      "BUILDING_MULTIPLE_TITLE_UNRESOLVED";

    reason =
      "표제부 후보가 여러 건이며 입력 상세주소와 연결되는 건물을 확정하지 못했습니다.";
  }

  return {
    buildingVerified,
    titleVerified,

    buildingRegisterFallbackUsed:
      titleResult.usedFallback,

    buildingRegisterLookupOperation:
      titleResult.lookupOperation,

    buildingRegisterLookupSource:
      titleResult.lookupSource,

    exposDataProvided:
      exposResult.dataProvided,

    dongVerified,
    unitVerified,

    selectedTitleVerified,

    selectedBuildingPk:
      titleSelection.selected
        ?.buildingPk || "",

    selectedDongName:
      titleSelection.selected
        ?.dongName || "",

    /*
     * 최종 선택 건물 지상층수
     */
    groundFloorCount:
      titleSelection.selected
        ?.groundFloorCount ??
      null,

    /*
     * 최종 선택 건물 지하층수
     */
    undergroundFloorCount:
      titleSelection.selected
        ?.undergroundFloorCount ??
      null,

    floorSource:
      floorInfo.source,

    inputFloorType:
      floorInfo.floorType,

    inputFloor:
      floorInfo.floorNumber,

    floorWithinSelectedBuilding:
      selectedFloorCheck
        .floorWithinRange,

    floorWithinAnyCandidate:
      candidateFloorCheck
        .withinAnyCandidate,

    floorWithinAllCandidates:
      candidateFloorCheck
        .withinAllCandidates,

    status,
    reason,

    verificationScope: {
      baseAddress:
        "JUSO_BASIC_ADDRESS",

      buildingTitle:
        "BUILDING_REGISTER_TITLE_WITH_MAIN_JIBUN_AND_RECAP_FALLBACK",

      buildingFloorCount:
        "BUILDING_REGISTER_GROUND_UNDERGROUND",

      dongUnit:
        "BUILDING_REGISTER_EXPOS",

      unitFloorFallback:
        "INFERRED_FROM_UNIT"
    }
  };
}

/* =========================================================
 * 주소 1건 검증
 * ======================================================= */

async function validateOneAddress(
  item,
  options = {}
) {
  const orderNo =
    cleanText(
      item?.orderNo
    );

  const baseAddress =
    cleanText(
      item?.baseAddress
    );

  const detailAddress =
    normalizeDetailAddress(
      item?.detailAddress
    ).clean;

  const detail =
    parseDetailAddress(
      detailAddress
    );

  if (!baseAddress) {
    return {
      orderNo,
      baseAddress,
      detailAddress,

      verification: {
        buildingVerified: false,
        titleVerified: false,
        dongVerified: false,
        unitVerified: false,

        status:
          "EMPTY_BASE_ADDRESS",

        reason:
          "기본주소가 없습니다."
      }
    };
  }

  /*
   * 1. Juso 기본주소
   */
  const rawJuso =
    await searchJuso(
      baseAddress
    );

  const jusoResult =
    parseJusoResult(
      baseAddress,
      orderNo,
      rawJuso
    );

  if (
    !jusoResult.matched ||
    !jusoResult.selected
  ) {
    return {
      orderNo,
      baseAddress,
      detailAddress,
      detail,

      jusoResult,

      verification: {
        buildingVerified: false,
        titleVerified: false,
        dongVerified: false,
        unitVerified: false,

        status:
          jusoResult.status,

        reason:
          jusoResult.message
      }
    };
  }

  /*
   * 2. 기본 지번 파라미터
   */
  const buildingParams =
    buildBuildingParams(
      jusoResult.selected
    );

  if (!buildingParams.valid) {
    return {
      orderNo,
      baseAddress,
      detailAddress,
      detail,

      jusoResult,
      buildingParams,

      verification: {
        buildingVerified: true,
        titleVerified: false,
        dongVerified: false,
        unitVerified: false,

        status:
          "BUILDING_PARAMS_MISSING",

        reason:
          buildingParams.reason
      }
    };
  }

  /*
   * 3. 표제부 조회
   *
   * 정확지번 → 대표지번
   * → 총괄표제부 정확지번
   * → 총괄표제부 대표지번
   */
  const titleRawResult =
    await searchBuildingTitlesWithFallback(
      jusoResult.selected
    );

  const titleCandidates =
    titleRawResult.items.map(
      mapTitleCandidate
    );

  const usedFallback =
    Boolean(
      titleRawResult.matched &&
      (
        titleRawResult.lookupSource !==
          "JUSO_EXACT_JIBUN" ||
        titleRawResult.operation !==
          "getBrTitleInfo"
      )
    );

  const titleResult = {
    checked: true,

    matched:
      titleCandidates.length > 0,

    status:
      titleCandidates.length === 0
        ? "TITLE_NOT_FOUND"
        : titleCandidates.length === 1
          ? "TITLE_MATCHED"
          : "TITLE_MULTIPLE_MATCH",

    lookupOperation:
      titleRawResult.operation,

    lookupSource:
      titleRawResult.lookupSource,

    usedFallback,

    matchedParams:
      titleRawResult.matchedParams,

    lookupAttempts:
      titleRawResult.attempts,

    totalCount:
      titleRawResult.totalCount,

    loadedCount:
      titleRawResult.loadedCount,

    pageCount:
      titleRawResult.pageCount,

    truncated:
      titleRawResult.truncated,

    candidates:
      titleCandidates.map(
        (candidate) => ({
          ...candidate,

          raw:
            options.includeRaw === true
              ? candidate.raw
              : undefined
        })
      )
  };

  /*
   * 4. 전유부 조회
   *
   * 표제부가 성공한 지번을 우선 사용하고,
   * 실패하면 정확지번·대표지번을 순차 조회합니다.
   */
  const exposRawResult =
    await searchExposWithFallback(
      jusoResult.selected,
      titleRawResult.matchedParams,
      {
        exposRowsPerPage:
          options.exposRowsPerPage,

        exposMaxPages:
          options.exposMaxPages
      }
    );

  const exposCandidates =
    exposRawResult.items.map(
      mapExposCandidate
    );

  /*
   * 5. 상세주소 비교
   */
  const exposMatch =
    evaluateExposMatch(
      detail,
      exposCandidates
    );

  const exposResult = {
    ...exposMatch,

    lookupOperation:
      exposRawResult.operation,

    lookupSource:
      exposRawResult.lookupSource,

    lookupParams:
      exposRawResult.matchedParams,

    lookupAttempts:
      exposRawResult.attempts,

    totalCount:
      exposRawResult.totalCount,

    loadedCount:
      exposRawResult.loadedCount,

    pageCount:
      exposRawResult.pageCount,

    truncated:
      exposRawResult.truncated,

    candidates:
      exposCandidates
        .slice(
          0,
          options.includeAllExpos ===
          true
            ? exposCandidates.length
            : 100
        )
        .map((candidate) => ({
          ...candidate,

          raw:
            options.includeRaw === true
              ? candidate.raw
              : undefined
        }))
  };

function selectMatchedTitle(
  titleCandidates,
  exposMatch,
  detail,
  juso
) {
  /*
   * 1순위:
   * 전유부에서 동·호가 일치한 동명으로 표제부 선택
   */
  const matchedDongNames =
    new Set(
      exposMatch.exactMatches
        .map((candidate) =>
          normalizeDongName(
            candidate.dongName
          )
        )
        .filter(Boolean)
    );

  if (matchedDongNames.size > 0) {
    const exposDongTitles =
      titleCandidates.filter(
        (candidate) =>
          matchedDongNames.has(
            normalizeDongName(
              candidate.dongName
            )
          )
      );

    if (exposDongTitles.length > 0) {
      return {
        source:
          "EXPOS_DONG_UNIT_MATCH",

        selected:
          exposDongTitles[0],

        candidates:
          exposDongTitles
      };
    }
  }

  /*
   * 2순위:
   * 입력 동과 표제부 동명 일치
   */
  if (detail.targetDong) {
    const dongTitles =
      titleCandidates.filter(
        (candidate) =>
          normalizeDongName(
            candidate.dongName
          ) ===
          detail.targetDong
      );

    if (dongTitles.length > 0) {
      return {
        source:
          "TITLE_DONG_MATCH",

        selected:
          dongTitles[0],

        candidates:
          dongTitles
      };
    }
  }

  /*
   * 3순위:
   * Juso 도로명주소와 표제부 도로명주소 정확 비교
   *
   * 대형 복합대지에서는 동일 지번에 건물이 여러 개 있으므로
   * 건물명보다 도로명주소 일치를 우선합니다.
   */
  const jusoRoadAddress =
    normalizeRoadAddressForCompare(
      juso?.roadAddrPart1 ||
      juso?.roadAddr ||
      ""
    );

  if (jusoRoadAddress) {
    const roadAddressMatches =
      titleCandidates.filter(
        (candidate) => {
          const candidateRoadAddress =
            normalizeRoadAddressForCompare(
              candidate.roadAddress
            );

          return (
            candidateRoadAddress &&
            candidateRoadAddress ===
              jusoRoadAddress
          );
        }
      );

    /*
     * 도로명주소가 하나만 일치하면 바로 선택
     */
    if (
      roadAddressMatches.length === 1
    ) {
      return {
        source:
          "ROAD_ADDRESS_EXACT_MATCH",

        selected:
          roadAddressMatches[0],

        candidates:
          roadAddressMatches
      };
    }

    /*
     * 같은 도로명주소 후보가 여러 개라면
     * 건물명·용도·층수 점수로 선택
     */
    if (
      roadAddressMatches.length > 1
    ) {
      const scoredMatches =
        roadAddressMatches
          .map((candidate) => ({
            candidate,

            score:
              calculateTitleCandidateScore(
                candidate,
                juso,
                detail
              )
          }))
          .sort(
            (a, b) =>
              b.score - a.score
          );

      if (
        scoredMatches.length > 0 &&
        scoredMatches[0].score >
          scoredMatches[1]?.score
      ) {
        return {
          source:
            "ROAD_ADDRESS_SCORED_MATCH",

          selected:
            scoredMatches[0]
              .candidate,

          candidates:
            roadAddressMatches,

          scores:
            scoredMatches.map(
              (item) => ({
                buildingPk:
                  item.candidate
                    .buildingPk,

                buildingName:
                  item.candidate
                    .buildingName,

                dongName:
                  item.candidate
                    .dongName,

                score:
                  item.score
              })
            )
        };
      }

      return {
        source:
          "ROAD_ADDRESS_MULTIPLE_MATCH",

        selected: null,

        candidates:
          roadAddressMatches
      };
    }
  }

  /*
   * 4순위:
   * Juso 건물명과 표제부 건물명 비교
   *
   * 빈 문자열은 절대 비교하지 않습니다.
   */
  const jusoBuildingName =
    normalizeCompareText(
      juso?.bdNm || ""
    );

  if (jusoBuildingName) {
    const buildingNameTitles =
      titleCandidates.filter(
        (candidate) => {
          const candidateName =
            normalizeCompareText(
              candidate.buildingName
            );

          /*
           * 핵심 수정:
           * 후보 건물명이 빈 문자열이면 제외
           */
          if (!candidateName) {
            return false;
          }

          return (
            candidateName ===
              jusoBuildingName ||
            candidateName.includes(
              jusoBuildingName
            ) ||
            jusoBuildingName.includes(
              candidateName
            )
          );
        }
      );

    if (
      buildingNameTitles.length === 1
    ) {
      return {
        source:
          "JUSO_BUILDING_NAME_MATCH",

        selected:
          buildingNameTitles[0],

        candidates:
          buildingNameTitles
      };
    }

    if (
      buildingNameTitles.length > 1
    ) {
      return {
        source:
          "JUSO_BUILDING_NAME_MULTIPLE",

        selected: null,

        candidates:
          buildingNameTitles
      };
    }
  }

  /*
   * 5순위:
   * 표제부 후보가 하나뿐일 경우
   */
  if (titleCandidates.length === 1) {
    return {
      source:
        "SINGLE_TITLE",

      selected:
        titleCandidates[0],

      candidates:
        titleCandidates
    };
  }

  /*
   * 6순위:
   * 공동주택 단일 후보
   */
  const residentialTitles =
    titleCandidates.filter(
      isLikelyResidentialTitle
    );

  if (
    residentialTitles.length === 1
  ) {
    return {
      source:
        "SINGLE_RESIDENTIAL_TITLE",

      selected:
        residentialTitles[0],

      candidates:
        residentialTitles
    };
  }

  return {
    source:
      "TITLE_NOT_DETERMINED",

    selected: null,

    candidates:
      residentialTitles.length > 0
        ? residentialTitles
        : titleCandidates
  };
}  
  /*
   * 6. 표제부 최종 선택
   */

/* =========================================================
 * 표제부 선택 보조 함수
 * ======================================================= */
  
function normalizeRoadAddressForCompare(value) {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function calculateTitleCandidateScore(
  candidate,
  juso,
  detail
) {
  let score = 0;

  const candidateRoadAddress =
    normalizeRoadAddressForCompare(
      candidate.roadAddress
    );

  const jusoRoadAddress =
    normalizeRoadAddressForCompare(
      juso?.roadAddrPart1 ||
      juso?.roadAddr ||
      ""
    );

  if (
    candidateRoadAddress &&
    jusoRoadAddress &&
    candidateRoadAddress ===
      jusoRoadAddress
  ) {
    score += 100;
  }

  const candidateName =
    normalizeCompareText(
      candidate.buildingName
    );

  const candidateDongName =
    normalizeCompareText(
      candidate.dongName
    );

  const jusoBuildingName =
    normalizeCompareText(
      juso?.bdNm || ""
    );

  if (
    candidateName &&
    jusoBuildingName &&
    candidateName ===
      jusoBuildingName
  ) {
    score += 80;
  } else if (
    candidateName &&
    jusoBuildingName &&
    (
      candidateName.includes(
        jusoBuildingName
      ) ||
      jusoBuildingName.includes(
        candidateName
      )
    )
  ) {
    score += 50;
  }

  if (
    detail.targetDong &&
    normalizeDongName(
      candidate.dongName
    ) === detail.targetDong
  ) {
    score += 80;
  }

  const inputFloor =
    Number.isFinite(
      detail.inputFloor
    )
      ? detail.inputFloor
      : detail.inferredFloor;

  if (
    Number.isFinite(inputFloor)
  ) {
    if (
      detail.floorType ===
        "UNDERGROUND"
    ) {
      if (
        Number.isFinite(
          candidate
            .undergroundFloorCount
        ) &&
        inputFloor <=
          candidate
            .undergroundFloorCount
      ) {
        score += 20;
      } else {
        score -= 50;
      }
    } else {
      if (
        Number.isFinite(
          candidate
            .groundFloorCount
        ) &&
        inputFloor <=
          candidate
            .groundFloorCount
      ) {
        score += 20;
      } else {
        score -= 50;
      }
    }
  }

  const purposeText =
    normalizeCompareText(
      [
        candidate.mainPurpose,
        candidate.otherPurpose
      ].join(" ")
    );

  if (
    purposeText.includes("업무시설")
  ) {
    score += 10;
  }

  if (
    !candidateName &&
    !candidateDongName
  ) {
    score -= 30;
  }

  return score;
}
  
  const titleSelection =
    selectMatchedTitle(
      titleCandidates,
      exposMatch,
      detail,
      jusoResult.selected
    );

  /*
   * 7. 검증할 층 결정
   */
  const floorInfo =
    determineFloorForCheck(
      detail,
      exposMatch
    );

  /*
   * 8. 선택된 건물의 지상·지하 층수와 비교
   */
  const selectedFloorCheck =
    evaluateSingleTitleFloor(
      titleSelection.selected,
      floorInfo
    );

  /*
   * 9. 선택 건물이 없으면 후보 전체 비교
   */
  const candidateFloorCheck =
    evaluateCandidateFloorRanges(
      titleSelection.candidates,
      floorInfo
    );

  /*
   * 10. 최종 판정
   */
  const verification =
    buildVerification(
      jusoResult,
      titleResult,
      exposResult,
      titleSelection,
      floorInfo,
      selectedFloorCheck,
      candidateFloorCheck
    );

  return {
    orderNo,
    baseAddress,
    detailAddress,

    detail,

    jusoResult,

    buildingRegister: {
      requestParams:
        buildingParams,

      lookupOperation:
        titleResult.lookupOperation,

      lookupSource:
        titleResult.lookupSource,

      fallbackUsed:
        titleResult.usedFallback,

      matchedParams:
        titleResult.matchedParams,

      lookupAttempts:
        titleResult.lookupAttempts,

      checked:
        titleResult.checked,

      matched:
        titleResult.matched,

      status:
        titleResult.status,

      totalCount:
        titleResult.totalCount,

      loadedCount:
        titleResult.loadedCount,

      pageCount:
        titleResult.pageCount,

      truncated:
        titleResult.truncated,

      candidates:
        titleResult.candidates,

      selectedSource:
        titleSelection.source,

      selected:
        titleSelection.selected
          ? {
              ...titleSelection.selected,

              raw:
                options.includeRaw ===
                true
                  ? titleSelection
                      .selected
                      .raw
                  : undefined
            }
          : null,

      /*
       * 표제부 후보별 지상·지하 층수 유지
       */
      floorCandidates:
        titleCandidates.map(
          (candidate) => ({
            buildingPk:
              candidate.buildingPk,

            dongName:
              candidate.dongName,

            buildingName:
              candidate.buildingName,

            groundFloorCount:
              candidate
                .groundFloorCount,

            undergroundFloorCount:
              candidate
                .undergroundFloorCount,

            mainPurpose:
              candidate.mainPurpose,

            otherPurpose:
              candidate.otherPurpose
          })
        )
    },

    exposRegister:
      exposResult,

    floorCheck: {
      floorInfo,

      selectedBuilding:
        selectedFloorCheck,

      allCandidates:
        candidateFloorCheck
    },

    verification
  };
}

/* =========================================================
 * 기본 경로
 * ======================================================= */

app.get("/", (req, res) => {
  return res.json({
    ok: true,

    service:
      "address-validator-api",

    step: 4,

    process: [
      "JUSO_BASIC_ADDRESS",

      "BUILDING_REGISTER_EXACT_TITLE",

      "BUILDING_REGISTER_MAIN_JIBUN_FALLBACK",

      "BUILDING_REGISTER_RECAP_TITLE_FALLBACK",

      "BUILDING_GROUND_UNDERGROUND_FLOORS",

      "BUILDING_REGISTER_EXPOS",

      "DONG_UNIT_FLOOR_MATCH",

      "FINAL_VERIFICATION"
    ],

    message:
      "Address validator API is running"
  });
});

app.get("/health", (req, res) => {
  return res.json({
    ok: true,

    service:
      "address-validator-api",

    step: 4,

    jusoApiConfigured:
      Boolean(JUSO_API_KEY),

    publicDataApiConfigured:
      Boolean(
        PUBLIC_DATA_API_KEY
      ),

    timestamp:
      new Date().toISOString()
  });
});

/* =========================================================
 * 단일 주소 디버그
 * ======================================================= */

app.post(
  "/debug-address",
  checkSecret,
  async (req, res) => {
    try {
      const result =
        await validateOneAddress(
          {
            orderNo:
              req.body?.orderNo ||
              "DEBUG",

            baseAddress:
              req.body?.baseAddress,

            detailAddress:
              req.body?.detailAddress
          },
          {
            includeRaw:
              req.body?.includeRaw ===
              true,

            includeAllExpos:
              req.body
                ?.includeAllExpos ===
              true,

            exposRowsPerPage:
              req.body
                ?.exposRowsPerPage ||
              100,

            exposMaxPages:
              req.body
                ?.exposMaxPages ||
              30
          }
        );

      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      console.error(error);

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

/*
 * 기존 URL 유지
 */
app.post(
  "/debug-juso-detail-list",
  checkSecret,
  async (req, res) => {
    try {
      const result =
        await validateOneAddress(
          {
            orderNo:
              req.body?.orderNo ||
              "DEBUG",

            baseAddress:
              req.body?.baseAddress,

            detailAddress:
              req.body?.detailAddress
          },
          {
            includeRaw:
              req.body?.includeRaw ===
              true,

            includeAllExpos:
              req.body
                ?.includeAllExpos ===
              true,

            exposRowsPerPage:
              req.body
                ?.exposRowsPerPage ||
              100,

            exposMaxPages:
              req.body
                ?.exposMaxPages ||
              30
          }
        );

      return res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      console.error(error);

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
 * 일괄 검증
 * ======================================================= */

app.post(
  "/validate-addresses",
  checkSecret,
  async (req, res) => {
    try {
      const items =
        Array.isArray(
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

      /*
       * 전유부·폴백 조회는 호출 수가 많을 수 있으므로
       * 일단 요청당 10건 제한
       */
      if (items.length > 10) {
        return res.status(400).json({
          ok: false,

          message:
            "한 번에 최대 10건까지만 허용합니다."
        });
      }

      const results = [];

      for (const item of items) {
        try {
          const result =
            await validateOneAddress(
              item,
              {
                includeRaw:
                  req.body
                    ?.includeRaw ===
                  true,

                includeAllExpos:
                  false,

                exposRowsPerPage:
                  req.body
                    ?.exposRowsPerPage ||
                  100,

                exposMaxPages:
                  req.body
                    ?.exposMaxPages ||
                  30
              }
            );

          results.push(result);
        } catch (error) {
          results.push({
            orderNo:
              cleanText(
                item?.orderNo
              ),

            baseAddress:
              cleanText(
                item?.baseAddress
              ),

            detailAddress:
              normalizeDetailAddress(
                item?.detailAddress
              ).clean,

            verification: {
              buildingVerified: false,
              titleVerified: false,
              dongVerified: false,
              unitVerified: false,

              status:
                "REQUEST_ERROR",

              reason:
                error instanceof Error
                  ? error.message
                  : String(error)
            }
          });
        }
      }

      return res.json({
        ok: true,

        step: 4,

        count:
          results.length,

        results
      });
    } catch (error) {
      console.error(error);

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
 * 404
 * ======================================================= */

app.use((req, res) => {
  return res.status(404).json({
    ok: false,

    message:
      "요청한 API 경로가 없습니다."
  });
});

/* =========================================================
 * 오류 처리
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
 * Railway 실행
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
