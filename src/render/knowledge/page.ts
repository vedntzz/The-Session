import { knowledgeJson, type KnowledgeGraph } from "../../knowledge.js";
import { repoName } from "../../store.js";
import { escapeHtml } from "../html/text.js";
import { KNOWLEDGE_STYLE } from "./style.js";
import { KNOWLEDGE_CLIENT } from "./client.js";

export function renderKnowledge(graph: KnowledgeGraph): string {
  const payload = knowledgeJson(graph).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Session knowledge · ${escapeHtml(repoName(graph.repo))}</title><style>${KNOWLEDGE_STYLE}</style></head>
<body><header><div><span class="brand">THE SESSION</span><span class="slash">/</span><span>${escapeHtml(repoName(graph.repo))}</span></div><button id="export">Export agent context ↓</button></header>
<main><section class="heading"><div><p class="eyebrow">RECORDED RELATIONSHIPS</p><h1>Follow the work.</h1><p class="subtitle">Sessions, declared scope, and the files that changed.</p></div><div class="snapshot">Local snapshot<br>${escapeHtml(graph.snapshot.at)}<br>Last ${graph.snapshot.days} days</div></section>
<section class="toolbar" aria-label="Graph filters"><label class="search"><span>Search</span><input id="search" type="search" placeholder="Intent, session id, or file path" autocomplete="off"></label><label>Outcome <select id="outcome"><option value="all">All outcomes</option><option>merged</option><option>open</option><option>abandoned</option><option>empty</option></select></label><label class="neighbor"><input type="checkbox" id="neighbors"> Selected neighborhood</label></section>
<div id="coverage" class="coverage" role="status"></div>
<section class="workspace"><aside class="index"><div class="section-head">EXPLORE <span id="count"></span></div><div id="nodes" aria-label="Visible graph nodes"></div></aside>
<div class="canvas"><div class="legend" aria-label="Visible relationships"><label><input type="checkbox" data-edge="declared" checked><i class="declared"></i>Declared</label><label><input type="checkbox" data-edge="changed" checked><i class="changed"></i>Changed</label><label><input type="checkbox" data-edge="outside" checked><i class="outside"></i>Outside scope</label></div>
<svg id="graph" aria-label="Interactive graph of sessions and paths" role="group" tabindex="0"><g id="edges"></g><g id="vertices"></g></svg><div id="empty" class="empty" hidden></div>
<div class="canvas-tools"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit">Fit graph</button><button id="clear">Clear selection</button></div><div class="canvas-hint">Drag nodes · drag background to pan · scroll to zoom</div></div>
<aside id="inspector" class="inspector" aria-label="Selected node details"><p class="eyebrow">INSPECT</p><h2>Every connection has a record.</h2><p>Select a session or path to inspect its evidence.</p><p class="muted">Circles are sessions. Squares are paths. Scope paths may be directory prefixes.</p></aside></section>
<footer><span>No inferred dependencies, quality scores, or generated summaries.</span><span>Read-only · works offline · no account</span></footer></main>
<script id="data" type="application/json">${payload}</script><script>${KNOWLEDGE_CLIENT}</script></body></html>`;
}
