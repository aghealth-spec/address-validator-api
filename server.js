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
      jibunAddr: "",
      zipNo: "",
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
      jibunAddr: "",
      zipNo: "",
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

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "address-validator-api"
  });
});

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

      if (!inputAddress) {
        results.push({
          orderNo,
          inputAddress,
          jusoMatch: false,
          matchCount: 0,
          roadAddr: "",
          jibunAddr: "",
          zipNo: "",
          status: "EMPTY_ADDRESS",
          message: "주소값 없음"
        });
        continue;
      }

      try {
        const data = await searchJuso(inputAddress);
        results.push(parseJusoResult(inputAddress, orderNo, data));
      } catch (error) {
        results.push({
          orderNo,
          inputAddress,
          jusoMatch: false,
          matchCount: 0,
          roadAddr: "",
          jibunAddr: "",
          zipNo: "",
          status: "REQUEST_ERROR",
          message: error.message
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
