/* OrgChart engine — shared by the editor and the exported viewer (no dependencies). */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var PALETTE = ['#0a6cff', '#00b4e6', '#00a88f', '#5b5bd6', '#e8590c', '#c2255c', '#2f9e44', '#9c36b5'];
  var INK = '#0a1a33', MIST = '#45556a', ASH = '#6b7a8c', LINE = '#d5deea';
  var FONT = "'Noto Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  var W = 236, H = 68, GAP_B = 18, GAP_D = 58;

  function svg(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clip(s, n) { s = s || ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function initials(name) {
    var p = (name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function OrgChart(container, opts) {
    this.o = Object.assign({ layout: 'lr', onSelect: null }, opts || {});
    this.container = container;
    this.root = null;
    this.collapsed = new Set();
    this.selected = null;
    this.matches = [];
    this.matchIdx = -1;
    this.query = '';
    this.t = { x: 40, y: 40, k: 1 };
    this.nodes = [];
    this.svg = svg('svg', { width: '100%', height: '100%', class: 'oc-svg' }, container);
    this.vp = svg('g', { class: 'oc-vp' }, this.svg);
    this.gEdges = svg('g', null, this.vp);
    this.gNodes = svg('g', null, this.vp);
    this._bind();
  }

  var P = OrgChart.prototype;

  /* ---------- data ---------- */
  P.setData = function (root) {
    this.root = root;
    this._index();
    this.render();
  };

  P._index = function () {
    var list = [], id = 0, bc = 0;
    (function walk(n, parent, depth, path, branch) {
      n._id = id++;
      n._parent = parent;
      n._depth = depth;
      n._path = path;
      n.children = n.children || [];
      if (depth === 1) branch = bc++;
      n._branch = depth === 0 ? -1 : branch;
      list.push(n);
      var cnt = 0;
      n.children.forEach(function (c) {
        walk(c, n, depth + 1, path + '›' + c.name, branch);
        cnt += 1 + c._count;
      });
      n._count = cnt;
    })(this.root, null, 0, this.root.name, 0);
    this.all = list;
    this.maxDepth = list.reduce(function (m, n) { return Math.max(m, n._depth); }, 0);
  };

  P.color = function (n) { return n._branch < 0 ? INK : PALETTE[n._branch % PALETTE.length]; };

  /* ---------- layout ---------- */
  P._layout = function () {
    var lr = this.o.layout === 'lr';
    var bs = lr ? H : W, ds = lr ? W : H, self = this, vis = [];
    function kids(n) { return self.collapsed.has(n._path) ? [] : n.children; }
    function ext(n) {
      var k = kids(n);
      if (!k.length) return (n._ext = bs);
      var sum = 0;
      k.forEach(function (c) { sum += ext(c); });
      sum += GAP_B * (k.length - 1);
      return (n._ext = Math.max(bs, sum));
    }
    function place(n, start, depth) {
      var k = kids(n);
      n._vis = true;
      vis.push(n);
      var d = depth * (ds + GAP_D);
      if (!k.length) n._b = start + n._ext / 2;
      else {
        var total = 0;
        k.forEach(function (c) { total += c._ext; });
        total += GAP_B * (k.length - 1);
        var s = start + (n._ext - total) / 2;
        k.forEach(function (c) { place(c, s, depth + 1); s += c._ext + GAP_B; });
        n._b = (k[0]._b + k[k.length - 1]._b) / 2;
      }
      n.cx = lr ? d + ds / 2 : n._b;
      n.cy = lr ? n._b : d + ds / 2;
    }
    this.all.forEach(function (n) { n._vis = false; });
    ext(this.root);
    place(this.root, 0, 0);
    this.nodes = vis;
    var b = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 };
    vis.forEach(function (n) {
      b.x1 = Math.min(b.x1, n.cx - W / 2); b.x2 = Math.max(b.x2, n.cx + W / 2 + 14);
      b.y1 = Math.min(b.y1, n.cy - H / 2); b.y2 = Math.max(b.y2, n.cy + H / 2 + 14);
    });
    this.bbox = b;
  };

  /* ---------- render ---------- */
  P.render = function (fade) {
    if (!this.root) return;
    this._layout();
    var self = this, lr = this.o.layout === 'lr', mset = new Set(this.matches);
    this.gEdges.textContent = '';
    this.gNodes.textContent = '';
    this.svg.classList.toggle('oc-fade', !!fade);

    this.nodes.forEach(function (n) {
      if (!n._parent) return;
      var p = n._parent, x1, y1, x2, y2, d;
      if (lr) {
        x1 = p.cx + W / 2; y1 = p.cy; x2 = n.cx - W / 2; y2 = n.cy;
        var xm = (x1 + x2) / 2;
        d = 'M' + x1 + ',' + y1 + ' C' + xm + ',' + y1 + ' ' + xm + ',' + y2 + ' ' + x2 + ',' + y2;
      } else {
        x1 = p.cx; y1 = p.cy + H / 2; x2 = n.cx; y2 = n.cy - H / 2;
        var ym = (y1 + y2) / 2;
        d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + ym + ' ' + x2 + ',' + ym + ' ' + x2 + ',' + y2;
      }
      svg('path', { d: d, fill: 'none', stroke: self.color(n), 'stroke-opacity': '.45', 'stroke-width': '2' }, self.gEdges);
    });

    this.nodes.forEach(function (n) {
      var col = self.color(n), root = n._depth === 0;
      var g = svg('g', { class: 'oc-node', transform: 'translate(' + (n.cx - W / 2) + ',' + (n.cy - H / 2) + ')' }, self.gNodes);
      g._node = n;
      var sel = self.selected === n, hit = mset.has(n);
      svg('rect', {
        width: W, height: H, rx: 16,
        fill: root ? INK : '#ffffff',
        stroke: hit ? '#f59f00' : sel ? '#0a6cff' : LINE,
        'stroke-width': hit || sel ? 3 : 1.5
      }, g);
      svg('circle', { cx: 34, cy: H / 2, r: 20, fill: root ? '#ffffff' : col }, g);
      svg('text', {
        x: 34, y: H / 2 + 5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700,
        fill: root ? INK : '#fff', 'font-family': FONT
      }, g, initials(n.name));
      svg('text', {
        x: 64, y: H / 2 - 4, 'font-size': 14, 'font-weight': 700,
        fill: root ? '#fff' : INK, 'font-family': FONT
      }, g, clip(n.name, 22));
      svg('text', {
        x: 64, y: H / 2 + 14, 'font-size': 11.5,
        fill: root ? '#b7c6dc' : MIST, 'font-family': FONT
      }, g, clip(n.title, 28));
      svg('title', null, g, n.name + (n.title ? ' — ' + n.title : ''));
      if (n.children.length) {
        var col2 = self.collapsed.has(n._path);
        var tx = lr ? W : W / 2, ty = lr ? H / 2 : H;
        var t = svg('g', { class: 'oc-toggle', transform: 'translate(' + tx + ',' + ty + ')' }, g);
        svg('circle', { r: 12, fill: col2 ? col : '#fff', stroke: col === INK ? '#0a6cff' : col, 'stroke-width': 2 }, t);
        svg('text', {
          y: 4, 'text-anchor': 'middle', 'font-size': col2 ? 10.5 : 15, 'font-weight': 700,
          fill: col2 ? '#fff' : (col === INK ? '#0a6cff' : col), 'font-family': FONT
        }, t, col2 ? String(n._count) : '−');
        t._toggle = n;
      }
    });
    this._applyT();
  };

  /* ---------- camera ---------- */
  P._applyT = function () {
    this.vp.style.transform = 'translate(' + this.t.x + 'px,' + this.t.y + 'px) scale(' + this.t.k + ')';
  };
  P._anim = function () {
    var vp = this.vp;
    vp.style.transition = 'transform .38s cubic-bezier(.2,.7,.2,1)';
    clearTimeout(this._at);
    this._at = setTimeout(function () { vp.style.transition = 'none'; }, 420);
  };
  P.fit = function (animate) {
    if (!this.bbox) return;
    var r = this.container.getBoundingClientRect(), b = this.bbox, pad = 40;
    var bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    var k = Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh, 1.1);
    k = Math.max(k, 0.05);
    if (animate) this._anim();
    this.t = { k: k, x: (r.width - bw * k) / 2 - b.x1 * k, y: (r.height - bh * k) / 2 - b.y1 * k };
    this._applyT();
  };
  P.centerOn = function (n, k) {
    var r = this.container.getBoundingClientRect();
    k = k || Math.max(this.t.k, 0.9);
    this._anim();
    this.t = { k: k, x: r.width / 2 - n.cx * k, y: r.height / 2 - n.cy * k };
    this._applyT();
  };
  P.zoomBy = function (f, cx, cy) {
    var r = this.container.getBoundingClientRect();
    cx = cx == null ? r.width / 2 : cx; cy = cy == null ? r.height / 2 : cy;
    var k = Math.min(3, Math.max(0.04, this.t.k * f)), s = k / this.t.k;
    this.t = { k: k, x: cx - (cx - this.t.x) * s, y: cy - (cy - this.t.y) * s };
    this._applyT();
  };

  /* ---------- structure controls ---------- */
  P.setLayout = function (mode) { this.o.layout = mode; this.render(); this.fit(true); };
  P.collapseToLevel = function (lvl) {
    var self = this;
    this.collapsed.clear();
    this.all.forEach(function (n) { if (n._depth >= lvl && n.children.length) self.collapsed.add(n._path); });
    this.render(true); this.fit(true);
  };
  P.expandAll = function () { this.collapsed.clear(); this.render(true); this.fit(true); };
  P.toggle = function (n) {
    if (this.collapsed.has(n._path)) this.collapsed.delete(n._path); else this.collapsed.add(n._path);
    this.render(true);
  };
  P.reveal = function (n) {
    for (var p = n._parent; p; p = p._parent) this.collapsed.delete(p._path);
  };
  P.select = function (n, center) {
    this.selected = n;
    if (n) this.reveal(n);
    this.render();
    if (n && center) this.centerOn(n);
    if (this.o.onSelect) this.o.onSelect(n);
  };
  P.find = function (pred) { return this.all.filter(pred)[0]; };

  /* ---------- search ---------- */
  P.search = function (q) {
    q = (q || '').trim().toLowerCase();
    this.query = q;
    var self = this;
    this.matches = q ? this.all.filter(function (n) {
      return (n.name + ' ' + (n.title || '') + ' ' + (n.email || '') + ' ' + (n.phone || '')).toLowerCase().indexOf(q) >= 0;
    }) : [];
    this.matches.forEach(function (n) { self.reveal(n); });
    this.matchIdx = -1;
    this.render(true);
    if (this.matches.length) this.next();
    return this.matches.length;
  };
  P.next = function () {
    if (!this.matches.length) return;
    this.matchIdx = (this.matchIdx + 1) % this.matches.length;
    var n = this.matches[this.matchIdx];
    this.reveal(n);
    this.render();
    this.centerOn(n, Math.max(this.t.k, 0.9));
    return this.matchIdx + 1;
  };

  /* ---------- pointer input ---------- */
  P._bind = function () {
    var self = this, s = this.svg, drag = null;
    s.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, tx: self.t.x, ty: self.t.y, moved: false };
      s.setPointerCapture(e.pointerId);
      self.vp.style.transition = 'none';
    });
    s.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { self.t.x = drag.tx + dx; self.t.y = drag.ty + dy; self._applyT(); s.classList.add('oc-drag'); }
    });
    function end(e) {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      s.classList.remove('oc-drag');
      if (moved) return;
      var t = e.target, tg = null, nd = null;
      while (t && t !== s) {
        if (t._toggle && !tg) tg = t._toggle;
        if (t._node) { nd = t._node; break; }
        t = t.parentNode;
      }
      if (tg) self.toggle(tg);
      else if (nd) self.select(nd, false);
      else if (self.selected) self.select(null);
    }
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', function () { drag = null; });
    s.addEventListener('dblclick', function (e) {
      var t = e.target;
      while (t && t !== s) {
        if (t._node) { if (t._node.children.length) self.toggle(t._node); return; }
        t = t.parentNode;
      }
    });
    s.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = s.getBoundingClientRect();
      self.vp.style.transition = 'none';
      self.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    window.addEventListener('resize', function () { if (self.root) self.fit(); });
  };

  /* ---------- export helpers ---------- */
  P.toSVG = function () {
    var self = this, saveSel = this.selected, saveM = this.matches;
    this.selected = null; this.matches = [];
    this.render();
    var b = this.bbox, pad = 30, w = b.x2 - b.x1 + pad * 2 - 14, h = b.y2 - b.y1 + pad * 2 - 14;
    var clone = this.vp.cloneNode(true);
    clone.style.transform = '';
    clone.setAttribute('transform', 'translate(' + (pad - b.x1) + ',' + (pad - b.y1) + ')');
    Array.prototype.forEach.call(clone.querySelectorAll('.oc-toggle'), function (t) { t.remove(); });
    var out = '<svg xmlns="' + NS + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<rect width="100%" height="100%" fill="#ffffff"/>' + new XMLSerializer().serializeToString(clone) + '</svg>';
    this.selected = saveSel; this.matches = saveM;
    this.render();
    return { svg: out, width: w, height: h };
  };

  OrgChart.detailHTML = function (n) {
    var rows = '';
    if (n.title) rows += '<div class="d-title">' + esc(n.title) + '</div>';
    if (n.email) rows += '<div class="d-row"><span>Имейл</span><a href="mailto:' + esc(n.email) + '">' + esc(n.email) + '</a></div>';
    if (n.phone) rows += '<div class="d-row"><span>Телефон</span><a href="tel:' + esc(n.phone) + '">' + esc(n.phone) + '</a></div>';
    if (n._parent) rows += '<div class="d-row"><span>Пряк ръководител</span><b>' + esc(n._parent.name) + '</b></div>';
    if (n.children.length) rows += '<div class="d-row"><span>Подчинени</span><b>' + n.children.length + ' директни · ' + n._count + ' общо</b></div>';
    return '<h3>' + esc(n.name) + '</h3>' + rows;
  };
  OrgChart.esc = esc;
  OrgChart.initials = initials;

  global.OrgChart = OrgChart;
})(window);
