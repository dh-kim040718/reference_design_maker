"""Local application-data snapshots and restore drills. Never replay AI jobs."""
import argparse
import hashlib
import json
import re
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import MetaData, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.core.settings import REPOSITORY_ROOT, get_settings
from app.db.base import Base
from app.db.models import Generation, GenerationBudget, Reference, now
from app.db.session import build_engine

SCHEMA = "0009_project_concepts"
FORMAT = "rdm-app-backup-v1"
ROOT = REPOSITORY_ROOT / ".phase6-backups"


def engine_for(url):
    # Keep the password in memory only; SQLAlchemy URL.__str__ masks it.
    return build_engine(url.render_as_string(hide_password=False))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def encode(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or UTC).astimezone(UTC).isoformat()
    if isinstance(value, (date, UUID)):
        return str(value)
    return value


def table_rows(connection, table):
    rows = connection.execute(select(table).order_by(*table.primary_key.columns)).mappings()
    return [{key: encode(value) for key, value in row.items()} for row in rows]


def snapshot(engine, destination):
    """Read every app table from one consistent transaction; refuse unknown schemas."""
    with engine.connect() as connection:
        if engine.dialect.name == "postgresql":
            connection = connection.execution_options(isolation_level="REPEATABLE READ")
        with connection.begin():
            if engine.dialect.name == "postgresql":
                connection.execute(text("SET TRANSACTION READ ONLY"))
            elif engine.dialect.name == "sqlite":
                connection.exec_driver_sql("BEGIN")
            version = connection.scalar(text("SELECT version_num FROM alembic_version"))
            if version not in {"0007_safe_diagnostics", "0008_budget_reservations", SCHEMA}:
                raise ValueError("Unsupported application schema")
            metadata = Base.metadata
            if version != SCHEMA:
                names = set(Base.metadata.tables)
                if version == "0007_safe_diagnostics":
                    names.remove("generation_budget")
                metadata = MetaData()
                metadata.reflect(bind=connection, only=sorted(names))
            tables = {table.name: table_rows(connection, table)
                      for table in metadata.sorted_tables}
    data = {"format": FORMAT, "schema": version, "created_at": now().isoformat(),
            "scope": "app_tables_only_not_supabase_auth", "tables": tables}
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as output:
        json.dump({"sha256": digest(data), "snapshot": data}, output, ensure_ascii=False)
    return {"path": str(destination), "sha256": digest(data),
            "counts": {name: len(rows) for name, rows in tables.items()}}


def load_snapshot(path):
    if Path(path).stat().st_size > 256 * 1024 * 1024:
        raise ValueError("Snapshot exceeds local restore limit")
    try:
        package = json.loads(Path(path).read_text("utf-8"))
        data = package["snapshot"]
        supported = {"0007_safe_diagnostics", "0008_budget_reservations", SCHEMA}
        if (package["sha256"] != digest(data) or data["format"] != FORMAT
                or data["schema"] not in supported):
            raise ValueError("Integrity or version mismatch")
        if data["schema"] == "0007_safe_diagnostics":
            # In-memory upgrade only; retain the original archive and unknown historical charges.
            data["tables"]["generation_budget"] = []
            for row in data["tables"]["generations"]:
                row["reserved_micro_usd"] = None
            data["restored_from_schema"] = data["schema"]
            data["schema"] = "0008_budget_reservations"
        if data["schema"] == "0008_budget_reservations":
            kinds = {row["id"]: row["project_id"] for row in data["tables"]["deliverable_types"]}
            references = {row["id"]: kinds[row["deliverable_type_id"]]
                          for row in data["tables"]["references"]}
            for row in data["tables"]["projects"]:
                row.setdefault("brief", "")
            for row in data["tables"]["generations"]:
                row.setdefault("project_id", references.get(row["reference_id"]))
                row.setdefault("scope", "reference")
                row.setdefault("project_snapshot_json", None)
            data.setdefault("restored_from_schema", data["schema"])
            data["schema"] = SCHEMA
        expected = {table.name for table in Base.metadata.sorted_tables}
        if set(data["tables"]) != expected:
            raise ValueError("Application table set mismatch")
        for table in Base.metadata.sorted_tables:
            columns = {column.name for column in table.columns}
            if any(set(row) != columns for row in data["tables"][table.name]):
                raise ValueError("Application column set mismatch")
        return data
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid snapshot") from error


def current_redactions(engine):
    # A current source is required; offline disaster recovery needs a separately managed ledger.
    with engine.connect() as connection:
        deleted = set(str(value) for value in connection.scalars(
            select(Generation.id).where(Generation.deleted_at.is_not(None))))
        previews = {str(row.id): digest(row.preview_url) for row in connection.execute(
            select(Reference.id, Reference.preview_url))}
        ids = {str(value) for value in connection.scalars(select(Generation.id))}
        ledger = connection.scalar(select(GenerationBudget.reserved_micro_usd).where(
            GenerationBudget.id == 1)) or 0
    return {"deleted_generation_ids": deleted, "preview_hashes": previews,
            "current_generation_ids": ids, "budget_reserved_floor": ledger}


def decode_row(table, row):
    result = {}
    for column in table.columns:
        value = row[column.name]
        if value is not None:
            kind = column.type.python_type
            if kind is UUID:
                value = UUID(value)
            elif kind is datetime:
                value = datetime.fromisoformat(value)
            elif kind is date:
                value = date.fromisoformat(value)
        result[column.name] = value
    return result


def restore(data, target, *, redactions):
    """Target must be an empty, dedicated local restore DB. Never replace existing tables."""
    url = target.url
    if url.get_backend_name() == "postgresql":
        if (url.host not in {"localhost", "127.0.0.1", "::1"}
                or not re.fullmatch(r"rdm_restore_[a-z0-9_]+", url.database or "")):
            raise ValueError("Dedicated local restore database required")
    elif url.get_backend_name() == "sqlite":
        if url.database not in {None, "", ":memory:"} and not Path(url.database).name.startswith(
            "rdm_restore_"):
            raise ValueError("Dedicated SQLite restore target required")
    else:
        raise ValueError("Unsupported restore database")
    if inspect(target).get_table_names():
        raise ValueError("Restore target is not empty")
    snapshot_jobs = {row["id"] for row in data["tables"]["generations"]}
    if redactions["current_generation_ids"] - snapshot_jobs:
        raise ValueError("Snapshot predates paid reservations; create a fresh snapshot")
    expected = {}
    redacted_images = unknown_jobs = 0
    restored_at = now()
    for table in Base.metadata.sorted_tables:
        rows = []
        for original in data["tables"][table.name]:
            row = dict(original)
            if table.name == "generations":
                if row["deleted_at"] or row["id"] in redactions["deleted_generation_ids"]:
                    redacted_images += bool(row["result_image"])
                    row.update(result_image=None,
                               deleted_at=row["deleted_at"] or restored_at.isoformat())
                if row["status"] in {"queued", "processing"}:
                    row.update(status="unknown", error_code="OUTCOME_UNKNOWN",
                               result_image=None, updated_at=restored_at.isoformat())
                    unknown_jobs += 1
            if table.name == "references" and row["preview_url"]:
                current = redactions["preview_hashes"].get(row["id"])
                if current != digest(row["preview_url"]):
                    row.update(preview_url=None, preview_source=None)
                    redacted_images += 1
            rows.append(row)
        expected[table.name] = rows
    ledger_rows = expected["generation_budget"]
    floor = redactions["budget_reserved_floor"]
    if ledger_rows:
        ledger_rows[0]["reserved_micro_usd"] = max(ledger_rows[0]["reserved_micro_usd"], floor)
    elif floor:
        ledger_rows.append({"id": 1, "reserved_micro_usd": floor})
    Base.metadata.create_all(target)
    with target.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if expected[table.name]:
                connection.execute(table.insert(), [decode_row(table, row)
                                                     for row in expected[table.name]])
        connection.execute(text(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
        connection.execute(text("INSERT INTO alembic_version VALUES (:version)"),
                           {"version": SCHEMA})
        for table in Base.metadata.sorted_tables:
            actual = table_rows(connection, table)
            # Canonical row order is independent of DB UUID/date representations.
            if sorted(map(canonical, actual)) != sorted(map(canonical, expected[table.name])):
                raise ValueError("Restored data verification mismatch")
    return {"verified": True, "counts": {name: len(rows) for name, rows in expected.items()},
            "redacted_images": redacted_images, "active_jobs_marked_unknown": unknown_jobs,
            "schema": SCHEMA, "provider_calls": 0}


def local_url():
    url = make_url(get_settings().database_url)
    if url.get_backend_name() != "postgresql" or url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("CLI supports the local PostgreSQL app only")
    return url


def create_target(source_url, name):
    if not re.fullmatch(r"rdm_restore_[a-z0-9_]+", name) or name == source_url.database:
        raise ValueError("Dedicated restore name required")
    admin = engine_for(source_url.set(database="postgres"))
    try:
        with admin.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            exists = connection.scalar(text("SELECT 1 FROM pg_database WHERE datname=:name"),
                                       {"name": name})
            if exists:
                raise ValueError("Restore database already exists; no overwrite")
            connection.execute(text('CREATE DATABASE "' + name + '"'))
    finally:
        admin.dispose()
    return engine_for(source_url.set(database=name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("snapshot", "drill", "restore"))
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
    source = target = None
    try:
        source_url = local_url()
        source = engine_for(source_url)
        run_id = now().strftime("%Y%m%d_%H%M%S") + "_" + uuid4().hex[:8]
        folder = ROOT / run_id
        folder.mkdir(parents=True, exist_ok=False)
        if args.action == "restore":
            if args.snapshot is None:
                raise ValueError("Snapshot path required")
            backup_path = args.snapshot
            report = {"snapshot": str(backup_path)}
        else:
            backup_path = folder / "app-snapshot.json"
            report = {"snapshot": snapshot(source, backup_path)}
        if args.action != "snapshot":
            data = load_snapshot(backup_path)
            redactions = current_redactions(source)
            target_name = "rdm_restore_" + run_id
            target = create_target(source_url, target_name)
            report.update(target_database=target_name, restore=restore(
                data, target, redactions=redactions))
        (folder / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
        print(json.dumps({"action": args.action, "report": str(folder / "report.json"),
                          "verified": report.get("restore", {}).get("verified"),
                          "provider_calls": 0}))
    except (SQLAlchemyError, ValueError, OSError):
        raise SystemExit(
            "Backup/restore stopped; no overwrite. Check local DB/schema/path.") from None
    finally:
        if target is not None:
            target.dispose()
        if source is not None:
            source.dispose()


if __name__ == "__main__":
    main()
