"use strict";

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);

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
      if (
        !origin ||
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error(
          "허용되지 않은 Origin입니다."
        )
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
 * API 인증
 * ======================================================= */

function checkSecret(
  req,
  res,
  next
) {
  if (!API_SECRET) {
    return next();
  }

  const requestSecret = String(
    req.headers["x-api-secret"] || ""
  );

  if (
    requestSecret !== API_SECRET
  ) {
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

function normalizeCompareText(
  value
) {
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

function padJibunNumber(
  value
) {
  const digits = String(
    value ?? ""
  ).replace(/\D/g, "");

  return digits
    ? digits.padStart(4, "0")
    : "0000";
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function pickFirstValue(
  row,
  keys
) {
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
 * 동·호 정규화
 * ======================================================= */

function normalizeDongName(
  value
) {
  let text = String(
    value ?? ""
  )
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^제/, "")
    .replace(/동$/, "");

  if (
    /^\d+$/.test(text)
  ) {
    text = text.replace(
      /^0+(?=\d)/,
      ""
    );
  }

  return text;
}

function normalizeHoName(
  value
) {
  let text = String(
    value ?? ""
  )
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^제/, "")
    .replace(
      /^(?:지하\d+층|\d+층)/,
      ""
    )
    .replace(/호$/, "");

  if (
    /^\d+$/.test(text)
  ) {
    text = text.replace(
      /^0+(?=\d)/,
      ""
    );
  }

  return text;
}

function extractFloorFromHoName(
  value
) {
  const text = String(
    value ?? ""
  )
    .replace(/\s+/g, "")
    .trim();

  let match = text.match(
    /^지하(\d+)층/
  );

  if (match) {
    return {
      floorType:
        "UNDERGROUND",

      floorNumber:
        Number(match[1])
    };
  }

  match = text.match(
    /^(\d+)층/
  );

  if (match) {
    return {
      floorType:
        "GROUND",

      floorNumber:
        Number(match[1])
    };
  }

  return {
    floorType: "",
    floorNumber: null
  };
}

/* =========================================================
 * addressAnalyzer.js 결과 정규화
 * ======================================================= */

function normalizeIncomingJuso(value) {
  const juso = value && typeof value === "object"
    ? value
    : {};

  return {
    roadAddr:
      cleanText(juso.roadAddr),

    roadAddrPart1:
      cleanText(
        juso.roadAddrPart1 ||
        juso.roadAddr
      ),

    roadAddrPart2:
      cleanText(juso.roadAddrPart2),

    jibunAddr:
      cleanText(juso.jibunAddr),

    zipNo:
      cleanText(juso.zipNo),

    admCd:
      cleanText(juso.admCd),

    rnMgtSn:
      cleanText(juso.rnMgtSn),

    udrtYn:
      cleanText(juso.udrtYn || "0"),

    buldMnnm:
      cleanText(juso.buldMnnm),

    buldSlno:
      cleanText(juso.buldSlno || "0"),

    bdMgtSn:
      cleanText(juso.bdMgtSn),

    mtYn:
      cleanText(juso.mtYn || "0"),

    lnbrMnnm:
      cleanText(juso.lnbrMnnm),

    lnbrSlno:
      cleanText(juso.lnbrSlno || "0"),

    bdNm:
      cleanText(juso.bdNm),

    detBdNmList:
      cleanText(juso.detBdNmList),

    siNm:
      cleanText(juso.siNm),

    sggNm:
      cleanText(juso.sggNm),

    emdNm:
      cleanText(juso.emdNm),

    liNm:
      cleanText(juso.liNm),

    rn:
      cleanText(juso.rn)
  };
}

function toNullableNumber(value) {
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

function inferFloorFromHo(value) {
  const digits = String(
    value ?? ""
  ).replace(/\D/g, "");

  if (digits.length === 3) {
    return Number(
      digits.slice(0, 1)
    );
  }

  if (digits.length === 4) {
    return Number(
      digits.slice(0, 2)
    );
  }

  return null;
}

function normalizeIncomingDetail(value) {
  const detail = value && typeof value === "object"
    ? value
    : {};

  const dongRaw = cleanText(
    detail.dongRaw ||
    detail.dong ||
    ""
  );

  const floorRaw = cleanText(
    detail.floorRaw ||
    detail.floor ||
    ""
  );

  const hoRaw = cleanText(
    detail.hoRaw ||
    detail.ho ||
    ""
  );

  let floorType =
    cleanText(detail.floorType)
      .toUpperCase();

  if (
    ![
      "GROUND",
      "UNDERGROUND"
    ].includes(floorType)
  ) {
    floorType =
      floorRaw.includes("지하")
        ? "UNDERGROUND"
        : floorRaw
          ? "GROUND"
          : "";
  }

  let inputFloor =
    toNullableNumber(
      detail.inputFloor
    );

  if (
    inputFloor === null &&
    floorRaw
  ) {
    const match =
      floorRaw.match(/(\d+)/u);

    if (match) {
      inputFloor =
        Number(match[1]);
    }
  }

  let inferredFloor =
    toNullableNumber(
      detail.inferredFloor
    );

  if (
    inferredFloor === null &&
    floorType !== "UNDERGROUND"
  ) {
    inferredFloor =
      inferFloorFromHo(hoRaw);
  }

  return {
    raw:
      cleanText(
        detail.raw ||
        detail.original ||
        ""
      ),

    clean:
      cleanText(
        detail.clean ||
        detail.normalized ||
        [
          dongRaw,
          floorRaw,
          hoRaw
        ]
          .filter(Boolean)
          .join(" ")
      ),

    pattern:
      cleanText(
        detail.pattern ||
        detail.type ||
        ""
      ),

    dongRaw,
    floorRaw,
    hoRaw,

    targetDong:
      cleanText(
        detail.targetDong
      ) ||
      normalizeDongName(
        dongRaw
      ),

    targetHo:
      cleanText(
        detail.targetHo
      ) ||
      normalizeHoName(
        hoRaw
      ),

    floorType,
    inputFloor,
    inferredFloor
  };
}

function formatTotalFloorText(
  groundFloorCount,
  undergroundFloorCount
) {
  const parts = [];

  if (
    Number.isFinite(
      groundFloorCount
    ) &&
    groundFloorCount > 0
  ) {
    parts.push(
      `지상 ${groundFloorCount}층`
    );
  }

  if (
    Number.isFinite(
      undergroundFloorCount
    ) &&
    undergroundFloorCount > 0
  ) {
    parts.push(
      `지하 ${undergroundFloorCount}층`
    );
  }

  return parts.join(" / ");
}

function getLastAttemptError(
  attempts
) {
  if (!Array.isArray(attempts)) {
    return "";
  }

  const failed =
    [...attempts]
      .reverse()
      .find(
        (attempt) =>
          attempt?.success === false &&
          attempt?.error
      );

  return failed?.error || "";
}

/* =========================================================
 * 건축물대장 조회 파라미터
 * ======================================================= */

function buildBuildingParams(
  juso
) {
  const admCd = String(
    juso?.admCd || ""
  );

  if (
    admCd.length < 10
  ) {
    return {
      valid: false,

      reason:
        "Juso admCd 값이 없습니다."
    };
  }

  if (
    !juso?.lnbrMnnm
  ) {
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
      String(
        juso?.mtYn || "0"
      ) === "1"
        ? "1"
        : "0",

    bun:
      padJibunNumber(
        juso?.lnbrMnnm
      ),

    ji:
      padJibunNumber(
        juso?.lnbrSlno ||
        "0"
      )
  };
}

function buildBuildingParamCandidates(
  juso
) {
  const exact =
    buildBuildingParams(
      juso
    );

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

  if (
    exact.ji !== "0000"
  ) {
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
 * 건축HUB API
 * ======================================================= */

async function fetchBuildingHubPage(
  operation,
  params,
  pageNo = 1,
  numOfRows = 100
) {
  if (
    !PUBLIC_DATA_API_KEY
  ) {
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

  const response =
    await fetch(
      url.toString(),
      {
        method: "GET",

        signal:
          AbortSignal.timeout(
            20000
          )
      }
    );

  const text =
    await response.text();

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
    data?.response?.header ||
    {};

  const resultCode =
    String(
      header?.resultCode ||
      ""
    );

  const resultMessage =
    String(
      header?.resultMsg ||
      ""
    );

  if (
    resultCode &&
    ![
      "00",
      "0000"
    ].includes(resultCode)
  ) {
    throw new Error(
      `${operation} API 오류: ${resultCode} / ${resultMessage}`
    );
  }

  const body =
    data?.response?.body ||
    {};

  const items =
    toArray(
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

    items
  };
}

async function fetchAllBuildingHubItems(
  operation,
  params,
  options = {}
) {
  const numOfRows =
    Number(
      options.numOfRows ||
      100
    );

  const maxPages =
    Number(
      options.maxPages ||
      30
    );

  const first =
    await fetchBuildingHubPage(
      operation,
      params,
      1,
      numOfRows
    );

  const items = [
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

    items.push(
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
      items.length,

    pageCount:
      totalPages,

    truncated:
      totalPages <
      realTotalPages,

    items
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

  const operations = [
    "getBrTitleInfo",
    "getBrRecapTitleInfo"
  ];

  for (
    const operation
    of operations
  ) {
    for (
      const params
      of paramCandidates
    ) {
      if (
        params.valid === false
      ) {
        attempts.push({
          operation,

          lookupSource:
            "INVALID_PARAMS",

          params,

          success:
            false,

          totalCount:
            0,

          error:
            params.reason
        });

        continue;
      }

      try {
        const result =
          await fetchAllBuildingHubItems(
            operation,
            params,
            {
              numOfRows:
                100,

              maxPages:
                10
            }
          );

        attempts.push({
          operation,

          lookupSource:
            params.lookupSource,

          params,

          success:
            true,

          totalCount:
            result.totalCount
        });

        if (
          result.items.length > 0
        ) {
          return {
            matched:
              true,

            operation,

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
          operation,

          lookupSource:
            params.lookupSource,

          params,

          success:
            false,

          totalCount:
            0,

          error:
            error instanceof Error
              ? error.message
              : String(error)
        });
      }
    }
  }

  return {
    matched:
      false,

    operation:
      "",

    lookupSource:
      "ALL_LOOKUPS_FAILED",

    matchedParams:
      null,

    attempts,

    resultCode:
      "",

    resultMessage:
      "",

    totalCount:
      0,

    loadedCount:
      0,

    pageCount:
      0,

    truncated:
      false,

    items:
      []
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
  const candidates = [];

  if (
    preferredParams &&
    preferredParams.valid !== false
  ) {
    candidates.push({
      ...preferredParams,

      lookupSource:
        preferredParams.lookupSource ||
        "TITLE_MATCHED_PARAMS"
    });
  }

  for (
    const params
    of buildBuildingParamCandidates(
      juso
    )
  ) {
    if (
      params.valid === false
    ) {
      continue;
    }

    const duplicate =
      candidates.some(
        (item) =>
          item.sigunguCd ===
            params.sigunguCd &&
          item.bjdongCd ===
            params.bjdongCd &&
          item.platGbCd ===
            params.platGbCd &&
          item.bun ===
            params.bun &&
          item.ji ===
            params.ji
      );

    if (!duplicate) {
      candidates.push(params);
    }
  }

  const attempts = [];

  for (
    const params
    of candidates
  ) {
    try {
      const result =
        await fetchAllBuildingHubItems(
          "getBrExposInfo",
          params,
          {
            numOfRows:
              Number(
                options
                  .exposRowsPerPage ||
                100
              ),

            maxPages:
              Number(
                options
                  .exposMaxPages ||
                3
              )
          }
        );

      attempts.push({
        operation:
          "getBrExposInfo",

        lookupSource:
          params.lookupSource,

        params,

        success:
          true,

        totalCount:
          result.totalCount
      });

      if (
        result.items.length > 0
      ) {
        return {
          matched:
            true,

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

        success:
          false,

        totalCount:
          0,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  return {
    matched:
      false,

    operation:
      "getBrExposInfo",

    lookupSource:
      "ALL_LOOKUPS_FAILED",

    matchedParams:
      null,

    attempts,

    resultCode:
      "",

    resultMessage:
      "",

    totalCount:
      0,

    loadedCount:
      0,

    pageCount:
      0,

    truncated:
      false,

    items:
      []
  };
}

/* =========================================================
 * 표제부 데이터 매핑
 * ======================================================= */

function mapTitleCandidate(
  item
) {
  return {
    buildingPk:
      String(
        item?.mgmBldrgstPk ||
        ""
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

    groundFloorCount:
      toNumberOrNull(
        item?.grndFlrCnt
      ),

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

    raw:
      item
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

  return [
    "공동주택",
    "아파트",
    "연립주택",
    "다세대"
  ].some(
    (word) =>
      text.includes(word)
  );
}

/* =========================================================
 * 전유부 데이터 매핑
 * ======================================================= */

function mapExposCandidate(
  item
) {
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

  const floorNumber =
    rawFloorNumber !== null &&
    rawFloorNumber !== 0
      ? rawFloorNumber
      : parsedFloor.floorNumber;

  const floorType =
    parsedFloor.floorType ||
    (
      String(
        item?.flrGbCdNm ||
        ""
      ).includes("지하")
        ? "UNDERGROUND"
        : String(
            item?.flrGbCdNm ||
            ""
          ).includes("지상")
          ? "GROUND"
          : ""
    );

  return {
    exposPk:
      String(
        item?.mgmBldrgstPk ||
        ""
      ),

    buildingName:
      item?.bldNm || "",

    dongName:
      String(
        dongName || ""
      ),

    hoName:
      String(
        hoName || ""
      ),

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

    raw:
      item
  };
}

/* =========================================================
 * 전유부 동·호 비교
 * ======================================================= */

function evaluateExposMatch(
  detail,
  exposCandidates
) {
  const hasTargetDong =
    Boolean(
      detail.targetDong
    );

  const hasTargetHo =
    Boolean(
      detail.targetHo
    );

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

  return {
    checked:
      true,

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

    matchedExposPks:
      exactMatches
        .map(
          (candidate) =>
            candidate.exposPk
        )
        .filter(Boolean),

    dongMatchCount:
      dongMatches.length,

    unitMatchCount:
      unitMatches.length,

    exactMatchCount:
      exactMatches.length,

    exactMatches:
      exactMatches.slice(
        0,
        30
      ),

    dongMatches:
      dongMatches.slice(
        0,
        30
      ),

    unitMatches:
      unitMatches.slice(
        0,
        30
      )
  };
}

/* =========================================================
 * 표제부 선택 보조 함수
 * ======================================================= */

function normalizeRoadAddressForCompare(
  value
) {
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
    Number.isFinite(
      inputFloor
    )
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
    } else if (
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

  const purposeText =
    normalizeCompareText(
      [
        candidate.mainPurpose,
        candidate.otherPurpose
      ].join(" ")
    );

  if (
    purposeText.includes(
      "업무시설"
    )
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

/* =========================================================
 * 표제부 최종 선택
 * ======================================================= */

function selectMatchedTitle(
  titleCandidates,
  exposMatch,
  detail,
  juso
) {
  const matchedDongNames =
    new Set(
      exposMatch.exactMatches
        .map(
          (candidate) =>
            normalizeDongName(
              candidate.dongName
            )
        )
        .filter(Boolean)
    );

  if (
    matchedDongNames.size > 0
  ) {
    const matches =
      titleCandidates.filter(
        (candidate) =>
          matchedDongNames.has(
            normalizeDongName(
              candidate.dongName
            )
          )
      );

    if (
      matches.length > 0
    ) {
      return {
        source:
          "EXPOS_DONG_UNIT_MATCH",

        selected:
          matches[0],

        candidates:
          matches
      };
    }
  }

  if (
    detail.targetDong
  ) {
    const matches =
      titleCandidates.filter(
        (candidate) =>
          normalizeDongName(
            candidate.dongName
          ) ===
          detail.targetDong
      );

    if (
      matches.length > 0
    ) {
      return {
        source:
          "TITLE_DONG_MATCH",

        selected:
          matches[0],

        candidates:
          matches
      };
    }
  }

  const jusoRoadAddress =
    normalizeRoadAddressForCompare(
      juso?.roadAddrPart1 ||
      juso?.roadAddr ||
      ""
    );

  if (jusoRoadAddress) {
    const matches =
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

    if (
      matches.length === 1
    ) {
      return {
        source:
          "ROAD_ADDRESS_EXACT_MATCH",

        selected:
          matches[0],

        candidates:
          matches
      };
    }

    if (
      matches.length > 1
    ) {
      const scored =
        matches
          .map(
            (candidate) => ({
              candidate,

              score:
                calculateTitleCandidateScore(
                  candidate,
                  juso,
                  detail
                )
            })
          )
          .sort(
            (a, b) =>
              b.score -
              a.score
          );

      const first =
        scored[0];

      const second =
        scored[1];

      if (
        first &&
        (
          !second ||
          first.score >
            second.score
        )
      ) {
        return {
          source:
            "ROAD_ADDRESS_SCORED_MATCH",

          selected:
            first.candidate,

          candidates:
            matches,

          scores:
            scored.map(
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

        selected:
          null,

        candidates:
          matches
      };
    }
  }

  const jusoBuildingName =
    normalizeCompareText(
      juso?.bdNm || ""
    );

  if (jusoBuildingName) {
    const matches =
      titleCandidates.filter(
        (candidate) => {
          const candidateName =
            normalizeCompareText(
              candidate.buildingName
            );

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
      matches.length === 1
    ) {
      return {
        source:
          "JUSO_BUILDING_NAME_MATCH",

        selected:
          matches[0],

        candidates:
          matches
      };
    }

    if (
      matches.length > 1
    ) {
      return {
        source:
          "JUSO_BUILDING_NAME_MULTIPLE",

        selected:
          null,

        candidates:
          matches
      };
    }
  }

  if (
    titleCandidates.length ===
    1
  ) {
    return {
      source:
        "SINGLE_TITLE",

      selected:
        titleCandidates[0],

      candidates:
        titleCandidates
    };
  }

  const residential =
    titleCandidates.filter(
      isLikelyResidentialTitle
    );

  if (
    residential.length === 1
  ) {
    return {
      source:
        "SINGLE_RESIDENTIAL_TITLE",

      selected:
        residential[0],

      candidates:
        residential
    };
  }

  return {
    source:
      "TITLE_NOT_DETERMINED",

    selected:
      null,

    candidates:
      residential.length > 0
        ? residential
        : titleCandidates
  };
}

/* =========================================================
 * 검증할 층 결정
 * ======================================================= */

function determineFloorForCheck(
  detail,
  exposMatch
) {
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

  const exactCandidate =
    exposMatch.exactMatches
      .find(
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
    floorType:
      "",

    floorNumber:
      null,

    source:
      "UNAVAILABLE"
  };
}

/* =========================================================
 * 단일 표제부 층수 검증
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
      checked:
        false,

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

  if (
    floorInfo.floorType ===
    "UNDERGROUND"
  ) {
    const maximumFloor =
      title
        .undergroundFloorCount;

    if (
      !Number.isFinite(
        maximumFloor
      )
    ) {
      return {
        checked:
          true,

        floorWithinRange:
          null,

        status:
          "UNDERGROUND_COUNT_UNAVAILABLE",

        reason:
          "선택된 표제부에서 지하층수를 확인하지 못했습니다."
      };
    }

    const within =
      inputFloor <=
      maximumFloor;

    return {
      checked:
        true,

      inputFloorType:
        "UNDERGROUND",

      inputFloor,

      maximumFloor,

      floorWithinRange:
        within,

      status:
        within
          ? "FLOOR_WITHIN_RANGE"
          : "UNDERGROUND_FLOOR_OUT_OF_RANGE",

      reason:
        within
          ? `입력 지하 ${inputFloor}층은 해당 건물의 지하 ${maximumFloor}층 범위 안에 있습니다.`
          : `입력 지하 ${inputFloor}층이 해당 건물의 지하층수 ${maximumFloor}층을 초과합니다.`
    };
  }

  const maximumFloor =
    title.groundFloorCount;

  if (
    !Number.isFinite(
      maximumFloor
    )
  ) {
    return {
      checked:
        true,

      floorWithinRange:
        null,

      status:
        "GROUND_COUNT_UNAVAILABLE",

      reason:
        "선택된 표제부에서 지상층수를 확인하지 못했습니다."
    };
  }

  const within =
    inputFloor <=
    maximumFloor;

  return {
    checked:
      true,

    inputFloorType:
      "GROUND",

    inputFloor,

    maximumFloor,

    floorWithinRange:
      within,

    status:
      within
        ? "FLOOR_WITHIN_RANGE"
        : "GROUND_FLOOR_OUT_OF_RANGE",

    reason:
      within
        ? `입력 ${inputFloor}층은 해당 건물의 지상 ${maximumFloor}층 범위 안에 있습니다.`
        : `입력 ${inputFloor}층이 해당 건물의 지상층수 ${maximumFloor}층을 초과합니다.`
  };
}

/* =========================================================
 * 모든 후보 층수 검증
 * ======================================================= */

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
      checked:
        false,

      inputFloorType:
        floorInfo.floorType,

      inputFloor:
        null,

      floorSource:
        floorInfo.source,

      withinAnyCandidate:
        null,

      withinAllCandidates:
        null,

      results:
        []
    };
  }

  const residential =
    titleCandidates.filter(
      isLikelyResidentialTitle
    );

  const targets =
    residential.length > 0
      ? residential
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
          title
            .undergroundFloorCount,

        ...evaluateSingleTitleFloor(
          title,
          floorInfo
        )
      })
    );

  const comparable =
    results.filter(
      (result) =>
        result
          .floorWithinRange !==
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
              result
                .floorWithinRange ===
              true
          )
        : null,

    withinAllCandidates:
      comparable.length > 0
        ? comparable.every(
            (result) =>
              result
                .floorWithinRange ===
              true
          )
        : null,

    results
  };
}

/* =========================================================
 * 최종 상태 판정
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
    jusoResult.matched ===
    true;

  const titleVerified =
    titleResult.matched ===
    true;

  const unitVerified =
    exposResult.exactMatched ===
    true;

  const selectedTitleVerified =
    Boolean(
      titleSelection.selected
    );

  let status =
    "NOT_VERIFIED";

  let reason =
    "주소를 확인하지 못했습니다.";

  if (!buildingVerified) {
    status =
      "BASE_ADDRESS_NOT_VERIFIED";

    reason =
      "기본주소가 확인되지 않았습니다.";
  } else if (!titleVerified) {
    status =
      "BUILDING_REGISTER_DATA_UNAVAILABLE";

    reason =
      "정확지번·대표지번·총괄표제부에서 건축물대장 데이터가 제공되지 않았습니다.";
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
        exposResult.status ===
        "UNIT_VERIFIED"
          ? "UNIT_VERIFIED"
          : "DONG_UNIT_VERIFIED";

      reason =
        exposResult.reason;
    }
  } else if (
    [
      "DONG_VERIFIED_UNIT_NOT_FOUND",
      "UNIT_VERIFIED_DONG_NOT_FOUND",
      "DONG_UNIT_NOT_FOUND"
    ].includes(
      exposResult.status
    )
  ) {
    status =
      exposResult.status;

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
        ? "정확지번에서는 표제부가 조회되지 않았지만 대표지번 또는 총괄표제부에서 건물을 확인했습니다."
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

    dongVerified:
      exposResult.dongMatched,

    unitVerified,

    selectedTitleVerified,

    selectedBuildingPk:
      titleSelection.selected
        ?.buildingPk || "",

    selectedBuildingName:
      titleSelection.selected
        ?.buildingName || "",

    selectedDongName:
      titleSelection.selected
        ?.dongName || "",

    groundFloorCount:
      titleSelection.selected
        ?.groundFloorCount ??
      null,

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
    reason
  };
}

/* =========================================================
 * 건축물대장 1건 분석
 * ======================================================= */

async function analyzeOneBuilding(
  item,
  options = {}
) {
  const orderNo =
    cleanText(
      item?.orderNo
    );

  const inputAddress =
    cleanText(
      item?.inputAddress
    );

  const baseAddress =
    cleanText(
      item?.baseAddress
    );

  const juso =
    normalizeIncomingJuso(
      item?.juso
    );

  const detail =
    normalizeIncomingDetail(
      item?.detail
    );

  if (
    !juso.admCd ||
    !juso.lnbrMnnm
  ) {
    return {
      ok:
        false,

      orderNo,
      inputAddress,
      baseAddress,
      juso,
      detail,

      groundFloorCount:
        null,

      undergroundFloorCount:
        null,

      totalFloorText:
        "",

      buildingFloorLookupOk:
        false,

      buildingFloorLookupReason:
        "addressAnalyzer.js 결과에 admCd 또는 lnbrMnnm 값이 없습니다.",

      buildingRegisterName:
        "",

      buildingRegisterDongName:
        "",

      buildingRegisterPk:
        "",

      buildingRegisterType:
        "",

      buildingLookupSource:
        "",

      buildingValidationStatus:
        "BUILDING_PARAMS_MISSING",

      buildingValidationReason:
        "건축물대장 조회에 필요한 법정동 코드 또는 지번 본번이 없습니다."
    };
  }

  const buildingParams =
    buildBuildingParams(
      juso
    );

  if (!buildingParams.valid) {
    return {
      ok:
        false,

      orderNo,
      inputAddress,
      baseAddress,
      juso,
      detail,

      groundFloorCount:
        null,

      undergroundFloorCount:
        null,

      totalFloorText:
        "",

      buildingFloorLookupOk:
        false,

      buildingFloorLookupReason:
        buildingParams.reason,

      buildingRegisterName:
        "",

      buildingRegisterDongName:
        "",

      buildingRegisterPk:
        "",

      buildingRegisterType:
        "",

      buildingLookupSource:
        "",

      buildingValidationStatus:
        "BUILDING_PARAMS_MISSING",

      buildingValidationReason:
        buildingParams.reason
    };
  }

  const titleRawResult =
    await searchBuildingTitlesWithFallback(
      juso
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
    checked:
      true,

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

  const exposRawResult =
    await searchExposWithFallback(
      juso,
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
          options.includeAllExpos === true
            ? exposCandidates.length
            : 100
        )
        .map(
          (candidate) => ({
            ...candidate,

            raw:
              options.includeRaw === true
                ? candidate.raw
                : undefined
          })
        )
  };

  const titleSelection =
    selectMatchedTitle(
      titleCandidates,
      exposMatch,
      detail,
      juso
    );

  const floorInfo =
    determineFloorForCheck(
      detail,
      exposMatch
    );

  const selectedFloorCheck =
    evaluateSingleTitleFloor(
      titleSelection.selected,
      floorInfo
    );

  const candidateFloorCheck =
    evaluateCandidateFloorRanges(
      titleSelection.candidates,
      floorInfo
    );

  const syntheticJusoResult = {
    matched:
      true,

    selected:
      juso
  };

  const verification =
    buildVerification(
      syntheticJusoResult,
      titleResult,
      exposResult,
      titleSelection,
      floorInfo,
      selectedFloorCheck,
      candidateFloorCheck
    );

  const selectedTitle =
    titleSelection.selected;

  const groundFloorCount =
    selectedTitle
      ?.groundFloorCount ??
    null;

  const undergroundFloorCount =
    selectedTitle
      ?.undergroundFloorCount ??
    null;

  const totalFloorText =
    formatTotalFloorText(
      groundFloorCount,
      undergroundFloorCount
    );

  const titleLookupError =
    getLastAttemptError(
      titleRawResult.attempts
    );

  let buildingFloorLookupReason =
    "";

  if (!titleResult.matched) {
    buildingFloorLookupReason =
      titleLookupError ||
      "건축물대장 표제부 및 총괄표제부 조회 결과가 없습니다.";
  } else if (!selectedTitle) {
    buildingFloorLookupReason =
      "건축물대장 후보가 여러 건이어서 최종 건물을 확정하지 못했습니다.";
  } else if (!totalFloorText) {
    buildingFloorLookupReason =
      "선택된 건축물대장에 지상층수와 지하층수가 없습니다.";
  }

  const buildingFloorLookupOk =
    Boolean(
      selectedTitle &&
      totalFloorText
    );

  return {
    ok:
      buildingFloorLookupOk,

    orderNo,
    inputAddress,
    baseAddress,

    groundFloorCount,
    undergroundFloorCount,
    totalFloorText,

    buildingFloorLookupOk,
    buildingFloorLookupReason,

    buildingRegisterName:
      selectedTitle
        ?.buildingName ||
      "",

    buildingRegisterDongName:
      selectedTitle
        ?.dongName ||
      "",

    buildingRegisterPk:
      selectedTitle
        ?.buildingPk ||
      "",

    buildingRegisterType:
      selectedTitle
        ?.registerKindName ||
      selectedTitle
        ?.registerTypeName ||
      "",

    buildingLookupSource:
      titleSelection.source ||
      titleResult.lookupSource ||
      "",

    buildingValidationStatus:
      verification.status,

    buildingValidationReason:
      verification.reason,

    juso,
    detail,

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

      selectionScores:
        titleSelection.scores ||
        [],

      selected:
        selectedTitle
          ? {
              ...selectedTitle,

              raw:
                options.includeRaw === true
                  ? selectedTitle.raw
                  : undefined
            }
          : null
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
 * 기본·상태 경로
 * ======================================================= */

app.get(
  "/",
  (req, res) => {
    return res.json({
      ok:
        true,

      service:
        "building-register-api",

      role:
        "BUILDING_API_ONLY",

      process: [
        "RECEIVE_NORMALIZED_JUSO_DETAIL",
        "BUILDING_REGISTER_TITLE",
        "MAIN_JIBUN_FALLBACK",
        "RECAP_TITLE_FALLBACK",
        "BUILDING_REGISTER_EXPOS",
        "DONG_UNIT_FLOOR_MATCH",
        "GROUND_UNDERGROUND_FLOOR_RESULT"
      ],

      message:
        "Building register API is running"
    });
  }
);

app.get(
  "/api/health",
  (req, res) => {
    return res.json({
      ok:
        true,

      service:
        "building-register-api",

      publicDataApiConfigured:
        Boolean(
          PUBLIC_DATA_API_KEY
        ),

      apiSecretConfigured:
        Boolean(
          API_SECRET
        ),

      timestamp:
        new Date()
          .toISOString()
    });
  }
);

app.get(
  "/health",
  (req, res) => {
    return res.redirect(
      307,
      "/api/health"
    );
  }
);

/* =========================================================
 * 단일 건축물대장 분석 API
 * ======================================================= */

app.post(
  "/api/building/analyze",
  checkSecret,
  async (req, res) => {
    try {
      if (
        !req.body?.juso ||
        typeof req.body.juso !==
          "object"
      ) {
        return res
          .status(400)
          .json({
            ok:
              false,

            buildingFloorLookupOk:
              false,

            buildingFloorLookupReason:
              "juso 객체가 필요합니다.",

            message:
              "addressAnalyzer.js가 반환한 juso 객체를 전달해 주세요."
          });
      }

      const result =
        await analyzeOneBuilding(
          {
            orderNo:
              req.body?.orderNo ||
              "SINGLE",

            inputAddress:
              req.body?.inputAddress,

            baseAddress:
              req.body?.baseAddress,

            juso:
              req.body?.juso,

            detail:
              req.body?.detail
          },
          {
            includeRaw:
              req.body?.includeRaw ===
              true,

            includeAllExpos:
              req.body?.includeAllExpos ===
              true,

            exposRowsPerPage:
              req.body?.exposRowsPerPage ||
              100,

            exposMaxPages:
              req.body?.exposMaxPages ||
              3
          }
        );

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        "건축물대장 분석 오류:",
        error
      );

      return res
        .status(500)
        .json({
          ok:
            false,

          buildingFloorLookupOk:
            false,

          buildingFloorLookupReason:
            error instanceof Error
              ? error.message
              : String(error),

          message:
            error instanceof Error
              ? error.message
              : String(error)
        });
    }
  }
);

/* =========================================================
 * 일괄 건축물대장 분석 API
 * ======================================================= */

app.post(
  "/api/building/analyze-batch",
  checkSecret,
  async (req, res) => {
    try {
      const items =
        Array.isArray(
          req.body?.items
        )
          ? req.body.items
          : [];

      if (
        items.length === 0
      ) {
        return res
          .status(400)
          .json({
            ok:
              false,

            message:
              "items 배열이 필요합니다."
          });
      }

      if (
        items.length > 10
      ) {
        return res
          .status(400)
          .json({
            ok:
              false,

            message:
              "한 번에 최대 10건까지만 허용합니다."
          });
      }

      const results = [];

      for (
        const item
        of items
      ) {
        try {
          const result =
            await analyzeOneBuilding(
              item,
              {
                includeRaw:
                  req.body?.includeRaw ===
                  true,

                includeAllExpos:
                  false,

                exposRowsPerPage:
                  req.body?.exposRowsPerPage ||
                  100,

                exposMaxPages:
                  req.body?.exposMaxPages ||
                  3
              }
            );

          results.push(
            result
          );
        } catch (error) {
          results.push({
            ok:
              false,

            orderNo:
              cleanText(
                item?.orderNo
              ),

            inputAddress:
              cleanText(
                item?.inputAddress
              ),

            baseAddress:
              cleanText(
                item?.baseAddress
              ),

            buildingFloorLookupOk:
              false,

            buildingFloorLookupReason:
              error instanceof Error
                ? error.message
                : String(error)
          });
        }

        await sleep(50);
      }

      return res.json({
        ok:
          true,

        count:
          results.length,

        results
      });
    } catch (error) {
      console.error(
        error
      );

      return res
        .status(500)
        .json({
          ok:
            false,

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

app.use(
  (req, res) => {
    return res
      .status(404)
      .json({
        ok:
          false,

        message:
          "요청한 API 경로가 없습니다."
      });
  }
);

/* =========================================================
 * 공통 오류 처리
 * ======================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      error
    );

    if (
      error?.message ===
      "허용되지 않은 Origin입니다."
    ) {
      return res
        .status(403)
        .json({
          ok:
            false,

          message:
            error.message
        });
    }

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    return res
      .status(500)
      .json({
        ok:
          false,

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
      `Building register API running on port ${PORT}`
    );

    console.log(
      "PUBLIC_DATA_API_KEY:",
      PUBLIC_DATA_API_KEY
        ? "설정됨"
        : "미설정"
    );

    console.log(
      "API_SECRET:",
      API_SECRET
        ? "설정됨"
        : "미설정"
    );
  }
);
