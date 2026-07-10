# RMINT — Recipe → Everything: Data Flow & Translation Logic

**Purpose of this document.** It explains, end to end, how a single input (a dish name, a recipe request, a YouTube link, or a pasted transcript) is turned into **one shared data object** and how **every screen derives its own view** from that object. Hand this file to any LLM together with a request like *"Build this as one self-contained `index.html`, inline CSS/JS, no libraries"* and it can reproduce the full behaviour.

> Companion file: `RMINT_APP_SPEC.md` covers the visual/DOM build of each screen. **This file covers the logic/pipeline** — the "how data moves." Where they overlap, this file is the source of truth for behaviour.

---

## 0. The one-paragraph mental model

There is exactly **one source of truth**: the global `appState` object. The user's input is parsed into a normalized **recipe object** `{ dish, ingredients, steps }`. `applyRecipe()` writes that recipe into `appState.sharedDish` (and updates the Discovery/Pairing anchor). Then a single function `sync()` calls every screen's render function. **No screen has its own data** — each one *derives* what it shows from `appState` every time `sync()` runs. Change the recipe once → all screens update together.

```
        ┌─────────────┐   parse    ┌──────────────┐  write   ┌───────────┐  render   ┌────────────────────────┐
 INPUT ─▶│ buildRecipe │──────────▶│ recipe object│─────────▶│ appState  │──────────▶│ 6 screens (all derived)│
        └─────────────┘            └──────────────┘ applyRec └───────────┘  sync()   └────────────────────────┘
   dish name / recipe          {dish, ingredients,        single source              Menu · Guide · Plan(Timeline
   request / YT link /          steps[6 params]}          of truth                   + Clock) · Discovery · Pairing
   transcript
```

---

## 1. Inputs and how each is handled

All input arrives through the **chat panel** (`sendChatMessage()`), triggered by the send button.

| Input type | Detection | Handling |
|---|---|---|
| **YouTube link** | regex `/(youtube\.com\|youtu\.be)/i` on the message text | Show a confirmation card ("Pull the recipe from this video?") with a **Generate Workflow** button. On click → `generateWorkflow(card, text)`. |
| **Dish name** (e.g. "Butter Chicken") | anything not matching the YT regex | Straight to `generateWorkflow(null, text)`. |
| **Recipe request** (e.g. "how to make Lamb Rogan Josh") | same path as dish name | `extractDishName()` pulls the dish out of the phrasing. |
| **Transcript / long text** | same path | `extractDishName()` finds a known dish or a plausible dish phrase inside it. |

```js
function sendChatMessage(){
  const ta=document.getElementById('chat-textarea');const text=ta.value.trim();if(!text)return;
  addChatMsg(text,'user');ta.value='';
  const isYT=/youtube\.com|youtu\.be/i.test(text);
  if(isYT){
    const card=document.createElement('div');card.className='chat-yt-suggest';
    card.innerHTML='<div class="yt-title">▶ Detected: YouTube Recipe Link</div><div class="small">Pull the recipe from this video and build the workflow?</div><button class="btn primary gen-btn" style="width:100%;margin-top:8px">Generate Workflow</button>';
    card.querySelector('.gen-btn').addEventListener('click',()=>generateWorkflow(card,text));
    appendChat(card);
  } else {
    generateWorkflow(null,text);
  }
}

function generateWorkflow(triggerCard,text){
  if(triggerCard)triggerCard.classList.add('disabled');
  const loading=document.createElement('div');loading.className='chat-message loading';
  loading.innerHTML='<span class="dots">Building recipe workflow</span>';appendChat(loading);
  setTimeout(()=>{                             // 1400ms simulated "AI thinking"
    const recipe=buildRecipe(text);            // (2) input → recipe object
    applyRecipe(recipe);                       // (3) recipe → appState → sync()
    loading.remove();
    const done=document.createElement('div');done.className='chat-message';
    done.innerHTML='✓ Built a '+recipe.steps.length+'-step workflow for <strong>'+recipe.dish+'</strong>.<br><span class="small">Synced to Canvas, Timeline, Clock &amp; Guide.</span>';
    appendChat(done);switchToMenu();
  },1400);
}
```

### 1.1 IMPORTANT — the honest limitation (state this to any implementer)

A static HTML page **cannot transcribe a real YouTube video or call an LLM at runtime** (no backend, no API key). So the engine below **simulates** extraction locally: it either matches a known dish in a small library or **synthesizes** a believable recipe from the dish name. The loading spinner sells the "AI is working" feel. For *real* video→recipe extraction you must add a backend (transcript API + an LLM); everything downstream in this document stays identical — only `buildRecipe()` would be replaced by a network call that returns the same `{dish, ingredients, steps}` shape.

---

## 2. Stage 1 — `buildRecipe(input)` → a normalized recipe object

`buildRecipe` always returns the same shape regardless of input:

```js
// recipe object shape
{
  dish: 'Butter Chicken',
  ingredients: [ { name:'Chicken Thighs', quantity:'700g' }, ... ],   // master list
  steps: [
    { title, process, duration, startTime, ingredients:[...names], chefs:[...] },   // the 6 params
    ...
  ]
}
```

Resolution order (first match wins):

```js
function buildRecipe(input){
  const lib=matchLibrary(input);        // 1) known dish in the library?
  if(lib)return cloneRecipe(lib);
  const name=extractDishName(input);    // 2) can we name the dish?
  if(name)return synthesizeRecipe(name);// ...then synthesize a plausible workflow
  return cloneRecipe(RECIPE_LIBRARY['butter chicken']); // 3) fallback (e.g. bare YT link)
}
```

### 2.1 Library match (`matchLibrary`)

A small set of hand-authored **real** recipes, plus an alias table (longest alias wins so "chicken biryani" beats "biryani").

```js
const RECIPE_LIBRARY = {
  'chicken biryani':   { dish:'Chicken Biryani',   ingredients:[...], steps:[...] },
  'butter chicken':    { dish:'Butter Chicken',    ingredients:[...], steps:[...] },
  'margherita pizza':  { dish:'Margherita Pizza',  ingredients:[...], steps:[...] }
};
const RECIPE_ALIASES = {
  'biryani':'chicken biryani','chicken biryani':'chicken biryani',
  'butter chicken':'butter chicken','murgh makhani':'butter chicken','makhani':'butter chicken',
  'margherita':'margherita pizza','margherita pizza':'margherita pizza','pizza':'margherita pizza'
};
function matchLibrary(input){
  const t=input.toLowerCase();let best=null,bestLen=0;
  for(const k in RECIPE_ALIASES){ if(t.includes(k)&&k.length>bestLen){best=RECIPE_ALIASES[k];bestLen=k.length;} }
  return best?RECIPE_LIBRARY[best]:null;
}
```

Each library recipe's steps are fully authored with all 6 parameters, e.g. Chicken Biryani:

```js
'chicken biryani':{dish:'Chicken Biryani',
  ingredients:[{name:'Chicken',quantity:'800g'},{name:'Yogurt',quantity:'200g'},{name:'Basmati Rice',quantity:'1kg'},{name:'Onions',quantity:'300g'},{name:'Biryani Spices',quantity:'60g'},{name:'Saffron',quantity:'1g'},{name:'Ghee',quantity:'100g'},{name:'Mint',quantity:'30g'}],
  steps:[
    {title:'Chicken Marination',   process:'Marinating', duration:'45m', startTime:'07:00', ingredients:['Chicken','Yogurt','Biryani Spices'], chefs:['SOUS','STATION']},
    {title:'Fry Onions (Birista)', process:'Frying',     duration:'25m', startTime:'07:15', ingredients:['Onions','Ghee'],                     chefs:['JUNIOR']},
    {title:'Par-boil Basmati Rice',process:'Boiling',    duration:'20m', startTime:'07:50', ingredients:['Basmati Rice'],                      chefs:['STATION']},
    {title:'Layer & Dum Cook',     process:'Steaming',   duration:'40m', startTime:'08:15', ingredients:['Chicken','Basmati Rice','Saffron','Mint'], chefs:['SOUS']},
    {title:'Rest & Serve',         process:'Plating',    duration:'15m', startTime:'08:55', ingredients:['Mint'],                              chefs:['TRAINEE']}]}
```

### 2.2 Dish-name extraction (`extractDishName`) — for unknown dishes / transcripts

Strips URLs/hashtags, then tries phrasing patterns, then falls back to short whole-input. `cleanDishPhrase` trims stopwords and caps to 4 words.

```js
const DISH_STOPWORDS=new Set(['that','which','my','from','and','with','for','the','a','an','to','in','on','at','by','of','today','we','are','is','this','recipe','video','was','were','it','its','will','can','you','your','our']);
function cleanDishPhrase(p){
  const words=p.trim().split(/\s+/);const kept=[];
  for(const w of words){
    const lw=w.toLowerCase().replace(/[^a-z'&-]/g,'');if(!lw)continue;
    if(DISH_STOPWORDS.has(lw)){ if(kept.length)break; else continue; }   // drop leading stopwords, stop at trailing
    kept.push(w.replace(/[^a-zA-Z'&-]/g,''));
    if(kept.length>=4)break;                                             // cap dish names at 4 words
  }
  return kept.join(' ').trim();
}
function extractDishName(input){
  let t=input.replace(/https?:\/\/\S+/g,' ').replace(/#\w+/g,' ').trim();
  let m=t.match(/(?:recipe for|how to make|how to cook|make a|make|cook|prepare)\s+([a-z][a-z\s'&-]{2,60})/i);
  if(m){const c=cleanDishPhrase(m[1]);if(c)return titleCase(c);}
  m=t.match(/([a-z][a-z\s'&-]{2,60})\s+recipe/i);
  if(m){const c=cleanDishPhrase(m[1]);if(c)return titleCase(c);}
  const words=t.split(/\s+/).filter(Boolean);
  if(words.length>0&&words.length<=6)return titleCase(t);
  return null;
}
```

### 2.3 Synthesis (`synthesizeRecipe`) — believable workflow for any dish

A fixed 5-stage cooking arc, with the dish name injected, sequential times computed from durations, and a de-duped master ingredient list.

```js
const GENERIC_QTY={'Aromatics':'50g','Cooking Oil':'30ml','Salt':'to taste','Onion':'200g','Garlic':'20g','Ginger':'15g','Main Ingredient':'600g','Spice Blend':'30g','Stock':'500ml','Seasoning':'to taste','Fresh Herbs':'20g','Garnish':'10g'};
const pad2=n=>String(n).padStart(2,'0');
function assignTimes(steps,start){                       // sequential clock from durations
  let[h,m]=start.split(':').map(Number);
  for(const s of steps){ if(!s.startTime)s.startTime=pad2(h)+':'+pad2(m); m+=parseInt(s.duration,10)||0; h+=Math.floor(m/60); m=m%60; }
}
function collectIngredients(steps){                      // union of step ingredients → master list
  const seen={},out=[];
  steps.forEach(s=>s.ingredients.forEach(n=>{ if(!seen[n]){seen[n]=1;out.push({name:n,quantity:GENERIC_QTY[n]||'as needed'});} }));
  return out;
}
function synthesizeRecipe(name){
  const steps=[
    {title:'Mise en Place',         process:'Prep',      duration:'20m', ingredients:['Aromatics','Cooking Oil','Salt'], chefs:['SOUS']},
    {title:'Build the Flavor Base', process:'Sautéing',  duration:'25m', ingredients:['Onion','Garlic','Ginger'],        chefs:['STATION']},
    {title:'Cook '+name,            process:'Cooking',   duration:'40m', ingredients:['Main Ingredient','Spice Blend'],  chefs:['SOUS','STATION']},
    {title:'Simmer & Combine',      process:'Simmering', duration:'30m', ingredients:['Stock','Seasoning'],              chefs:['JUNIOR']},
    {title:'Plate & Garnish',       process:'Plating',   duration:'15m', ingredients:['Fresh Herbs','Garnish'],          chefs:['TRAINEE']}
  ];
  assignTimes(steps,'07:00');
  return {dish:name, ingredients:collectIngredients(steps), steps};
}
```

`titleCase` and `cloneRecipe` helpers:
```js
function titleCase(s){return s.replace(/\w\S*/g,w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());}
function cloneRecipe(r){return JSON.parse(JSON.stringify(r));}
```

---

## 3. The 6 parameters — the atomic unit of everything

Every recipe **step** carries exactly these six fields. Every screen is ultimately a re-projection of these.

| # | Param | Type | Example | Consumed by |
|---|---|---|---|---|
| 1 | `title` | string | `"Chicken Marination"` | Canvas node, Guide card, Timeline bar, Clock tooltip |
| 2 | `process` | string | `"Marinating"` | Canvas meta, Guide, Clock list |
| 3 | `duration` | string `"<n>m"` | `"45m"` | Timeline bar width, Clock arc length (parsed via `parseInt`) |
| 4 | `startTime` | `"HH:MM"` (24h) | `"07:00"` | Timeline bar x-position, Clock arc angle |
| 5 | `ingredients` | string[] | `['Chicken','Yogurt']` | Guide, Clock list; union → master ingredient list |
| 6 | `chefs` | string[] ⊆ `['SOUS','STATION','JUNIOR','TRAINEE']` | `['SOUS','STATION']` | Timeline rows, Clock rings, chef chips; **fan-out** (see §5.1) |

---

## 4. Stage 2 — `applyRecipe(recipe)` writes the single source of truth

This is the **only** function that mutates the recipe data. It builds `appState.sharedDish` (steps + flowchart layout + master ingredients), updates the header title, points the Discovery/Pairing anchor at the new dish, then calls `sync()`.

```js
function applyRecipe(r){
  // (a) master ingredient list
  appState.sharedDish.ingredients = r.ingredients.slice();

  // (b) methodology steps + auto flowchart layout (4-column grid)
  const steps = r.steps.map((s,i)=>({
    id:String(Date.now()+i),
    title:s.title, process:s.process, duration:s.duration, startTime:s.startTime,
    ingredients:s.ingredients.slice(), chefs:s.chefs.slice(),
    x:200+(i%4)*250, y:200+Math.floor(i/4)*190
  }));
  appState.sharedDish.methodology = steps;

  // (c) Start/End sentinel nodes (visual-only; never appear in other views)
  const lastRow=Math.floor((steps.length-1)/4);
  appState.sharedDish.flowNodes=[
    {id:'_start',type:'start',label:'Start',x:60,y:224},
    {id:'_end',  type:'end',  label:'End',  x:200+4*250,y:200+lastRow*190+24}
  ];

  // (d) linear connections  Start → s1 → s2 → … → sN → End
  const conns=[{from:'_start',to:steps[0].id}];
  for(let i=0;i<steps.length-1;i++)conns.push({from:steps[i].id,to:steps[i+1].id});
  conns.push({from:steps[steps.length-1].id,to:'_end'});
  appState.sharedDish.connections=conns;

  // (e) header + Discovery/Pairing anchor dish
  const dt=document.getElementById('dish-title'); if(dt)dt.textContent=r.dish;
  appState.discovery.main.name=r.dish;

  sync();   // (f) re-render EVERYTHING
}
```

### 4.1 `appState` — the complete shape

```js
const appState = {
  selectedPlanStep:null,
  editingNodeId:null,
  sharedDish:{
    ingredients:[{name,quantity}, ...],           // master list (from recipe)
    methodology:[{ id, ...6 params, x, y }, ...],  // the recipe steps (+ canvas coords)
    flowNodes:[{id:'_start',type:'start',...},{id:'_end',type:'end',...}],
    connections:[{from,to}, ...]                   // directed edges for the canvas
  }
};
// added after declaration:
appState.discovery = { editingId, slideIndex, main:{name,colorIndex}, pool:[...], slides:[{name,items:[{id,name,colorIndex,angle}]}] };
appState.pairing   = { selectedId, pool:[...], nodes:[{id,name,type:'existing'|'missing',fx,fy}] };
```

Only `main.name` (Discovery) and the header are re-pointed on a new recipe; the Discovery slides and Pairing nodes are curated pairing sets that orbit whatever the current main dish is.

### 4.2 `sync()` — fan-out to every screen

```js
function sync(){
  renderIngredients();   // ingredients modal
  renderCanvas();        // Create Menu (flowchart)
  renderMethodology();   // no-op placeholder
  renderGuide();         // Create Guide
  renderTimeline();      // Create Plan · Timeline
  renderClockCards();    // Create Plan · step cards
  renderClockView();     // Create Plan · Clock
  renderDiscovery();     // Discovery
  renderPairing();       // Pairing
}
sync();                  // once on load
```

---

## 5. The two derivation helpers every downstream screen shares

### 5.1 `deriveTasks()` — chef fan-out (Timeline + Clock)

A step assigned to *N* chefs becomes *N* tasks (one lane/ring per chef). This is computed on demand, never stored.

```js
function deriveTasks(){
  const tasks=[];
  appState.sharedDish.methodology.forEach(step=>{
    step.chefs.forEach(chef=>{
      tasks.push({title:step.title, chef, startTime:step.startTime, duration:parseInt(step.duration,10), process:step.process, ingredients:step.ingredients});
    });
  });
  return tasks;
}
```
Example: a 3-step Biryani where step 1 has 2 chefs, steps 2 & 3 have 1 each → `deriveTasks().length === 4`.

### 5.2 `metricsFor(name)` — business metrics for ANY dish (Discovery + Pairing)

Known dishes get authored metrics; unknown dishes get **stable, deterministic** pseudo-metrics from a string hash (so the same dish always yields the same numbers).

```js
const DISH_METRICS = {
  'Chicken Biryani':{demand:95,prep:'45m',margin:'$18.00',risk:38},
  'Butter Chicken':{demand:94,prep:'20m',margin:'$22.00',risk:43},
  /* … many more, incl. sides/breads/desserts/beverages … */
};
function metricsFor(name){
  if(DISH_METRICS[name])return {...DISH_METRICS[name]};
  let h=0;for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0;   // deterministic hash
  return { demand:70+(h%29), prep:(5+(h%9)*5)+'m', margin:'$'+(2+(h%20))+'.00', risk:5+(h%90) };
}
```
Returns `{ demand:0-100 number, prep:'<n>m', margin:'$x.xx', risk:0-100 }`. This means **a freshly generated/unknown dish still populates Discovery and Pairing with believable numbers**.

Two more derivations used by Discovery/Pairing:
```js
function dishDiff(name){ /* 0-100 "difference from a typical main"; authored map + hash fallback */ }
function aiNote(name){  /* short pairing/business sentence, chosen from demand + dishDiff bands */ }
function dishInfo(name){/* {category,desc,ingredients[],method,chef,notes[]} authored map + generic fallback */ }
```

---

## 6. Per-screen translation (how each screen re-projects `appState`)

### 6.1 Create Menu — Flowchart Canvas
**Reads:** `sharedDish.methodology` (+ `x,y`), `sharedDish.flowNodes`, `sharedDish.connections`.
**Mapping:**
- each methodology step → one draggable **node** at `(x,y)` showing `title` + `process · duration · startTime` + chef chips;
- `_start`/`_end` → the green/clay pill sentinels;
- `connections[]` → SVG bezier arrows between node centers.
**Writes back:** editing a node (modal) mutates that step's 6 params → `sync()`; dragging updates `x,y`; connecting/disconnecting edits `connections`; "+ Add Step" pushes a new methodology step. So the canvas is the one screen that can **edit** the recipe; every edit re-fans-out through `sync()`.

### 6.2 Create Guide
**Reads:** `sharedDish.methodology`.
**Mapping:** one read-only card per step → thumbnail + `title` + `Process/Start/Duration/Chefs/Ingredients`. Pure projection, no fan-out.

```js
function renderGuide(){
  document.getElementById('guide-cards').innerHTML = appState.sharedDish.methodology.map(step=>
    `<div class="guide-card">…<div class="node-title">${step.title}</div>
      <div class="small">Process: ${step.process}</div><div class="small">Start: ${step.startTime}</div>
      <div class="small">Duration: ${step.duration}</div><div class="small">Chefs: ${step.chefs.join(', ')}</div>
      <div class="small">Ingredients: ${step.ingredients.join(', ')}</div></div>`).join('');
}
```

### 6.3 Create Plan — Timeline (Gantt)
**Reads:** `deriveTasks()`.
**Mapping (fixed 7AM–7PM window, 4 chef rows):**
- row = `chef`; a task's bar within the row:
  - `left = ((startHour - 7) * 60 + startMin)` px (from 7AM),
  - `width = duration * 4` px (4px per minute);
- click a bar → `showTask()` alert with the step details.

```js
const parts=task.startTime.split(':');
const left=((parseInt(parts[0])-7)*60)+parseInt(parts[1]);
const width=task.duration*4;
```

### 6.4 Create Plan — Clock (radial schedule)
**Reads:** `deriveTasks()`.
**Mapping:** one **concentric ring per chef** (`SOUS` outer → `TRAINEE` inner). Each task → a colored **arc** on its chef's ring:
- time→angle over a 12-hour window: `CLOCK_START_MIN=420 (07:00)`, `CLOCK_END_MIN=1140 (19:00)`, `deg = ((mins-420)/720)*360` (0° at 12 o'clock, clockwise);
- arc spans `startTime → startTime+duration`;
- color = per-chef color; click → same `showTask()`.
Left panel = chef legend + all tasks sorted by start time. Hour ticks 7AM→6PM around the rim.

### 6.5 Discovery — pairing lattices + metrics table
**Reads:** `discovery.main.name` (= the current recipe dish), `discovery.slides[slideIndex]`, `metricsFor`, `dishDiff`, `aiNote`.
**Mapping:**
- **MAIN** lattice (pinned, not editable) = the generated dish;
- each slide = a themed set of complement dishes shown as **overlapping** colored cards;
- **position** of each complement = `f(demand, difference)`:
  `nr = 15 + (dishDiff/100)*24 + ((100-demand)/100)*16` (radius from centre; **higher demand → closer, more different → farther**);
- **demand = 100** → the item nests **inside** the main as a subset chip instead of orbiting;
- click a complement → dropdown to **swap** the dish (metrics via `metricsFor`, colour cycles, position recomputes);
- **metrics table** below = main + current slide items, columns **Menu Items · Prep Window · Unit Margin · Demand (number) · AI Notes** (from `aiNote`).
Generating a new recipe updates only `discovery.main.name`; the pairing sets stay curated.

### 6.6 Pairing — Menu Relationship Map (taste graph)
**Reads:** `discovery.main.name` (centre), `pairing.nodes` (with flavour coords `fx,fy` and `type`), `metricsFor`, `dishInfo`, `aiNote`.
**Mapping:**
- **centre node** = the current main dish (`prep · margin · demand`);
- each node placed by **flavour coordinate** on a Sweet/Savory × Spicy/Fresh/Umami/Creamy plane: `x% = 50 + fx*40`, `y% = 50 - fy*38`;
- **visual encoding:** node **size = demand** (`nodeSize`), **border thickness = margin** (`borderW`), **type**: `existing` = orange-bordered circle ("on menu"), `missing` = grey dashed circle ("opportunity");
- **compatibility line** centre→node, width `1 + compat*4`, colour clay if `compat>0.6` else grey, dashed for missing (`compat = 1 - dist(fx,fy)/1.5`);
- **hover** → tooltip (name/prep/margin/demand/category);
- **click** → right details panel: Description, Ingredients, Prep Method · Chef, **Demand · Prep Time · Margin**, AI Notes, plus:
  - **"+ Add to menu"** CTA on an opportunity node (flips `type→existing`, border → orange),
  - **"Remove from menu"** CTA on a current node (flips `type→missing`),
  - **Swap / Upgrade Options** card grid — pick a pool dish to replace the node.

---

## 7. End-to-end worked examples

### 7.1 Known dish — user types `butter chicken`
1. `sendChatMessage` → not YT → `generateWorkflow(null,'butter chicken')`.
2. loading bubble → after 1.4s → `buildRecipe('butter chicken')`.
3. `matchLibrary` hits alias `'butter chicken'` → returns the authored 6-step recipe (clone).
4. `applyRecipe`: methodology = 6 steps (with grid `x,y`), Start/End nodes, 7 connections, master ingredients; header = "Butter Chicken"; `discovery.main.name='Butter Chicken'`.
5. `sync()`: Canvas shows 8 nodes; Guide 6 cards; Timeline bars (fan-out by chef); Clock arcs; Discovery main lattice = Butter Chicken; Pairing centre = Butter Chicken. ✓

### 7.2 Unknown dish / transcript — `"Today we're making a wonderful Lamb Rogan Josh that grandma taught me"`
1. Not YT → `generateWorkflow`.
2. `buildRecipe`: `matchLibrary` misses → `extractDishName` finds `"Lamb Rogan Josh"` (pattern `make …`, stopword-trimmed to 3 words) → `synthesizeRecipe('Lamb Rogan Josh')`.
3. Synthesis: 5 stages (`… Cook Lamb Rogan Josh …`), sequential times from 07:00, generic-but-plausible master ingredients.
4. `applyRecipe` + `sync()`: all screens populate; Discovery/Pairing metrics for "Lamb Rogan Josh" come from the deterministic hash in `metricsFor`, so they look real and stable. ✓

### 7.3 YouTube link — `https://youtu.be/xyz123`
1. YT regex matches → confirmation card → user clicks **Generate Workflow** → `generateWorkflow(card, url)`.
2. `buildRecipe(url)`: `extractDishName` strips the URL → empty → returns `null` → **fallback** clone of a library recipe (so it still looks real).
3. If the message had text alongside the link (e.g. "biryani https://youtu.be/…"), `matchLibrary`/`extractDishName` would pick that dish instead.
4. `applyRecipe` + `sync()`. ✓ *(Real transcription would replace step 2 with a backend call returning the same `{dish,ingredients,steps}`.)*

---

## 8. Invariants an implementer must preserve

1. **Single source of truth.** No screen stores its own copy of recipe data; all read `appState` at render time.
2. **One writer.** Only `applyRecipe` (new recipe) and the Canvas editors (`updateStep`/drag/connect/add) mutate `sharedDish`; both end in `sync()`.
3. **The 6 params are canonical.** Every screen is a projection of `title/process/duration/startTime/ingredients/chefs`.
4. **Fan-out lives in `deriveTasks`.** Timeline and Clock must both go through it so a multi-chef step appears once per chef.
5. **`metricsFor` must be deterministic.** Same dish name → same demand/prep/margin/risk every call (hash fallback), so Discovery/Pairing don't flicker.
6. **`buildRecipe` always returns `{dish, ingredients, steps[6 params]}`** — this is the contract. Swapping the local engine for a real LLM/transcript backend means only this function changes; everything downstream is untouched.
7. **Times use a 7AM–7PM (420–1140 min) window** across Timeline and Clock; keep them consistent.

---

## 9. How to extend

- **Add a real dish to the library:** add an entry to `RECIPE_LIBRARY` (same `{dish,ingredients,steps}` shape) + one or two `RECIPE_ALIASES`.
- **Better business numbers:** add the dish to `DISH_METRICS` (else the hash fallback is used).
- **Richer pairing/discovery:** add to `DISH_INFO` (category/desc/ingredients/method/chef/notes) and `DISH_DIFF`.
- **Real video/LLM extraction:** replace `buildRecipe` with an async call to a backend that returns the identical recipe object, then `await` it inside `generateWorkflow` before `applyRecipe`.

---

*Together with `RMINT_APP_SPEC.md` (DOM/CSS build), this file is enough for an LLM to regenerate the entire app: single `index.html`, inline CSS/JS, no frameworks, no backend.*
