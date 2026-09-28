# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""ROM から画像・音声などの素材を取り出し、参考資料として assets/extracted/ に書き出す（ROM は変更しない）。

    uv run tools/rom/extract_assets.py <rom.nds>
    uv run tools/rom/extract_assets.py <rom.nds> --only archives,tail
    uv run tools/rom/extract_assets.py <rom.nds> --sdatxtract /private/tmp/aa-build/sdatxtract/build/sdatxtract

手順（--only で選べる）:
    files     NitroFS のファイルをそのまま files/ に書き出す
    archives  data.bin の先頭の画像アーカイブ 8 個を data/archiveN/ に書き出す
    tail      それより後ろの領域を data/tail/ に書き出す
    desks     法廷の机（OBJ）を data/desks/ に書き出す
    sound     sound_data.sdat を sound/ に書き出す（sdatxtract があれば変換も行う）

フォント（font/）と台本（mes_all.bin）は別のスクリプトで扱うので、ここでは触らない。
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ex_archives  # noqa: E402
import ex_desks  # noqa: E402
import ex_tail  # noqa: E402
import sound  # noqa: E402
from nds import arm9, list_files  # noqa: E402

STEPS = ('files', 'archives', 'tail', 'desks', 'sound')
DEFAULT_OUT = Path(__file__).resolve().parents[2] / 'assets' / 'extracted'


def main() -> None:
    ap = argparse.ArgumentParser(description='ROM から素材を取り出す')
    ap.add_argument('rom', help='ROM イメージ（.nds）')
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT, help='書き出し先（既定: assets/extracted）')
    ap.add_argument('--only', default=','.join(STEPS), help=f'行う手順（カンマ区切り、{"/".join(STEPS)}）')
    ap.add_argument('--no-raw', action='store_true', help='画像にできたものの展開済み .bin を書き出さない')
    ap.add_argument('--no-sheet', action='store_true', help='一覧画像（_sheet.png）を作らない')
    ap.add_argument('--sdatxtract', help='sdatxtract の実行ファイル（無ければ SDAT の分割だけ行う）')
    args = ap.parse_args()

    steps = [s for s in args.only.split(',') if s]
    for s in steps:
        if s not in STEPS:
            sys.exit(f'知らない手順です: {s}')
    rom = Path(args.rom).read_bytes()
    files = {f.path: rom[f.start:f.end] for f in list_files(rom)}
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    if 'files' in steps:
        print('files: NitroFS のファイルを書き出します')
        for path, body in files.items():
            dst = out / 'files' / path
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(body)
        print(f'  {len(files)} 個')

    data = files['data.bin']
    if 'archives' in steps:
        print('archives: data.bin の先頭の画像アーカイブを書き出します')
        ex_archives.export(data, out / 'data', raw=not args.no_raw, sheets=not args.no_sheet)

    if 'tail' in steps:
        print('tail: data.bin の後半を書き出します')
        ex_tail.export(data, arm9(rom), out / 'data' / 'tail', raw=not args.no_raw, sheets=not args.no_sheet)

    if 'desks' in steps:
        print('desks: 法廷の机を書き出します')
        ex_desks.export(data, arm9(rom), out / 'data' / 'desks')

    if 'sound' in steps:
        print('sound: sound_data.sdat を書き出します')
        sound.export(files['sound_data.sdat'], out / 'sound', args.sdatxtract)

    print(f'完了（{time.time() - t0:.0f} 秒）: {out}')


if __name__ == '__main__':
    main()
