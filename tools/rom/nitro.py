"""DS 標準の圧縮形式（LZ77 = 0x10、LZ11 = 0x11、RLE = 0x30）の展開。

どの関数も、データ d の位置 p から展開して (展開したバイト列, 読んだバイト数) を返す。
"""
import struct

def lz10(d, p):
    """DS LZ77 (0x10)。(展開したデータ, 読んだバイト数) を返す"""
    assert d[p]==0x10
    size=struct.unpack_from('<I',d,p)[0]>>8; q=p+4; out=bytearray()
    while len(out)<size:
        flags=d[q]; q+=1
        for bit in range(8):
            if len(out)>=size: break
            if flags & (0x80>>bit):
                b1,b2=d[q],d[q+1]; q+=2
                n=(b1>>4)+3; disp=((b1&0xf)<<8|b2)+1
                for _ in range(n): out.append(out[-disp])
            else:
                out.append(d[q]); q+=1
    return bytes(out[:size]), q-p
def lz11(d, p):
    """LZ11 (0x11)"""
    assert d[p]==0x11
    size=struct.unpack_from('<I',d,p)[0]>>8; q=p+4; out=bytearray()
    while len(out)<size:
        flags=d[q]; q+=1
        for bit in range(8):
            if len(out)>=size: break
            if flags & (0x80>>bit):
                b=d[q]; ind=b>>4
                if ind==0:
                    n=((b&0xf)<<4|d[q+1]>>4)+0x11; disp=((d[q+1]&0xf)<<8|d[q+2])+1; q+=3
                elif ind==1:
                    n=((b&0xf)<<12|d[q+1]<<4|d[q+2]>>4)+0x111; disp=((d[q+2]&0xf)<<8|d[q+3])+1; q+=4
                else:
                    n=ind+1; disp=((b&0xf)<<8|d[q+1])+1; q+=2
                for _ in range(n): out.append(out[-disp])
            else:
                out.append(d[q]); q+=1
    return bytes(out[:size]), q-p
def rle(d, p):
    """RLE (0x30)"""
    assert d[p]==0x30
    size=struct.unpack_from('<I',d,p)[0]>>8; q=p+4; out=bytearray()
    while len(out)<size:
        f=d[q]; q+=1
        if f&0x80:
            n=(f&0x7f)+3; out+=bytes([d[q]])*n; q+=1
        else:
            n=(f&0x7f)+1; out+=d[q:q+n]; q+=n
    return bytes(out[:size]), q-p
COMPRESSION_TYPES = (0x10, 0x11, 0x30)


def decompress(d, p):
    """先頭の 1 バイトで形式を判断して展開する"""
    t=d[p]
    return {0x10:lz10,0x11:lz11,0x30:rle}[t](d,p)
