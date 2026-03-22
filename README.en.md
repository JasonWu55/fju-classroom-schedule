# FJU Classroom Schedule Lookup

This is a static classroom schedule lookup site for checking one room at a time across the week. After entering a full room code, the page shows that room's occupied and free periods from Monday through Saturday. If there is no exact match, the interface offers the nearest room suggestions.

## What it does

- Looks up a single classroom by full room code
- Suggests nearby room codes when no exact match is found
- Keeps a weekly timetable matrix on desktop
- Uses a day-based card view on mobile so each weekday can be checked separately

## Data source and current lookup behavior

- The data file is `fju_day_courses.json`
- The upstream source is recorded in the JSON file as `source_url`, currently `http://estu.fju.edu.tw/fjucourse/Secondpage.aspx`
- The app fetches the JSON in the browser and builds its room index on the client side
- The current implementation uses only the first schedule group, `weekday_1`, `period_1`, `room_1`, together with `week_1`
- The `*_2` and `*_3` schedule groups are intentionally ignored by the current lookup
- Period ranges such as `D1-D2` are expanded into individual timetable slots before rendering

## Run locally

This project is a static site. Opening `index.html` directly may fail because the browser blocks local JSON fetches, so serve the folder with a small local server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/`.

## Deployment note

Because the project is made of static HTML, CSS, JavaScript, and JSON files, it is a good fit for GitHub Pages. Publishing this directory as a static site is enough, with no build step and no backend service required.

## Files

- `index.html`, page structure
- `styles.css`, presentation
- `app.js`, lookup, indexing, and rendering logic
- `fju_day_courses.json`, course data and metadata
