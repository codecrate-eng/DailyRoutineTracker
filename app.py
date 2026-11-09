from flask import Flask, render_template, jsonify, request, Response
import sqlite3
import os
import hmac
from datetime import date, datetime, timedelta
from pathlib import Path
from openpyxl import load_workbook

app = Flask(__name__)

BASE = Path(__file__).resolve().parent
DB = BASE / "tracker.db"
DATA = BASE / "data"

DAYS = [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday"
]

# A day counts toward your streak when this % of its tasks is done
STREAK_THRESHOLD = 60

# Login (set these as environment variables on the server).
# If APP_PASS is not set, the login is disabled (handy for local use).
APP_USER = os.environ.get("APP_USER", "umair")
APP_PASS = os.environ.get("APP_PASS", "")


@app.before_request
def require_login():
    if not APP_PASS:
        return None

    auth = request.authorization

    ok = (
        auth is not None
        and auth.username is not None
        and auth.password is not None
        and hmac.compare_digest(auth.username.encode(), APP_USER.encode())
        and hmac.compare_digest(auth.password.encode(), APP_PASS.encode())
    )

    if not ok:
        return Response(
            "Login required", 401,
            {"WWW-Authenticate": 'Basic realm="My Tracker"'}
        )

    return None


def today_pk():
    # Pakistan time (UTC+5), correct even when the server runs on UTC
    return (datetime.utcnow() + timedelta(hours=5)).date()


# ---------------- DATABASE ----------------

def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = connect()

    con.executescript("""
        CREATE TABLE IF NOT EXISTS routines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day TEXT,
            start_time TEXT,
            activity TEXT,
            category TEXT
        );

        CREATE TABLE IF NOT EXISTS routine_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            routine_id INTEGER,
            log_date TEXT,
            done INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            UNIQUE(routine_id, log_date)
        );

        CREATE TABLE IF NOT EXISTS meals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day_group TEXT,
            meal_time TEXT,
            meal_name TEXT,
            food TEXT,
            quantity REAL,
            unit TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS meal_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meal_id INTEGER,
            log_date TEXT,
            eaten INTEGER DEFAULT 0,
            UNIQUE(meal_id, log_date)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)

    con.commit()
    con.close()


# ---------------- IMPORT EXCEL DATA ----------------

def import_routines():
    con = connect()

    count = con.execute(
        "SELECT COUNT(*) FROM routines"
    ).fetchone()[0]

    if count > 0:
        con.close()
        return

    file = DATA / "Weekly_Routine_Planner_Updated.xlsx"

    if not file.exists():
        con.close()
        print("Routine Excel file not found.")
        return

    wb = load_workbook(file, data_only=True)

    for day in DAYS:
        if day not in wb.sheetnames:
            continue

        ws = wb[day]

        for row in range(5, 81):
            start = ws.cell(row, 1).value
            activity = ws.cell(row, 3).value
            category = ws.cell(row, 4).value

            if not activity:
                continue

            if hasattr(start, "strftime"):
                start = start.strftime("%H:%M")
            elif start is None:
                start = ""

            con.execute("""
                INSERT INTO routines
                (day, start_time, activity, category)
                VALUES (?, ?, ?, ?)
            """, (day, str(start), str(activity),
                  str(category or "General")))

    con.commit()
    con.close()


def import_meals():
    con = connect()

    count = con.execute(
        "SELECT COUNT(*) FROM meals"
    ).fetchone()[0]

    if count > 0:
        con.close()
        return

    file = DATA / "Daily_Diet_Plan_Updated.xlsx"

    if not file.exists():
        con.close()
        print("Diet Excel file not found.")
        return

    wb = load_workbook(file, data_only=True)

    sheets = {
        "Class Days": ["Monday", "Wednesday", "Thursday", "Friday"],
        "Tue & Sat": ["Tuesday", "Saturday"],
        "Sunday": ["Sunday"]
    }

    for sheet, days in sheets.items():
        if sheet not in wb.sheetnames:
            continue

        ws = wb[sheet]

        current_time = ""
        current_meal = ""

        for row in range(9, ws.max_row + 1):
            meal_time = ws.cell(row, 1).value
            meal_name = ws.cell(row, 2).value
            food = ws.cell(row, 3).value
            quantity = ws.cell(row, 4).value
            unit = ws.cell(row, 5).value
            notes = ws.cell(row, 9).value

            if meal_time:
                current_time = str(meal_time)

            if meal_name:
                current_meal = str(meal_name)

            if not food:
                continue

            try:
                quantity = float(quantity or 0)
            except (ValueError, TypeError):
                quantity = 0

            for day in days:
                con.execute("""
                    INSERT INTO meals
                    (day_group, meal_time, meal_name,
                     food, quantity, unit, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    day, current_time, current_meal,
                    str(food), quantity,
                    str(unit or ""),
                    str(notes or "")
                ))

    con.commit()
    con.close()


# ---------------- DATE HELPERS ----------------

def parse_date(value):
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return today_pk()


def week_start(day):
    return day - timedelta(days=day.weekday())


# ---------------- DASHBOARD ----------------

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/dashboard")
def dashboard():
    selected = parse_date(request.args.get("date"))
    selected_day = selected.strftime("%A")

    con = connect()

    tasks = con.execute("""
        SELECT r.id, r.start_time, r.activity, r.category,
               COALESCE(l.done, 0) AS done,
               COALESCE(l.notes, '') AS notes
        FROM routines r
        LEFT JOIN routine_logs l
          ON r.id = l.routine_id AND l.log_date = ?
        WHERE r.day = ?
        ORDER BY r.start_time
    """, (selected.isoformat(), selected_day)).fetchall()

    meals = con.execute("""
        SELECT m.id, m.meal_time, m.meal_name,
               m.food, m.quantity, m.unit, m.notes,
               COALESCE(l.eaten, 0) AS eaten
        FROM meals m
        LEFT JOIN meal_logs l
          ON m.id = l.meal_id AND l.log_date = ?
        WHERE m.day_group = ?
        ORDER BY m.meal_time, m.id
    """, (selected.isoformat(), selected_day)).fetchall()

    con.close()

    task_list = [dict(x) for x in tasks]
    meal_list = [dict(x) for x in meals]

    # Routine and free-time blocks are not counted.
    countable = [
        t for t in task_list
        if t["category"] not in ("Routine", "Free")
    ]

    total = len(countable)
    completed = sum(t["done"] for t in countable)

    percent = round(completed / total * 100) if total else 0

    return jsonify({
        "date": selected.isoformat(),
        "day": selected_day,
        "tasks": task_list,
        "meals": meal_list,
        "completed": completed,
        "total": total,
        "percent": percent
    })


# ---------------- COMPLETE A TASK ----------------

@app.route("/api/task/toggle", methods=["POST"])
def toggle_task():
    data = request.json or {}

    task_id = data.get("id")
    log_date = parse_date(data.get("date")).isoformat()
    done = 1 if data.get("done") else 0

    con = connect()

    con.execute("""
        INSERT INTO routine_logs
        (routine_id, log_date, done)
        VALUES (?, ?, ?)
        ON CONFLICT(routine_id, log_date)
        DO UPDATE SET done = excluded.done
    """, (task_id, log_date, done))

    con.commit()
    con.close()

    return jsonify({"success": True})


# ---------------- TASK NOTES ----------------

@app.route("/api/task/notes", methods=["POST"])
def task_notes():
    data = request.json or {}

    con = connect()

    con.execute("""
        INSERT INTO routine_logs
        (routine_id, log_date, notes)
        VALUES (?, ?, ?)
        ON CONFLICT(routine_id, log_date)
        DO UPDATE SET notes = excluded.notes
    """, (
        data.get("id"),
        parse_date(data.get("date")).isoformat(),
        data.get("notes", "")
    ))

    con.commit()
    con.close()

    return jsonify({"success": True})


# ---------------- MEAL COMPLETION ----------------

@app.route("/api/meal/toggle", methods=["POST"])
def toggle_meal():
    data = request.json or {}

    meal_id = data.get("id")
    log_date = parse_date(data.get("date")).isoformat()
    eaten = 1 if data.get("eaten") else 0

    con = connect()

    con.execute("""
        INSERT INTO meal_logs (meal_id, log_date, eaten)
        VALUES (?, ?, ?)
        ON CONFLICT(meal_id, log_date)
        DO UPDATE SET eaten = excluded.eaten
    """, (meal_id, log_date, eaten))

    con.commit()
    con.close()

    return jsonify({"success": True})


# ---------------- WEEKLY REPORT ----------------

@app.route("/api/weekly")
def weekly():
    selected = parse_date(request.args.get("date"))
    start = week_start(selected)
    end = start + timedelta(days=6)

    con = connect()
    results = []

    for i, day in enumerate(DAYS):
        current = start + timedelta(days=i)

        total = con.execute("""
            SELECT COUNT(*) FROM routines
            WHERE day = ?
            AND category NOT IN ('Routine', 'Free')
        """, (day,)).fetchone()[0]

        completed = con.execute("""
            SELECT COUNT(*)
            FROM routines r
            JOIN routine_logs l ON r.id = l.routine_id
            WHERE r.day = ?
            AND l.log_date = ?
            AND l.done = 1
            AND r.category NOT IN ('Routine', 'Free')
        """, (day, current.isoformat())).fetchone()[0]

        percent = round(completed / total * 100) if total else 0

        results.append({
            "day": day,
            "date": current.isoformat(),
            "completed": completed,
            "total": total,
            "percent": percent
        })

    con.close()

    total_tasks = sum(x["total"] for x in results)
    done_tasks = sum(x["completed"] for x in results)

    overall = round(
        done_tasks / total_tasks * 100
    ) if total_tasks else 0

    return jsonify({
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": results,
        "completed": done_tasks,
        "total": total_tasks,
        "percent": overall
    })


# ---------------- STREAK / STATS ----------------

@app.route("/api/stats")
def stats():
    con = connect()

    totals = {
        row["day"]: row["n"]
        for row in con.execute("""
            SELECT day, COUNT(*) AS n
            FROM routines
            WHERE category NOT IN ('Routine', 'Free')
            GROUP BY day
        """)
    }

    done = {
        row["log_date"]: row["n"]
        for row in con.execute("""
            SELECT l.log_date, COUNT(*) AS n
            FROM routine_logs l
            JOIN routines r ON r.id = l.routine_id
            WHERE l.done = 1
            AND r.category NOT IN ('Routine', 'Free')
            GROUP BY l.log_date
        """)
    }

    con.close()

    if not done:
        return jsonify({
            "current_streak": 0,
            "longest_streak": 0,
            "completion_rate": 0,
            "threshold": STREAK_THRESHOLD
        })

    today = today_pk()
    first = parse_date(min(done))

    run = longest = 0
    sum_done = sum_total = 0

    current = first
    while current <= today:
        total = totals.get(current.strftime("%A"), 0)
        n = done.get(current.isoformat(), 0)

        if total:
            sum_done += n
            sum_total += total

            if n / total * 100 >= STREAK_THRESHOLD:
                run += 1
                longest = max(longest, run)
            elif current != today:
                run = 0          # today is still in progress, don't break

        current += timedelta(days=1)

    return jsonify({
        "current_streak": run,
        "longest_streak": longest,
        "completion_rate": round(sum_done / sum_total * 100) if sum_total else 0,
        "threshold": STREAK_THRESHOLD
    })


# ---------------- ROUTINE EDITING ----------------

@app.route("/api/task/add", methods=["POST"])
def add_task():
    data = request.json or {}

    day = data.get("day")
    activity = data.get("activity", "").strip()

    if day not in DAYS or not activity:
        return jsonify({"error": "Invalid task"}), 400

    con = connect()

    con.execute("""
        INSERT INTO routines
        (day, start_time, activity, category)
        VALUES (?, ?, ?, ?)
    """, (
        day,
        data.get("start_time", ""),
        activity,
        data.get("category", "General")
    ))

    con.commit()
    con.close()

    return jsonify({"success": True})


# ---------------- STARTUP ----------------

init_db()
import_routines()
import_meals()

if __name__ == "__main__":
    # Local computer only.
    # For local Wi-Fi network access, change host to 0.0.0.0.
    app.run(host="127.0.0.1", port=5000, debug=True)