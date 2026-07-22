"use strict";

import axios from "axios";

/* =========================================================
 * 환경변수
 * ======================================================= */

const JUSO_API_URL =
  "https://business.juso.go.kr/addrlink/addrLinkApi.do";

const JUSO_CONFIRM_KEY = String(
  process.env.JUSO_CONFIRM_KEY || ""
).trim();

/* =========================================================
 * 기본 문자열 처리
 * ======================================================= */

function cleanAddress(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
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
    .replace(/공동주택/g, "")
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
      /^[\s,./-]+|[\s,./-]+$/g,
      ""
    )
    .trim();
}

function uniqueValues(values) {
  return [
    ...new Set(
      values
        .map((value) =>
          cleanAddress(value)
        )
        .filter(Boolean)
    )
  ];
}

/* =========================================================
 * 건물명 검색어 변형
 *
 * 예:
 * 위시티일산블루밍5단지아파트
 * → 위시티일산블루밍5단지
 * → 위시티블루밍5단지
 * → 위시티 블루밍 5 단지
 * ======================================================= */

function makeRegionAliasWords(localityText) {
  const text =
    cleanAddress(localityText);

  if (!text) {
    return [];
  }

  const words = [];

  for (
    const token
    of text.split(/\s+/u)
  ) {
    const normalized =
      token
        .replace(
          /특별자치도|특별자치시|특별시|광역시|도|시|군|구|읍|면|동|가|리$/u,
          ""
        )
        .trim();

    if (
      normalized.length >= 2
    ) {
      words.push(normalized);
    }

    /*
     * 일산동구 → 일산
     * 일산서구 → 일산
     * 분당구   → 분당
     */
    const districtRoot =
      token.match(
        /^([가-힣]{2,})(?:동구|서구|남구|북구|중구)$/u
      );

    if (districtRoot?.[1]) {
      words.push(
        districtRoot[1]
      );
    }
  }

  return uniqueValues(words)
    .filter(
      (word) =>
        word.length >= 2
    );
}

function addBuildingNameVariants(
  candidates,
  buildingName,
  localityText = ""
) {
  const original =
    cleanAddress(buildingName);

  if (!original) {
    return;
  }

  const base =
    cleanAddress(
      removeParentheses(original)
        .replace(/아파트/gu, " ")
        .replace(/공동주택/gu, " ")
    );

  if (!base) {
    return;
  }

  const values =
    new Set([
      original,
      base,

      /*
       * 공백 제거
       */
      base.replace(
        /\s+/gu,
        ""
      ),

      /*
       * 문자와 숫자 사이 공백
       */
      base
        .replace(
          /([가-힣A-Za-z])([0-9])/gu,
          "$1 $2"
        )
        .replace(
          /([0-9])([가-힣A-Za-z])/gu,
          "$1 $2"
        )
    ]);

  const regionWords =
    makeRegionAliasWords(
      localityText
    );

  for (
    const regionWord
    of regionWords
  ) {
    const withoutRegion =
      cleanAddress(
        base.replace(
          new RegExp(
            escapeRegExp(
              regionWord
            ),
            "gu"
          ),
          " "
        )
      );

    if (
      !withoutRegion ||
      withoutRegion === base
    ) {
      continue;
    }

    values.add(
      withoutRegion
    );

    values.add(
      withoutRegion.replace(
        /\s+/gu,
        ""
      )
    );

    values.add(
      withoutRegion
        .replace(
          /([가-힣A-Za-z])([0-9])/gu,
          "$1 $2"
        )
        .replace(
          /([0-9])([가-힣A-Za-z])/gu,
          "$1 $2"
        )
    );
  }

  for (
    const value
    of values
  ) {
    const cleaned =
      cleanAddress(value);

    if (
      cleaned.length >= 2
    ) {
      candidates.add(cleaned);
    }
  }
}

/* =========================================================
 * 시·도 약칭 처리
 * ======================================================= */

function expandProvinceName(value) {
  return cleanAddress(
    String(value ?? "")
      .replace(
        /^서울\s/u,
        "서울특별시 "
      )
      .replace(
        /^부산\s/u,
        "부산광역시 "
      )
      .replace(
        /^대구\s/u,
        "대구광역시 "
      )
      .replace(
        /^인천\s/u,
        "인천광역시 "
      )
      .replace(
        /^광주\s/u,
        "광주광역시 "
      )
      .replace(
        /^대전\s/u,
        "대전광역시 "
      )
      .replace(
        /^울산\s/u,
        "울산광역시 "
      )
      .replace(
        /^세종\s/u,
        "세종특별자치시 "
      )
      .replace(
        /^경기\s/u,
        "경기도 "
      )
      .replace(
        /^강원\s/u,
        "강원특별자치도 "
      )
      .replace(
        /^충북\s/u,
        "충청북도 "
      )
      .replace(
        /^충남\s/u,
        "충청남도 "
      )
      .replace(
        /^전북\s/u,
        "전북특별자치도 "
      )
      .replace(
        /^전남\s/u,
        "전라남도 "
      )
      .replace(
        /^경북\s/u,
        "경상북도 "
      )
      .replace(
        /^경남\s/u,
        "경상남도 "
      )
      .replace(
        /^제주\s/u,
        "제주특별자치도 "
      )
  );
}

function shortProvinceName(value) {
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

/* =========================================================
 * 상세주소 접미사 제거
 * ======================================================= */

function removeDetailSuffix(value) {
  return cleanAddress(
    String(value ?? "")

      /*
       * 501동 204호
       * 501동204호
       */
      .replace(
        /(?:\s|,)+(?:제\s*)?[0-9A-Za-z가-힣]+\s*동\s*[0-9A-Za-z가-힣]+\s*호.*$/u,
        ""
      )

      /*
       * 501동 204
       * 501동204
       */
      .replace(
        /(?:\s|,)+(?:제\s*)?[0-9A-Za-z가-힣]+\s*동\s*[0-9A-Za-z]{1,8}.*$/u,
        ""
      )

      /*
       * 2001호
       * B101호
       */
      .replace(
        /(?:\s|,)+[A-Za-z가-힣]{0,4}\d{1,6}[A-Za-z가-힣]{0,2}\s*호.*$/u,
        ""
      )

      /*
       * 3층 301호
       * 지하 1층 B101호
       */
      .replace(
        /(?:\s|,)+(?:지하|지상|B)?\s*\d+\s*층.*$/u,
        ""
      )

      /*
       * 501-904
       * 608/603
       */
      .replace(
        /(?:\s|,)+\d{1,4}\s*[-/]\s*\d{1,5}(?:\s*호)?.*$/u,
        ""
      )
  );
}

/* =========================================================
 * 검색 후보 생성
 * ======================================================= */

function makeSearchCandidates(
  originalAddress
) {
  const candidates =
    new Set();

  const text =
    cleanAddress(
      originalAddress
    );

  if (!text) {
    return [];
  }

  const expandedText =
    expandProvinceName(text);

  candidates.add(text);
  candidates.add(expandedText);

  const withoutDetail =
    removeDetailSuffix(
      expandedText
    );

  const withoutDetailOriginal =
    removeDetailSuffix(text);

  candidates.add(
    withoutDetail
  );

  candidates.add(
    withoutDetailOriginal
  );

  /*
   * 아파트 단어 제거
   */
  candidates.add(
    cleanAddress(
      withoutDetail.replace(
        /아파트/gu,
        ""
      )
    )
  );

  candidates.add(
    cleanAddress(
      withoutDetailOriginal.replace(
        /아파트/gu,
        ""
      )
    )
  );

  /*
   * 괄호 제거
   */
  candidates.add(
    removeParentheses(
      withoutDetail
    )
  );

  candidates.add(
    removeParentheses(
      withoutDetailOriginal
    )
  );

  /*
   * 읍·면·동·가 뒤에 있는 건물명 추출
   */
  const buildingMatch =
    withoutDetail.match(
      /(?:읍|면|동|가)\s+(.+)$/u
    );

  if (buildingMatch) {
    const buildingName =
      cleanAddress(
        buildingMatch[1]
      );

    candidates.add(
      buildingName
    );

    candidates.add(
      cleanAddress(
        buildingName.replace(
          /아파트/gu,
          ""
        )
      )
    );

    const localityText =
      cleanAddress(
        withoutDetail.replace(
          new RegExp(
            `${escapeRegExp(
              buildingName
            )}$`,
            "u"
          ),
          ""
        )
      );

    addBuildingNameVariants(
      candidates,
      buildingName,
      localityText
    );
  }

  /*
   * 지역명 + 건물명
   */
  const localityBuildingMatch =
    withoutDetail.match(
      /^(.+?(?:시|군|구)\s+.+?(?:읍|면|동|가))\s+(.+)$/u
    );

  if (localityBuildingMatch) {
    const locality =
      cleanAddress(
        localityBuildingMatch[1]
      );

    const building =
      cleanAddress(
        localityBuildingMatch[2]
      );

    candidates.add(
      `${locality} ${building}`
    );

    candidates.add(
      `${locality} ${building.replace(
        /아파트/gu,
        ""
      )}`
    );

    /*
     * 건물명 단독 변형 후보
     */
    addBuildingNameVariants(
      candidates,
      building,
      locality
    );

    /*
     * 지역명 + 변형 건물명 후보
     */
    const buildingVariants =
      new Set();

    addBuildingNameVariants(
      buildingVariants,
      building,
      locality
    );

    for (
      const buildingVariant
      of buildingVariants
    ) {
      candidates.add(
        `${locality} ${buildingVariant}`
      );
    }

    /*
     * 법정동 + 건물명
     */
    const dongMatch =
      locality.match(
        /([가-힣0-9]+동)$/u
      );

    if (dongMatch) {
      candidates.add(
        `${dongMatch[1]} ${building}`
      );

      candidates.add(
        `${dongMatch[1]} ${building.replace(
          /아파트/gu,
          ""
        )}`
      );

      for (
        const buildingVariant
        of buildingVariants
      ) {
        candidates.add(
          `${dongMatch[1]} ${buildingVariant}`
        );
      }
    }
  }

  /*
   * 지번주소 후보
   */
  const jibunMatch =
    expandedText.match(
      /^(.+?[가-힣]+(?:읍|면|동|리)\s+(?:산\s*)?\d+(?:-\d+)?)(?:번지)?(?:\s|,|$)/u
    );

  if (jibunMatch) {
    candidates.add(
      cleanAddress(
        jibunMatch[1]
      )
    );
  }

  /*
   * 도로명주소 후보
   */
  const roadMatch =
    expandedText.match(
      /^(.+?(?:대로|로|길)\s*\d+(?:-\d+)?)(?:\s|,|\(|$)/u
    );

  if (roadMatch) {
    candidates.add(
      cleanAddress(
        roadMatch[1]
      )
    );
  }

  return uniqueValues(
    [...candidates]
  ).filter(
    (value) =>
      value.length >= 2
  );
}

/* =========================================================
 * Juso API 조회
 * ======================================================= */

async function searchJuso(keyword) {
  if (!JUSO_CONFIRM_KEY) {
    throw new Error(
      "Railway 환경변수 JUSO_CONFIRM_KEY가 설정되지 않았습니다."
    );
  }

  try {
    const response =
      await axios.get(
        JUSO_API_URL,
        {
          params: {
            confmKey:
              JUSO_CONFIRM_KEY,

            currentPage:
              1,

            countPerPage:
              20,

            keyword,

            resultType:
              "json",

            hstryYn:
              "Y",

            firstSort:
              "none"
          },

          timeout:
            15000
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
      String(
        common?.errorCode || ""
      ) !== "0"
    ) {
      return {
        ok: false,
        keyword,

        errorCode:
          common?.errorCode || "",

        errorMessage:
          common?.errorMessage || "",

        items: []
      };
    }

    return {
      ok: true,
      keyword,
      items
    };
  } catch (error) {
    const status =
      error?.response?.status;

    const responseData =
      error?.response?.data;

    const serverMessage =
      responseData?.results
        ?.common
        ?.errorMessage ||
      responseData?.message ||
      responseData?.reason ||
      "";

    throw new Error(
      serverMessage ||
      (
        status
          ? `Juso API HTTP 오류(${status})`
          : error instanceof Error
            ? error.message
            : String(error)
      )
    );
  }
}

/* =========================================================
 * Juso 결과 보조 함수
 * ======================================================= */

function getJibunNumber(
  jibunAddress
) {
  const text =
    String(
      jibunAddress ?? ""
    );

  const matches = [
    ...text.matchAll(
      /(?:산\s*)?(\d+(?:-\d+)?)(?:번지)?(?=\s|$)/gu
    )
  ];

  if (
    matches.length === 0
  ) {
    return "";
  }

  return matches[
    matches.length - 1
  ][1];
}

function getJibunNumberFromApi(
  apiAddress
) {
  const main =
    String(
      apiAddress?.lnbrMnnm || ""
    )
      .replace(/\D/g, "")
      .trim();

  const sub =
    String(
      apiAddress?.lnbrSlno || ""
    )
      .replace(/\D/g, "")
      .trim();

  if (main) {
    return (
      sub &&
      sub !== "0"
    )
      ? `${main}-${sub}`
      : main;
  }

  return getJibunNumber(
    apiAddress?.jibunAddr
  );
}

function makeRoadBuildingNumber(
  item
) {
  const main =
    String(
      item?.buldMnnm || ""
    ).trim();

  const sub =
    String(
      item?.buldSlno || ""
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

function makeRoadKey(item) {
  const roadName =
    item?.rn || "";

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

/* =========================================================
 * 주소 점수 계산
 * ======================================================= */

function calculateAddressScore(
  item,
  originalAddress
) {
  const originalCompact =
    compact(
      originalAddress
    );

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
    originalCompact.includes(road)
  ) {
    score += 100;
  }

  if (
    jibun &&
    originalCompact.includes(jibun)
  ) {
    score += 100;
  }

  const apiJibunNumber =
    getJibunNumberFromApi(item);

  if (
    apiJibunNumber &&
    originalCompact.includes(
      compact(apiJibunNumber)
    )
  ) {
    score += 45;
  }

  const roadKey =
    makeRoadKey(item);

  if (
    roadKey &&
    originalCompact.includes(
      compact(roadKey)
    )
  ) {
    score += 55;
  }

  if (
    building &&
    originalCompact === building
  ) {
    score += 100;
  } else if (
    building &&
    fuzzyContains(
      originalCompact,
      building
    )
  ) {
    score += 60;
  }

  /*
   * 입력 건물명이 API 건물명보다 긴 경우도 반영
   */
  if (
    building &&
    fuzzyContains(
      building,
      originalCompact
    )
  ) {
    score += 30;
  }

  if (
    detailBuildings &&
    fuzzyContains(
      originalCompact,
      detailBuildings
    )
  ) {
    score += 25;
  }

  [
    item.siNm,

    shortProvinceName(
      item.siNm
    ),

    item.sggNm,
    item.emdNm
  ].forEach((value) => {
    if (
      value &&
      originalCompact.includes(
        compact(value)
      )
    ) {
      score += 8;
    }
  });

  return score;
}

/* =========================================================
 * 최적 주소 선택
 * ======================================================= */

function selectBestAddress(
  items,
  originalAddress
) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return null;
  }

  const scored =
    items
      .map((item) => ({
        item,

        score:
          calculateAddressScore(
            item,
            originalAddress
          )
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (
    scored.length === 1
  ) {
    return scored[0].item;
  }

  const first =
    scored[0];

  const second =
    scored[1];

  if (
    first.score >= 20 &&
    (
      !second ||
      first.score >
      second.score
    )
  ) {
    return first.item;
  }

  const originalCompact =
    compact(
      originalAddress
    );

  const buildingMatches =
    scored.filter(
      ({ item }) => {
        const building =
          compact(
            item.bdNm
          );

        return (
          building &&
          (
            originalCompact.includes(
              building
            ) ||
            building.includes(
              originalCompact
            )
          )
        );
      }
    );

  if (
    buildingMatches.length === 1
  ) {
    return buildingMatches[0].item;
  }

  return (
    first.score >= 35
  )
    ? first.item
    : null;
}

/* =========================================================
 * 기본주소 제거
 * ======================================================= */

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

  const sourceText =
    String(source);

  const tokenText =
    String(token).trim();

  if (!tokenText) {
    return sourceText;
  }

  const isNumberToken =
    /^\d+(?:-\d+)?$/u.test(
      tokenText
    );

  if (isNumberToken) {
    const pattern =
      new RegExp(
        `(^|[\\s,(])${escapeRegExp(
          tokenText
        )}(?=번지|[\\s,)]|$)`,
        "giu"
      );

    return cleanAddress(
      sourceText.replace(
        pattern,
        "$1"
      )
    );
  }

  return cleanAddress(
    sourceText.replace(
      new RegExp(
        buildFlexiblePattern(
          tokenText
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
    String(source).replace(
      new RegExp(
        escapeRegExp(target),
        "giu"
      ),
      " "
    );

  const withoutParentheses =
    removeParentheses(target);

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

  return cleanAddress(result);
}

/* =========================================================
 * 동·호 정규화
 * ======================================================= */

function normalizeDongName(value) {
  let text =
    String(value ?? "")
      .normalize("NFC")
      .replace(/\u00a0/g, "")
      .replace(/\s+/g, "")
      .replace(/[()]/g, "")
      .trim()
      .toLowerCase()
      .replace(/^제/u, "")
      .replace(/동$/u, "");

  if (/^\d+$/u.test(text)) {
    text =
      text.replace(
        /^0+(?=\d)/u,
        ""
      );
  }

  return text;
}

function normalizeHoName(value) {
  let text =
    String(value ?? "")
      .normalize("NFC")
      .replace(/\u00a0/g, "")
      .replace(/\s+/g, "")
      .replace(/[()]/g, "")
      .trim()
      .toLowerCase()
      .replace(/^제/u, "")
      .replace(
        /^(?:지하\d+층|\d+층)/u,
        ""
      )
      .replace(/호$/u, "");

  if (/^\d+$/u.test(text)) {
    text =
      text.replace(
        /^0+(?=\d)/u,
        ""
      );
  }

  return text;
}

function inferGroundFloorFromUnit(
  value
) {
  const digits =
    String(value ?? "")
      .replace(/\D/g, "");

  /*
   * 505호 → 5층
   */
  if (
    digits.length === 3
  ) {
    return Number(
      digits.slice(0, 1)
    );
  }

  /*
   * 1203호 → 12층
   */
  if (
    digits.length === 4
  ) {
    return Number(
      digits.slice(0, 2)
    );
  }

  return null;
}

function getFloorNumber(floor) {
  const match =
    String(floor ?? "")
      .match(/(\d+)/u);

  if (!match) {
    return null;
  }

  const number =
    Number(match[1]);

  return Number.isFinite(number)
    ? number
    : null;
}

function getFloorType(floor) {
  const text =
    String(floor ?? "");

  if (
    text.includes("지하")
  ) {
    return "UNDERGROUND";
  }

  if (text) {
    return "GROUND";
  }

  return "";
}

/* =========================================================
 * 상세주소 분석
 * ======================================================= */

function normalizeFloor(value) {
  const floor =
    String(value)
      .replace(/\s+/g, "")
      .toUpperCase();

  if (/^B\d+$/u.test(floor)) {
    return `지하 ${floor.slice(1)}층`;
  }

  if (
    /^지하\d+$/u.test(floor)
  ) {
    return `지하 ${floor.replace(
      "지하",
      ""
    )}층`;
  }

  if (
    /^지상\d+$/u.test(floor)
  ) {
    return `${floor.replace(
      "지상",
      ""
    )}층`;
  }

  return `${floor}층`;
}

function hasDetailPattern(value) {
  return (
    /[가-힣A-Za-z0-9]+\s*동/u.test(
      value
    ) ||
    /(?:지하|지상|B)?\s*\d+\s*층/u.test(
      value
    ) ||
    /[A-Za-z가-힣]{0,4}\d+\s*호/u.test(
      value
    ) ||
    /(?:^|[\s,])\d{1,4}\s*[-/]\s*\d{1,5}(?:\s*호)?(?:\s|,|$)/u.test(
      value
    )
  );
}

function classifyExtraText(value) {
  if (
    /경비실|문앞|현관|택배함|관리실/u.test(
      value
    )
  ) {
    return "배송 요청사항";
  }

  if (
    /사무실|대리점|매장|세탁소|헤어|스시|상가|센터|병원|의원|약국/u.test(
      value
    )
  ) {
    return "상호·사업장";
  }

  if (
    /지하/u.test(value)
  ) {
    return "지하 위치 표현";
  }

  return "기타 상세정보";
}

function parseDetailText(value) {
  const original =
    cleanupRemainingText(value);

  let text = original;

  let dong = "";
  let floor = "";
  let ho = "";
  let extra = "";

  let type = "unknown";
  let status = "자동판정 불가";
  let confidence = "낮음";

  if (!text) {
    return {
      original: "",
      normalized: "",

      dong,
      floor,
      ho,
      extra,

      type: "none",
      status: "상세주소 없음",
      confidence: "낮음",

      remainingText: "",

      raw: "",
      clean: "",
      pattern: "none",

      dongRaw: "",
      floorRaw: "",
      hoRaw: "",

      targetDong: "",
      targetHo: "",

      floorType: "",
      inputFloor: null,
      inferredFloor: null
    };
  }

  /*
   * B1F → 지하 1층
   * 3F → 3층
   */
  text =
    text
      .replace(
        /\bB\s*(\d+)\s*[Ff]\b/gu,
        "지하 $1층"
      )
      .replace(
        /\b(\d+)\s*[Ff]\b/gu,
        "$1층"
      )
      .replace(
        /지하\s*(\d+)\s*층/gu,
        "지하 $1층"
      );

  /*
   * 101동505호 → 101동 505호
   */
  text =
    text.replace(
      /([0-9A-Za-z가-힣]+동)\s*([0-9A-Za-z가-힣]{1,12}호)/gu,
      "$1 $2"
    );

  /*
   * 5층505호 → 5층 505호
   */
  text =
    text.replace(
      /((?:지하\s*)?\d+층)\s*([A-Za-z가-힣]?\d+[A-Za-z가-힣]{0,2}호)/gu,
      "$1 $2"
    );

  /*
   * 101동 / A동 / 우측동
   */
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

  /*
   * 3층 / 지하 1층 / B1층
   */
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

  /*
   * 301호 / B101호 / BB39호
   */
  const hoMatch =
    text.match(
      /(?:^|[\s,])([A-Za-z가-힣]{0,4}\d+[A-Za-z가-힣]{0,2})\s*호/u
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

  /*
   * 501-904 / 608/603
   *
   * 앞에 단지명이나 건물명이 붙어 있어도
   * 숫자-숫자 부분을 동·호로 변환합니다.
   *
   * 예:
   * 아델리움 102-1603
   * 신동아4단지 114-913
   */
  if (
    !dong &&
    !ho
  ) {
    const hyphenMatch =
      text.match(
        /(?:^|[\s,])(\d{1,4})\s*[-/]\s*(\d{1,5})(?:\s*호)?(?=\s|,|$)/u
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

      /*
       * 동·호가 명확하게 변환된 경우
       * 남은 문자열 유무에 따라 최종 상태를 다시 판단합니다.
       */
      status =
        "정상";

      confidence =
        "높음";
    }
  }

  /*
   * 숫자만 남은 경우 호수
   */
  if (
    !ho &&
    /^\s*\d{2,5}\s*$/u.test(text)
  ) {
    const number =
      text.trim();

    ho =
      `${number}호`;

    text = "";

    type =
      "숫자 단독";

    status =
      "호 표기 보정";

    confidence =
      "중간";
  }

  /*
   * BB39 / A301
   */
  if (
    !ho &&
    /^\s*[A-Za-z]{1,4}\d{1,5}\s*$/u.test(
      text
    )
  ) {
    const unitName =
      text
        .trim()
        .toUpperCase();

    ho =
      `${unitName}호`;

    text = "";

    type =
      "영문 상가호";

    status =
      "호 표기 보정";

    confidence =
      "중간";
  }

  /*
   * 302아름매션
   * 102리코헤어
   */
  if (!ho) {
    const attachedMatch =
      text.match(
        /(?:^|[\s,])(\d{1,5})([가-힣A-Za-z].+)$/u
      );

    if (attachedMatch) {
      const number =
        attachedMatch[1];

      const attachedText =
        attachedMatch[2]
          .trim();

      const isOrdinalExpression =
        /^(?:번째|번(?:째|출구|게이트|창구)?)/u.test(
          attachedText
        );

      if (!isOrdinalExpression) {
        ho =
          `${number}호`;

        extra =
          attachedText;

        text = "";

        type =
          "호수·상호명 결합";

        status =
          "보정 필요";

        confidence =
          "중간";
      }
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

  /*
   * 최종 상태 판정
   */
  if (
    dong &&
    ho
  ) {
    if (
      type === "unknown"
    ) {
      type = "동·호";
    }

    /*
     * 축약형까지 포함해 동·호가 추출됐더라도
     * 건물명, 상호명 등 나머지 문자열이 남으면
     * 보정 필요로 구분합니다.
     */
    status =
      extra
        ? "보정 필요"
        : "정상";

    confidence =
      extra
        ? "중간"
        : "높음";
  } else if (
    floor &&
    ho
  ) {
    type = "층·호";

    status =
      extra
        ? "보정 필요"
        : "정상";

    confidence =
      extra
        ? "중간"
        : "높음";
  } else if (ho) {
    if (
      type === "unknown"
    ) {
      type = "호";
    }

    status =
      extra
        ? "보정 필요"
        : "정상";

    confidence =
      extra
        ? "중간"
        : "높음";
  } else if (floor) {
    type = "층";

    status =
      extra
        ? "보정 필요"
        : "부분 상세주소";

    confidence = "중간";
  } else if (dong) {
    type = "동";

    status =
      extra
        ? "보정 필요"
        : "부분 상세주소";

    confidence = "중간";
  } else if (extra) {
    type =
      classifyExtraText(extra);

    status =
      "상세주소 확인 필요";

    confidence = "낮음";
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

  const floorType =
    getFloorType(floor);

  const inputFloor =
    getFloorNumber(floor);

  const inferredFloor =
    inputFloor ??
    (
      floorType ===
      "UNDERGROUND"
        ? null
        : inferGroundFloorFromUnit(
            ho
          )
    );

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
      original,

    /*
     * server.js 호환 필드
     */
    raw:
      original,

    clean:
      normalized,

    pattern:
      type,

    dongRaw:
      dong,

    floorRaw:
      floor,

    hoRaw:
      ho,

    targetDong:
      normalizeDongName(dong),

    targetHo:
      normalizeHoName(ho),

    floorType,
    inputFloor,
    inferredFloor
  };
}

/* =========================================================
 * API 주소 기준 상세주소 추출
 * ======================================================= */

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

  /*
   * API 전체 주소 제거
   */
  const removableValues =
    uniqueValues([
      apiAddress.roadAddr,
      apiAddress.roadAddrPart1,
      apiAddress.jibunAddr,
      apiAddress.bdNm
    ])
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

  /*
   * 지역명 제거
   */
  const addressParts =
    uniqueValues([
      apiAddress.siNm,
      apiAddress.sggNm,
      apiAddress.emdNm,
      apiAddress.liNm,
      apiAddress.rn,

      shortProvinceName(
        apiAddress.siNm
      )
    ])
      .sort(
        (a, b) =>
          b.length - a.length
      );

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

  /*
   * 지번 제거
   */
  const jibunNumber =
    getJibunNumberFromApi(
      apiAddress
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

  /*
   * 도로명 건물번호 제거
   */
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

  /*
   * 상세 건물명 목록 중
   * 101동 같은 동명은 유지
   */
  const detailBuildingNames =
    String(
      apiAddress.detBdNmList || ""
    )
      .split(",")
      .map(
        (value) =>
          cleanAddress(value)
      )
      .filter(Boolean)
      .filter(
        (value) =>
          !/^(?:제\s*)?[0-9A-Za-z가-힣]+\s*동$/u.test(
            value
          )
      );

  const buildingNames =
    uniqueValues([
      apiAddress.bdNm,
      ...detailBuildingNames
    ])
      .sort(
        (a, b) =>
          b.length - a.length
      );

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

  /*
   * 입력 건물명과 API 건물명의 일부가 다른 경우에도
   * 일반적인 단지·아파트 표현을 정리합니다.
   */
  remaining =
    remaining
      .replace(
        /(?:\s|^)아파트(?=\s|$)/gu,
        " "
      )
      .replace(
        /(?:아파트\s*){2,}/gu,
        " "
      )
      .replace(
        /(?:공동주택\s*){2,}/gu,
        " "
      );

  /*
   * 괄호 안 상세주소는 유지
   */
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

/* =========================================================
 * server.js 전달용 Juso 객체
 * ======================================================= */

function makeJusoPayload(
  selected
) {
  return {
    roadAddr:
      selected?.roadAddr || "",

    roadAddrPart1:
      selected?.roadAddrPart1 || "",

    roadAddrPart2:
      selected?.roadAddrPart2 || "",

    jibunAddr:
      selected?.jibunAddr || "",

    engAddr:
      selected?.engAddr || "",

    zipNo:
      selected?.zipNo || "",

    admCd:
      selected?.admCd || "",

    rnMgtSn:
      selected?.rnMgtSn || "",

    udrtYn:
      selected?.udrtYn || "0",

    buldMnnm:
      selected?.buldMnnm || "",

    buldSlno:
      selected?.buldSlno || "0",

    bdMgtSn:
      selected?.bdMgtSn || "",

    mtYn:
      selected?.mtYn || "0",

    lnbrMnnm:
      selected?.lnbrMnnm || "",

    lnbrSlno:
      selected?.lnbrSlno || "0",

    bdNm:
      selected?.bdNm || "",

    detBdNmList:
      selected?.detBdNmList || "",

    siNm:
      selected?.siNm || "",

    sggNm:
      selected?.sggNm || "",

    emdNm:
      selected?.emdNm || "",

    liNm:
      selected?.liNm || "",

    rn:
      selected?.rn || ""
  };
}

/* =========================================================
 * 주소 1건 분석
 * ======================================================= */

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

  const searchErrors = [];

  for (
    const keyword
    of candidates
  ) {
    try {
      const result =
        await searchJuso(keyword);

      if (!result.ok) {
        searchErrors.push({
          keyword,

          errorCode:
            result.errorCode,

          errorMessage:
            result.errorMessage
        });

        continue;
      }

      if (
        result.items.length === 0
      ) {
        continue;
      }

      const matched =
        selectBestAddress(
          result.items,
          originalAddress
        );

      if (matched) {
        selected = matched;
        usedKeyword = keyword;

        break;
      }
    } catch (error) {
      searchErrors.push({
        keyword,

        errorMessage:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  if (!selected) {
    return {
      ok: false,

      inputAddress:
        originalAddress,

      searchCandidates:
        candidates.join(" | "),

      searchErrors,

      reason:
        searchErrors.length > 0
          ? (
              searchErrors[
                searchErrors.length - 1
              ].errorMessage ||
              "기본주소를 확정하지 못했습니다."
            )
          : "기본주소를 확정하지 못했습니다."
    };
  }

  const baseAddress =
    selected.roadAddrPart1 ||
    removeParentheses(
      selected.roadAddr || ""
    );

  const detail =
    extractDetailByConfirmedAddress(
      originalAddress,
      selected
    );

  const juso =
    makeJusoPayload(selected);

  return {
    ok: true,

    inputAddress:
      originalAddress,

    searchKeyword:
      usedKeyword,

    searchCandidates:
      candidates.join(" | "),

    baseAddress,

    roadAddress:
      juso.roadAddr,

    jibunAddress:
      juso.jibunAddr,

    buildingName:
      juso.bdNm,

    buildingManagementNo:
      juso.bdMgtSn,

    apiZipCode:
      juso.zipNo,

    /*
     * 기존 엑셀 출력 호환값
     */
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
      detail.confidence,

    /*
     * server.js 건축물대장 조회용 원본값
     */
    admCd:
      juso.admCd,

    rnMgtSn:
      juso.rnMgtSn,

    udrtYn:
      juso.udrtYn,

    buldMnnm:
      juso.buldMnnm,

    buldSlno:
      juso.buldSlno,

    mtYn:
      juso.mtYn,

    lnbrMnnm:
      juso.lnbrMnnm,

    lnbrSlno:
      juso.lnbrSlno,

    detBdNmList:
      juso.detBdNmList,

    siNm:
      juso.siNm,

    sggNm:
      juso.sggNm,

    emdNm:
      juso.emdNm,

    /*
     * 새 구조 핵심
     */
    juso,
    detail
  };
}

/* =========================================================
 * Export
 * ======================================================= */

export {
  analyzeAddress,
  cleanAddress,
  makeSearchCandidates,
  parseDetailText,
  extractDetailByConfirmedAddress,
  normalizeDongName,
  normalizeHoName
};
