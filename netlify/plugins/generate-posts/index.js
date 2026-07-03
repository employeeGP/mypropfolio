const fs = require('fs');
const path = require('path');

module.exports = {
  onPreBuild: async ({ utils }) => {
    console.log('📝 Generating posts.json from markdown files...');

    const blogDir = path.join(process.cwd(), 'blog');
    const outputFile = path.join(blogDir, 'posts.json');

    try {
      // Read all .md files in /blog folder
      const files = fs.readdirSync(blogDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse(); // newest first

      const posts = [];

      files.forEach(filename => {
        const filePath = path.join(blogDir, filename);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Parse frontmatter (between --- and ---)
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) return;

        const frontmatter = frontmatterMatch[1];

        // Extract each field
        const get = (key) => {
          const match = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'));
          return match ? match[1].trim() : '';
        };

        const slug = filename.replace('.md', '');
        const title = get('title');
        const date = get('date');
        const category = get('category');
        const thumbnail = get('thumbnail') || '';
        const readTimeMatch = frontmatter.match(/^reading_time:\s*(\d+)/m);
        const read_time = readTimeMatch ? parseInt(readTimeMatch[1]) : 8;

        // Auto-generate excerpt from body content
        const bodyContent = content
          .replace(/^---[\s\S]*?---\n/, '')   // remove frontmatter
          .replace(/#{1,6}\s+.+/g, '')         // remove headings
          .replace(/\*\*(.+?)\*\*/g, '$1')     // remove bold
          .replace(/\[(.+?)\]\(.+?\)/g, '$1')  // remove links
          .replace(/`{1,3}[^`]*`{1,3}/g, '')   // remove code
          .replace(/\n+/g, ' ')                 // collapse newlines
          .trim();

        const metaDesc = get('meta_description');
        const excerpt = metaDesc || bodyContent.slice(0, 160) + '…';

        if (title && slug) {
          posts.push({ slug, title, date, category, thumbnail, read_time, excerpt });
        }
      });

      // Sort by date descending
      posts.sort((a, b) => new Date(b.date) - new Date(a.date));

      fs.writeFileSync(outputFile, JSON.stringify(posts, null, 2));
      console.log(`✅ Generated posts.json with ${posts.length} posts`);

    } catch (err) {
      console.error('❌ Failed to generate posts.json:', err);
      utils.build.failBuild('Could not generate posts.json');
    }
  }
};
