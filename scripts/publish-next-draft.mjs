#!/usr/bin/env node
// Publishes the next queued blog draft: moves it from drafts/blog/ into
// public/blog/, stamps today's date, adds it to the blog index + sitemap,
// then builds, commits, pushes and (unless --no-deploy) deploys.
//
// Usage:
//   node scripts/publish-next-draft.mjs            # publish + build + commit + push + deploy
//   node scripts/publish-next-draft.mjs --no-deploy   # skip `wrangler deploy`
//   node scripts/publish-next-draft.mjs --dry-run     # show what would publish, change nothing

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noDeploy = args.includes('--no-deploy');

const queuePath = join(root, 'drafts', 'queue.json');
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));

if (queue.length === 0) {
  console.log('Draft queue is empty — nothing to publish.');
  process.exit(0);
}

const post = queue[0];
const { slug, title, blurb } = post;
const draftDir = join(root, 'drafts', 'blog', slug);
const liveDir = join(root, 'public', 'blog', slug);
const postFile = join(liveDir, 'index.html');

if (!existsSync(draftDir)) {
  console.error(`Draft directory not found: ${draftDir}`);
  process.exit(1);
}

const now = new Date();
const iso = now.toISOString().slice(0, 10);
const human = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

console.log(`Next draft: ${slug}`);
console.log(`Publish date: ${iso} (${human})`);
console.log(`Remaining after this: ${queue.length - 1}`);

if (dryRun) {
  console.log('\n[--dry-run] No changes made.');
  process.exit(0);
}

// 1. Move draft into the live tree and stamp the date tokens.
renameSync(draftDir, liveDir);
let html = readFileSync(postFile, 'utf8');
html = html.replaceAll('{{PUBDATE_ISO}}', iso).replaceAll('{{PUBDATE_HUMAN}}', human);
writeFileSync(postFile, html);

// 2. Prepend a card + JSON-LD entry to the blog index (newest first).
const indexFile = join(root, 'public', 'blog', 'index.html');
let idx = readFileSync(indexFile, 'utf8');

const card = `
      <a class="blog-card" href="/blog/${slug}/">
        <time datetime="${iso}">${human}</time>
        <h2>${title}</h2>
        <p>${blurb}</p>
        <span class="blog-readmore">Read guide →</span>
      </a>`;
idx = idx.replace('<div class="blog-list">', `<div class="blog-list">${card}`);

const ld = `
    { "@type": "BlogPosting",
      "headline": ${JSON.stringify(title.replace(/&amp;/g, '&'))},
      "url": "https://myfreeimagetool.com/blog/${slug}/",
      "datePublished": "${iso}",
      "author": { "@type": "Person", "name": "Rob Sawant" } },`;
idx = idx.replace('"blogPost": [', `"blogPost": [${ld}`);
writeFileSync(indexFile, idx);

// 3. Add a sitemap entry right after the /blog/ index URL.
const smFile = join(root, 'public', 'sitemap.xml');
let sm = readFileSync(smFile, 'utf8');
const smEntry = `\n  <url><loc>https://myfreeimagetool.com/blog/${slug}/</loc><lastmod>${iso}</lastmod><priority>0.7</priority><changefreq>monthly</changefreq></url>`;
sm = sm.replace(
  /(<url><loc>https:\/\/myfreeimagetool\.com\/blog\/<\/loc>[^\n]*)/,
  `$1${smEntry}`,
);
writeFileSync(smFile, sm);

// 4. Pop the queue.
queue.shift();
writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');

// 5. Build, commit, push, deploy.
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
run('npm run build');
run('git add -A');
run(`git commit -m "Publish blog post: ${slug}"`);
try {
  run('git push origin main');
} catch (e) {
  console.error('git push failed (continuing):', e.message);
}
if (!noDeploy) {
  run('npx wrangler deploy');
}

console.log(`\nPublished ${slug}. ${queue.length} draft(s) remaining in queue.`);
