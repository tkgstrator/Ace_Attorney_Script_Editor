"""試聴用の index.html（外部のファイルを使わない 1 枚の HTML）を作る。

ループする曲は「ループ再生」で Web Audio の AudioBufferSourceNode（loopStart / loopEnd）を使い、
サンプル単位で継ぎ目なく繰り返す。file:// で開くとブラウザーによっては読み込み（fetch）が
拒まれるので、そのときは rendered/ で `python3 -m http.server` を動かして開く。
"""
import html
import math


def _fmt(sec) -> str:
    if sec is None or (isinstance(sec, float) and not math.isfinite(sec)):
        return '-'
    return f'{int(sec // 60)}:{sec % 60:06.3f}'


def _notes(e: dict) -> list[str]:
    note = []
    if e['duration'] <= 0.02:
        note.append('音符の無い空のシーケンス')
    if e.get('usesRandom'):
        note.append('乱数あり（実機と同じにはならない）')
    if e.get('capped'):
        note.append('鳴り続ける音（ゲームが止める）。上限で打ち切り')
    if e.get('missingWaves'):
        note.append('波形が無い音あり')
    if e['check']['clipped']:
        note.append(f'クリップ {e["check"]["clipped"]} サンプル')
    uses = e.get('scriptUses') or {}
    if uses:
        note.append('台本: ' + ', '.join(f'{k} {v} 回' for k, v in sorted(uses.items())))
    return note


def page(items: list[dict]) -> str:
    rows = []
    for e in items:
        lp = e.get('loop')
        src = e.get('ogg') or e['wav']
        seam = lp.get('seamRms') if lp else None
        seam_s = '' if seam is None or not math.isfinite(seam) else f'{seam:.1e}'
        btn = (f'<button class="lp" data-src="{html.escape(e["wav"])}" data-ls="{lp["start"]}"'
               f' data-le="{lp["end"]}">ループ再生</button>' if lp else '')
        rows.append(
            f'<tr data-cat="{e["category"]}"><td>{e["sdatIndex"]}</td>'
            f'<td><b>{html.escape(e["name"])}</b><div class="sub">{html.escape(e.get("bankName", ""))}'
            f' / 音量 {e["volume"]}</div></td>'
            f'<td>{_fmt(e["duration"])}</td><td>{_fmt(lp["start"]) if lp else "-"}</td>'
            f'<td>{_fmt(lp["end"]) if lp else "-"}</td><td>{seam_s}</td>'
            f'<td><audio controls preload="none" src="{html.escape(src)}"></audio> {btn}'
            f' <a href="{html.escape(e["wav"])}">wav</a></td>'
            f'<td class="sub">{html.escape("、".join(_notes(e)))}</td></tr>')
    return _PAGE.replace('%ROWS%', '\n'.join(rows)).replace('%COUNT%', str(len(items)))


_PAGE = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BGM・効果音の試聴</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#222;--line:#ddd;--sub:#777;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#1b1b1d;--fg:#eee;--line:#333;--sub:#9a9a9a;--accent:#7aa2ff}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 8px}
table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:middle}
th{position:sticky;top:0;background:var(--bg)}
.sub{color:var(--sub);font-size:12px}
audio{height:32px;vertical-align:middle;max-width:100%}
button{font:inherit;padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg);cursor:pointer}
button.on{border-color:var(--accent);color:var(--accent)}
nav{margin:8px 0 12px;display:flex;gap:6px;flex-wrap:wrap}.wrap{overflow-x:auto}
#msg{color:var(--accent)}
</style></head><body>
<h1>BGM・効果音（%COUNT% 個）</h1>
<p class="sub">SSEQ を DS の音源と同じ計算で書き出したもの（tools/rom/sseq_render.py）。32728 Hz。
ループする曲のファイルは「前奏 + ループ 2 回」で、「ループ再生」を押すと WAV の loopStart〜loopEnd を
継ぎ目なく繰り返す（file:// で読めないときは、このフォルダーで <code>python3 -m http.server</code> を動かして開く）。
継ぎ目の差 = ループの始まりと終わりの直後 0.05 秒の違い（0 なら同一）。</p>
<nav><button data-f="all">すべて</button><button data-f="bgm">BGM</button><button data-f="se">効果音</button>
<button id="stop">ループ再生を止める</button><span id="msg"></span></nav>
<div class="wrap"><table><thead><tr><th>番号</th><th>名前</th><th>長さ</th><th>ループ開始</th><th>ループ終わり</th>
<th>継ぎ目の差</th><th>再生</th><th>メモ</th></tr></thead><tbody>
%ROWS%
</tbody></table></div>
<script>
const $$=s=>document.querySelectorAll(s);
$$('nav button[data-f]').forEach(b=>b.onclick=()=>{
  $$('tbody tr').forEach(r=>{r.style.display=(b.dataset.f==='all'||r.dataset.cat===b.dataset.f)?'':'none'})});
let ctx=null, node=null, cur=null;
const msg=t=>document.getElementById('msg').textContent=t||'';
function stop(){ if(node){try{node.stop()}catch(e){} node=null;} if(cur){cur.classList.remove('on');cur=null;} }
document.getElementById('stop').onclick=stop;
$$('button.lp').forEach(b=>b.onclick=async()=>{
  const again=cur===b; stop(); if(again) return;
  $$('audio').forEach(a=>a.pause());
  try{
    ctx=ctx||new AudioContext();
    msg('読み込み中…');
    const buf=await ctx.decodeAudioData(await (await fetch(b.dataset.src)).arrayBuffer());
    node=ctx.createBufferSource(); node.buffer=buf; node.loop=true;
    node.loopStart=+b.dataset.ls; node.loopEnd=+b.dataset.le;
    node.connect(ctx.destination); node.start(); cur=b; b.classList.add('on'); msg('');
  }catch(e){ msg('読み込めませんでした（'+e+'）。python3 -m http.server で開いてください'); }
});
$$('audio').forEach(a=>a.addEventListener('play',()=>{ stop();
  $$('audio').forEach(o=>{if(o!==a)o.pause()})}));
</script></body></html>
"""
