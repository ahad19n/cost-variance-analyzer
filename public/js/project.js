/* global Chart */
(function () {
  'use strict';

  const root = document.getElementById('project');
  if (!root) return;
  const projectId = root.dataset.projectId;
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const base = `/projects/${projectId}`;

  const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (p) => (p === null ? 'n/a' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf, ...(opts.headers || {}) },
    });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : null;
    if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
    return body;
  }

  // ---------------------------------------------------------------- Charts

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const screenTheme = () => ({
    est: css('--series-est'), act: css('--series-act'), over: css('--over'), under: css('--under'),
    flag: css('--flag'), ink: css('--ink-2'), muted: css('--muted'), grid: css('--grid'), axis: css('--axis'), surface: css('--surface'),
  });
  // Exported (PDF) charts are always rendered in the light palette on a white background.
  const printTheme = {
    est: '#2a78d6', act: '#eb6834', over: '#e34948', under: '#2a78d6', flag: '#c98500',
    ink: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#ffffff',
  };

  const whiteBg = {
    id: 'whiteBg',
    beforeDraw(chart, _a, opts) {
      if (!opts.color) return;
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = opts.color;
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };

  function baseOptions(th, { horizontal = false, valueFmt = money } = {}) {
    const valueAxis = {
      grid: { color: th.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: th.muted, padding: 6, callback: (v) => valueFmt(v).replace(/\.00$/, '') },
    };
    const catAxis = {
      grid: { display: false },
      border: { color: th.axis },
      ticks: { color: th.ink, autoSkip: false, maxRotation: 0, callback(v) { const l = this.getLabelForValue(v); return l.length > 22 ? `${l.slice(0, 21)}…` : l; } },
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false }, // HTML legend above each chart
        whiteBg: { color: th.surface === '#ffffff' ? '#ffffff' : null },
        tooltip: { padding: 10, cornerRadius: 6, boxPadding: 4 },
      },
      scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    };
  }

  const bar = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36, borderWidth: 0 };

  function categoryChart(canvas, data, th, extra = {}) {
    const cats = data.byCategory;
    const opts = baseOptions(th);
    opts.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${money(c.raw)}` };
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: cats.map((c) => c.category),
        datasets: [
          { label: 'Estimated', data: cats.map((c) => c.estimated), backgroundColor: th.est, ...bar },
          { label: 'Actual', data: cats.map((c) => c.actual), backgroundColor: th.act, ...bar },
        ],
      },
      options: { ...opts, ...extra, datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.92 } } },
      plugins: [whiteBg],
    });
  }

  function varianceChart(canvas, data, th, extra = {}) {
    const cats = [...data.byCategory].sort((a, b) => b.variance - a.variance);
    const opts = baseOptions(th, { horizontal: true });
    opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
    opts.plugins.tooltip.callbacks = {
      label: (c) => { const r = cats[c.dataIndex]; return ` Variance: ${r.variance > 0 ? '+' : ''}${money(r.variance)} (${pct(r.variancePct)})`; },
      afterLabel: (c) => { const r = cats[c.dataIndex]; return ` Est ${money(r.estimated)} · Act ${money(r.actual)}`; },
    };
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: cats.map((c) => c.category),
        datasets: [{ label: 'Variance', data: cats.map((c) => c.variance), backgroundColor: cats.map((c) => (c.variance > 0 ? th.over : th.under)), ...bar }],
      },
      options: { ...opts, ...extra },
      plugins: [whiteBg],
    });
  }

  function itemsChart(canvas, data, th, extra = {}) {
    const flagged = new Set(data.anomalies.map((a) => a.id));
    const rows = data.lines.filter((l) => l.variancePct !== null).sort((a, b) => b.variancePct - a.variancePct).slice(0, 40);
    const opts = baseOptions(th, { horizontal: true, valueFmt: (v) => `${v}%` });
    opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
    opts.plugins.tooltip.callbacks = {
      title: (c) => { const r = rows[c[0].dataIndex]; return `${r.item} (${r.category})`; },
      label: (c) => { const r = rows[c.dataIndex]; return ` ${pct(r.variancePct)} · Est ${money(r.estimated)} → Act ${money(r.actual)}`; },
      afterLabel: (c) => (flagged.has(rows[c.dataIndex].id) ? ' ⚑ Flagged as unusual' : ''),
    };
    opts.scales.y.ticks.font = { size: 11 };
    if (canvas.parentElement && canvas.parentElement.classList.contains('chart-box-tall')) {
      canvas.parentElement.style.height = `${Math.max(240, rows.length * 22 + 60)}px`;
    }
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.item),
        datasets: [{
          label: 'Variance %',
          data: rows.map((r) => r.variancePct),
          backgroundColor: rows.map((r) => (r.variancePct > 0 ? th.over : th.under)),
          borderColor: rows.map((r) => (flagged.has(r.id) ? th.flag : 'transparent')),
          borderWidth: rows.map((r) => (flagged.has(r.id) ? 2 : 0)),
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 16,
        }],
      },
      options: { ...opts, ...extra },
      plugins: [whiteBg],
    });
  }

  const CHARTS = [
    { id: 'chart-category', title: 'Estimated vs actual by category', fn: categoryChart, w: 900, h: 380 },
    { id: 'chart-variance', title: 'Variance by category', fn: varianceChart, w: 900, h: 380 },
    { id: 'chart-items', title: 'Variance % per line item', fn: itemsChart, w: 900, h: 520 },
  ];

  let chartData = null;
  let live = [];

  function drawScreenCharts() {
    live.forEach((c) => c.destroy());
    live = [];
    if (!chartData || !chartData.lines.length) return;
    const th = screenTheme();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    for (const c of CHARTS) {
      const el = document.getElementById(c.id);
      if (el) live.push(c.fn(el, chartData, th));
    }
  }

  function renderExportImages() {
    if (!chartData || !chartData.lines.length) return [];
    return CHARTS.map((c) => {
      const holder = document.createElement('div');
      holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${c.w}px;height:${c.h}px;`;
      const canvas = document.createElement('canvas');
      holder.appendChild(canvas);
      document.body.appendChild(holder);
      const chart = c.fn(canvas, chartData, printTheme, { animation: false, responsive: false, devicePixelRatio: 2 });
      chart.resize(c.w, c.h);
      chart.update('none');
      const data = canvas.toDataURL('image/png');
      chart.destroy();
      holder.remove();
      return { title: c.title, data };
    });
  }

  if (document.getElementById('chart-category')) {
    api(`${base}/data.json`).then((d) => { chartData = d; drawScreenCharts(); }).catch((e) => console.error(e));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawScreenCharts);
  }

  // ---------------------------------------------------------------- PDF download

  const pdfBtn = document.getElementById('btn-pdf');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async () => {
      const label = pdfBtn.textContent;
      pdfBtn.disabled = true;
      pdfBtn.textContent = 'Building report…';
      try {
        const res = await fetch(`${base}/report.pdf`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ charts: renderExportImages() }),
        });
        if (!res.ok) throw new Error(`Report failed (${res.status})`);
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') || '';
        const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || 'cost-report.pdf';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } catch (e) {
        alert(e.message);
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.textContent = label;
      }
    });
  }

  // ---------------------------------------------------------------- AI summary

  const aiBtn = document.getElementById('btn-ai');
  if (aiBtn) {
    const out = document.getElementById('ai-text');
    const meta = document.getElementById('ai-meta');
    aiBtn.addEventListener('click', async () => {
      aiBtn.disabled = true;
      aiBtn.textContent = 'Analysing…';
      out.classList.add('loading');
      try {
        const r = await api(`${base}/summary`, { method: 'POST' });
        out.textContent = r.text; // textContent: model output is never interpreted as HTML
        meta.textContent = r.source === 'ai' ? `Generated by ${r.model || 'AI'} · just now` : `${r.note || 'Rule-based summary'} · just now`;
        aiBtn.textContent = 'Regenerate';
      } catch (e) {
        meta.textContent = e.message;
        aiBtn.textContent = 'Try again';
      } finally {
        out.classList.remove('loading');
        aiBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- Upload

  const form = document.getElementById('upload-form');
  if (form) {
    const fileInput = document.getElementById('file');
    const drop = document.getElementById('drop');
    const dropLabel = document.getElementById('drop-label');
    const result = document.getElementById('upload-result');
    const msg = document.getElementById('upload-msg');
    const errList = document.getElementById('upload-errors');
    const previewTable = document.getElementById('preview-table');
    const tbody = previewTable.querySelector('tbody');
    const commitBtns = [document.getElementById('commit-append'), document.getElementById('commit-replace')];

    fileInput.addEventListener('change', () => { dropLabel.textContent = fileInput.files[0] ? fileInput.files[0].name : 'Choose a file'; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over-zone'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over-zone'); }));
    drop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event('change')); }
    });

    const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = fileInput.files[0];
      result.hidden = false;
      errList.replaceChildren();
      tbody.replaceChildren();
      commitBtns.forEach((b) => { b.hidden = true; });
      previewTable.hidden = true;
      if (!f) { msg.textContent = 'Choose a file first.'; return; }
      if (f.size > 2 * 1024 * 1024) { msg.textContent = 'File is larger than 2 MB.'; return; }
      msg.textContent = 'Validating…';
      const fd = new FormData();
      fd.append('file', f);
      try {
        const r = await api(`${base}/upload`, { method: 'POST', body: fd });
        msg.textContent = `${r.filename}: ${r.validCount} valid row(s)${r.errorCount ? `, ${r.errorCount} row(s) rejected` : ''}.`;
        for (const er of r.errors) {
          const li = document.createElement('li');
          li.textContent = `Row ${er.row}: ${er.issues.join('; ')}`;
          errList.appendChild(li);
        }
        for (const l of r.preview) {
          const tr = document.createElement('tr');
          cell(tr, l.category); cell(tr, l.item);
          cell(tr, money(l.estimated), 'num'); cell(tr, money(l.actual), 'num');
          cell(tr, pct(l.variancePct), `num ${l.variance > 0 ? 'over' : l.variance < 0 ? 'under' : ''}`);
          tbody.appendChild(tr);
        }
        previewTable.hidden = !r.preview.length;
        if (r.validCount) commitBtns.forEach((b) => { b.hidden = false; });
      } catch (err) {
        msg.textContent = `Rejected: ${err.message}`;
      }
    });

    commitBtns.forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`${base}/upload/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: b.id === 'commit-replace' ? 'replace' : 'append' }),
        });
        window.location.reload();
      } catch (err) {
        msg.textContent = err.message;
      }
    }));
  }

  // ---------------------------------------------------------------- Confirm forms
  document.querySelectorAll('form.confirm').forEach((f) => {
    f.addEventListener('submit', (e) => { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); });
  });
}());
