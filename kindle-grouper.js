/*!
 * Kindle セール一覧 タイトル別まとめ
 * Amazon.co.jp のセール・検索一覧を全ページ読み込み、シリーズ(タイトル)単位にまとめて表示します。
 * Amazon 非公式のツールです。Amazon の仕様変更で動かなくなることがあります。
 */
(function () {
  'use strict';
  // 2回目以降のクリックは、すでに読み込んだ本体でまとめ画面を開き直すだけ
  if (window.__ksgOpen) { window.__ksgOpen(); return; }

  // ---- 設定 ----
  const SAFETY_MAX_PAGES = 60;   // 念のための上限 (Amazon 側は通常 20 ページで打ち切り)
  const DELAY_MS = 500;          // ページ取得の間隔 (短くしすぎるとブロックされやすい)
  const ALL_SORTS = ['relevanceblender', 'exact-aware-popularity-rank', 'price-asc-rank',
    'price-desc-rank', 'review-rank', 'date-desc-rank'];
  const DROP_PARAMS = ['page', 'qid', 'ref', 'xpid', 'sprefix', 'crid'];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const yen = n => '￥' + n.toLocaleString('ja-JP');

  // ---- URL ----
  function baseUrl() {
    const u = new URL(location.href);
    DROP_PARAMS.forEach(p => u.searchParams.delete(p));
    return u;
  }
  function pageUrl(page, sort) {
    const u = baseUrl();
    if (sort) u.searchParams.set('s', sort);
    u.searchParams.set('page', String(page));
    return u.toString();
  }
  // クリック先: 今のセール(絞り込み条件)を保ったままタイトルで検索
  function searchUrl(name) {
    const u = baseUrl();
    u.searchParams.delete('s');
    u.searchParams.set('k', name);
    return u.toString();
  }

  // ---- タイトルの正規化 (シリーズ情報が無い商品用) ----
  function normalizeTitle(title) {
    let s = title.normalize('NFKC').replace(/【[^】]*】/g, ' ').trim();
    let m;
    while ((m = s.match(/^(.*\S)\s*\([^()]*\)\s*$/))) s = m[1];   // 末尾の (レーベル名) (1) を除去
    if ((m = s.match(/^(.{2,}?)\s+\d{1,3}\s+\D/))) s = m[1];      // 「幼女戦記 12 副題」→「幼女戦記」
    for (let i = 0; i < 2; i++) {
      s = s.replace(/[\s:：\-―~〜]*(?:第?\s*\d+(?:\.\d+)?\s*(?:巻|話|集)?|vol\.?\s*\d+|\s[上中下]巻?)\s*$/i, '').trim();
    }
    return s || title.trim();
  }
  function volumeOf(title) {
    const s = title.normalize('NFKC').replace(/\([^()\d]*\)\s*$/, '');
    const m = s.match(/(\d+)(?!.*\d)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---- 1ページ分の解析 ----
  function parseDoc(doc) {
    const out = [];
    doc.querySelectorAll('[data-component-type="s-search-result"]').forEach(el => {
      const asin = el.getAttribute('data-asin');
      const h2 = el.querySelector('h2');
      if (!asin || !h2) return;
      const title = h2.textContent.trim();
      const item = { asin, title, img: null, price: null, seriesAsin: null, seriesName: null, total: null, vol: null };
      const img = el.querySelector('img.s-image');
      if (img) item.img = img.getAttribute('src');
      const pr = el.querySelector('.a-price .a-offscreen');
      if (pr) {
        const n = parseInt(pr.textContent.replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) item.price = n;
      }
      for (const a of el.querySelectorAll('a')) {
        const m = a.textContent.trim().match(/^全(\d+)巻中第(\d+)巻[:：]\s*(.+)$/);
        if (!m) continue;
        item.total = parseInt(m[1], 10);
        item.vol = parseInt(m[2], 10);
        item.seriesName = m[3].trim();
        const am = (a.getAttribute('href') || '').match(/\/dp\/([A-Z0-9]{10})/);
        if (am) item.seriesAsin = am[1];
        break;
      }
      if (item.vol == null) item.vol = volumeOf(title);
      out.push(item);
    });
    return out;
  }

  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form[action*="validateCaptcha"]')) throw new Error('Amazon が確認画面(CAPTCHA)を返しました');
    return { items: parseDoc(doc), hasNext: !!doc.querySelector('a.s-pagination-next') };
  }

  // ---- 全ページ収集 ----
  async function collect(multiSort, onProgress) {
    const items = new Map();
    const current = new URL(location.href).searchParams.get('s');
    const sorts = multiSort ? [current, ...ALL_SORTS.filter(s => s !== current)] : [current];
    let error = null;
    outer:
    for (let si = 0; si < sorts.length; si++) {
      for (let p = 1; p <= SAFETY_MAX_PAGES; p++) {
        onProgress(`読み込み中… 並び順 ${si + 1}/${sorts.length}・${p} ページ目 (${items.size} 冊)`);
        let r;
        try {
          r = await fetchPage(pageUrl(p, sorts[si]));
        } catch (e) {
          error = e.message;
          break outer;
        }
        r.items.forEach(it => { if (!items.has(it.asin)) items.set(it.asin, it); });
        if (!r.hasNext || r.items.length === 0) break;
        await sleep(DELAY_MS);
      }
    }
    return { items: [...items.values()], error };
  }

  // ---- グループ化 ----
  function group(items) {
    const map = new Map();
    items.forEach((it, idx) => {
      const name = it.seriesName || normalizeTitle(it.title);
      const key = it.seriesAsin ? 'S:' + it.seriesAsin : 'T:' + name;
      let g = map.get(key);
      if (!g) {
        g = { key, name, seriesAsin: it.seriesAsin, total: it.total, items: [], order: idx };
        map.set(key, g);
      }
      if (it.total && (!g.total || it.total > g.total)) g.total = it.total;
      g.items.push(it);
    });
    const groups = [...map.values()];
    groups.forEach(g => {
      g.items.sort((a, b) => (a.vol ?? 1e9) - (b.vol ?? 1e9));
      const prices = g.items.map(i => i.price).filter(p => p != null);
      g.min = prices.length ? Math.min(...prices) : null;
      g.max = prices.length ? Math.max(...prices) : null;
      g.sum = prices.reduce((a, b) => a + b, 0);
      g.cover = (g.items.find(i => i.img) || {}).img || null;
    });
    return groups;
  }

  // ---- 画面 ----
  const css = `
  #ksg-btn{position:fixed;right:16px;bottom:16px;z-index:99998;padding:10px 16px;border:0;border-radius:22px;
    background:#232f3e;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}
  #ksg-btn:hover{background:#37475a}
  #ksg-ov{position:fixed;inset:0;z-index:99999;background:#f3f3f3;color:#111;overflow:auto;font-size:13px}
  #ksg-hd{position:sticky;top:0;background:#232f3e;color:#fff;padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;z-index:1}
  #ksg-hd b{font-size:15px}
  #ksg-hd input[type=text],#ksg-hd select{padding:5px 8px;border-radius:4px;border:0;font-size:13px}
  #ksg-hd button{padding:5px 12px;border-radius:4px;border:0;cursor:pointer;font-size:13px}
  #ksg-hd label{display:flex;align-items:center;gap:4px;cursor:pointer}
  #ksg-stat{margin-left:auto}
  #ksg-msg{padding:8px 16px;color:#b12704}
  #ksg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;padding:16px}
  .ksg-card{background:#fff;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:4px;
    text-decoration:none!important;color:#111!important;box-shadow:0 1px 2px rgba(0,0,0,.15)}
  .ksg-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.3)}
  .ksg-card img{width:100%;height:200px;object-fit:contain;background:#fafafa}
  .ksg-name{font-weight:bold;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .ksg-cnt{color:#565959}
  .ksg-price{color:#b12704;font-weight:bold}
  .ksg-sum{color:#565959;font-size:12px}`;

  let state = { groups: [], items: [], error: null };

  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    (children || []).forEach(c => e.append(c));
    return e;
  }

  function render() {
    const grid = document.getElementById('ksg-grid');
    const q = document.getElementById('ksg-q').value.trim().normalize('NFKC').toLowerCase();
    const sort = document.getElementById('ksg-sort').value;
    let gs = state.groups.filter(g => !q || g.name.normalize('NFKC').toLowerCase().includes(q));
    const cmp = {
      order: (a, b) => a.order - b.order,
      count: (a, b) => b.items.length - a.items.length || a.order - b.order,
      price: (a, b) => (a.min ?? 1e9) - (b.min ?? 1e9) || a.order - b.order,
      sum: (a, b) => a.sum - b.sum || a.order - b.order,
      name: (a, b) => a.name.localeCompare(b.name, 'ja'),
    }[sort];
    gs = gs.slice().sort(cmp);
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    gs.forEach(g => {
      const n = g.items.length;
      const cnt = g.total ? `セール対象 ${n}冊 / 全${g.total}巻` : `セール対象 ${n}冊`;
      const price = g.min == null ? '' : (g.min === g.max ? yen(g.min) : `${yen(g.min)}〜${yen(g.max)}`);
      const card = el('a', { className: 'ksg-card', href: searchUrl(g.name), target: '_blank', rel: 'noopener', title: g.name }, [
        el('img', { src: g.cover || '', loading: 'lazy', alt: '' }),
        el('div', { className: 'ksg-name', textContent: g.name }),
        el('div', { className: 'ksg-cnt', textContent: cnt }),
        el('div', { className: 'ksg-price', textContent: price }),
        el('div', { className: 'ksg-sum', textContent: n > 1 && g.sum ? `${n}冊合計 ${yen(g.sum)}` : '' }),
      ]);
      frag.append(card);
    });
    grid.append(frag);
    document.getElementById('ksg-stat').textContent = `${gs.length} タイトル / ${state.items.length} 冊`;
  }

  async function load(force) {
    const multi = document.getElementById('ksg-multi').checked;
    const msg = document.getElementById('ksg-msg');
    const cacheKey = 'ksg:' + (multi ? 'M:' : 'S:') + baseUrl().toString();
    let data = null;
    if (!force) {
      try { data = JSON.parse(sessionStorage.getItem(cacheKey)); } catch (e) { /* ignore */ }
    }
    if (!data) {
      document.getElementById('ksg-grid').textContent = '';
      data = await collect(multi, t => { msg.textContent = t; });
      if (!data.error) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) { /* 容量超過は無視 */ }
      }
    }
    state = { items: data.items, groups: group(data.items), error: data.error };
    msg.textContent = data.error ? `途中で停止しました (${data.error})。取得できた分だけ表示しています。` : '';
    render();
  }

  function openOverlay() {
    let ov = document.getElementById('ksg-ov');
    if (ov) { ov.style.display = ''; return; }
    const q = el('input', { id: 'ksg-q', type: 'text', placeholder: 'タイトルで絞り込み' });
    const sort = el('select', { id: 'ksg-sort' }, [
      el('option', { value: 'order', textContent: '元の並び順' }),
      el('option', { value: 'count', textContent: '対象冊数が多い順' }),
      el('option', { value: 'price', textContent: '1冊の最安値が安い順' }),
      el('option', { value: 'sum', textContent: '合計が安い順' }),
      el('option', { value: 'name', textContent: 'タイトル順' }),
    ]);
    const multi = el('input', { id: 'ksg-multi', type: 'checkbox' });
    const reload = el('button', { textContent: '再読み込み' });
    const close = el('button', { textContent: '閉じる' });
    ov = el('div', { id: 'ksg-ov' }, [
      el('div', { id: 'ksg-hd' }, [
        el('b', { textContent: 'タイトル別まとめ' }), q, sort,
        el('label', { title: 'Amazon は1つの並び順につき20ページまでしか返さないため、並び順を変えて読み込み件数を増やします(時間がかかります)' },
          [multi, '全並び順で読み込む']),
        reload, el('span', { id: 'ksg-stat' }), close,
      ]),
      el('div', { id: 'ksg-msg' }),
      el('div', { id: 'ksg-grid' }),
    ]);
    document.body.append(ov);
    q.addEventListener('input', render);
    sort.addEventListener('change', render);
    multi.addEventListener('change', () => load(false));
    reload.addEventListener('click', () => load(true));
    close.addEventListener('click', () => { ov.style.display = 'none'; });
    load(false);
  }

  function notice(text) {
    const n = el('div', { textContent: text });
    n.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:100000;' +
      'background:#232f3e;color:#fff;padding:12px 18px;border-radius:8px;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.4)';
    document.body.append(n);
    setTimeout(() => n.remove(), 5000);
  }

  const onSearchPage = /(^|\.)amazon\.co\.jp$/.test(location.hostname) && location.pathname.startsWith('/s');
  if (!onSearchPage) {
    notice('Amazon.co.jp のセール・検索一覧ページで押してください');
    return;
  }
  document.head.append(el('style', { textContent: css }));
  window.__ksgOpen = openOverlay;
  if (window.__KSG_BUTTON__) {
    // ユーザースクリプト版: 右下にボタンを出す
    const btn = el('button', { id: 'ksg-btn', textContent: 'タイトル別にまとめる' });
    btn.addEventListener('click', openOverlay);
    document.body.append(btn);
  } else {
    // ブックマークレット版: すぐ開く
    openOverlay();
  }
})();
