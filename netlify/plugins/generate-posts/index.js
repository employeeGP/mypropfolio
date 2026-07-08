/**
 * Netlify build plugin: generate-posts
 *
 * onPreBuild:
 *   1. Parse all /blog/*.md files
 *   2. Write /blog/posts.json  (with clean `url` field)
 *   3. Write /blog/[url-slug]/index.html for each post (pre-rendered, SEO-friendly)
 *
 * Zero external dependencies — inline markdown converter handles common syntax.
 */

const fs   = require('fs');
const path = require('path');

/* ── Slug helpers ───────────────────────────────────────────────────────── */

function slugFromFilename(filename) {
  return filename
    .replace(/\.md$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveUrlSlug(fmSlug, filename) {
  if (fmSlug && fmSlug.trim()) return fmSlug.trim();
  return slugFromFilename(filename);
}

/* ── Frontmatter parser ─────────────────────────────────────────────────── */

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };

  const lines = m[1].split('\n');
  const meta  = { seo: {} };
  let inSeo   = false;

  lines.forEach(line => {
    if (line.trim() === 'seo:') { inSeo = true; return; }
    if (inSeo && /^\s{2,}/.test(line)) {
      const p = line.match(/^\s+(\w+):\s*(.*)/);
      if (p) meta.seo[p[1].trim()] = p[2].trim().replace(/^["']|["']$/g, '');
      return;
    }
    if (!/^\s/.test(line)) inSeo = false;
    const ci = line.indexOf(':');
    if (ci === -1 || /^\s/.test(line)) return;
    const k = line.slice(0, ci).trim();
    const v = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
    if (k && k !== 'seo') meta[k] = v;
  });

  return { meta, body: m[2] };
}

/* ── Inline markdown → HTML ─────────────────────────────────────────────── */

function markdownToHtml(md) {
  const lines  = md.split('\n');
  const output = [];
  let i = 0;

  function inlineFormat(text) {
    return text
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const lang  = line.trim().slice(3).trim();
      const inner = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        inner.push(lines[i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
        i++;
      }
      output.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${inner.join('\n')}</code></pre>`);
      i++;
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const lvl = hm[1].length;
      output.push(`<h${lvl}>${inlineFormat(hm[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const bLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bLines.push(lines[i].slice(2));
        i++;
      }
      output.push(`<blockquote><p>${inlineFormat(bLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      output.push('<hr>');
      i++;
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^[\s]*[-*+]\s/, ''))}</li>`);
        i++;
      }
      output.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      output.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-special lines
    const pLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        l.trim() === '' ||
        /^#{1,6}\s/.test(l) ||
        /^[\s]*[-*+]\s/.test(l) ||
        /^\d+\.\s/.test(l) ||
        l.startsWith('> ') ||
        l.trim().startsWith('```') ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(l.trim())
      ) break;
      pLines.push(l);
      i++;
    }
    if (pLines.length) {
      output.push(`<p>${inlineFormat(pLines.join(' ').trim())}</p>`);
    }
  }

  return output.join('\n');
}

/* ── Section numbering + ToC extraction ────────────────────────────────── */

function processArticle(markdown) {
  const rawHTML  = markdownToHtml(markdown);
  const parts    = rawHTML.split(/(?=<h2[\s>])/i);
  const sections = [];
  let counter    = 0;

  const processed = parts.map(part => {
    if (!part.match(/^<h2[\s>]/i)) return part;
    counter++;
    const id        = `section-${counter}`;
    const textMatch = part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const text      = textMatch ? textMatch[1].replace(/<[^>]+>/g, '') : '';
    sections.push({ id, text });
    const withId = part.replace(/<h2(\s[^>]*)?>/i, `<h2$1 id="${id}">`);
    return `<div class="section-block"><span class="section-num">${String(counter).padStart(2, '0')}</span>${withId}</div>`;
  }).join('');

  return { html: processed, sections };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveImg(src) {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  if (src.startsWith('/')) return '../../' + src.replace(/^\//, '');
  return src;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ── Author ─────────────────────────────────────────────────────────────── */

const AUTHOR = {
  name : 'Jared Lim',
  role : 'Co-founder, mypropfolio',
  bio  : 'Jared spent 7 years as a property agent in Singapore before co-founding mypropfolio. He writes about what actually works for agents who want to stand out in a crowded market.',
  stat : '500+ microsites delivered',
  wa   : 'https://wa.me/6596273238',
};

/* ── ToC ─────────────────────────────────────────────────────────────────── */

function buildToC(sections) {
  if (!sections.length) return '';
  const items = sections.map((s, i) =>
    `<li><span class="toc-num">${String(i + 1).padStart(2, '0')}</span><a href="#${s.id}" class="toc-link">${escHtml(s.text)}</a></li>`
  ).join('\n');
  return `<span class="toc-label">In this article</span><ol class="toc-list">${items}</ol>`;
}

/* ── Related posts ──────────────────────────────────────────────────────── */

function buildRelatedMini(allPosts, currentUrlSlug) {
  const others = allPosts.filter(p => p.urlSlug !== currentUrlSlug).slice(0, 3);
  if (!others.length) return '';
  const items = others.map(p => {
    const thumb = p.thumbnail ? resolveImg(p.thumbnail) : '';
    const rt    = p.read_time ? `${p.read_time} min read` : '';
    return `<li class="related-mini-item"><a href="../${p.urlSlug}/">
      <div class="related-mini-img">${thumb ? `<img src="${thumb}" alt="${escHtml(p.title)}" loading="lazy">` : ''}</div>
      <div><p class="related-mini-title">${escHtml(p.title)}</p><p class="related-mini-meta">${rt}</p></div>
    </a></li>`;
  }).join('\n');
  return `<div class="related-mini"><span class="related-mini-label">More articles</span><ul class="related-mini-list">${items}</ul></div>`;
}

/* ── Share strip ─────────────────────────────────────────────────────────── */

function buildShareStrip(title, canonicalUrl) {
  const url  = encodeURIComponent(canonicalUrl);
  const text = encodeURIComponent(title);
  return `<div class="post-share-strip">
    <span class="post-share-label">Share this article:</span>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${url}" target="_blank" rel="noopener" class="post-share-btn">
      <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>Facebook</a>
    <a href="https://twitter.com/intent/tweet?text=${text}&url=${url}" target="_blank" rel="noopener" class="post-share-btn">
      <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z"/></svg>Twitter / X</a>
    <a href="https://www.linkedin.com/sharing/share-offsite/?url=${url}" target="_blank" rel="noopener" class="post-share-btn">
      <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>LinkedIn</a>
  </div>`;
}

/* ── Full page HTML ─────────────────────────────────────────────────────── */

function generatePostPage(post, articleHTML, sections, allPosts) {
  const { title, urlSlug, date, category, thumbnail, read_time, tags, seo } = post;
  const canonical     = `https://mypropfolio.co/blog/${urlSlug}/`;
  const metaTitle     = (seo && seo.meta_title)       || title || 'Blog – mypropfolio';
  const metaDesc      = (seo && seo.meta_description) || post.excerpt || '';
  const ogImage       = (seo && seo.og_image)         || thumbnail || '';
  const readTime      = read_time ? `${read_time} min read` : '';
  const thumb         = thumbnail ? resolveImg(thumbnail) : '';
  const tagList       = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const dateFormatted = fmtDate(date);

  const heroContent = thumb
    ? `<img src="${thumb}" alt="${escHtml(title)}" loading="eager">`
    : `<div class="post-header-img-placeholder"><svg width="52" height="52" viewBox="0 0 52 52" fill="none"><rect x="4" y="10" width="44" height="32" rx="3" stroke="#0A0A0A" stroke-width="1.5" opacity="0.15"/><circle cx="19" cy="22" r="4" stroke="#0A0A0A" stroke-width="1.5" opacity="0.15"/><path d="M4 38L18 24L26 32L34 22L48 38" stroke="#0A0A0A" stroke-width="1.5" stroke-linejoin="round" opacity="0.15"/></svg></div>`;

  const tagsHTML = tagList.length
    ? `<div class="post-tags">${tagList.map(t => `<span class="post-tag">${escHtml(t)}</span>`).join('')}</div>`
    : '';

  const tocSectionsJson = JSON.stringify(sections.map(s => s.id));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(metaTitle)}</title>
  <meta name="description" content="${escHtml(metaDesc)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escHtml(metaTitle)}">
  <meta property="og:description" content="${escHtml(metaDesc)}">
  <meta property="og:type" content="article">
  ${ogImage ? `<meta property="og:image" content="${escHtml(resolveImg(ogImage))}">` : ''}
  <meta property="og:url" content="${canonical}">
  <meta property="article:published_time" content="${escHtml(date || '')}">
  ${category ? `<meta property="article:section" content="${escHtml(category)}">` : ''}
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BlogPosting","headline":${JSON.stringify(title)},"datePublished":${JSON.stringify(date||'')},"author":{"@type":"Person","name":"Jared Lim"},"publisher":{"@type":"Organization","name":"mypropfolio","url":"https://mypropfolio.co"},"url":${JSON.stringify(canonical)}${metaDesc?`,"description":${JSON.stringify(metaDesc)}`:''}${thumb?`,"image":${JSON.stringify(thumb)}`:''}}</script>
  <link rel="stylesheet" href="../../css/styles.css">
  <link rel="icon" type="image/png" sizes="32x32" href="../../favicon-32.png">
  <link rel="icon" type="image/png" href="../../favicon.png">
  <link rel="apple-touch-icon" href="../../favicon-180.png">
  <style>
    html,body{overflow-x:hidden}
    .post-breadcrumb{padding:calc(var(--nav-height)+20px) 0 0;background:#fff}
    .breadcrumb-list{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;color:var(--color-text-muted);list-style:none}
    .breadcrumb-list a{color:var(--color-text-muted);transition:color .2s}.breadcrumb-list a:hover{color:var(--color-text)}
    .breadcrumb-sep{opacity:.35}
    .post-header{background:#fff;padding:32px 0 0}
    .post-header-grid{display:grid;grid-template-columns:1fr 42%;gap:48px;align-items:center}
    @media(max-width:900px){.post-header-grid{grid-template-columns:1fr;gap:32px}.post-header-img{order:-1}}
    .post-header-pills{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}
    .post-cat-pill{display:inline-flex;align-items:center;padding:5px 14px;border-radius:100px;background:rgba(204,31,40,.09);color:#CC1F28;font-size:12px;font-weight:600;letter-spacing:.05em;font-family:var(--font-body)}
    .post-read-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:100px;border:1px solid var(--color-border);font-size:12px;color:var(--color-text-muted);font-family:var(--font-body)}
    .post-title{font-family:var(--font-display);font-size:clamp(28px,4vw,52px);font-weight:700;letter-spacing:-.035em;line-height:1.07;color:var(--color-text);margin-bottom:18px}
    .post-description{font-size:17px;line-height:1.6;color:var(--color-text-muted);margin-bottom:28px;max-width:560px}
    .post-author-row{display:flex;align-items:center;gap:14px;padding-top:24px;border-top:1px solid var(--color-border)}
    .post-author-avatar{width:44px;height:44px;border-radius:50%;background:var(--color-bg-grey);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .post-author-initial{font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--color-text)}
    .post-author-name{font-size:14px;font-weight:600;font-family:var(--font-display);color:var(--color-text)}
    .post-author-sub{font-size:12px;color:var(--color-text-muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .post-author-dot{opacity:.35}
    .post-header-img{position:relative;width:100%;padding-bottom:66%;overflow:hidden;border-radius:6px;background:var(--color-bg-grey)}
    .post-header-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .post-header-img-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
    .post-header-divider{height:1px;background:var(--color-border);margin-top:48px}
    .post-body-wrap{background:#fff;padding:56px 0 96px}
    .post-body-grid{display:grid;grid-template-columns:220px 1fr 260px;gap:0 48px;align-items:start}
    @media(max-width:1200px){.post-body-grid{grid-template-columns:200px 1fr;gap:0 40px}.post-right-col{display:none}}
    @media(max-width:900px){.post-body-grid{grid-template-columns:1fr}.post-left-col{display:none}}
    .post-left-col{position:sticky;top:calc(var(--nav-height)+32px)}
    .toc-label{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:16px;display:block;font-family:var(--font-body)}
    .toc-list{list-style:none;display:flex;flex-direction:column;gap:2px}
    .toc-list li{display:flex;gap:10px;align-items:flex-start}
    .toc-num{font-size:11px;font-weight:700;color:var(--color-text-muted);min-width:18px;padding-top:3px;flex-shrink:0;font-family:var(--font-body)}
    .toc-link{font-size:13px;line-height:1.5;color:var(--color-text);opacity:.5;transition:opacity .2s;text-decoration:none;padding:4px 0;display:block}
    .toc-link:hover{opacity:.85}.toc-link.active{opacity:1;font-weight:500}
    .post-article{font-size:17px;line-height:1.78;color:var(--color-text);min-width:0}
    .post-article .section-block{margin-bottom:56px}
    .post-article .section-num{font-family:var(--font-body);font-size:11px;font-weight:700;letter-spacing:.1em;color:#CC1F28;margin-bottom:8px;display:block;text-transform:uppercase}
    .post-article h2{font-family:var(--font-display);font-size:clamp(20px,2vw,26px);font-weight:700;letter-spacing:-.025em;line-height:1.2;color:var(--color-text);margin:0 0 18px;scroll-margin-top:calc(var(--nav-height)+24px)}
    .post-article h3{font-family:var(--font-display);font-size:19px;font-weight:600;letter-spacing:-.02em;margin:1.8em 0 .6em}
    .post-article h4{font-family:var(--font-display);font-size:16px;font-weight:600;margin:1.4em 0 .5em}
    .post-article p{margin-bottom:1.4em}
    .post-article ul,.post-article ol{padding-left:1.5em;margin-bottom:1.4em}
    .post-article ul{list-style:disc}.post-article ol{list-style:decimal}
    .post-article li{margin-bottom:.45em}
    .post-article a{color:var(--color-text);text-decoration:underline;text-underline-offset:3px;opacity:.75;transition:opacity .2s}
    .post-article a:hover{opacity:1}
    .post-article blockquote{border-left:3px solid #CC1F28;padding:14px 20px;margin:2em 0;color:var(--color-text-muted);font-size:18px;font-style:italic;background:#FAFAFA}
    .post-article img{width:100%;height:auto;margin:2em 0;border-radius:4px}
    .post-article code{font-size:13px;background:var(--color-bg-grey);padding:2px 6px;border-radius:3px}
    .post-article pre{background:var(--color-bg-grey);padding:20px;overflow-x:auto;margin-bottom:1.4em;border-radius:4px}
    .post-article pre code{background:none;padding:0}
    .post-article hr{border:none;border-top:1px solid var(--color-border);margin:2.5em 0}
    .post-article strong{font-weight:600}
    .post-article table{width:100%;border-collapse:collapse;margin-bottom:1.4em;font-size:15px}
    .post-article th,.post-article td{padding:10px 14px;border:1px solid var(--color-border);text-align:left}
    .post-article th{font-weight:600;background:var(--color-bg-grey)}
    .post-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:48px;padding-top:32px;border-top:1px solid var(--color-border)}
    .post-tag{padding:5px 12px;border:1px solid var(--color-border);font-size:12px;color:var(--color-text-muted);border-radius:100px;font-family:var(--font-body)}
    .post-share-strip{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:40px;padding-top:32px;border-top:1px solid var(--color-border)}
    .post-share-label{font-size:13px;color:var(--color-text-muted);font-family:var(--font-body)}
    .post-share-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border:1px solid var(--color-border);font-size:13px;font-weight:500;color:var(--color-text);opacity:.7;transition:opacity .2s,border-color .2s;text-decoration:none;font-family:var(--font-body);border-radius:100px}
    .post-share-btn:hover{opacity:1;border-color:rgba(10,10,10,.4)}
    .post-right-col{position:sticky;top:calc(var(--nav-height)+32px);display:flex;flex-direction:column;gap:28px}
    .author-card{border:1px solid var(--color-border);padding:24px}
    .author-card-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:14px;display:block;font-family:var(--font-body)}
    .author-card-top{display:flex;align-items:center;gap:12px;margin-bottom:12px}
    .author-card-avatar{width:44px;height:44px;border-radius:50%;background:var(--color-bg-grey);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .author-card-initial{font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--color-text)}
    .author-card-name{font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--color-text);margin-bottom:2px}
    .author-card-role{font-size:12px;color:var(--color-text-muted)}
    .author-card-bio{font-size:13px;line-height:1.6;color:var(--color-text-muted);margin-bottom:16px}
    .author-card-stat{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text-muted);margin-bottom:16px}
    .author-card-cta{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 16px;background:var(--color-text);color:#fff;font-size:13px;font-weight:600;text-decoration:none;font-family:var(--font-body);transition:opacity .2s;width:100%;box-sizing:border-box}
    .author-card-cta:hover{opacity:.8}
    .related-mini{border:1px solid var(--color-border);padding:24px}
    .related-mini-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:16px;display:block;font-family:var(--font-body)}
    .related-mini-list{display:flex;flex-direction:column;gap:16px;list-style:none}
    .related-mini-item a{display:flex;gap:12px;text-decoration:none;color:inherit}
    .related-mini-img{width:60px;height:44px;flex-shrink:0;overflow:hidden;background:var(--color-bg-grey);border-radius:3px}
    .related-mini-img img{width:100%;height:100%;object-fit:cover}
    .related-mini-title{font-family:var(--font-display);font-size:13px;font-weight:600;line-height:1.35;color:var(--color-text);margin-bottom:4px}
    .related-mini-meta{font-size:11px;color:var(--color-text-muted)}
    @media(max-width:768px){.post-body-wrap{padding:40px 0 64px}.post-article{font-size:16px}.post-description{font-size:16px}}
  </style>
</head>
<body>

  <nav class="site-nav" role="navigation" aria-label="Main navigation">
    <div class="container">
      <a href="../../index.html" class="nav-logo" aria-label="mypropfolio home">
        <img src="../../Asset/MyPropFolio Logo.png" alt="mypropfolio" class="nav-logo-img">
      </a>
      <div class="nav-links">
        <a href="../../how-it-works.html">How It Works</a>
        <a href="../../add-ons.html">Add-Ons</a>
        <a href="../../pricing.html">Pricing</a>
        <a href="../../contact.html">Contact</a>
      </div>
      <a href="../../contact.html" class="nav-cta">Get Started</a>
      <button class="nav-hamburger" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>

  <div class="nav-mobile-overlay" aria-hidden="true">
    <a href="../../how-it-works.html">How It Works</a>
    <a href="../../add-ons.html">Add-Ons</a>
    <a href="../../pricing.html">Pricing</a>
    <a href="../../contact.html">Contact</a>
    <a href="../../contact.html" class="nav-cta-mobile">Get Started</a>
  </div>

  <main id="content">

    <nav class="post-breadcrumb" aria-label="Breadcrumb">
      <div class="container">
        <ol class="breadcrumb-list">
          <li><a href="../../index.html">Home</a></li>
          <li aria-hidden="true"><span class="breadcrumb-sep">/</span></li>
          <li><a href="../">Blog</a></li>
          ${category ? `<li aria-hidden="true"><span class="breadcrumb-sep">/</span></li><li><span>${escHtml(category)}</span></li>` : ''}
        </ol>
      </div>
    </nav>

    <section class="post-header">
      <div class="container">
        <div class="post-header-grid">
          <div class="post-header-left">
            <div class="post-header-pills">
              ${category ? `<span class="post-cat-pill">${escHtml(category)}</span>` : ''}
              ${readTime ? `<span class="post-read-pill"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5L10 10"/></svg>${escHtml(readTime)}</span>` : ''}
            </div>
            <h1 class="post-title">${escHtml(title)}</h1>
            ${metaDesc ? `<p class="post-description">${escHtml(metaDesc)}</p>` : ''}
            <div class="post-author-row">
              <div class="post-author-avatar"><span class="post-author-initial">${AUTHOR.name.charAt(0)}</span></div>
              <div>
                <p class="post-author-name">${escHtml(AUTHOR.name)}</p>
                <p class="post-author-sub">
                  <span>${escHtml(AUTHOR.role)}</span>
                  ${dateFormatted ? `<span class="post-author-dot">·</span><time datetime="${escHtml(date)}">${dateFormatted}</time>` : ''}
                  ${readTime ? `<span class="post-author-dot">·</span><span>${escHtml(readTime)}</span>` : ''}
                </p>
              </div>
            </div>
          </div>
          <div class="post-header-img">${heroContent}</div>
        </div>
        <div class="post-header-divider"></div>
      </div>
    </section>

    <div class="post-body-wrap">
      <div class="container">
        <div class="post-body-grid">
          <div class="post-left-col">${buildToC(sections)}</div>
          <article class="post-article">
            ${articleHTML}
            ${tagsHTML}
            ${buildShareStrip(title, canonical)}
          </article>
          <div class="post-right-col">
            <div class="author-card">
              <span class="author-card-label">Written by</span>
              <div class="author-card-top">
                <div class="author-card-avatar"><span class="author-card-initial">${AUTHOR.name.charAt(0)}</span></div>
                <div>
                  <p class="author-card-name">${escHtml(AUTHOR.name)}</p>
                  <p class="author-card-role">${escHtml(AUTHOR.role)}</p>
                </div>
              </div>
              <p class="author-card-bio">${escHtml(AUTHOR.bio)}</p>
              <div class="author-card-stat">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#CC1F28" stroke-width="2"><polyline points="14 4 6 12 2 8"/></svg>
                ${escHtml(AUTHOR.stat)}
              </div>
              <a href="${AUTHOR.wa}" target="_blank" rel="noopener" class="author-card-cta">
                <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.107.551 4.084 1.514 5.793L0 24l6.416-1.49A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.851 0-3.588-.502-5.088-1.377l-.363-.216-3.808.885.924-3.7-.238-.381A9.941 9.941 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                WhatsApp ${escHtml(AUTHOR.name.split(' ')[0])}
              </a>
            </div>
            ${buildRelatedMini(allPosts, urlSlug)}
          </div>
        </div>
      </div>
    </div>

  </main>

  <footer class="site-footer" aria-label="Site footer">
    <div class="container">
      <div class="footer-top">
        <div class="footer-brand">
          <a href="../../index.html" class="nav-logo">
            <img src="../../Asset/MyPropFolio Logo.png" alt="mypropfolio" class="nav-logo-img">
          </a>
          <p class="tagline">Your listing. Your brand.</p>
        </div>
        <div class="footer-links-group">
          <a href="../../how-it-works.html">How It Works</a>
          <a href="../../add-ons.html">Add-Ons</a>
          <a href="../../pricing.html">Pricing</a>
          <a href="../../contact.html">Contact</a>
          <a href="../">Blog</a>
        </div>
        <div class="footer-contact">
          <a href="https://wa.me/6596273238" target="_blank" rel="noopener">WhatsApp Us</a>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2026 mypropfolio &nbsp;·&nbsp; <a href="../../pricing.html#terms" style="color:var(--color-text-muted);text-decoration:none;font-size:inherit;">Terms</a></p>
        <p class="footer-partner">Photography partner: <a href="https://www.gradepixel.com" target="_blank" rel="noopener">GradePixel</a></p>
      </div>
    </div>
  </footer>

  <script src="../../js/main.js"></script>
  <script>
  (function(){
    var tocLinks=document.querySelectorAll('.toc-link');
    var ids=${tocSectionsJson};
    var els=ids.map(function(id){return document.getElementById(id);}).filter(Boolean);
    if(!els.length||!tocLinks.length)return;
    function update(){
      var active=0;
      els.forEach(function(el,i){if(el.getBoundingClientRect().top<=140)active=i;});
      tocLinks.forEach(function(l,i){l.classList.toggle('active',i===active);});
    }
    window.addEventListener('scroll',update,{passive:true});
    update();
  }());
  </script>

</body>
</html>`;
}

/* ── Main ───────────────────────────────────────────────────────────────── */

module.exports = {
  onPreBuild: async ({ utils }) => {
    console.log('[generate-posts] Starting static page generation...');

    const cwd     = process.cwd();
    const blogDir = path.join(cwd, 'blog');

    let mdFiles;
    try {
      mdFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.md')).sort().reverse();
    } catch (e) {
      utils.build.failBuild('Could not read /blog directory: ' + e.message);
      return;
    }

    if (!mdFiles.length) {
      console.log('[generate-posts] No .md files found. Skipping.');
      return;
    }

    const parsedPosts = [];

    mdFiles.forEach(filename => {
      try {
        const raw            = fs.readFileSync(path.join(blogDir, filename), 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const urlSlug        = resolveUrlSlug(meta.slug, filename);
        const fileSlug       = filename.replace(/\.md$/, '');

        const bodyText = body
          .replace(/#{1,6}\s+.+/g, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\[(.+?)\]\(.+?\)/g, '$1')
          .replace(/`{1,3}[^`]*`{1,3}/g, '')
          .replace(/\n+/g, ' ')
          .trim();

        const excerpt = (meta.seo && meta.seo.meta_description) ||
                        meta.meta_description ||
                        bodyText.slice(0, 160) + (bodyText.length > 160 ? '…' : '');

        const read_time = parseInt(meta.reading_time || meta.read_time || '8') || 8;

        parsedPosts.push({
          filename, fileSlug, urlSlug,
          title    : meta.title     || '',
          date     : meta.date      || '',
          category : meta.category  || '',
          thumbnail: meta.thumbnail || '',
          tags     : meta.tags      || '',
          read_time, excerpt,
          seo      : meta.seo || {},
          body,
        });
      } catch (e) {
        console.warn(`[generate-posts] Skipping ${filename}: ${e.message}`);
      }
    });

    parsedPosts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // posts.json
    const postsJson = parsedPosts.map(p => ({
      slug     : p.fileSlug,
      urlSlug  : p.urlSlug,
      url      : `/blog/${p.urlSlug}/`,
      title    : p.title,
      date     : p.date,
      category : p.category,
      thumbnail: p.thumbnail,
      read_time: p.read_time,
      excerpt  : p.excerpt,
    }));

    fs.writeFileSync(path.join(blogDir, 'posts.json'), JSON.stringify(postsJson, null, 2));
    console.log(`[generate-posts] posts.json written — ${postsJson.length} posts`);

    // Static HTML pages
    let generated = 0, skipped = 0;

    parsedPosts.forEach(post => {
      try {
        const { html: articleHTML, sections } = processArticle(post.body);
        const pageHTML = generatePostPage(post, articleHTML, sections, postsJson);

        const outDir  = path.join(blogDir, post.urlSlug);
        const outFile = path.join(outDir, 'index.html');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outFile, pageHTML, 'utf-8');

        console.log(`  ✓ /blog/${post.urlSlug}/`);
        generated++;
      } catch (e) {
        console.warn(`  ✗ ${post.filename}: ${e.message}`);
        skipped++;
      }
    });

    console.log(`[generate-posts] Done — ${generated} pages generated${skipped ? `, ${skipped} skipped` : ''}`);
  }
};
