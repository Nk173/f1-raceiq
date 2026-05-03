import os
from typing import Any, Dict, List, Tuple

import pandas as pd
import fastf1
import fastf1.api
from google.oauth2 import service_account
from googleapiclient.discovery import build


# =========================
# CONFIGURATION
# =========================
SPREADSHEET_ID = "1ltjPEwrh_jQC-KpBGmST-REirrXNa2bxjI8sNHNg0is"

YEAR  = int(os.environ.get("F1_YEAR",  "2026"))
# RaceIQ round controls the destination sheet name and the Round column.
# F1_EVENT controls the FastF1 calendar lookup when RaceIQ round numbers differ
# from the official championship calendar.
ROUND = int(os.environ.get("F1_ROUND", "2"))
EVENT = os.environ.get("F1_EVENT", "").strip()
EVENT_SELECTOR = EVENT or ROUND

SHEET_NAME = os.environ.get("F1_SHEET_NAME", f"Results {ROUND}")
RACE_SESSION = "R"
QUALI_SESSION = "Q"

SERVICE_ACCOUNT_FILE = "service_account.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

CACHE_DIR = "fastf1_cache"

# If True, include approximate SC/VSC/yellow context at each pit based on race control messages.
INCLUDE_SC_FLAGS = True


# =========================
# HELPERS
# =========================
def safe_int(val: Any) -> Any:
    if pd.isna(val) or val is None or val == "":
        return ""
    try:
        return int(val)
    except Exception:
        return ""


def clean_text(val: Any) -> str:
    if val is None or pd.isna(val):
        return ""
    return str(val).strip()


def norm_driver_number(val: Any) -> str:
    s = clean_text(val)
    return s


def first_valid_compound(series: pd.Series) -> str:
    for v in series:
        s = clean_text(v).upper()
        if s and s not in {"NAN", "NONE", "UNKNOWN"}:
            return s
    return ""


def bool_to_yes_no(val: bool) -> str:
    return "YES" if val else ""


def ensure_sheet(service, spreadsheet_id: str, sheet_name: str) -> None:
    spreadsheet = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = {
        s["properties"]["title"]: s["properties"]["sheetId"]
        for s in spreadsheet.get("sheets", [])
    }

    if sheet_name not in existing:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]}
        ).execute()


def clear_sheet(service, spreadsheet_id: str, sheet_name: str) -> None:
    service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:AZ"
    ).execute()


def write_sheet(service, spreadsheet_id: str, sheet_name: str, values: List[List[Any]]) -> None:
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A1",
        valueInputOption="RAW",
        body={"values": values}
    ).execute()


def build_grid_from_quali(quali_results: pd.DataFrame) -> Dict[str, Any]:
    """
    Fallback starting grid from qualifying classification.
    Note: this may differ from official grid if there were penalties.
    """
    grid_by_driver: Dict[str, Any] = {}

    for drv in quali_results.itertuples():
        driver_number = norm_driver_number(getattr(drv, "DriverNumber", ""))
        pos = safe_int(getattr(drv, "Position", ""))
        if driver_number and pos != "":
            grid_by_driver[driver_number] = pos

    return grid_by_driver


def build_pit_data_for_driver(laps_df: pd.DataFrame, driver_number: str) -> Tuple[int, List[Any]]:
    """
    Uses race laps where PitInTime is non-null to identify pit-in laps.
    FastF1 documents that if PitInTime is not NaT, that lap is an in-lap. :contentReference[oaicite:2]{index=2}
    """
    drv_laps = laps_df[laps_df["DriverNumber"].astype(str) == driver_number].copy()
    if drv_laps.empty:
        return 0, [""] * 6

    pit_in_laps = (
        drv_laps.loc[drv_laps["PitInTime"].notna(), "LapNumber"]
        .dropna()
        .astype(int)
        .drop_duplicates()
        .sort_values()
        .tolist()
    )

    pit_count = len(pit_in_laps)
    pit_laps6 = pit_in_laps[:6] + [""] * (6 - len(pit_in_laps[:6]))
    return pit_count, pit_laps6


def build_tyre_data_for_driver(timing_app_df: pd.DataFrame, driver_number: str) -> Tuple[str, List[str]]:
    """
    Derives tyres from timing_app_data grouped by Stint.
    timing_app_data includes Driver, Stint, Compound, TotalLaps, etc. :contentReference[oaicite:3]{index=3}
    """
    drv_app = timing_app_df[timing_app_df["Driver"].astype(str) == driver_number].copy()
    if drv_app.empty:
        return "", [""] * 6

    # Keep only rows with a stint identifier
    drv_app = drv_app[drv_app["Stint"].notna()].copy()
    if drv_app.empty:
        return "", [""] * 6

    drv_app = drv_app.sort_values(["Stint", "Time"])

    stint_compounds = (
        drv_app.groupby("Stint", as_index=False)["Compound"]
        .agg(first_valid_compound)
        .sort_values("Stint")
    )

    compounds = stint_compounds["Compound"].tolist()
    starting_tyre = compounds[0] if len(compounds) >= 1 else ""
    tyre_after = compounds[1:7]
    tyre_after += [""] * (6 - len(tyre_after))
    return starting_tyre, tyre_after


def build_all_sc_laps(rc_messages_df: pd.DataFrame) -> str:
    """
    Returns a comma-separated string of ALL laps that had an SC/VSC/yellow
    race control message — race-wide, not limited to actual pit laps.
    Used by the scoring engine to check if a predicted pit lap was near an SC period.
    """
    if rc_messages_df.empty:
        return ""

    relevant = rc_messages_df.copy()
    relevant["Lap"] = pd.to_numeric(relevant.get("Lap"), errors="coerce")

    def is_relevant_row(row) -> bool:
        blob = " ".join([
            clean_text(row.get("Message", "")).upper(),
            clean_text(row.get("Category", "")).upper(),
            clean_text(row.get("Flag", "")).upper(),
            clean_text(row.get("Status", "")).upper(),
        ])
        return (
            "SAFETY CAR" in blob
            or "VIRTUAL SAFETY CAR" in blob
            or "VSC" in blob
            or "YELLOW" in blob
        )

    relevant = relevant[relevant.apply(is_relevant_row, axis=1)]
    sc_laps = sorted(relevant["Lap"].dropna().astype(int).unique().tolist())
    return ",".join(str(x) for x in sc_laps)


def build_sc_flags_for_driver_pits(
    driver_pit_laps: List[Any],
    rc_messages_df: pd.DataFrame
) -> Tuple[List[str], str]:
    """
    Approximate SC/VSC/yellow-at-pit flags using race control messages with Lap numbers.
    race_control_messages includes Message, Category, Flag, Lap, etc. :contentReference[oaicite:4]{index=4}

    We mark a pit as YES if there is any relevant race control message on that same lap:
    - SAFETY CAR
    - VIRTUAL SAFETY CAR / VSC
    - YELLOW

    This is an approximation, not a perfect official session-state reconstruction.
    """
    if rc_messages_df.empty:
        return [""] * 6, ""

    relevant = rc_messages_df.copy()
    relevant["Lap"] = pd.to_numeric(relevant.get("Lap"), errors="coerce")

    def is_relevant_row(row) -> bool:
        msg = clean_text(row.get("Message", "")).upper()
        cat = clean_text(row.get("Category", "")).upper()
        flag = clean_text(row.get("Flag", "")).upper()
        status = clean_text(row.get("Status", "")).upper()

        blob = " ".join([msg, cat, flag, status])

        return (
            "SAFETY CAR" in blob
            or "VIRTUAL SAFETY CAR" in blob
            or "VSC" in blob
            or "YELLOW" in blob
        )

    relevant = relevant[relevant.apply(is_relevant_row, axis=1)].copy()

    sc_flags: List[str] = []
    sc_laps: List[int] = []

    for pit_lap in driver_pit_laps[:6]:
        if pit_lap == "":
            sc_flags.append("")
            continue

        lap_msgs = relevant[relevant["Lap"] == int(pit_lap)]
        flagged = not lap_msgs.empty
        sc_flags.append(bool_to_yes_no(flagged))
        if flagged:
            sc_laps.append(int(pit_lap))

    while len(sc_flags) < 6:
        sc_flags.append("")

    safety_car_laps = ",".join(str(x) for x in sorted(set(sc_laps))) if sc_laps else ""
    return sc_flags, safety_car_laps


# =========================
# MAIN
# =========================
def main() -> None:
    # --- Google Sheets auth ---
    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    print(f"GOOGLE_SERVICE_ACCOUNT_JSON: {'set, length=' + str(len(creds_json)) if creds_json else 'NOT SET — falling back to file'}")
    if creds_json:
        print(f"First 20 chars: {repr(creds_json[:20])}")
        print(f"Last  20 chars: {repr(creds_json[-20:])}")
        import json as _json
        creds = service_account.Credentials.from_service_account_info(
            _json.loads(creds_json),
            scopes=SCOPES
        )
    else:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE,
            scopes=SCOPES
        )
    service = build("sheets", "v4", credentials=creds)

    # --- FastF1 setup ---
    os.makedirs(CACHE_DIR, exist_ok=True)
    fastf1.Cache.enable_cache(CACHE_DIR)

    # --- Load race session ---
    print(f"RaceIQ round: {ROUND}")
    print(f"FastF1 event selector: {EVENT_SELECTOR!r}")
    race_session = fastf1.get_session(YEAR, EVENT_SELECTOR, RACE_SESSION)
    race_session.load()
    print(f"Loaded event: {race_session.event['EventName']} ({race_session.event['EventDate']})")

    race_results = race_session.results.copy()
    laps = race_session.laps.copy()

    # --- Load qualifying as grid fallback ---
    try:
        quali_session = fastf1.get_session(YEAR, EVENT_SELECTOR, QUALI_SESSION)
        quali_session.load()
        quali_results = quali_session.results.copy()
        grid_by_driver = build_grid_from_quali(quali_results)
    except Exception:
        grid_by_driver = {}

    # --- Low-level timing app data for tyre stints ---
    try:
        timing_app = fastf1.api.timing_app_data(race_session.api_path)
        timing_app_df = pd.DataFrame(timing_app)
    except Exception:
        timing_app_df = pd.DataFrame(columns=["Driver", "Stint", "Compound", "Time"])

    # --- Optional race control data for SC/VSC/yellow context ---
    if INCLUDE_SC_FLAGS:
        try:
            rc_messages = fastf1.api.race_control_messages(race_session.api_path)
            rc_messages_df = pd.DataFrame(rc_messages)
        except Exception:
            rc_messages_df = pd.DataFrame(columns=["Lap", "Message", "Category", "Flag", "Status"])
    else:
        rc_messages_df = pd.DataFrame(columns=["Lap", "Message", "Category", "Flag", "Status"])

    # --- Build rows ---
    header = [
        "Race", "Season", "Round", "Driver", "Team",
        "StartingPosition", "FinalPosition", "TotalLaps", "Status", "PitStopCount",
        "PitLap1", "PitLap2", "PitLap3", "PitLap4", "PitLap5", "PitLap6",
        "StartingTyre",
        "TyreAfterPit1", "TyreAfterPit2", "TyreAfterPit3",
        "TyreAfterPit4", "TyreAfterPit5", "TyreAfterPit6",
        "SCAtPit1", "SCAtPit2", "SCAtPit3", "SCAtPit4", "SCAtPit5", "SCAtPit6",
        "SafetyCarLaps",
        "SafetyCarAllLaps",
    ]

    # Race-wide SC laps (same for every driver row)
    sc_all_laps = build_all_sc_laps(rc_messages_df)

    rows: List[List[Any]] = []

    # Sort by final classification if available
    race_results = race_results.sort_values(by=["Position"], na_position="last")

    for drv in race_results.itertuples():
        driver_number = norm_driver_number(getattr(drv, "DriverNumber", ""))
        full_name = clean_text(getattr(drv, "FullName", ""))
        team_name = clean_text(getattr(drv, "TeamName", ""))

        # Grid fallback from qualifying
        grid_pos = grid_by_driver.get(driver_number, "")

        final_pos = safe_int(getattr(drv, "Position", ""))
        total_laps = safe_int(getattr(drv, "Laps", ""))
        status = clean_text(getattr(drv, "Status", ""))

        pit_count, pit_laps6 = build_pit_data_for_driver(laps, driver_number)
        starting_tyre, tyre_after6 = build_tyre_data_for_driver(timing_app_df, driver_number)
        sc_flags6, safety_car_laps = build_sc_flags_for_driver_pits(pit_laps6, rc_messages_df)

        rows.append([
            clean_text(race_session.event["EventName"]),
            YEAR,
            ROUND,
            full_name,
            team_name,
            grid_pos,
            final_pos,
            total_laps,
            status,
            pit_count,
            *pit_laps6,
            starting_tyre,
            *tyre_after6,
            *sc_flags6,
            safety_car_laps,
            sc_all_laps,
        ])

    # --- Upload to Sheets ---
    ensure_sheet(service, SPREADSHEET_ID, SHEET_NAME)
    clear_sheet(service, SPREADSHEET_ID, SHEET_NAME)
    write_sheet(service, SPREADSHEET_ID, SHEET_NAME, [header] + rows)

    print(f"Uploaded {len(rows)} rows to '{SHEET_NAME}'.")


if __name__ == "__main__":
    main()
