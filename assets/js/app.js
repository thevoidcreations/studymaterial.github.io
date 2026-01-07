/* app.js
   Auto-loads files from a GitHub repository materials path and renders UI.
   Requirements:
     - If the repo is public, no tokens needed.
     - If hosted via GitHub Pages, the script attempts to auto-detect owner/repo from hostname/path.
   Configure by editing <body data-github-owner data-github-repo data-github-branch data-materials-path>
*/

(() => {
  // --- Config default (can be overridden with body data attributes) ---
  const body = document.body;
  const conf = {
    owner: body.dataset.githubOwner || null, // set in index.html or inferred
    repo:  body.dataset.githubRepo || null,  // set in index.html or inferred
    branch: body.dataset.githubBranch || 'main',
    path: body.dataset.materialsPath || 'materials'
  };

  // --- Utility helpers ---
  const el = sel => document.querySelector(sel);
  const elAll = sel => Array.from(document.querySelectorAll(sel));

  function inferOwnerRepo() {
    // If the page is served from GitHub Pages like https://owner.github.io/repo/
    // hostname: owner.github.io
    // pathname: /repo/...
    try {
      const host = location.hostname || '';
      const pathParts = location.pathname.split('/').filter(Boolean);
      if (host.endsWith('github.io')) {
        const owner = host.split('.')[0];
        // when repo is username.github.io, pathParts[0] may be not the repo
        const repo = pathParts[0] || `${owner}.github.io`;
        return { owner, repo };
      }
    } catch (e) {}
    return null;
  }

  // file type detection
  function classifyFile(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const image = ['png','jpg','jpeg','gif','svg','webp','bmp'];
    const pdf = ['pdf'];
    const video = ['mp4','webm','ogg','mov'];
    const doc = ['doc','docx','ppt','pptx','xls','xlsx','txt','md'];
    if (image.includes(ext)) return 'image';
    if (pdf.includes(ext)) return 'pdf';
    if (video.includes(ext)) return 'video';
    if (doc.includes(ext)) return 'document';
    return 'other';
  }

  // fetch GitHub API path (list contents)
  async function fetchContents(owner, repo, path, branch='main') {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error: ${res.status} ${res.statusText} — ${text}`);
    }
    return res.json();
  }

  // recursively traverse directories and collect file items
  async function crawlRepo(owner, repo, startPath, branch='main') {
    const results = [];
    async function walk(path) {
      const items = await fetchContents(owner, repo, path, branch);
      if (!Array.isArray(items)) return; // safety
      for (const item of items) {
        if (item.type === 'dir') {
          await walk(item.path);
        } else if (item.type === 'file') {
          results.push({
            name: item.name,
            path: item.path,
            size: item.size,
            download_url: item.download_url,
            sha: item.sha,
            type: classifyFile(item.name),
            // category = first folder under materials: we compute later
          });
        }
      }
    }
    await walk(startPath);
    return results;
  }

  // Render list of cards
  function renderMaterials(items, rootPath) {
    const grid = el('#grid');
    grid.innerHTML = '';
    const template = el('#card-template');
    if (!items.length) {
      el('#status').textContent = 'No materials found in the repository path.';
      return;
    } else {
      el('#status').textContent = `${items.length} material(s) available`;
    }

    // compute subjects from path relative to rootPath (e.g. materials/Math/Algebra/file.pdf => subject=Math)
    const subjects = new Set();
    items.forEach(it => {
      const rel = it.path.replace(new RegExp(`^${rootPath}/?`), '');
      const parts = rel.split('/').filter(Boolean);
      it._subject = parts.length ? parts[0] : 'Uncategorized';
      subjects.add(it._subject);
    });

    // populate subject filter
    const subjectSelect = el('#subjectFilter');
    subjectSelect.innerHTML = '<option value="">All subjects</option>';
    Array.from(subjects).sort().forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      subjectSelect.appendChild(opt);
    });

    // create cards
    items.sort((a,b) => a._subject.localeCompare(b._subject) || a.name.localeCompare(b.name));
    for (const it of items) {
      const node = template.content.cloneNode(true);
      const article = node.querySelector('.card');
      const title = node.querySelector('.card-title');
      const meta = node.querySelector('.card-meta');
      const preview = node.querySelector('.card-preview');
      const openLink = node.querySelector('.link-open');
      const btnPreview = node.querySelector('.btn-preview');

      title.textContent = it.name;
      meta.textContent = `${it._subject} • ${it.type.toUpperCase()} • ${formatBytes(it.size)}`;
      openLink.href = it.download_url;
      openLink.setAttribute('aria-label', `Open ${it.name} in new tab`);

      // preview logic
      btnPreview.addEventListener('click', () => showPreview(it));

      // preview content for images & pdfs
      if (it.type === 'image') {
        const img = document.createElement('img');
        img.src = it.download_url;
        img.alt = it.name;
        preview.innerHTML = '';
        preview.appendChild(img);
      } else if (it.type === 'pdf') {
        preview.innerHTML = '<div style="padding:10px;font-size:0.9rem;color:var(--muted)">PDF document</div>';
      } else if (it.type === 'video') {
        preview.innerHTML = '<div style="padding:10px;font-size:0.9rem;color:var(--muted)">Video file</div>';
      } else {
        preview.innerHTML = '<div style="padding:10px;font-size:0.9rem;color:var(--muted)">File</div>';
      }

      article.dataset.subject = it._subject;
      article.dataset.type = it.type;
      article.dataset.title = it.name.toLowerCase();

      grid.appendChild(node);
    }
  }

  // format file size
  function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  // modal preview
  const modal = el('#previewModal');
  const modalContent = el('#modalContent');
  const modalClose = el('#modalClose') || el('#modalClose'); // button id in markup
  function showPreview(item) {
    modalContent.innerHTML = '';
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.src = item.download_url;
      img.alt = item.name;
      modalContent.appendChild(img);
    } else if (item.type === 'pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = item.download_url;
      iframe.width = '100%';
      iframe.height = '600';
      iframe.setAttribute('title', item.name);
      modalContent.appendChild(iframe);
    } else if (item.type === 'video') {
      const vid = document.createElement('video');
      vid.controls = true;
      vid.src = item.download_url;
      vid.style.maxWidth = '100%';
      modalContent.appendChild(vid);
    } else {
      // fallback: show direct link
      const p = document.createElement('p');
      p.innerHTML = `Preview not available. <a href="${item.download_url}" target="_blank" rel="noopener">Open file directly</a>`;
      modalContent.appendChild(p);
    }
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.modal-close').focus();
  }
  function hidePreview() {
    modal.setAttribute('aria-hidden', 'true');
    modalContent.innerHTML = '';
  }

  // filters/search
  function setupFilters(items) {
    const searchInput = el('#search');
    const subjectSelect = el('#subjectFilter');
    const typeSelect = el('#typeFilter');
    const refreshBtn = el('#refreshBtn');

    function apply() {
      const q = (searchInput.value || '').toLowerCase().trim();
      const s = (subjectSelect.value || '').trim();
      const t = (typeSelect.value || '').trim();

      const nodes = elAll('.card');
      nodes.forEach(node => {
        const matchesQ = !q || (node.dataset.title && node.dataset.title.includes(q));
        const matchesS = !s || node.dataset.subject === s;
        const matchesT = !t || (t === 'pdf' ? node.dataset.type === 'pdf' || node.dataset.type === 'document' : (t === 'image' ? node.dataset.type === 'image' : (t === 'video' ? node.dataset.type === 'video' : (t === 'other' ? ['other'].includes(node.dataset.type) : true))));
        node.style.display = (matchesQ && matchesS && matchesT) ? '' : 'none';
      });
    }

    searchInput.addEventListener('input', debounce(apply, 180));
    subjectSelect.addEventListener('change', apply);
    typeSelect.addEventListener('change', apply);
    refreshBtn.addEventListener('click', () => start()); // re-run crawl
  }

  // debounce helper
  function debounce(fn, wait=200){
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // modal close handlers
  document.addEventListener('click', (ev) => {
    if (ev.target.matches('#previewModal') || ev.target.matches('.modal-close')) {
      hidePreview();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hidePreview();
  });

  // main entry
  async function start() {
    try {
      el('#status').textContent = 'Discovering repository details…';
      // infer owner/repo if not set
      if (!conf.owner || !conf.repo) {
        const inf = inferOwnerRepo();
        if (inf) {
          conf.owner = conf.owner || inf.owner;
          conf.repo = conf.repo || inf.repo;
        } else {
          // show helpful instructions inside UI (no alerts)
          el('#status').innerHTML = 'Repository details not found. Please set <code>data-github-owner</code> and <code>data-github-repo</code> attributes on <code>&lt;body&gt;</code>.';
          return;
        }
      }

      el('#status').textContent = `Loading materials from ${conf.owner}/${conf.repo} (${conf.branch})…`;

      // crawl materials
      const items = await crawlRepo(conf.owner, conf.repo, conf.path, conf.branch);

      // Map raw items and render
      renderMaterials(items, conf.path);

      // attach filters
      setupFilters(items);

    } catch (err) {
      el('#status').innerHTML = `Error loading materials: ${err.message}.<br><small>Check repository path, branch, and that repo is public.</small>`;
      console.error(err);
    }
  }

  // expose start for manual calls
  window.StudyHub = { start };

  // auto-start after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else start();

})();
