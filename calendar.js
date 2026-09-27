const MONTH_NAMES = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];

let viewYear;
let viewMonth; // 0-indexed

function getStoredJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

function formatHoursShort(h) {
    const totalMinutes = Math.round(h * 60);
    const hoursPart = Math.floor(totalMinutes / 60);
    const minutesPart = totalMinutes % 60;
    if (hoursPart === 0) return `${minutesPart}m`;
    if (minutesPart === 0) return `${hoursPart}h`;
    return `${hoursPart}h ${minutesPart}m`;
}

const el = {};

function cacheRefs() {
    el.menuBtn = document.querySelector('#page-menu-btn');
    el.pageMenu = document.querySelector('#page-menu');
    el.sidebarBackdrop = document.querySelector('#sidebar-backdrop');
    el.sidebarClose = document.querySelector('#sidebar-close');

    el.calendarGrid = document.querySelector('#calendar-grid');
    el.calendarTitle = document.querySelector('#calendar-title');
    el.prevMonthBtn = document.querySelector('#prev-month-btn');
    el.nextMonthBtn = document.querySelector('#next-month-btn');
}

function openSidebar() {
    el.pageMenu.classList.add('open');
    el.sidebarBackdrop.classList.add('open');
}
function closeSidebar() {
    el.pageMenu.classList.remove('open');
    el.sidebarBackdrop.classList.remove('open');
}

function renderCalendar(year, month) {
    el.calendarGrid.innerHTML = '';
    el.calendarTitle.textContent = `${MONTH_NAMES[month]} ${year}`;

    ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(name => {
        const cell = document.createElement('div');
        cell.className = 'calendar-weekday';
        cell.textContent = name;
        el.calendarGrid.appendChild(cell);
    });

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    for (let i = 0; i < firstWeekday; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day calendar-empty';
        el.calendarGrid.appendChild(cell);
    }
    const logsByDate = getStoredJSON('logsByDate', {});

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        if (isCurrentMonth && day === today.getDate()) {
            cell.classList.add('calendar-today');
        }

        const dateStr = new Date(year, month, day).toDateString();
        const dayLog = logsByDate[dateStr];

        const numberEl = document.createElement('div');
        numberEl.className = 'day-number';
        numberEl.textContent = day;
        cell.appendChild(numberEl);

        if (dayLog && dayLog.hours && Object.keys(dayLog.hours).length > 0) {
            const list = document.createElement('div');
            list.className = 'day-activities';
            Object.entries(dayLog.hours).forEach(([activity, hours]) => {
                const line = document.createElement('div');
                line.className = 'day-activity';
                line.textContent = `+${formatHoursShort(hours)} ${activity} `;
                list.appendChild(line);
            });
            cell.appendChild(list);
        }

        el.calendarGrid.appendChild(cell);
    }
}

function goToPrevMonth() {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar(viewYear, viewMonth);
}

function goToNextMonth() {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar(viewYear, viewMonth);
}

function wireEvents() {
    el.menuBtn.addEventListener('click', () => {
        if (el.pageMenu.classList.contains('open')) closeSidebar();
        else openSidebar();
    });
    el.sidebarBackdrop.addEventListener('click', closeSidebar);
    el.sidebarClose.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSidebar();
    });

    el.prevMonthBtn.addEventListener('click', goToPrevMonth);
    el.nextMonthBtn.addEventListener('click', goToNextMonth);
}

function init() {
    cacheRefs();
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    renderCalendar(viewYear, viewMonth);
    wireEvents();
}

init();