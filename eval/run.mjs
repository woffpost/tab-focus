import { readFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';

const MODELS = [
  ['Xenova/paraphrase-multilingual-MiniLM-L12-v2', { topic: (t) => t, tab: (t) => t }],
  ['Xenova/multilingual-e5-small', { topic: (t) => `query: ${t}`, tab: (t) => `passage: ${t}` }],
];
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
const cos = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const views = {
  title: (t) => t.title,
  'title+host': (t) => `${t.title} ${new URL(t.url).hostname.replace(/^www\./, '')}`,
};

for (const [name, prefix] of MODELS) {
  let extract;
  try {
    extract = await pipeline('feature-extraction', name, { dtype: 'q8' });
  } catch (e) {
    console.log(name, 'FAILED', e.message);
    continue;
  }
  const embed = async (s) => Array.from((await extract(s, { pooling: 'mean', normalize: true })).data);
  for (const [view, text] of Object.entries(views)) {
    const rows = [];
    for (const c of cases) {
      const q = await embed(prefix.topic(c.topic));
      for (const t of c.tabs) rows.push({ topic: c.topic, on: t.on, title: t.title, s: cos(q, await embed(prefix.tab(text(t)))) });
    }
    let best = { acc: 0 };
    for (let th = 0.05; th < 0.95; th += 0.01) {
      const acc = rows.filter((r) => r.s >= th === r.on).length / rows.length;
      if (acc > best.acc) best = { th: +th.toFixed(2), acc };
    }
    const miss = rows.filter((r) => r.s >= best.th !== r.on);
    console.log(`\n${name} [${view}] best th=${best.th} acc=${(best.acc * 100).toFixed(0)}% (${rows.length - miss.length}/${rows.length})`);
    for (const m of miss) console.log(`  ${m.on ? 'MISS ' : 'FALSE'} ${m.s.toFixed(2)} ${m.topic} <- ${m.title}`);
  }
}
