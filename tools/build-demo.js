'use strict';
/* Assemble la version de démonstration en un seul fichier HTML (données locales, sans serveur). */
const fs = require('fs'), path = require('path');
const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const esc = s => s.replace(/<\/script/gi, '<\\/script');
const js = ['questions.js', 'core.js', 'views1.js', 'views2.js', 'views3.js'].map(pub).concat(fs.readFileSync(path.join(__dirname, 'seed.js'), 'utf8')).map(esc);
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Nous</title>
<style>
${pub('style.css')}
</style>
</head>
<body>
<div id="bg" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<main id="app"></main>
<nav id="tabs" class="glass" aria-label="Navigation" hidden></nav>
<div id="sheets"></div>
<div id="toast" class="glass" role="status"></div>
<script>window.NOUS_DEMO = true;</script>
${js.map(s => '<script>\n' + s + '\n</script>').join('\n')}
<script>start();</script>
</body>
</html>
`;
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' ko');
