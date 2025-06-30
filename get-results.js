const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// --- Configuration ---
const raceJsonPath = path.join(__dirname, 'race.json');
const outputIndexPath = path.join(__dirname, 'index.html');
// No hardcoded output directory. Everything is generated in the current directory.
// ---------------------

/**
 * Extracts the content of the last ```runjs block from a response string.
 * @param {string} responseText The full response text from the model.
 * @returns {string|null} The runnable JS code or null if not found.
 */
function extractLastRunJsCode(responseText) {
    if (!responseText) return null;
    const regex = /```runjs\n([\s\S]*?)\n```/g;
    const matches = [...responseText.matchAll(regex)];
    if (matches.length > 0) {
        return matches[matches.length - 1][1]; // Return the content of the last match
    }
    return null;
}

/**
 * Extracts the model name from a complex model ID string.
 * This logic is based on the splitModelId function found in the codebase.
 * e.g., "id:owner/model-name:tag" -> "model-name"
 * e.g., "id:model-name:tag" -> "model-name"
 * e.g., "id:owner/model-name" -> "model-name"
 * @param {string} combinedId The full model ID.
 * @returns {string|null} The extracted model name or null.
 */
function extractModelName(combinedId) {
    if (!combinedId || !combinedId.includes(':')) {
        return null;
    }
    const parts = combinedId.split(':');
    if (parts.length < 2) {
        return null;
    }
    // The model identifier is the second part, which might contain a path.
    const modelIdentifier = parts[1]; 
    const pathParts = modelIdentifier.split('/');
    // The actual name is the last part of the path.
    return pathParts[pathParts.length - 1];
}

/**
 * Calculates the byte length of a string.
 * @param {string} str The string to measure.
 * @returns {number} The length of the string in bytes.
 */
function getByteLength(str) {
    if (str === null || str === undefined) return 0;
    return Buffer.byteLength(str, 'utf8');
}

/**
 * Formats bytes into a human-readable string (KB, MB, etc.).
 * @param {number} bytes The number of bytes.
 * @param {number} [decimals=2] The number of decimal places.
 * @returns {string} The formatted byte string.
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || bytes === null || bytes === undefined) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Formats milliseconds into a human-readable string (ms, s).
 * @param {number} ms The number of milliseconds.
 * @returns {string} The formatted time string.
 */
function formatTime(ms) {
    if (ms === null || ms === undefined) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Fetches data from a URL or reads from a local file.
 * @param {string} source The URL or file path.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON data.
 */
async function getRaceData(source) {
    console.log(`Fetching data from: ${source}`);
    return new Promise((resolve, reject) => {
        if (source.startsWith('http')) {
            const client = source.startsWith('https') ? https : http;
            client.get(source, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', (err) => reject(err));
        } else {
            try {
                const fileContent = fs.readFileSync(source, 'utf8');
                resolve(JSON.parse(fileContent));
            } catch (error) {
                reject(error);
            }
        }
    });
}

/**
 * Generates the full HTML page for a single model's result.
 * @param {string} modelName - The name of the AI model.
 * @param {string} runjsCode - The JavaScript code to be executed.
 * @param {string} fullResponse - The complete, raw response from the model.
 * @returns {string} The complete HTML content for the model's page.
 */
function generateModelHtmlPage(modelName, runjsCode, fullResponse) {
    const sanitizedResponse = fullResponse ? fullResponse.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "No response content.";

    // The litechat mock API is a self-contained script to provide the environment for the runjs code.
    const litechatApiScript = `
        const litechatTarget = document.getElementById('litechat-target');
        async function loadModules(moduleConfigs) {
            const loadedModules = {};
            const loadPromises = {};
            const globalImportMap = {};
            moduleConfigs.forEach(config => {
                if (config.importMap) Object.assign(globalImportMap, config.importMap);
            });
            const existingMap = document.querySelector('script[type="importmap"]');
            if (existingMap) existingMap.remove();
            if (Object.keys(globalImportMap).length > 0) {
                const mapScript = document.createElement('script');
                mapScript.type = 'importmap';
                mapScript.textContent = JSON.stringify({ imports: globalImportMap });
                document.head.appendChild(mapScript);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            const loadSingleModule = async (config) => {
                const key = config.globalKey || config.name;
                if (window[key]) return window[key];
                if (key in loadPromises) return loadPromises[key];
                if (config.dependencies) {
                    await Promise.all(config.dependencies.map(depKey => {
                        const depModule = moduleConfigs.find(m => (m.globalKey || m.name) === depKey);
                        if (depModule) return loadSingleModule(depModule);
                        return Promise.resolve();
                    }));
                }
                loadPromises[key] = (async () => {
                    try {
                        const module = await import(config.url);
                        window[key] = module;
                        loadedModules[key] = module;
                        return module;
                    } catch (error) {
                        console.error(\`Error loading module \${config.name}:\`, error);
                        throw error;
                    }
                })();
                return loadPromises[key];
            };
            await Promise.all(moduleConfigs.map(config => loadSingleModule(config)));
            return loadedModules;
        }
        window.litechat = {
            utils: {
                log: (...args) => console.log(...args),
                toast: (message) => alert(message),
                error: (...args) => console.error(...args),
                warn: (...args) => console.warn(...args),
                loadModules,
                loadModule: async (url, name, key, importMap) => (await loadModules([{url, name, globalKey: key, importMap}]))[key || name],
            },
            target: litechatTarget,
            emit: (eventName, payload) => window.dispatchEvent(new CustomEvent(eventName, { detail: payload })),
        };
    `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${modelName} - LiteChat Race Result</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .tab-button { transition: all 0.2s ease-in-out; border-bottom: 2px solid transparent; }
        .tab-button.active { border-bottom-color: #6366f1; color: #4f46e5; background-color: #e0e7ff; }
        .dark .tab-button.active { border-bottom-color: #818cf8; color: #a5b4fc; background-color: #374151; }
    </style>
</head>
<body class="bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-4 sm:p-6 md:p-8">
    <div class="max-w-7xl mx-auto container bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
        <div class="header bg-gradient-to-r from-violet-600 to-indigo-600 text-white p-6 sm:p-8 text-center">
            <h1 class="text-3xl sm:text-4xl font-bold mb-2">🚀 ${modelName}</h1>
            <p class="text-indigo-200">LiteChat Race Result</p>
        </div>
        
        <div class="p-4 sm:p-6">
            <div class="border-b border-gray-200 dark:border-gray-700 mb-4">
                <nav class="-mb-px flex space-x-4" aria-label="Tabs">
                    <button class="tab-button active text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 whitespace-nowrap py-3 px-4 font-medium text-sm rounded-t-md" data-tab="preview">Live Preview</button>
                    <button class="tab-button text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 whitespace-nowrap py-3 px-4 font-medium text-sm rounded-t-md" data-tab="raw">Raw Response</button>
                </nav>
            </div>

            <div id="preview" class="tab-content active">
                <div id="litechat-target" class="w-full min-h-[600px] bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600"></div>
            </div>

            <div id="raw" class="tab-content">
                <div class="w-full min-h-[600px] bg-gray-900 text-white rounded-lg p-4 overflow-x-auto font-mono">
                    <pre class="whitespace-pre-wrap text-sm"><code>${sanitizedResponse}</code></pre>
                </div>
            </div>
        </div>

        <div class="footer bg-gray-50 dark:bg-gray-800/50 p-4 border-t border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
            Generated by <strong>LiteChat</strong> • <a href="./index.html" class="text-indigo-600 dark:text-indigo-400 hover:underline">Back to Main Page</a>
        </div>
    </div>

    <script type="module">
        // Tab switching logic
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                const tabId = button.dataset.tab;
                tabContents.forEach(content => content.id === tabId ? content.classList.add('active') : content.classList.remove('active'));
            });
        });
        
        // --- LITECHAT MOCK API ---
        ${litechatApiScript}

        // --- EXECUTE CODE ---
        try {
            // Inject the extracted runjs code here
            ${runjsCode || `litechat.utils.error("No runnable 'runjs' code block found in the response.");`}
        } catch (error) {
            console.error('Execution error:', error);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'p-4 text-red-600 bg-red-100 border border-red-200 rounded-md';
            errorDiv.textContent = 'Execution Error: ' + error.message;
            document.getElementById('litechat-target').appendChild(errorDiv);
        }
    </script>
</body>
</html>`;
}

/**
 * Generates the HTML for the main index page's results grid/card view.
 * @param {Map<string, object>} modelRaceInfo - A map of model names to their stats.
 * @param {string[]} generatedFiles - A list of generated HTML file paths.
 * @returns {string} The HTML string for the grid view.
 */
function generateResultsList(modelRaceInfo, generatedFiles) {
    return generatedFiles.map(file => {
        const modelName = path.basename(file, '.html');
        const data = modelRaceInfo.get(modelName) || {};
        return `<li class="bg-white dark:bg-gray-700 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">${modelName}</h3>
                <a href="./${file}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                    View Result
                </a>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400">
                <div>
                    <span class="font-medium">Response Size:</span><br>
                    <span class="text-gray-900 dark:text-gray-100">${formatBytes(data.responseBytes)}</span>
                </div>
                <div>
                    <span class="font-medium">Code Size:</span><br>
                    <span class="text-gray-900 dark:text-gray-100">${formatBytes(data.runjsBytes)}</span>
                </div>
                <div>
                    <span class="font-medium">Tokens (Out/In):</span><br>
                    <span class="text-gray-900 dark:text-gray-100">${data.completionTokens ?? 'N/A'} / ${data.promptTokens ?? 'N/A'}</span>
                </div>
                <div>
                    <span class="font-medium">TTFT:</span><br>
                    <span class="text-gray-900 dark:text-gray-100">${formatTime(data.timeToFirstToken)}</span>
                </div>
                <div>
                    <span class="font-medium">Total Time:</span><br>
                    <span class="text-gray-900 dark:text-gray-100">${formatTime(data.generationTime)}</span>
                </div>
            </div>
        </li>`;
    }).join('\n');
}

/**
 * Generates the HTML for the main index page's results table.
 * @param {Map<string, object>} modelRaceInfo - A map of model names to their stats.
 * @param {string[]} generatedFiles - A list of generated HTML file paths.
 * @returns {string} The HTML string for the table body.
 */
function generateResultsTable(modelRaceInfo, generatedFiles) {
    return generatedFiles.map(file => {
        const modelName = path.basename(file, '.html');
        const data = modelRaceInfo.get(modelName) || {};
        return `<tr>
            <td><a href="./${file}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline font-medium">${modelName}</a></td>
            <td data-sort="${data.responseBytes || 0}">${formatBytes(data.responseBytes)}</td>
            <td data-sort="${data.runjsBytes || 0}">${formatBytes(data.runjsBytes)}</td>
            <td data-sort="${data.completionTokens || 0}">${data.completionTokens ?? 'N/A'}</td>
            <td data-sort="${data.promptTokens || 0}">${data.promptTokens ?? 'N/A'}</td>
            <td data-sort="${data.timeToFirstToken || 0}">${formatTime(data.timeToFirstToken)}</td>
            <td data-sort="${data.generationTime || 0}">${formatTime(data.generationTime)}</td>
        </tr>`;
    }).join('\n');
}

/**
 * Generates the main index.html page content.
 * @param {string} resultsListHtml - The generated HTML for the grid view.
 * @param {string} resultsTableHtml - The generated HTML for the table view.
 * @returns {string} The complete HTML for index.html.
 */
function generateIndexHtml(resultsListHtml, resultsTableHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LiteChat JS Executable Race</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/simple-datatables@latest/dist/style.css" rel="stylesheet" type="text/css">
    <script src="https://cdn.jsdelivr.net/npm/simple-datatables@latest" type="text/javascript"></script>
    <style>
        body{background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
        
        /* DataTable wrapper styling */
        .dataTable-wrapper {
            background: transparent !important;
            border: none !important;
        }
        
        /* Table styling */
        .dataTable-table {
            width: 100% !important;
            border-collapse: collapse !important;
            background: white !important;
            border-radius: 0.5rem !important;
            overflow: hidden !important;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1) !important;
        }
        
        .dark .dataTable-table {
            background: #374151 !important;
        }
        
        /* Header styling */
        .dataTable-table thead th {
            background: #f9fafb !important;
            padding: 12px 16px !important;
            text-align: left !important;
            font-weight: 600 !important;
            color: #374151 !important;
            border-bottom: 1px solid #e5e7eb !important;
            cursor: pointer !important;
            user-select: none !important;
        }
        
        .dark .dataTable-table thead th {
            background: #4b5563 !important;
            color: #f9fafb !important;
            border-bottom-color: #6b7280 !important;
        }
        
        .dataTable-table thead th:hover {
            background: #f3f4f6 !important;
        }
        
        .dark .dataTable-table thead th:hover {
            background: #6b7280 !important;
        }
        
        /* Body styling */
        .dataTable-table tbody td {
            padding: 12px 16px !important;
            border-bottom: 1px solid #f3f4f6 !important;
            color: #374151 !important;
        }
        
        .dark .dataTable-table tbody td {
            border-bottom-color: #4b5563 !important;
            color: #f9fafb !important;
        }
        
        .dataTable-table tbody tr:hover {
            background: #f9fafb !important;
        }
        
        .dark .dataTable-table tbody tr:hover {
            background: #4b5563 !important;
        }
        
        /* Sorting arrows */
        .dataTable-sorter::after {
            content: " ↕" !important;
            opacity: 0.3 !important;
        }
        
        .dataTable-sorter.asc::after {
            content: " ↑" !important;
            opacity: 1 !important;
            color: #6366f1 !important;
        }
        
        .dataTable-sorter.desc::after {
            content: " ↓" !important;
            opacity: 1 !important;
            color: #6366f1 !important;
        }
        
        /* Search and controls */
        .dataTable-top {
            padding: 1rem 0 !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
        }
        
        .dataTable-search input {
            padding: 0.75rem 1.25rem !important;
            border: 2px solid #6366f1 !important;
            border-radius: 0.5rem !important;
            background: #fff !important;
            color: #1e293b !important;
            font-size: 1.1rem !important;
            font-weight: 500 !important;
            box-shadow: 0 1px 2px 0 rgba(99,102,241,0.08);
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .dataTable-search input:focus {
            border-color: #4f46e5 !important;
            outline: none !important;
            box-shadow: 0 0 0 2px #6366f1 !important;
        }
        .dark .dataTable-search input {
            background: #1e293b !important;
            border-color: #818cf8 !important;
            color: #f9fafb !important;
        }
        .dataTable-selector select {
            padding: 0.75rem 1.25rem !important;
            border: 2px solid #6366f1 !important;
            border-radius: 0.5rem !important;
            background: #fff !important;
            color: #1e293b !important;
            font-size: 1.1rem !important;
            font-weight: 500 !important;
            margin-left: 1rem !important;
            box-shadow: 0 1px 2px 0 rgba(99,102,241,0.08);
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .dataTable-selector select:focus {
            border-color: #4f46e5 !important;
            outline: none !important;
            box-shadow: 0 0 0 2px #6366f1 !important;
        }
        .dark .dataTable-selector select {
            background: #1e293b !important;
            border-color: #818cf8 !important;
            color: #f9fafb !important;
        }
        .dataTable-pagination a {
            padding: 0.75rem 1.25rem !important;
            margin: 0 0.25rem !important;
            border: 2px solid #6366f1 !important;
            border-radius: 0.5rem !important;
            background: #fff !important;
            color: #4f46e5 !important;
            font-size: 1.1rem !important;
            font-weight: 600 !important;
            transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .dataTable-pagination a:hover {
            background: #6366f1 !important;
            color: #fff !important;
            border-color: #6366f1 !important;
        }
        .dataTable-pagination a.active {
            background: #4f46e5 !important;
            color: #fff !important;
            border-color: #4f46e5 !important;
        }
        .dark .dataTable-pagination a {
            background: #1e293b !important;
            border-color: #818cf8 !important;
            color: #a5b4fc !important;
        }
        .dark .dataTable-pagination a:hover {
            background: #818cf8 !important;
            color: #1e293b !important;
        }
        .dark .dataTable-pagination a.active {
            background: #6366f1 !important;
            color: #fff !important;
            border-color: #6366f1 !important;
        }
    </style>
</head>
<body class="bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-4 sm:p-6 md:p-8">
    <div class="max-w-7xl mx-auto container bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
        <div class="header bg-gradient-to-r from-violet-600 to-indigo-600 text-white p-6 sm:p-8 text-center">
            <h1 class="text-3xl sm:text-4xl font-bold mb-2">🚀 LiteChat JS Executable Race</h1>
            <p class="text-indigo-200">Comparing code generation capabilities of various models.</p>
        </div>
        <div class="content p-6 sm:p-8">
            <div class="prompt-container mb-8">
                <h2 class="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">Prompt</h2>
                <div class="markdown-content bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <p class="text-gray-700 dark:text-gray-300">could you create a 2D scroll shooter with 3D effect using a runjs block and three js ?</p>
                    <p class="mt-2 text-gray-700 dark:text-gray-300">Make it colorful and poppy !<br />I want the game area to feel comfy<br />we should have live,<br />random bonus drop:</p>
                    <ul class="list-disc list-inside mt-2 text-gray-700 dark:text-gray-300 space-y-1">
                        <li>faster fire rate (+10% per bonus)</li>
                        <li>bouncy fire (bounce on killed enemy up to number of bonus time)</li>
                        <li>more gun : 1 - 2 alternate left/right - 3 in |/</li>
                        <li>extra life</li>
                    </ul>
                    <p class="mt-2 text-gray-700 dark:text-gray-300">enemy get faster or stronger other time</p>
                </div>
            </div>
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-2xl font-bold text-gray-800 dark:text-gray-200">Results</h2>
                <button id="view-toggle" class="px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500">View as Table</button>
            </div>
            <ul id="results-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${resultsListHtml}</ul>
            <div id="results-table-container" class="hidden">
                <table id="results-table">
                    <thead>
                        <tr>
                            <th>Model</th>
                            <th>Response Size</th>
                            <th>Code Size</th>
                            <th>Completion Tokens</th>
                            <th>Prompt Tokens</th>
                            <th>TTFT</th>
                            <th>Total Time</th>
                        </tr>
                    </thead>
                    <tbody>${resultsTableHtml}</tbody>
                </table>
            </div>
        </div>
        <div class="footer bg-gray-50 dark:bg-gray-800/50 p-4 border-t border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
            Generated by <strong>LiteChat</strong> • Visit <a href="https://litechat.dbuild.dev" class="text-indigo-600 dark:text-indigo-400 hover:underline">litechat.dbuild.dev</a>
        </div>
    </div>
    <script>
        console.log('🚀 Script loading...');
        console.log('simpleDatatables available:', typeof simpleDatatables);
        console.log('DataTable constructor:', typeof simpleDatatables?.DataTable);
        
        document.addEventListener('DOMContentLoaded', function() {
            console.log('🎯 DOM Content Loaded');
            
            let dataTable = null;
            const btn = document.getElementById('view-toggle');
            const grid = document.getElementById('results-grid');
            const tableContainer = document.getElementById('results-table-container');
            const table = document.getElementById('results-table');
            
            console.log('Elements found:', {
                btn: !!btn,
                grid: !!grid,
                tableContainer: !!tableContainer,
                table: !!table
            });
            
            function initDataTable() {
                console.log('🔄 initDataTable called');
                try {
                    if (dataTable) {
                        console.log('🗑️ Destroying existing DataTable');
                        dataTable.destroy();
                        dataTable = null;
                    }
                    
                    console.log('📊 Table element:', table);
                    console.log('📊 Table rows:', table?.querySelectorAll('tbody tr')?.length);
                    
                    if (!table) {
                        throw new Error('Table element not found!');
                    }
                    
                    if (!simpleDatatables?.DataTable) {
                        throw new Error('simpleDatatables.DataTable not available!');
                    }
                    
                    console.log('⚡ Creating new DataTable...');
                    dataTable = new simpleDatatables.DataTable(table, {
                        searchable: true,
                        sortable: true,
                        perPage: 25,
                        perPageSelect: [10, 25, 50, 100],
                        fixedHeight: false,
                        labels: {
                            placeholder: "Search models...",
                            perPage: "Show {select} models per page",
                            noRows: "No models found",
                            info: "Showing {start} to {end} of {rows} models"
                        }
                    });
                    
                    console.log('✅ DataTable initialized successfully!', dataTable);
                    
                    // Add event listeners for debugging
                    dataTable.on('datatable.init', () => console.log('📊 DataTable init event fired'));
                    dataTable.on('datatable.refresh', () => console.log('🔄 DataTable refresh event fired'));
                    dataTable.on('datatable.sort', (column, direction) => console.log('🔀 DataTable sort:', column, direction));
                    
                } catch (error) {
                    console.error('❌ Error initializing DataTable:', error);
                    console.error('Stack trace:', error.stack);
                    
                    // Show error in UI
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4';
                    errorDiv.innerHTML = 'DataTable Error: ' + error.message;
                    tableContainer.insertBefore(errorDiv, table);
                }
            }
            
            if (btn) {
                btn.addEventListener('click', () => {
                    console.log('🔘 Toggle button clicked');
                    const isCurrentlyGrid = !grid.classList.contains('hidden');
                    console.log('Currently showing grid:', isCurrentlyGrid);
                    
                    if (isCurrentlyGrid) {
                        // Switching FROM grid TO table
                        console.log('🔄 Switching to table view, initializing DataTable...');
                        grid.classList.add('hidden');
                        tableContainer.classList.remove('hidden');
                        btn.textContent = 'View as Grid';
                        
                        setTimeout(() => {
                            console.log('⏰ Timeout fired, calling initDataTable');
                            initDataTable();
                        }, 100);
                    } else {
                        // Switching FROM table TO grid
                        console.log('🔄 Switching to grid view');
                        tableContainer.classList.add('hidden');
                        grid.classList.remove('hidden');
                        btn.textContent = 'View as Table';
                        
                        if (dataTable) {
                            console.log('🗑️ Destroying DataTable for grid view');
                            dataTable.destroy();
                            dataTable = null;
                        }
                    }
                });
            } else {
                console.error('❌ Toggle button not found!');
            }
            
            console.log('🎉 Script setup complete');
        });
        
        // Also try to initialize on window load as backup
        window.addEventListener('load', function() {
            console.log('🌐 Window load event fired');
        });
    </script>
</body>
</html>`;
}

/**
 * Main execution function.
 */
async function main() {
    try {
        // --- Argument Parsing ---
        const args = process.argv.slice(2);
        const inputArg = args.includes('--input') ? args[args.indexOf('--input') + 1] : './race.json';
        const outdirArg = args.includes('--outdir') ? args[args.indexOf('--outdir') + 1] : '.';
        const outputDir = path.resolve(outdirArg);
        
        console.log(`Input source: ${inputArg}`);
        console.log(`Output directory: ${outputDir}`);

        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        // --- Data Fetching and Processing ---
        const raceDataContainer = await getRaceData(inputArg);
        const raceData = raceDataContainer.interactions || [];
        console.log(`Found ${raceData.length} interactions.`);

        const modelRaceInfo = new Map();
        const generatedFiles = [];

        // Generate model-specific HTML files
        for (const item of raceData) {
            const fullResponse = item.response || '';
            const runjsCode = extractLastRunJsCode(fullResponse);

            // The primary condition for creating a file is the presence of a runjs block.
            if (!runjsCode) {
                continue;
            }

            // Now, we must be able to identify the model to create a filename.
            const modelId = item.metadata?.modelId || item.prompt?.metadata?.modelId;
            if (!modelId) {
                console.warn(`⚠️ Skipping interaction ${item.id}: Found a 'runjs' block but could not determine modelId.`);
                continue;
            }
            
            const modelName = extractModelName(modelId);
            if (!modelName) {
                console.warn(`⚠️ Skipping interaction ${item.id}: Could not extract model name from modelId "${modelId}".`);
                continue;
            }

            // --- Build the stats object for this model ---
            const metadata = item.metadata || item.prompt?.metadata || {};
            modelRaceInfo.set(modelName, {
                responseBytes: getByteLength(fullResponse),
                runjsBytes: getByteLength(runjsCode),
                completionTokens: metadata.completionTokens,
                promptTokens: metadata.promptTokens,
                timeToFirstToken: metadata.timeToFirstToken,
                generationTime: metadata.generationTime,
            });

            console.log(`+ Generating page for ${modelName}...`);
            const modelHtml = generateModelHtmlPage(modelName, runjsCode, fullResponse);
            const fileName = `${modelName}.html`;
            const absolutePath = path.join(outputDir, fileName);
            fs.writeFileSync(absolutePath, modelHtml, 'utf8');
            generatedFiles.push(fileName);
        }
        
        // --- Generate Main Index Page ---
        console.log("Generating main index.html...");
        generatedFiles.sort();
        const resultsListHtml = generateResultsList(modelRaceInfo, generatedFiles);
        const resultsTableHtml = generateResultsTable(modelRaceInfo, generatedFiles);
        const finalHtml = generateIndexHtml(resultsListHtml, resultsTableHtml);
        fs.writeFileSync(path.join(outputDir, 'index.html'), finalHtml, 'utf8');
        
        console.log("\n✅ Successfully generated all files!");
        console.log(`  - Main page: ${path.join(outputDir, 'index.html')}`);
        console.log(`  - ${generatedFiles.length} model pages generated in: ${outputDir}\n`);

    } catch (error) {
        console.error("❌ An error occurred during HTML generation:", error);
        process.exit(1);
    }
}

main(); 