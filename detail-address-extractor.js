"use strict";

import "dotenv/config";

import axios from "axios";
import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";

import { analyzeAddress } from "./addressAnalyzer.js";

/* =========================================================
 * 기본 경로
 * ======================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
 * 환경변수
 * ======================================================= */

function getSafeNumber(value, defaultValue, min, max) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(parsed, max));
}

const PORT = getSafeNumber(
  process.env.PORT,
  3000,
  1,
  65535
);

const SERVER_API_BASE_URL = String(
  process.env.SERVER_API_BASE_URL || ""
)
  .trim()
  .replace(/^["']|["']$/g, "")
  .replace(/\/+$/, "");

const SERVER_API_SECRET = String(
  process.env.SERVER_API_SECRET || ""
)
  .trim()
  .replace(/^["']|["']$/g, "");

const SERVER_API_TIMEOUT = getSafeNumber(
  process.env.SERVER_API_TIMEOUT,
  120000,
  10000,
  180000
);

const SERVER_EXPOS_ROWS_PER_PAGE = getSafeNumber(
  process.env.SERVER_EXPOS_ROWS_PER_PAGE,
  100,
  10,
  100
);

const SERVER_EXPOS_MAX_PAGES = getSafeNumber(
  process.env.SERVER_EXPOS_MAX_PAGES,
  3,
  1,
  5
);

const ROW_DELAY_MS = getSafeNumber(
  process.env.ROW_DELAY_MS,
  100,
  0,
  1000
);

/* =========================================================
 * 결과 엑셀 노출 설정
 * ======================================================= */

const EXCEL_OUTPUT_MODE = {
  ALL: "all",
  PARTIAL: "partial"
};

/*
 * 일부노출 선택 시 결과 엑셀에 포함할 항목입니다.
 *
 * 아래 배열의 순서대로 결과 엑셀 열이 만들어집니다.
 */
const PARTIAL_OUTPUT_COLUMNS = [
  "순번",
  "주문번호",
  "입력우편번호",
  "입력주소",
  "주소처리성공",
  "전체층수",
  "지상층수",
  "지하층수",
  "건축물대장조회",
  "동호검증사유",
  "상세주소상태",
  "주소분석실패사유"
];

/*
 * 결과 엑셀 열별 너비입니다.
 */
const EXCEL_COLUMN_WIDTHS = {
  순번: 7,
  주문번호: 22,
  입력우편번호: 14,
  입력주소: 60,
  주소처리성공: 14,

  기본주소: 45,
  도로명주소: 55,
  지번주소: 55,
  API우편번호: 14,
  건물명: 30,
  건물관리번호: 28,

  전체층수: 26,
  지상층수: 12,
  지하층수: 12,
  건축물대장조회: 18,
  건축물대장건물명: 30,
  건축물대장동명: 20,
  건축물대장PK: 32,
  건축물대장유형: 24,
  건축물조회방식: 28,
  동호검증상태: 28,
  동호검증사유: 45,
  건축물대장조회사유: 55,

  상세주소원문: 30,
  상세주소정규화: 35,
  동: 12,
  층: 12,
  호: 12,
  기타정보: 30,
  상세주소유형: 22,
  상세주소상태: 22,
  신뢰도: 10,
  검색키워드: 50,
  주소분석실패사유: 50
};

/* =========================================================
 * HTTP Keep-Alive
 * ======================================================= */

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: SERVER_API_TIMEOUT
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: SERVER_API_TIMEOUT
});

const buildingApiClient = axios.create({
  timeout: SERVER_API_TIMEOUT,
  httpAgent,
  httpsAgent,
  maxRedirects: 0,

  validateStatus(status) {
    return status >= 200 && status < 300;
  }
});

/* =========================================================
 * Express
 * ======================================================= */

const app = express();

/* =========================================================
 * 엑셀 작업 상태
 *
 * 단일 Railway 인스턴스 기준 메모리 저장 방식입니다.
 * ======================================================= */

const excelJobs = new Map();

function createJobId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

function updateExcelJob(jobId, values) {
  const current = excelJobs.get(jobId);

  if (!current) {
    return;
  }

  excelJobs.set(jobId, {
    ...current,
    ...values,
    updatedAt: Date.now()
  });
}

/* =========================================================
 * 업로드 폴더
 * ======================================================= */

const uploadDir = path.join(__dirname, "uploads");

fs.mkdirSync(uploadDir, {
  recursive: true
});

/* =========================================================
 * Multer
 * ======================================================= */

const upload = multer({
  dest: uploadDir,

  limits: {
    fileSize: 20 * 1024 * 1024
  },

  fileFilter(req, file, callback) {
    const allowedExtensions = [
      ".xlsx",
      ".xls"
    ];

    const extension = path
      .extname(file.originalname)
      .toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return callback(
        new Error(
          "엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다."
        )
      );
    }

    return callback(null, true);
  }
});

/* =========================================================
 * 미들웨어
 * ======================================================= */

app.disable("x-powered-by");

app.use(cors());

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
 * 공통 함수
 * ======================================================= */

function safeDeleteFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(
      "파일 삭제 실패:",
      filePath,
      error
    );
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function findColumnName(row, candidates) {
  const keys = Object.keys(row || {});

  return keys.find((key) => {
    const normalizedKey = String(key)
      .trim()
      .toLowerCase();

    return candidates.some((candidate) => {
      return (
        normalizedKey ===
        String(candidate)
          .trim()
          .toLowerCase()
      );
    });
  });
}

function getAxiosErrorReason(error) {
  const status = error?.response?.status;
  const responseData = error?.response?.data;

  if (error?.code === "ECONNABORTED") {
    return (
      "건축물대장 API 응답 제한시간을 초과했습니다. " +
      `(${SERVER_API_TIMEOUT}ms)`
    );
  }

  if (error?.code === "ECONNRESET") {
    return "건축물대장 API 연결이 중간에 종료되었습니다.";
  }

  if (error?.code === "ENOTFOUND") {
    return "건축물대장 API 서버 도메인을 찾지 못했습니다.";
  }

  if (error?.code === "ECONNREFUSED") {
    return "건축물대장 API 서버가 연결을 거부했습니다.";
  }

  if (
    responseData &&
    typeof responseData === "object"
  ) {
    const reason =
      responseData.reason ||
      responseData.message ||
      responseData.error ||
      responseData.detail;

    if (reason) {
      return status
        ? `API 오류(${status}): ${reason}`
        : String(reason);
    }

    try {
      const serialized = JSON.stringify(responseData);

      return status
        ? `API 오류(${status}): ${serialized}`
        : serialized;
    } catch {
      // JSON 변환 실패 시 기본 오류를 사용합니다.
    }
  }

  if (
    typeof responseData === "string" &&
    responseData.trim()
  ) {
    const cleanText = responseData
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    return status
      ? `API 오류(${status}): ${cleanText}`
      : cleanText;
  }

  const message = getErrorMessage(error);

  return status
    ? `API 오류(${status}): ${message}`
    : message;
}

function makeDownloadFileName(
  outputMode = EXCEL_OUTPUT_MODE.ALL
) {
  const now = new Date();

  const pad = (value) => {
    return String(value).padStart(2, "0");
  };

  const dateText = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join("");

  const timeText = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");

  const modeText =
    outputMode === EXCEL_OUTPUT_MODE.PARTIAL
      ? "일부노출"
      : "전체노출";

  return (
    `주소분석결과_${modeText}_` +
    `${dateText}_${timeText}.xlsx`
  );
}

function makeEmptyBuildingResult(reason = "") {
  return {
    ok: false,

    groundFloorCount: null,
    undergroundFloorCount: null,
    totalFloorText: "",

    buildingFloorLookupOk: false,
    buildingFloorLookupReason: reason,

    buildingRegisterName: "",
    buildingRegisterDongName: "",
    buildingRegisterPk: "",
    buildingRegisterType: "",
    buildingLookupSource: "",

    buildingValidationStatus: "",
    buildingValidationReason: ""
  };
}

/*
 * 업로드 화면에서 전달된 outputMode 값을 검증합니다.
 *
 * all     : 전체노출
 * partial : 일부노출
 *
 * 값이 없거나 올바르지 않으면 전체노출로 처리합니다.
 */
function normalizeExcelOutputMode(value) {
  const normalizedValue = String(
    value || ""
  )
    .trim()
    .toLowerCase();

  if (
    normalizedValue ===
    EXCEL_OUTPUT_MODE.PARTIAL
  ) {
    return EXCEL_OUTPUT_MODE.PARTIAL;
  }

  return EXCEL_OUTPUT_MODE.ALL;
}

/*
 * 결과 행에서 일부노출 항목만 추출합니다.
 */
function filterOutputRows(
  outputRows,
  outputMode
) {
  if (
    outputMode !==
    EXCEL_OUTPUT_MODE.PARTIAL
  ) {
    return outputRows;
  }

  return outputRows.map((row) => {
    const filteredRow = {};

    for (
      const columnName of
      PARTIAL_OUTPUT_COLUMNS
    ) {
      filteredRow[columnName] =
        row[columnName] ?? "";
    }

    return filteredRow;
  });
}

/* =========================================================
 * 건축물대장 API payload 생성
 * ======================================================= */

function makeBuildingApiPayload(
  addressResult,
  orderNo
) {
  const juso =
    addressResult?.juso ||
    {
      roadAddr:
        addressResult?.roadAddress || "",

      roadAddrPart1:
        addressResult?.baseAddress || "",

      roadAddrPart2:
        addressResult?.roadAddrPart2 || "",

      jibunAddr:
        addressResult?.jibunAddress || "",

      zipNo:
        addressResult?.apiZipCode || "",

      admCd:
        addressResult?.admCd || "",

      rnMgtSn:
        addressResult?.rnMgtSn || "",

      udrtYn:
        addressResult?.udrtYn || "",

      buldMnnm:
        addressResult?.buldMnnm || "",

      buldSlno:
        addressResult?.buldSlno || "0",

      bdMgtSn:
        addressResult?.buildingManagementNo || "",

      mtYn:
        addressResult?.mtYn || "0",

      lnbrMnnm:
        addressResult?.lnbrMnnm || "",

      lnbrSlno:
        addressResult?.lnbrSlno || "0",

      bdNm:
        addressResult?.buildingName || "",

      detBdNmList:
        addressResult?.detBdNmList || "",

      siNm:
        addressResult?.siNm || "",

      sggNm:
        addressResult?.sggNm || "",

      emdNm:
        addressResult?.emdNm || "",

      liNm:
        addressResult?.liNm || "",

      rn:
        addressResult?.rn || ""
    };

  const fallbackDong = String(
    addressResult?.dong || ""
  );

  const fallbackHo = String(
    addressResult?.ho || ""
  );

  const fallbackFloor = String(
    addressResult?.floor || ""
  );

  const detail =
    addressResult?.detail ||
    {
      raw:
        addressResult?.detailAddressOriginal || "",

      clean:
        addressResult?.detailAddressNormalized || "",

      pattern:
        addressResult?.detailType || "",

      dongRaw:
        fallbackDong,

      floorRaw:
        fallbackFloor,

      hoRaw:
        fallbackHo,

      targetDong:
        fallbackDong
          .replace(/^제/u, "")
          .replace(/동$/u, "")
          .replace(/\s+/g, "")
          .toLowerCase(),

      targetHo:
        fallbackHo
          .replace(/^제/u, "")
          .replace(/호$/u, "")
          .replace(/\s+/g, "")
          .toLowerCase(),

      floorType:
        fallbackFloor.includes("지하")
          ? "UNDERGROUND"
          : fallbackFloor
            ? "GROUND"
            : "",

      inputFloor:
        null,

      inferredFloor:
        null
    };

  return {
    orderNo: String(orderNo ?? ""),

    inputAddress:
      addressResult?.inputAddress || "",

    baseAddress:
      addressResult?.baseAddress || "",

    juso,
    detail,

    options: {
      exposRowsPerPage:
        SERVER_EXPOS_ROWS_PER_PAGE,

      exposMaxPages:
        SERVER_EXPOS_MAX_PAGES
    },

    exposRowsPerPage:
      SERVER_EXPOS_ROWS_PER_PAGE,

    exposMaxPages:
      SERVER_EXPOS_MAX_PAGES
  };
}

/* =========================================================
 * 건축물대장 API 호출
 * ======================================================= */

async function requestBuildingAnalysis(
  addressResult,
  orderNo
) {
  if (!SERVER_API_BASE_URL) {
    return makeEmptyBuildingResult(
      "SERVER_API_BASE_URL이 설정되지 않았습니다."
    );
  }

  if (!addressResult?.ok) {
    return makeEmptyBuildingResult(
      "기본주소 분석에 실패하여 건축물대장을 조회하지 않았습니다."
    );
  }

  const requestUrl =
    `${SERVER_API_BASE_URL}/api/building/analyze`;

  const payload = makeBuildingApiPayload(
    addressResult,
    orderNo
  );

  const headers = {
    "Content-Type": "application/json"
  };

  if (SERVER_API_SECRET) {
    headers["x-api-secret"] =
      SERVER_API_SECRET;
  }

  const startedAt = Date.now();

  try {
    const response = await buildingApiClient.post(
      requestUrl,
      payload,
      {
        headers,
        timeout: SERVER_API_TIMEOUT
      }
    );

    const elapsed =
      Date.now() - startedAt;

    console.log(
      `[건축물대장 완료] 주문번호: ${orderNo} / ${elapsed}ms`
    );

    const data = response.data || {};

    return {
      ...makeEmptyBuildingResult(),
      ...data,

      ok:
        data.ok === true,

      buildingFloorLookupOk:
        data.buildingFloorLookupOk ??
        data.ok ??
        false,

      buildingFloorLookupReason:
        data.buildingFloorLookupReason ||
        data.reason ||
        data.message ||
        "",

      totalFloorText:
        data.totalFloorText || "",

      groundFloorCount:
        data.groundFloorCount ?? null,

      undergroundFloorCount:
        data.undergroundFloorCount ?? null,

      buildingRegisterName:
        data.buildingRegisterName ||
        data.buildingName ||
        "",

      buildingRegisterDongName:
        data.buildingRegisterDongName ||
        data.dongName ||
        "",

      buildingRegisterPk:
        data.buildingRegisterPk ||
        data.buildingPk ||
        "",

      buildingRegisterType:
        data.buildingRegisterType ||
        data.registerKindName ||
        "",

      buildingLookupSource:
        data.buildingLookupSource ||
        data.lookupSource ||
        data.titleSelectionSource ||
        "",

      buildingValidationStatus:
        data.buildingValidationStatus ||
        data.validationStatus ||
        data.exposMatch?.status ||
        "",

      buildingValidationReason:
        data.buildingValidationReason ||
        data.validationReason ||
        data.exposMatch?.reason ||
        ""
    };
  } catch (error) {
    const elapsed =
      Date.now() - startedAt;

    const reason =
      getAxiosErrorReason(error);

    console.error(
      "server.js 건축물대장 API 호출 실패:",
      {
        url: requestUrl,
        orderNo,

        address:
          addressResult?.baseAddress || "",

        elapsed:
          `${elapsed}ms`,

        code:
          error?.code || "",

        reason
      }
    );

    return makeEmptyBuildingResult(reason);
  }
}

/* =========================================================
 * 주소 분석 + 건축물대장 분석
 * ======================================================= */

async function analyzeAddressWithBuilding(
  inputAddress,
  orderNo
) {
  let addressResult;

  try {
    addressResult =
      await analyzeAddress(inputAddress);
  } catch (error) {
    addressResult = {
      ok: false,
      inputAddress,
      reason: getErrorMessage(error)
    };
  }

  let buildingResult;

  if (addressResult?.ok) {
    buildingResult =
      await requestBuildingAnalysis(
        addressResult,
        orderNo
      );
  } else {
    buildingResult =
      makeEmptyBuildingResult(
        "기본주소 분석에 실패하여 건축물대장을 조회하지 않았습니다."
      );
  }

  return {
    address: addressResult,
    building: buildingResult
  };
}

/* =========================================================
 * 엑셀 결과 행 생성
 * ======================================================= */

function makeOutputRow({
  index,
  inputOrderNo,
  inputZipCode,
  inputAddress,
  analyzed,
  building
}) {
  return {
    순번:
      index + 1,

    주문번호:
      inputOrderNo,

    입력우편번호:
      inputZipCode,

    입력주소:
      inputAddress,

    주소처리성공:
      analyzed.ok
        ? "Y"
        : "N",

    기본주소:
      analyzed.baseAddress || "",

    도로명주소:
      analyzed.roadAddress ||
      analyzed.juso?.roadAddr ||
      "",

    지번주소:
      analyzed.jibunAddress ||
      analyzed.juso?.jibunAddr ||
      "",

    API우편번호:
      analyzed.apiZipCode ||
      analyzed.juso?.zipNo ||
      "",

    건물명:
      analyzed.buildingName ||
      analyzed.juso?.bdNm ||
      "",

    건물관리번호:
      analyzed.buildingManagementNo ||
      analyzed.juso?.bdMgtSn ||
      "",

    전체층수:
      building.totalFloorText || "",

    지상층수:
      building.groundFloorCount ?? "",

    지하층수:
      building.undergroundFloorCount ?? "",

    건축물대장조회:
      building.buildingFloorLookupOk
        ? "Y"
        : "N",

    건축물대장건물명:
      building.buildingRegisterName || "",

    건축물대장동명:
      building.buildingRegisterDongName || "",

    건축물대장PK:
      building.buildingRegisterPk || "",

    건축물대장유형:
      building.buildingRegisterType || "",

    건축물조회방식:
      building.buildingLookupSource || "",

    동호검증상태:
      building.buildingValidationStatus || "",

    동호검증사유:
      building.buildingValidationReason || "",

    건축물대장조회사유:
      building.buildingFloorLookupReason || "",

    상세주소원문:
      analyzed.detailAddressOriginal ||
      analyzed.detail?.raw ||
      "",

    상세주소정규화:
      analyzed.detailAddressNormalized ||
      analyzed.detail?.clean ||
      "",

    동:
      analyzed.dong ||
      analyzed.detail?.dongRaw ||
      "",

    층:
      analyzed.floor ||
      analyzed.detail?.floorRaw ||
      "",

    호:
      analyzed.ho ||
      analyzed.detail?.hoRaw ||
      "",

    기타정보:
      analyzed.extra || "",

    상세주소유형:
      analyzed.detailType ||
      analyzed.detail?.pattern ||
      "",

    상세주소상태:
      analyzed.detailStatus || "",

    신뢰도:
      analyzed.confidence || "",

    검색키워드:
      analyzed.searchKeyword || "",

    주소분석실패사유:
      analyzed.reason || ""
  };
}

/* =========================================================
 * 결과 엑셀 파일 생성
 * ======================================================= */

function createExcelResultFile(
  jobId,
  outputRows,
  outputMode = EXCEL_OUTPUT_MODE.ALL
) {
  const normalizedOutputMode =
    normalizeExcelOutputMode(
      outputMode
    );

  const excelRows =
    filterOutputRows(
      outputRows,
      normalizedOutputMode
    );

  if (excelRows.length === 0) {
    throw new Error(
      "결과 엑셀에 저장할 데이터가 없습니다."
    );
  }

  const outputSheet =
    XLSX.utils.json_to_sheet(
      excelRows
    );

  const outputWorkbook =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    outputWorkbook,
    outputSheet,
    "주소분석결과"
  );

  /*
   * 실제 출력되는 열 이름을 기준으로
   * 열 너비를 설정합니다.
   */
  const outputColumnNames =
    Object.keys(excelRows[0]);

  outputSheet["!cols"] =
    outputColumnNames.map(
      (columnName) => {
        return {
          wch:
            EXCEL_COLUMN_WIDTHS[
              columnName
            ] || 20
        };
      }
    );

  const outputBuffer =
    XLSX.write(
      outputWorkbook,
      {
        type: "buffer",
        bookType: "xlsx"
      }
    );

  const outputFileName =
    `address-result-${jobId}.xlsx`;

  const outputPath =
    path.join(
      uploadDir,
      outputFileName
    );

  fs.writeFileSync(
    outputPath,
    outputBuffer
  );

  return {
    outputPath,

    outputSize:
      outputBuffer.length,

    outputMode:
      normalizedOutputMode,

    outputColumns:
      outputColumnNames
  };
}

/* =========================================================
 * 엑셀 작업 기본정보 생성
 * ======================================================= */

function createInitialExcelJob(
  jobId,
  outputMode
) {
  return {
    jobId,

    outputMode:
      normalizeExcelOutputMode(
        outputMode
      ),

    outputColumns: [],

    status: "WAITING",

    current: 0,
    total: 0,
    percent: 0,

    currentOrderNo: "",
    currentAddress: "",

    outputPath: "",
    outputSize: 0,

    downloadName: "",

    error: "",

    message:
      "작업을 준비하고 있습니다.",

    createdAt:
      Date.now(),

    updatedAt:
      Date.now()
  };
}

/* =========================================================
 * 엑셀 백그라운드 처리
 * ======================================================= */

async function processExcelJob(
  jobId,
  uploadedFile,
  outputMode = EXCEL_OUTPUT_MODE.ALL
) {
  const normalizedOutputMode =
    normalizeExcelOutputMode(
      outputMode
    );

  let uploadedPath =
    uploadedFile?.path || "";

  let outputPath = "";

  const processingStartedAt =
    Date.now();

  try {
    updateExcelJob(
      jobId,
      {
        status: "READING",

        outputMode:
          normalizedOutputMode,

        message:
          "엑셀 파일을 읽고 있습니다."
      }
    );

    const inputBuffer =
      fs.readFileSync(uploadedPath);

    const workbook =
      XLSX.read(
        inputBuffer,
        {
          type: "buffer",
          cellDates: false,
          raw: false
        }
      );

    if (
      !Array.isArray(workbook.SheetNames) ||
      workbook.SheetNames.length === 0
    ) {
      throw new Error(
        "엑셀 시트를 찾지 못했습니다."
      );
    }

    const firstSheetName =
      workbook.SheetNames[0];

    const sheet =
      workbook.Sheets[firstSheetName];

    if (!sheet) {
      throw new Error(
        "첫 번째 엑셀 시트를 읽지 못했습니다."
      );
    }

    const rows =
      XLSX.utils.sheet_to_json(
        sheet,
        {
          defval: "",
          raw: false
        }
      );

    if (rows.length === 0) {
      throw new Error(
        "엑셀에 데이터가 없습니다."
      );
    }

    const addressColumn =
      findColumnName(
        rows[0],
        [
          "주소",
          "address",
          "배송지주소",
          "수령자주소"
        ]
      );

    const zipColumn =
      findColumnName(
        rows[0],
        [
          "우편번호",
          "zipcode",
          "zip",
          "postalcode"
        ]
      );

    const orderNoColumn =
      findColumnName(
        rows[0],
        [
          "주문번호",
          "orderno",
          "order_no",
          "orderNo"
        ]
      );

    if (!addressColumn) {
      throw new Error(
        "주소 열을 찾지 못했습니다. 헤더명을 '주소'로 설정해 주세요."
      );
    }

    const total = rows.length;
    const outputRows = [];

    updateExcelJob(
      jobId,
      {
        status: "PROCESSING",

        outputMode:
          normalizedOutputMode,

        current: 0,
        total,
        percent: 0,

        message:
          `0/${total}개 처리 중`
      }
    );

    console.log(
      `[엑셀 분석 시작] 작업 ${jobId} / 총 ${total}건 / 출력방식: ${normalizedOutputMode}`
    );

    for (
      let index = 0;
      index < total;
      index += 1
    ) {
      const row = rows[index];

      const inputAddress =
        String(
          row[addressColumn] ?? ""
        ).trim();

      const inputZipCode =
        zipColumn
          ? String(
              row[zipColumn] ?? ""
            ).trim()
          : "";

      const inputOrderNo =
        orderNoColumn
          ? String(
              row[orderNoColumn] ?? ""
            ).trim()
          : String(index + 1);

      const currentOrderNo =
        inputOrderNo ||
        String(index + 1);

      updateExcelJob(
        jobId,
        {
          status: "PROCESSING",

          current:
            index,

          total,

          percent:
            Math.floor(
              (index / total) * 100
            ),

          currentOrderNo,

          currentAddress:
            inputAddress,

          message:
            `${index}/${total}개 처리 중`
        }
      );

      console.log(
        `[주소 분석] 작업 ${jobId} / ${index + 1}/${total} / 주문번호: ${currentOrderNo}`
      );

      const rowStartedAt =
        Date.now();

      let result;

      if (!inputAddress) {
        result = {
          address: {
            ok: false,
            inputAddress: "",
            reason: "주소가 비어 있습니다."
          },

          building:
            makeEmptyBuildingResult(
              "주소가 비어 있어 건축물대장을 조회하지 않았습니다."
            )
        };
      } else {
        result =
          await analyzeAddressWithBuilding(
            inputAddress,
            currentOrderNo
          );
      }

      const analyzed =
        result.address || {};

      const building =
        result.building ||
        makeEmptyBuildingResult();

      outputRows.push(
        makeOutputRow({
          index,
          inputOrderNo,
          inputZipCode,
          inputAddress,
          analyzed,
          building
        })
      );

      const current =
        index + 1;

      const percent =
        Math.round(
          (current / total) * 100
        );

      updateExcelJob(
        jobId,
        {
          status: "PROCESSING",

          current,
          total,
          percent,

          currentOrderNo,

          currentAddress:
            inputAddress,

          message:
            `${current}/${total}개 처리 완료`
        }
      );

      console.log(
        `[주소 완료] 작업 ${jobId} / ${current}/${total} / ${Date.now() - rowStartedAt}ms`
      );

      if (
        index < total - 1 &&
        ROW_DELAY_MS > 0
      ) {
        await sleep(ROW_DELAY_MS);
      }
    }

    updateExcelJob(
      jobId,
      {
        status: "CREATING_FILE",

        current: total,
        total,
        percent: 100,

        message:
          "결과 엑셀 파일을 생성하고 있습니다."
      }
    );

    const fileResult =
      createExcelResultFile(
        jobId,
        outputRows,
        normalizedOutputMode
      );

    outputPath =
      fileResult.outputPath;

    safeDeleteFile(uploadedPath);
    uploadedPath = "";

    const totalElapsed =
      Date.now() -
      processingStartedAt;

    updateExcelJob(
      jobId,
      {
        status: "COMPLETED",

        current: total,
        total,
        percent: 100,

        outputPath,

        outputSize:
          fileResult.outputSize,

        outputMode:
          fileResult.outputMode,

        outputColumns:
          fileResult.outputColumns,

        downloadName:
          makeDownloadFileName(
            fileResult.outputMode
          ),

        completedAt:
          Date.now(),

        message:
          `${total}/${total}개 처리 완료`
      }
    );

    console.log(
      `[엑셀 완료] 작업 ${jobId} / 총 ${total}건 / 출력방식: ${fileResult.outputMode} / ${totalElapsed}ms / ${fileResult.outputSize} bytes`
    );
  } catch (error) {
    console.error(
      `[엑셀 작업 오류] 작업 ${jobId}:`,
      error
    );

    safeDeleteFile(uploadedPath);
    safeDeleteFile(outputPath);

    updateExcelJob(
      jobId,
      {
        status: "ERROR",

        error:
          getErrorMessage(error),

        message:
          getErrorMessage(error),

        failedAt:
          Date.now()
      }
    );
  }
}

/* =========================================================
 * 엑셀 업로드 작업 시작 공통 처리
 * ======================================================= */

function startExcelUploadJob(
  req,
  res
) {
  if (!req.file) {
    return res
      .status(400)
      .json({
        ok: false,

        reason:
          "업로드된 엑셀 파일이 없습니다."
      });
  }

  const outputMode =
    normalizeExcelOutputMode(
      req.body?.outputMode
    );

  const jobId =
    createJobId();

  excelJobs.set(
    jobId,
    createInitialExcelJob(
      jobId,
      outputMode
    )
  );

  res
    .status(202)
    .json({
      ok: true,

      jobId,

      outputMode,

      status: "WAITING",

      current: 0,
      total: 0,
      percent: 0,

      progressUrl:
        `/api/excel/progress/${jobId}`,

      downloadUrl:
        `/api/excel/download/${jobId}`
    });

  /*
   * 업로드 요청에는 작업 ID만 즉시 반환하고,
   * 실제 주소 분석은 응답 이후 실행합니다.
   */
  setImmediate(() => {
    processExcelJob(
      jobId,
      req.file,
      outputMode
    ).catch((error) => {
      console.error(
        `[엑셀 비동기 실행 오류] 작업 ${jobId}:`,
        error
      );
    });
  });

  return;
}

/* =========================================================
 * 서비스 상태 확인
 * ======================================================= */

app.get(
  "/api/health",
  async (req, res) => {
    let serverApiReachable = false;
    let serverApiStatus = "";
    let serverApiResponseTime = null;

    if (SERVER_API_BASE_URL) {
      const startedAt = Date.now();

      try {
        const response =
          await buildingApiClient.get(
            `${SERVER_API_BASE_URL}/api/health`,
            {
              timeout: 10000,

              headers:
                SERVER_API_SECRET
                  ? {
                      "x-api-secret":
                        SERVER_API_SECRET
                    }
                  : {}
            }
          );

        serverApiResponseTime =
          Date.now() -
          startedAt;

        serverApiReachable =
          response.status >= 200 &&
          response.status < 300;

        serverApiStatus =
          response.data?.service ||
          response.data?.status ||
          "응답 정상";
      } catch (error) {
        serverApiResponseTime =
          Date.now() -
          startedAt;

        serverApiStatus =
          getAxiosErrorReason(error);
      }
    }

    return res.json({
      ok: true,

      service:
        "detail-address-extractor",

      jusoKeyConfigured:
        Boolean(
          process.env.JUSO_CONFIRM_KEY
        ),

      serverApiBaseUrlConfigured:
        Boolean(
          SERVER_API_BASE_URL
        ),

      serverApiSecretConfigured:
        Boolean(
          SERVER_API_SECRET
        ),

      serverApiReachable,
      serverApiStatus,
      serverApiResponseTime,

      serverApiTimeout:
        SERVER_API_TIMEOUT,

      serverExposRowsPerPage:
        SERVER_EXPOS_ROWS_PER_PAGE,

      serverExposMaxPages:
        SERVER_EXPOS_MAX_PAGES,

      rowDelayMs:
        ROW_DELAY_MS,

      excelOutputModes: {
        all:
          "전체노출",

        partial:
          "일부노출"
      },

      partialOutputColumns:
        PARTIAL_OUTPUT_COLUMNS,

      activeExcelJobs:
        excelJobs.size,

      timestamp:
        new Date().toISOString()
    });
  }
);

/* =========================================================
 * 주소 1건 분석
 * ======================================================= */

app.post(
  "/api/address/analyze",
  async (req, res) => {
    try {
      const address =
        String(
          req.body?.address ?? ""
        ).trim();

      if (!address) {
        return res
          .status(400)
          .json({
            ok: false,
            reason: "address가 없습니다."
          });
      }

      const result =
        await analyzeAddressWithBuilding(
          address,
          req.body?.orderNo ||
          "SINGLE"
        );

      return res.json({
        ok:
          result.address?.ok === true,

        address:
          result.address,

        building:
          result.building
      });
    } catch (error) {
      console.error(
        "주소 1건 분석 오류:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          reason:
            getErrorMessage(error)
        });
    }
  }
);

/* =========================================================
 * 엑셀 작업 시작
 * ======================================================= */

app.post(
  "/api/excel/start",

  upload.single("file"),

  (req, res) => {
    return startExcelUploadJob(
      req,
      res
    );
  }
);

/* =========================================================
 * 기존 주소 호환
 *
 * 기존 화면에서 /api/excel/analyze를 사용하는 경우에도
 * 동일하게 작업 ID를 반환하도록 지원합니다.
 * ======================================================= */

app.post(
  "/api/excel/analyze",

  upload.single("file"),

  (req, res) => {
    return startExcelUploadJob(
      req,
      res
    );
  }
);

/* =========================================================
 * 엑셀 진행률 조회
 * ======================================================= */

app.get(
  "/api/excel/progress/:jobId",
  (req, res) => {
    const job =
      excelJobs.get(
        req.params.jobId
      );

    if (!job) {
      return res
        .status(404)
        .json({
          ok: false,

          reason:
            "작업 정보를 찾지 못했습니다."
        });
    }

    return res.json({
      ok: true,

      jobId:
        job.jobId,

      outputMode:
        job.outputMode ||
        EXCEL_OUTPUT_MODE.ALL,

      outputColumns:
        job.outputColumns || [],

      status:
        job.status,

      current:
        job.current,

      total:
        job.total,

      percent:
        job.percent,

      progressText:
        `${job.current}/${job.total}개`,

      currentOrderNo:
        job.currentOrderNo || "",

      currentAddress:
        job.currentAddress || "",

      message:
        job.message || "",

      error:
        job.error || "",

      downloadReady:
        job.status ===
        "COMPLETED",

      downloadUrl:
        job.status === "COMPLETED"
          ? `/api/excel/download/${job.jobId}`
          : "",

      updatedAt:
        job.updatedAt
    });
  }
);

/* =========================================================
 * 엑셀 결과 다운로드
 * ======================================================= */

app.get(
  "/api/excel/download/:jobId",
  (req, res) => {
    const jobId =
      req.params.jobId;

    const job =
      excelJobs.get(jobId);

    if (!job) {
      return res
        .status(404)
        .json({
          ok: false,

          reason:
            "작업 정보를 찾지 못했습니다."
        });
    }

    if (job.status === "ERROR") {
      return res
        .status(409)
        .json({
          ok: false,

          reason:
            job.error ||
            "엑셀 분석 중 오류가 발생했습니다."
        });
    }

    if (job.status !== "COMPLETED") {
      return res
        .status(409)
        .json({
          ok: false,

          reason:
            "아직 엑셀 처리가 완료되지 않았습니다.",

          status:
            job.status,

          current:
            job.current,

          total:
            job.total
        });
    }

    if (
      !job.outputPath ||
      !fs.existsSync(job.outputPath)
    ) {
      excelJobs.delete(jobId);

      return res
        .status(404)
        .json({
          ok: false,

          reason:
            "결과 파일을 찾지 못했습니다."
        });
    }

    return res.download(
      job.outputPath,

      job.downloadName ||
      makeDownloadFileName(
        job.outputMode
      ),

      (error) => {
        if (error) {
          console.error(
            `[엑셀 다운로드 오류] 작업 ${jobId}:`,
            error
          );

          return;
        }

        safeDeleteFile(job.outputPath);

        excelJobs.delete(jobId);

        console.log(
          `[엑셀 다운로드 완료] 작업 ${jobId}`
        );
      }
    );
  }
);

/* =========================================================
 * 만료된 작업 정리
 * ======================================================= */

const JOB_EXPIRE_MS =
  60 * 60 * 1000;

const JOB_CLEANUP_INTERVAL_MS =
  10 * 60 * 1000;

const jobCleanupTimer =
  setInterval(() => {
    const now = Date.now();

    for (
      const [
        jobId,
        job
      ] of excelJobs.entries()
    ) {
      if (
        now - job.updatedAt <
        JOB_EXPIRE_MS
      ) {
        continue;
      }

      safeDeleteFile(job.outputPath);

      excelJobs.delete(jobId);

      console.log(
        `[엑셀 작업 만료 삭제] 작업 ${jobId}`
      );
    }
  }, JOB_CLEANUP_INTERVAL_MS);

jobCleanupTimer.unref();

/* =========================================================
 * 404
 * ======================================================= */

app.use((req, res) => {
  return res
    .status(404)
    .json({
      ok: false,

      reason:
        "요청한 경로가 없습니다."
    });
});

/* =========================================================
 * 오류 처리
 * ======================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Express 오류:",
      error
    );

    safeDeleteFile(req.file?.path);

    if (res.headersSent) {
      return next(error);
    }

    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            reason:
              "업로드 파일은 최대 20MB까지 가능합니다."
          });
      }

      return res
        .status(400)
        .json({
          ok: false,

          reason:
            `파일 업로드 오류: ${error.message}`
        });
    }

    return res
      .status(400)
      .json({
        ok: false,

        reason:
          getErrorMessage(error)
      });
  }
);

/* =========================================================
 * 프로세스 오류
 * ======================================================= */

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "처리되지 않은 Promise 오류:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "처리되지 않은 예외:",
      error
    );
  }
);

/* =========================================================
 * 서버 실행
 * ======================================================= */

const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Detail address extractor running on port ${PORT}`
    );

    console.log(
      "JUSO_CONFIRM_KEY:",
      process.env.JUSO_CONFIRM_KEY
        ? "설정됨"
        : "미설정"
    );

    console.log(
      "SERVER_API_BASE_URL:",
      SERVER_API_BASE_URL ||
      "미설정"
    );

    console.log(
      "SERVER_API_SECRET:",
      SERVER_API_SECRET
        ? "설정됨"
        : "미설정"
    );

    console.log(
      "SERVER_API_TIMEOUT:",
      `${SERVER_API_TIMEOUT}ms`
    );

    console.log(
      "SERVER_EXPOS_ROWS_PER_PAGE:",
      SERVER_EXPOS_ROWS_PER_PAGE
    );

    console.log(
      "SERVER_EXPOS_MAX_PAGES:",
      SERVER_EXPOS_MAX_PAGES
    );

    console.log(
      "ROW_DELAY_MS:",
      `${ROW_DELAY_MS}ms`
    );

    console.log(
      "EXCEL_OUTPUT_MODE:",
      "all 또는 partial"
    );

    console.log(
      "PARTIAL_OUTPUT_COLUMNS:",
      PARTIAL_OUTPUT_COLUMNS.join(", ")
    );
  }
);

server.requestTimeout =
  10 * 60 * 1000;

server.headersTimeout =
  65 * 1000;

server.keepAliveTimeout =
  60 * 1000;
