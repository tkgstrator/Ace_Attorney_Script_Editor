"""Rust 版（crates/aa-rom）が埋め込む「ROM から読まない固定の表」を JSON に書き出す。

    python3 tools/rom/export_static_rs.py      # crates/aa-rom/data/static.json を作り直す

中身は tools/rom/*.py に直接書かれている表（命令の説明・名前・ラベルなど）だけで、ROM の中身は含まない。
Python 側の表を直したら、これを実行して Rust 側に反映する。
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ds_fx  # noqa: E402
import nds_sound_tables  # noqa: E402
import script_format  # noqa: E402
import sseq_audition  # noqa: E402
import tbl_anims  # noqa: E402
import tbl_chars  # noqa: E402
import tbl_court  # noqa: E402
import tbl_invest  # noqa: E402
import tbl_invest_rules  # noqa: E402
import tbl_record  # noqa: E402
import tbl_script  # noqa: E402


def keys_to_str(d: dict) -> dict:
    return {str(k): v for k, v in d.items()}


def main() -> None:
    doc = {
        'script_format': {str(k): [v[0], v[1]] for k, v in sorted(script_format.OPCODES.items())},
        'opcodes': tbl_script.opcodes_json(),
        'ds_fx': keys_to_str(ds_fx.DS_FX),
        'invest_about': tbl_invest.__doc__.strip().splitlines()[0],
        'invest_rules': tbl_invest_rules.RULES,
        'invest_examine_cond': keys_to_str(tbl_invest.EXAMINE_COND),
        'court_doc': tbl_court.DOC,
        'chars_names': keys_to_str(tbl_chars.NAMES),
        'record_nametag_text': tbl_record.NAMETAG_TEXT,
        'record_text': {str(k): list(v) for k, v in tbl_record.TEXT.items()},
        'anims_label': keys_to_str(tbl_anims.LABEL),
        'audition_page': sseq_audition._PAGE,
        # 浮動小数点の計算で作る表は、環境（wasm など）で結果が変わらないように値のまま埋め込む
        'sound_tables': {'decibel_square': nds_sound_tables.DECIBEL_SQUARE,
                         'pitch_table': nds_sound_tables.PITCH_TABLE,
                         'volume_registers': [list(v) for v in nds_sound_tables.VOLUME_REGISTERS]},
    }
    out = HERE.parents[1] / 'crates/aa-rom/data/static.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'書き出しました: {os.path.relpath(out)}')


if __name__ == '__main__':
    main()
