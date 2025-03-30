// config.js (ESM)
// Currently no user-configurable values needed for this setup.
// This file is here for potential future use (e.g., default server port, project name).

export const projectName = "Rust Wasm 3D Project";

// Add other configuration values here as needed
`````` index.html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rust Wasm 3D Project Setup</title>
    <link rel="stylesheet" href="style.css">
    <script type="importmap">
        {
            "imports": {
                "jszip": "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
                "file-saver": "https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js"
            }
        }
    </script>
</head>
<body>
    <div class="container">
        <h1>Rust Wasm 3D Project Setup</h1>
        <p>This page provides the basic structure for a Rust project targeting WebAssembly (Wasm), designed for a 3D scene with potentially infinite terrain and lighting. The project includes setup scripts for both Linux/macOS and Windows.</p>
        <p>Click the button below to download a .zip file containing the complete project structure, including Rust source files, HTML/JS for the web frontend, and setup scripts.</p>
        <button id="download-btn">Download Project (.zip)</button>
        <p id="status"></p>
    </div>

    <script type="module" src="script.js"></script>
</body>
</html>

// config.js (ESM)
// User-configurable values for the project setup page.

export const projectName = "Rust Wasm 3D Starter"; // Used for page title and zip filename

// Add other configuration values here as needed, for example:
// export const defaultServerPort = 8080;
// export const defaultBackgroundColor = "#111111";

