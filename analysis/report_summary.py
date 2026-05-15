from __future__ import annotations

from pathlib import Path


def generate_summary(chapters_dir: Path, output_path: Path) -> None:
    """Build a summary report from chapter content."""
    overview = []
    for chapter_file in sorted(chapters_dir.glob('*.md')):
        overview.append(f'- {chapter_file.stem}')
    output_path.write_text('\n'.join(['# Summary', *overview]), encoding='utf-8')
