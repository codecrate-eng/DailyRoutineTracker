// ============================================================
//  STATE
// ============================================================

let selectedDate = new Date().toLocaleDateString("en-CA");
let activeFilter = "All";
let lastTasks = [];
let lastWeekly = null;
let lastStats = null;
let lastPercent = 0;
let donutSig = "";

const $ = id => document.getElementById(id);

const TITLES = {
    dashboard: "Dashboard",
    routine: "Daily Routine",
    diet: "Diet Planner",
    weekly: "Weekly Progress"
};

const CAT_COLORS = {
    Routine: "#6366f1",
    Prayer: "#22c55e",
    Quran: "#f97316",
    Sleep: "#a855f7",
    Meals: "#fbbf24",
    Class: "#ec4899",
    Exercise: "#ef4444",
    Coding: "#0ea5e9",
    Work: "#3b82f6",
    General: "#2b9ac0",
    Free: "#94a3b8"
};

const colorFor = cat => CAT_COLORS[cat] || "#8e8e93";


// ============================================================
//  HELPERS
// ============================================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function safePercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
}

const isoDate = d => d.toLocaleDateString("en-CA");

function shiftDate(value, days) {
    const d = new Date(value + "T12:00:00");
    d.setDate(d.getDate() + days);
    return isoDate(d);
}

function formatDate(value) {
    return new Date(value + "T12:00:00").toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function shortDate(value) {
    return new Date(value + "T12:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
    });
}

function countUp(el, to, suffix = "%", ms = 900) {
    const from = parseFloat(el.dataset.v || 0);
    el.dataset.v = to;
    const start = performance.now();

    function tick(now) {
        const k = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * eased) + suffix;
        if (k < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

function setRing(id, percent, r, replay = false) {
    const el = $(id);
    const C = 2 * Math.PI * r;
    const p = safePercent(percent);

    el.style.strokeDasharray = C;

    const apply = () => {
        el.style.strokeDashoffset = C * (1 - p / 100);
        el.style.opacity = p > 0 ? 1 : 0;
    };

    if (replay) {
        el.style.transition = "none";
        el.style.strokeDashoffset = C;
        void el.getBoundingClientRect();
        el.style.transition = "";
        requestAnimationFrame(() => requestAnimationFrame(apply));
    } else {
        apply();
    }
}

let toastTimer;
function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}


// ============================================================
//  NAVIGATION
// ============================================================

function showPage(page) {

    document.querySelectorAll(".page").forEach(section => {
        section.classList.add("hidden");
        section.classList.remove("enter");
    });

    const target = $(page + "-page");
    target.classList.remove("hidden");
    void target.offsetWidth;
    target.classList.add("enter");

    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === page);
    });

    $("page-title").textContent = TITLES[page];

    loadAll();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
});


// ============================================================
//  DATE
// ============================================================

$("selected-date").value = selectedDate;
$("today-date").textContent = formatDate(selectedDate);

function setDate(value) {
    if (!value) return;
    selectedDate = value;
    $("selected-date").value = value;
    loadAll();
}

$("selected-date").addEventListener("change", e => setDate(e.target.value));

$("btn-today").addEventListener("click", () => {
    setDate(new Date().toLocaleDateString("en-CA"));
});

$("week-prev").addEventListener("click", () => setDate(shiftDate(selectedDate, -7)));
$("week-next").addEventListener("click", () => setDate(shiftDate(selectedDate, 7)));


// ============================================================
//  LOAD EVERYTHING
// ============================================================

function loadAll() {
    return Promise.all([loadDashboard(), loadWeekly(), loadStats()]);
}


// ============================================================
//  DASHBOARD
// ============================================================

async function loadDashboard() {

    const response = await fetch(`/api/dashboard?date=${selectedDate}`);
    if (!response.ok) return;

    const data = await response.json();

    lastTasks = data.tasks;
    lastPercent = data.percent;

    $("today-date").textContent = formatDate(data.date);

    // rings
    countUp($("daily-percent"), data.percent);
    setRing("daily-ring", data.percent, 52);

    const remaining = Math.max(0, data.total - data.completed);

    $("done-count").textContent = data.completed;
    $("left-count").textContent = remaining;
    $("daily-chip").textContent = `${data.percent}% of daily tasks completed`;

    $("completed-num").textContent = data.completed;
    $("completed-of").textContent = `of ${data.total}`;
    setRing("task-ring", data.total ? data.completed / data.total * 100 : 0, 52);

    const eaten = data.meals.filter(m => m.eaten).length;
    $("meals-eaten").textContent = `${eaten}/${data.meals.length}`;
    $("not-counted").textContent = data.tasks.length - data.total;

    $("task-chip").textContent =
        data.percent === 100 && data.total ? "Perfect day! 🏆" :
        data.percent >= 50 ? "Over halfway 💪" :
        data.percent > 0 ? "Great start ✨" :
        "Let's begin";

    updateConsistency(data);
    renderSchedule();
    renderRoutine();
    renderDonut(data.tasks);
    renderMeals(data.meals);
}


// ============================================================
//  TASK RENDERING
// ============================================================

function taskRow(task) {
    return `
        <div class="task-item ${task.done ? "task-done" : ""}">

            <label class="check">
                <input type="checkbox"
                       data-task="${task.id}"
                       ${task.done ? "checked" : ""}>
                <i></i>
            </label>

            <span class="task-time">${escapeHTML(task.start_time)}</span>

            <div class="task-info">
                <strong>${escapeHTML(task.activity)}</strong>
                <small>
                    <i class="dot" style="background:${colorFor(task.category)}"></i>
                    ${escapeHTML(task.category)}
                </small>
            </div>

        </div>
    `;
}

function renderSchedule() {

    const tasks = activeFilter === "All"
        ? lastTasks
        : lastTasks.filter(t => (t.category || "General") === activeFilter);

    // filter chips
    const cats = [...new Set(lastTasks.map(t => t.category || "General"))];

    if (activeFilter !== "All" && !cats.includes(activeFilter)) {
        activeFilter = "All";
        return renderSchedule();
    }

    $("filter-chips").innerHTML = ["All", ...cats].map(cat => `
        <button class="filter-chip ${cat === activeFilter ? "active" : ""}"
                data-filter="${escapeHTML(cat)}">
            ${cat === "All" ? "" :
              `<i class="dot" style="background:${colorFor(cat)};width:8px;height:8px"></i>`}
            ${escapeHTML(cat)}
        </button>
    `).join("");

    $("dashboard-tasks").innerHTML = tasks.length
        ? tasks.map(taskRow).join("")
        : "<p class='muted'>No tasks scheduled.</p>";
}

function renderRoutine() {
    $("routine-list").innerHTML = lastTasks.length
        ? lastTasks.map(taskRow).join("")
        : "<p class='muted'>No tasks scheduled.</p>";
}

function setFilter(value) {
    activeFilter = (activeFilter === value) ? "All" : value;
    renderSchedule();
    updateDonutActive();
}


// ============================================================
//  COMPLETE TASK / MEAL
// ============================================================

async function toggleTask(id, done) {

    await fetch("/api/task/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, done, date: selectedDate })
    });

    await loadAll();

    if (done && lastPercent === 100) {
        toast("🎉 Perfect day! Every task completed.");
    }
}

async function toggleMeal(id, eaten) {

    await fetch("/api/meal/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, eaten, date: selectedDate })
    });

    loadDashboard();
}

// One listener handles every checkbox
document.addEventListener("change", event => {

    const target = event.target;

    if (target.dataset.task) {
        toggleTask(Number(target.dataset.task), target.checked);
    }

    if (target.dataset.meal) {
        toggleMeal(Number(target.dataset.meal), target.checked);
    }
});

// One listener handles chips, bars, tubes
document.addEventListener("click", event => {

    const chip = event.target.closest("[data-filter]");
    if (chip) {
        const value = chip.dataset.filter;
        if (value === "All") {
            activeFilter = "All";
            renderSchedule();
            updateDonutActive();
        } else {
            setFilter(value);
        }
        return;
    }

    const cat = event.target.closest("[data-cat]");
    if (cat) {
        setFilter(cat.dataset.cat);
        return;
    }

    const day = event.target.closest("[data-date]");
    if (day) {
        if (day.dataset.go === "dashboard") {
            selectedDate = day.dataset.date;
            $("selected-date").value = selectedDate;
            showPage("dashboard");
        } else {
            setDate(day.dataset.date);
        }
    }
});


// ============================================================
//  CONSISTENCY MESSAGE
// ============================================================

function updateConsistency(data) {

    const box = $("consistency-message");
    const hour = new Date().getHours();
    const isToday = data.date === new Date().toLocaleDateString("en-CA");
    const late = isToday && hour >= 20;

    if (data.percent === 100 && data.total > 0) {

        box.textContent =
            "✨ Excellent! All your scheduled tasks are completed.";

    } else if (data.percent === 0 && late) {

        box.textContent =
            "You haven't recorded any completed tasks today. " +
            "It's okay to start with one small activity.";

    } else if (data.percent < 40 && late) {

        box.textContent =
            "Your progress is below 40% today. " +
            "Review your remaining tasks and choose what is manageable.";

    } else {

        box.textContent =
            "Keep tracking your activities. Consistency is built over time.";
    }
}


// ============================================================
//  CATEGORY DONUT
// ============================================================

function renderDonut(tasks) {

    const counts = {};
    tasks.forEach(t => {
        const c = t.category || "General";
        counts[c] = (counts[c] || 0) + 1;
    });

    const total = tasks.length;
    const sig = JSON.stringify(counts);

    if (sig === donutSig) {
        updateDonutActive();
        return;
    }

    donutSig = sig;

    const wrap = $("donut-wrap");
    const legend = $("donut-legend");

    if (!total) {
        wrap.innerHTML = "<p class='muted'>No data</p>";
        legend.innerHTML = "";
        return;
    }

    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const r = 70;
    const C = 2 * Math.PI * r;
    let offset = 0;

    const segments = entries.map(([name, n]) => {
        const len = n / total * C;
        const seg = `
            <circle class="seg" data-cat="${escapeHTML(name)}"
                    data-len="${Math.max(len - 3, 0.5)}"
                    cx="90" cy="90" r="${r}"
                    stroke="${colorFor(name)}"
                    stroke-dasharray="0 ${C}"
                    stroke-dashoffset="${-offset}"
                    stroke-linecap="round"/>`;
        offset += len;
        return seg;
    }).join("");

    wrap.innerHTML = `
        <svg viewBox="0 0 180 180">${segments}</svg>
        <div class="donut-center">
            <b id="donut-num">${total}</b>
            <small id="donut-label">Tasks</small>
        </div>
    `;

    legend.innerHTML = entries.map(([name, n]) => `
        <div class="legend-row" data-cat="${escapeHTML(name)}">
            <i class="dot" style="background:${colorFor(name)}"></i>
            ${escapeHTML(name)}
            <span>${n} (${Math.round(n / total * 100)}%)</span>
        </div>
    `).join("");

    requestAnimationFrame(() => requestAnimationFrame(() => {
        wrap.querySelectorAll(".seg").forEach(seg => {
            seg.style.strokeDasharray = `${seg.dataset.len} ${C}`;
        });
    }));

    updateDonutActive();
}

function updateDonutActive() {
    document.querySelectorAll(".seg, .legend-row").forEach(el => {
        const isActive = el.dataset.cat === activeFilter;
        el.classList.toggle("active", el.classList.contains("seg") && isActive);
        el.classList.toggle("dim", activeFilter !== "All" && !isActive);
    });
}

// hover: show category in the donut centre
function donutCenter(name) {
    const num = $("donut-num");
    const label = $("donut-label");
    if (!num) return;

    if (name) {
        num.textContent = lastTasks.filter(
            t => (t.category || "General") === name
        ).length;
        label.textContent = name;
    } else {
        num.textContent = lastTasks.length;
        label.textContent = "Tasks";
    }
}

["donut-wrap", "donut-legend"].forEach(id => {
    const el = $(id);

    el.addEventListener("mouseover", e => {
        const hit = e.target.closest("[data-cat]");
        if (hit) donutCenter(hit.dataset.cat);
    });

    el.addEventListener("mouseout", e => {
        if (e.target.closest("[data-cat]")) donutCenter(null);
    });
});


// ============================================================
//  DIET / MEALS
// ============================================================

function renderMeals(meals) {

    const container = $("meal-list");

    const eatenTotal = meals.filter(m => m.eaten).length;
    $("meal-summary").textContent = `${eatenTotal} / ${meals.length} eaten`;
    $("meal-bar").style.width =
        (meals.length ? eatenTotal / meals.length * 100 : 0) + "%";

    if (!meals.length) {
        container.innerHTML = "<p class='muted'>No meals scheduled.</p>";
        return;
    }

    const groups = {};

    meals.forEach(meal => {
        const key = meal.meal_name || "Other";
        (groups[key] = groups[key] || []).push(meal);
    });

    container.innerHTML = Object.entries(groups).map(([name, items]) => `

        <div class="meal-group">

            <h3>
                ${escapeHTML(name)}
                <small>${items.filter(m => m.eaten).length} / ${items.length}</small>
            </h3>

            ${items.map(meal => `

                <div class="meal-row ${meal.eaten ? "eaten" : ""}">

                    <label class="check">
                        <input type="checkbox"
                               data-meal="${meal.id}"
                               ${meal.eaten ? "checked" : ""}>
                        <i></i>
                    </label>

                    <div>
                        <strong>${escapeHTML(meal.food)}</strong>
                        <small>
                            ${escapeHTML(meal.meal_time)}
                            · ${escapeHTML(meal.quantity)}
                            ${escapeHTML(meal.unit)}
                        </small>
                        ${meal.notes ? `<small>${escapeHTML(meal.notes)}</small>` : ""}
                    </div>

                </div>

            `).join("")}

        </div>

    `).join("");
}


// ============================================================
//  STATS (STREAK)
// ============================================================

async function loadStats() {

    const response = await fetch("/api/stats");
    if (!response.ok) return;

    const s = await response.json();
    lastStats = s;

    $("streak-cur").textContent = s.current_streak;
    $("streak-best").textContent = s.longest_streak;
    $("streak-rate").textContent = s.completion_rate + "%";

    $("streak-title").textContent = s.current_streak > 0
        ? `${s.current_streak}-day streak, keep it burning! 🔥`
        : "Let's build a winning streak! 🔥";

    $("streak-note").textContent =
        `A day counts toward your streak when you finish ${s.threshold}% or more of its tasks.`;

    $("w-streak").textContent = `${s.current_streak} 🔥`;
}


// ============================================================
//  WEEKLY REPORT
// ============================================================

async function loadWeekly() {

    const response = await fetch(`/api/weekly?date=${selectedDate}`);
    if (!response.ok) return;

    const data = await response.json();
    lastWeekly = data;

    renderBars(data);
    renderWeeklyPage(data);
}

// ---- dashboard mini bars ----

function renderBars(data) {

    const wrap = $("week-bars");

    if (wrap.children.length !== data.days.length) {
        wrap.innerHTML = data.days.map(d => `
            <button class="bar-col" data-date="${d.date}">
                <div class="bar-track"><div class="bar-fill"></div></div>
                <span class="bar-pct"></span>
                <span class="bar-day">${d.day.slice(0, 3)}</span>
            </button>
        `).join("");
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
        data.days.forEach((d, i) => {
            const col = wrap.children[i];
            col.dataset.date = d.date;
            col.dataset.tip = `${d.completed}/${d.total} done`;
            col.classList.toggle("active", d.date === selectedDate);
            col.querySelector(".bar-fill").style.height = safePercent(d.percent) + "%";
            col.querySelector(".bar-pct").textContent = d.percent + "%";
        });
    }));

    $("weekly-avg").textContent = `Weekly average: ${data.percent}%`;
}

// ---- weekly page ----

function gradeFor(p) {
    if (p >= 90) return "Legendary";
    if (p >= 70) return "On fire";
    if (p >= 40) return "Building momentum";
    if (p > 0) return "Warming up";
    return "Fresh week";
}

function tubeColors(p) {
    if (p >= 80) return ["#16a34a", "#4ade80"];
    if (p >= 50) return ["#4f46e5", "#818cf8"];
    if (p >= 25) return ["#f59e0b", "#fbbf24"];
    return ["#f97316", "#fb923c"];
}

function renderWeeklyPage(data) {

    // hero
    countUp($("weekly-total"), data.percent);
    $("weekly-grade").textContent = gradeFor(data.percent);
    setRing("week-ring", data.percent, 90, true);

    $("week-range").textContent =
        `${shortDate(data.start)} – ${shortDate(data.end)}`;

    $("w-done").textContent = `${data.completed} / ${data.total}`;

    const active = data.days.filter(d => d.total > 0);
    const best = active.reduce(
        (a, b) => (b.percent > a.percent ? b : a),
        active[0] || { percent: 0, day: "—" }
    );

    $("w-best").textContent = best.percent > 0 ? best.day.slice(0, 3) : "—";

    // insights
    const perfect = data.days.filter(d => d.percent === 100 && d.total > 0).length;
    const activeDays = data.days.filter(d => d.percent > 0).length;
    const left = data.total - data.completed;

    const insights = [
        best.percent > 0 ? `🏅 Best: ${best.day} (${best.percent}%)` : "🌱 No wins logged yet",
        `📅 ${activeDays}/7 active days`,
        `💎 ${perfect} perfect ${perfect === 1 ? "day" : "days"}`,
        `🎯 ${left} tasks to go`
    ];

    $("insight-row").innerHTML = insights.map((text, i) =>
        `<span class="chip" style="animation-delay:${i * 0.08}s">${text}</span>`
    ).join("");

    // tubes
    $("tube-row").innerHTML = data.days.map(d => {
        const [c1, c2] = tubeColors(d.percent);
        return `
            <button class="tube ${d.date === selectedDate ? "selected" : ""}"
                    data-date="${d.date}" data-go="dashboard"
                    style="--c1:${c1};--c2:${c2}">
                <div class="tube-glass">
                    <div class="tube-fill ${d.percent ? "" : "empty"}"
                         data-h="${safePercent(d.percent)}"></div>
                    <span class="tube-pct">${d.percent}%</span>
                </div>
                <strong>${d.day.slice(0, 3)}</strong>
                <small>${d.completed}/${d.total}</small>
            </button>
        `;
    }).join("");

    requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelectorAll(".tube-fill").forEach(el => {
            el.style.height = el.dataset.h + "%";
        });
    }));

    renderTrend(data.days);
}


// ---- trend line ----

const TREND = { W: 700, H: 260, pl: 40, pr: 20, pt: 24, pb: 38 };
const trendX = (i, n) => TREND.pl + (TREND.W - TREND.pl - TREND.pr) * i / (n - 1);
const trendY = p => TREND.pt + (TREND.H - TREND.pt - TREND.pb) * (1 - p / 100);

function smoothPath(points) {
    return points.map((p, i) => {
        if (i === 0) return `M${p[0]},${p[1]}`;
        const q = points[i - 1];
        const mx = (q[0] + p[0]) / 2;
        return `C${mx},${q[1]} ${mx},${p[1]} ${p[0]},${p[1]}`;
    }).join(" ");
}

function renderTrend(days) {

    const { W, H, pl, pr, pt, pb } = TREND;
    const n = days.length;

    const pts = days.map((d, i) => [trendX(i, n), trendY(d.percent)]);
    const line = smoothPath(pts);
    const area = `${line} L${pts[n - 1][0]},${H - pb} L${pts[0][0]},${H - pb} Z`;

    const grid = [0, 25, 50, 75, 100].map(v => `
        <line class="grid" x1="${pl}" x2="${W - pr}" y1="${trendY(v)}" y2="${trendY(v)}"/>
        <text class="ax" x="${pl - 10}" y="${trendY(v) + 4}" text-anchor="end">${v}</text>
    `).join("");

    const labels = days.map((d, i) => `
        <text class="ax" x="${trendX(i, n)}" y="${H - 12}" text-anchor="middle">${d.day.slice(0, 3)}</text>
    `).join("");

    const dots = pts.map(p =>
        `<circle class="trend-dot" cx="${p[0]}" cy="${p[1]}" r="5" stroke="url(#lineG)"/>`
    ).join("");

    $("trend-svg").innerHTML = `
        <svg viewBox="0 0 ${W} ${H}">
            <defs>
                <linearGradient id="lineG" gradientUnits="userSpaceOnUse"
                                x1="${pl}" y1="0" x2="${W - pr}" y2="0">
                    <stop offset="0" stop-color="#64d2ff"/>
                    <stop offset="0.5" stop-color="#bf5af2"/>
                    <stop offset="1" stop-color="#ff5fa2"/>
                </linearGradient>
                <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#bf5af2" stop-opacity=".45"/>
                    <stop offset="1" stop-color="#bf5af2" stop-opacity="0"/>
                </linearGradient>
                <filter id="glow" x="-20%" y="-50%" width="140%" height="200%">
                    <feGaussianBlur stdDeviation="7"/>
                </filter>
            </defs>

            ${grid}
            ${labels}

            <path class="trend-area" d="${area}" fill="url(#areaG)"/>
            <path class="trend-line draw" pathLength="1" d="${line}"
                  stroke="url(#lineG)" filter="url(#glow)" opacity=".8"/>
            <path class="trend-line draw" pathLength="1" d="${line}"
                  stroke="url(#lineG)"/>

            <line id="trend-guide" x1="0" x2="0" y1="${pt}" y2="${H - pb}"
                  stroke="rgba(255,255,255,.35)" stroke-dasharray="4 5" opacity="0"/>

            ${dots}

            <circle id="trend-focus" r="8" fill="#fff" stroke="#bf5af2"
                    stroke-width="4" opacity="0"/>
        </svg>
    `;
}

function showTrendPoint(index) {

    const svg = $("trend-svg").querySelector("svg");
    if (!svg || !lastWeekly) return;

    const days = lastWeekly.days;
    const d = days[index];
    const rect = svg.getBoundingClientRect();

    const x = trendX(index, days.length);
    const y = trendY(d.percent);

    const guide = $("trend-guide");
    const focus = $("trend-focus");

    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    guide.setAttribute("opacity", 1);

    focus.setAttribute("cx", x);
    focus.setAttribute("cy", y);
    focus.setAttribute("opacity", 1);

    const tip = $("trend-tip");
    tip.innerHTML = `<b>${d.percent}%</b>${d.day} · ${d.completed}/${d.total} tasks`;
    tip.style.left = (x / TREND.W * rect.width) + "px";
    tip.style.top = (y / TREND.H * rect.height) + "px";
    tip.style.opacity = 1;
}

function hideTrendPoint() {
    ["trend-guide", "trend-focus"].forEach(id => {
        const el = $(id);
        if (el) el.setAttribute("opacity", 0);
    });
    $("trend-tip").style.opacity = 0;
}

$("trend-wrap").addEventListener("pointermove", event => {

    const svg = $("trend-svg").querySelector("svg");
    if (!svg || !lastWeekly) return;

    const rect = svg.getBoundingClientRect();
    const n = lastWeekly.days.length;

    const vx = (event.clientX - rect.left) / rect.width * TREND.W;
    const step = (TREND.W - TREND.pl - TREND.pr) / (n - 1);

    let index = Math.round((vx - TREND.pl) / step);
    index = Math.max(0, Math.min(n - 1, index));

    showTrendPoint(index);
});

$("trend-wrap").addEventListener("pointerleave", hideTrendPoint);


// ============================================================
//  ADD NEW TASK
// ============================================================

$("add-task-form").addEventListener("submit", async event => {

    event.preventDefault();

    const payload = {
        day: $("task-day").value,
        start_time: $("task-time").value,
        activity: $("task-name").value,
        category: $("task-category").value
    };

    const response = await fetch("/api/task/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        $("add-task-form").reset();
        toast("✅ Task added successfully!");
        loadAll();
    } else {
        toast("⚠️ Unable to add task.");
    }
});


// ============================================================
//  INITIAL LOAD
// ============================================================

loadAll();