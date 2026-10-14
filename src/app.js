(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ed = $('ed'), titleEl = $('title'), stage = $('stage'), detail = $('detail');
  var DRAFT = 'btl-orgchart-draft';

  var SAMPLE = [
    'Георги Стоянов | Изпълнителен директор | g.stoyanov@example.bg',
    '  Мария Колева | Финансов директор',
    '    Ивайло Петров | Главен счетоводител',
    '      Десислава Ненова | Счетоводител',
    '      Борислав Тодоров | Счетоводител',
    '    Теодора Маринова | Финансов контрольор',
    '  Николай Димитров | Директор Операции',
    '    Радостин Христов | Мениджър Логистика',
    '      Петър Алексиев | Ръководител склад',
    '        Стела Йорданова | Складов оператор',
    '        Калоян Илиев | Складов оператор',
    '        Виолета Георгиева | Складов оператор',
    '      Добрин Атанасов | Ръководител транспорт',
    '        Емил Борисов | Шофьор',
    '        Явор Събев | Шофьор',
    '    Силвия Андонова | Мениджър Качество',
    '      Нели Василева | Специалист качество',
    '      Анжела Стефанова | Специалист качество',
    '  Елена Радева | Директор Продажби',
    '    Христо Пенчев | Регионален мениджър Север',
    '      Мартин Ангелов | Търговски представител',
    '      Ивана Куманова | Търговски представител',
    '    Ралица Тенева | Регионален мениджър Юг',
    '      Венцислав Русев | Търговски представител',
    '      Гергана Попова | Търговски представител',
    '    Александър Белев | Key Account Manager',
    '  Виктор Събчев | Директор Човешки ресурси',
    '    Полина Дончева | HR бизнес партньор',
    '    Деница Цветанова | Специалист подбор',
    '    Любомир Наков | Специалист обучение',
    '  Анна Върбанова | ИТ директор',
    '    Стоян Илчев | Системен администратор',
    '    Кристина Бонева | Разработчик',
    '    Димо Гочев | Разработчик'
  ].join('\n');

  /* ---------- outline <-> tree ---------- */
  function parseOutline(text, docTitle) {
    var lines = text.split('\n'), stack = [], roots = [], warn = [];
    lines.forEach(function (raw, i) {
      if (!raw.trim()) return;
      var m = raw.match(/^[ \t]*/)[0], ind = 0, c;
      for (c = 0; c < m.length; c++) ind += m[c] === '\t' ? 2 : 1;
      var f = raw.trim().split('|').map(function (s) { return s.trim(); });
      var node = { name: f[0] || '—', title: f[1] || '', email: f[2] || '', phone: f[3] || '', children: [], _line: i, _ind: ind };
      while (stack.length && stack[stack.length - 1]._ind >= ind) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node); else roots.push(node);
      stack.push(node);
    });
    var root;
    if (roots.length === 1) root = roots[0];
    else root = { name: docTitle || 'Организация', title: roots.length ? '' : 'Добавете хора в панела вляво', children: roots, _line: -1, virtual: true };
    if (roots.length > 1) warn.push('Има ' + roots.length + ' върха — те са групирани под „' + root.name + '“.');
    return { root: root, warn: warn };
  }

  function plain(n) {
    return { name: n.name, title: n.title, email: n.email, phone: n.phone, children: n.children.map(plain) };
  }

  function toOutline(n, depth, out) {
    out.push('  '.repeat(depth) + [n.name, n.title, n.email, n.phone].join(' | ').replace(/(\s\|\s)+$/, ''));
    n.children.forEach(function (c) { toOutline(c, depth + 1, out); });
    return out;
  }

  /* ---------- chart ---------- */
  var selecting = false;
  var chart = new OrgChart(stage, {
    layout: 'lr',
    onSelect: function (n) {
      if (selecting) return;
      if (!n) { detail.classList.remove('show'); return; }
      detail.innerHTML = '<button class="close" aria-label="Затвори">×</button>' + OrgChart.detailHTML(n);
      detail.classList.add('show');
      detail.querySelector('.close').onclick = function () { chart.select(null); };
      if (n._line >= 0) gotoLine(n._line);
    }
  });

  function lineStart(idx) {
    var v = ed.value, p = 0;
    while (idx-- > 0) { p = v.indexOf('\n', p) + 1; if (p === 0) return v.length; }
    return p;
  }
  function gotoLine(idx) {
    var s = lineStart(idx), e = ed.value.indexOf('\n', s);
    if (e < 0) e = ed.value.length;
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(e, e);
    ed.scrollTop = Math.max(0, idx * 22 - ed.clientHeight / 2);
    lastLine = idx;
  }
  function caretLine() { return ed.value.slice(0, ed.selectionStart).split('\n').length - 1; }

  var lastLine = -1, tmr;
  function refresh(first) {
    var res = parseOutline(ed.value, titleEl.value);
    var sel = chart.selected ? chart.selected._line : -1;
    chart.setData(res.root);
    var again = sel >= 0 ? chart.find(function (n) { return n._line === sel; }) : null;
    if (again) { chart.selected = again; chart.render(); }
    $('count').textContent = chart.all.filter(function (n) { return !n.virtual; }).length + ' души · ' + (chart.maxDepth + 1) + ' нива';
    $('warn').textContent = res.warn.join(' ');
    fillLevels();
    if (first) autoCollapse();
    try { localStorage.setItem(DRAFT, JSON.stringify({ title: titleEl.value, text: ed.value })); } catch (e) {}
  }
  function fillLevels() {
    var v = $('lvl').value, html = '<option value="-1">Всички нива</option>';
    for (var i = 1; i <= chart.maxDepth; i++) html += '<option value="' + i + '">Свий след ниво ' + i + '</option>';
    $('lvl').innerHTML = html;
    $('lvl').value = v && $('lvl').querySelector('option[value="' + v + '"]') ? v : '-1';
    $('xlvl').innerHTML = html.replace('Всички нива', 'Всичко разгънато');
  }
  function autoCollapse() {
    if (chart.all.length > 80) { $('lvl').value = '2'; chart.collapseToLevel(2); } else chart.fit();
  }
  function schedule() { clearTimeout(tmr); tmr = setTimeout(function () { refresh(false); }, 140); }

  ed.addEventListener('input', schedule);
  titleEl.addEventListener('input', schedule);
  function onCaret() {
    var l = caretLine();
    if (l === lastLine) return;
    lastLine = l;
    var n = chart.find(function (x) { return x._line === l; });
    if (!n) return;
    selecting = true;
    chart.select(n, true);
    selecting = false;
    detail.innerHTML = '<button class="close" aria-label="Затвори">×</button>' + OrgChart.detailHTML(n);
    detail.classList.add('show');
    detail.querySelector('.close').onclick = function () { chart.select(null); };
  }
  ed.addEventListener('click', onCaret);
  ed.addEventListener('keyup', function (e) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].indexOf(e.key) >= 0) onCaret();
  });

  ed.addEventListener('keydown', function (e) {
    var v = ed.value, s = ed.selectionStart, en = ed.selectionEnd;
    if (e.key === 'Tab') {
      e.preventDefault();
      var a = v.lastIndexOf('\n', s - 1) + 1, b = en;
      if (b > s && v[b - 1] === '\n') b--;
      var blockEnd = v.indexOf('\n', b); if (blockEnd < 0) blockEnd = v.length;
      var block = v.slice(a, blockEnd).split('\n');
      var out = block.map(function (l) { return e.shiftKey ? l.replace(/^(\t|  ?)/, '') : '  ' + l; });
      var diffFirst = out[0].length - block[0].length;
      ed.setRangeText(out.join('\n'), a, blockEnd, 'preserve');
      ed.setSelectionRange(Math.max(a, s + diffFirst), a + out.join('\n').length - (blockEnd - en > 0 ? 0 : 0));
      if (s === en) ed.setSelectionRange(Math.max(a, s + diffFirst), Math.max(a, s + diffFirst));
      schedule();
    } else if (e.key === 'Enter' && s === en) {
      e.preventDefault();
      var ls = v.lastIndexOf('\n', s - 1) + 1, cur = v.slice(ls, s);
      var ind = cur.match(/^[ \t]*/)[0] + (e.ctrlKey || e.metaKey ? '  ' : '');
      ed.setRangeText('\n' + ind, s, en, 'end');
      schedule(); onCaretSoon();
    }
  });
  function onCaretSoon() { setTimeout(onCaret, 0); }

  /* ---------- toolbar ---------- */
  $('zi').onclick = function () { chart.zoomBy(1.3); };
  $('zo').onclick = function () { chart.zoomBy(1 / 1.3); };
  $('fit').onclick = function () { chart.fit(true); };
  $('tog').onclick = function () { $('side').classList.toggle('hide'); setTimeout(function () { chart.fit(true); }, 30); };
  $('lvl').onchange = function () { var v = +$('lvl').value; v < 0 ? chart.expandAll() : chart.collapseToLevel(v); };
  var lay = $('lay');
  Array.prototype.forEach.call(lay.children, function (b) {
    b.onclick = function () {
      Array.prototype.forEach.call(lay.children, function (x) { x.classList.toggle('on', x === b); });
      chart.setLayout(b.dataset.m);
    };
  });
  var q = $('q'), mc = $('mc');
  q.oninput = function () { var c = chart.search(q.value); mc.textContent = q.value ? (c ? '1/' + c : '0 намерени') : ''; };
  q.onkeydown = function (e) { if (e.key === 'Enter') { var i = chart.next(); if (i) mc.textContent = i + '/' + chart.matches.length; } };

  /* ---------- files ---------- */
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function fname(ext) { return (titleEl.value.trim() || 'organigrama').replace(/[\\/:*?"<>|]+/g, '_') + ext; }
  function readFile(file, cb) { var r = new FileReader(); r.onload = function () { cb(String(r.result)); }; r.readAsText(file, 'utf-8'); }

  $('save').onclick = function () {
    download(fname('.json'), new Blob([JSON.stringify({ app: 'btl-orgchart', v: 1, title: titleEl.value, text: ed.value }, null, 1)], { type: 'application/json' }));
  };
  $('open').onclick = function () { $('fopen').click(); };
  $('fopen').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    readFile(f, function (t) {
      try { var d = JSON.parse(t); ed.value = d.text; titleEl.value = d.title || 'Органиграма'; chart.selected = null; chart.collapsed.clear(); refresh(true); }
      catch (err) { alert('Файлът не е валидна органиграма.'); }
    });
    e.target.value = '';
  };

  function parseCSV(t) {
    var first = t.split('\n')[0], d = [';', '\t', ','].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = '', inq = false, i, c;
    t = t.replace(/^﻿/, '');
    for (i = 0; i < t.length; i++) {
      c = t[i];
      if (inq) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += c; }
      else if (c === '"') inq = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function csvToOutline(t) {
    var rows = parseCSV(t), h = rows[0].map(function (x) { return x.trim().toLowerCase(); });
    function col(re, def) { var i = h.findIndex(function (x) { return re.test(x); }); return i >= 0 ? i : def; }
    var hasHead = h.some(function (x) { return /име|name|длъжност|title|position|началник|manager|шеф|parent/.test(x); });
    var cn = hasHead ? col(/име|name/, 0) : 0, ct = hasHead ? col(/длъжност|title|position/, 1) : 1,
        cm = hasHead ? col(/началник|ръководител|manager|шеф|parent|boss/, 2) : 2,
        ce = hasHead ? col(/имейл|email|e-mail|поща/, 3) : 3, cp = hasHead ? col(/телефон|phone|тел/, 4) : 4;
    if (hasHead) rows = rows.slice(1);
    var byName = {}, list = rows.map(function (r) {
      var o = { name: (r[cn] || '').trim(), title: (r[ct] || '').trim(), mgr: (r[cm] || '').trim(), email: (r[ce] || '').trim(), phone: (r[cp] || '').trim(), children: [] };
      byName[o.name] = o; return o;
    }).filter(function (o) { return o.name; });
    var roots = [];
    list.forEach(function (o) {
      var p = o.mgr && byName[o.mgr];
      var loop = false, x = p;
      for (var g = 0; x && g < 1000; g++) { if (x === o) { loop = true; break; } x = byName[x.mgr]; }
      if (p && p !== o && !loop) p.children.push(o); else roots.push(o);
    });
    return roots.map(function (r) { return toOutline(r, 0, []).join('\n'); }).join('\n');
  }
  $('csv').onclick = function () { $('fcsv').click(); };
  $('fcsv').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    readFile(f, function (t) {
      try { ed.value = csvToOutline(t); chart.selected = null; chart.collapsed.clear(); refresh(true); }
      catch (err) { alert('Неуспешен импорт на CSV.'); }
    });
    e.target.value = '';
  };

  /* ---------- export ---------- */
  var modal = $('modal');
  $('export').onclick = function () { $('xmsg').textContent = ''; modal.hidden = false; };
  $('xcancel').onclick = function () { modal.hidden = true; };
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });
  $('xenc').onchange = function () { $('xpwrow').style.display = $('xenc').checked ? 'flex' : 'none'; };
  $('xgen').onclick = function () {
    var al = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(14)), s = '';
    for (var i = 0; i < b.length; i++) { s += al[b[i] % al.length]; if (i === 4 || i === 9) s += '-'; }
    $('xpw').value = s;
  };
  function esc(s) { return OrgChart.esc(s); }
  function safeJSON(o) { return JSON.stringify(o).split('<').join(String.fromCharCode(92) + 'u003c'); }

  $('xgo').onclick = function () {
    var enc = $('xenc').checked, pw = $('xpw').value, A = window.__ASSETS;
    if (enc && pw.length < 6) { $('xmsg').style.color = '#b00020'; $('xmsg').textContent = 'Паролата трябва да е поне 6 знака.'; return; }
    if (!enc && !confirm('Файлът ще е без парола — всеки, който го получи, ще вижда всичко. Продължавате ли?')) return;
    $('xmsg').style.color = '#00805f'; $('xmsg').textContent = 'Създавам…';
    var res = parseOutline(ed.value, titleEl.value);
    var cfg = {
      title: titleEl.value.trim() || 'Органиграма', root: plain(res.root), layout: chart.o.layout,
      watermark: $('xwm').value.trim(), expires: $('xexp').value, startLevel: +$('xlvl').value
    };
    var done = function (payload) {
      var map = {
        __TITLE__: esc(enc ? 'Защитена органиграма' : cfg.title), __CSS__: A.css, __CRYPTO__: A.crypto,
        __CHART__: A.chart, __PAYLOAD__: safeJSON(payload)
      };
      var html = A.viewer.replace(/__(TITLE|CSS|CRYPTO|CHART|PAYLOAD)__/g, function (m) { return map[m]; });
      download(fname('.html'), new Blob([html], { type: 'text/html' }));
      $('xmsg').textContent = 'Готово — файлът е изтеглен' + (enc ? '. Паролата: ' + pw : '.');
    };
    if (enc) OCCrypto.encrypt(JSON.stringify(cfg), pw).then(function (p) { p.enc = true; done(p); })
      .catch(function (e) { $('xmsg').style.color = '#b00020'; $('xmsg').textContent = 'Грешка: ' + e.message; });
    else done({ enc: false, data: cfg });
  };
  $('xsvg').onclick = function () { download(fname('.svg'), new Blob([chart.toSVG().svg], { type: 'image/svg+xml' })); };
  $('xpng').onclick = function () {
    var o = chart.toSVG(), sc = Math.min(2, 16000 / Math.max(o.width, o.height)), img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = Math.round(o.width * sc); c.height = Math.round(o.height * sc);
      var x = c.getContext('2d'); x.scale(sc, sc); x.drawImage(img, 0, 0);
      c.toBlob(function (b) { download(fname('.png'), b); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(o.svg);
  };

  /* ---------- start ---------- */
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) {}
  if (saved && saved.text) { ed.value = saved.text; titleEl.value = saved.title || 'Органиграма'; }
  else { ed.value = SAMPLE; titleEl.value = 'БТЛ — примерна структура'; }
  refresh(true);
  $('xwm').value = '';
})();
