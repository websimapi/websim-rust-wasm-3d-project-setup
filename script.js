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
# Tell \`rustc\` to optimize for small code size.
opt-level = "s"
lto = true

[features]
default = ["console_error_panic_hook"]

[dependencies]
wasm-bindgen = "0.2.92"
# The \`console_error_panic_hook\` crate provides better debugging of panics by
# logging them with \`console.error\`. This is great for development, but requires
# all the debugging symbols potentially increasing code size significantly.
console_error_panic_hook = { version = "0.1.7", optional = true }
# \`wee_alloc\` is a tiny allocator for wasm that is only ~1K in code size
# compared to the default allocator's ~10K. It is slower than the default
# allocator, however.
#
# Unfortunately, \`wee_alloc\` requires nightly Rust when targeting wasm for now.
# wee_alloc = { version = "0.4.5", optional = true }

# Add web-sys for WebGL, DOM, console access etc.
web-sys = { version = "0.3.69", features = [
    'Window',
    'Document',
    'Element',
    'HtmlCanvasElement',
    'HtmlElement',
    'Node',
    'console',

    # WebGL features
    'WebGlRenderingContext',
    'WebGlBuffer',
    'WebGlProgram',
    'WebGlShader',
    'WebGlUniformLocation',
    'WebGlActiveInfo',
    'WebGlVertexArrayObject', # For VAOs

    # Event handling
    'MouseEvent',
    'KeyboardEvent',
    'WheelEvent',

    # Performance timing
    'Performance',

    # Animation loop
    'RequestAnimationFrameHandle', # Type returned by request_animation_frame
]}

[dev-dependencies]
wasm-bindgen-test = "0.3.42"

# Optimize wasm output further using wasm-opt
# Requires installing binary: https://github.com/WebAssembly/binaryen#tools
# Enable the features you want here, e.g. -Os for size, -O4 for speed
[package.metadata.wasm-pack.profile.release]
wasm-opt = ['-Os', '--enable-mutable-globals'] # Optimize for size

[package.metadata.wasm-pack.profile.dev]
wasm-opt = false # Disable optimization for dev builds
`,

    "src/lib.rs": `
use wasm_bindgen::prelude::*;
use web_sys::{console, window, Document, HtmlCanvasElement, WebGlRenderingContext as GL};
use std::cell::RefCell;
use std::rc::Rc;

// Optional: Use wee_alloc for smaller wasm size
// #[cfg(feature = "wee_alloc")]
// #[global_allocator]
// static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

// Macro for logging to the browser console
macro_rules! log {
    ( $( $t:tt )* ) => {
        web_sys::console::log_1(&format!( $( $t )* ).into());
    }
}

// Structure to hold application state
struct AppState {
    gl: GL,
    // TODO: Add other state here, e.g., shader programs, buffers, camera, terrain data
}

// Use thread_local storage for state that needs to persist across calls
thread_local! {
    // The main application state wrapped in Rc<RefCell<Option<...>>>
    // - Rc: Allows multiple references to the state.
    // - RefCell: Allows mutable borrowing at runtime (needed for the render loop closure).
    // - Option: Allows the state to be initialized later (in main_js).
    static APP_STATE: Rc<RefCell<Option<AppState>>> = Rc::new(RefCell::new(None));

    // Store the render loop closure to keep it alive
    static RENDER_LOOP_CLOSURE: RefCell<Option<Closure<dyn FnMut(f64)>>> = RefCell::new(None());
}

// Entry point function called by JS after Wasm is loaded
#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    // Set the panic hook to forward Rust panics to console.error
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    log!("Rust Wasm module initialized!");

    // Get window, document, and canvas
    let window = window().expect("no global \`window\` exists");
    let document = window.document().expect("should have a document on window");
    let canvas = document
        .get_element_by_id("rust-canvas")
        .ok_or_else(|| JsValue::from_str("Cannot find canvas element with id 'rust-canvas'"))?
        .dyn_into::<HtmlCanvasElement>()?;

    // Get WebGL context
    let gl_context = canvas
        .get_context("webgl") // Request WebGL1 context
        // .get_context("webgl2") // Or WebGL2 if needed and supported
        .map_err(|js_val| {
            log!("Error getting WebGL context: {:?}", js_val);
            JsValue::from_str("Failed to get WebGL context (JS Error)")
        })?
        .ok_or_else(|| JsValue::from_str("Failed to get WebGL context (Result is None)"))?;

    let gl = gl_context
        .dyn_into::<GL>()
        .map_err(|_| JsValue::from_str("Failed to cast context to WebGlRenderingContext"))?;


    log!("WebGL context obtained successfully.");

    // Initialize application state
    let initial_state = AppState {
        gl,
        // TODO: Initialize other fields...
    };

    // Store the initial state in the thread_local storage
    APP_STATE.with(|state_ref| {
         *state_ref.borrow_mut() = Some(initial_state);
    });

    // Start the render loop
    setup_render_loop()?;

    Ok(())
}

// Function to request the next animation frame
fn request_animation_frame(f: &Closure<dyn FnMut(f64)>) -> Result<i32, JsValue> {
    window()
        .expect("no global window exists")
        .request_animation_frame(f.as_ref().unchecked_ref())
}

// Sets up the main render loop using requestAnimationFrame
fn setup_render_loop() -> Result<(), JsValue> {
    // Clone the Rc pointer to the state so the closure can own it
    let state_rc = APP_STATE.with(|state_ref| state_ref.clone());

    // Create the main loop closure
    let closure = Closure::wrap(Box::new(move |timestamp: f64| {
        // Borrow the state mutably. If it's None or already borrowed mutably, this will panic.
        // Ensure state is initialized and not concurrently borrowed mutably elsewhere.
        if let Some(app_state) = state_rc.borrow_mut().as_mut() {
             render_frame(app_state, timestamp);
        } 

        // Schedule the next frame. This keeps the loop going.
        RENDER_LOOP_CLOSURE.with(|cell| {
             if let Some(closure_ref) = cell.borrow().as_ref() {
                request_animation_frame(closure_ref).expect("should register \`requestAnimationFrame\` OK");
             }
        });
    }) as Box<dyn FnMut(f64)>);

    // Store the closure in thread_local storage to prevent it from being dropped
    RENDER_LOOP_CLOSURE.with(|cell| *cell.borrow_mut() = Some(closure));

    // Kick off the first frame request
    RENDER_LOOP_CLOSURE.with(|cell| {
         if let Some(closure_ref) = cell.borrow().as_ref() {
             request_animation_frame(closure_ref)?;
             Ok(())
         } else {
              Err(JsValue::from_str("Failed to store render loop closure"))
         }
    })
}


// --- Render Frame Logic ---
// timestamp: DOMHighResTimeStamp passed from requestAnimationFrame
fn render_frame(state: &mut AppState, timestamp: f64) {
    // Resize handling
    let canvas_option = state.gl.canvas();
    if canvas_option.is_none() {
        log!("Error: Could not get canvas from WebGL context.");
        return;
    }
    // This unwrap is safe due to the check above
    let canvas_element = canvas_option.unwrap();
    let canvas = match canvas_element.dyn_into::<HtmlCanvasElement>() {
         Ok(canvas) => canvas,
         Err(_) => {
             log!("Error: Failed to cast GL canvas back to HtmlCanvasElement.");
             return;
         }
    };

    // Check if the canvas drawing buffer size matches its display size
    let display_width = canvas.client_width() as u32;
    let display_height = canvas.client_height() as u32;

    let need_resize = canvas.width() != display_width || canvas.height() != display_height;
    if need_resize {
         canvas.set_width(display_width);
         canvas.set_height(display_height);
         state.gl.viewport(0, 0, display_width as i32, display_height as i32);
         // log!("Resized canvas to {}x{}", display_width, display_height); // Log resize events
    }


    // Clear the screen
    state.gl.clear_color(0.1, 0.1, 0.15, 1.0); // Dark background
    state.gl.clear_depth(1.0); // Clear depth buffer
    state.gl.enable(GL::DEPTH_TEST); // Enable depth testing
    state.gl.depth_func(GL::LEQUAL); // Near things obscure far things
    state.gl.clear(GL::COLOR_BUFFER_BIT | GL::DEPTH_BUFFER_BIT);


    // --- TODO: Add actual drawing logic here ---
    // 1. Use Shader Program: state.gl.use_program(Some(&your_program));
    // 2. Set Uniforms: state.gl.uniform_matrix4fv_with_f32_array(location, transpose, data);
    // 3. Bind Buffers/VAO: state.gl.bind_vertex_array_oaml(Some(&your_vao)); or bind buffers/set attributes
    // 4. Draw: state.gl.draw_arrays(GL::TRIANGLES, 0, num_vertices); or draw_elements

    // For now, just log the timestamp
    // log!("Rendering frame at time: {:.2}", timestamp);

    // Flush the command buffer
    state.gl.flush();
}


// Example exported function (callable from JS)
#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    log!("greet function called with: {}", name);
    format!("Hello from Rust, {}!", name)
}

// TODO:
// - Implement shader loading and compilation (vertex, fragment).
// - Implement buffer creation (VBOs, IBOs) and attribute setup (VAOs recommended).
// - Implement mesh/model loading or generation (e.g., a simple cube or plane).
// - Implement camera controls (projection * view matrices).
// - Implement input handling (JS -> Wasm calls for mouse/keyboard).
// - Implement terrain generation algorithm (chunking, LOD, noise functions).
// - Implement lighting calculations in shaders (pass light data as uniforms).
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
            overflow: hidden; /* Prevent scrollbars */
            height: 100%; /* Ensure body takes full height */
            background-color: #111; /* Fallback background */
            color: #eee; /* Default text color */
            font-family: sans-serif;
        }
        /* Canvas should fill the screen */
        canvas#rust-canvas {
            display: block;  /* Remove extra space below canvas */
            width: 100vw;    /* Full viewport width */
            height: 100vh;   /* Full viewport height */
            outline: none;   /* Remove focus outline */
            cursor: grab; /* Indicate interactivity */
        }
        canvas#rust-canvas:active {
            cursor: grabbing; /* Cursor style when dragging */
        }
        /* Status overlay for loading/errors */
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
            transition: opacity 0.5s ease-in-out;
        }
         #status-overlay.error {
             color: #ffdddd;
             background-color: rgba(100, 0, 0, 0.8);
         }
         #status-overlay.hidden {
             opacity: 0;
             pointer-events: none; /* Allow interaction with underlying canvas */
         }
    </style>
</head>
<body>
    <!-- The canvas element where Rust will draw -->
    <canvas id="rust-canvas" tabindex="0"></canvas> <!-- tabindex="0" allows canvas to receive keyboard events -->
    <!-- Overlay for displaying status messages -->
    <div id="status-overlay" class="hidden">Loading...</div>

    <script type="module">
        // Import the initializer function and any exported Rust functions
        import init, { greet } from './pkg/rust_wasm_3d.js';

        const statusOverlay = document.getElementById('status-overlay');
        const canvas = document.getElementById('rust-canvas');

        function showStatus(message, isError = false) {
            if (statusOverlay) {
                statusOverlay.textContent = message;
                statusOverlay.classList.toggle('error', isError);
                statusOverlay.classList.remove('hidden');
            }
            if (isError) {
                console.error("Status:", message);
            } else {
                console.log("Status:", message);
            }
        }

         function hideStatus(delay = 0) {
             if (statusOverlay) {
                setTimeout(() => {
                     statusOverlay.classList.add('hidden');
                 }, delay);
             }
         }

        async function run() {
            showStatus("Initializing Wasm module...");
            try {
                // Initialize the Wasm module. This calls the #[wasm_bindgen(start)] function (main_js).
                await init();
                showStatus("Wasm initialized. Rust drawing started.");

                // Example: Call an exported Rust function
                const greeting = greet("Web User");
                console.log("Message from Rust:", greeting);

                // Give focus to the canvas so it can receive keyboard events
                if (canvas) {
                     canvas.focus();
                     setupEventListeners(canvas);
                 }

                // Hide status message after a short delay
                hideStatus(1500);

            } catch (error) {
                console.error("Error initializing or running Wasm module:", error);
                let errorMessage = 'Fatal error loading Wasm module. Check console for details.';
                if (error instanceof Error) {
                    errorMessage = `Error: ${error.message}`;
                    if (error.message.includes("application/wasm")) {
                        errorMessage += `\n(Ensure the web server serves .wasm files with the 'application/wasm' MIME type)`;
                    } else if (error.message.includes("WebGlRenderingContext")) {
                         errorMessage += `\n(Could not initialize WebGL. Your browser might not support it or it might be disabled.)`;
                    }
                }
                showStatus(errorMessage, true);
                // Don't hide error messages automatically
            }
        }

        function setupEventListeners(canvasElement) {
            // --- Mouse Events ---
            canvasElement.addEventListener('click', (event) => {
                const rect = canvasElement.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                console.log(`Canvas clicked at: x=${x.toFixed(0)}, y=${y.toFixed(0)}`);
                // TODO: Call a Wasm function to handle the click, e.g.,
                // wasm_exports.handle_canvas_click(x, y);
            });

            canvasElement.addEventListener('contextmenu', (event) => {
                event.preventDefault(); // Prevent browser context menu
                console.log("Context menu prevented.");
                // TODO: Call Wasm function
            });

            canvasElement.addEventListener('mousedown', (event) => {
                console.log(`Mouse down: button=${event.button}`);
                canvasElement.focus(); // Ensure canvas has focus on mouse down
                // TODO: Call Wasm function (e.g., start camera drag)
            });

            canvasElement.addEventListener('mouseup', (event) => {
                console.log(`Mouse up: button=${event.button}`);
                // TODO: Call Wasm function (e.g., end camera drag)
            });

            canvasElement.addEventListener('mousemove', (event) => {
                 // Check if a mouse button is pressed (event.buttons bitmask)
                 if (event.buttons !== 0) {
                     // console.log(`Mouse move with button: dx=${event.movementX}, dy=${event.movementY}`);
                     // TODO: Call Wasm function (e.g., update camera rotation)
                 }
            });

             canvasElement.addEventListener('wheel', (event) => {
                 event.preventDefault(); // Prevent page scrolling
                 console.log(`Mouse wheel: deltaY=${event.deltaY.toFixed(2)}`);
                 // TODO: Call Wasm function (e.g., zoom camera)
             }, { passive: false }); // Need passive: false to preventDefault


            // --- Keyboard Events ---
            canvasElement.addEventListener('keydown', (event) => {
                // console.log(`Key down: key=${event.key}, code=${event.code}`);
                 // Prevent default browser actions for certain keys if needed
                 if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd'].includes(event.key)) {
                     event.preventDefault();
                 }
                 // TODO: Call Wasm function, passing event.key or event.code
                 // Example: wasm_exports.handle_key_down(event.code, event.shiftKey, event.ctrlKey, event.altKey);
             });

             canvasElement.addEventListener('keyup', (event) => {
                 // console.log(`Key up: key=${event.key}, code=${event.code}`);
                 // TODO: Call Wasm function
             });

             // --- Focus Events ---
             canvasElement.addEventListener('focus', () => {
                 console.log("Canvas gained focus");
             });
             canvasElement.addEventListener('blur', () => {
                 console.log("Canvas lost focus");
                 // TODO: Optionally pause input processing in Wasm when focus is lost
             });
        }


        // Start the application
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
    "start": "http-server . -p 8080 -c-1 --cors --mime.types='{\"application/wasm\": [\"wasm\"]}'",
    "build": "echo \"No frontend build step required. Run 'wasm-pack build --target web' in project root first.\"",
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


    ".gitignore": `# Rust/Cargo files
**/target
Cargo.lock

# Wasm build output (managed by wasm-pack)
pkg/
www/pkg/

# Node modules
node_modules/
www/node_modules/

# IDE/Editor files
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
Thumbs.db
`,
    "README.md": `# Rust Wasm 3D Project

This project provides a starting point for creating a 3D application using Rust compiled to WebAssembly (Wasm), intended to run entirely in a web browser. It includes basic setup for WebGL initialization, a render loop, and basic event listeners.

## Prerequisites

1.  **Rust Toolchain:** Install Rust (including \`cargo\`) from [https://rustup.rs/](https://rustup.rs/). The latest stable version is recommended.
2.  **wasm-pack:** Install the essential tool for building Rust-generated WebAssembly:
    ```bash
    cargo install wasm-pack
    ```
3.  **(Optional but Recommended) Node.js and npm:** Needed for the simple HTTP server used by the run scripts. Install the LTS version from [https://nodejs.org/](https://nodejs.org/).

## Setup and Running (using scripts)

These scripts automate the build process and start a local web server.

### Linux/macOS

1.  Make the script executable: \`chmod +x setup_and_run.sh\`
2.  Run the script: \`./setup_and_run.sh\`

### Windows

1.  Open Command Prompt or PowerShell.
2.  Navigate to the project directory.
3.  Run the script: \`.\\setup_and_run.bat\`

**What the scripts do:**
*   Check for \`cargo\` and \`wasm-pack\`. Installs \`wasm-pack\` via \`cargo\` if missing.
*   Build the Rust code into Wasm using \`wasm-pack build --target web\`. This command compiles your Rust code (\`src/lib.rs\`) and generates JavaScript bindings, placing the output into the \`./pkg/\` directory. **It automatically copies the output to \`./www/pkg/\` when using \`--target web\`.**
*   If Node.js/npm is detected:
    *   Navigates into the \`www\` directory.
    *   Runs \`npm install\` to download the \`http-server\` dependency (if not already present).
    *   Starts the local web server using \`npm start\` (which runs \`http-server\`). The script now explicitly sets the MIME type for \`.wasm\` files, which is crucial.
*   If Node.js/npm is not detected, it will instruct you to serve the \`www\` directory manually.

Open your web browser and navigate to the address provided (usually \`http://localhost:8080\` or \`http://127.0.0.1:8080\`). You should see a dark grey canvas filling the screen. Check the browser's developer console for logs from Rust and JavaScript event listeners.

## Manual Build and Run Steps

If you prefer not to use the scripts or encounter issues:

1.  **Build Wasm:** Navigate to the project root directory (where \`Cargo.toml\` is) and run:
    ```bash
    # For development (faster builds, larger size)
    wasm-pack build --target web --dev

    # For release (slower builds, optimized size/speed)
    # wasm-pack build --target web --release
    ```
    This creates/updates the \`./pkg/\` directory in the root and automatically copies its contents to \`./www/pkg/\`.

2.  **Serve the Web Page:** You need a local HTTP server to serve the files due to browser security restrictions for Wasm/modules loading via \`fetch\`. **Crucially, the server MUST serve \`.wasm\` files with the \`Content-Type: application/wasm\` MIME type.**
    *   **Using Node.js (Recommended):**
        ```bash
        cd www
        npm install # Only needs to be run once
        npm start   # Runs 'http-server . -p 8080 -c-1 --cors --mime.types="..."'
        ```
        The \`npm start\` script in \`www/package.json\` is configured to set the correct MIME type.
    *   **Using Python 3 (Requires Manual MIME Type Configuration or Custom Server):**
        The default Python server *might not* send the correct MIME type. You might need a custom script or a different server.
        ```bash
        # Basic Python server (MIME type might be wrong!)
        cd www
        python -m http.server 8080
        ```
    *   **Other Servers:** Ensure you serve the contents of the \`www\` directory and configure the server to send \`application/wasm\` for \`.wasm\` files.

3.  **View:** Open your browser to \`http://localhost:8080\` (or the port used by your server). Check the developer console for errors if it doesn't load.

## Project Structure

*   \`Cargo.toml\`: Rust project manifest (dependencies, settings, wasm-pack config).
*   \`src/lib.rs\`: Main Rust library code. Contains the \`#[wasm_bindgen(start)]\` function, WebGL setup, render loop logic, and example exported functions.
*   \`www/\`: Contains the web frontend files.
    *   \`index.html\`: The main HTML page that loads the Wasm module and contains the canvas and basic JS logic.
    *   \`package.json\`: Defines Node.js dev dependencies (\`http-server\`) and the \`npm start\` script for the frontend environment.
    *   \`pkg/\`: **(Created/Managed by \`wasm-pack\`)** Contains the compiled Wasm (\`.wasm\`) and the generated JavaScript bindings (\`.js\`, \`.d.ts\`). **Do not edit files in here directly.** This directory is automatically populated/updated by the \`wasm-pack build\` command.
*   \`pkg/\`: **(Created/Managed by \`wasm-pack\`)** This directory at the root contains the primary build artifacts before they are potentially copied elsewhere (like to \`www/pkg/\` by \`--target web\`). Usually safe to ignore.
*   \`.gitignore\`: Specifies files/directories to be ignored by Git (includes build outputs, node_modules, etc.).
*   \`setup_and_run.sh\`: Setup/run script for Linux/macOS.
*   \`setup_and_run.bat\`: Setup/run script for Windows.
*   \`README.md\`: This file.
*   \`config.js\`: (In root) Simple JavaScript config for the download page.
*   \`index.html\`: (In root) The download page HTML.
*   \`script.js\`: (In root) The JavaScript for the download page (zipping logic).
*   \`style.css\`: (In root) The CSS for the download page.


## Next Steps & Development

1.  **Explore \`src/lib.rs\`:** Understand the WebGL setup, the \`AppState\` struct, the \`render_frame\` function, and how the render loop (\`setup_render_loop\`) works with \`requestAnimationFrame\`.
2.  **Shaders:** Write simple GLSL vertex and fragment shaders (e.g., draw a colored triangle). Store them as strings in Rust or load them externally (more complex).
3.  **Load/Compile Shaders in Rust:** Use \`gl.create_shader\`, \`gl.shader_source\`, \`gl.compile_shader\`, \`gl.create_program\`, \`gl.attach_shader\`, \`gl.link_program\`. Check for compilation/linking errors using \`gl.get_shader_parameter\`/\`gl.get_program_parameter\` and \`gl.get_shader_info_log\`/\`gl.get_program_info_log\`. Store program/uniform/attribute locations in \`AppState\`.
4.  **Geometry & Buffers:** Define vertex data (positions, colors, normals, UVs) in Rust (e.g., using \`Vec<f32>\`). Create WebGL buffers (\`gl.create_buffer\`), bind them (\`gl.bind_buffer\`), and upload data (\`gl.buffer_data_with_u8_array\` or similar, converting your Rust vectors to \`&[u8]\`).
5.  **Vertex Attributes & VAOs:** Get attribute locations (\`gl.get_attrib_location\`). Use Vertex Array Objects (VAOs via \`WebGlVertexArrayObject\` feature in \`web-sys\`) to encapsulate buffer bindings and attribute pointer setup. Create a VAO, bind it, bind your VBO/IBO, call \`gl.vertex_attrib_pointer\` and \`gl.enable_vertex_attrib_array\` for each attribute, then unbind the VAO. To draw, just bind the VAO and call \`drawArrays\`/\`drawElements\`.
6.  **Rendering:** In \`render_frame\`: Clear the screen (already done), use the shader program (\`gl.use_program\`), bind the appropriate VAO (\`gl.bind_vertex_array_oaml\`), set uniforms (\`gl.uniformMatrix4fv\`, \`gl.uniform3f\`, etc.), and make a draw call (\`gl.drawArrays\` or \`gl.drawElements\`).
7.  **Camera & Controls:** Implement camera logic (view, projection matrices, position, orientation). Use a math library like \`glam\` (add to \`Cargo.toml\`). Add \`#[wasm_bindgen]\` functions in Rust (e.g., \`handle_mouse_move(dx: f32, dy: f32)\`, \`handle_key_down(key_code: String)\`). Call these Rust functions from the JavaScript event listeners in \`www/index.html\`. Update camera state within \`AppState\`. Pass view/projection matrices as uniforms to shaders.
8.  **Infinite Terrain:** Research techniques like chunking (generating/rendering terrain sections around the camera), Level of Detail (LOD - simpler geometry for distant chunks), procedural generation using noise functions (e.g., Perlin/Simplex via crates like \`noise-rs\`), and heightmap generation/rendering.
9.  **Lighting:** Implement lighting models (e.g., directional, point, Blinn-Phong, PBR) in your GLSL shaders. Pass light properties (position/direction, color, intensity) and material properties (color, shininess) as uniforms from Rust (\`AppState\`). Calculate surface normals for your geometry.

Happy Coding!
`,


    "setup_and_run.sh": `#!/bin/bash

# Ensure the script exits if any command fails
set -e

echo "--- Rust Wasm 3D Project Setup & Run (Linux/macOS) ---"
echo ""
echo "Checking prerequisites..."

# Check for Rust/Cargo
if ! command -v cargo &> /dev/null; then
    echo "[Error] Rust/Cargo are not installed or not in PATH."
    echo "        Please install it from https://rustup.rs/"
    exit 1
fi
CARGO_VERSION=$(cargo --version)
echo "[OK] Rust/Cargo found. ($CARGO_VERSION)"

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo "[Info] wasm-pack not found. Attempting to install via cargo..."
    cargo install wasm-pack
    if ! command -v wasm-pack &> /dev/null; then
        echo "[Error] Failed to install wasm-pack."
        echo "        Please install it manually ('cargo install wasm-pack') and ensure ~/.cargo/bin is in your system PATH."
        exit 1
    fi
     echo "[OK] wasm-pack installed successfully."
else
     echo "[OK] wasm-pack found."
fi
WASMPACK_VERSION=$(wasm-pack --version)
echo "     ($WASMPACK_VERSION)"
echo ""

echo "Building Rust code to WebAssembly (--dev profile)..."
# Build for web target. This automatically populates ./www/pkg/
# Use --release for optimized builds, e.g., wasm-pack build --target web --release
# Using --dev for faster initial builds
wasm-pack build --target web --dev
if [ $? -ne 0 ]; then
    echo "[Error] wasm-pack build failed. Check the errors above."
    exit 1
fi
echo "[OK] Wasm build successful. Output in ./pkg/ and copied to ./www/pkg/"
echo ""


# Check for Node.js and npm for the web server
echo "Checking for Node.js and npm (optional, for local server)..."
if command -v node &> /dev/null && command -v npm &> /dev/null; then
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    echo "[OK] Node.js found ($NODE_VERSION)"
    echo "[OK] npm found ($NPM_VERSION)"
    echo ""
    echo "Setting up and starting the development server..."

    # Navigate to www directory
    cd www || { echo "[Error] Failed to change directory to 'www'."; exit 1; }

    # Install http-server if node_modules doesn't exist or http-server is missing
    if [ ! -d "node_modules/http-server" ]; then
        echo "[Info] node_modules directory or http-server not found."
        if [ -f "package.json" ]; then
            echo "[Info] Running 'npm install' in $(pwd)..."
            npm install
            if [ $? -ne 0 ]; then
                echo "[Warning] 'npm install' failed. The server might not start correctly."
                echo "          Try running 'npm install' manually in the 'www' directory."
            else
                echo "[OK] npm install completed."
            fi
        else
            echo "[Warning] No package.json found. Cannot run 'npm install'. Needed for http-server."
        fi
    else
        echo "[Info] node_modules/http-server exists, assuming dependencies are installed."
    fi

    echo "[Info] Starting web server using 'npm start' (http-server)..."
    echo "       Serving content from $(pwd)"
    echo "       Open your browser to http://localhost:8080 (or the address shown)"
    echo "       Press Ctrl+C in this terminal window to stop the server."
    echo ""
    # Start http-server via npm start
    # The script will block here until server is stopped (Ctrl+C)
    npm start
    cd .. # Go back to project root after server stops

else
    echo "[Info] Node.js and/or npm not found. Cannot run server automatically."
    echo "[OK] Wasm build is complete."
    echo ""
    echo "To run the project, navigate to the 'www' directory and serve it using a local HTTP server."
    echo "Ensure the server provides the correct MIME type for .wasm files ('application/wasm')."
    echo "Examples:"
    echo "  If you have Python 3: cd www && python3 -m http.server 8080"
    echo "  (Note: Python's default server might not set the correct MIME type for .wasm)"
    echo "  Consider installing a dedicated server or using the Node.js option."
    echo ""
    echo "Then open your browser to http://localhost:8080"

fi

echo ""
echo "--- Setup script finished ---"
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

echo Building Rust code to WebAssembly (--dev profile)...
REM Build for web target. This automatically populates ./www/pkg/
REM Use --release for optimized builds, e.g., wasm-pack build --target web --release
REM Using --dev for faster initial builds
wasm-pack build --target web --dev
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
        if errorlevel 1 (
            echo [Error] Failed to change directory to 'www'.
            goto :eof
        )

        REM Install http-server if node_modules doesn't exist or http-server is missing
        if not exist "node_modules\\http-server" (
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
        REM Start http-server via npm start in the *current* window so user sees output/errors
        call npm start
        popd
        goto :server_finished

    ) else (
        echo [Info] npm not found, but node was found. Cannot run server automatically via npm.
        goto :no_server
    )
) else (
        echo [Info] Node.js not found. Cannot run server automatically.
        goto :no_server
    )


:no_server
echo [OK] Wasm build is complete.
echo.
echo To run the project, navigate into the 'www' directory and serve it using a local HTTP server.
echo Make sure the server provides the correct MIME type for .wasm' files ('application/wasm').
echo Examples:
echo   If you have Python 3: cd www ^& python -m http.server 8080
echo   (Note: Python's default server might not set the correct MIME type for .wasm)
echo   Consider installing a dedicated server or using the Node.js option.
echo.
echo Then open your browser to http://localhost:8080
goto :end

:server_finished
echo [Info] Server stopped.
goto :end


:end
echo.
echo --- Setup script finished ---
endlocal
`,


    "src/": "", // Ensure directory exists
    "www/": "", // Ensure directory exists
};

downloadBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Generating zip file, please wait...';
    statusEl.style.color = '#007bff'; // Blue
    downloadBtn.disabled = true;

    try {
        const zip = new JSZip();

        // Add folders first if needed (JSZip automatically creates parent folders for files)
        // zip.folder("src");
        // zip.folder("www");

        for (const [path, content] of Object.entries(projectFiles)) {
             // Check for explicit folder creation (empty content for a path ending in '/')
             if (path.endsWith('/') && content === "") {
                 // zip.folder(path.slice(0, -1)); // Redundant if files are added later
             } else if (content !== "__DELETE_ME__") { // Check for deletion flag
                 // Add file content
                 zip.file(path, content);
            }
            // No else needed for "__DELETE_ME__" as we just skip adding the file
        }

        // Set executable permissions for .sh file (best effort)
        const options = {
            platform: navigator.platform.toUpperCase().includes('WIN') ? 'DOS' : 'UNIX',
            compression: "DEFLATE",
            compressionOptions: {
                level: 6 // Balance between speed and compression
            },
            // This function sets file permissions for UNIX platforms
            unixPermissions: (path) => {
                // Give execute permission to setup_and_run.sh
                if (path === 'setup_and_run.sh') {
                    // 0o755 is rwxr-xr-x (owner: rwx, group: rx, others: rx)
                    return 0o755;
                }
                // Default permissions (usually 644: rw-r--r--) handled by JSZip
                return null;
            },
            dosPermissions: null // No specific DOS permissions needed here
        };


        const zipBlob = await zip.generateAsync(
            options,
            (metadata) => {
                 // Update progress in the status element
                 statusEl.textContent = `Zipping: ${metadata.percent.toFixed(0)}% (${metadata.currentFile || '...' })`;
             }
        );

        const filename = `${projectName.toLowerCase().replace(/\s+/g, '_')}_project.zip`;
        saveAs(zipBlob, filename); // Use file-saver library

        statusEl.textContent = 'Download started successfully!';
        statusEl.style.color = 'green';
    } catch (error) {
        console.error("Error generating zip file:", error);
        statusEl.textContent = 'Error generating zip file. See console for details.';
        statusEl.style.color = 'red';
    } finally {
        downloadBtn.disabled = false;
        // Optionally clear status message after a few seconds on success
        setTimeout(() => {
            if (statusEl.style.color === 'green') { // Only clear success messages
                 statusEl.textContent = '';
            }
         }, 5000);
    }
});