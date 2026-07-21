"use strict";

import "dotenv/config";

import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { analyzeAddress } from "./addressAnalyzer.js";

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, "uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 20 * 1024 * 1024
  },
  fileFilter(req, file, cb) {
    const allowed = [".xlsx", ".xls"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowed.includes(ext)) {
      return cb(new Error("엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다."));
    }

    cb(null, true);
  }
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "address-validator-api",
    jusoKeyConfigured: Boolean(process.env.JUSO_CONFIRM_KEY)
  });
});

app.post("/api/address/analyze", async (req, res) => {
  try {
    const address = String(req.body?.address ?? "").trim();

    if (!address) {
      return res.status(400).json({
        ok: false,
        reason: "address가 없습니다."
      });
    }

    const result = await analyzeAddress(address);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      reason: error.message
    });
  }
});

function findColumnName(row, candidates) {
  const keys = Object.keys(row || {});
  return keys.find((key) =>
    candidates.some((candidate) =>
      String(key).trim().toLowerCase() === candidate.toLowerCase()
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/api/excel/analyze", upload.single("file"), async (req, res) => {
  let uploadedPath = "";

  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        reason: "업로드된 엑셀 파일이 없습니다."
      });
    }

    uploadedPath = req.file.path;

    const workbook = XLSX.readFile(uploadedPath, {
      cellDates: false,
      raw: false
    });

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false
    });

    if (rows.length === 0) {
      return res.status(400).json({
        ok: false,
        reason: "엑셀에 데이터가 없습니다."
      });
    }

    const addressColumn = findColumnName(rows[0], [
      "주소",
      "address",
      "배송지주소",
      "수령자주소"
    ]);

    const zipColumn = findColumnName(rows[0], [
      "우편번호",
      "zipcode",
      "zip",
      "postalcode"
    ]);

    if (!addressColumn) {
      return res.status(400).json({
        ok: false,
        reason: "주소 열을 찾지 못했습니다. 헤더명을 '주소'로 설정해 주세요."
      });
    }

    const outputRows = [];
    const total = rows.length;

    for (let index = 0; index < total; index++) {
      const row = rows[index];
      const inputAddress = String(row[addressColumn] ?? "").trim();
      const inputZipCode = zipColumn
        ? String(row[zipColumn] ?? "").trim()
        : "";

      let analyzed;

      if (!inputAddress) {
        analyzed = {
          ok: false,
          reason: "주소가 비어 있습니다."
        };
      } else {
        analyzed = await analyzeAddress(inputAddress);
      }

      outputRows.push({
        순번: index + 1,
        입력우편번호: inputZipCode,
        입력주소: inputAddress,
        처리성공: analyzed.ok ? "Y" : "N",
        기본주소: analyzed.baseAddress || "",
        도로명주소: analyzed.roadAddress || "",
        지번주소: analyzed.jibunAddress || "",
        API우편번호: analyzed.apiZipCode || "",
        건물명: analyzed.buildingName || "",
        건물관리번호: analyzed.buildingManagementNo || "",
        상세주소원문: analyzed.detailAddressOriginal || "",
        상세주소정규화: analyzed.detailAddressNormalized || "",
        동: analyzed.dong || "",
        층: analyzed.floor || "",
        호: analyzed.ho || "",
        기타정보: analyzed.extra || "",
        상세주소유형: analyzed.detailType || "",
        상세주소상태: analyzed.detailStatus || "",
        신뢰도: analyzed.confidence || "",
        검색키워드: analyzed.searchKeyword || "",
        실패사유: analyzed.reason || ""
      });

      // 주소 API에 과도한 동시 호출을 하지 않도록 소폭 대기
      if (index < total - 1) {
        await sleep(120);
      }
    }

    const outputSheet = XLSX.utils.json_to_sheet(outputRows);
    const outputWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outputWorkbook, outputSheet, "주소분석결과");

    outputSheet["!cols"] = [
      { wch: 7 }, { wch: 14 }, { wch: 60 }, { wch: 10 },
      { wch: 45 }, { wch: 55 }, { wch: 55 }, { wch: 14 },
      { wch: 30 }, { wch: 28 }, { wch: 30 }, { wch: 35 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 },
      { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 50 },
      { wch: 35 }
    ];

    const outputFileName = `address-result-${Date.now()}.xlsx`;
    const outputPath = path.join(uploadDir, outputFileName);

    XLSX.writeFile(outputWorkbook, outputPath);

    res.download(outputPath, "주소분석결과.xlsx", (error) => {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      } catch (cleanupError) {
        console.error("파일 정리 실패:", cleanupError);
      }

      if (error) {
        console.error("다운로드 오류:", error);
      }
    });
  } catch (error) {
    console.error(error);

    if (uploadedPath && fs.existsSync(uploadedPath)) {
      fs.unlinkSync(uploadedPath);
    }

    res.status(500).json({
      ok: false,
      reason: error.message
    });
  }
});

app.use((error, req, res, next) => {
  console.error(error);

  if (req.file?.path && fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
  }

  res.status(400).json({
    ok: false,
    reason: error.message
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
