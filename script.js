import JSZip from 'jszip';
import { saveAs } from 'file-saver'; // Using import map
import { projectName } from './config.js'; // Import from config

const downloadBtn = document.getElementById('download-btn');
const statusEl = document.getElementById('status');
const titleEl = document.querySelector('h1');

// Update title from config
if (titleEl) titleEl.textContent = `${projectName} Setup`;

const projectFiles = {
    // Cargo.toml: Defines project dependencies and metadata
    "Cargo.toml": `
[package]
name = "rust_wasm_3d" # You can change this project name
version = "0.1.0"
edition = "2021"
description = "A Rust + Wasm project for 3D rendering"
license = "MIT OR Apache-2.0" # Choose appropriate license(s)
repository = "" # Optional: Add your repository URL

[lib]
crate-type = ["cdylib", "rlib"] # Compile for Wasm and as a Rust library

[profile.release]
# Tell \`rustc\` to optimize for small code size.
opt-level = "s"
lto = true

[features]
default = ["console_error_panic_hook"] # Enable panic hook by default

[dependencies]
wasm-bindgen = "0.2.92" # Use a recent version
web-sys = { version = "0.3.69", features = [
    # Essential Web APIs
    'Window',
    'Document',
    'Element',
    'HtmlCanvasElement',
    'HtmlElement', # Base for DOM elements
    'Node', # Base for DOM nodes
    'console', # For logging

    # WebGL APIs (add more specific ones as needed, e.g., WebGl2RenderingContext)
    'WebGlRenderingContext',
    # 'WebGl2RenderingContext', # Uncomment if using WebGL2
    'WebGlBuffer',
    'WebGlProgram',
    'WebGlShader',
    'WebGlUniformLocation',

    # Input events
    'MouseEvent',
    'KeyboardEvent',
    'WheelEvent',

    # Performance measurement
    'Performance',

    # Animation Frame
    'RequestAnimationFrameHandle', # Needed for request_animation_frame
]}
console_error_panic_hook = { version = "0.1.7", optional = true }
# wee_alloc is useful for reducing Wasm size, especially for smaller projects.
# Consider removing it if you encounter memory issues or need the default allocator's features.
wee_alloc = { version = "0.4.5", optional = true }

# === Potential 3D Graphics Libraries (Choose ONE or build your own) ===
# Option 1: Bevy (Powerful, Entity Component System based, good Wasm support)
# bevy = { version = "0.13", default-features = false, features = ["bevy_render", "bevy_core_pipeline", "bevy_pbr", "bevy_asset", "bevy_winit", "bevy_gltf", "bevy_wgpu", "wasm-bindgen"] }

# Option 2: Kiss3D (Simpler, good for quick prototypes, might need more WebGL plumbing via web-sys for Wasm)
# kiss3d = "0.34" # Check Wasm compatibility status

# Option 3: three-d (Focuses on easy-to-use graphics abstractions for web)
# three-d = "0.16"

# Option 4: Raw WebGL/WebGPU via web-sys (Most control, most boilerplate)
# No extra dependency needed beyond web-sys

[dev-dependencies]
wasm-bindgen-test = "0.3.42"

[package.metadata.wasm-pack.profile.release]
wasm-opt = ['-Os', '--enable-mutable-globals'] # Optimize for size in release

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false # Faster builds for development

`,

    // src/lib.rs: Main Rust code entry point
    "src/lib.rs": `
use wasm_bindgen::prelude::*;
use web_sys::{console, window, Document, HtmlCanvasElement, WebGlRenderingContext as GL};
use std::cell::RefCell;
use std::rc::Rc;

// When the \`wee_alloc\` feature is enabled, use \`wee_alloc\` as the global
// allocator. This reduces Wasm binary size. Consider removing if you need the
// default allocator features or encounter issues.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

// A macro to provide \`println!(..)\`-style syntax for \`console.log\` logging.
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

// Use Rc<RefCell<T>> for shared mutable state needed for callbacks like requestAnimationFrame
thread_local! {
    static APP_STATE: Rc<RefCell<Option<AppState>>> = Rc::new(RefCell::new(None));
    static RENDER_LOOP_CLOSURE: RefCell<Option<Closure<dyn FnMut()>>> = RefCell::new(None());
}

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    // Enables better error messages stack traces in the browser console
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    log!("Rust Wasm module initialized!");

    // --- Get Canvas and WebGL Context ---
    let window = window().expect("no global \`window\` exists");
    let document = window.document().expect("should have a document on window");
    let canvas = document
        .get_element_by_id("rust-canvas")
        .ok_or_else(|| JsValue::from_str("Cannot find canvas element with id 'rust-canvas'"))?
        .dyn_into::<HtmlCanvasElement>()?;

    // Try getting WebGL context
    let gl = canvas
        .get_context("webgl")? // Or "webgl2"
        .ok_or_else(|| JsValue::from_str("Failed to get WebGL context"))?
        .dyn_into::<GL>()?;

    log!("WebGL context obtained.");

    // --- Initialize App State ---
    let initial_state = AppState {
        gl,
        // Initialize other fields...
    };

    // Store initial state in the thread_local static
    APP_STATE.with(|state_ref| {
        *state_ref.borrow_mut() = Some(initial_state);
    });

    // --- Setup Render Loop ---
    setup_render_loop()?;

    Ok(())
}

fn setup_render_loop() -> Result<(), JsValue> {
    let window = window().expect("no global \`window\` exists");

    // Define the closure that will be called each frame
    let closure = Closure::wrap(Box::new(move || {
        APP_STATE.with(|state_ref| {
            if let Some(app_state) = state_ref.borrow_mut().as_mut() {
                render_frame(app_state);
            }
        });

        // Schedule the next frame
        request_animation_frame();
    }) as Box<dyn FnMut()>);

    // Store the closure so it's not dropped
    RENDER_LOOP_CLOSURE.with(|cell| *cell.borrow_mut() = Some(closure));

    // Start the first frame request
    request_animation_frame();

    Ok(())
}

// Requests the next animation frame
fn request_animation_frame() {
    RENDER_LOOP_CLOSURE.with(|cell| {
        if let Some(closure) = cell.borrow().as_ref() {
            window()
                .expect("no global window exists")
                .request_animation_frame(closure.as_ref().unchecked_ref())
                .expect("should register \`requestAnimationFrame\` OK");
        }
    });
}

// --- Render Frame Logic ---
fn render_frame(state: &mut AppState) {
    // Get current canvas dimensions (handle resizing if necessary)
    let canvas = state.gl.canvas().unwrap().dyn_into::<HtmlCanvasElement>().unwrap();
    let width = canvas.client_width() as u32;
    let height = canvas.client_height() as u32;

    // Ensure canvas drawing buffer size matches display size
    if canvas.width() != width || canvas.height() != height {
         canvas.set_width(width);
         canvas.set_height(height);
         state.gl.viewport(0, 0, width as i32, height as i32);
         log!("Resized canvas to {}x{}", width, height);
    }


    // --- Clear the canvas ---
    state.gl.clear_color(0.1, 0.1, 0.15, 1.0); // Dark grey background
    state.gl.clear_depth(1.0); // Clear everything
    state.gl.enable(GL::DEPTH_TEST); // Enable depth testing
    state.gl.depth_func(GL::LEQUAL); // Near things obscure far things
    state.gl.clear(GL::COLOR_BUFFER_BIT | GL::DEPTH_BUFFER_BIT);

    // --- TODO: Add Drawing Logic Here ---
    // - Update scene state (e.g., animations, physics)
    // - Setup camera matrices (view, projection)
    // - Bind shader programs
    // - Bind buffers (vertex, index)
    // - Set uniforms (transformations, lighting, textures)
    // - Draw calls (e.g., gl.drawArrays, gl.drawElements)

    // Example: Placeholder log
    log!("Rendering frame...");

    // Ensure all commands are executed
    state.gl.flush();
}


#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    // Example function callable from JS after init
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
// www/index.html: The HTML file that loads the Wasm module
"www/index.html": `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rust Wasm 3D  Demo</title>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            overflow: hidden; /* Prevent scrollbars */
            height: 100%;      /* Ensure body takes full height */
            background-color: #111; /* Fallback background */
        }
        canvas#rust-canvas {
            display: block;  /* Remove extra space below canvas */
            width: 100vw;    /* Full viewport width */
            height: 100vh;   /* Full viewport height */
            outline: none;   /* Remove potential focus outline */
        }
        /* Optional: Loading indicator */
        #loading {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #eee;
            font-family: sans-serif;
            font-size: 1.2em;
        }
    </style>
</head>
<body>
    <canvas id="rust-canvas" tabindex="0"></canvas> <!-- tabindex allows canvas to receive keyboard events -->
     <div id="loading">Loading Wasm...</div>

    <!-- Import the generated JS file -->
    <!-- The 'init' function is exported by the wasm-bindgen generated JS -->
    <script type="module">
        // Import the default export from the generated JS file
        import init from './pkg/rust_wasm_3d.js'; // Adjust path if needed

        async function run() {
            const loadingIndicator = document.getElementById('loading');
            try {
                // Initialize the Wasm module. This also calls the #[wasm_bindgen(start)] function.
                await init(); // Assuming default export is the init function
                console.log("Wasm module initialized and Rust main_js() executed.");

                // You could potentially call other exported Rust functions here if needed
                // e.g., import { greet } from './pkg/rust_wasm_3d.js';
                // const greeting = greet("Web User");
                // console.log(greeting);

                // Hide loading indicator once Wasm is ready
                 if (loadingIndicator) loadingIndicator.style.display = 'none';


                // --- Add JS-side event listeners ---
                const canvas = document.getElementById('rust-canvas');
                if (canvas) {
                    // Example: Log mouse clicks (coordinates relative to canvas)
                    canvas.addEventListener('click', (event) => {
                        const rect = canvas.getBoundingClientRect();
                        const x = event.clientX - rect.left;
                        const y = event.clientY - rect.top;
                        console.log(\`Canvas clicked at: x=\${x}, y=\${y}\`);
                        // TODO: Call a Wasm function to handle the click, e.g.,
                        // wasm_exports.handle_canvas_click(x, y);
                    });

                     // Example: Prevent context menu on right-click
                    canvas.addEventListener('contextmenu', (event) => {
                        event.preventDefault();
                    });

                    // TODO: Add listeners for mousemove, mousedown, mouseup, wheel, keydown, keyup
                    // and potentially forward relevant event data to Wasm functions.
                }

            } catch (error) {
                console.error("Error initializing Wasm module:", error);
                if (loadingIndicator) {
                    loadingIndicator.textContent = 'Error loading Wasm. Check console.';
                    loadingIndicator.style.color = 'red';
                }
            }
        }

        run();
    </script>
</body>
</html>
`,

    // www/package.json: Defines JS dependencies for the web part
    "www/package.json": `
{
  "name": "rust-wasm-3d-frontend",
  "version": "0.1.0",
  "description": "Frontend for the Rust Wasm 3D project",
  "scripts": {
    "start": "http-server . -p 8080 -c-1",
    "build": "echo \"No build step required for frontend (Wasm build handled by wasm-pack)",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "devDependencies": {
    "http-server": "^14.1.1"
  },
  "author": "",
  "ISC"
}
`,
    // .gitignore: Standard Rust and Wasm ignore patterns
    ".gitignore": `
# Rust build artifacts
/target/
Cargo.lock

# Wasm build artifacts (generated by wasm-pack)
/pkg/
/www/pkg/

# IDE configuration files
.vscode/
.idea/
*.iml
*~
*.swp
*.swo

# Node modules
/node_modules/
/www/node_modules/

# Log files
*.log

# OS-specific files
.DS_Store
Thumbs.db

# Build outputs (if any custom ones)
/dist/
/build/

# Secrets (if any added later)
*.env
`,

    // README.md: Project instructions (updated)
    "README.md": `
# Rust Wasm 3D Project

This project provides a starting point for creating a 3D application using Rust compiled to WebAssembly (Wasm), intended to run entirely in a web browser. It includes basic setup for WebGL initialization and a render loop.

## Prerequisites

1.  **Rust Toolchain:** Install Rust (including \`cargo\`) from [https://rustup.rs/](https://rustup.rs/). The latest stable version is recommended.
2.  **wasm-pack:** Install the essential tool for building Rust-generated WebAssembly:
    \`\`\`bash
    cargo install wasm-pack
    \`\`\`
3.  **(Optional but Recommended) Node.js and npm:** Needed for the simple HTTP server used by the run scripts. Install the LTS version from [https://nodejs.org/](https://nodejs.org/).

## Setup and Running (using scripts)

These scripts automate the build process and start a local web server.

### Linux/macOS

1.  Make the script executable: \`chmod +x setup_and_run.sh\`
2.  Run the script: \`./setup_and_run.sh\`

### Windows

1.  Open Command Prompt or PowerShell (Run as Administrator might be needed if installing global npm packages fails).
2.  Navigate to the project directory.
3.  Run the script: \`.\\setup_and_run.bat\`

**What the scripts do:**
*   Check for \`cargo\` and \`wasm-pack\`. Installs \`wasm-pack\` via \`cargo\` if missing.
*   Build the Rust code into Wasm using \`wasm-pack build --target web\`. This command compiles your Rust code (\`src/lib.rs\`) and generates JavaScript bindings, placing the output into the \`./pkg/\` directory and copying it to \`./www/pkg/\`.
*   If Node.js/npm is detected:
    *   Navigates into the \`www\` directory.
    *   Runs \`npm install\` to download the \`http-server\` dependency (if not already present).
    *   Starts the local web server using \`npm start\` (which runs \`http-server\`).
*   If Node.js/npm is not detected, it will instruct you to serve the \`www\` directory manually.

Open your web browser and navigate to the address provided (usually \`http://localhost:8080\` or \`http://127.0.0.1:8080\`). You should see a dark grey canvas. Check the browser's developer console for logs from Rust.

## Manual Build and Run Steps

If you prefer not to use the scripts or encounter issues:

1.  **Build Wasm:** Navigate to the project root directory (where \`Cargo.toml\` is) and run:
    \`\`\`bash
    wasm-pack build --target web
    \`\`\`
    *   For release builds (smaller, optimized): \`wasm-pack build --target web --release\`

2.  **Serve the Web Page:** You need a local HTTP server to serve the files due to browser security restrictions for Wasm/modules.
    *   **Using Node.js (Recommended):**
        \`\`\`bash
        cd www
        npm install # Only needs to be run once
        npm start
        \`\`\`
    *   **Using Python 3:**
        \`\`\`bash
        cd www
        python -m http.server 8080
        \`\`\`
    *   **Using Python 2:**
        \`\`\`bash
        cd www
        python -m SimpleHTTPServer 8080
        \`\`\`
    *   **Using other servers:** Ensure you serve the contents of the \`www\` directory.

3.  **View:** Open your browser to \`http://localhost:8080\` (or the port used by your server).

## Project Structure

*   \`Cargo.toml\`: Rust project manifest (dependencies, settings).
*   \`src/lib.rs\`: Main Rust library code. Contains the \`#[wasm_bindgen(start)]\` function, WebGL setup, and render loop logic.
*   \`www/\`: Contains the web frontend files.
    *   \`index.html\`: The main HTML page that loads the Wasm module.
    *   \`package.json\`: Defines Node.js dependencies for the server.
    *   \`pkg/\`: (Created by \`wasm-pack\`) Contains the compiled Wasm (\`.wasm\`) and the generated JavaScript bindings (\`.js\`, \`.d.ts\`). **Do not edit files in here directly.**
*   \`.gitignore\`: Specifies files/directories to be ignored by Git.
*   \`setup_and_run.sh\`: Setup/run script for Linux/macOS.
*   \`setup_and_run.bat\`: Setup/run script for Windows.
*   \`README.md\`: This file.

## Next Steps & Development

1.  **Choose Graphics Approach:** Decide if you want to use raw WebGL via \`web-sys\` (as started), or integrate a higher-level Rust graphics library like \`bevy\`, \`three-d\`, or potentially \`kiss3d\`. Uncomment/add the chosen dependency in \`Cargo.toml\`. You'll need to adapt \`src/lib.rs\` significantly based on the library's API.
2.  **Shaders:** Write GLSL shaders for rendering. Load, compile, and link them in \`src/lib.rs\`.
3.  **Geometry:** Create vertex and index buffers for your 3D models (e.g., a simple plane or cube to start). Generate terrain data procedurally or load it from a format.
4.  **Rendering:** the drawing logic within the \`render_frame\` function. Set up uniforms (MVP matrices, lighting info), bind buffers/textures, and make draw calls (\`gl.drawArrays\` or \`gl.drawElements\`).
5.  **Camera & Controls:** Implement camera logic (projection and view matrices). Add JavaScript event listeners in \`www/index.html\` for mouse/keyboard input and call exported Wasm functions to update the camera state in Rust.
6.  **Infinite Terrain:** Implement techniques like chunking, LOD (Level of Detail), and procedural generation based on camera position.
7.  **Lighting:** Implement lighting models (e.g., Phong, PBR) in your shaders and pass light information (position, color, intensity) as uniforms.

Happy Coding!
`,

    // setup_and_run.sh: Linux/macOS setup script (improved checks and messages)
    "setup_and_run.sh": `
#!/bin/bash

# Ensure the script exits if any command fails
set -e

echo "--- Rust Wasm 3D Project Setup & Run (Linux/macOS) ---"
echo ""
echo "Checking prerequisites..."

# Check for Rust/Cargo
if ! command -v cargo &> /dev/null; then
    echo "[Error] Rust/Cargo is not installed or not in PATH."
    echo "        Please install it from https://rustup.rs/
    exit 1
fi
echo "[OK] Rust/Cargo found: $(command -v cargo)"
cargo --version

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo "[Info] wasm-pack not found. Attempting to install via cargo..."
    cargo install wasm-pack
    # Verify installation
    if ! command -v wasm-pack &> /dev/null; then
        echo "[Error] Failed to install wasm-pack."
        echo "        Please install it manually ('cargo install wasm-pack') and ensure it's in your PATH."
        exit 1
    fi
    echo "[OK] wasm-pack installed successfully."
else
    echo "[OK] wasm-pack found: $(command -v wasm-pack)"
fi
wasm-pack --version
echo ""

echo "Building Rust code to WebAssembly..."
# Build for web target. Use --release for optimized builds.
# wasm-pack build --target web --release
wasm-pack build --target web
echo "[OK] Wasm build successful. Output in ./pkg/ and copied to ./www/pkg/"
echo ""

# Check for Node.js and npm for the web server
echo "Checking for Node.js and npm (optional, for local server)..."
if command -v node &> /dev/null && command - v npm &> /dev/null; then
    echo "[OK] Node.js found: $(command -v node) ($(node --version))"
    echo "[OK] npm found: $(command -v npm) ($(npm --version))"
    echo ""
    echo "Setting up and starting the development server..."
    # Navigate to the web directory
    cd www

    # Install http-server if node_modules doesn't exist or package.json is newer
    NEEDS_NPM_INSTALL=false
    if [ ! -d "node_modules" ]; then
        echo "[Info] node_modules directory not found."
        NEEDS_NPM_INSTALL=true
    elif [ "package.json" -nt "node_modules" ]; then
        # Optional: check if package.json is newer than node_modules
        # echo "[Info] package.json is newer than node_modules."
        # NEEDS_NPM_INSTALL=true # Uncomment to force install if package.json changes
        echo "[Info] node_modules exists, assuming dependencies are installed."
    else
         echo "[Info] node_modules exists, assuming dependencies are installed."
    fi


    if [ "$NEEDS_NPM_INSTALL" = true ] && [ -f "package.json" ]; then
        echo "[Info] Running 'npm install' in $(pwd)..."
        npm install
        if [ $? -ne 0 ]; then
            echo "[Warning] 'npm install' failed. The server might not start correctly."
            echo "          Try running 'npm install' manually in the 'www' directory."
            # Optionally exit here if npm install is critical
            # exit 1
        else
            echo "[OK] npm install completed."
        fi
    elif [ ! -f "package.json" ]; then
         echo "[Warning] No package.json found in $(pwd). Cannot run 'npm install'."
    fi

    echo "[Info] Starting web server using 'npm start'..."
    echo "       Serving content from $(pwd)"
    echo "       Open your browser to http://localhost:8080 (or the address shown)"
    echo "       Press Ctrl+C in this terminal to stop the server."
    echo ""
    npm start # This command will run until stopped (Ctrl+C)

    # Go back to the root directory (might not be reached if npm start runs in foreground)
    cd ..
    echo "Server stopped."

else
    echo "[Info] Node.js and/or npm not found."
    echo "[OK] Wasm build is complete."
    echo ""
    echo "To run the project, serve the 'www' directory using a local HTTP server."
    echo "Examples:"
    echo "  If you have Python 3: cd www && python -m http.server 8080"
    echo "  If you have Python 2: cd www && python -m SimpleHTTPServer 8080"
    echo "Then open your browser to http://localhost:8080"
fi

echo ""
echo "--- Setup script finished ---"
`,

    // setup_and_run.bat: Windows setup script (improved checks and messages)
    "setup_and_run.bat": `
@echo off
setlocal enabledelayedexpansion

echo --- Rust Wasm 3D Project Setup ^& Run (Windows) ---
echo.
echo Checking prerequisites...

REM Check for Rust/Cargo
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [Error] Rust/Cargo is not installed or not in PATH.
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
        echo         Please install it manually ('cargo install wasm-pack') and ensure it's in your PATH.
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
REM Build for web target. Use --release for optimized builds.
REM wasm-pack build --target web --release
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
        echo [OK] Node.js found (%%NODE_VERSION%%)
        echo [OK] npm found(%%NPM_VERSION%%)
        echo.
        echo Setting up and starting the development server...

        pushd www
        if not exist "node_modules" (
            echo [Info] node_modules directory not found.
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
            echo [Info] node_modules exists, assuming dependencies are installed.
        )

        echo [Info] Starting web server using 'npm start'...
        echo        Serving content from %CD%
        echo        Open your browser to http://localhost:8080 (or the address shown)
        echo        Press Ctrl+C in the server window to stop it.
        echo.
        REM Start http-server in a new window so this script can finish
        start "RustWasmDevServer" npm start
        popd
        goto :server_started

    ) else (
        echo [Info] npm not found, but node was found. Cannot run server automatically.
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
echo Examples:
echo   If you have Python 3: cd www ^& python -m http.server 8080
echo   If you have Python 2: cd www ^& python -m SimpleHTTPServer 8080
echo Then open your browser to http://localhost:8080
goto :end

:server_started
echo [Info] Server started in a separate window. This script can now exit.
goto :end


:end
echo.
echo --- Setup script finished ---
endlocal
`,
    // Add empty directories explicitly for JSZip if needed, although file paths usually imply them.
    "src/": "", // Ensures src directory exists in the zip
    "www/": "", // Ensures www directory exists in the zip
};

downloadBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Generating zip file, please wait...';
    statusEl.style.color = '#007bff'; // Blue for processing
    downloadBtn.disabled = true;

    try {
        const zip = new JSZip();

        // Add files and directories to zip
        for (const [path, content)] of Object.entries(projectFiles)) {
             // Check if it's meant to represent a directory
            if (path.endsWith('/') && content === "") {
                 // Add directory explicitly (optional, file paths often create them implicitly)
                 // zip.folder(path.slice(0, -1)); // Remove trailing slash for folder name
                 // We rely on file paths creating dirs, simpler. Skip adding empty entries.
            } else {
                 // Add file content
                zip.file(path, content);
            }
        }


        // Generate the zip file asynchronously
        console.log("Generating zip blob...");
        const zipBlob = await zip.generateAsync(
            {
                type: "blob",
                // Use platform-specific line endings for scripts/text files if needed
                // Note: Git often handles line endings, so this might not be critical
                platform: navigator.platform.toUpperCase().includes('WIN') ? 'DOS' : 'UNIX',
                compression: "DEFLATE",
                compressionOptions: {
                    level: 6 // Good balance between speed and compression
                }
            },
            (metadata) => { // Progress callback
                 // console.log("Zipping progress: " + metadata.percent.toFixed(2) + " %");
                 statusEl.textContent = `Zipping: ${metadata.percent.toFixed(0)}%`;
             }
        );
        console.log("Zip blob generated.");

        // Trigger download using FileSaver.js
        const filename = `${projectName.toLowerCase().replace(/\s+/g, '_')}_project.zip`;
        saveAs(zipBlob, filename);

        statusEl.textContent = 'Download started successfully!';
        statusEl.style.color = 'green'; // Green for success
    } catch (error) {
        console.error("Error generating zip file:", error);
        statusEl.textContent = 'Error generating zip file. See console for details.';
        statusEl.style.color = 'red'; // Red for error
    } finally {
        downloadBtn.disabled = false;
        // Optionally clear status message after a few seconds
        setTimeout(() => {
            if (statusEl.textContent.includes('successfully') || statusEl.textContent.includes('started')) {
                 statusEl.textContent = '';
            }
         }, 5000);
    }
});