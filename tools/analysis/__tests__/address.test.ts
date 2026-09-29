// 人の呼び方（名前＋敬称）の取り出しのテスト
import { describe, expect, it } from 'vitest';
import { HONORIFIC } from '../address.ts';

const terms = (s: string) => [...s.matchAll(HONORIFIC)].map((m) => m[0]);

describe('呼び方の取り出し', () => {
  it('漢字の呼び名の頭の「お」「ご」を含める', () => {
    expect(terms('‥‥お姉ちゃん！')).toEqual(['お姉ちゃん']);
    expect(terms('あの、お兄さん。')).toEqual(['お兄さん']);
    expect(terms('はい、ご主人さま。')).toEqual(['ご主人さま']);
    expect(terms('それはお父さんの')).toEqual(['お父さん']);
  });

  it('「お」の無い呼び名とは区別する', () => {
    expect(terms('姉ちゃん！')).toEqual(['姉ちゃん']);
    expect(terms('兄さん、')).toEqual(['兄さん']);
    expect(terms('姉ちゃんとお姉ちゃん')).toEqual(['姉ちゃん', 'お姉ちゃん']);
  });

  it('ひらがなの助詞の後でも「お」から取る', () => {
    expect(terms('わたしのお姉ちゃんは')).toEqual(['お姉ちゃん']);
    expect(terms('きれいなお姉さん')).toEqual(['お姉さん']);
  });

  it('カタカナの呼び名の頭の「お」も含める', () => {
    expect(terms('、おジイさん')).toEqual(['おジイさん']);
    expect(terms('いたおニイさん')).toEqual(['おニイさん']);
  });

  it('ひらがなだけの呼び名', () => {
    expect(terms('、おねえちゃん')).toEqual(['おねえちゃん']);
    expect(terms('わたしのおかあさん')).toEqual(['おかあさん']);
    expect(terms('たちなおれないほどの')).toEqual([]);
  });

  it('名前＋敬称はそのまま取る', () => {
    expect(terms('成歩堂さん！')).toEqual(['成歩堂さん']);
    expect(terms('ナルホドくん、')).toEqual(['ナルホドくん']);
    expect(terms('御剣検事')).toEqual(['御剣検事']);
  });
});
