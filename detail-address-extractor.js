"use strict";

import "dotenv/config";

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

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const app =
  express();

const PORT =
  Number(
    process.env.PORT ||
    3000
  );

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
    recursive: true
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
        20 * 1024 * 1024
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

  return `주소분석결과_${dateText}_${timeText}.xlsx`;
}

/* =========================================================
 * 상태 확인
 * ======================================================= */

app.get(
  "/api/health",
  (req, res) => {
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

      buildingKeyConfigured:
        Boolean(
          process.env
            .BUILDING_API_KEY
        ),

      buildingApiUrl:
        process.env
          .BUILDING_API_URL ||
        "기본 건축물대장 API URL 사용",

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
        await analyzeAddress(
          address
        );

      return res.json(
        result
      );
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

        let analyzed;

        if (!inputAddress) {
          analyzed = {
            ok:
              false,

            reason:
              "주소가 비어 있습니다."
          };
        } else {
          try {
            analyzed =
              await analyzeAddress(
                inputAddress
              );
          } catch (error) {
            analyzed = {
              ok:
                false,

              reason:
                getErrorMessage(
                  error
                )
            };
          }
        }

        outputRows.push({
          순번:
            index + 1,

          입력우편번호:
            inputZipCode,

          입력주소:
            inputAddress,

          처리성공:
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
            "",

          지번주소:
            analyzed
              .jibunAddress ||
            "",

          API우편번호:
            analyzed
              .apiZipCode ||
            "",

          건물명:
            analyzed
              .buildingName ||
            "",

          건물관리번호:
            analyzed
              .buildingManagementNo ||
            "",

          /*
           * 건축물대장 조회 결과
           */
          전체층수:
            analyzed
              .totalFloorText ||
            "",

          지상층수:
            analyzed
              .groundFloorCount ||
            "",

          지하층수:
            analyzed
              .undergroundFloorCount ||
            "",

          건축물대장조회:
            analyzed
              .buildingFloorLookupOk
              ? "Y"
              : "N",

          건축물대장건물명:
            analyzed
              .buildingRegisterName ||
            "",

          건축물대장동명:
            analyzed
              .buildingRegisterDongName ||
            "",

          건축물대장PK:
            analyzed
              .buildingRegisterPk ||
            "",

          건축물대장조회사유:
            analyzed
              .buildingFloorLookupReason ||
            "",

          상세주소원문:
            analyzed
              .detailAddressOriginal ||
            "",

          상세주소정규화:
            analyzed
              .detailAddressNormalized ||
            "",

          동:
            analyzed.dong ||
            "",

          층:
            analyzed.floor ||
            "",

          호:
            analyzed.ho ||
            "",

          기타정보:
            analyzed.extra ||
            "",

          상세주소유형:
            analyzed
              .detailType ||
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

          실패사유:
            analyzed.reason ||
            ""
        });

        /*
         * 주소검색 API와 건축물대장 API가
         * 함께 호출되므로 기존보다 약간 긴 간격을 적용합니다.
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
       * 열 너비 설정
       *
       * outputRows의 열 순서와 동일하게 설정합니다.
       */
      outputSheet["!cols"] = [
        { wch: 7 },   // 순번
        { wch: 14 },  // 입력우편번호
        { wch: 60 },  // 입력주소
        { wch: 10 },  // 처리성공
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
        { wch: 48 },  // 건축물대장조회사유

        { wch: 30 },  // 상세주소원문
        { wch: 35 },  // 상세주소정규화
        { wch: 12 },  // 동
        { wch: 12 },  // 층
        { wch: 12 },  // 호
        { wch: 30 },  // 기타정보
        { wch: 18 },  // 상세주소유형
        { wch: 20 },  // 상세주소상태
        { wch: 10 },  // 신뢰도
        { wch: 50 },  // 검색키워드
        { wch: 40 }   // 실패사유
      ];

      /*
       * Railway 및 ES module 환경에서
       * writeFile 대신 버퍼 방식으로 저장
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
      process.env.JUSO_CONFIRM_KEY
        ? "설정됨"
        : "미설정"
    );

    console.log(
      "BUILDING_API_KEY:",
      process.env.BUILDING_API_KEY
        ? "설정됨"
        : "미설정"
    );
  }
);
