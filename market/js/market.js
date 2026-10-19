// Tradesafe marketplace front end. Talks to market-server; all money rules live there.
(() => {
  'use strict';

  const API = (window.MARKET_API || (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) ? 'http://localhost:7860' : '')).replace(/\/$/, '');
  const app = document.getElementById('app');
  let cfg = null;

  // ------------------------------------------------------------ helpers

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  let token = store.get('ts_token');
  let me = null;

  async function api(path, opts = {}) {
    if (!API) throw new Error('This marketplace is not connected to its server yet.');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.admin) headers['X-Admin-Token'] = store.get('ts_admin') || '';
    let res;
    try {
      res = await fetch(API + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !opts.admin && token) { setToken(null); }
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join('; ') : `Error ${res.status}`);
    }
    return data;
  }

  function setToken(t) { token = t; store.set('ts_token', t); if (!t) me = null; }

  const money = (minor, cur = cfg?.currency || 'NGN') =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: cur, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
  const date = s => new Date(s * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const since = s => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  function left(s) {
    const d = s - Date.now() / 1000;
    if (d <= 0) return 'now';
    const days = Math.floor(d / 86400), hrs = Math.floor(d % 86400 / 3600), min = Math.ceil(d % 3600 / 60);
    return days ? `${days}d ${hrs}h` : hrs ? `${hrs}h ${min}m` : `${min} min`;
  }

  const shieldIcon = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.innerHTML = '<path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z"/><path fill="none" stroke="#fff" stroke-width="2" d="m8.5 12 2.5 2.5 4.5-5"/>';
    return s;
  };

  function busy(btn, fn) {
    return async (e) => {
      e?.preventDefault?.();
      const err = btn.closest('form, .panel')?.querySelector('.err');
      if (err) err.textContent = '';
      btn.disabled = true;
      try { await fn(); } catch (ex) { if (err) err.textContent = ex.message; else alert(ex.message); } finally { btn.disabled = false; }
    };
  }

  function view(...kids) { app.replaceChildren(...kids); window.scrollTo(0, 0); }
  function loading() { app.replaceChildren(h('p', { class: 'empty' }, 'Loading…')); }
  function fail(e) { view(h('div', { class: 'banner bad' }, e.message)); }

  function needLogin(next) {
    store.set('ts_next', next);
    location.hash = '#/account';
  }

  const STATUS = {
    awaiting_payment: ['Waiting for payment', 'wait'],
    paid: ['Paid · money held', 'held'],
    shipped: ['Sent · money held', 'held'],
    disputed: ['In dispute · money held', 'bad'],
    released: ['Complete', 'done'],
    refunded: ['Refunded', 'bad'],
    cancelled: ['Cancelled', ''],
  };
  const badge = s => h('span', { class: `badge ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);

  function photoOf(item, cls) {
    return item.photo ? h('img', { class: cls, src: item.photo, alt: item.title, loading: 'lazy' }) : h('div', { class: cls });
  }

  function demoBanner() {
    if (!API) return h('div', { class: 'banner warn' }, 'The marketplace server isn\'t connected yet. Put its address in market/js/config.js.');
    if (cfg && !cfg.live) return h('div', { class: 'banner warn' }, 'Demo mode: payments are simulated and no real money moves.');
    return null;
  }

  // ------------------------------------------------------------ pages

  async function home(params) {
    const qv = params.get('q') || '', cat = params.get('cat') || '';
    const input = h('input', { type: 'search', placeholder: 'Search phones, shoes, laptops…', value: qv, 'aria-label': 'Search' });
    const go = (q, c) => { location.hash = `#/?${new URLSearchParams({ ...(q && { q }), ...(c && { cat: c }) })}`; };
    const grid = h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Loading…'));
    view(
      demoBanner(),
      qv || cat ? null : h('section', { class: 'hero' },
        h('h1', {}, 'Buy online without fear of "I paid and they disappeared."'),
        h('p', {}, 'Tradesafe holds your money safely. The seller only gets paid after you confirm the item arrived as described.'),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/how' }, 'How it works'), h('a', { class: 'btn', href: '#/sell' }, 'Start selling')),
        h('div', { class: 'steps' },
          h('div', { class: 'step' }, h('b', {}, '1'), h('h3', {}, 'You pay Tradesafe'), h('div', { class: 'muted small' }, 'Not the seller. We hold the money.')),
          h('div', { class: 'step' }, h('b', {}, '2'), h('h3', {}, 'Seller sends the item'), h('div', { class: 'muted small' }, `They have ${cfg?.shipDays ?? 3} days, or you get a full refund.`)),
          h('div', { class: 'step' }, h('b', {}, '3'), h('h3', {}, 'You check it, then confirm'), h('div', { class: 'muted small' }, 'Only then is the seller paid. Problem? Open a dispute.'))),
      ),
      h('form', { class: 'search', onsubmit: e => { e.preventDefault(); go(input.value.trim(), cat); } }, input, h('button', { class: 'btn primary' }, 'Search')),
      h('div', { class: 'chips' },
        h('button', { class: `chip ${cat ? '' : 'on'}`, onclick: () => go(qv, '') }, 'All'),
        (cfg?.categories || []).map(c => h('button', { class: `chip ${c === cat ? 'on' : ''}`, onclick: () => go(qv, c) }, c))),
      grid,
    );
    try {
      const items = await api(`/v1/listings?${new URLSearchParams({ q: qv, category: cat })}`);
      grid.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'empty' }, qv || cat ? 'Nothing matches yet. Try another search.' : 'No items yet. Be the first to sell something!')]));
    } catch (e) { grid.replaceChildren(h('div', { class: 'banner bad' }, e.message)); }
  }

  const card = it => h('a', { class: 'card', href: `#/item/${it.id}` },
    photoOf(it, 'ph'),
    h('div', { class: 'bd' }, h('div', { class: 't' }, it.title), h('div', { class: 'price' }, money(it.price, it.currency)), h('div', { class: 'muted small' }, it.location || it.category)));

  function trustCard(s) {
    return h('div', { class: 'panel' },
      h('h3', {}, 'Seller: ', h('a', { href: `#/seller/${s.id}` }, s.name)),
      h('div', { class: 'muted small' }, `Member since ${since(s.memberSince)}`, s.payoutVerified ? ' · Bank account verified' : ''),
      h('div', { class: 'trust' },
        h('div', {}, h('b', {}, s.completedSales), 'completed sales'),
        h('div', {}, h('b', {}, s.rating ? `${s.rating} ★` : '—'), s.reviews ? `${s.reviews} reviews` : 'no reviews yet'),
        h('div', {}, h('b', {}, s.disputesLost), 'disputes lost'),
        h('div', {}, h('b', {}, '100%'), 'protected by escrow')));
  }

  async function item(id) {
    loading();
    let it;
    try { it = await api(`/v1/listings/${id}`); } catch (e) { return fail(e); }
    const addr = h('textarea', { placeholder: 'Full delivery address and phone number', required: true, minlength: 5 });
    const buy = h('button', { class: 'btn primary block' }, `Pay ${money(it.price, it.currency)} into escrow`);
    buy.onclick = busy(buy, async () => {
      if (!token) return needLogin(`#/item/${id}`);
      if (addr.value.trim().length < 5) throw new Error('Add your delivery address so the seller knows where to send it.');
      const o = await api('/v1/orders', { body: { listingId: it.id, deliveryAddress: addr.value.trim() } });
      await startPayment(o.id);
    });
    const mine = me && me.id === it.sellerId;
    view(
      demoBanner(),
      h('div', { class: 'two' },
        h('div', {}, photoOf(it, 'item-photo'),
          h('h1', {}, it.title), h('div', { class: 'price', style: 'font-size:26px' }, money(it.price, it.currency)),
          h('p', { class: 'muted' }, [it.category, it.location].filter(Boolean).join(' · ')),
          h('p', { class: 'desc' }, it.description)),
        h('div', {},
          h('div', { class: 'panel escrow' },
            h('div', { class: 'shield' }, shieldIcon(), h('div', {},
              h('h3', {}, 'Escrow protection'),
              h('div', { class: 'small muted' }, `Your money goes to Tradesafe, not the seller. If the item doesn't arrive within ${cfg?.shipDays ?? 3} days of paying, you get a full refund automatically. Once it arrives you have ${cfg?.inspectionDays ?? 3} days to check it and confirm or report a problem.`))),
            it.status !== 'active' ? h('div', { class: 'banner warn', style: 'margin-top:12px' }, 'Someone is buying this item right now.')
              : mine ? h('p', { class: 'muted' }, 'This is your listing.')
              : h('div', {}, h('label', {}, 'Deliver to'), addr, buy, h('div', { class: 'err' })),
            h('p', { class: 'small muted' }, 'Never pay a seller directly or outside Tradesafe. We can only protect payments made here.')),
          trustCard(it.seller))),
    );
  }

  async function startPayment(orderId) {
    const returnUrl = `${location.origin}${location.pathname}#/orders/${orderId}`;
    const { url } = await api(`/v1/orders/${orderId}/pay`, { body: { returnUrl } });
    location.href = url;
  }

  async function sell() {
    if (!me) return needLogin('#/sell');
    let photo = '';
    const f = {
      title: h('input', { maxlength: 100, required: true, placeholder: 'e.g. Samsung Galaxy A54, 256GB' }),
      category: h('select', { required: true }, h('option', { value: '' }, 'Choose…'), (cfg?.categories || []).map(c => h('option', {}, c))),
      price: h('input', { type: 'number', min: 1, step: 'any', inputmode: 'decimal', required: true, placeholder: '0' }),
      location: h('input', { maxlength: 80, placeholder: 'City, e.g. Lagos' }),
      description: h('textarea', { required: true, minlength: 10, maxlength: 4000, placeholder: 'Condition, what\'s included, any faults. Honest descriptions win disputes.' }),
      file: h('input', { type: 'file', accept: 'image/*' }),
    };
    const prev = h('img', { class: 'preview', hidden: true, alt: '' });
    const fee = h('div', { class: 'small muted' });
    f.price.oninput = () => {
      const p = Math.round(parseFloat(f.price.value || 0) * 100);
      fee.textContent = p ? `Buyer pays ${money(p)}. You receive ${money(p - Math.round(p * cfg.feePercent / 100))} after the ${cfg.feePercent}% Tradesafe fee.` : '';
    };
    f.file.onchange = async () => {
      if (!f.file.files[0]) return;
      photo = await shrink(f.file.files[0]);
      prev.src = photo; prev.hidden = false;
    };
    const btn = h('button', { class: 'btn primary block' }, 'Publish listing');
    const form = h('form', { class: 'panel' },
      h('label', {}, 'Photo'), f.file, prev,
      h('label', {}, 'Title'), f.title,
      h('label', {}, 'Category'), f.category,
      h('label', {}, `Price (${cfg?.currency || 'NGN'})`), f.price, fee,
      h('label', {}, 'Location'), f.location,
      h('label', {}, 'Description'), f.description,
      me.payout ? null : h('div', { class: 'banner warn', style: 'margin-top:14px' }, 'Add your bank account on the Account page so we can pay you when a sale completes.'),
      btn, h('div', { class: 'err' }));
    form.onsubmit = busy(btn, async () => {
      const it = await api('/v1/listings', { body: {
        title: f.title.value, category: f.category.value, price: parseFloat(f.price.value), location: f.location.value,
        description: f.description.value, photo,
      } });
      location.hash = `#/item/${it.id}`;
    });
    view(demoBanner(), h('h1', {}, 'Sell an item'), h('p', { class: 'muted' }, 'Buyers pay into escrow, so they trust new sellers too. You get paid as soon as they confirm delivery.'), form);
  }

  function shrink(file, max = 1280) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('That file isn\'t a photo we can read.'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function orders(params) {
    if (!me) return needLogin('#/orders');
    loading();
    let list;
    try { list = await api('/v1/orders'); } catch (e) { return fail(e); }
    const tab = params.get('tab') || 'buying';
    const role = tab === 'selling' ? 'seller' : 'buyer';
    const rows = list.filter(o => o.role === role);
    view(
      h('h1', {}, 'Your orders'),
      h('div', { class: 'tabs' },
        h('a', { class: `btn ${tab === 'buying' ? 'primary' : ''}`, href: '#/orders?tab=buying' }, 'Buying'),
        h('a', { class: `btn ${tab === 'selling' ? 'primary' : ''}`, href: '#/orders?tab=selling' }, 'Selling')),
      rows.length ? h('div', { class: 'list' }, rows.map(o => h('a', { class: 'orow', href: `#/orders/${o.id}` },
        h('div', { class: 'grow' }, h('div', { class: 't' }, o.title), h('div', { class: 'small muted' }, `${money(o.amount, o.currency)} · ${date(o.createdAt)} · ${role === 'buyer' ? o.seller.name : o.buyer}`)),
        badge(o.status))))
        : h('p', { class: 'empty' }, role === 'buyer' ? 'You haven\'t bought anything yet.' : 'No sales yet.'),
    );
  }

  const STEPS = ['Paid', 'Sent', 'Confirmed', 'Seller paid'];
  function stepIndex(o) {
    return { awaiting_payment: 0, paid: 1, shipped: 2, disputed: 2, released: o.payoutStatus === 'paid' ? 4 : 3 }[o.status] ?? 0;
  }

  async function order(id) {
    if (!me) return needLogin(`#/orders/${id}`);
    loading();
    let o;
    try {
      o = await api(`/v1/orders/${id}`);
      if (o.status === 'awaiting_payment' && o.role === 'buyer') o = await api(`/v1/orders/${id}/verify`, { method: 'POST' });
    } catch (e) { return fail(e); }
    const buyer = o.role === 'buyer';
    const reload = () => order(id);
    const act = (label, cls, fn) => { const b = h('button', { class: `btn ${cls}` }, label); b.onclick = busy(b, async () => { await fn(); reload(); }); return b; };
    const post = (path, body) => api(`/v1/orders/${id}/${path}`, { body: body || {} });

    // What to do next, in plain words, for whoever is looking.
    const next = h('div', { class: 'panel escrow' });
    const say = (...k) => next.append(...k);
    const s = o.status;
    if (s === 'awaiting_payment') {
      say(h('h3', {}, buyer ? 'Finish paying to reserve the item' : 'Waiting for the buyer to pay'),
        h('p', { class: 'small muted' }, `Reserved for ${left(o.payWindowEnds)} more.`));
      if (buyer) {
        const pay = h('button', { class: 'btn primary' }, `Pay ${money(o.amount, o.currency)}`);
        pay.onclick = busy(pay, () => startPayment(o.id));
        say(h('div', { class: 'row' }, pay, act('Cancel order', '', () => post('cancel'))));
      }
    } else if (s === 'paid') {
      if (buyer) {
        say(h('h3', {}, `${money(o.amount, o.currency)} is held safely by Tradesafe`),
          h('p', { class: 'small muted' }, `The seller has until ${date(o.shipBy)} (${left(o.shipBy)}) to send your item. If they don't, you get a full refund automatically.`));
        const row = h('div', { class: 'row' }, act('I received it, release payment', 'primary', () => confirmRelease()), disputeBtn());
        if (Date.now() / 1000 > o.shipBy) row.append(act('Cancel and get a refund', 'danger', () => post('cancel')));
        say(row);
      } else {
        const note = h('input', { placeholder: 'Courier and tracking number, or how you delivered it' });
        say(h('h3', {}, 'The buyer has paid. Send the item now.'),
          h('p', { class: 'small muted' }, `The money is held by Tradesafe. Send by ${date(o.shipBy)} (${left(o.shipBy)}) or the buyer is refunded.`),
          h('p', {}, h('b', {}, 'Deliver to: '), o.deliveryAddress),
          note, h('div', { class: 'row' }, act('I\'ve sent it', 'primary', () => post('ship', { note: note.value })),
            act('Cancel sale and refund buyer', 'danger', () => confirm('Refund the buyer and cancel this sale?') ? post('cancel') : null)));
      }
    } else if (s === 'shipped') {
      if (buyer) {
        say(h('h3', {}, 'The seller says your item is on its way'),
          o.shipNote ? h('p', {}, h('b', {}, 'Seller\'s note: '), o.shipNote) : null,
          h('p', { class: 'small muted' }, `Check it when it arrives. If you don't confirm or report a problem by ${date(o.releaseAt)} (${left(o.releaseAt)}), the money is released to the seller.`),
          h('div', { class: 'row' }, act('It arrived as described, release payment', 'primary', () => confirmRelease()), disputeBtn()));
      } else {
        say(h('h3', {}, 'Sent. Waiting for the buyer to confirm.'),
          h('p', { class: 'small muted' }, `You'll be paid ${money(o.sellerGets, o.currency)} when they confirm, or automatically on ${date(o.releaseAt)} if they report no problem.`));
      }
    } else if (s === 'disputed') {
      say(h('h3', {}, 'Dispute open. The money stays held until support decides.'),
        h('p', {}, h('b', {}, 'Problem reported: '), o.disputeReason),
        h('p', { class: 'small muted' }, 'Add photos, receipts and tracking details in the messages below. Support reviews both sides and either refunds the buyer or pays the seller.'));
    } else if (s === 'released') {
      const payout = { paid: 'Paid to the seller\'s bank account.', pending: 'Bank transfer to the seller is on its way.', sending: 'Bank transfer to the seller is on its way.', awaiting_bank: buyer ? 'The seller will be paid once they add a bank account.' : 'Add your bank account on the Account page to receive this money.', failed: 'The bank transfer failed. Support will retry.' }[o.payoutStatus] || '';
      say(h('h3', {}, buyer ? 'Order complete' : `Sale complete: ${money(o.sellerGets, o.currency)}`), h('p', { class: 'small muted' }, payout));
      if (!buyer && o.payoutStatus === 'awaiting_bank') say(h('a', { class: 'btn primary', href: '#/account' }, 'Add bank account'));
      if (buyer && !o.rating) say(reviewBox());
      if (o.rating) say(h('p', {}, '★'.repeat(o.rating) + '☆'.repeat(5 - o.rating), o.review ? ` "${o.review}"` : ''));
    } else if (s === 'refunded') {
      say(h('h3', {}, buyer ? `${money(o.amount, o.currency)} refunded to you` : 'The buyer was refunded'),
        h('p', { class: 'small muted' }, o.refundStatus === 'failed' ? 'The refund hit a problem. Support will retry.' : 'Card refunds can take a few working days to show up at your bank.'));
    } else {
      say(h('h3', {}, 'This order was cancelled. No money was taken.'));
    }
    say(h('div', { class: 'err' }));

    function confirmRelease() {
      return confirm(`Release ${money(o.amount, o.currency)} to the seller? Only do this once you have the item and it's as described. This can't be undone.`) ? post('confirm') : null;
    }
    function disputeBtn() {
      const b = h('button', { class: 'btn danger' }, 'Report a problem');
      b.onclick = () => {
        const reason = h('textarea', { placeholder: 'What went wrong? e.g. not delivered, wrong item, fake, damaged.' });
        const send = act('Open dispute (freezes the money)', 'danger', () => post('dispute', { reason: reason.value }));
        b.replaceWith(h('div', { style: 'width:100%' }, h('label', {}, 'Describe the problem'), reason, h('div', { class: 'row' }, send), h('div', { class: 'err' })));
      };
      return b;
    }
    function reviewBox() {
      let rating = 0;
      const stars = h('div', { class: 'stars' });
      const draw = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map(n => h('button', { class: n <= rating ? 'on' : '', 'aria-label': `${n} stars`, onclick: () => { rating = n; draw(); } }, '★')));
      draw();
      const text = h('input', { placeholder: 'Say something about the seller (optional)' });
      return h('div', {}, h('label', {}, 'Rate the seller'), stars, text,
        h('div', { class: 'row' }, act('Post review', 'primary', () => { if (!rating) throw new Error('Pick 1 to 5 stars.'); return post('review', { rating, text: text.value }); })),
        h('div', { class: 'err' }));
    }

    const si = stepIndex(o);
    const msgInput = h('textarea', { placeholder: `Message the ${buyer ? 'seller' : 'buyer'}…`, style: 'min-height:60px' });
    const msgBtn = h('button', { class: 'btn' }, 'Send');
    msgBtn.onclick = busy(msgBtn, async () => { if (msgInput.value.trim()) { await post('messages', { body: msgInput.value }); reload(); } });
    const mine = buyer ? 'buyer' : 'seller';
    const chat = h('div', { class: 'chat' }, o.messages.length ? o.messages.map(m => h('div', { class: `msg ${m.from === mine ? 'me' : ''}` }, m.body)) : h('p', { class: 'small muted' }, 'No messages yet. Keep all talk here: it\'s evidence if anything goes wrong.'));

    view(
      demoBanner(),
      h('p', {}, h('a', { href: `#/orders?tab=${buyer ? 'buying' : 'selling'}` }, '← Your orders')),
      h('h1', {}, o.title),
      h('div', { class: 'row', style: 'align-items:center;margin-top:0' }, badge(o.status), h('span', { class: 'small muted' }, `Order ${o.ref} · ${buyer ? `Seller: ${o.seller.name}` : `Buyer: ${o.buyer}`}`)),
      ['refunded', 'cancelled'].includes(s) ? null : h('div', {},
        h('div', { class: 'stepper' }, STEPS.map((_, i) => h('div', { class: i < si ? 'on' : '' }))),
        h('div', { class: 'stepper-labels' }, STEPS.map(l => h('span', {}, l)))),
      h('div', { class: 'two', style: 'margin-top:16px' },
        h('div', {}, next,
          h('div', { class: 'panel' }, h('h3', {}, 'Messages'), chat, msgInput, h('div', { class: 'row' }, msgBtn), h('div', { class: 'err' }))),
        h('div', {},
          h('div', { class: 'panel' },
            h('div', { class: 'muted small' }, buyer ? 'You paid' : 'Buyer pays'), h('div', { class: 'money' }, money(o.amount, o.currency)),
            buyer ? null : h('div', { class: 'small muted' }, `You receive ${money(o.sellerGets, o.currency)} after the ${money(o.fee, o.currency)} fee`)),
          h('div', { class: 'panel' }, h('h3', {}, 'Timeline'),
            h('ul', { class: 'timeline' }, o.events.map(e => h('li', {}, h('div', {}, e.note || e.kind), h('div', { class: 'small muted' }, date(e.at)))))))),
    );
    chat.scrollTop = chat.scrollHeight;
  }

  async function account() {
    if (!me) return authPage();
    const banks = h('select', {}, h('option', { value: '' }, 'Loading banks…'));
    api('/v1/banks').then(list => banks.replaceChildren(h('option', { value: '' }, 'Choose your bank'), ...list.map(b => h('option', { value: b.code }, b.name))))
      .catch(e => banks.replaceChildren(h('option', { value: '' }, e.message)));
    const acct = h('input', { inputmode: 'numeric', maxlength: 20, placeholder: '10-digit account number' });
    const save = h('button', { class: 'btn primary' }, 'Verify & save');
    save.onclick = busy(save, async () => { me = await api('/v1/me/payout', { method: 'PUT', body: { bankCode: banks.value, accountNumber: acct.value.trim() } }); account(); });
    const out = h('button', { class: 'btn' }, 'Sign out');
    out.onclick = busy(out, async () => { await api('/v1/auth/logout', { method: 'POST' }).catch(() => {}); setToken(null); location.hash = '#/'; });

    const listings = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Loading…'));
    api('/v1/my/listings').then(list => listings.replaceChildren(...(list.length ? list.map(it => {
      const row = h('div', { class: 'orow' }, h('a', { class: 'grow', href: `#/item/${it.id}` }, h('div', { class: 't' }, it.title), h('div', { class: 'small muted' }, money(it.price, it.currency))),
        h('span', { class: 'badge' }, { active: 'For sale', reserved: 'In an order', sold: 'Sold', paused: 'Returned · not listed' }[it.status] || it.status));
      if (it.status === 'paused') { const b = h('button', { class: 'btn' }, 'Relist'); b.onclick = busy(b, async () => { await api(`/v1/listings/${it.id}/relist`, { method: 'POST' }); account(); }); row.append(b); }
      if (['active', 'paused'].includes(it.status)) { const b = h('button', { class: 'btn danger' }, 'Remove'); b.onclick = busy(b, async () => { if (confirm('Remove this listing?')) { await api(`/v1/listings/${it.id}`, { method: 'DELETE' }); account(); } }); row.append(b); }
      return row;
    }) : [h('p', { class: 'muted' }, 'You have no listings. ', h('a', { href: '#/sell' }, 'Sell something'))]))).catch(e => listings.replaceChildren(h('div', { class: 'banner bad' }, e.message)));

    view(
      h('h1', {}, `Hi, ${me.name.split(' ')[0]}`),
      h('div', { class: 'panel' }, h('h3', {}, 'Where we pay you'),
        me.payout ? h('p', {}, `${me.payout.accountName} · ${me.payout.accountNumber}`) : h('p', { class: 'muted small' }, 'Add the bank account your sales should be paid into. We check the account name with your bank.'),
        h('label', {}, 'Bank'), banks, h('label', {}, 'Account number'), acct, h('div', { class: 'row' }, save), h('div', { class: 'err' })),
      h('h2', {}, 'Your listings'), listings,
      h('div', { class: 'row', style: 'margin-top:24px' }, h('a', { class: 'btn', href: `#/seller/${me.id}` }, 'View your public profile'), out),
    );
  }

  function authPage() {
    let mode = 'login';
    const f = {
      name: h('input', { autocomplete: 'name', placeholder: 'Your full name' }),
      email: h('input', { type: 'email', autocomplete: 'email', required: true }),
      phone: h('input', { type: 'tel', autocomplete: 'tel', placeholder: 'Optional' }),
      password: h('input', { type: 'password', autocomplete: 'current-password', required: true, minlength: 8 }),
    };
    const btn = h('button', { class: 'btn primary block' });
    const swap = h('a', { href: '#' });
    const regOnly = h('div', {}, h('label', {}, 'Name'), f.name, h('label', {}, 'Phone'), f.phone);
    const title = h('h1', {});
    const draw = () => {
      const reg = mode === 'register';
      title.textContent = reg ? 'Create your account' : 'Sign in';
      btn.textContent = reg ? 'Create account' : 'Sign in';
      swap.textContent = reg ? 'I already have an account' : 'New here? Create an account';
      regOnly.hidden = !reg;
      f.password.autocomplete = reg ? 'new-password' : 'current-password';
    };
    swap.onclick = e => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); };
    const form = h('form', { class: 'panel', style: 'max-width:440px' }, regOnly, h('label', {}, 'Email'), f.email, h('label', {}, 'Password'), f.password, btn, h('div', { class: 'err' }), h('p', {}, swap));
    form.onsubmit = busy(btn, async () => {
      const body = mode === 'register'
        ? { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value }
        : { email: f.email.value, password: f.password.value };
      const r = await api(`/v1/auth/${mode}`, { body });
      setToken(r.token); me = r.user;
      const target = store.get('ts_next') || '#/'; store.set('ts_next', null);
      if (location.hash === target) route(); else location.hash = target;
    });
    draw();
    view(demoBanner(), title, form);
  }

  async function seller(id) {
    loading();
    let p;
    try { p = await api(`/v1/users/${id}`); } catch (e) { return fail(e); }
    view(
      h('h1', {}, p.name), trustCard(p),
      h('h2', {}, 'Reviews'),
      p.reviewList.length ? h('div', { class: 'list' }, p.reviewList.map(r => h('div', { class: 'panel', style: 'margin:0' },
        h('div', {}, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating), ' ', h('span', { class: 'small muted' }, `${r.buyer} · ${since(r.at)}`)), r.text ? h('p', { style: 'margin:4px 0 0' }, r.text) : null)))
        : h('p', { class: 'muted' }, 'No reviews yet.'),
      h('h2', {}, 'For sale'), p.listings.length ? h('div', { class: 'grid' }, p.listings.map(card)) : h('p', { class: 'muted' }, 'Nothing for sale right now.'),
    );
  }

  function how() {
    const c = cfg || { shipDays: 3, inspectionDays: 3, payWindowMin: 30, feePercent: 2.5 };
    const li = (t, d) => h('li', {}, h('b', {}, t), ' ', d);
    view(
      h('h1', {}, 'How Tradesafe escrow works'),
      h('div', { class: 'panel' }, h('ol', { style: 'padding-left:20px;margin:0;display:grid;gap:10px' },
        li('You pay Tradesafe, not the seller.', `Payment goes through Paystack (card, bank transfer or USSD) and we hold it. The item is reserved for you for ${c.payWindowMin} minutes while you pay.`),
        li('The seller sends the item.', `They can see the money is secured, so they can send with confidence. If they don't send within ${c.shipDays} days, you're refunded in full automatically.`),
        li('You check it and confirm.', `When it arrives and it's as described, tap "release payment". You have ${c.inspectionDays} days after it's marked as sent.`),
        li('The seller gets paid.', `We send the money straight to their verified bank account, minus a ${c.feePercent}% fee paid by the seller. Buyers pay no fee.`))),
      h('h2', {}, 'If something goes wrong'),
      h('div', { class: 'panel' }, h('ul', { style: 'padding-left:20px;margin:0;display:grid;gap:8px' },
        h('li', {}, 'Tap ', h('b', {}, 'Report a problem'), ' before you confirm. The money is frozen until support looks at it.'),
        h('li', {}, 'Keep all conversation in the order\'s messages and add photos and tracking numbers there. That\'s the evidence support reads.'),
        h('li', {}, 'Support either refunds you or pays the seller, and writes the reason on the order.'),
        h('li', {}, h('b', {}, 'Never pay outside Tradesafe'), ', even if a seller offers a discount for a direct transfer. That\'s the most common scam.'))),
      h('h2', {}, 'For sellers'),
      h('div', { class: 'panel' }, h('p', { style: 'margin:0' }, `Buyers trust escrow, so new sellers sell too. Add your bank account once, send within ${c.shipDays} days, and you're paid as soon as the buyer confirms, or automatically ${c.inspectionDays} days after sending if they report no problem.`)),
      h('a', { class: 'btn primary', href: '#/' }, 'Start shopping'),
    );
  }

  async function admin(params) {
    const tok = h('input', { type: 'password', placeholder: 'Admin token', value: store.get('ts_admin') || '' });
    const status = params.get('status') || 'disputed';
    const list = h('div', { class: 'list' });
    const saveTok = h('button', { class: 'btn' }, 'Use token');
    saveTok.onclick = () => { store.set('ts_admin', tok.value.trim() || null); admin(params); };
    view(h('h1', {}, 'Support desk'),
      h('div', { class: 'row' }, tok, saveTok),
      h('div', { class: 'tabs', style: 'margin-top:12px;flex-wrap:wrap' }, ['disputed', 'released', 'refunded', 'paid', 'shipped', 'all'].map(st =>
        h('a', { class: `btn ${st === status ? 'primary' : ''}`, href: `#/admin?status=${st}` }, st))),
      list);
    if (!store.get('ts_admin')) return;
    let rows;
    try { rows = await api(`/v1/admin/orders?status=${status}`, { admin: true }); } catch (e) { return list.replaceChildren(h('div', { class: 'banner bad' }, e.message)); }
    list.replaceChildren(...(rows.length ? rows.map(o => {
      const note = h('input', { placeholder: 'Decision and reason (shown to both sides)' });
      const decide = outcome => { const b = h('button', { class: `btn ${outcome === 'refund' ? 'danger' : 'primary'}` }, outcome === 'refund' ? 'Refund buyer' : 'Pay seller');
        b.onclick = busy(b, async () => { if (confirm(`${b.textContent} for ${o.ref}?`)) { await api(`/v1/admin/orders/${o.id}/resolve`, { admin: true, body: { outcome, note: note.value } }); admin(params); } }); return b; };
      const retry = h('button', { class: 'btn' }, 'Retry transfer');
      retry.onclick = busy(retry, async () => { await api(`/v1/admin/orders/${o.id}/retry`, { admin: true, method: 'POST' }); admin(params); });
      return h('div', { class: 'panel', style: 'margin:0' },
        h('div', { class: 'row', style: 'margin:0;justify-content:space-between' }, h('b', {}, `${o.title} · ${money(o.amount, o.currency)}`), badge(o.status)),
        h('div', { class: 'small muted' }, `${o.ref} · buyer ${o.buyer} <${o.buyerEmail}> · seller ${o.seller.name} <${o.sellerEmail}>`),
        o.disputeReason ? h('p', {}, h('b', {}, 'Dispute: '), o.disputeReason) : null,
        h('details', {}, h('summary', {}, `Timeline & ${o.messages.length} messages`),
          h('ul', { class: 'timeline' }, o.events.map(e => h('li', {}, `${date(e.at)} · ${e.note || e.kind}`))),
          o.messages.map(m => h('p', { class: 'small' }, h('b', {}, `${m.from}: `), m.body)),
          h('p', { class: 'small' }, h('b', {}, 'Address: '), o.deliveryAddress, o.shipNote ? ` · Shipping note: ${o.shipNote}` : '')),
        o.status === 'disputed' ? h('div', {}, note, h('div', { class: 'row' }, decide('refund'), decide('release')), h('div', { class: 'err' })) : null,
        o.payoutStatus === 'failed' || o.refundStatus === 'failed' ? h('div', {}, h('div', { class: 'row' }, retry), h('div', { class: 'err' })) : null);
    }) : [h('p', { class: 'empty' }, 'Nothing here.')]));
  }

  // ------------------------------------------------------------ router

  async function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(query);
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (parts[0] || '') || (a.dataset.r === 'orders' && parts[0] === 'orders')));
    try {
      if (!cfg && API) cfg = await api('/v1/health').catch(() => null);
      if (token && !me) me = await api('/v1/me').catch(() => null);
    } catch { /* shown by the page itself */ }
    switch (parts[0]) {
      case 'item': return item(parts[1]);
      case 'sell': return sell();
      case 'orders': return parts[1] ? order(parts[1]) : orders(params);
      case 'account': return account();
      case 'seller': return seller(parts[1]);
      case 'how': return how();
      case 'admin': return admin(params);
      default: return home(params);
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
