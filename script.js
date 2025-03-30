import JSZip from 'jszip';
import { saveAs } from 'file-saver'; 
import { projectName } from './config.js'; 

const downloadBtn = document.getElementById('download-btn');
const statusEl = document.getElementById('status');
const titleEl = document.querySelector('title'); 
const headingEl = document.querySelector('h1'); 

const pageTitle = `${projectName} Setup`;
if (titleEl) titleEl.textContent = pageTitle;
if (headingEl) headingEl.textContent = pageTitle;


const projectFiles = {
    "Cargo.toml": `
[package]
name = "rust_wasm_3d" 
version = "0.1.0"
edition = "2021"
description = "A Rust + Wasm project for 3D rendering"
license = "MIT OR Apache-2.0" 
repository = "" 

[lib]
crate-type = ["cdylib", "rlib"] 

[profile.release]
opt-level = "s"
lto = true

[features]
default = ["console_error_panic_hook"] 

[dependencies]
wasm-bindgen = "0.2.92" 
web-sys = { version = "0.3.69", features = [
    'Window',
    'Document',
    'Element',
    'HtmlCanvasElement',
    'HtmlElement', 
    'Node', 
    'console', 

    'WebGlRenderingContext',
    'WebGlBuffer',
    'WebGlProgram',
    'WebGlShader',
    'WebGlUniformLocation',
    'WebGlActiveInfo', 
    'WebGlVertexArrayObject', 

    'MouseEvent',
    'KeyboardEvent',
    'WheelEvent',

    'Performance',

    'RequestAnimationFrameHandle', 
]}
console_error_panic_hook = { version = "0.1.7", optional = true }
wee_alloc = { version = "0.4.5", optional = true }

[dev-dependencies]
wasm-bindgen-test = "0.3.42"

[package.metadata.wasm-pack.profile.release]
wasm-opt = ['-Os', '--enable-mutable-globals'] 

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false 

`,

    "src/lib.rs": `
use wasm_bindgen::prelude::*;
use web_sys::{console, window, Document, HtmlCanvasElement, WebGlRenderingContext as GL};
use std::cell::RefCell;
use std::rc::Rc;

#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

macro_rules! log {
    ( $( $t:tt 
)* ) => {
        web_sys::console::log_1(&format!( $( $t )* ).into());
    }
}

// Structure to hold application state
struct AppState {
    gl: GL,
    // Add other state here, e.g., shader programs, buffers, camera, terrain data
}

thread_local! {
    static APP_STATE: Rc<RefCell<Option<AppState>>> = Rc::new(RefCell::new(None));
    static RENDER_LOOP_CLOSURE: RefCell<Option<Closure<dyn FnMut(f64)>>> = RefCell::new(None());
}

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    log!("Rust Wasm module initialized!");

    let window = window().expect("no global `window` exists");
    let document = window.document().expect("should have a on window");
    let canvas = document
        .get_element_by_id("rust-canvas")
        .ok_or_else(|| JsValue::from_str("Cannot find canvas element with id 'rust-canvas'"))?
        .dyn_into::<HtmlCanvasElement>()?;

    let gl_context = canvas
        .get_context("webgl") 
        .ok_or_else(|| JsValue::from_str("Failed to get WebGL context (JS Error)"))?
        .ok_or_else(|| JsValue::from_str("Failed to get WebGL context (Result is None)"))?;

    let gl = gl_context
        .dyn_into::<GL>()
        .map_err(|_| JsValue::from_str("Failed to cast context to WebGlRenderingContext"))?;


    log!("WebGL context obtained.");

    let initial_state = AppState {
        gl,
        // Initialize other fields...
    };

    APP_STATE.with(|state_ref| {
         *state_ref.borrow_mut() = Some(initial_state);
    });

    setup_render_loop()?;

    Ok(())
}

// Function to request the next frame, storing the closure
fn request_animation_frame(f: &Closure<dyn FnMut(f64)>) -> Result<i32, JsValue> {
    window()
        .expect("no global window exists")
        .request_animation_frame(f.as_ref().unchecked_ref())
}

// Sets up the main render loop using requestAnimationFrame
fn setup_render_loop() -> Result<(), JsValue> {
    let state_rc = APP_STATE.with(|state_ref| state_ref.clone());

    let closure = Closure::wrap(Box::new(move |timestamp: f64| { 
        if let Some(app_state) = state_rc.borrow_mut().as_mut() {
            render_frame(app_state, timestamp); 
        RENDER_LOOP_CLOSURE.with(|cell| {
             if let Some(closure_ref) = cell.borrow().as_ref() {
                request_animation_frame(closure_ref).expect("should register `requestAnimationFrame` OK");
             }
        });
    }) as Box<dyn FnMut(f64)>); 

    RENDER_LOOP_CLOSURE.with(|cell| *cell.borrow_mut() = Some(closure));

    RENDER_LOOP_CLOSURE.with(|cell| {
         if let Some(closure_ref) = cell.borrow().as_ref() {
             request_animation_frame(closure_ref)?;
         } else {
              return Err(JsValue::from_str("Failed to store render loop closure"));
         }
         Ok(())
    })
}


// --- Render Frame Logic ---
// timestamp: DOMHighResTimeStamp passed from requestAnimationFrame
fn render_frame(state: &mut AppState, timestamp: f64) {
    let canvas_option = state.gl.canvas();
    if canvas_option.is_none() {
        log!("Error: Could not get canvas from WebGL context.");
        return;
    }
    let canvas_element = canvas_option.unwrap(); 
    let canvas = match canvas_element.dyn_into::<HtmlCanvasElement>() {
         Ok(canvas) => canvas,
         Err(_) => {
             log!("Error: Failed to cast GL canvas back to HtmlCanvasElement.");
             return;
         }
    };


    let display_width = canvas.client_width() as u32;
    let display_height = canvas.client_height() as u32;

    let need_resize = canvas.width() != display_width || canvas.height() != display_height;
    if need_resize {
         canvas.set_width(display_width);
         canvas.set_height(display_height);
         state.gl.viewport(0, 0, display_width as i32, display_height as i32);
         log!("Resized canvas to {}x{} at time {:.2}", display_width, display_height, timestamp);
    }


    state.gl.clear_color(0.1, 0.1, 0.15, 1.0); 
    state.gl.clear_depth(1.0); 
    state.gl.enable(GL::DEPTH_TEST); 
    state.gl.depth_func(GL::LEQUAL); 
    state.gl.clear(GL::COLOR_BUFFER_BIT | GL::DEPTH_BUFFER_BIT);

    log!("Rendering frame at time: {:.2}", timestamp);

    state.gl.flush();
}


#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    log!("greet function called with: {}", name); 
    format!("Hello from Rust, {}!", name)
}

// TODO:
// - Implement shader loading and compilation.
// - Implement buffer creation (VBOs, IBOs).
// - Implement mesh/model loading or generation (e.g., a simple cube or plane).
// - Implement camera controls (using JS event listeners calling Wasm functions).
// - Implement terrain generation algorithm.
// - Implement lighting calculations in shaders.
// - Handle browser window resizing gracefully.
`,


    "www/index.html": `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rust Wasm 3D Demo</title> 
    <style>
        html, body {
            margin: 0;
            padding: 0;
            overflow: hidden; 
            height: 100%; 
            background-color: #111; 
            color: #eee; 
            font-family: sans-serif;
            font-size: 1.2em;
        }
        canvas#rust-canvas {
            display: block;  
            width: 100vw;    
            height: 100vh;   
            outline: none;   
            cursor: grab; 
        }
        canvas#rust-canvas:active {
            cursor: grabbing;
        }
        #status-overlay {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: rgba(0, 0, 0, 0.7);
            color: #eee;
            padding: 15px 25px;
            border-radius: 8px;
            font-size: 1.2em;
            z-index: 10;
            text-align: center;
        }
         #status-overlay.error {
             color: #ffdddd;
             background-color: rgba(100, 0, 0, 0.8);
         }
         #status-overlay.hidden {
             display: none;
         }
    </style>
</head>
<body>
    <canvas id="rust-canvas" tabindex="0"></canvas>
    <div id="status-overlay">Loading Wasm...</div>

    <script type="module">
        import init, { greet } from './pkg/rust_wasm_3d.js'; 

        const statusOverlay = document.getElementById('status-overlay');

        function showStatus(message, isError = false) {
            if (statusOverlay) {
                statusOverlay.textContent = message;
                statusOverlay.classList.toggle('error', isError);
                statusOverlay.classList.remove('hidden');
            }
            if (isError) {
                console.error(message);
            } else {
                console.log(message);
            }
        }

         function hideStatus() {
            if (statusOverlay) {
                 statusOverlay.classList.add('hidden');
             }
         }


        async function run() {
            try {
                showStatus("Initializing Wasm module...");
                await init(); 
                showStatus("Wasm module initialized. Rust main_js() executed.");

                const greeting = greet("Web User"); // Call the imported 'greet'
                console.log("From Rust:", greeting);


                const canvas = document.getElementById('rust-canvas');
                if (canvas) {
                     canvas.focus();

                    canvas.addEventListener('click', (event) => {
                        const rect = canvas.getBoundingClientRect();
                        const x = event.clientX - rect.left;
                        const y = event.clientY - rect.top;
                        console.log(`Canvas clicked at: x=${x.toFixed(2)}, y=${y.toFixed(2)}`);
                        // TODO: Call a Wasm function to handle the click, e.g.,
                        // wasm_exports.handle_canvas_click(x, y);
                    });

                 canvas.addEventListener('contextmenu', (event) => {
                    event.preventDefault();
                    console.log("Context menu prevented.");
                    // TODO: Call Wasm function
                });

                canvas.addEventListener('keydown', (event) => {
                    console.log(`Key down: key=${event.key}, code=${event.code}`);
                    // Prevent default browser actions for certain keys if needed (e.g., arrow keys scrolling)
                    // TODO: Call Wasm function
                });

                const setTimeout(hideStatus, 1500);

            } catch (error) {
                console.error("Error initializing or running Wasm module:", error);
                let errorMessage = 'Error loading Wasm. Check console.';
                if (error instanceof Error) {
                    errorMessage = `Error: ${error.message}`;
                }
                showStatus(errorMessage, true);
            }
        }

        run();
    </script>
</body>
</html>
`,


    "www/package.json": `
{
  "name": "rust-wasm-3d-frontend",
  "version": "0.1.0",
  "description": "Frontend for the Rust Wasm 3D project",
  "main": "index.html",
  "scripts": {
    "start": "http-server . -p 8080 -c-1 --cors",
    "build": "echo \"No frontend build step required. Run 'wasm-pack build --target web' in project root.\"",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "devDependencies": {
    "http-server": "^14.1.1"
  },
  "keywords": [
    "rust",
    "wasm",
    "webgl",
    "3d"
  ],
  "author": "",
  "license": "ISC"
}
`,


    ".gitignore": "...existing content...",
    "README.md": `# Rust Wasm 3D Project

This project provides a starting point for creating a 3D application using Rust compiled to WebAssembly (Wasm), intended to run entirely in a web browser. It includes basic setup for WebGL initialization and a render loop.

## Prerequisites

1.  **Rust Toolchain:** Install Rust (including `cargo`) from [https://rustup.rs/](https://rustup.rs/). The latest stable version is recommended.
2.  **wasm-pack:** Install the essential tool for building Rust-generated WebAssembly:
    ```bash
    cargo install wasm-pack
    ```
3.  **(Optional but Recommended) Node.js and npm:** Needed for the simple HTTP server used by the run scripts. Install the LTS version from [https://nodejs.org/](https://nodejs.org/).

## Setup and Running (using scripts)

These scripts automate the build process and start a local web server.

### Linux/macOS

1.  Make the script executable: `chmod +x setup_and_run.sh`
2.  Run the script: `./setup_and_run.sh`

### Windows

1.  Open Command Prompt or PowerShell.
2.  Navigate to the project directory.
3.  Run the script: `.\setup_and_run.bat`

**What the scripts do:**
*   Check for `cargo` and `wasm-pack`. Installs `wasm-pack` via `cargo` if missing.
*   Build the Rust code into Wasm using `wasm-pack build --target web`. This command compiles your Rust code (`src/lib.rs`) and generates JavaScript bindings, placing the output into the `./pkg/` directory. **It automatically copies the output to `./www/pkg/` when using `--target web`.**
*   If Node.js/npm is detected:
    *   Navigates into the `www` directory.
    *   Runs `npm install` to download the `http-server` dependency (if not already present).
    *   Starts the local web server using `npm start` (which runs `http-server`). The `--cors` flag is added to help if fetching external resources later.
*   If Node.js/npm is not detected, it will instruct you to serve the `www` directory manually.

Open your web browser and navigate to the address provided (usually `http://localhost:8080` or `http://127.0.0.1:8080`). You should see a dark grey canvas. Check the browser's developer console for logs from Rust.

## Manual Build and Run Steps

If you prefer not to use the scripts or encounter issues:

1.  **Build Wasm:** Navigate to the project root directory (where `Cargo.toml` is) and run:
    ```bash
    wasm-pack build --target web
    ```
    This creates/updates the `./pkg/` directory in the root and automatically copies its contents to `./www/pkg/`.

2.  **Serve the Web Page:** You need a local HTTP server to serve the files due to browser security restrictions for Wasm/modules loading via `fetch`.
    *   **Using Node.js (Recommended):**
        ```bash
        cd www
        npm install # Only needs to be run once
        npm start   # Runs 'http-server . -p 8080 -c-1 --cors'
        ```
    *   **Using Python 3:**
        ```bash
        cd www
        python -m http.server 8080
        ```
    *   **Using other servers:** Ensure you serve the contents of the `www` directory. Make sure the server sends the correct MIME type for `.wasm` files (`application/wasm`).

3.  **View:** Open your browser to `http://localhost:8080` (or the port used by your server).

## Project Structure

*   `Cargo.toml`: Rust project manifest (dependencies, settings).
*   `src/lib.rs`: Main Rust library code. Contains the `#[wasm_bindgen(start)]` function, WebGL setup, and render loop logic.
*   `www/`: Contains the web frontend files.
    *   `index.html`: The main HTML page that loads the Wasm module and contains the canvas.
    *   `package.json`: Defines Node.js dev dependencies (e.g., `http-server`) for the frontend environment.
    *   `pkg/`: **(Created/Managed by `wasm-pack`)** Contains the compiled Wasm (`.wasm`) and the generated JavaScript bindings (`.js`, `.d.ts`). **Do not edit files in here directly.** This directory is automatically populated by the `wasm-pack build` command.
*   `pkg/`: **(Created/Managed by `wasm-pack`)** This directory at the root contains the primary build artifacts before they are copied to `www/pkg/`. Usually safe to ignore unless debugging `wasm-pack` itself.
*   `.gitignore`:` Specifies files/directories to be ignored by Git.
*   `setup_and_run.sh`: Setup/run script for Linux/macOS.
*   `setup_and_run.bat`: Setup/run script for Windows.
*   `README.md`: This file.
*   `config.js`: (In root) Simple JavaScript config for the download page (e.g., project name).
*   `index.html`: (In root) The download page HTML.
*   `script.js`: (In root) The JavaScript for the download page (zipping logic).
*   `style.css`: (In root) The CSS for the download page.


## Next Steps & Development

1.  **Explore `src/lib.rs`:** Understand the WebGL setup, the `AppState` struct, and the `render_frame` function.
2.  **Shaders:** Write simple GLSL vertex and fragment shaders (e.g., draw a colored triangle).
3.  **Load Shaders in Rust:** Use `gl.create_shader`, `gl.shader_source`, `gl.compile_shader`, `gl.create_program`, `gl.attach_shader`, `gl.link_program`. Check for compilation/linking errors using `gl.get_shader_parameter`/`gl.get_program_parameter` and `gl.get_shader_info_log`/`gl.get_program_info_log`.
4.  **Geometry & Buffers:** Define vertex data (positions, colors) in Rust. Create WebGL buffers (`gl.create_buffer`), bind them (`gl.bind_buffer`), and upload data (`gl.buffer_data_with_u8_array`).
5.  **Vertex Attributes:** Get attribute locations (`gl.get_attrib_location`). Enable vertex attributes (`gl.enable_vertex_attrib_array`) and specify their layout (`gl.vertex_attrib_pointer`). Consider using Vertex Array Objects (VAOs via `WebGlVertexArrayObject` feature in `web-sys`) to simplify state management.
6.  **Rendering:** In `render_frame`: Use the shader program (`gl.use_program`), bind necessary buffers/VAOs, set uniforms (`gl.uniformMatrix4fv`, `gl.uniform3f`, etc.), and make a draw call (`gl.drawArrays` or `gl.drawElements`).
7.  **Camera & Controls:** Implement camera matrices (view, projection). Add JavaScript event listeners in `www/index.html` for input (mouse/keyboard) and call exported Wasm functions (using `#[wasm_bindgen]`) to update camera state in `AppState`.
8.  **Infinite Terrain:** Research techniques like chunking, Level of Detail (LOD), noise functions (e.g., Perlin/Simplex), and procedural generation based on camera position.
9.  **Lighting:** Implement lighting models (e.g., directional, point, Phong, PBR) in shaders. Pass light data (position, color, intensity, direction) as uniforms.


Happy Coding!
`,


    "setup_and_run.sh": `
#!/bin/bash

# Ensure the script exits if any command fails
set -e

echo "--- Rust Wasm 3D Project Setup & Run (Linux/macOS) ---"
echo.
echo "Checking prerequisites..."

# ... (rest of the script remains the same) ...
`,


    "setup_and_run.bat": `
@echo off
setlocal enabledelayedexpansion

echo --- Rust Wasm 3D Project Setup ^& Run (Windows) ---
echo.
echo Checking prerequisites...

REM Check for Rust/Cargo
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [Error] Rust/Cargo are not installed or not in PATH.
    echo         Please install it from https://rustup.rs/
    goto :eof
)
for /f "delims=" %%i in ('cargo --version') do set CARGO_VERSION=%%i
echo [OK] Rust/Cargo found. (!CARGO_VERSION!)

REM Check for wasm-pack
where wasm-pack >nul 2>nul
if %errorlevel% neq 0 (
    echo [Info] wasm-pack not found. Attempting to install via cargo...
    cargo install wasm-pack
    where wasm-pack >nul 2>nul
    if %errorlevel% neq 0 (
        echo [Error] Failed to install wasm-pack.
        echo         Please install it manually ('cargo install wasm-pack') and ensure !CARGO_INSTALL_ROOT!\\bin is in your system PATH.
        goto :eof
    )
    echo [OK] wasm-pack installed successfully.
) else (
    echo [OK] wasm-pack found.
)
for /f "delims=" %%i in ('wasm-pack --version') do set WASMPACK_VERSION=%%i
echo      (!WASMPACK_VERSION!)
echo.

echo Building Rust code to WebAssembly...
REM Build for web target. This automatically populates ./www/pkg/
REM Use --release for optimized builds, e.g., wasm-pack build --target web --release
wasm-pack build --target web
if %errorlevel% neq 0 (
    echo [Error] wasm-pack build failed. Check the errors above.
    goto :eof
)
echo [OK] Wasm build successful. Output in .\pkg\ and copied to .\www\pkg\
echo.


REM Check for Node.js and npm for the web server
echo Checking for Node.js and npm (optional, for local server)...
where node >nul 2>nul
if %errorlevel% equ 0 (
    where npm >nul 2>nul
    if %errorlevel% equ 0 (
        for /f "delims=" %%i in ('node --version') do set NODE_VERSION=%%i
        for /f "delims=" %%i in ('npm --version') do set NPM_VERSION=%%i
        echo [OK] Node.js found (!NODE_VERSION!)
        echo [OK] npm found (!NPM_VERSION!)
        echo.
        echo Setting up and starting the development server...

        pushd www
        REM Install http-server if node_modules doesn't exist or http-server is missing
        if not exist "node_modules\http-server" (
            echo [Info] node_modules directory or http-server not found.
            if exist "package.json" (
                echo [Info] Running 'npm install' in %CD%...
                call npm install
                 if !errorlevel! neq 0 (
                    echo [Warning] 'npm install' failed. The server might not start correctly.
                    echo           Try running 'npm install' manually in the 'www' directory.
                ) else (
                    echo [OK] npm install completed.
                )
            ) else (
                echo [Warning] No package.json found. Cannot run 'npm install'. Needed for http-server.
            )
        ) else (
            echo [Info] node_modules/http-server exists, assuming dependencies are installed.
        )

        echo [Info] Starting web server using 'npm start' (http-server)...
        echo        Serving content from %CD%
        echo        Open your browser to http://localhost:8080 (or the address shown)
        echo        Press Ctrl+C in the server window to stop it.
        echo.
        REM Start http-server via npm start in a new window so this script can finish
        start "RustWasmDevServer" npm start
        popd
        goto :server_started

    ) else (
        echo [Info] not found, but node was found. Cannot run server automatically via npm.
        goto :no_server
    )
) else (
        echo [Info] Node.js not found. Cannot run server automatically.
        goto :no_server
    )


:no_server
echo [OK] Wasm build is complete.
echo.
echo To run the project, serve the 'www' directory using a local HTTP server.
echo Make sure the server provides the correct MIME type for .wasm' files (application/wasm).
echo Examples:
echo   If you have Python 3: cd www & python -m http.server 8080
echo   If you have Python 2: cd www & python -m SimpleHTTPServer 8080
echo Then open your browser to http://localhost:8080
goto :end

:server_started
echo [Info] Server started in a separate window via 'npm start'. This script can now exit.
goto :end


:end
echo.
echo --- Setup script finished ---
endlocal
`,


    "src/": "",
    "www/": "",
};

downloadBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Generating zip file, please wait...';
    statusEl.style.color = '#007bff'; 
    downloadBtn.disabled = true;

    try {
        const zip = new JSZip();

        for (const [path, content] of Object.entries(projectFiles)) {
             if (path.endsWith('/') && content === "") {
                 zip.folder(path.slice(0, -1)); 
             } else if (content !== "__DELETE_ME__") {
                 zip.file(path, content);
            }
        }

        const zipBlob = await zip.generateAsync(
            {
                type: "blob",
                platform: navigator.platform.toUpperCase().includes('WIN') ? 'DOS' : 'UNIX',
                compression: "DEFLATE",
                compressionOptions: {
                    level: 6 
                },
                unixPermissions: (path) => {
                    if (path.endsWith('.sh')) {
                        return 0o755; 
                    }
                    return null; 
                },
            },
            (metadata) => {
                 statusEl.textContent = `Zipping: ${metadata.percent.toFixed(0)}%`;
             }
        );

        const filename = `${projectName.toLowerCase().replace(/\s+/g, '_')}_project.zip`;
        saveAs(zipBlob, filename);

        statusEl.textContent = 'Download started successfully!';
        statusEl.style.color = 'green'; 
    } catch (error) {
        console.error("Error generating zip file:", error);
        statusEl.textContent = 'Error generating zip file. See console for details.';
        statusEl.style.color = 'red'; 
    } finally {
        downloadBtn.disabled = false;
        setTimeout(() => {
            if (statusEl.textContent.includes('successfully') || statusEl.textContent.includes('started')) {
                 statusEl.textContent = '';
            }
         }, 5000);