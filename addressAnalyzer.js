"use strict";

import axios from "axios";

const JUSO_API_URL =
  "https://business.juso.go.kr/addrlink/addrLinkApi.do";

const JUSO_CONFIRM_KEY =
  process.env.JUSO_CONFIRM_KEY;

function cleanAddress(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[，]/g, ",")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(
      /특별시|광역시|특별자치시|특별자치도/g,
      ""
    )
    .replace(/아파트/g, "")
    .replace(/번지/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function removeParentheses(value) {
  return cleanAddress(
    String(value ?? "").replace(
      /\([^)]*\)/gu,
      " "
    )
  );
}

function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function buildFlexiblePattern(value) {
  return String(value)
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s*");
}

function cleanupRemainingText(value) {
  return String(value ?? "")
    .replace(/[()[\]]/g, " ")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(
      /^[\s,.-]+|[\s,.-]+$/g,
      ""
    )
    .trim();
}

function makeSearchCandidates(
  originalAddress
) {
  const candidates = new Set();

  const text =
    cleanAddress(
      originalAddress
    );

  candidates.add(text);

  candidates.add(
    cleanAddress(
      text
        .replace(
          /\s+(?:[가-힣A-Za-z]+\s*)?\d{1,4}\s*동\s*\d{1,5}\s*호.*$/u,
          ""
        )
        .replace(
          /\s+\d{1,5}\s*호.*$/u,
          ""
        )
        .replace(
          /\s+(?:지하|지상)?\s*\d+\s*층.*$/u,
          ""
        )
    )
  );

  candidates.add(
    cleanAddress(
      text.replace(
        /[, ]+\d{1,4}\s*[-/]\s*\d{1,5}(?:\s*호)?(?:\s|,|$).*$/u,
        ""
      )
    )
  );

  candidates.add(
    cleanAddress(
      text.replace(
        /[, ]+(?:[가-힣A-Za-z0-9]+\s*)?동\s*\d{1,5}\s*호.*$/u,
        ""
      )
    )
  );

  candidates.add(
    cleanAddress(
      text.replace(
        /\)\s+\d{2,5}(?:\s*호)?\s*$/u,
        ")"
      )
    )
  );

  candidates.add(
    cleanAddress(
      removeParentheses(text)
    )
  );

  const jibunMatch =
    text.match(
      /^(.+?[가-힣]+동\s+(?:산\s*)?\d+(?:-\d+)?)(?:번지)?(?:\s|,|$)/u
    );

  if (jibunMatch) {
    candidates.add(
      cleanAddress(
        jibunMatch[1]
      )
    );
  }

  const roadMatch =
    text.match(
      /^(.+?(?:대로|로|길)\s*\d+(?:-\d+)?)(?:\s|,|\(|$)/u
    );

  if (roadMatch) {
    candidates.add(
      cleanAddress(
        roadMatch[1]
      )
    );
  }

  return [
    ...candidates
  ].filter(
    (value) =>
      value &&
      value.length >= 5
  );
}

async function searchJuso(
  keyword
) {
  if (!JUSO_CONFIRM_KEY) {
    throw new Error(
      "환경변수 JUSO_CONFIRM_KEY가 설정되지 않았습니다."
    );
  }

  const response =
    await axios.get(
      JUSO_API_URL,
      {
        params: {
          confmKey:
            JUSO_CONFIRM_KEY,

          currentPage: 1,

          countPerPage: 20,

          keyword,

          resultType: "json",

          hstryYn: "Y",

          firstSort: "none"
        },

        timeout: 15000
      }
    );

  const results =
    response.data?.results;

  const common =
    results?.common;

  const items =
    Array.isArray(
      results?.juso
    )
      ? results.juso
      : [];

  if (
    common?.errorCode !== "0"
  ) {
    return {
      ok: false,

      keyword,

      errorCode:
        common?.errorCode ||
        "",

      errorMessage:
        common?.errorMessage ||
        "",

      items: []
    };
  }

  return {
    ok: true,
    keyword,
    items
  };
}

function getJibunNumber(
  jibunAddress
) {
  const match =
    String(
      jibunAddress ?? ""
    ).match(
      /(?:산\s*)?(\d+(?:-\d+)?)\s*$/u
    );

  return match
    ? match[1]
    : "";
}

function makeRoadBuildingNumber(
  item
) {
  const main =
    String(
      item.buldMnnm ||
      ""
    ).trim();

  const sub =
    String(
      item.buldSlno ||
      ""
    ).trim();

  if (!main) {
    return "";
  }

  return (
    sub &&
    sub !== "0"
  )
    ? `${main}-${sub}`
    : main;
}

function makeRoadKey(
  item
) {
  const roadName =
    item.rn ||
    "";

  const number =
    makeRoadBuildingNumber(
      item
    );

  return (
    roadName &&
    number
  )
    ? `${roadName} ${number}`
    : "";
}

function fuzzyContains(
  source,
  target
) {
  const sourceText =
    compact(source);

  const targetText =
    compact(target);

  return (
    targetText.length >= 2 &&
    sourceText.includes(
      targetText
    )
  );
}

function selectBestAddress(
  items,
  originalAddress
) {
  if (!items.length) {
    return null;
  }

  const originalCompact =
    compact(
      originalAddress
    );

  const scored =
    items.map(
      (item) => {
        let score = 0;

        const road =
          compact(
            item.roadAddrPart1 ||
            item.roadAddr
          );

        const jibun =
          compact(
            item.jibunAddr
          );

        const building =
          compact(
            item.bdNm
          );

        const detailBuildings =
          compact(
            item.detBdNmList
          );

        if (
          road &&
          originalCompact.includes(
            road
          )
        ) {
          score += 100;
        }

        if (
          jibun &&
          originalCompact.includes(
            jibun
          )
        ) {
          score += 100;
        }

        const apiJibunNumber =
          getJibunNumber(
            item.jibunAddr
          );

        if (
          apiJibunNumber &&
          originalCompact.includes(
            compact(
              apiJibunNumber
            )
          )
        ) {
          score += 40;
        }

        const roadKey =
          makeRoadKey(item);

        if (
          roadKey &&
          originalCompact.includes(
            compact(
              roadKey
            )
          )
        ) {
          score += 50;
        }

        if (
          building &&
          fuzzyContains(
            originalCompact,
            building
          )
        ) {
          score += 35;
        }

        if (
          detailBuildings &&
          fuzzyContains(
            originalCompact,
            detailBuildings
          )
        ) {
          score += 20;
        }

        [
          item.siNm,
          item.sggNm,
          item.emdNm
        ].forEach(
          (value) => {
            if (
              value &&
              originalCompact.includes(
                compact(value)
              )
            ) {
              score += 5;
            }
          }
        );

        return {
          item,
          score
        };
      }
    );

  scored.sort(
    (a, b) =>
      b.score - a.score
  );

  if (
    scored.length === 1
  ) {
    return scored[0].item;
  }

  return (
    scored[0].score >= 20
  )
    ? scored[0].item
    : null;
}

function shortProvinceName(
  value
) {
  const map = {
    서울특별시: "서울",
    부산광역시: "부산",
    대구광역시: "대구",
    인천광역시: "인천",
    광주광역시: "광주",
    대전광역시: "대전",
    울산광역시: "울산",
    세종특별자치시: "세종",
    경기도: "경기",
    강원특별자치도: "강원",
    충청북도: "충북",
    충청남도: "충남",
    전북특별자치도: "전북",
    전라남도: "전남",
    경상북도: "경북",
    경상남도: "경남",
    제주특별자치도: "제주"
  };

  return map[value] || "";
}

function removeToken(
  source,
  token
) {
  if (
    !source ||
    !token
  ) {
    return source;
  }

  return cleanAddress(
    source.replace(
      new RegExp(
        buildFlexiblePattern(
          token
        ),
        "giu"
      ),
      " "
    )
  );
}

function removeSimilarText(
  source,
  target
) {
  if (
    !source ||
    !target
  ) {
    return source;
  }

  let result =
    source.replace(
      new RegExp(
        escapeRegExp(
          target
        ),
        "giu"
      ),
      " "
    );

  const withoutParentheses =
    removeParentheses(
      target
    );

  if (withoutParentheses) {
    result =
      result.replace(
        new RegExp(
          buildFlexiblePattern(
            withoutParentheses
          ),
          "giu"
        ),
        " "
      );
  }

  return cleanAddress(
    result
  );
}

function normalizeFloor(
  value
) {
  const floor =
    String(value)
      .replace(/\s+/g, "")
      .toUpperCase();

  return `${floor}층`;
}

function hasDetailPattern(
  value
) {
  return (
    /[가-힣A-Za-z0-9]+\s*동/u.test(
      value
    ) ||
    /(?:지하|지상|B)?\s*\d+\s*층/u.test(
      value
    ) ||
    /\d+\s*호/u.test(
      value
    ) ||
    /\d{1,4}\s*[-/]\s*\d{1,5}/u.test(
      value
    )
  );
}

function classifyExtraText(
  value
) {
  if (
    /경비실|문앞|현관|택배함|관리실/u.test(
      value
    )
  ) {
    return "배송 요청사항";
  }

  if (
    /사무실|대리점|매장|세탁소|헤어|스시/u.test(
      value
    )
  ) {
    return "상호·사업장";
  }

  if (
    /지하/u.test(
      value
    )
  ) {
    return "지하 위치 표현";
  }

  return "기타 상세정보";
}

function parseDetailText(
  value
) {
  const original =
    cleanupRemainingText(
      value
    );

  let text =
    original;

  let dong = "";
  let floor = "";
  let ho = "";
  let extra = "";

  let type =
    "unknown";

  let status =
    "자동판정 불가";

  let confidence =
    "낮음";

  if (!text) {
    return {
      original: "",

      normalized: "",

      dong,

      floor,

      ho,

      extra,

      type: "none",

      status:
        "상세주소 없음",

      confidence:
        "낮음",

      remainingText: ""
    };
  }

  const dongMatch =
    text.match(
      /(?:^|[\s,])((?:제\s*)?[가-힣A-Za-z0-9]+)\s*동(?=\s|,|\d|$)/u
    );

  if (dongMatch) {
    dong =
      `${dongMatch[1]
        .replace(/\s+/g, "")}동`;

    text =
      text.replace(
        dongMatch[0],
        " "
      );
  }

  const floorMatch =
    text.match(
      /(?:^|[\s,])((?:지하|지상)\s*\d+|B\s*\d+|\d+)\s*층/u
    );

  if (floorMatch) {
    floor =
      normalizeFloor(
        floorMatch[1]
      );

    text =
      text.replace(
        floorMatch[0],
        " "
      );
  }

  const hoMatch =
    text.match(
      /(?:^|[\s,])([A-Za-z가-힣]?\d+[A-Za-z가-힣]?)\s*호/u
    );

  if (hoMatch) {
    ho =
      `${hoMatch[1]}호`;

    text =
      text.replace(
        hoMatch[0],
        " "
      );
  }

  if (
    !dong &&
    !ho
  ) {
    const hyphenMatch =
      text.match(
        /(?:^|[\s,])(\d{1,4})\s*[-/]\s*(\d{1,5})(?=\s|,|$|\()/u
      );

    if (hyphenMatch) {
      dong =
        `${hyphenMatch[1]}동`;

      ho =
        `${hyphenMatch[2]}호`;

      text =
        text.replace(
          hyphenMatch[0],
          " "
        );

      type =
        "동-호 축약형";

      status =
        "형식 변환";

      confidence =
        "중간";
    }
  }

  if (
    !ho &&
    /^\s*\d{2,5}\s*$/u.test(
      text
    )
  ) {
    const number =
      text.trim();

    ho =
      `${number}호`;

    text = "";

    type =
      "숫자 단독";

    status =
      "호 표기 누락 의심";

    confidence =
      "중간";
  }

  if (!ho) {
    const attachedMatch =
      text.match(
        /(?:^|[\s,])(\d{1,5})([가-힣A-Za-z].+)$/u
      );

    if (attachedMatch) {
      ho =
        `${attachedMatch[1]}호`;

      extra =
        attachedMatch[2]
          .trim();

      text = "";

      type =
        "호수·상호명 결합";

      status =
        "보정 필요";

      confidence =
        "낮음";
    }
  }

  extra =
    cleanupRemainingText(
      [
        extra,
        text
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (
    dong &&
    ho
  ) {
    if (
      type === "unknown"
    ) {
      type = "동·호";
    }

    if (
      status ===
      "자동판정 불가"
    ) {
      status = "정상";
    }

    if (
      status === "정상"
    ) {
      confidence = "높음";
    }
  } else if (
    floor &&
    ho
  ) {
    type = "층·호";
    status = "정상";
    confidence = "높음";
  } else if (ho) {
    if (
      type === "unknown"
    ) {
      type = "호";
    }

    if (
      status ===
      "자동판정 불가"
    ) {
      status =
        "부분 상세주소";
    }

    if (
      confidence === "낮음"
    ) {
      confidence = "중간";
    }
  } else if (floor) {
    type = "층";
    status =
      "부분 상세주소";
    confidence =
      "중간";
  } else if (dong) {
    type = "동";
    status =
      "부분 상세주소";
    confidence =
      "중간";
  } else if (extra) {
    type =
      classifyExtraText(
        extra
      );

    status =
      "상세주소 확인 필요";

    confidence =
      "낮음";
  }

  const normalized =
    [
      dong,
      floor,
      ho,
      extra
    ]
      .filter(Boolean)
      .join(" ");

  return {
    original,

    normalized,

    dong,

    floor,

    ho,

    extra,

    type,

    status,

    confidence,

    remainingText:
      original
  };
}

function extractDetailByConfirmedAddress(
  originalAddress,
  apiAddress
) {
  const original =
    cleanAddress(
      originalAddress
    );

  let remaining =
    original;

  const removableValues = [
    apiAddress.roadAddr,
    apiAddress.roadAddrPart1,
    apiAddress.jibunAddr,
    apiAddress.bdNm,
    apiAddress.detBdNmList
  ]
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.length - a.length
    );

  for (
    const value
    of removableValues
  ) {
    remaining =
      removeSimilarText(
        remaining,
        value
      );
  }

  const addressParts = [
    apiAddress.siNm,
    shortProvinceName(
      apiAddress.siNm
    ),
    apiAddress.sggNm,
    apiAddress.emdNm,
    apiAddress.liNm,
    apiAddress.rn
  ].filter(Boolean);

  for (
    const part
    of addressParts
  ) {
    remaining =
      removeToken(
        remaining,
        part
      );
  }

  const jibunNumber =
    getJibunNumber(
      apiAddress.jibunAddr
    );

  if (jibunNumber) {
    remaining =
      removeToken(
        remaining,
        `${jibunNumber}번지`
      );

    remaining =
      removeToken(
        remaining,
        jibunNumber
      );
  }

  const roadNumber =
    makeRoadBuildingNumber(
      apiAddress
    );

  if (roadNumber) {
    remaining =
      removeToken(
        remaining,
        roadNumber
      );
  }

  const buildingNames = [
    apiAddress.bdNm,

    ...(
      apiAddress
        .detBdNmList ||
      ""
    )
      .split(",")
      .map(
        (value) =>
          value.trim()
      )
  ].filter(Boolean);

  for (
    const buildingName
    of buildingNames
  ) {
    remaining =
      removeSimilarText(
        remaining,
        buildingName
      );
  }

  remaining =
    remaining.replace(
      /\(([^)]*)\)/gu,
      (
        full,
        inside
      ) => {
        return hasDetailPattern(
          inside
        )
          ? ` ${inside} `
          : " ";
      }
    );

  remaining =
    cleanupRemainingText(
      remaining
    );

  return parseDetailText(
    remaining
  );
}

async function analyzeAddress(
  inputAddress
) {
  const originalAddress =
    cleanAddress(
      inputAddress
    );

  if (!originalAddress) {
    return {
      ok: false,

      inputAddress: "",

      reason:
        "주소가 비어 있습니다."
    };
  }

  const candidates =
    makeSearchCandidates(
      originalAddress
    );

  let selected = null;
  let usedKeyword = "";

  for (
    const keyword
    of candidates
  ) {
    try {
      const result =
        await searchJuso(
          keyword
        );

      if (
        result.ok &&
        result.items.length > 0
      ) {
        selected =
          selectBestAddress(
            result.items,
            originalAddress
          );

        usedKeyword =
          keyword;

        if (selected) {
          break;
        }
      }
    } catch (error) {
      return {
        ok: false,

        inputAddress:
          originalAddress,

        reason:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  if (!selected) {
    return {
      ok: false,

      inputAddress:
        originalAddress,

      searchCandidates:
        candidates.join(" | "),

      reason:
        "기본주소를 확정하지 못했습니다."
    };
  }

  const baseAddress =
    selected.roadAddrPart1 ||
    removeParentheses(
      selected.roadAddr ||
      ""
    );

  const detail =
    extractDetailByConfirmedAddress(
      originalAddress,
      selected
    );

  return {
    ok: true,

    inputAddress:
      originalAddress,

    searchKeyword:
      usedKeyword,

    baseAddress,

    roadAddress:
      selected.roadAddr ||
      "",

    jibunAddress:
      selected.jibunAddr ||
      "",

    buildingName:
      selected.bdNm ||
      "",

    buildingManagementNo:
      selected.bdMgtSn ||
      "",

    apiZipCode:
      selected.zipNo ||
      "",

    detailAddressOriginal:
      detail.original,

    detailAddressNormalized:
      detail.normalized,

    dong:
      detail.dong,

    floor:
      detail.floor,

    ho:
      detail.ho,

    extra:
      detail.extra,

    detailType:
      detail.type,

    detailStatus:
      detail.status,

    confidence:
      detail.confidence
  };
}

export {
  analyzeAddress,
  cleanAddress,
  makeSearchCandidates,
  parseDetailText
};
