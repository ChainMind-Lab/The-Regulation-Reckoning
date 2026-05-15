from __future__ import annotations

from pathlib import Path
from typing import Any


class StellarMetricLoader:
    """A lightweight loader for Stellar on-chain and policy metric sources."""

    def __init__(self, source_dir: Path) -> None:
        self.source_dir = source_dir

    def list_sources(self) -> list[Path]:
        return sorted(self.source_dir.glob('*.json'))

    def load(self, source_path: Path) -> dict[str, Any]:
        with source_path.open('r', encoding='utf-8') as handle:
            return {}  # Placeholder for loader logic


class StellarMetricsETL:
    """Extract, transform, and load Stellar metric and policy signal records."""

    def __init__(self, dataset: StellarMetricLoader) -> None:
        self.dataset = dataset

    def extract(self) -> list[dict[str, Any]]:
        return [self.dataset.load(path) for path in self.dataset.list_sources()]

    def transform(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return records

    def load(self, records: list[dict[str, Any]], output_path: Path) -> None:
        output_path.write_text('[]', encoding='utf-8')
