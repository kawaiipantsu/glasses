"""Package the SDK authoring sources with their independent edition metadata."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
target = root / 'output/pdf/Glasses-Developer-Manual-Companion.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for folder in ['docs/developer-manual', 'LICENSES']:
        for file in sorted((root/folder).rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts and not file.name.startswith('.'):
                archive.write(file, str(file.relative_to(root)))
    for name in ['LICENSE', 'version.json', 'docs/VERSIONING.md', 'docs/BUILD_HISTORY.json']:
        archive.write(root/name, name)
print('Built versioned SDK source companion')
