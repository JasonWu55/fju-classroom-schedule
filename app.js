const WEEKDAY_ORDER = ["一(Mon)", "二(Tue)", "三(Wed)", "四(Thu)", "五(Fri)", "六(Sat)"];
const PERIOD_ORDER = ["D1", "D2", "D3", "D4", "DN", "D5", "D6", "D7", "D8", "E0", "E1", "E2", "E3", "E4"];

const state = {
  metadata: null,
  rooms: [],
  schedulesByDay: new Map(),
  query: "",
  exactRoom: "",
  suggestions: [],
  examples: [],
  selectedWeekday: WEEKDAY_ORDER[0],
  loadState: "loading",
  errorMessage: ""
};

const elements = {
  form: document.querySelector("#room-lookup-form"),
  roomQuery: document.querySelector("#room-query"),
  statusBanner: document.querySelector("#status-banner"),
  quickExamples: document.querySelector("#quick-examples"),
  metaDivision: document.querySelector("#meta-division"),
  metaGenerated: document.querySelector("#meta-generated"),
  metaCourses: document.querySelector("#meta-courses"),
  metaRooms: document.querySelector("#meta-rooms"),
  roomHeading: document.querySelector("#room-heading"),
  roomMatchNote: document.querySelector("#room-match-note"),
  summaryBuilding: document.querySelector("#summary-building"),
  summaryOccupied: document.querySelector("#summary-occupied"),
  summaryFree: document.querySelector("#summary-free"),
  summaryDays: document.querySelector("#summary-days"),
  suggestionTitle: document.querySelector("#suggestion-title"),
  suggestionCount: document.querySelector("#suggestion-count"),
  suggestionCopy: document.querySelector("#suggestion-copy"),
  suggestionList: document.querySelector("#suggestion-list"),
  gridCaption: document.querySelector("#grid-caption"),
  emptyState: document.querySelector("#empty-state"),
  emptyStateTitle: document.querySelector("#empty-state-title"),
  emptyStateCopy: document.querySelector("#empty-state-copy"),
  dayView: document.querySelector("#day-view"),
  daySwitcher: document.querySelector("#day-switcher"),
  dayCards: document.querySelector("#day-cards"),
  tableWrap: document.querySelector("#table-wrap"),
  tableHead: document.querySelector("#room-timetable thead"),
  tableBody: document.querySelector("#room-timetable tbody")
};

function formatGeneratedAt(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei"
  }).format(date);
}

function normalizeRoom(room) {
  return String(room || "").trim().toUpperCase();
}

function getBuildingCode(room) {
  const match = normalizeRoom(room).match(/^[A-Z]+/);
  return match ? match[0] : "其他";
}

function extractPeriodTokens(periodText) {
  return String(periodText || "").match(/[A-Z][0-9N]+/g) || [];
}

function expandPeriods(periodText) {
  const tokens = extractPeriodTokens(periodText);
  if (!tokens.length) return [];
  if (tokens.length === 1) return tokens;

  const startIndex = PERIOD_ORDER.indexOf(tokens[0]);
  const endIndex = PERIOD_ORDER.indexOf(tokens[tokens.length - 1]);

  if (startIndex === -1 || endIndex === -1) {
    return tokens;
  }

  const sliceStart = Math.min(startIndex, endIndex);
  const sliceEnd = Math.max(startIndex, endIndex);
  return PERIOD_ORDER.slice(sliceStart, sliceEnd + 1);
}

function sanitizeInstructorName(instructorText) {
  return String(instructorText || "")
    .replace(/\s*專長\s*[:：].*$/u, "")
    .trim();
}

function buildScheduleIndex(courses) {
  const schedulesByDay = new Map(WEEKDAY_ORDER.map((day) => [day, new Map()]));
  const rooms = new Set();

  courses.forEach((course) => {
    const weekday = String(course.weekday_1 || "").trim();
    const room = normalizeRoom(course.room_1);
    const week = String(course.week_1 || "").trim();
    const periods = expandPeriods(course.period_1);

    if (!weekday || !room || !periods.length) {
      return;
    }

    rooms.add(room);
    if (!schedulesByDay.has(weekday)) {
      schedulesByDay.set(weekday, new Map());
    }

    const roomMap = schedulesByDay.get(weekday);
    if (!roomMap.has(room)) {
      roomMap.set(room, new Map());
    }

    const periodMap = roomMap.get(room);
    const instructor = sanitizeInstructorName(course.instructor);

    periods.forEach((period) => {
      if (!periodMap.has(period)) {
        periodMap.set(period, []);
      }

      periodMap.get(period).push({
        courseName: course.course_name,
        offeringUnit: course.offering_unit,
        instructor,
        week,
        room,
        period,
        remarks: course.remarks
      });
    });
  });

  return {
    rooms: Array.from(rooms).sort((left, right) => left.localeCompare(right, "en")),
    schedulesByDay
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCommonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) {
    count += 1;
  }
  return count;
}

function getMatchScore(room, query) {
  if (!query) return 0;

  let score = 0;
  if (room === query) score += 1000;
  if (room.startsWith(query)) score += 420 - Math.max(0, room.length - query.length);
  if (room.includes(query)) score += 220 - room.indexOf(query);

  const building = getBuildingCode(room);
  if (building === query) score += 160;
  if (building.startsWith(query)) score += 140;

  score += getCommonPrefixLength(room, query) * 18;

  const queryDigits = query.match(/\d+/)?.[0] || "";
  const roomDigits = room.match(/\d+/)?.[0] || "";
  if (queryDigits && roomDigits.startsWith(queryDigits)) {
    score += 60;
  }

  return score;
}

function getSuggestedRooms(query, limit = 6) {
  const normalizedQuery = normalizeRoom(query);
  if (!normalizedQuery) return [];

  return state.rooms
    .map((room) => ({ room, score: getMatchScore(room, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.room.localeCompare(right.room, "en"))
    .slice(0, limit)
    .map((entry) => entry.room);
}

function buildExampleRooms(rooms) {
  const examples = [];
  const seenBuildings = new Set();

  rooms.forEach((room) => {
    const building = getBuildingCode(room);
    if (examples.length < 6 && !seenBuildings.has(building)) {
      seenBuildings.add(building);
      examples.push(room);
    }
  });

  rooms.forEach((room) => {
    if (examples.length < 6 && !examples.includes(room)) {
      examples.push(room);
    }
  });

  return examples;
}

function getRoomCourses(room, weekday, period) {
  const roomMap = state.schedulesByDay.get(weekday) || new Map();
  const periodMap = roomMap.get(room) || new Map();
  return periodMap.get(period) || [];
}

function summarizeRoom(room) {
  let occupiedSlots = 0;
  let freeSlots = 0;
  let activeDays = 0;

  WEEKDAY_ORDER.forEach((weekday) => {
    let hasCourseOnDay = false;

    PERIOD_ORDER.forEach((period) => {
      const courses = getRoomCourses(room, weekday, period);
      if (courses.length) {
        occupiedSlots += 1;
        hasCourseOnDay = true;
      } else {
        freeSlots += 1;
      }
    });

    if (hasCourseOnDay) {
      activeDays += 1;
    }
  });

  return {
    building: getBuildingCode(room),
    occupiedSlots,
    freeSlots,
    activeDays
  };
}

function getRoomActiveWeekdays(room) {
  return WEEKDAY_ORDER.filter((weekday) => {
    const roomMap = state.schedulesByDay.get(weekday) || new Map();
    const periodMap = roomMap.get(room);
    return Boolean(periodMap && periodMap.size);
  });
}

function getInitialWeekday(room) {
  return getRoomActiveWeekdays(room)[0] || WEEKDAY_ORDER[0];
}

function getWeekdayParts(weekday) {
  const match = String(weekday).match(/^(.+?)\((.+)\)$/);
  return match
    ? { short: match[1], long: match[2] }
    : { short: weekday, long: weekday };
}

function getPeriodSubcopy(period) {
  return period === "DN" ? "中午" : "教學節次";
}

function setQuery(nextQuery) {
  const normalizedQuery = normalizeRoom(nextQuery);
  const previousExactRoom = state.exactRoom;
  state.query = normalizedQuery;
  elements.roomQuery.value = normalizedQuery;
  state.exactRoom = state.rooms.find((room) => room === normalizedQuery) || "";
  state.suggestions = normalizedQuery ? getSuggestedRooms(normalizedQuery) : [];

  if (!state.exactRoom) {
    state.selectedWeekday = WEEKDAY_ORDER[0];
    return;
  }

  if (previousExactRoom !== state.exactRoom) {
    state.selectedWeekday = getInitialWeekday(state.exactRoom);
    return;
  }

  if (!WEEKDAY_ORDER.includes(state.selectedWeekday)) {
    state.selectedWeekday = WEEKDAY_ORDER[0];
  }
}

function createChipButton(room, isActive = false) {
  const activeClass = isActive ? " is-active" : "";
  return `<button type="button" class="chip-button${activeClass}" data-room="${escapeHtml(room)}">${escapeHtml(room)}</button>`;
}

function renderStatus() {
  if (state.loadState === "loading") {
    elements.statusBanner.textContent = "正在讀取課程資料，準備整理單一教室整週課表…";
    return;
  }

  if (state.loadState === "error") {
    elements.statusBanner.textContent = state.errorMessage || "資料載入失敗。";
    return;
  }

  if (!state.query) {
    elements.statusBanner.textContent = `已載入 ${state.rooms.length} 間教室，輸入完整教室代碼開始查詢。`;
    return;
  }

  if (state.exactRoom) {
    elements.statusBanner.textContent = `已找到 ${state.exactRoom}，下方顯示這一間教室整週的節次占用與空堂。`;
    return;
  }

  if (state.suggestions.length) {
    elements.statusBanner.textContent = `找不到完全相符的 ${state.query}，請從下方最接近的教室代碼中選擇。`;
    return;
  }

  elements.statusBanner.textContent = `查無 ${state.query}，請確認教室代碼是否正確。`;
}

function renderQuickExamples() {
  if (state.loadState !== "ready") {
    elements.quickExamples.innerHTML = "";
    return;
  }

  elements.quickExamples.innerHTML = state.examples.map((room) => createChipButton(room, room === state.exactRoom)).join("");
}

function renderRoomSummary() {
  if (state.loadState === "error") {
    elements.roomHeading.textContent = "資料載入失敗";
    elements.roomMatchNote.textContent = "請用本機伺服器開啟此資料夾，例如 python3 -m http.server 4173。";
    elements.summaryBuilding.textContent = "-";
    elements.summaryOccupied.textContent = "-";
    elements.summaryFree.textContent = "-";
    elements.summaryDays.textContent = "-";
    return;
  }

  if (!state.query) {
    elements.roomHeading.textContent = "輸入教室代碼開始查詢";
    elements.roomMatchNote.textContent = "例如 LI105。輸入完整代碼後，會直接顯示這一間教室的每週課表。";
    elements.summaryBuilding.textContent = "-";
    elements.summaryOccupied.textContent = "-";
    elements.summaryFree.textContent = "-";
    elements.summaryDays.textContent = "-";
    return;
  }

  if (!state.exactRoom) {
    elements.roomHeading.textContent = `找不到 ${state.query}`;
    elements.roomMatchNote.textContent = state.suggestions.length
      ? "目前沒有完全相符的教室，請改點選一個最接近的教室代碼。"
      : "沒有找到相近的教室代碼，請重新輸入或改試不同大樓代號。";
    elements.summaryBuilding.textContent = "-";
    elements.summaryOccupied.textContent = "-";
    elements.summaryFree.textContent = "-";
    elements.summaryDays.textContent = "-";
    return;
  }

  const summary = summarizeRoom(state.exactRoom);
  elements.roomHeading.textContent = state.exactRoom;
  elements.roomMatchNote.textContent = `完全相符。桌面可查看 ${state.exactRoom} 的整週矩陣，手機則可切換單日卡片查看各節次占用。`;
  elements.summaryBuilding.textContent = summary.building;
  elements.summaryOccupied.textContent = `${summary.occupiedSlots} 節`;
  elements.summaryFree.textContent = `${summary.freeSlots} 節`;
  elements.summaryDays.textContent = `${summary.activeDays} 天`;
}

function renderSuggestions() {
  let rooms = [];
  let title = "快速開始";
  let copy = "資料載入後，可直接點選常用教室範例開始查詢。";

  if (state.loadState === "error") {
    title = "無法提供建議";
    copy = "請先解決資料載入問題。";
  } else if (!state.query) {
    rooms = state.examples;
  } else if (state.exactRoom) {
    title = "相近教室";
    copy = `已找到 ${state.exactRoom}，如果你要比對同棟附近教室，也可以直接切換。`;
    rooms = state.suggestions.filter((room) => room !== state.exactRoom);
  } else if (state.suggestions.length) {
    title = "最接近的教室";
    copy = `找不到完全相符的 ${state.query}，請改選以下相近代碼。`;
    rooms = state.suggestions;
  } else {
    title = "沒有相近結果";
    copy = `沒有找到與 ${state.query} 接近的教室代碼。`;
  }

  elements.suggestionTitle.textContent = title;
  elements.suggestionCopy.textContent = copy;
  elements.suggestionCount.textContent = `${rooms.length} 筆`;
  elements.suggestionList.innerHTML = rooms.map((room) => createChipButton(room, room === state.exactRoom)).join("");
}

function createEmptySlotMarkup(message = "目前沒有排課") {
  return `
    <div class="empty-pill">
      <strong>空堂</strong>
      <span class="course-meta">${escapeHtml(message)}</span>
    </div>
  `;
}

function createCourseMarkup(course) {
  const weekLabel = course.week && course.week !== "全" ? `${course.week}週` : "全學期";
  const remarks = course.remarks ? `<span class="course-meta">${escapeHtml(course.remarks)}</span>` : "";
  const titleParts = [course.courseName, course.offeringUnit, course.instructor].filter(Boolean).join(" / ");
  const instructor = course.instructor ? `<span class="course-meta">${escapeHtml(course.instructor)}</span>` : "";

  return `
    <article class="course-card" title="${escapeHtml(titleParts)}">
      <div class="course-head">
        <span class="week-badge">${escapeHtml(weekLabel)}</span>
        <strong class="course-title">${escapeHtml(course.courseName)}</strong>
      </div>
      <span class="course-meta">${escapeHtml(course.offeringUnit)}</span>
      ${instructor}
      ${remarks}
    </article>
  `;
}

function renderMobileDayView(room) {
  elements.daySwitcher.innerHTML = WEEKDAY_ORDER.map((weekday) => {
    const parts = getWeekdayParts(weekday);
    const activeClass = weekday === state.selectedWeekday ? " is-active" : "";
    return `
      <button
        type="button"
        class="day-button${activeClass}"
        data-weekday="${escapeHtml(weekday)}"
        aria-pressed="${weekday === state.selectedWeekday ? "true" : "false"}"
      >
        <span>${escapeHtml(parts.long)}</span>
        <strong>${escapeHtml(parts.short)}</strong>
      </button>
    `;
  }).join("");

  elements.dayCards.innerHTML = PERIOD_ORDER.map((period) => {
    const courses = getRoomCourses(room, state.selectedWeekday, period);
    const occupied = courses.length > 0;
    const statusLabel = occupied ? `${courses.length} 門課` : "空堂";
    const stackMarkup = occupied
      ? `<div class="slot-stack">${courses.map((course) => createCourseMarkup(course)).join("")}</div>`
      : createEmptySlotMarkup();

    return `
      <article class="day-period-card ${occupied ? "is-occupied" : "is-empty"}">
        <div class="day-period-head">
          <div class="period-label">
            <strong>${escapeHtml(period)}</strong>
            <span>${escapeHtml(getPeriodSubcopy(period))}</span>
          </div>
          <span class="period-status ${occupied ? "is-occupied" : "is-empty"}">${escapeHtml(statusLabel)}</span>
        </div>
        ${stackMarkup}
      </article>
    `;
  }).join("");
}

function renderTimetable() {
  if (!state.exactRoom) {
    elements.gridCaption.textContent = state.loadState === "loading" ? "課表整理中" : "尚未選擇教室";

    if (state.loadState === "error") {
      elements.emptyStateTitle.textContent = "暫時無法載入課表";
      elements.emptyStateCopy.textContent = "請確認目前資料夾是用本機伺服器開啟，例如 python3 -m http.server 4173。";
    } else if (!state.query) {
      elements.emptyStateTitle.textContent = "先查一間教室";
      elements.emptyStateCopy.textContent = "輸入教室代碼，或從建議清單中點選一間教室，即可查看每一天、每一節的占用與空堂狀態。";
    } else if (state.suggestions.length) {
      elements.emptyStateTitle.textContent = `沒有找到 ${state.query}`;
      elements.emptyStateCopy.textContent = "這個代碼目前沒有完全相符的教室，請從下方最接近的教室中選一間查看整週課表。";
    } else {
      elements.emptyStateTitle.textContent = `查無 ${state.query}`;
      elements.emptyStateCopy.textContent = "請確認字母與數字是否正確，或改試完整教室代碼，例如 LI105。";
    }

    elements.emptyState.hidden = false;
    elements.dayView.classList.add("is-hidden");
    elements.tableWrap.classList.add("is-hidden");
    elements.daySwitcher.innerHTML = "";
    elements.dayCards.innerHTML = "";
    elements.tableHead.innerHTML = "";
    elements.tableBody.innerHTML = "";
    return;
  }

  elements.gridCaption.textContent = `${state.exactRoom} / ${PERIOD_ORDER.length} 節次 x ${WEEKDAY_ORDER.length} 天`;
  elements.emptyState.hidden = true;
  elements.dayView.classList.remove("is-hidden");
  elements.tableWrap.classList.remove("is-hidden");

  elements.tableHead.innerHTML = `
    <tr>
      <th>節次</th>
      ${WEEKDAY_ORDER.map((weekday) => `<th>${escapeHtml(weekday)}</th>`).join("")}
    </tr>
  `;

  elements.tableBody.innerHTML = PERIOD_ORDER.map((period) => {
    const cells = WEEKDAY_ORDER.map((weekday) => {
      const courses = getRoomCourses(state.exactRoom, weekday, period);
      if (!courses.length) {
        return `
          <td class="cell-empty">
            ${createEmptySlotMarkup()}
          </td>
        `;
      }

      return `
        <td class="cell-occupied">
          <div class="slot-stack">
            ${courses.map((course) => createCourseMarkup(course)).join("")}
          </div>
        </td>
      `;
    }).join("");

    return `
      <tr>
        <th scope="row">
          <div class="period-label">
            <strong>${period}</strong>
            <span>${getPeriodSubcopy(period)}</span>
          </div>
        </th>
        ${cells}
      </tr>
    `;
  }).join("");

  renderMobileDayView(state.exactRoom);
}

function renderMetadata() {
  const data = state.metadata || {};
  elements.metaDivision.textContent = data.division || "-";
  elements.metaGenerated.textContent = formatGeneratedAt(data.generated_at_utc);
  elements.metaCourses.textContent = String(data.course_count || data.courses?.length || 0);
  elements.metaRooms.textContent = String(state.rooms.length);
}

function render() {
  renderMetadata();
  renderStatus();
  renderQuickExamples();
  renderRoomSummary();
  renderSuggestions();
  renderTimetable();
}

function bindChipDelegation(container) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-room]");
    if (!button) return;
    const room = button.dataset.room || "";
    setQuery(room);
    render();
  });
}

function bindControls() {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    setQuery(elements.roomQuery.value);
    render();
  });

  elements.roomQuery.addEventListener("input", (event) => {
    const nextValue = normalizeRoom(event.target.value);
    setQuery(nextValue);
    render();
  });

  bindChipDelegation(elements.quickExamples);
  bindChipDelegation(elements.suggestionList);

  elements.daySwitcher.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-weekday]");
    if (!button || !state.exactRoom) return;
    state.selectedWeekday = button.dataset.weekday || WEEKDAY_ORDER[0];
    renderTimetable();
  });
}

async function init() {
  bindControls();
  render();

  try {
    const response = await fetch("./fju_day_courses.json");
    if (!response.ok) {
      throw new Error(`無法載入資料：${response.status}`);
    }

    const data = await response.json();
    const { rooms, schedulesByDay } = buildScheduleIndex(data.courses || []);

    state.metadata = data;
    state.rooms = rooms;
    state.schedulesByDay = schedulesByDay;
    state.examples = buildExampleRooms(rooms);
    state.loadState = "ready";
    setQuery(state.query);

    render();
  } catch (error) {
    state.loadState = "error";
    state.errorMessage = error instanceof Error
      ? `${error.message}。請以本機伺服器開啟，例如 python3 -m http.server 4173。`
      : "資料載入失敗。請確認目前資料夾可直接提供 JSON 檔案。";
    render();
  }
}

init();
