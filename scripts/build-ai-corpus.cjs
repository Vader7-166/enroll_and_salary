// Validates the AI-02 guidance corpus (docs/ai-corpus): permission metadata, files, route keys; prints the corpus
// version and per-chunk hashes, and checks the fixed Q&A set has ≥ 22 questions with the required categories.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { loadCorpus } = require('../backend/dist/ai-business-assistant/corpus.js');

const dir = resolve(__dirname, '../docs/ai-corpus');
const corpus = loadCorpus(dir);
console.log('Corpus version ' + corpus.version + ' (prompt ' + corpus.promptVersion + '): ' + corpus.chunks.length + ' chunks');
for (const chunk of corpus.chunks) console.log('  ' + chunk.sourceId.padEnd(8) + chunk.hash.slice(0, 12) + '  ' + chunk.label.padEnd(10) + chunk.roles.join(',') + '  ' + chunk.title);
for (const warning of corpus.warnings) console.warn('WARN ' + warning);
const qa = JSON.parse(readFileSync(resolve(dir, 'qa-set.json'), 'utf8')).questions;
const count = category => qa.filter(item => item.category === category).length;
const needs = { VALID: 12, OUT_OF_SCOPE: 4, NO_SOURCE: 2, INJECTION: 2, VALIDITY: 2 };
const missing = Object.entries(needs).filter(([category, minimum]) => count(category) < minimum);
const unknown = qa.flatMap(item => [...item.expectedSources, ...item.forbiddenSources]).filter(id => !JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')).chunks.some(chunk => chunk.sourceId === id));
console.log('Q&A set: ' + qa.length + ' questions ' + JSON.stringify(Object.fromEntries(Object.keys(needs).map(category => [category, count(category)]))));
if (qa.length < 22 || missing.length || unknown.length) { console.error('Q&A set incomplete: ' + JSON.stringify({ missing, unknown })); process.exitCode = 1; }
