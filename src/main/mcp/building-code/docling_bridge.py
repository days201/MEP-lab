#!/usr/bin/env python3
"""Local Docling CLI bridge for MEP Lab building-code ingestion."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from importlib import metadata
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a document with local Docling.")
    parser.add_argument("document_path", help="Path to a local PDF or supported document file.")
    args = parser.parse_args()

    try:
        from docling.document_converter import DocumentConverter
    except ModuleNotFoundError as exc:
        print(f"ModuleNotFoundError: {exc}", file=sys.stderr)
        return 2
    except ImportError as exc:
        print(f"ImportError: {exc}", file=sys.stderr)
        return 2

    diagnostics: list[str] = []
    converter = DocumentConverter()
    conversion = converter.convert(args.document_path)
    document = getattr(conversion, "document", conversion)

    pages: dict[int, list[str]] = defaultdict(list)
    elements: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []

    for index, entry in enumerate(iter_document_items(document), start=1):
        item, level = entry
        element_id = item_id(item, index)
        kind = item_kind(item)
        text = item_text(item, document)
        page_number = item_page_number(item)
        confidence = item_confidence(item)

        if text:
            pages[page_number].append(text)

        elements.append(
            {
                "elementId": element_id,
                "kind": kind,
                "text": text,
                "pageNumber": page_number,
                "level": level if kind == "heading" else None,
                "confidence": confidence,
                "bbox": item_bbox(item),
            }
        )

        if kind == "table":
            tables.append(normalize_table(item, document, element_id, page_number, confidence, diagnostics))

    if not pages:
        exported_text = export_document_text(document)
        if exported_text:
            pages[1].append(exported_text)

    result = {
        "parserName": "docling",
        "parserVersion": docling_version(),
        "pages": [
            {"pageNumber": page_number, "text": "\n\n".join(chunks)}
            for page_number, chunks in sorted(pages.items())
        ],
        "elements": elements,
        "tables": tables,
        "diagnostics": diagnostics,
    }

    print(json.dumps(result, ensure_ascii=False))
    return 0


def iter_document_items(document: Any) -> list[tuple[Any, int | None]]:
    iterate_items = getattr(document, "iterate_items", None)
    if not callable(iterate_items):
        return []

    normalized: list[tuple[Any, int | None]] = []
    for entry in iterate_items():
        if isinstance(entry, tuple):
            item = entry[0]
            level = entry[1] if len(entry) > 1 and isinstance(entry[1], int) else None
        else:
            item = entry
            level = None
        normalized.append((item, level))
    return normalized


def item_id(item: Any, index: int) -> str:
    for attr in ("self_ref", "id", "cref"):
        value = getattr(item, attr, None)
        if value:
            return str(value).strip("#/").replace("/", "-")
    return f"element-{index}"


def item_kind(item: Any) -> str:
    class_name = item.__class__.__name__.lower()
    label = str(getattr(item, "label", "")).lower()
    marker = f"{class_name} {label}"

    if "table" in marker:
        return "table"
    if "section" in marker or "heading" in marker or "title" in marker or "header" in marker:
        return "heading"
    if "picture" in marker or "figure" in marker:
        return "figure"
    if "list" in marker:
        return "list"
    if "text" in marker or "paragraph" in marker:
        return "text"
    return "unknown"


def item_text(item: Any, document: Any) -> str:
    value = getattr(item, "text", None)
    if isinstance(value, str):
        return value

    for method_name in ("export_to_text", "export_to_markdown"):
        method = getattr(item, method_name, None)
        if callable(method):
            try:
                return str(method(document))
            except TypeError:
                return str(method())
            except Exception:
                continue
    return ""


def item_page_number(item: Any) -> int:
    provenance = first_provenance(item)
    page_no = getattr(provenance, "page_no", None)
    return int(page_no) if isinstance(page_no, int) and page_no > 0 else 1


def item_confidence(item: Any) -> float:
    value = getattr(item, "confidence", None)
    if isinstance(value, (int, float)):
        return float(value)

    provenance = first_provenance(item)
    value = getattr(provenance, "confidence", None)
    return float(value) if isinstance(value, (int, float)) else 1.0


def item_bbox(item: Any) -> dict[str, float] | None:
    provenance = first_provenance(item)
    bbox = getattr(provenance, "bbox", None)
    if bbox is None:
        return None

    left = numeric_attr(bbox, "l", "left", "x")
    top = numeric_attr(bbox, "t", "top", "y")
    right = numeric_attr(bbox, "r", "right")
    bottom = numeric_attr(bbox, "b", "bottom")
    width = numeric_attr(bbox, "width", "w")
    height = numeric_attr(bbox, "height", "h")

    if width is None and left is not None and right is not None:
        width = abs(right - left)
    if height is None and top is not None and bottom is not None:
        height = abs(bottom - top)

    if left is None or top is None or width is None or height is None:
        return None
    return {"x": left, "y": top, "width": width, "height": height}


def first_provenance(item: Any) -> Any | None:
    provenance = getattr(item, "prov", None)
    if isinstance(provenance, list) and provenance:
        return provenance[0]
    return None


def numeric_attr(value: Any, *names: str) -> float | None:
    for name in names:
        attr = getattr(value, name, None)
        if isinstance(attr, (int, float)):
            return float(attr)
    return None


def normalize_table(
    item: Any,
    document: Any,
    element_id: str,
    page_number: int,
    confidence: float,
    diagnostics: list[str],
) -> dict[str, Any]:
    columns: list[str] = []
    rows: list[list[str]] = []

    dataframe = export_table_dataframe(item, document, diagnostics)
    if dataframe is not None:
        columns = [str(column) for column in list(dataframe.columns)]
        rows = dataframe.fillna("").astype(str).values.tolist()

    return {
        "elementId": element_id,
        "caption": item_caption(item),
        "pageNumber": page_number,
        "columns": columns,
        "rows": rows,
        "notes": item_notes(item),
        "confidence": confidence,
    }


def export_table_dataframe(item: Any, document: Any, diagnostics: list[str]) -> Any | None:
    method = getattr(item, "export_to_dataframe", None)
    if not callable(method):
        diagnostics.append("Docling table item did not expose export_to_dataframe().")
        return None

    try:
        return method(document)
    except TypeError:
        return method()
    except Exception as exc:
        diagnostics.append(f"Docling table dataframe export failed: {exc}")
        return None


def item_caption(item: Any) -> str:
    captions = getattr(item, "captions", None)
    if isinstance(captions, list) and captions:
        values = [item_text(caption, None) for caption in captions]
        return " ".join(value for value in values if value)
    return str(getattr(item, "caption", "") or "")


def item_notes(item: Any) -> list[str]:
    notes = getattr(item, "notes", None)
    if isinstance(notes, list):
        return [str(note) for note in notes if str(note)]
    return []


def export_document_text(document: Any) -> str:
    for method_name in ("export_to_text", "export_to_markdown"):
        method = getattr(document, method_name, None)
        if callable(method):
            try:
                return str(method())
            except Exception:
                continue
    return ""


def docling_version() -> str:
    try:
        return metadata.version("docling")
    except metadata.PackageNotFoundError:
        return "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
