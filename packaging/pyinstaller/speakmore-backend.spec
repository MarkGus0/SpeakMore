# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all
from pathlib import Path


ROOT = Path(SPECPATH).resolve().parents[1]
datas = []
binaries = []
hiddenimports = []

for package_name in [
    "funasr",
    "modelscope",
    "transformers",
    "torch",
    "torchaudio",
    "kaldiio",
    "omegaconf",
    "hydra",
]:
    package_datas, package_binaries, package_hiddenimports = collect_all(package_name)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

datas += [
    (str(ROOT / "server" / "index.html"), "."),
    (str(ROOT / "shared" / "translation-target-languages.json"), "shared"),
]

a = Analysis(
    [str(ROOT / "server" / "main.py")],
    pathex=[str(ROOT), str(ROOT / "server")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="speakmore-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
