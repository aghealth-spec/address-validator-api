"use strict";

import axios from "axios";

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
 * 시·도 약칭 확장
 * ======================================================= */

function expandProvinceName(value) {
  return cleanAddress(
    String(value ?? "")
      .replace(/^서울\s/u, "서울특별시 ")
      .replace(/^부산\s/u, "부산광역시 ")
      .replace(/^대구\s/u, "대구광역시 ")
      .replace(/^인천\s/u, "인천광역시 ")
      .replace(/^광주\s/u, "광주광역시 ")
      .replace(/^대전\s/u, "대전광역시 ")
      .replace(/^울산\s/u, "울산광역시 ")
      .replace(/^세종\s/u, "세종특별자치시 ")
      .replace(/^경기\s/u, "경기도 ")
      .replace(/^강원\s/u, "강원특별자치도 ")
      .replace(/^충북\s/u, "충청북도 ")
      .replace(/^충남\s/u, "충청남도 ")
      .replace(/^전북\s/u, "전북특별자치도 ")
      .replace(/^전남\s/u, "전라남도 ")
      .replace(/^경북\s/u, "경상북도 ")
      .replace(/^경남\s/u, "경상남도 ")
      .replace(/^제주\s/u, "제주특별자치도 ")
  );
}

function shortProvinceName(value) {
  const map = {
    서울특별시: "서울",
    부산광역시: "부산",
    대구광역시: "대구",
    인천광역시: "인천",
    광주광역시: "광주",
    전남광주통합특별시: "광주",
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
 * 검색 후보 생성
 * ======================================================= */

function removeDetailSuffix(value) {
  return cleanAddress(
    String(value ?? "")
      /*
       * 501동204호
       * 501동 204호
       * A동301호
       */
      .replace(
        /(?:\s|,)+(?:제\s*)?[0-9A-Za-z가-힣]+\s*동\s*[0-9A-Za-z가-힣]+\s*호.*$/u,
        ""
      )

      /*
       * 501동204
       * 501동 204
       */
      .replace(
        /(?:\s|,)+(?:제\s*)?[0-9A-Za-z가-힣]+\s*동\s*[0-9A-Za-z]{1,8}.*$/u,
        ""
      )

      /*
       * 2001호
       */
      .replace(
        /(?:\s|,)+[A-Za-z가-힣]{0,4}\d{1,6}[A-Za-z가-힣]{0,2}\s*호.*$/u,
        ""
      )

      /*
       * 3층 301호
       * 지하1층 B101호
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

function makeSearchCandidates(
  originalAddress
) {
  const candidates = new Set();

  const text =
    cleanAddress(
      originalAddress
    );

  if (!text) {
    return [];
  }

  const expandedText =
    expandProvinceName(
      text
    );

  candidates.add(text);
  candidates.add(expandedText);

  const withoutDetail =
    removeDetailSuffix(
      expandedText
    );

  const withoutDetailOriginal =
    removeDetailSuffix(
      text
    );

  candidates.add(
    withoutDetail
  );

  candidates.add(
    withoutDetailOriginal
  );

  /*
   * 아파트 단어 제거 후보
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
   * 괄호 제거 후보
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
   * 읍·면·동·가 이후 건물명 추출
   *
   * 경기 고양시 일산동구 식사동
   * 위시티일산블루밍5단지아파트
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
  }

  /*
   * 지역명 + 건물명 후보
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
     * 마지막 동 + 건물명
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

async function searchJuso(
  keyword
) {
  if (!JUSO_CONFIRM_KEY) {
    throw new Error(
      "Railway 환경변수 JUSO_CONFIRM_KEY가 설정되지 않았습니다."
    );
  }

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
    common?.errorCode !== "0"
  ) {
    return {
      ok:
        false,

      keyword,

      errorCode:
        common?.errorCode ||
        "",

      errorMessage:
        common?.errorMessage ||
        "",

      items:
        []
    };
  }

  return {
    ok:
      true,

    keyword,

    items
  };
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
      apiAddress?.lnbrMnnm ||
      ""
    )
      .replace(/\D/g, "")
      .trim();

  const sub =
    String(
      apiAddress?.lnbrSlno ||
      ""
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
      item?.buldMnnm ||
      ""
    ).trim();

  const sub =
    String(
      item?.buldSlno ||
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
    item?.rn ||
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
    compact(
      source
    );

  const targetText =
    compact(
      target
    );

  return (
    targetText.length >= 2 &&
    sourceText.includes(
      targetText
    )
  );
}

/* =========================================================
 * 최적 주소 선택
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
    getJibunNumberFromApi(
      item
    );

  if (
    apiJibunNumber &&
    originalCompact.includes(
      compact(
        apiJibunNumber
      )
    )
  ) {
    score += 45;
  }

  const roadKey =
    makeRoadKey(
      item
    );

  if (
    roadKey &&
    originalCompact.includes(
      compact(
        roadKey
      )
    )
  ) {
    score += 55;
  }

  /*
   * 건물명 완전 또는 부분 일치
   */
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
  ].forEach(
    (value) => {
      if (
        value &&
        originalCompact.includes(
          compact(
            value
          )
        )
      ) {
        score += 8;
      }
    }
  );

  return score;
}

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
      .map(
        (item) => ({
          item,

          score:
            calculateAddressScore(
              item,
              originalAddress
            )
        })
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
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

  /*
   * 점수가 동일하더라도 건물명 일치 후보가 한 건이면 선택
   */
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
    String(
      source
    );

  const tokenText =
    String(
      token
    ).trim();

  if (!tokenText) {
    return sourceText;
  }

  const isNumberToken =
    /^\d+(?:-\d+)?$/u.test(
      tokenText
    );

  if (isNumberToken) {
    /*
     * 주소의 독립된 지번·도로번호만 제거합니다.
     *
     * "10 101동"의 10은 제거
     * "101동" 내부의 10은 제거하지 않음
     */
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

/* =========================================================
 * 상세주소 분석
 * ======================================================= */

function normalizeFloor(
  value
) {
  const floor =
    String(
      value
    )
      .replace(/\s+/g, "")
      .toUpperCase();

  if (
    /^B\d+$/u.test(
      floor
    )
  ) {
    return `지하 ${floor.slice(1)}층`;
  }

  if (
    /^지하\d+$/u.test(
      floor
    )
  ) {
    return `지하 ${floor.replace(
      "지하",
      ""
    )}층`;
  }

  if (
    /^지상\d+$/u.test(
      floor
    )
  ) {
    return `${floor.replace(
      "지상",
      ""
    )}층`;
  }

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
    /[A-Za-z가-힣]{0,4}\d+\s*호/u.test(
      value
    ) ||
    /^\s*\d{1,4}\s*[-/]\s*\d{1,5}\s*$/u.test(
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
    /사무실|대리점|매장|세탁소|헤어|스시|상가|센터|병원|의원|약국/u.test(
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
      original:
        "",

      normalized:
        "",

      dong,

      floor,

      ho,

      extra,

      type:
        "none",

      status:
        "상세주소 없음",

      confidence:
        "낮음",

      remainingText:
        ""
    };
  }

  /*
   * 101동
   * A동
   * 우측동
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
   * 3층
   * 지하 1층
   * B1층
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
   * 301호
   * B101호
   * BB39호
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
   * 501-904
   * 전체 문자열이 동-호 축약형일 때만 변환합니다.
   *
   * 873-4 명산빌딩은 지번일 가능성이 높으므로 변환하지 않습니다.
   */
  if (
    !dong &&
    !ho
  ) {
    const hyphenMatch =
      text.match(
        /^\s*(\d{1,4})\s*[-/]\s*(\d{1,5})\s*$/u
      );

    if (hyphenMatch) {
      dong =
        `${hyphenMatch[1]}동`;

      ho =
        `${hyphenMatch[2]}호`;

      text = "";

      type =
        "동-호 축약형";

      status =
        "형식 변환";

      confidence =
        "중간";
    }
  }

  /*
   * 숫자만 남은 경우 호수로 처리
   */
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
      "호 표기 보정";

    confidence =
      "중간";
  }

  /*
   * BB39
   * A301
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
   *
   * 단, 3번째사무실은 3호로 보지 않습니다.
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
   * 상태 판정
   */
  if (
    dong &&
    ho
  ) {
    if (
      type === "unknown"
    ) {
      type =
        "동·호";
    }

    if (
      status ===
      "자동판정 불가"
    ) {
      status =
        extra
          ? "보정 필요"
          : "정상";
    }

    confidence =
      extra
        ? "중간"
        : "높음";
  } else if (
    floor &&
    ho
  ) {
    type =
      "층·호";

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
      type =
        "호";
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
    type =
      "층";

    status =
      extra
        ? "보정 필요"
        : "부분 상세주소";

    confidence =
      "중간";
  } else if (dong) {
    type =
      "동";

    status =
      extra
        ? "보정 필요"
        : "부분 상세주소";

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
   *
   * detBdNmList는 101동 등이 포함될 수 있어
   * 여기서는 제거하지 않습니다.
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
          b.length -
          a.length
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
   * 지역명은 긴 문자열부터 제거해야
   * 광주광역시에서 광역시만 남지 않습니다.
   */
  const addressParts =
    uniqueValues([
      apiAddress.siNm,

      apiAddress.siNm ===
      "전남광주통합특별시"
        ? "광주광역시"
        : "",

      apiAddress.sggNm,
      apiAddress.emdNm,
      apiAddress.liNm,
      apiAddress.rn,

      shortProvinceName(
        apiAddress.siNm
      ),

      apiAddress.siNm ===
      "전남광주통합특별시"
        ? "광주"
        : ""
    ])
      .sort(
        (a, b) =>
          b.length -
          a.length
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
   * API 지번 필드로 지번 제거
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
   * 101동 같은 동명은 제거하지 않고
   * 일반 건물명만 제거합니다.
   */
  const detailBuildingNames =
    String(
      apiAddress.detBdNmList ||
      ""
    )
      .split(",")
      .map(
        (value) =>
          cleanAddress(
            value
          )
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
          b.length -
          a.length
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
   * 남은 "아파트" 중복 제거
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
      );

  /*
   * 괄호 안 상세주소는 유지하고
   * 단순 법정동·건물명은 제거
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
      ok:
        false,

      inputAddress:
        "",

      reason:
        "주소가 비어 있습니다."
    };
  }

  const candidates =
    makeSearchCandidates(
      originalAddress
    );

  let selected =
    null;

  let usedKeyword =
    "";

  const searchErrors =
    [];

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
        !result.ok
      ) {
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
        selected =
          matched;

        usedKeyword =
          keyword;

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
      ok:
        false,

      inputAddress:
        originalAddress,

      searchCandidates:
        candidates.join(
          " | "
        ),

      searchErrors,

      reason:
        searchErrors.length > 0
          ? searchErrors[
              searchErrors.length - 1
            ].errorMessage ||
            "기본주소를 확정하지 못했습니다."
          : "기본주소를 확정하지 못했습니다."
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
    ok:
      true,

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

/* =========================================================
 * Export
 * ======================================================= */

export {
  analyzeAddress,
  cleanAddress,
  makeSearchCandidates,
  parseDetailText
};
