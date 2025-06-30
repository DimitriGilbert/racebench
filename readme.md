# RaceBench: AI Model JS Code Generation Benchmark

## What is this?
RaceBench is a benchmarking tool for comparing the JavaScript code generation capabilities of various AI models (LLMs). It takes a set of model responses to a creative coding prompt, extracts runnable JS code, and generates a beautiful, sortable, and searchable HTML dashboard to visually compare results.

## Why does it exist?
Modern LLMs can generate not just text, but also executable code. RaceBench was created to:
- Compare how different models handle complex, creative coding tasks (like games, visualizations, etc.)
- Provide a fair, visual, and interactive way to explore and analyze model outputs
- Help researchers, developers, and enthusiasts see strengths and weaknesses of each model in a real, runnable context

## How does it work?
- You provide a `race.json` file with model responses (see example prompt in the UI)
- Run the `get-results.js` script (Node.js required)
- The script extracts the last runnable JS block from each response, gathers stats, and generates:
  - `index.html`: a homepage with a grid and sortable table of all results
  - One HTML file per model, each showing a live preview and raw response
- The UI uses Tailwind CSS and [simple-datatables](https://github.com/fiduswriter/simple-datatables) for a modern, interactive experience
- You can toggle between grid and table views, sort by any column, search, and open each result in a new tab

## How to use
1. **Requirements:** Node.js (for running the script), a browser (for viewing results)
2. Place your `race.json` in the project directory
3. Run: `node get-results.js`
4. Serve the directory with any static file server (e.g. `python3 -m http.server`)
5. Open `index.html` in your browser
6. Explore, sort, and compare!

## Command-Line Options

The main script is `get-results.js`. You can run it with optional arguments to control input and output:

```
node get-results.js [--input <inputfile>] [--outdir <outputdir>]
```

- `--input <inputfile>`  
  Path to the input JSON file (default: `./race.json`).  
  Example:  
  ```sh
  node get-results.js --input mydata.json
  ```

- `--outdir <outputdir>`  
  Directory where the HTML files will be generated (default: current directory).  
  Example:  
  ```sh
  node get-results.js --outdir ./public/results
  ```

**You can combine both options:**
```sh
node get-results.js --input mydata.json --outdir ./public/results
```

If you don't specify any options, it will use `race.json` in the current directory and output files there.

## Features
- Beautiful, responsive UI (dark mode supported)
- Toggle between card grid and sortable table
- All columns sortable, with search and pagination
- Each model result opens in a new tab with live preview and raw output
- No backend required: fully static, portable, and easy to share

## Credits
- UI: Tailwind CSS, [simple-datatables](https://github.com/fiduswriter/simple-datatables)
- Created by didi and contributors

## License
MIT
