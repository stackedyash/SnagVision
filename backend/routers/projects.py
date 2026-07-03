from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import get_db
from models.database import Project, Floor, Unit, Room
from schemas.models import (
    ProjectCreate, ProjectOut, FloorCreate, FloorOut,
    UnitCreate, RoomCreate, RoomOut,
)
from services.progress_service import build_dashboard
from typing import List

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Projects ─────────────────────────────────────────────────────────────────

@router.post("", response_model=ProjectOut, status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.get("", response_model=List[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).all()


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.get("/{project_id}/dashboard")
def get_dashboard(project_id: str, db: Session = Depends(get_db)):
    return build_dashboard(project_id, db)


# ── Floors ────────────────────────────────────────────────────────────────────

@router.post("/{project_id}/floors", response_model=FloorOut, status_code=201)
def add_floor(project_id: str, data: FloorCreate, db: Session = Depends(get_db)):
    p = db.query(Project).get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    f = Floor(project_id=project_id, **data.model_dump())
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.get("/{project_id}/floors", response_model=List[FloorOut])
def list_floors(project_id: str, db: Session = Depends(get_db)):
    return db.query(Floor).filter(Floor.project_id == project_id).all()


# ── Units ─────────────────────────────────────────────────────────────────────

@router.post("/floors/{floor_id}/units", status_code=201)
def add_unit(floor_id: str, data: UnitCreate, db: Session = Depends(get_db)):
    f = db.query(Floor).get(floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")
    u = Unit(floor_id=floor_id, **data.model_dump())
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id": u.id, "unit_number": u.unit_number, "progress_pct": u.progress_pct}


@router.get("/floors/{floor_id}/units")
def list_units(floor_id: str, db: Session = Depends(get_db)):
    units = db.query(Unit).filter(Unit.floor_id == floor_id).all()
    return [{"id": u.id, "unit_number": u.unit_number, "progress_pct": u.progress_pct} for u in units]


# ── Rooms ─────────────────────────────────────────────────────────────────────

@router.post("/units/{unit_id}/rooms", response_model=RoomOut, status_code=201)
def add_room(unit_id: str, data: RoomCreate, db: Session = Depends(get_db)):
    u = db.query(Unit).get(unit_id)
    if not u:
        raise HTTPException(404, "Unit not found")
    r = Room(unit_id=unit_id, **data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.get("/units/{unit_id}/rooms", response_model=List[RoomOut])
def list_rooms(unit_id: str, db: Session = Depends(get_db)):
    return db.query(Room).filter(Room.unit_id == unit_id).all()
