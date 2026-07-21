"use strict";

import "dotenv/config";

import axios from "axios";
import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
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

const PORT =
  Number(
    process.env.PORT ||
    3000
  );

const SERVER_API_BASE_URL =
  String(
    process.env
      .SERVER_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(
      /\/+$/,
      ""
    );

const SERVER_API_SECRET =
  String(
    process.env
      .SERVER_API_SECRET ||
    ""
  ).trim();

const SERVER_API_TIMEOUT =
  Number(
    process.env
      .SERVER_API_TIMEOUT ||
    60000
  );

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

/* =========================================================
 * 업로드 폴더 생성
 * ======================================================= */

fs.mkdirSync(
  uploadDir,
  {
    recursive:
      true
  }
);

/* =========================================================
 * 업로드 설정
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
      cb
    ) {
      const allowed = [
        ".xlsx",
        ".xls"
      ];

      const ext =
        path
          .extname(
            file.originalname
          )
          .toLowerCase();

      if (
        !allowed.includes(
          ext
        )
      ) {
        return cb(
          new Error(
            "엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다."
          )
        );
      }

      return cb(
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
    (key) =>
      candidates.some(
        (candidate) =>
          String(key)
            .trim()
            .toLowerCase() ===
          String(candidate)
            .trim()
            .toLowerCase()
      )
  );
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function getErrorMessage(
  error
) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function getAxiosErrorReason(
  error
) {
  const status =
    error?.response?.status;

  const data =
    error?.response?.data;

  if (
    data &&
    typeof data === "object"
  ) {
    const reason =
      data.reason ||
      data.message ||
      data.error ||
      data.detail;

    if (reason) {
      return status
        ? `API 오류(${status}): ${reason}`
        : String(reason);
    }

    try {
      return status
        ? `API 오류(${status}): ${JSON.stringify(
            data
          )}`
        : JSON.stringify(
            data
          );
    } catch {
      // 무시
    }
  }

  if (
    typeof data === "string" &&
    data.trim()
  ) {
    const clean =
      data
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
      ? `API 오류(${status}): ${clean}`
      : clean;
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
    (value) =>
      String(value)
        .padStart(
          2,
          "0"
        );

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
 * server.js 호출용 데이터 생성
 * ======================================================= */

function makeBuildingApiPayload(
  addressResult,
  orderNo
) {
  /*
   * 새 addressAnalyzer.js가 반환하는
   * juso/detail 객체를 우선 사용합니다.
   */
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
        ""
    };

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
        addressResult
          ?.dong ||
        "",

      floorRaw:
        addressResult
          ?.floor ||
        "",

      hoRaw:
        addressResult
          ?.ho ||
        "",

      targetDong:
        String(
          addressResult
            ?.dong ||
          ""
        )
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
        String(
          addressResult
            ?.ho ||
          ""
        )
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
        String(
          addressResult
            ?.floor ||
          ""
        ).includes(
          "지하"
        )
          ? "UNDERGROUND"
          : (
              addressResult
                ?.floor
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

    detail
  };
}

/* =========================================================
 * server.js 건축물대장 API 호출
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

  try {
    const response =
      await axios.post(
        `${SERVER_API_BASE_URL}/api/building/analyze`,

        payload,

        {
          headers,

          timeout:
            SERVER_API_TIMEOUT,

          validateStatus(
            status
          ) {
            return (
              status >= 200 &&
              status < 300
            );
          }
        }
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
          .exposMatch?.status ||
        "",

      buildingValidationReason:
        data
          .buildingValidationReason ||
        data
          .validationReason ||
        data
          .exposMatch?.reason ||
        ""
    };
  } catch (error) {
    const reason =
      getAxiosErrorReason(
        error
      );

    console.error(
      "server.js 건축물대장 API 호출 실패:",
      {
        url:
          `${SERVER_API_BASE_URL}/api/building/analyze`,

        orderNo,

        address:
          addressResult
            ?.baseAddress ||
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
 * 주소 분석 + 건축물대장 조회
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

  let buildingResult =
    makeEmptyBuildingResult();

  if (addressResult.ok) {
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
 * 상태 확인
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

    if (SERVER_API_BASE_URL) {
      try {
        const response =
          await axios.get(
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

        serverApiReachable =
          response.status >= 200 &&
          response.status < 300;

        serverApiStatus =
          response.data?.service ||
          response.data?.status ||
          "응답 정상";
      } catch (error) {
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

      timestamp:
        new Date()
          .toISOString()
    });
  }
);

/* =========================================================
 * 주소 1건 분석
 *
 * 주소 정제 후 server.js까지 호출한 통합 결과입니다.
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
          result.address.ok,

        address:
          result.address,

        building:
          result.building
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

    let outputPath =
      "";

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

      /*
       * Railway 및 ES module 환경에서
       * readFile 대신 버퍼 방식으로 읽기
       */
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
        return res
          .status(400)
          .json({
            ok:
              false,

            reason:
              "주소 열을 찾지 못했습니다. 헤더명을 '주소'로 설정해 주세요."
          });
      }

      const outputRows =
        [];

      const total =
        rows.length;

      for (
        let index = 0;
        index < total;
        index += 1
      ) {
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
              inputOrderNo ||
              String(
                index + 1
              )
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

        /*
         * Juso API와 server.js API가 연속 호출되므로
         * 각 행 사이에 짧은 대기시간을 둡니다.
         */
        if (
          index <
          total - 1
        ) {
          await sleep(
            180
          );
        }
      }

      /*
       * 결과 엑셀 생성
       */
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

      /*
       * 열 너비
       */
      outputSheet["!cols"] = [
        { wch: 7 },   // 순번
        { wch: 22 },  // 주문번호
        { wch: 14 },  // 입력우편번호
        { wch: 60 },  // 입력주소
        { wch: 14 },  // 주소처리성공
        { wch: 45 },  // 기본주소
        { wch: 55 },  // 도로명주소
        { wch: 55 },  // 지번주소
        { wch: 14 },  // API우편번호
        { wch: 30 },  // 건물명
        { wch: 28 },  // 건물관리번호

        { wch: 26 },  // 전체층수
        { wch: 12 },  // 지상층수
        { wch: 12 },  // 지하층수
        { wch: 18 },  // 건축물대장조회
        { wch: 30 },  // 건축물대장건물명
        { wch: 20 },  // 건축물대장동명
        { wch: 32 },  // 건축물대장PK
        { wch: 24 },  // 건축물대장유형
        { wch: 28 },  // 건축물조회방식
        { wch: 28 },  // 동호검증상태
        { wch: 45 },  // 동호검증사유
        { wch: 55 },  // 건축물대장조회사유

        { wch: 30 },  // 상세주소원문
        { wch: 35 },  // 상세주소정규화
        { wch: 12 },  // 동
        { wch: 12 },  // 층
        { wch: 12 },  // 호
        { wch: 30 },  // 기타정보
        { wch: 22 },  // 상세주소유형
        { wch: 22 },  // 상세주소상태
        { wch: 10 },  // 신뢰도
        { wch: 50 },  // 검색키워드
        { wch: 50 }   // 주소분석실패사유
      ];

      /*
       * 버퍼 방식으로 저장
       */
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

      const outputFileName =
        `address-result-${Date.now()}.xlsx`;

      outputPath =
        path.join(
          uploadDir,
          outputFileName
        );

      fs.writeFileSync(
        outputPath,
        outputBuffer
      );

      const downloadName =
        makeDownloadFileName();

      return res.download(
        outputPath,
        downloadName,
        (error) => {
          safeDeleteFile(
            outputPath
          );

          safeDeleteFile(
            uploadedPath
          );

          if (error) {
            console.error(
              "다운로드 오류:",
              error
            );
          }
        }
      );
    } catch (error) {
      console.error(
        error
      );

      safeDeleteFile(
        outputPath
      );

      safeDeleteFile(
        uploadedPath
      );

      if (
        res.headersSent
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
 * 서버 실행
 * ======================================================= */

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
      SERVER_API_BASE_URL
        ? SERVER_API_BASE_URL
        : "미설정"
    );

    console.log(
      "SERVER_API_SECRET:",
      SERVER_API_SECRET
        ? "설정됨"
        : "미설정"
    );
  }
);
