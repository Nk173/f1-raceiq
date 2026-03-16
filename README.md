# RaceIQ — F1 Pit Strategy Prediction Game

RaceIQ is a race-weekend prediction game built around Formula 1 pit strategy. Players select two drivers within a budget and predict each driver's pit stop laps and tyre compounds. Submissions are scored after the race using live telemetry data from the FastF1 API.

> **The RaceIQ app is coming to the Google Play Store soon.**

---

## How It Works

### 1. Player Submission

Before each race, a web form is served via Google Apps Script. Players:

- Pick **2 drivers** from a tiered price list (combined budget ≤ 50m enforced server-side)
- Predict **pit lap numbers** (up to 3 stops per driver)
- Predict the **tyre compound** fitted after each stop

Submissions are written directly to a per-race sheet (`Race N`) in Google Sheets. The form closes 30 minutes before race start. Only the latest submission per email address is used for scoring.

### 2. Results Ingestion

A GitHub Actions workflow triggers automatically ~4 hours after race start and runs `fastf1-sheets.py`, which:

- Loads the session via the [FastF1](https://github.com/theOehrly/Fast-F1) Python library
- Extracts per-driver: final position, pit lap numbers, tyre compounds, and Safety Car / Virtual Safety Car flags for each stop
- Writes a structured `Results N` sheet to Google Sheets via the Sheets API using a service account

### 3. Scoring

`rebuildScores()` reads `Choices N` against `Results N` and computes points across four categories:

#### Position Points
```
position_pts = (total_drivers − final_position) + (start_position − final_position)
```
Rewards drivers who finish high and gain positions from their grid slot.

#### Pit Count Points
| Predicted stops = Actual stops | Points |
|---|---|
| 1 stop | 10 |
| 2 stops | 15 |
| 3 stops | 25 |

#### Pit Lap Points (per stop)
| Accuracy | Points |
|---|---|
| Exact lap | 25 |
| ±1 lap | 20 |
| ±2 laps | 15 |
| SC/VSC contingency* | 15 |
| Miss | 0 |

\* **SC/VSC contingency**: if the driver's actual pit stop was triggered by a Safety Car or Virtual Safety Car, and the actual pit lap falls within `[predicted − 5, predicted + 2]`, the player is awarded 15 points. This accounts for reactive pit calls that are hard to predict precisely but reasonable to anticipate within a window.

#### Tyre Points
10 points per stop for an exact compound match (Soft / Medium / Hard / Intermediate / Wet).

#### Total
```
total = position_pts(D1) + position_pts(D2)
      + pit_count_pts(D1) + pit_count_pts(D2)
      + Σ pit_lap_pts(D1, stops 1–3) + Σ pit_lap_pts(D2, stops 1–3)
      + Σ tyre_pts(D1, stops 1–3) + Σ tyre_pts(D2, stops 1–3)
```

### 4. Leaderboard

After each race, `rebuildLeaderboard()` scans all `Scores N` sheets and aggregates total points per team across the season into a cumulative `Leaderboard` sheet.

---

## Pipeline Overview

```
Player (browser)
     │  Google Apps Script Web App
     ▼
 Race N sheet (Google Sheets)
     │  rebuildChoicesLatestPerEmail()
     ▼
 Choices N sheet
     │
     │                GitHub Actions (cron / manual)
     │                fastf1-sheets.py  ──►  FastF1 API
     │                        │
     ▼                        ▼
 Scores N  ◄──  rebuildScores()  ◄──  Results N sheet
     │
     ▼
 Leaderboard (cumulative)
     │
     ▼
 Score emails  (rebuildEmails)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Submission form | Google Apps Script Web App (HTML/CSS/JS) |
| Data store | Google Sheets |
| Orchestration | Google Apps Script (menu triggers, time-based triggers) |
| Results ingestion | Python 3 + FastF1 + gspread |
| CI/CD | GitHub Actions |
| Auth | Google Service Account (Sheets API) |

---

## Repository Structure

```
f1-raceiq/
├── CreateWebForm.js   # Web app entry point (doGet, submitFormResponse)
├── WebForm.html       # Form UI template
├── Choices.js         # Deduplicates submissions → Choices N
├── Scores.js          # Scoring engine + leaderboard
├── SeasonConfig.js    # Season/race configuration builder
├── Schedule.js        # Time-based trigger management
├── Email.js           # Score email dispatch
├── Code.js            # Menu definitions
└── fastf1/
    └── fastf1-sheets.py  # Results ingestion script

assets/
├── {round}.png        # Race cover image (per round)
├── line-up.png        # Driver line-up graphic
└── Pricing.xlsx       # Driver price list

.github/workflows/
└── fetch-results.yml  # GitHub Actions: auto-fetch results post-race
```
