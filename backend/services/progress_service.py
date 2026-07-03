"""
Progress aggregation service.
Rolls up room-level AI analysis results through unit → floor → project hierarchy.
"""
from sqlalchemy.orm import Session
from models.database import Project, Floor, Unit, Room, AIAnalysis
from typing import Optional
import statistics


def recalc_room(room_id: str, db: Session) -> float:
    """Average of latest AI analysis components for a room."""
    latest = (
        db.query(AIAnalysis)
        .filter(AIAnalysis.room_id == room_id)
        .order_by(AIAnalysis.analysed_at.desc())
        .first()
    )
    if not latest:
        return 0.0
    pct = latest.overall_pct or 0.0
    room = db.query(Room).get(room_id)
    if room:
        room.progress_pct = round(pct, 1)
        room.last_analysed = latest.analysed_at
        db.commit()
    return pct


def recalc_unit(unit_id: str, db: Session) -> float:
    unit = db.query(Unit).get(unit_id)
    if not unit or not unit.rooms:
        return 0.0
    pcts = [r.progress_pct for r in unit.rooms]
    avg = round(statistics.mean(pcts), 1) if pcts else 0.0
    unit.progress_pct = avg
    db.commit()
    return avg


def recalc_floor(floor_id: str, db: Session) -> float:
    floor = db.query(Floor).get(floor_id)
    if not floor or not floor.units:
        return 0.0
    pcts = [u.progress_pct for u in floor.units]
    avg = round(statistics.mean(pcts), 1) if pcts else 0.0
    floor.progress_pct = avg
    db.commit()
    return avg


def recalc_project(project_id: str, db: Session) -> float:
    project = db.query(Project).get(project_id)
    if not project or not project.floors:
        return 0.0
    pcts = [f.progress_pct for f in project.floors]
    avg = round(statistics.mean(pcts), 1) if pcts else 0.0
    return avg


def full_rollup(room_id: str, db: Session):
    """Trigger full recalculation up the hierarchy after a new analysis."""
    room = db.query(Room).get(room_id)
    if not room:
        return
    recalc_room(room_id, db)
    unit = room.unit
    if unit:
        recalc_unit(unit.id, db)
        floor = unit.floor
        if floor:
            recalc_floor(floor.id, db)


def build_dashboard(project_id: str, db: Session) -> dict:
    """Build full hierarchical progress dict for executive dashboard."""
    project = db.query(Project).get(project_id)
    if not project:
        return {}

    floors_out = []
    all_floor_pcts = []

    for floor in sorted(project.floors, key=lambda f: f.floor_number):
        units_out = []
        for unit in floor.units:
            rooms_out = []
            for room in unit.rooms:
                latest = (
                    db.query(AIAnalysis)
                    .filter(AIAnalysis.room_id == room.id)
                    .order_by(AIAnalysis.analysed_at.desc())
                    .first()
                )
                rooms_out.append({
                    "room_id": room.id,
                    "room_name": room.name,
                    "pct": room.progress_pct,
                    "components": latest.components if latest else None,
                    "change_flag": latest.change_flag if latest else None,
                })
            units_out.append({
                "unit_id": unit.id,
                "unit_number": unit.unit_number,
                "pct": unit.progress_pct,
                "rooms": rooms_out,
            })
        floors_out.append({
            "floor_id": floor.id,
            "floor_number": floor.floor_number,
            "label": floor.label,
            "pct": floor.progress_pct,
            "units": units_out,
        })
        all_floor_pcts.append(floor.progress_pct)

    overall = round(
        sum(all_floor_pcts) / len(all_floor_pcts), 1
    ) if all_floor_pcts else 0.0

    # Count delayed rooms (stalled or rework flags in latest analyses)
    delayed = (
        db.query(AIAnalysis)
        .filter(AIAnalysis.change_flag.in_(["stalled", "rework"]))
        .count()
    )

    return {
        "project_id": project.id,
        "project_name": project.name,
        "overall_pct": overall,
        "floors": floors_out,
        "active_delays": delayed,
        "est_completion": None,
        "weekly_trend": [],
    }
