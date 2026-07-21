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

import {
  analyzeAddress
} from "./addressAnalyzer.js";

/* =========================================================
 * 기본 경로
 * ======================================================= */

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

/* =========================================================
 * 환경변수
 * ======================================================= */

function getSafeNumber(
  value,
  defaultValue,
  min,
  max
) {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return defaultValue;
  }

  return Math.max(
    min,
    Math.min(
      parsed,
      max
    )
  );
}

const PORT =
  getSafeNumber(
    process.env.PORT,
    3000,
    1,
    65535
  );

const SERVER_API_BASE_URL =
  String(
    process.env
      .SERVER_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(
      /^["']|["']$/g,
      ""
    )
    .replace(
      /\/+$/,
      ""
    );

const SERVER_API_SECRET =
  String(
    process.env
      .SERVER_API_SECRET ||
    ""
  )
    .trim()
    .replace(
      /^["']|["']$/g,
      ""
    );

const SERVER_API_TIMEOUT =
  getSafeNumber(
    process.env
      .SERVER_API_TIMEOUT,
    25000,
    5000,
    30000
  );

const SERVER_EXPOS_ROWS_PER_PAGE =
  getSafeNumber(
    process.env
      .SERVER_EXPOS_ROWS_PER_PAGE,
    100,
    10,
    100
  );

const SERVER_EXPOS_MAX_PAGES =
  getSafeNumber(
    process.env
      .SERVER_EXPOS_MAX_PAGES,
    3,
    1,
    5
  );

const ROW_DELAY_MS =
  getSafeNumber(
    process.env
      .ROW_DELAY_MS,
    100,
    0,
    1000
  );

/* =========================================================
 * HTTP Keep-Alive
 * ======================================================= */

const httpAgent =
  new http.Agent({
    keepAlive:
      true,

    maxSockets:
      10,

    maxFreeSockets:
      5,

    timeout:
      SERVER_API_TIMEOUT
  });

const httpsAgent =
  new https.Agent({
    keepAlive:
      true,

    maxSockets:
      10,

    maxFreeSockets:
      5,

    timeout:
      SERVER_API_TIMEOUT
  });

const buildingApiClient =
  axios.create({
    timeout:
      SERVER_API_TIMEOUT,

    httpAgent,

    httpsAgent,

    maxRedirects:
      0,

    validateStatus(
      status
    ) {
      return (
        status >= 200 &&
        status < 300
      );
    }
  });

/* =========================================================
 * Express
 * ======================================================= */

const app =
  express();

const uploadDir =
  path.join(
    __dirname,
    "uploads"
  );

fs.mkdirSync(
  uploadDir,
  {
    recursive:
      true
  }
);

/* =========================================================
 * Multer
 * ======================================================= */

const upload =
  multer({
    dest:
      uploadDir,

    limits: {
      fileSize:
        20 *
        1024 *
        1024
    },

    fileFilter(
      req,
      file,
      callback
    ) {
      const allowedExtensions = [
        ".xlsx",
        ".xls"
      ];

      const extension =
        path
          .extname(
            file.originalname
          )
          .toLowerCase();

      if (
        !allowedExtensions.includes(
          extension
        )
      ) {
        return callback(
          new Error(
            "엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다."
          )
        );
      }

      return callback(
        null,
        true
      );
    }
  });

/* =========================================================
 * 미들웨어
 * ======================================================= */

app.disable(
  "x-powered-by"
);

app.use(
  cors()
);

app.use(
  express.json({
    limit:
      "10mb"
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

/* =========================================================
 * 공통 함수
 * ======================================================= */

function safeDeleteFile(
  filePath
) {
  if (!filePath) {
    return;
  }

  try {
    if (
      fs.existsSync(
        filePath
      )
    ) {
      fs.unlinkSync(
        filePath
      );
    }
  } catch (error) {
    console.error(
      "파일 삭제 실패:",
      filePath,
      error
    );
  }
}

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

function getErrorMessage(
  error
) {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return String(
    error
  );
}

function findColumnName(
  row,
  candidates
) {
  const keys =
    Object.keys(
      row ||
      {}
    );

  return keys.find(
    (key) => {
      const normalizedKey =
        String(key)
          .trim()
          .toLowerCase();

      return candidates.some(
        (candidate) => {
          return (
            normalizedKey ===
            String(candidate)
              .trim()
              .toLowerCase()
          );
        }
      );
    }
  );
}

function getAxiosErrorReason(
  error
) {
  const status =
    error?.response?.status;

  const responseData =
    error?.response?.data;

  if (
    error?.code ===
    "ECONNABORTED"
  ) {
    return (
      `건축물대장 API 응답 제한시간을 초과했습니다. ` +
      `(${SERVER_API_TIMEOUT}ms)`
    );
  }

  if (
    error?.code ===
    "ECONNRESET"
  ) {
    return (
      "건축물대장 API 연결이 중간에 종료되었습니다."
    );
  }

  if (
    error?.code ===
    "ENOTFOUND"
  ) {
    return (
      "건축물대장 API 서버 도메인을 찾지 못했습니다."
    );
  }

  if (
    error?.code ===
    "ECONNREFUSED"
  ) {
    return (
      "건축물대장 API 서버가 연결을 거부했습니다."
    );
  }

  if (
    responseData &&
    typeof responseData ===
      "object"
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
      const serialized =
        JSON.stringify(
          responseData
        );

      return status
        ? `API 오류(${status}): ${serialized}`
        : serialized;
    } catch {
      // JSON 변환 실패 시 아래 기본 메시지 사용
    }
  }

  if (
    typeof responseData ===
      "string" &&
    responseData.trim()
  ) {
    const cleanText =
      responseData
        .replace(
          /<[^>]+>/gu,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    return status
      ? `API 오류(${status}): ${cleanText}`
      : cleanText;
  }

  const message =
    getErrorMessage(
      error
    );

  return status
    ? `API 오류(${status}): ${message}`
    : message;
}

function makeDownloadFileName() {
  const now =
    new Date();

  const pad =
    (value) => {
      return String(value)
        .padStart(
          2,
          "0"
        );
    };

  const dateText =
    [
      now.getFullYear(),
      pad(
        now.getMonth() +
        1
      ),
      pad(
        now.getDate()
      )
    ].join("");

  const timeText =
    [
      pad(
        now.getHours()
      ),
      pad(
        now.getMinutes()
      ),
      pad(
        now.getSeconds()
      )
    ].join("");

  return (
    `주소분석결과_` +
    `${dateText}_` +
    `${timeText}.xlsx`
  );
}

function makeEmptyBuildingResult(
  reason = ""
) {
  return {
    ok:
      false,

    groundFloorCount:
      null,

    undergroundFloorCount:
      null,

    totalFloorText:
      "",

    buildingFloorLookupOk:
      false,

    buildingFloorLookupReason:
      reason,

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
      "",

    buildingValidationReason:
      ""
  };
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
        addressResult
          ?.roadAddress ||
        "",

      roadAddrPart1:
        addressResult
          ?.baseAddress ||
        "",

      roadAddrPart2:
        addressResult
          ?.roadAddrPart2 ||
        "",

      jibunAddr:
        addressResult
          ?.jibunAddress ||
        "",

      zipNo:
        addressResult
          ?.apiZipCode ||
        "",

      admCd:
        addressResult
          ?.admCd ||
        "",

      rnMgtSn:
        addressResult
          ?.rnMgtSn ||
        "",

      udrtYn:
        addressResult
          ?.udrtYn ||
        "",

      buldMnnm:
        addressResult
          ?.buldMnnm ||
        "",

      buldSlno:
        addressResult
          ?.buldSlno ||
        "0",

      bdMgtSn:
        addressResult
          ?.buildingManagementNo ||
        "",

      mtYn:
        addressResult
          ?.mtYn ||
        "0",

      lnbrMnnm:
        addressResult
          ?.lnbrMnnm ||
        "",

      lnbrSlno:
        addressResult
          ?.lnbrSlno ||
        "0",

      bdNm:
        addressResult
          ?.buildingName ||
        "",

      detBdNmList:
        addressResult
          ?.detBdNmList ||
        "",

      siNm:
        addressResult
          ?.siNm ||
        "",

      sggNm:
        addressResult
          ?.sggNm ||
        "",

      emdNm:
        addressResult
          ?.emdNm ||
        "",

      liNm:
        addressResult
          ?.liNm ||
        "",

      rn:
        addressResult
          ?.rn ||
        ""
    };

  const fallbackDong =
    String(
      addressResult
        ?.dong ||
      ""
    );

  const fallbackHo =
    String(
      addressResult
        ?.ho ||
      ""
    );

  const fallbackFloor =
    String(
      addressResult
        ?.floor ||
      ""
    );

  const detail =
    addressResult?.detail ||
    {
      raw:
        addressResult
          ?.detailAddressOriginal ||
        "",

      clean:
        addressResult
          ?.detailAddressNormalized ||
        "",

      pattern:
        addressResult
          ?.detailType ||
        "",

      dongRaw:
        fallbackDong,

      floorRaw:
        fallbackFloor,

      hoRaw:
        fallbackHo,

      targetDong:
        fallbackDong
          .replace(
            /^제/u,
            ""
          )
          .replace(
            /동$/u,
            ""
          )
          .replace(
            /\s+/g,
            ""
          )
          .toLowerCase(),

      targetHo:
        fallbackHo
          .replace(
            /^제/u,
            ""
          )
          .replace(
            /호$/u,
            ""
          )
          .replace(
            /\s+/g,
            ""
          )
          .toLowerCase(),

      floorType:
        fallbackFloor.includes(
          "지하"
        )
          ? "UNDERGROUND"
          : (
              fallbackFloor
                ? "GROUND"
                : ""
            ),

      inputFloor:
        null,

      inferredFloor:
        null
    };

  return {
    orderNo:
      String(
        orderNo ??
        ""
      ),

    inputAddress:
      addressResult
        ?.inputAddress ||
      "",

    baseAddress:
      addressResult
        ?.baseAddress ||
      "",

    juso,

    detail,

    options: {
      exposRowsPerPage:
        SERVER_EXPOS_ROWS_PER_PAGE,

      exposMaxPages:
        SERVER_EXPOS_MAX_PAGES
    },

    /*
     * server.js가 options 안이 아닌 최상위 값을 읽는 경우도
     * 호환되도록 두 위치에 모두 전달합니다.
     */
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

  if (
    !addressResult?.ok
  ) {
    return makeEmptyBuildingResult(
      "기본주소 분석에 실패하여 건축물대장을 조회하지 않았습니다."
    );
  }

  const requestUrl =
    `${SERVER_API_BASE_URL}/api/building/analyze`;

  const payload =
    makeBuildingApiPayload(
      addressResult,
      orderNo
    );

  const headers = {
    "Content-Type":
      "application/json"
  };

  if (SERVER_API_SECRET) {
    headers[
      "x-api-secret"
    ] =
      SERVER_API_SECRET;
  }

  const startedAt =
    Date.now();

  try {
    const response =
      await buildingApiClient.post(
        requestUrl,
        payload,
        {
          headers,

          timeout:
            SERVER_API_TIMEOUT
        }
      );

    const elapsed =
      Date.now() -
      startedAt;

    console.log(
      `[건축물대장 완료] 주문번호: ${orderNo} / ${elapsed}ms`
    );

    const data =
      response.data ||
      {};

    return {
      ...makeEmptyBuildingResult(),
      ...data,

      ok:
        data.ok === true,

      buildingFloorLookupOk:
        data
          .buildingFloorLookupOk ??
        data.ok ??
        false,

      buildingFloorLookupReason:
        data
          .buildingFloorLookupReason ||
        data.reason ||
        data.message ||
        "",

      totalFloorText:
        data
          .totalFloorText ||
        "",

      groundFloorCount:
        data
          .groundFloorCount ??
        null,

      undergroundFloorCount:
        data
          .undergroundFloorCount ??
        null,

      buildingRegisterName:
        data
          .buildingRegisterName ||
        data
          .buildingName ||
        "",

      buildingRegisterDongName:
        data
          .buildingRegisterDongName ||
        data
          .dongName ||
        "",

      buildingRegisterPk:
        data
          .buildingRegisterPk ||
        data
          .buildingPk ||
        "",

      buildingRegisterType:
        data
          .buildingRegisterType ||
        data
          .registerKindName ||
        "",

      buildingLookupSource:
        data
          .buildingLookupSource ||
        data
          .lookupSource ||
        data
          .titleSelectionSource ||
        "",

      buildingValidationStatus:
        data
          .buildingValidationStatus ||
        data
          .validationStatus ||
        data
          .exposMatch
          ?.status ||
        "",

      buildingValidationReason:
        data
          .buildingValidationReason ||
        data
          .validationReason ||
        data
          .exposMatch
          ?.reason ||
        ""
    };
  } catch (error) {
    const elapsed =
      Date.now() -
      startedAt;

    const reason =
      getAxiosErrorReason(
        error
      );

    console.error(
      "server.js 건축물대장 API 호출 실패:",
      {
        url:
          requestUrl,

        orderNo,

        address:
          addressResult
            ?.baseAddress ||
          "",

        elapsed:
          `${elapsed}ms`,

        code:
          error?.code ||
          "",

        reason
      }
    );

    return makeEmptyBuildingResult(
      reason
    );
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
      await analyzeAddress(
        inputAddress
      );
  } catch (error) {
    addressResult = {
      ok:
        false,

      inputAddress,

      reason:
        getErrorMessage(
          error
        )
    };
  }

  let buildingResult;

  if (
    addressResult?.ok
  ) {
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
    address:
      addressResult,

    building:
      buildingResult
  };
}

/* =========================================================
 * 서비스 상태 확인
 * ======================================================= */

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {
    let serverApiReachable =
      false;

    let serverApiStatus =
      "";

    let serverApiResponseTime =
      null;

    if (SERVER_API_BASE_URL) {
      const startedAt =
        Date.now();

      try {
        const response =
          await buildingApiClient.get(
            `${SERVER_API_BASE_URL}/api/health`,
            {
              timeout:
                10000,

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
          response.data
            ?.service ||
          response.data
            ?.status ||
          "응답 정상";
      } catch (error) {
        serverApiResponseTime =
          Date.now() -
          startedAt;

        serverApiStatus =
          getAxiosErrorReason(
            error
          );
      }
    }

    return res.json({
      ok:
        true,

      service:
        "detail-address-extractor",

      jusoKeyConfigured:
        Boolean(
          process.env
            .JUSO_CONFIRM_KEY
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

      timestamp:
        new Date()
          .toISOString()
    });
  }
);

/* =========================================================
 * 주소 1건 분석
 * ======================================================= */

app.post(
  "/api/address/analyze",
  async (
    req,
    res
  ) => {
    try {
      const address =
        String(
          req.body?.address ??
          ""
        ).trim();

      if (!address) {
        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "address가 없습니다."
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
          result.address
            ?.ok === true,

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
          ok:
            false,

          reason:
            getErrorMessage(
              error
            )
        });
    }
  }
);

/* =========================================================
 * 엑셀 주소 분석
 * ======================================================= */

app.post(
  "/api/excel/analyze",

  upload.single(
    "file"
  ),

  async (
    req,
    res
  ) => {
    let uploadedPath =
      "";

    let clientDisconnected =
      false;

    /*
     * req.close는 정상적인 요청 본문 수신 후에도 발생할 수 있으므로
     * 여기서는 res의 close 상태를 기준으로 확인합니다.
     */
    res.on(
      "close",
      () => {
        if (
          !res.writableEnded
        ) {
          clientDisconnected =
            true;

          console.warn(
            "클라이언트 연결이 결과 전송 전에 종료되었습니다."
          );
        }
      }
    );

    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "업로드된 엑셀 파일이 없습니다."
          });
      }

      uploadedPath =
        req.file.path;

      const inputBuffer =
        fs.readFileSync(
          uploadedPath
        );

      const workbook =
        XLSX.read(
          inputBuffer,
          {
            type:
              "buffer",

            cellDates:
              false,

            raw:
              false
          }
        );

      if (
        !Array.isArray(
          workbook.SheetNames
        ) ||
        workbook.SheetNames
          .length === 0
      ) {
        safeDeleteFile(
          uploadedPath
        );

        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "엑셀 시트를 찾지 못했습니다."
          });
      }

      const firstSheetName =
        workbook
          .SheetNames[0];

      const sheet =
        workbook
          .Sheets[
            firstSheetName
          ];

      if (!sheet) {
        safeDeleteFile(
          uploadedPath
        );

        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "첫 번째 엑셀 시트를 읽지 못했습니다."
          });
      }

      const rows =
        XLSX.utils
          .sheet_to_json(
            sheet,
            {
              defval:
                "",

              raw:
                false
            }
          );

      if (
        rows.length === 0
      ) {
        safeDeleteFile(
          uploadedPath
        );

        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "엑셀에 데이터가 없습니다."
          });
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
        safeDeleteFile(
          uploadedPath
        );

        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "주소 열을 찾지 못했습니다. 헤더명을 '주소'로 설정해 주세요."
          });
      }

      const outputRows = [];

      const total =
        rows.length;

      const processingStartedAt =
        Date.now();

      console.log(
        `[엑셀 분석 시작] 총 ${total}건`
      );

      for (
        let index = 0;
        index < total;
        index += 1
      ) {
        if (
          clientDisconnected
        ) {
          console.warn(
            `[엑셀 처리 중단] ${index}/${total}건 처리 후 연결 종료`
          );

          break;
        }

        const row =
          rows[index];

        const inputAddress =
          String(
            row[
              addressColumn
            ] ??
            ""
          ).trim();

        const inputZipCode =
          zipColumn
            ? String(
                row[
                  zipColumn
                ] ??
                ""
              ).trim()
            : "";

        const inputOrderNo =
          orderNoColumn
            ? String(
                row[
                  orderNoColumn
                ] ??
                ""
              ).trim()
            : String(
                index + 1
              );

        const currentOrderNo =
          inputOrderNo ||
          String(
            index + 1
          );

        console.log(
          `[주소 분석] ${index + 1}/${total} / 주문번호: ${currentOrderNo}`
        );

        const rowStartedAt =
          Date.now();

        let result;

        if (!inputAddress) {
          result = {
            address: {
              ok:
                false,

              reason:
                "주소가 비어 있습니다."
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
          result.address ||
          {};

        const building =
          result.building ||
          makeEmptyBuildingResult();

        outputRows.push({
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
            analyzed
              .baseAddress ||
            "",

          도로명주소:
            analyzed
              .roadAddress ||
            analyzed
              .juso
              ?.roadAddr ||
            "",

          지번주소:
            analyzed
              .jibunAddress ||
            analyzed
              .juso
              ?.jibunAddr ||
            "",

          API우편번호:
            analyzed
              .apiZipCode ||
            analyzed
              .juso
              ?.zipNo ||
            "",

          건물명:
            analyzed
              .buildingName ||
            analyzed
              .juso
              ?.bdNm ||
            "",

          건물관리번호:
            analyzed
              .buildingManagementNo ||
            analyzed
              .juso
              ?.bdMgtSn ||
            "",

          전체층수:
            building
              .totalFloorText ||
            "",

          지상층수:
            building
              .groundFloorCount ??
            "",

          지하층수:
            building
              .undergroundFloorCount ??
            "",

          건축물대장조회:
            building
              .buildingFloorLookupOk
              ? "Y"
              : "N",

          건축물대장건물명:
            building
              .buildingRegisterName ||
            "",

          건축물대장동명:
            building
              .buildingRegisterDongName ||
            "",

          건축물대장PK:
            building
              .buildingRegisterPk ||
            "",

          건축물대장유형:
            building
              .buildingRegisterType ||
            "",

          건축물조회방식:
            building
              .buildingLookupSource ||
            "",

          동호검증상태:
            building
              .buildingValidationStatus ||
            "",

          동호검증사유:
            building
              .buildingValidationReason ||
            "",

          건축물대장조회사유:
            building
              .buildingFloorLookupReason ||
            "",

          상세주소원문:
            analyzed
              .detailAddressOriginal ||
            analyzed
              .detail
              ?.raw ||
            "",

          상세주소정규화:
            analyzed
              .detailAddressNormalized ||
            analyzed
              .detail
              ?.clean ||
            "",

          동:
            analyzed.dong ||
            analyzed
              .detail
              ?.dongRaw ||
            "",

          층:
            analyzed.floor ||
            analyzed
              .detail
              ?.floorRaw ||
            "",

          호:
            analyzed.ho ||
            analyzed
              .detail
              ?.hoRaw ||
            "",

          기타정보:
            analyzed.extra ||
            "",

          상세주소유형:
            analyzed
              .detailType ||
            analyzed
              .detail
              ?.pattern ||
            "",

          상세주소상태:
            analyzed
              .detailStatus ||
            "",

          신뢰도:
            analyzed
              .confidence ||
            "",

          검색키워드:
            analyzed
              .searchKeyword ||
            "",

          주소분석실패사유:
            analyzed.reason ||
            ""
        });

        console.log(
          `[주소 완료] ${index + 1}/${total} / ${Date.now() - rowStartedAt}ms`
        );

        if (
          index <
            total - 1 &&
          ROW_DELAY_MS >
            0
        ) {
          await sleep(
            ROW_DELAY_MS
          );
        }
      }

      safeDeleteFile(
        uploadedPath
      );

      uploadedPath =
        "";

      if (
        clientDisconnected
      ) {
        return;
      }

      if (
        outputRows.length ===
        0
      ) {
        return res
          .status(499)
          .json({
            ok:
              false,

            reason:
              "클라이언트 연결 종료로 처리가 중단되었습니다."
          });
      }

      /* =====================================================
       * 결과 엑셀 생성
       * =================================================== */

      const outputSheet =
        XLSX.utils
          .json_to_sheet(
            outputRows
          );

      const outputWorkbook =
        XLSX.utils
          .book_new();

      XLSX.utils
        .book_append_sheet(
          outputWorkbook,
          outputSheet,
          "주소분석결과"
        );

      outputSheet["!cols"] = [
        { wch: 7 },
        { wch: 22 },
        { wch: 14 },
        { wch: 60 },
        { wch: 14 },
        { wch: 45 },
        { wch: 55 },
        { wch: 55 },
        { wch: 14 },
        { wch: 30 },
        { wch: 28 },

        { wch: 26 },
        { wch: 12 },
        { wch: 12 },
        { wch: 18 },
        { wch: 30 },
        { wch: 20 },
        { wch: 32 },
        { wch: 24 },
        { wch: 28 },
        { wch: 28 },
        { wch: 45 },
        { wch: 55 },

        { wch: 30 },
        { wch: 35 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 30 },
        { wch: 22 },
        { wch: 22 },
        { wch: 10 },
        { wch: 50 },
        { wch: 50 }
      ];

      const outputBuffer =
        XLSX.write(
          outputWorkbook,
          {
            type:
              "buffer",

            bookType:
              "xlsx"
          }
        );

      const downloadName =
        makeDownloadFileName();

      const encodedDownloadName =
        encodeURIComponent(
          downloadName
        )
          .replace(
            /['()]/g,
            escape
          )
          .replace(
            /\*/g,
            "%2A"
          );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="address-result.xlsx"; filename*=UTF-8''${encodedDownloadName}`
      );

      res.setHeader(
        "Content-Length",
        String(
          outputBuffer.length
        )
      );

      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );

      res.setHeader(
        "Pragma",
        "no-cache"
      );

      res.setHeader(
        "Expires",
        "0"
      );

      const totalElapsed =
        Date.now() -
        processingStartedAt;

      console.log(
        `[엑셀 완료] 총 ${outputRows.length}건 / ${totalElapsed}ms / ${outputBuffer.length} bytes`
      );

      return res
        .status(200)
        .send(
          outputBuffer
        );
    } catch (error) {
      console.error(
        "엑셀 분석 오류:",
        error
      );

      safeDeleteFile(
        uploadedPath
      );

      if (
        res.headersSent ||
        clientDisconnected
      ) {
        return;
      }

      return res
        .status(500)
        .json({
          ok:
            false,

          reason:
            getErrorMessage(
              error
            )
        });
    }
  }
);

/* =========================================================
 * 404
 * ======================================================= */

app.use(
  (
    req,
    res
  ) => {
    return res
      .status(404)
      .json({
        ok:
          false,

        reason:
          "요청한 경로가 없습니다."
      });
  }
);

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

    safeDeleteFile(
      req.file?.path
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
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
            ok:
              false,

            reason:
              "업로드 파일은 최대 20MB까지 가능합니다."
          });
      }

      return res
        .status(400)
        .json({
          ok:
            false,

          reason:
            `파일 업로드 오류: ${error.message}`
        });
    }

    return res
      .status(400)
      .json({
        ok:
          false,

        reason:
          getErrorMessage(
            error
          )
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

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `Detail address extractor running on port ${PORT}`
      );

      console.log(
        "JUSO_CONFIRM_KEY:",
        process.env
          .JUSO_CONFIRM_KEY
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
    }
  );

/*
 * 엑셀 처리 요청이 길어질 수 있으므로 Node 서버 자체의
 * 요청 제한시간은 충분히 길게 둡니다.
 *
 * 단, Railway 외부 프록시 제한은 별도이므로 대량 데이터에서는
 * 작업 큐 구조가 더 안정적입니다.
 */
server.requestTimeout =
  10 *
  60 *
  1000;

server.headersTimeout =
  65 *
  1000;

server.keepAliveTimeout =
  60 *
  1000;
