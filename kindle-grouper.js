/*!
 * Kindle セール一覧 タイトル別まとめ
 * - セール・検索一覧: 全ページ読み込み、シリーズ(タイトル)単位にまとめて表示
 * - 注文履歴: Kindle 以外を一覧表示し、Kindle はタイトル別に折りたたんで表示
 * Amazon 非公式のツールです。Amazon の仕様変更で動かなくなることがあります。
 */
(function () {
  'use strict';
  // 2回目以降のクリックは、すでに読み込んだ本体でまとめ画面を開き直すだけ
  if (window.__ksgOpen) { window.__ksgOpen(); return; }

  // ---- 共通設定 ----
  const DELAY_MS = 500;          // ページ取得の間隔 (短くしすぎるとブロックされやすい)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const yen = n => '￥' + n.toLocaleString('ja-JP');
  const norm = s => s.normalize('NFKC').toLowerCase();

  // ---- ページの種類を URL で判別 ----
  const onAmazon = /(^|\.)amazon\.co\.jp$/.test(location.hostname);
  const path = location.pathname;
  const MODE = !onAmazon ? null
    : /^\/(your-orders\/orders|gp\/css\/order-history|gp\/your-account\/order-history)/.test(path) ? 'orders'
    : path.startsWith('/s') ? 'search'
    : null;

  // ---- 共通: DOM と見た目 ----
  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    (children || []).forEach(c => c != null && e.append(c));
    return e;
  }

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
  #ksg-msg:empty{display:none}
  #ksg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;padding:16px}
  .ksg-card{background:#fff;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:4px;
    text-decoration:none!important;color:#111!important;box-shadow:0 1px 2px rgba(0,0,0,.15)}
  .ksg-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.3)}
  .ksg-card img{width:100%;height:200px;object-fit:contain;background:#fafafa}
  .ksg-name{font-weight:bold;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .ksg-cnt{color:#565959}
  .ksg-price{color:#b12704;font-weight:bold}
  .ksg-sum{color:#565959;font-size:12px}
  #ksg-body{padding:16px;max-width:1100px;margin:0 auto}
  .ksg-sec{background:#fff;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.15);margin-bottom:16px}
  .ksg-sec>summary,.ksg-sec>h3{margin:0;padding:12px 16px;font-size:15px;font-weight:bold;cursor:pointer}
  .ksg-sec>h3{cursor:default;border-bottom:1px solid #eee}
  .ksg-title{border-top:1px solid #eee}
  .ksg-title>summary{padding:8px 16px 8px 28px;cursor:pointer;display:flex;gap:12px;align-items:baseline}
  .ksg-title>summary .ksg-tname{font-weight:bold;flex:1}
  .ksg-meta{color:#565959;font-size:12px;white-space:nowrap}
  table.ksg-tbl{width:100%;border-collapse:collapse}
  .ksg-tbl td{padding:6px 10px;border-top:1px solid #eee;vertical-align:top}
  .ksg-tbl td.d{white-space:nowrap;color:#565959;width:7.5em}
  .ksg-tbl td.p{white-space:nowrap;text-align:right;width:9em}
  .ksg-tbl td.o{white-space:nowrap;width:5em}
  .ksg-tbl td.i{width:48px}
  .ksg-tbl img{width:40px;height:40px;object-fit:contain}
  .ksg-tbl a{color:#007185!important}
  .ksg-vols td{padding-left:44px}
  .ksg-note{color:#565959;font-size:11px}
  .ksg-empty{padding:12px 16px;color:#565959}`;

  function notice(text) {
    const n = el('div', { textContent: text });
    n.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:100000;' +
      'background:#232f3e;color:#fff;padding:12px 18px;border-radius:8px;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.4)';
    document.body.append(n);
    setTimeout(() => n.remove(), 5000);
  }

  // ---- 共通: タイトルの正規化 (シリーズ情報が無い商品用) ----
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
    const s = title.normalize('NFKC').replace(/【[^】]*】/g, ' ').replace(/\([^()\d]*\)\s*$/, '');
    const m = s.match(/(\d+)(?!.*\d)/);
    return m ? parseInt(m[1], 10) : null;
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    if (doc.querySelector('form[action*="validateCaptcha"]')) throw new Error('Amazon が確認画面(CAPTCHA)を返しました');
    if (doc.querySelector('#ap_email, #ap_password, form[name="signIn"]')) throw new Error('サインインが必要です');
    return doc;
  }

  function cacheGet(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch (e) { return null; } }
  function cacheSet(key, v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 容量超過は無視 */ } }

  // =====================================================================
  //  セール・検索一覧モード
  // =====================================================================
  const Search = (() => {
    const SAFETY_MAX_PAGES = 60;   // 念のための上限 (Amazon 側は通常 20 ページで打ち切り)
    const ALL_SORTS = ['relevanceblender', 'exact-aware-popularity-rank', 'price-asc-rank',
      'price-desc-rank', 'review-rank', 'date-desc-rank'];
    const DROP_PARAMS = ['page', 'qid', 'ref', 'xpid', 'sprefix', 'crid'];

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

    function parseDoc(doc) {
      const out = [];
      doc.querySelectorAll('[data-component-type="s-search-result"]').forEach(node => {
        const asin = node.getAttribute('data-asin');
        const h2 = node.querySelector('h2');
        if (!asin || !h2) return;
        const title = h2.textContent.trim();
        const item = { asin, title, img: null, price: null, seriesAsin: null, seriesName: null, total: null, vol: null };
        const img = node.querySelector('img.s-image');
        if (img) item.img = img.getAttribute('src');
        const pr = node.querySelector('.a-price .a-offscreen');
        if (pr) {
          const n = parseInt(pr.textContent.replace(/[^\d]/g, ''), 10);
          if (!isNaN(n)) item.price = n;
        }
        for (const a of node.querySelectorAll('a')) {
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

    async function collect(multiSort, onProgress) {
      const items = new Map();
      const current = new URL(location.href).searchParams.get('s');
      const sorts = multiSort ? [current, ...ALL_SORTS.filter(s => s !== current)] : [current];
      let error = null;
      outer:
      for (let si = 0; si < sorts.length; si++) {
        for (let p = 1; p <= SAFETY_MAX_PAGES; p++) {
          onProgress(`読み込み中… 並び順 ${si + 1}/${sorts.length}・${p} ページ目 (${items.size} 冊)`);
          let doc;
          try {
            doc = await fetchDoc(pageUrl(p, sorts[si]));
          } catch (e) {
            error = e.message;
            break outer;
          }
          const found = parseDoc(doc);
          found.forEach(it => { if (!items.has(it.asin)) items.set(it.asin, it); });
          if (!doc.querySelector('a.s-pagination-next') || found.length === 0) break;
          await sleep(DELAY_MS);
        }
      }
      return { items: [...items.values()], error };
    }

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

    let state = { groups: [], items: [] };

    function render() {
      const grid = document.getElementById('ksg-grid');
      const q = norm(document.getElementById('ksg-q').value.trim());
      const sort = document.getElementById('ksg-sort').value;
      let gs = state.groups.filter(g => !q || norm(g.name).includes(q));
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
        frag.append(el('a', { className: 'ksg-card', href: searchUrl(g.name), target: '_blank', rel: 'noopener', title: g.name }, [
          el('img', { src: g.cover || '', loading: 'lazy', alt: '' }),
          el('div', { className: 'ksg-name', textContent: g.name }),
          el('div', { className: 'ksg-cnt', textContent: cnt }),
          el('div', { className: 'ksg-price', textContent: price }),
          el('div', { className: 'ksg-sum', textContent: n > 1 && g.sum ? `${n}冊合計 ${yen(g.sum)}` : '' }),
        ]));
      });
      grid.append(frag);
      document.getElementById('ksg-stat').textContent = `${gs.length} タイトル / ${state.items.length} 冊`;
    }

    async function load(force) {
      const multi = document.getElementById('ksg-multi').checked;
      const msg = document.getElementById('ksg-msg');
      const cacheKey = 'ksg:' + (multi ? 'M:' : 'S:') + baseUrl().toString();
      let data = force ? null : cacheGet(cacheKey);
      if (!data) {
        document.getElementById('ksg-grid').textContent = '';
        data = await collect(multi, t => { msg.textContent = t; });
        if (!data.error) cacheSet(cacheKey, data);
      }
      state = { items: data.items, groups: group(data.items) };
      msg.textContent = data.error ? `途中で停止しました (${data.error})。取得できた分だけ表示しています。` : '';
      render();
    }

    function build() {
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
      const ov = el('div', { id: 'ksg-ov' }, [
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

    return { build, buttonLabel: 'タイトル別にまとめる' };
  })();

  // =====================================================================
  //  注文履歴モード
  // =====================================================================
  const Orders = (() => {
    const MAX_PAGES_PER_PERIOD = 300;  // 念のための上限 (1ページ10件)

    function currentPeriod() {
      const u = new URL(location.href);
      const sel = document.querySelector('#time-filter');
      return u.searchParams.get('timeFilter') || u.searchParams.get('orderFilter') || (sel && sel.value) || 'months-3';
    }
    function periodOptions() {
      const sel = document.querySelector('#time-filter');
      const opts = sel ? [...sel.options].map(o => ({ value: o.value, label: o.textContent.trim() })) : [];
      if (!opts.some(o => o.value === currentPeriod())) opts.unshift({ value: currentPeriod(), label: currentPeriod() });
      const years = opts.filter(o => /^year-\d{4}$/.test(o.value));
      if (years.length > 1) opts.push({ value: 'all', label: `全期間 (${years.length}年分・時間がかかります)` });
      return opts;
    }
    function yearPeriods() {
      return periodOptions().filter(o => /^year-\d{4}$/.test(o.value)).map(o => o.value);
    }
    function pageUrl(period, page) {
      const u = new URL('/your-orders/orders', location.origin);
      u.searchParams.set('timeFilter', period);
      u.searchParams.set('page', String(page));
      // 注文内容が暗号化されずに返る、Amazon 自身の代替表示を使う
      u.searchParams.set('disableCsd', 'missing-library');
      return u.toString();
    }

    const txt = n => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');

    function parseDoc(doc) {
      const orders = [];
      const cards = [...doc.querySelectorAll('.order-card')];
      if (cards.some(c => /SiegeClientSideDecryption/.test(c.innerHTML) && !c.querySelector('.yohtmlc-product-title'))) {
        throw new Error('注文内容が読み取れない形式で返されました(Amazon の仕様変更の可能性があります)');
      }
      cards.forEach(c => {
        const head = [...c.querySelectorAll('.order-header__header-list-item')].map(txt);
        // 「注文日」のほか「サブスクリプション課金日」などもあるので、最初に出てくる日付を使う
        const date = (head.join(' ').match(/\d{4}年\d{1,2}月\d{1,2}日/) || [''])[0];
        const totalText = (head.find(h => h.startsWith('合計')) || '').replace(/^合計\s*/, '');
        const total = parseInt(totalText.replace(/[^\d]/g, ''), 10);
        const orderId = ((head.find(h => h.startsWith('注文番号')) || '').match(/[A-Z0-9]{3}-\d{7}-\d{7}/) || [])[0] || '';
        const detail = [...c.querySelectorAll('a')].find(a => /注文内容/.test(a.textContent));
        const cardIsKindle = /Kindle版/.test(c.textContent);
        const boxes = [...c.querySelectorAll('.item-box')];
        const items = [];
        (boxes.length ? boxes : [c]).forEach(b => {
          const t = b.querySelector('.yohtmlc-product-title');
          if (!t) return;
          const a = t.querySelector('a') || t.closest('a') || b.querySelector('a[href*="/dp/"]');
          const href = a ? a.getAttribute('href') : '';
          const img = b.querySelector('.product-image img, img');
          items.push({
            title: txt(t),
            asin: ((href || '').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1] || '',
            img: img ? img.getAttribute('src') : null,
            kindle: /Kindle版/.test(b.textContent) || (cardIsKindle && (boxes.length <= 1)),
          });
        });
        if (!items.length) return;
        orders.push({
          date, total: isNaN(total) ? null : total, orderId,
          detail: detail ? detail.getAttribute('href') : (orderId ? '/your-orders/order-details?orderID=' + orderId : ''),
          items,
        });
      });
      const last = doc.querySelector('.a-pagination li:last-child');
      const hasNext = !!(last && last.querySelector('a'));
      return { orders, hasNext, cardCount: cards.length };
    }

    async function collect(period, onProgress) {
      const periods = period === 'all' ? yearPeriods() : [period];
      const orders = [];
      const seen = new Set();
      let error = null;
      outer:
      for (let pi = 0; pi < periods.length; pi++) {
        for (let p = 0; p < MAX_PAGES_PER_PERIOD; p++) {
          const label = periods.length > 1 ? `${periods[pi].replace('year-', '')}年・` : '';
          onProgress(`読み込み中… ${label}${p + 1} ページ目 (${orders.length} 件の注文)`);
          let r;
          try {
            r = parseDoc(await fetchDoc(pageUrl(periods[pi], p)));
          } catch (e) {
            error = e.message;
            break outer;
          }
          r.orders.forEach(o => {
            const key = o.orderId || (o.date + o.items.map(i => i.asin).join());
            if (seen.has(key)) return;
            seen.add(key);
            orders.push(o);
          });
          if (!r.hasNext || r.cardCount === 0) break;
          await sleep(DELAY_MS);
        }
      }
      return { orders, error };
    }

    // 行に展開: Kindle はタイトル別グループへ、それ以外は1商品1行
    function split(orders) {
      const others = [];
      const kindle = new Map();
      orders.forEach((o, oi) => {
        const n = o.items.length;
        o.items.forEach(it => {
          const row = {
            date: o.date, title: it.title, asin: it.asin, img: it.img, detail: o.detail,
            // 1商品だけの注文なら合計=その商品の価格。複数商品なら注文合計として表示
            price: n === 1 ? o.total : null, orderTotal: o.total, orderCount: n, order: oi,
          };
          if (!it.kindle) { others.push(row); return; }
          const name = normalizeTitle(it.title);
          let g = kindle.get(name);
          if (!g) { g = { name, rows: [], order: oi }; kindle.set(name, g); }
          row.vol = volumeOf(it.title);
          g.rows.push(row);
        });
      });
      const groups = [...kindle.values()];
      groups.forEach(g => {
        g.rows.sort((a, b) => (a.vol ?? 1e9) - (b.vol ?? 1e9) || a.order - b.order);
        g.sum = g.rows.reduce((s, r) => s + (r.price || 0), 0);
        g.latest = g.rows.reduce((m, r) => (r.order < m.order ? r : m), g.rows[0]).date;
      });
      return { others, groups };
    }

    let state = { orders: [], others: [], groups: [] };
    const dp = asin => (asin ? '/dp/' + asin : null);

    function priceCell(r) {
      if (r.price != null) return el('td', { className: 'p', textContent: yen(r.price) });
      if (r.orderTotal == null) return el('td', { className: 'p' });
      return el('td', { className: 'p' }, [yen(r.orderTotal), el('div', { className: 'ksg-note', textContent: `注文合計・${r.orderCount}点` })]);
    }
    function linkOrText(text, href) {
      return href ? el('a', { href, target: '_blank', rel: 'noopener', textContent: text }) : document.createTextNode(text);
    }
    function detailCell(r) {
      return el('td', { className: 'o' }, [r.detail ? el('a', { href: r.detail, target: '_blank', rel: 'noopener', textContent: '注文詳細' }) : null]);
    }

    function render() {
      const body = document.getElementById('ksg-body');
      const q = norm(document.getElementById('ksg-q').value.trim());
      const hit = s => !q || norm(s).includes(q);
      body.textContent = '';

      // Kindle: 全体を1つに折りたたみ → タイトル別 → 巻
      const groups = state.groups
        .map(g => (hit(g.name) ? g : { ...g, rows: g.rows.filter(r => hit(r.title)) }))
        .filter(g => g.rows.length)
        .sort((a, b) => a.order - b.order);
      const kCount = groups.reduce((s, g) => s + g.rows.length, 0);
      const kSec = el('details', { className: 'ksg-sec', open: !!q && kCount > 0 }, [
        el('summary', { textContent: `Kindle (${groups.length} タイトル / ${kCount} 冊) — 押すと開きます` }),
      ]);
      groups.forEach(g => {
        const t = el('details', { className: 'ksg-title' }, [
          el('summary', {}, [
            el('span', { className: 'ksg-tname', textContent: g.name }),
            el('span', { className: 'ksg-meta', textContent: `${g.rows.length}冊` + (g.sum ? `・${yen(g.sum)}` : '') + `・最終 ${g.latest}` }),
          ]),
        ]);
        t.addEventListener('toggle', () => {
          if (!t.open || t.querySelector('table')) return;
          const tbl = el('table', { className: 'ksg-tbl ksg-vols' });
          g.rows.forEach(r => tbl.append(el('tr', {}, [
            el('td', { className: 'd', textContent: r.date }),
            el('td', {}, [linkOrText(r.title, dp(r.asin))]),
            priceCell(r), detailCell(r),
          ])));
          t.append(tbl);
        });
        kSec.append(t);
      });
      if (!groups.length) kSec.append(el('div', { className: 'ksg-empty', textContent: '該当なし' }));
      body.append(kSec);

      // Kindle 以外: 1商品1行
      const rows = state.others.filter(r => hit(r.title));
      const oSec = el('div', { className: 'ksg-sec' }, [el('h3', { textContent: `Kindle 以外 (${rows.length} 点)` })]);
      if (rows.length) {
        const tbl = el('table', { className: 'ksg-tbl' });
        rows.forEach(r => tbl.append(el('tr', {}, [
          el('td', { className: 'd', textContent: r.date }),
          el('td', { className: 'i' }, [r.img ? el('img', { src: r.img, loading: 'lazy', alt: '' }) : null]),
          el('td', {}, [linkOrText(r.title, dp(r.asin))]),
          priceCell(r), detailCell(r),
        ])));
        oSec.append(tbl);
      } else {
        oSec.append(el('div', { className: 'ksg-empty', textContent: '該当なし' }));
      }
      body.append(oSec);

      document.getElementById('ksg-stat').textContent =
        `注文 ${state.orders.length} 件 (Kindle ${kCount} 冊 / それ以外 ${rows.length} 点)`;
    }

    async function load(force) {
      const period = document.getElementById('ksg-period').value;
      const msg = document.getElementById('ksg-msg');
      const cacheKey = 'ksg:orders:' + period;
      let data = force ? null : cacheGet(cacheKey);
      if (!data) {
        document.getElementById('ksg-body').textContent = '';
        document.getElementById('ksg-stat').textContent = '';
        data = await collect(period, t => { msg.textContent = t; });
        if (!data.error) cacheSet(cacheKey, data);
      }
      state = { orders: data.orders, ...split(data.orders) };
      msg.textContent = data.error ? `途中で停止しました (${data.error})。取得できた分だけ表示しています。` : '';
      render();
    }

    function build() {
      const period = el('select', { id: 'ksg-period' },
        periodOptions().map(o => el('option', { value: o.value, textContent: o.label })));
      period.value = currentPeriod();
      const q = el('input', { id: 'ksg-q', type: 'text', placeholder: '商品名で絞り込み' });
      const reload = el('button', { textContent: '再読み込み' });
      const close = el('button', { textContent: '閉じる' });
      const ov = el('div', { id: 'ksg-ov' }, [
        el('div', { id: 'ksg-hd' }, [
          el('b', { textContent: '注文履歴まとめ' }), period, q, reload,
          el('span', { id: 'ksg-stat' }), close,
        ]),
        el('div', { id: 'ksg-msg' }),
        el('div', { id: 'ksg-body' }),
      ]);
      document.body.append(ov);
      period.addEventListener('change', () => load(false));
      q.addEventListener('input', render);
      reload.addEventListener('click', () => load(true));
      close.addEventListener('click', () => { ov.style.display = 'none'; });
      load(false);
    }

    return { build, buttonLabel: '注文履歴をまとめる' };
  })();

  // =====================================================================
  //  起動
  // =====================================================================
  if (!MODE) {
    notice('Amazon.co.jp のセール・検索一覧ページか、注文履歴ページで押してください');
    return;
  }
  const impl = MODE === 'orders' ? Orders : Search;
  function openOverlay() {
    const ov = document.getElementById('ksg-ov');
    if (ov) { ov.style.display = ''; return; }
    impl.build();
  }
  document.head.append(el('style', { textContent: css }));
  window.__ksgOpen = openOverlay;
  if (window.__KSG_BUTTON__) {
    // ユーザースクリプト版: 右下にボタンを出す
    const btn = el('button', { id: 'ksg-btn', textContent: impl.buttonLabel });
    btn.addEventListener('click', openOverlay);
    document.body.append(btn);
  } else {
    // ブックマークレット版: すぐ開く
    openOverlay();
  }
})();
