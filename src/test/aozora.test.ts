import test from 'node:test';
import assert from 'node:assert/strict';
import { aozoraFirstPublication, aozoraUrl, findAozoraXhtml, isAozoraXhtml } from '../aozora.js';

test('図書カードからXHTML版URLを抽出する', () => {
  const card = aozoraUrl('https://www.aozora.gr.jp/cards/000879/card127.html#download');
  const xhtml = findAozoraXhtml('<a href="./files/127_15260.html">いますぐXHTML版で読む</a>', card);
  assert.equal(xhtml.href, 'https://www.aozora.gr.jp/cards/000879/files/127_15260.html');
  assert.equal(isAozoraXhtml(xhtml), true);
});

test('青空文庫以外のURLと別パスを拒否する', () => {
  assert.throws(() => aozoraUrl('https://example.com/cards/1/card1.html'));
  assert.throws(() => aozoraUrl('https://www.aozora.gr.jp/index.html'));
});

test('図書カード内の外部HTMLリンクを採用しない', () => {
  const card = aozoraUrl('https://www.aozora.gr.jp/cards/000879/card127.html');
  assert.throws(() => findAozoraXhtml('<a href="https://example.com/files/fake.html">外部</a>', card));
});

test('図書カードから初出を抽出する', () => {
  const html = '<table><tr><td><font size="-1">初出：</font></td><td><span>「帝国文学」1915（大正4）年11月号</span></td></tr></table>';
  assert.equal(aozoraFirstPublication(html), '「帝国文学」1915（大正4）年11月号');
  assert.equal(aozoraFirstPublication('<table></table>'), '');
});
