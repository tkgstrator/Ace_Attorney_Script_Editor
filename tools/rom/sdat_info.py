"""SDAT の INFO（各シーケンスが使うバンク・音量・優先度・プレイヤー）と FAT を読む。

INFO の表:
    シーケンス: u16 ファイル番号, u16 ?, u16 バンク, u8 音量, u8 チャンネルの優先度, u8 プレイヤーの優先度, u8 プレイヤー
    バンク:     u16 ファイル番号, u16 ?, u16 × 4 波形書庫（0xFFFF = 無し）
    波形書庫:   u16 ファイル番号
    プレイヤー: u8 同時に鳴らせる数, u8 ?, u16 使えるチャンネル（ビット。0 = すべて）, u32 ヒープ
同じファイルを複数のシーケンスが使うこともある（例: SE01A は SE006 と同じ SSEQ）。
"""
import struct
from dataclasses import dataclass

from sound import _names


@dataclass
class SeqInfo:
    index: int          # SDAT の中のシーケンスの番号
    name: str
    file_id: int
    bank: int
    volume: int
    channel_prio: int
    player_prio: int
    player: int


class Sdat:
    def __init__(self, s: bytes):
        if s[:4] != b'SDAT':
            raise ValueError('SDAT ではありません')
        self.s = s
        symb, _, info, _, fat, _ = struct.unpack_from('<6I', s, 0x10)
        self._symb, self._info = symb, info
        n = struct.unpack_from('<I', s, fat + 8)[0]
        self.fat = [struct.unpack_from('<II', s, fat + 12 + 16 * i) for i in range(n)]
        self.seqs: list[SeqInfo] = []
        names = _names(s, symb, 0)
        for i, off in self._records(0):
            fid, _u, bank, vol, cpr, ppr, ply = struct.unpack_from('<HHHBBBB', s, info + off)
            name = names[i] if i < len(names) and names[i] else f'SEQ_{i:03}'
            self.seqs.append(SeqInfo(i, name, fid, bank, vol, cpr, ppr, ply))
        self.bank_names = _names(s, symb, 2)
        self.wavearc_names = _names(s, symb, 3)
        self.banks: dict[int, tuple[int, list[int]]] = {}
        for i, off in self._records(2):
            fid, _u, *wa = struct.unpack_from('<HH4H', s, info + off)
            self.banks[i] = (fid, list(wa))
        self.wavearcs: dict[int, int] = {}
        for i, off in self._records(3):
            self.wavearcs[i] = struct.unpack_from('<H', s, info + off)[0]
        self.players: dict[int, tuple[int, int]] = {}
        for i, off in self._records(4):
            max_seq, _p, mask, _heap = struct.unpack_from('<BBHI', s, info + off)
            self.players[i] = (max_seq, mask)

    def _records(self, kind: int):
        base = self._info + struct.unpack_from('<I', self.s, self._info + 8 + 4 * kind)[0]
        n = struct.unpack_from('<I', self.s, base)[0]
        for i in range(n):
            off = struct.unpack_from('<I', self.s, base + 4 + 4 * i)[0]
            if off:
                yield i, off

    def file(self, fid: int) -> bytes:
        off, size = self.fat[fid]
        return self.s[off:off + size]

    def bank_name(self, i: int) -> str:
        return self.bank_names[i] if i < len(self.bank_names) and self.bank_names[i] else f'bank_{i}'

    def wavearc_name(self, i: int) -> str:
        n = self.wavearc_names
        return n[i] if i < len(n) and n[i] else f'wavearc_{i}'
